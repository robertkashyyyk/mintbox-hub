// Parse a carrier document (PDF) using Claude (Anthropic) and persist extracted penalties.
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
    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
    if (!ANTHROPIC_API_KEY) {
      return json({ error: "ANTHROPIC_API_KEY not configured" }, 500);
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

    // Ask Claude to extract structured penalty data from the PDF
    const aiResp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-opus-4-5",
        max_tokens: 4096,
        system: `You are an expert at extracting structured data from UK courier documents — specifically Royal Mail invoice files and penalty/surcharge notices.

Royal Mail penalty notices list each parcel on a separate line with:
- A tracking number (usually starts with letters like JD, SD, QQ, BJ etc.)
- A surcharge reason code (e.g. F001, F002, S001, W001)
- The declared format/size the sender claimed
- The actual format/size Royal Mail measured
- The penalty/surcharge amount in GBP

Invoice documents list service charges, VAT, and surcharge totals.

Extract every individual penalty/surcharge line. Dates must be ISO YYYY-MM-DD. Amounts are GBP numbers (no £ symbol). If a field is not present, omit it or use null.`,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "document",
                source: {
                  type: "base64",
                  media_type: "application/pdf",
                  data: base64,
                },
              },
              {
                type: "text",
                text: `This is a Royal Mail ${doc.doc_type}. Extract every penalty/surcharge line. For each line capture: tracking_number, penalty_amount, reason_code, reason_text, declared_format, actual_format, penalty_date. Also return the document-level total_amount, period_start, and period_end if shown.`,
              },
            ],
          },
        ],
        tools: [
          {
            name: "record_carrier_document",
            description: "Record a carrier document and all its penalty lines",
            input_schema: {
              type: "object",
              properties: {
                document_date: { type: "string", description: "ISO date YYYY-MM-DD" },
                period_start: { type: "string", description: "ISO date YYYY-MM-DD" },
                period_end: { type: "string", description: "ISO date YYYY-MM-DD" },
                total_amount: { type: "number", description: "Total GBP amount" },
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
                  },
                },
              },
              required: ["penalties"],
            },
          },
        ],
        tool_choice: { type: "tool", name: "record_carrier_document" },
      }),
    });

    if (!aiResp.ok) {
      const t = await aiResp.text();
      const msg =
        aiResp.status === 429
          ? "Rate limit exceeded — please retry shortly."
          : aiResp.status === 402
            ? "Anthropic API credits exhausted."
            : `Claude API error (${aiResp.status}): ${t.slice(0, 300)}`;
      await markFailed(supabase, document_id, msg);
      return json({ error: msg }, aiResp.status);
    }

    const aiJson = await aiResp.json();

    // Claude tool use: content block with type "tool_use"
    const toolUseBlock = aiJson.content?.find((b: any) => b.type === "tool_use");
    if (!toolUseBlock?.input) {
      await markFailed(supabase, document_id, "Claude did not return structured output");
      return json({ error: "Claude did not return structured output", raw: aiJson }, 500);
    }

    const parsed = toolUseBlock.input;
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
