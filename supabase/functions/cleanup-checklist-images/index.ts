import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * Cleanup function to compress existing checklist images
 * Supports both counting and processing modes
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
    let mode = "process"; // "count" or "process"
    let dryRun = true;
    let limit = 10;
    let minSizeKb = 500;

    try {
      const body = await req.json();
      mode = body.mode || "process";
      dryRun = body.dryRun !== false;
      limit = Math.min(body.limit || 10, 50);
      minSizeKb = body.minSizeKb || 500;
    } catch {
      // Use defaults
    }

    console.log(`[CLEANUP] Mode: ${mode}, dryRun: ${dryRun}, limit: ${limit}, minSizeKb: ${minSizeKb}`);

    // Collect all files from all folders
    const allFiles: { path: string; size: number }[] = [];
    let folderOffset = 0;
    const folderBatchSize = 100;
    
    // Paginate through all folders
    while (true) {
      const { data: folders, error: folderError } = await supabase.storage
        .from("checklist-images")
        .list("", { limit: folderBatchSize, offset: folderOffset });

      if (folderError || !folders || folders.length === 0) break;

      for (const folder of folders) {
        // Skip if it's a file (has metadata)
        if (folder.metadata) continue;
        
        // List files in this folder
        let fileOffset = 0;
        while (true) {
          const { data: files, error: fileError } = await supabase.storage
            .from("checklist-images")
            .list(folder.name, { limit: 1000, offset: fileOffset });

          if (fileError || !files || files.length === 0) break;

          for (const file of files) {
            if (file.metadata) {
              const size = (file.metadata as any).size || 0;
              const mimetype = (file.metadata as any).mimetype || "";
              if (mimetype.startsWith("image/")) {
                allFiles.push({
                  path: `${folder.name}/${file.name}`,
                  size,
                });
              }
            }
          }

          if (files.length < 1000) break;
          fileOffset += 1000;
        }
      }

      if (folders.length < folderBatchSize) break;
      folderOffset += folderBatchSize;
    }

    console.log(`[CLEANUP] Found ${allFiles.length} total image files`);

    // COUNT MODE - just return statistics
    if (mode === "count") {
      const thresholds = [500, 600, 700, 1000, 2000, 3000];
      const counts: Record<string, number> = {};
      const totalSizes: Record<string, number> = {};
      
      for (const threshold of thresholds) {
        const matching = allFiles.filter(f => f.size > threshold * 1024);
        counts[`>${threshold}KB`] = matching.length;
        totalSizes[`>${threshold}KB_MB`] = Math.round(matching.reduce((sum, f) => sum + f.size, 0) / 1024 / 1024);
      }

      // Size distribution
      const distribution = {
        "0-100KB": allFiles.filter(f => f.size <= 100 * 1024).length,
        "100-300KB": allFiles.filter(f => f.size > 100 * 1024 && f.size <= 300 * 1024).length,
        "300-500KB": allFiles.filter(f => f.size > 300 * 1024 && f.size <= 500 * 1024).length,
        "500KB-1MB": allFiles.filter(f => f.size > 500 * 1024 && f.size <= 1024 * 1024).length,
        "1-2MB": allFiles.filter(f => f.size > 1024 * 1024 && f.size <= 2048 * 1024).length,
        "2-3MB": allFiles.filter(f => f.size > 2048 * 1024 && f.size <= 3072 * 1024).length,
        ">3MB": allFiles.filter(f => f.size > 3072 * 1024).length,
      };

      const totalStorageMB = Math.round(allFiles.reduce((sum, f) => sum + f.size, 0) / 1024 / 1024);

      return new Response(
        JSON.stringify({ 
          totalFiles: allFiles.length,
          totalStorageMB,
          counts,
          totalSizes,
          distribution,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // PROCESS MODE - compress files
    // Filter and sort by size descending
    let filesToProcess = allFiles
      .filter(f => f.size > minSizeKb * 1024)
      .sort((a, b) => b.size - a.size)
      .slice(0, limit);

    console.log(`[CLEANUP] Processing ${filesToProcess.length} files over ${minSizeKb}KB`);

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
        const { data: transformedData, error: transformError } = await supabase.storage
          .from("checklist-images")
          .download(file.path, {
            transform: {
              width: 1200,
              quality: 75,
              format: "origin",
            },
          });

        if (transformError || !transformedData) {
          results.push({
            file: file.path,
            originalSize: file.size,
            status: `transform_failed: ${transformError?.message}`,
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

        // Upload compressed version
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
      errorCount: results.filter(r => r.status.startsWith("error") || r.status.includes("failed")).length,
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
