import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { decode as decodeBase64 } from "https://deno.land/std@0.168.0/encoding/base64.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * One-time cleanup function to compress existing checklist images
 * Uses Lovable AI to resize images
 */
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Parse options
    let dryRun = true; // Default to dry run for safety
    let limit = 10;
    let minSizeKb = 500;

    try {
      const body = await req.json();
      dryRun = body.dryRun !== false;
      limit = Math.min(body.limit || 10, 50);
      minSizeKb = body.minSizeKb || 500;
    } catch {
      // Use defaults
    }

    console.log(`[CLEANUP] Starting - dryRun: ${dryRun}, limit: ${limit}, minSizeKb: ${minSizeKb}`);

    // List folders and files manually
    let filesToProcess: { path: string; size: number }[] = [];

    const { data: folders } = await supabase.storage
      .from("checklist-images")
      .list("", { limit: 200 });

    for (const folder of folders || []) {
      if (!folder.metadata && filesToProcess.length < limit * 2) {
        const { data: files } = await supabase.storage
          .from("checklist-images")
          .list(folder.name, { limit: 200 });

        for (const file of files || []) {
          if (file.metadata) {
            const size = (file.metadata as any).size || 0;
            const mimetype = (file.metadata as any).mimetype || "";
            if (size > minSizeKb * 1024 && mimetype.startsWith("image/")) {
              filesToProcess.push({
                path: `${folder.name}/${file.name}`,
                size,
              });
            }
          }
        }
      }
    }

    // Sort by size and limit
    filesToProcess.sort((a, b) => b.size - a.size);
    filesToProcess = filesToProcess.slice(0, limit);

    console.log(`[CLEANUP] Found ${filesToProcess.length} files to process`);

    const results: {
      file: string;
      originalSize: number;
      newSize?: number;
      savingsPercent?: number;
      status: string;
      newUrl?: string;
    }[] = [];

    let totalSaved = 0;

    for (const file of filesToProcess) {
      try {
        console.log(`[CLEANUP] Processing: ${file.path} (${(file.size / 1024).toFixed(0)}KB)`);

        if (dryRun) {
          const estimatedNewSize = Math.min(file.size * 0.25, 300 * 1024);
          results.push({
            file: file.path,
            originalSize: file.size,
            newSize: Math.round(estimatedNewSize),
            savingsPercent: Math.round((1 - estimatedNewSize / file.size) * 100),
            status: "would_compress",
          });
          continue;
        }

        // Download the file
        const { data: fileData, error: downloadError } = await supabase.storage
          .from("checklist-images")
          .download(file.path);

        if (downloadError || !fileData) {
          results.push({
            file: file.path,
            originalSize: file.size,
            status: `download_failed: ${downloadError?.message}`,
          });
          continue;
        }

        // Get the public URL for the image
        const { data: urlData } = supabase.storage
          .from("checklist-images")
          .getPublicUrl(file.path);

        const imageUrl = urlData.publicUrl;

        // Use Lovable AI to resize the image
        const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
        
        if (!LOVABLE_API_KEY) {
          results.push({
            file: file.path,
            originalSize: file.size,
            status: "skipped_no_api_key",
          });
          continue;
        }

        // Request image resize via Lovable AI
        const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${LOVABLE_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "google/gemini-2.5-flash-image",
            messages: [
              {
                role: "user",
                content: [
                  {
                    type: "text",
                    text: "Resize this image to be maximum 1200 pixels on the longest side while maintaining aspect ratio. Keep the same content, do not modify or enhance the image. Output as JPEG."
                  },
                  {
                    type: "image_url",
                    image_url: { url: imageUrl }
                  }
                ]
              }
            ],
            modalities: ["image", "text"]
          })
        });

        if (!response.ok) {
          const errorText = await response.text();
          results.push({
            file: file.path,
            originalSize: file.size,
            status: `ai_error: ${response.status} - ${errorText.slice(0, 100)}`,
          });
          continue;
        }

        const aiResult = await response.json();
        const newImageBase64 = aiResult.choices?.[0]?.message?.images?.[0]?.image_url?.url;

        if (!newImageBase64 || !newImageBase64.startsWith("data:image")) {
          results.push({
            file: file.path,
            originalSize: file.size,
            status: "no_image_in_response",
          });
          continue;
        }

        // Extract base64 data
        const base64Data = newImageBase64.split(",")[1];
        const compressedBytes = decodeBase64(base64Data);
        const newSize = compressedBytes.length;
        const savings = ((file.size - newSize) / file.size * 100);

        // Only replace if we saved at least 10%
        if (savings < 10) {
          results.push({
            file: file.path,
            originalSize: file.size,
            newSize,
            savingsPercent: Math.round(savings),
            status: "skipped_already_optimized",
          });
          continue;
        }

        // Delete old and upload new
        await supabase.storage.from("checklist-images").remove([file.path]);

        const newPath = file.path.replace(/\.(png|jpeg|jpg)$/i, ".jpg");
        const { error: uploadError } = await supabase.storage
          .from("checklist-images")
          .upload(newPath, compressedBytes, {
            contentType: "image/jpeg",
            upsert: true,
          });

        if (uploadError) {
          results.push({
            file: file.path,
            originalSize: file.size,
            status: `upload_failed: ${uploadError.message}`,
          });
          continue;
        }

        // If path changed (was PNG), update any database references
        if (newPath !== file.path) {
          const oldUrl = `${supabaseUrl}/storage/v1/object/public/checklist-images/${file.path}`;
          const newUrl = `${supabaseUrl}/storage/v1/object/public/checklist-images/${newPath}`;
          
          await supabase
            .from("checklist_responses")
            .update({ response_image_url: newUrl })
            .eq("response_image_url", oldUrl);
        }

        totalSaved += file.size - newSize;
        
        const { data: newUrlData } = supabase.storage
          .from("checklist-images")
          .getPublicUrl(newPath);

        results.push({
          file: file.path,
          originalSize: file.size,
          newSize,
          savingsPercent: Math.round(savings),
          status: "compressed",
          newUrl: newUrlData.publicUrl,
        });

        console.log(`[CLEANUP] ✓ ${file.path}: ${(file.size / 1024).toFixed(0)}KB → ${(newSize / 1024).toFixed(0)}KB (${savings.toFixed(0)}% saved)`);

      } catch (err) {
        console.error(`[CLEANUP] Error processing ${file.path}:`, err);
        results.push({
          file: file.path,
          originalSize: file.size,
          status: `error: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }

    const summary = {
      dryRun,
      filesProcessed: results.length,
      totalSavedMB: (totalSaved / 1024 / 1024).toFixed(2),
      compressedCount: results.filter(r => r.status === "compressed").length,
      errorCount: results.filter(r => r.status.startsWith("error")).length,
    };

    console.log("[CLEANUP] Complete:", JSON.stringify(summary));

    return new Response(
      JSON.stringify({ summary, results }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("[CLEANUP] Error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
