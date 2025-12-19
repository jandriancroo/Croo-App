import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
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
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const contentType = req.headers.get("content-type") || "";
    
    let uint8Array: Uint8Array;
    let fileName: string;
    let fileType: string;

    // Handle JSON body with URL
    if (contentType.includes("application/json")) {
      const { url, name } = await req.json();
      if (!url || !name) {
        return new Response(
          JSON.stringify({ error: "URL and name are required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      
      console.log(`Fetching file from URL: ${url}`);
      const response = await fetch(url);
      const arrayBuffer = await response.arrayBuffer();
      uint8Array = new Uint8Array(arrayBuffer);
      fileName = name;
      fileType = response.headers.get("content-type") || "image/png";
    } else {
      // Handle form data
      const formData = await req.formData();
      const file = formData.get("file") as File;
      fileName = (formData.get("fileName") as string) || file.name;

      if (!file) {
        return new Response(
          JSON.stringify({ error: "No file provided" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const arrayBuffer = await file.arrayBuffer();
      uint8Array = new Uint8Array(arrayBuffer);
      fileType = file.type;
    }

    console.log(`Uploading file: ${fileName}, size: ${uint8Array.length}`);

    const { data, error } = await supabaseAdmin.storage
      .from("brand-assets")
      .upload(fileName, uint8Array, {
        contentType: fileType,
        upsert: true,
      });

    if (error) {
      console.error("Upload error:", error);
      return new Response(
        JSON.stringify({ error: error.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: urlData } = supabaseAdmin.storage
      .from("brand-assets")
      .getPublicUrl(fileName);

    console.log("Upload successful:", urlData.publicUrl);

    return new Response(
      JSON.stringify({ success: true, url: urlData.publicUrl }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("Error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
