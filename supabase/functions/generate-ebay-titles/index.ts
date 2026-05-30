import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { brand, modelPartNumber, compatibility } = await req.json();
    console.log(`Generating eBay titles for: ${brand} ${modelPartNumber}`);

    const anthropicApiKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!anthropicApiKey) {
      throw new Error('ANTHROPIC_API_KEY not configured');
    }

    // Build context for AI
    const compatInfo = compatibility?.specifics 
      ? `\nVehicle Compatibility: ${JSON.stringify(compatibility.specifics)}`
      : '';

    const prompt = `You are an eBay listing optimization expert specializing in automotive parts.

Generate 5-10 SEO-optimized eBay listing titles for this part:
- Brand: ${brand}
- Model/Part Number: ${modelPartNumber}${compatInfo}

eBay Title Best Practices:
1. Maximum 80 characters
2. Include brand name and part number
3. Add relevant fitment info (make, model, year if known)
4. Use keywords buyers search for
5. NO promotional text (FREE SHIPPING, BEST PRICE, etc.)
6. Use pipes | or commas to separate key info
7. Focus on searchability and accuracy

Return ONLY a JSON array of title strings, no other text:
["title1", "title2", "title3", ...]`;

    console.log('Calling Claude for title generation');

    const aiResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': anthropicApiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: 1024,
        system: 'You are an expert at creating eBay listing titles. Return only valid JSON arrays of title strings.',
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      console.error('AI API error:', aiResponse.status, errorText);
      throw new Error(`AI API error: ${aiResponse.status}`);
    }

    const aiData = await aiResponse.json();
    const generatedText = aiData.content?.[0]?.text || '';
    console.log('AI response:', generatedText);

    // Parse the JSON array from AI response
    let titles: string[] = [];
    try {
      // Try to extract JSON array from the response
      const jsonMatch = generatedText.match(/\[.*\]/s);
      if (jsonMatch) {
        titles = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('No JSON array found in response');
      }
    } catch (parseError) {
      console.error('Failed to parse AI response as JSON:', parseError);
      // Fallback: split by newlines and clean up
      titles = generatedText
        .split('\n')
        .map((line: string) => line.trim().replace(/^["']|["']$/g, ''))
        .filter((line: string) => line && !line.startsWith('[') && !line.startsWith(']'))
        .slice(0, 10);
    }

    // Validate and clean titles
    titles = titles
      .filter((title: string) => title && title.length <= 80)
      .slice(0, 10);

    if (titles.length === 0) {
      throw new Error('No valid titles generated');
    }

    console.log(`Generated ${titles.length} titles`);

    // Update cache with generated titles
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const searchKey = `${brand.toLowerCase()}_${modelPartNumber.toLowerCase()}`;
    await supabase
      .from('ebay_search_cache')
      .update({ seo_titles: titles })
      .eq('search_key', searchKey);

    return new Response(JSON.stringify({ 
      success: true, 
      titles 
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Title generation error:', error);
    return new Response(JSON.stringify({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
