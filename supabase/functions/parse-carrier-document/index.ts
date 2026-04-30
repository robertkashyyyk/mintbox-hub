// Parse a carrier document (PDF) using Lovable AI and persist extracted penalties.
// Triggered after a document row + storage upload exists.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { document_id } = await req.json();
    if (!document_id) {
      return json({ error: "document_id is required" }, 400);
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      return json({ error: "LOVABLE_API_KEY not configured" }, 500);
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    // Load document
    const { data: doc, error: docErr } = await supabase
      .from("carrier_documents")
      .select("id, carrier_id, doc_type, file_path, document_date")
      .eq("id", document_id)
      .single();
    if (docErr || !doc) {
      return json({ error: docErr?.message ?? "document not found" }, 404);
    }

    await supabase
      .from("carrier_documents")
      .update({ parse_status: "parsing", parse_error: null })
      .eq("id", document_id);

    // Download the PDF from storage
    const { data: fileBlob, error: dlErr } = await supabase.storage
      .from("carrier-documents")
      .download(doc.file_path);
    if (dlErr || !fileBlob) {
      await markFailed(supabase, document_id, dlErr?.message ?? "download failed");
      return json({ error: dlErr?.message ?? "download failed" }, 500);
    }

    const arrayBuf = await fileBlob.arrayBuffer();
    const base64 = arrayBufferToBase64(arrayBuf);
    const dataUrl = `data:application/pdf;base64,${base64}`;

    // Ask Lovable AI (Gemini) to extract structured penalty data
    const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          {
            role: "system",
            content:
              "You extract structured data from courier (Royal Mail / DPD / Evri / Hermes) invoices and penalty notices. Always return a single tool call. Dates must be ISO YYYY-MM-DD. Amounts are GBP numbers (no symbols). If a field is not present, omit it.",
          },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `Extract every penalty / surcharge line from this ${doc.doc_type}. For each line capture: tracking_number, penalty_amount, reason_code, reason_text, declared_format, actual_format, penalty_date. Also return document-level totals and the document date.`,
              },
              { type: "image_url", image_url: { url: dataUrl } },
            ],
          },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "record_carrier_document",
              description: "Record a carrier document and its penalty lines",
              parameters: {
                type: "object",
                properties: {
                  document_date: { type: "string", description: "ISO date" },
                  period_start: { type: "string" },
                  period_end: { type: "string" },
                  total_amount: { type: "number" },
                  penalties: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        tracking_number: { type: "string" },
                        penalty_amount: { type: "number" },
                        reason_code: { type: "string" },
                        reason_text: { type: "string" },
                        declared_format: { type: "string" },
                        actual_format: { type: "string" },
                        penalty_date: { type: "string" },
                      },
                      required: ["penalty_amount"],
                      additionalProperties: false,
                    },
                  },
                },
                required: ["penalties"],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "record_carrier_document" } },
      }),
    });

    if (!aiResp.ok) {
      const t = await aiResp.text();
      const msg =
        aiResp.status === 429
          ? "Rate limit exceeded — please retry shortly."
          : aiResp.status === 402
            ? "AI credits exhausted — top up Lovable AI usage."
            : `AI gateway error (${aiResp.status}): ${t.slice(0, 300)}`;
      await markFailed(supabase, document_id, msg);
      return json({ error: msg }, aiResp.status);
    }

    const aiJson = await aiResp.json();
    const toolCall = aiJson.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall?.function?.arguments) {
      await markFailed(supabase, document_id, "AI did not return structured output");
      return json({ error: "AI did not return structured output", raw: aiJson }, 500);
    }

    let parsed: any;
    try {
      parsed = JSON.parse(toolCall.function.arguments);
    } catch (e) {
      await markFailed(supabase, document_id, "Invalid JSON from AI");
      return json({ error: "Invalid JSON from AI" }, 500);
    }

    const penalties: any[] = Array.isArray(parsed.penalties) ? parsed.penalties : [];

    // Insert penalties
    if (penalties.length > 0) {
      const rows = penalties.map((p) => ({
        document_id: doc.id,
        carrier_id: doc.carrier_id,
        tracking_number: p.tracking_number ?? null,
        penalty_amount: Number(p.penalty_amount) || 0,
        reason_code: p.reason_code ?? null,
        reason_text: p.reason_text ?? null,
        declared_format: p.declared_format ?? null,
        actual_format: p.actual_format ?? null,
        penalty_date: isIsoDate(p.penalty_date) ? p.penalty_date : doc.document_date,
      }));
      const { error: insErr } = await supabase.from("carrier_penalties").insert(rows);
      if (insErr) {
        await markFailed(supabase, document_id, `Insert failed: ${insErr.message}`);
        return json({ error: insErr.message }, 500);
      }
    }

    // Update document with totals & status
    const updates: Record<string, unknown> = {
      parse_status: "parsed",
      parsed_at: new Date().toISOString(),
      parse_error: null,
    };
    if (typeof parsed.total_amount === "number") updates.total_amount = parsed.total_amount;
    if (isIsoDate(parsed.period_start)) updates.period_start = parsed.period_start;
    if (isIsoDate(parsed.period_end)) updates.period_end = parsed.period_end;

    await supabase.from("carrier_documents").update(updates).eq("id", document_id);

    return json({ ok: true, penalties_inserted: penalties.length });
  } catch (e) {
    console.error("parse-carrier-document error", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function markFailed(supabase: any, id: string, msg: string) {
  await supabase
    .from("carrier_documents")
    .update({ parse_status: "failed", parse_error: msg })
    .eq("id", id);
}

function isIsoDate(s: unknown): s is string {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
