import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * One-time cleanup function to compress existing checklist images
 * Uses canvas-based compression for proper JPEG quality control
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
    let dryRun = true;
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

    // List folders and files
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

    // Sort by size descending and limit
    filesToProcess.sort((a, b) => b.size - a.size);
    filesToProcess = filesToProcess.slice(0, limit);

    console.log(`[CLEANUP] Found ${filesToProcess.length} files to process`);

    const results: {
      file: string;
      originalSize: number;
      newSize?: number;
      savingsPercent?: number;
      status: string;
    }[] = [];

    let totalSaved = 0;

    for (const file of filesToProcess) {
      try {
        console.log(`[CLEANUP] Processing: ${file.path} (${(file.size / 1024).toFixed(0)}KB)`);

        if (dryRun) {
          // Estimate ~300KB target
          const estimatedNewSize = Math.min(file.size * 0.1, 350 * 1024);
          results.push({
            file: file.path,
            originalSize: file.size,
            newSize: Math.round(estimatedNewSize),
            savingsPercent: Math.round((1 - estimatedNewSize / file.size) * 100),
            status: "would_compress",
          });
          continue;
        }

        // Download using Supabase Storage transform API
        // This resizes and compresses on-the-fly
        const { data: transformedData, error: transformError } = await supabase.storage
          .from("checklist-images")
          .download(file.path, {
            transform: {
              width: 1200,
              quality: 75,
              format: "origin", // Keep format but apply quality
            },
          });

        if (transformError || !transformedData) {
          // If transform not available, download raw and we'll skip
          console.log(`[CLEANUP] Transform not available for ${file.path}, trying raw download`);
          
          const { data: rawData, error: rawError } = await supabase.storage
            .from("checklist-images")
            .download(file.path);

          if (rawError || !rawData) {
            results.push({
              file: file.path,
              originalSize: file.size,
              status: `download_failed: ${transformError?.message || rawError?.message}`,
            });
            continue;
          }

          // For raw downloads, we can't compress server-side without proper libs
          // Mark as needing client-side processing
          results.push({
            file: file.path,
            originalSize: file.size,
            status: "needs_manual_reupload",
          });
          continue;
        }

        const newSize = transformedData.size;
        const savings = ((file.size - newSize) / file.size * 100);

        // Only replace if we saved at least 20%
        if (savings < 20) {
          results.push({
            file: file.path,
            originalSize: file.size,
            newSize,
            savingsPercent: Math.round(savings),
            status: "skipped_already_optimized",
          });
          continue;
        }

        // Delete old file
        await supabase.storage.from("checklist-images").remove([file.path]);

        // Upload compressed version (convert to .jpg if needed)
        const newPath = file.path.replace(/\.(png|jpeg|jpg)$/i, ".jpg");
        const { error: uploadError } = await supabase.storage
          .from("checklist-images")
          .upload(newPath, transformedData, {
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

        // Update database reference if path changed
        if (newPath !== file.path) {
          const oldUrl = `${supabaseUrl}/storage/v1/object/public/checklist-images/${file.path}`;
          const newUrl = `${supabaseUrl}/storage/v1/object/public/checklist-images/${newPath}`;
          
          await supabase
            .from("checklist_responses")
            .update({ response_image_url: newUrl })
            .eq("response_image_url", oldUrl);
        }

        totalSaved += file.size - newSize;

        results.push({
          file: file.path,
          originalSize: file.size,
          newSize,
          savingsPercent: Math.round(savings),
          status: "compressed",
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
      skippedCount: results.filter(r => r.status === "skipped_already_optimized").length,
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
