import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Handle empty request body gracefully
    let targetDate = null;
    try {
      const body = await req.text();
      if (body && body.trim()) {
        const parsed = JSON.parse(body);
        targetDate = parsed.targetDate;
      }
    } catch (parseError) {
      console.log("No valid JSON body provided, using default date");
    }
    const scanDate = targetDate || new Date().toISOString().split('T')[0];

    console.log(`Rescanning temperatures for date: ${scanDate}`);

    // Fetch all checklist responses with images from the target date
    const { data: responses, error: fetchError } = await supabase
      .from('checklist_responses')
      .select(`
        id,
        response_image_url,
        extracted_temperature,
        item_id,
        checklist_items(question)
      `)
      .not('response_image_url', 'is', null)
      .gte('created_at', `${scanDate}T00:00:00`)
      .lte('created_at', `${scanDate}T23:59:59`);

    if (fetchError) {
      console.error("Error fetching responses:", fetchError);
      throw new Error("Failed to fetch temperature readings");
    }

    if (!responses || responses.length === 0) {
      return new Response(
        JSON.stringify({ message: "No temperature readings found for this date", results: [] }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Found ${responses.length} temperature readings to rescan`);

    const results = [];

    // Process each response
    for (const response of responses) {
      try {
        const item = response.checklist_items?.[0];
        const question = item?.question || 'Unknown';
        console.log(`Processing response ${response.id} for item: ${question}`);

        // Call extract-temperature function
        const { data: extractData, error: extractError } = await supabase.functions.invoke(
          'extract-temperature',
          { body: { imageUrl: response.response_image_url } }
        );

        if (extractError) {
          console.error(`Error extracting temperature for ${response.id}:`, extractError);
          results.push({
            id: response.id,
            question,
            success: false,
            error: extractError.message,
            previousTemp: response.extracted_temperature
          });
          continue;
        }

        const { temperature, isValid } = extractData;

        // Update the response
        const { error: updateError } = await supabase
          .from('checklist_responses')
          .update({
            extracted_temperature: temperature,
            temperature_valid: isValid,
            temperature_validated_at: new Date().toISOString()
          })
          .eq('id', response.id);

        if (updateError) {
          console.error(`Error updating response ${response.id}:`, updateError);
          results.push({
            id: response.id,
            question,
            success: false,
            error: updateError.message,
            previousTemp: response.extracted_temperature,
            newTemp: temperature
          });
          continue;
        }

        results.push({
          id: response.id,
          question,
          success: true,
          previousTemp: response.extracted_temperature,
          newTemp: temperature,
          isValid: isValid,
          changed: response.extracted_temperature !== temperature
        });

        console.log(`Successfully updated ${response.id}: ${response.extracted_temperature} -> ${temperature}`);
      } catch (error) {
        console.error(`Error processing response ${response.id}:`, error);
        const item = response.checklist_items?.[0];
        results.push({
          id: response.id,
          question: item?.question || "Unknown",
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
          previousTemp: response.extracted_temperature
        });
      }
    }

    const summary = {
      total: results.length,
      successful: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length,
      changed: results.filter(r => r.changed).length
    };

    console.log("Rescan complete:", summary);

    return new Response(
      JSON.stringify({ summary, results }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error in rescan-temperatures function:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
