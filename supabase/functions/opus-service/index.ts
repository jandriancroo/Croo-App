// @ts-nocheck
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;
const AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const OPUS_GRAPHQL = "https://api.opus.so/graphql";

/** Generate a 768-dim embedding via Lovable AI tool-calling */
async function generateEmbedding(text: string): Promise<number[] | null> {
  try {
    const resp = await fetch(AI_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash-lite",
        messages: [
          { role: "system", content: "You are an embedding generator." },
          { role: "user", content: `Generate a 768-dimensional embedding vector for: "${text.substring(0, 500)}". Return ONLY the raw JSON array of 768 floats.` },
        ],
        tools: [{
          type: "function",
          function: {
            name: "store_embedding",
            description: "Store a 768-dimensional embedding vector",
            parameters: { type: "object", properties: { embedding: { type: "array", items: { type: "number" } } }, required: ["embedding"], additionalProperties: false },
          },
        }],
        tool_choice: { type: "function", function: { name: "store_embedding" } },
      }),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    const args = JSON.parse(data.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments || "{}");
    return Array.isArray(args.embedding) && args.embedding.length === 768 ? args.embedding : null;
  } catch { return null; }
}

const OPUS_HEADERS = (sessionId: string) => ({
  "Content-Type": "application/json",
  "Cookie": `sessionid=${sessionId}`,
  "Origin": "https://dashboard.opus.so",
  "Referer": "https://dashboard.opus.so/",
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.5 Safari/605.1.15",
  "x-opus-role": "admin",
  "Accept": "*/*",
  "Accept-Language": "en-US,en;q=0.9",
  "Sec-Fetch-Dest": "empty",
  "Sec-Fetch-Mode": "cors",
  "Sec-Fetch-Site": "same-site",
  "x-dashboard-url": "https://dashboard.opus.so/library/modules?org=1491-Blaze+Pizza",
});

/** Helper: get OPUS session from location_integrations */
async function getOpusSession(supabase: any, locationId: string) {
  const { data: integration, error } = await supabase
    .from("location_integrations")
    .select("credentials")
    .eq("location_id", locationId)
    .eq("integration_type", "opus")
    .eq("is_active", true)
    .maybeSingle();

  if (error || !integration) return null;
  return (integration.credentials as any)?.sessionid || null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Auth check — REQUIRED. Either the service role key (server-to-server)
    // or a valid, signature-verified end-user token.
    const authHeader = req.headers.get("Authorization");
    const token = authHeader?.replace(/^Bearer\s+/i, "").trim();
    let userId: string | null = null;

    if (!token) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (token !== SUPABASE_SERVICE_ROLE_KEY) {
      const { data: { user }, error } = await supabase.auth.getUser(token);
      if (error || !user) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      userId = user.id;
    }


    const body = await req.json();
    const action = body.action;

    // ── ACTION: sync_training ──
    // Fetches incomplete assignment counts per mapped employee and creates aggregated Quick Tasks
    if (action === "sync_training") {
      const { location_id } = body;
      if (!location_id) {
        return new Response(JSON.stringify({ error: "Missing location_id" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const sessionId = await getOpusSession(supabase, location_id);
      if (!sessionId) {
        return new Response(JSON.stringify({ error: "OPUS integration not configured" }), {
          status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Get OPUS employee mappings from credentials
      const { data: integration } = await supabase
        .from("location_integrations")
        .select("credentials")
        .eq("location_id", location_id)
        .eq("integration_type", "opus")
        .eq("is_active", true)
        .maybeSingle();

      const creds = integration?.credentials as any;
      const employeeMappings: Array<{ opus_id: number; croo_user_id: string; name: string }> = creds?.employee_mappings || [];

      if (employeeMappings.length === 0) {
        return new Response(JSON.stringify({ 
          error: "No employee mappings configured. Add employee_mappings to OPUS integration credentials.",
          hint: "Format: [{opus_id: 1541347, croo_user_id: 'uuid', name: 'John Doe'}, ...]"
        }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      let syncedCount = 0;
      let tasksCreated = 0;
      let tasksResolved = 0;
      const errors: string[] = [];

      for (const mapping of employeeMappings) {
        const { opus_id, croo_user_id, name: empName } = mapping;
        
        // Fetch ALL assignments (no status filter) to get assigned vs completed ratio
        const assignmentsQuery = {
          operationName: "UserDetailAssignments",
          variables: {
            input: {
              filters: {
                accessTypes: { value: ["ASSIGNMENT"] },
                contentTypes: { value: ["COURSE", "PATH"] },
                userId: { value: opus_id },
              },
              sort: { column: "currentInstanceLastAssignedAt", descending: false },
            },
            pagination: { limit: 200, offset: 0 },
          },
          query: `query UserDetailAssignments($input: AssignmentsInput!, $pagination: PaginationInput) {
  Assignments(input: $input, pagination: $pagination) {
    totalCount
    objects {
      id
      status
      isCurrentInstanceAssignedThroughModule
      libraryItem {
        id
        type
        name { en __typename }
        coverImage {
          id
          imageUrls { thumb __typename }
          __typename
        }
        __typename
      }
      __typename
    }
    __typename
  }
}`,
        };

        const resp = await fetch(OPUS_GRAPHQL, {
          method: "POST",
          headers: OPUS_HEADERS(sessionId),
          body: JSON.stringify(assignmentsQuery),
        });
        const respData = await resp.json();
        console.log(`[opus-service] UserDetailAssignments for ${empName} (opus_id=${opus_id}): status=${resp.status} totalCount=${respData?.data?.Assignments?.totalCount ?? 'null'}`);

        if (!resp.ok || !respData?.data?.Assignments) {
          errors.push(`${empName}: Assignment query failed (${resp.status})`);
          continue;
        }

        // Use ALL assignments (including through-module) to match OPUS's Assigned vs Completed counts
        const allAssignments = respData.data.Assignments.objects || [];
        const assignedCount = allAssignments.length;
        const completedAssignments = allAssignments.filter((a: any) => a.status === "complete" || a.status === "completed" || a.status === "COMPLETED");
        const incompleteAssignments = allAssignments.filter((a: any) => a.status !== "complete" && a.status !== "completed" && a.status !== "COMPLETED");
        const completedCount = completedAssignments.length;
        const incompleteCount = incompleteAssignments.length;
        // Only show top-level incomplete names (not sub-modules)
        const incompleteNames: string[] = incompleteAssignments
          .filter((a: any) => !a.isCurrentInstanceAssignedThroughModule)
          .map((a: any) => a.libraryItem?.name?.en || "Untitled")
          .slice(0, 8);

        syncedCount++;

        // Upsert a summary record in opus_training_modules
        const { data: upserted, error: upsertErr } = await supabase
          .from("opus_training_modules")
          .upsert({
            location_id: location_id,
            opus_employee_name: empName,
            user_id: croo_user_id,
            module_name: `Training: ${completedCount}/${assignedCount} Completed`,
            completion_pct: assignedCount > 0 ? Math.round((completedCount / assignedCount) * 100) : 100,
            opus_module_id: `summary_${opus_id}`,
            last_synced_at: new Date().toISOString(),
          }, {
            onConflict: "location_id,opus_module_id,user_id",
          })
          .select("id, task_id, completion_pct")
          .single();

        if (upsertErr) {
          console.error("[opus-service] Upsert error:", upsertErr);
          errors.push(`${empName}: DB upsert failed`);
          continue;
        }

        // Build task description with module names
        const moduleList = incompleteNames.length > 0
          ? incompleteNames.map((n: string) => `• ${n}`).join("\n") + (incompleteCount > 8 ? `\n• ...and ${incompleteCount - 8} more` : "")
          : "";
        const taskTitle = `OPUS: ${completedCount}/${assignedCount} Modules Completed`;
        const taskDescription = incompleteCount > 0
          ? `${incompleteCount} remaining:\n${moduleList}`
          : "All training modules complete! 🎉";

        // Auto-create/resolve aggregated Quick Task
        if (incompleteCount > 0) {
          if (!upserted.task_id) {
            const { data: task, error: taskErr } = await supabase
              .from("temporary_tasks")
              .insert({
                location_id: location_id,
                title: taskTitle,
                description: taskDescription,
                icon_name: "opus_logo",
                accent_color: "#1A5C5C",
                is_active: true,
                show_on_dashboard: true,
                task_style: "default",
                created_by: croo_user_id,
              })
              .select("id")
              .single();

            if (!taskErr && task) {
              await supabase.from("temporary_task_assignments").insert({
                task_id: task.id,
                user_id: croo_user_id,
              });
              await supabase.from("opus_training_modules").update({ task_id: task.id }).eq("id", upserted.id);
              tasksCreated++;
            }
          } else {
            // Update existing task with current progress
            await supabase
              .from("temporary_tasks")
              .update({
                title: taskTitle,
                description: taskDescription,
                icon_name: "opus_logo",
                accent_color: "#1A5C5C",
              })
              .eq("id", upserted.task_id);
          }
        } else if (incompleteCount === 0 && upserted.task_id) {
          // All complete — auto-resolve the task
          await supabase
            .from("temporary_tasks")
            .update({
              completed_at: new Date().toISOString(),
              completed_by: croo_user_id,
              is_active: false,
            })
            .eq("id", upserted.task_id);
          tasksResolved++;
        }
      }

      return new Response(JSON.stringify({
        success: true,
        employees_synced: syncedCount,
        tasks_created: tasksCreated,
        tasks_resolved: tasksResolved,
        errors: errors.length > 0 ? errors : undefined,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── ACTION: test_connection ──
    if (action === "test_connection") {
      const { sessionid } = body;
      if (!sessionid) {
        return new Response(JSON.stringify({ error: "Missing sessionid" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const headers = OPUS_HEADERS(sessionid);

      // Quick auth check via AdminEmployee
      const testEmployee = {
        operationName: "TestEmployee",
        query: `query TestEmployee { AdminEmployee(id: 1541347) { id name firstName lastName __typename } }`,
      };
      const empResp = await fetch(OPUS_GRAPHQL, { method: "POST", headers, body: JSON.stringify(testEmployee) });
      const empData = await empResp.json();
      const authenticated = !!empData?.data?.AdminEmployee?.id;

      // Quick library check
      const libQuery = {
        operationName: "GetAdminLibrary",
        variables: { input: {}, pagination: { limit: 1, offset: 0 } },
        query: `query GetAdminLibrary($input: AdminLibraryInput!, $pagination: PaginationInput) { AdminLibrary(input: $input, pagination: $pagination) { objects { id name { en __typename } __typename } __typename } }`,
      };
      const libResp = await fetch(OPUS_GRAPHQL, { method: "POST", headers, body: JSON.stringify(libQuery) });
      const libData = await libResp.json();
      const libraryOk = !!libData?.data?.AdminLibrary?.objects;

      console.log("[opus-service] test_connection: employee=", JSON.stringify(empData));

      return new Response(JSON.stringify({
        authenticated,
        employee: empData?.data?.AdminEmployee || null,
        library_ok: libraryOk,
      }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── ACTION: proxy_file ──
    // Streams an OPUS file through our backend to avoid 401 for frontline users
    if (action === "proxy_file") {
      const { location_id, file_url } = body;
      if (!location_id || !file_url) {
        return new Response(JSON.stringify({ error: "Missing location_id or file_url" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const sessionId = await getOpusSession(supabase, location_id);
      if (!sessionId) {
        return new Response(JSON.stringify({ error: "OPUS session not configured" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const fileResp = await fetch(file_url, {
        headers: { 
          "Cookie": `sessionid=${sessionId}`,
          "Origin": "https://dashboard.opus.so",
          "Referer": "https://dashboard.opus.so/",
        },
      });

      if (!fileResp.ok) {
        return new Response(JSON.stringify({ error: "Failed to fetch file from OPUS" }), {
          status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const contentType = fileResp.headers.get("content-type") || "application/octet-stream";
      const fileBody = await fileResp.arrayBuffer();

      return new Response(fileBody, {
        headers: {
          ...corsHeaders,
          "Content-Type": contentType,
          "Cache-Control": "private, max-age=3600",
        },
      });
    }

    // ── ACTION: fetch_library ──
    // Fetches OPUS LibraryItems (training modules catalog) and injects into Theo knowledge
    if (action === "fetch_library") {
      const { location_id } = body;
      if (!location_id) {
        return new Response(JSON.stringify({ error: "Missing location_id" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const sessionId = await getOpusSession(supabase, location_id);
      if (!sessionId) {
        return new Response(JSON.stringify({ error: "OPUS session not configured" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Exact OPUS query — confirmed from network tab
      const libraryQuery = {
        operationName: "ResourcesLibraryPaginatedTable_LibraryItems",
        variables: {
          input: {
            filters: { itemType: { value: "TRAINING_RESOURCE" }, tagIds: null },
            sort: { column: "lastEdited", descending: true, nullsLast: true },
          },
          pagination: { limit: 500, offset: 0 },
        },
        query: `query ResourcesLibraryPaginatedTable_LibraryItems($input: AdminLibraryInput!, $pagination: PaginationInput) {
  AdminLibrary(input: $input, pagination: $pagination) {
    totalCount
    objects {
      id
      name { en __typename }
      description { en __typename }
      createdAt
      lastEditedAt
      publishState
      trainingResource {
        id
        publishedVersion {
          id
          type
          media {
            id
            mediaUrls { en __typename }
            thumbnailImageUrl
            __typename
          }
          __typename
        }
        __typename
      }
      contentTagMemberships {
        tag { nameTranslations { en __typename } __typename }
        __typename
      }
      __typename
    }
    __typename
  }
}`,
      };

      const resp = await fetch(OPUS_GRAPHQL, {
        method: "POST",
        headers: OPUS_HEADERS(sessionId),
        body: JSON.stringify(libraryQuery),
      });

      if (!resp.ok) {
        const errText = await resp.text();
        console.error("[opus-service] LibraryItems fetch failed:", resp.status, errText);
        return new Response(JSON.stringify({ 
          error: "OPUS library fetch failed",
          hint: resp.status === 401 ? "Session expired" : undefined,
        }), {
          status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const data = await resp.json();
      const objects = data?.data?.AdminLibrary?.objects || [];

      // Get all existing OPUS resources in one query
      const { data: existingRows } = await supabase
        .from("theo_knowledge")
        .select("content")
        .eq("location_id", location_id)
        .eq("topic", "opus_training_resource")
        .limit(1000);
      const existingNames = new Set(
        (existingRows || []).map((r: any) => {
          const match = r.content?.match(/\[OPUS Training Resource\] (.+)/);
          return match?.[1] || "";
        }).filter(Boolean)
      );

      // Build batch of new resources
      const toInsert: any[] = [];
      for (const item of objects) {
        const moduleName = item.name?.en || "Untitled Resource";
        if (existingNames.has(moduleName)) continue;

        const mediaUrl = item.trainingResource?.publishedVersion?.media?.mediaUrls?.en || "";
        const resourceType = item.trainingResource?.publishedVersion?.type || "";
        const description = item.description?.en || "";
        const tags = (item.contentTagMemberships || [])
          .map((t: any) => t.tag?.nameTranslations?.en)
          .filter(Boolean)
          .join(", ");

        const contentParts = [
          "[OPUS Training Resource] " + moduleName,
          description ? "Description: " + description : "",
          "",
          resourceType ? "Resource Type: " + resourceType : "",
          "OPUS ID: " + item.id,
          "Published: " + (item.publishState || "UNKNOWN"),
          tags ? "Tags: " + tags : "",
          mediaUrl ? "Media URL: " + mediaUrl : "",
          "",
          "Source: OPUS LMS (Resources Library)",
          mediaUrl ? "Content has not been extracted yet. Use fetch_resource_content to parse this document." : "",
        ];

        toInsert.push({
          location_id,
          topic: "opus_training_resource",
          content: contentParts.filter(Boolean).join("\n"),
          created_by: userId,
        });
      }

      // Batch insert in chunks of 50
      let injected = existingNames.size;
      const insertedKnowledgeIds: { title: string; opus_id: string; resource_type: string; theo_knowledge_id?: string }[] = [];
      for (let i = 0; i < toInsert.length; i += 50) {
        const chunk = toInsert.slice(i, i + 50);
        const { data: inserted, error } = await supabase.from("theo_knowledge").insert(chunk).select("id, content");
        if (!error && inserted) {
          injected += inserted.length;
          // Extract metadata for index
          for (const row of inserted) {
            const titleMatch = row.content.match(/\[OPUS Training (?:Resource|Module)\] (.+)/);
            const opusIdMatch = row.content.match(/OPUS ID: ([a-f0-9-]+)/);
            const typeMatch = row.content.match(/Resource Type: (.+)/);
            if (titleMatch && opusIdMatch) {
              insertedKnowledgeIds.push({
                title: titleMatch[1].trim(),
                opus_id: opusIdMatch[1],
                resource_type: typeMatch?.[1]?.trim() || 'TRAINING_RESOURCE',
                theo_knowledge_id: row.id,
              });
            }
          }
        }
      }

      // Populate opus_resource_index for fast title search
      if (insertedKnowledgeIds.length > 0) {
        const indexRows = insertedKnowledgeIds.map(r => ({
          location_id,
          title: r.title,
          resource_type: r.resource_type,
          opus_id: r.opus_id,
          theo_knowledge_id: r.theo_knowledge_id,
        }));
        for (let i = 0; i < indexRows.length; i += 50) {
          await supabase.from("opus_resource_index").upsert(indexRows.slice(i, i + 50), { onConflict: "location_id,opus_id" });
        }
      }

      return new Response(JSON.stringify({
        success: true,
        total_in_opus: objects.length,
        injected_to_theo: injected,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── ACTION: fetch_resource_content ──
    // Downloads a specific OPUS resource PDF and extracts content via AI
    if (action === "fetch_resource_content") {
      const { location_id, resource_name } = body;
      if (!location_id || !resource_name) {
        return new Response(JSON.stringify({ error: "Missing location_id or resource_name" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Find the resource in theo_knowledge — first try current location, then brand-wide fallback
      let knowledgeRows: any[] | null = null;

      // Step 1: Search current location
      const { data: localRows } = await supabase
        .from("theo_knowledge")
        .select("id, content, topic")
        .eq("location_id", location_id)
        .ilike("topic", "opus_training_%")
        .ilike("content", "%" + resource_name + "%")
        .limit(5);

      knowledgeRows = localRows;

      // Step 2: Brand-wide fallback — OPUS resources are shared across locations
      if (!knowledgeRows || knowledgeRows.length === 0) {
        console.log("[opus-service] Resource not found at location " + location_id + ", trying brand-wide search...");
        // Get all location IDs across the same brand (may span multiple orgs)
        const { data: loc } = await supabase
          .from("locations")
          .select("organization_id")
          .eq("id", location_id)
          .single();
        if (loc) {
          const { data: org } = await supabase
            .from("organizations")
            .select("brand_id")
            .eq("id", loc.organization_id)
            .single();
          if (org?.brand_id) {
            const { data: brandOrgs } = await supabase
              .from("organizations")
              .select("id")
              .eq("brand_id", org.brand_id);
            if (brandOrgs && brandOrgs.length > 0) {
              const { data: brandLocs } = await supabase
                .from("locations")
                .select("id")
                .in("organization_id", brandOrgs.map((o: any) => o.id));
              if (brandLocs && brandLocs.length > 0) {
                const brandLocIds = brandLocs.map((l: any) => l.id);
                const { data: brandRows } = await supabase
                  .from("theo_knowledge")
                  .select("id, content, topic")
                  .in("location_id", brandLocIds)
                  .ilike("topic", "opus_training_%")
                  .ilike("content", "%" + resource_name + "%")
                  .limit(5);
                knowledgeRows = brandRows;
              }
            }
          }
        }
      }

      if (!knowledgeRows || knowledgeRows.length === 0) {
        return new Response(JSON.stringify({ error: "Resource not found in knowledge base", resource_name }), {
          status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Check if already has extracted content
      const row = knowledgeRows[0];
      if (row.content.includes("[EXTRACTED CONTENT]")) {
        return new Response(JSON.stringify({
          success: true,
          already_extracted: true,
          content: row.content,
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Extract Media URL from the content
      const mediaUrlMatch = row.content.match(/Media URL: (https:\/\/[^\n]+)/);
      if (!mediaUrlMatch) {
        return new Response(JSON.stringify({ error: "No media URL found for this resource" }), {
          status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const pdfUrl = mediaUrlMatch[1].trim();
      console.log("[opus-service] Downloading PDF from: " + pdfUrl);

      // Actually download the PDF file first — include OPUS session cookie + stealth headers,
      // otherwise protected media URLs return an HTML login redirect instead of the file.
      let pdfBase64: string;
      let mimeType = "application/pdf";
      try {
        const pdfResp = await fetch(pdfUrl, {
          headers: {
            "Cookie": `sessionid=${sessionId}`,
            "Origin": "https://dashboard.opus.so",
            "Referer": "https://dashboard.opus.so/",
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          },
        });
        if (!pdfResp.ok) {
          console.error("[opus-service] PDF download failed:", pdfResp.status);
          return new Response(JSON.stringify({ error: "Failed to download resource file", status: pdfResp.status }), {
            status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        const contentType = pdfResp.headers.get("content-type") || "";
        if (contentType.includes("image")) {
          mimeType = contentType.split(";")[0].trim();
        } else if (contentType.includes("pdf")) {
          mimeType = "application/pdf";
        } else if (contentType.includes("html") || contentType.includes("text")) {
          // OPUS returned a login/HTML page — session likely expired
          console.error("[opus-service] PDF download returned HTML, session may be expired:", contentType);
          return new Response(JSON.stringify({ error: "OPUS session expired or media URL not authorized — please reconnect OPUS in integrations" }), {
            status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        const arrayBuf = await pdfResp.arrayBuffer();
        // Convert to base64
        const bytes = new Uint8Array(arrayBuf);
        let binary = "";
        for (let i = 0; i < bytes.length; i++) {
          binary += String.fromCharCode(bytes[i]);
        }
        pdfBase64 = btoa(binary);
        console.log(`[opus-service] Downloaded ${bytes.length} bytes, mime: ${mimeType}`);
      } catch (dlErr) {
        console.error("[opus-service] PDF download error:", dlErr);
        return new Response(JSON.stringify({ error: "Failed to download resource file" }), {
          status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Send the actual file bytes to Gemini for extraction
      try {
        const aiResp = await fetch(AI_URL, {
          method: "POST",
          headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "google/gemini-2.5-flash",
            messages: [
              {
                role: "system",
                content: "You are a document content extractor. Extract ALL text content EXACTLY as written in the provided document. Do NOT add, infer, or make up any content. Only output what is literally in the document. Preserve structure, headings, bullet points, measurements, and steps exactly as they appear. If you cannot read the document, say 'EXTRACTION FAILED: unable to read document'.",
              },
              {
                role: "user",
                content: [
                  {
                    type: "text",
                    text: "Extract the EXACT text content from this training document. Do NOT make anything up — only include text that is literally visible in the document. Document title: " + resource_name,
                  },
                  {
                    type: "image_url",
                    image_url: {
                      url: `data:${mimeType};base64,${pdfBase64}`,
                    },
                  },
                ],
              },
            ],
          }),
        });

        if (!aiResp.ok) {
          const errText = await aiResp.text();
          console.error("[opus-service] AI extraction failed:", aiResp.status, errText);
          return new Response(JSON.stringify({ error: "AI content extraction failed", status: aiResp.status }), {
            status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const aiData = await aiResp.json();
        const extractedContent = aiData.choices?.[0]?.message?.content || "";

        if (!extractedContent || extractedContent.length < 50) {
          return new Response(JSON.stringify({ error: "Extraction returned insufficient content" }), {
            status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        // Update theo_knowledge with extracted content
        const updatedContent = row.content.replace(
          /Content has not been extracted yet\..*/,
          "[EXTRACTED CONTENT]\n" + extractedContent
        );

        // Generate new embedding with actual content
        const embedding = await generateEmbedding(resource_name + " - " + extractedContent.substring(0, 400));

        const updateData: any = { content: updatedContent };
        if (embedding) updateData.embedding = JSON.stringify(embedding);

        await supabase.from("theo_knowledge").update(updateData).eq("id", row.id);

        return new Response(JSON.stringify({
          success: true,
          resource_name,
          content_length: extractedContent.length,
          has_embedding: !!embedding,
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } catch (e: any) {
        console.error("[opus-service] PDF extraction error:", e);
        return new Response(JSON.stringify({ error: e.message }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // ── ACTION: bulk_extract ──
    // Extract text from all un-extracted OPUS resources in batches
    if (action === "bulk_extract") {
      const { location_id, batch_size = 5 } = body;
      if (!location_id) {
        return new Response(JSON.stringify({ error: "Missing location_id" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Find all theo_knowledge entries with Media URL but no extracted content
      const { data: pending, error: pendingErr } = await supabase
        .from("theo_knowledge")
        .select("id, content, topic")
        .eq("location_id", location_id)
        .ilike("topic", "opus_training_%")
        .ilike("content", "%Media URL:%")
        .not("content", "ilike", "%[EXTRACTED CONTENT]%")
        .not("content", "ilike", "%EXTRACTION FAILED%")
        .limit(Math.min(batch_size, 10)); // cap at 10 per invocation to avoid timeout

      if (pendingErr) {
        console.error("[opus-service] bulk_extract query error:", pendingErr);
        return new Response(JSON.stringify({ error: pendingErr.message }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (!pending || pending.length === 0) {
        return new Response(JSON.stringify({ 
          success: true, 
          message: "All resources already extracted", 
          processed: 0, 
          remaining: 0 
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Count total remaining
      const { count: totalRemaining } = await supabase
        .from("theo_knowledge")
        .select("id", { count: "exact", head: true })
        .eq("location_id", location_id)
        .ilike("topic", "opus_training_%")
        .ilike("content", "%Media URL:%")
        .not("content", "ilike", "%[EXTRACTED CONTENT]%")
        .not("content", "ilike", "%EXTRACTION FAILED%");

      const results: { id: string; title: string; success: boolean; error?: string; content_length?: number }[] = [];

      for (const row of pending) {
        // Extract title from content
        const titleMatch = row.content.match(/Title: ([^\n]+)/);
        const title = titleMatch ? titleMatch[1].trim() : "Unknown";

        // Extract Media URL
        const mediaUrlMatch = row.content.match(/Media URL: (https:\/\/[^\n]+)/);
        if (!mediaUrlMatch) {
          results.push({ id: row.id, title, success: false, error: "No media URL" });
          continue;
        }

        const pdfUrl = mediaUrlMatch[1].trim();
        console.log(`[opus-service] bulk_extract: Processing "${title}" from ${pdfUrl}`);

        try {
          // Download the file (with OPUS session cookie — protected media URLs require it)
          const pdfResp = await fetch(pdfUrl, {
            headers: {
              "Cookie": `sessionid=${sessionId}`,
              "Origin": "https://dashboard.opus.so",
              "Referer": "https://dashboard.opus.so/",
              "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            },
          });
          if (!pdfResp.ok) {
            results.push({ id: row.id, title, success: false, error: `Download failed: ${pdfResp.status}` });
            continue;
          }

          const contentType = pdfResp.headers.get("content-type") || "";
          let mimeType = "application/pdf";
          if (contentType.includes("image")) {
            mimeType = contentType.split(";")[0].trim();
          } else if (contentType.includes("html") || contentType.includes("text")) {
            results.push({ id: row.id, title, success: false, error: "OPUS session expired (got HTML, not file)" });
            continue;
          }

          const arrayBuf = await pdfResp.arrayBuffer();
          const bytes = new Uint8Array(arrayBuf);
          
          // Skip very large files (>10MB) to avoid timeout
          if (bytes.length > 10 * 1024 * 1024) {
            results.push({ id: row.id, title, success: false, error: "File too large (>10MB)" });
            continue;
          }

          let binary = "";
          for (let i = 0; i < bytes.length; i++) {
            binary += String.fromCharCode(bytes[i]);
          }
          const pdfBase64 = btoa(binary);

          // Extract content via Gemini
          const aiResp = await fetch(AI_URL, {
            method: "POST",
            headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              model: "google/gemini-2.5-flash",
              messages: [
                {
                  role: "system",
                  content: "You are a document content extractor. Extract ALL text content EXACTLY as written. Do NOT add, infer, or make up any content. Preserve structure, headings, bullet points, measurements, and steps exactly.",
                },
                {
                  role: "user",
                  content: [
                    { type: "text", text: "Extract the EXACT text content from this document. Title: " + title },
                    { type: "image_url", image_url: { url: `data:${mimeType};base64,${pdfBase64}` } },
                  ],
                },
              ],
            }),
          });

          if (!aiResp.ok) {
            const errText = await aiResp.text();
            console.error(`[opus-service] bulk_extract AI error for "${title}":`, aiResp.status);
            results.push({ id: row.id, title, success: false, error: `AI error: ${aiResp.status}` });
            continue;
          }

          const aiData = await aiResp.json();
          const extractedContent = aiData.choices?.[0]?.message?.content || "";

          if (!extractedContent || extractedContent.length < 30) {
            // Mark as failed so we don't retry forever
            const failContent = row.content.replace(
              /Content has not been extracted yet\..*/,
              "EXTRACTION FAILED: insufficient content returned"
            );
            await supabase.from("theo_knowledge").update({ content: failContent }).eq("id", row.id);
            results.push({ id: row.id, title, success: false, error: "Extraction returned too little content" });
            continue;
          }

          // Update with extracted content
          const updatedContent = row.content.replace(
            /Content has not been extracted yet\..*/,
            "[EXTRACTED CONTENT]\n" + extractedContent
          );

          // Generate embedding with actual content
          const embedding = await generateEmbedding(title + " - " + extractedContent.substring(0, 400));
          const updateData: any = { content: updatedContent };
          if (embedding) updateData.embedding = JSON.stringify(embedding);

          await supabase.from("theo_knowledge").update(updateData).eq("id", row.id);
          results.push({ id: row.id, title, success: true, content_length: extractedContent.length });
          console.log(`[opus-service] bulk_extract: ✅ "${title}" — ${extractedContent.length} chars`);

        } catch (e: any) {
          console.error(`[opus-service] bulk_extract error for "${title}":`, e);
          results.push({ id: row.id, title, success: false, error: e.message });
        }
      }

      const succeeded = results.filter(r => r.success).length;
      const failed = results.filter(r => !r.success).length;

      return new Response(JSON.stringify({
        success: true,
        processed: results.length,
        succeeded,
        failed,
        remaining: (totalRemaining || 0) - succeeded,
        results,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── ACTION: fetch_employees ──
    // Single lookup by OPUS ID OR auto-discover all employees
    if (action === "fetch_employees") {
      const { location_id, opus_id } = body;
      if (!location_id) {
        return new Response(JSON.stringify({ error: "Missing location_id" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const sessionId = await getOpusSession(supabase, location_id);
      if (!sessionId) {
        return new Response(JSON.stringify({ error: "OPUS session not configured" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // If opus_id provided, do single lookup
      if (opus_id) {
        const empQuery = {
          operationName: "LookupEmployee",
          query: `query LookupEmployee { AdminEmployee(id: ${Number(opus_id)}) { id name firstName lastName __typename } }`,
        };
        const resp = await fetch(OPUS_GRAPHQL, {
          method: "POST",
          headers: OPUS_HEADERS(sessionId),
          body: JSON.stringify(empQuery),
        });
        const data = await resp.json();
        const emp = data?.data?.AdminEmployee;
        return new Response(JSON.stringify({
          success: !!emp,
          employee: emp ? { opus_id: emp.id, name: emp.name, firstName: emp.firstName, lastName: emp.lastName } : null,
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Auto-discover: try multiple known query patterns for bulk employee list
      const queries = [
        {
          name: "AdminEmployees_v1",
          body: {
            operationName: "GetAdminEmployees",
            variables: { input: { pagination: { page: 1, pageSize: 200 } } },
            query: `query GetAdminEmployees($input: AdminEmployeesInput!) {
  AdminEmployees(input: $input) {
    totalCount
    objects { id name firstName lastName email __typename }
    __typename
  }
}`,
          },
        },
        {
          name: "AdminEmployees_v2",
          body: {
            operationName: "GetAdminEmployees",
            variables: { pagination: { page: 1, pageSize: 200 } },
            query: `query GetAdminEmployees($pagination: PaginationInput) {
  AdminEmployees(pagination: $pagination) {
    totalCount
    objects { id name firstName lastName email __typename }
    __typename
  }
}`,
          },
        },
        {
          name: "AdminEmployees_v3",
          body: {
            operationName: "GetEmployees",
            variables: { input: {} , pagination: { limit: 200, offset: 0 } },
            query: `query GetEmployees($input: AdminEmployeesInput!, $pagination: PaginationInput) {
  AdminEmployees(input: $input, pagination: $pagination) {
    totalCount
    objects { id name firstName lastName email __typename }
    __typename
  }
}`,
          },
        },
        {
          name: "Employees_simple",
          body: {
            operationName: "GetEmployees",
            query: `query GetEmployees {
  AdminEmployees {
    totalCount
    objects { id name firstName lastName email __typename }
    __typename
  }
}`,
          },
        },
      ];

      const results: any[] = [];
      for (const q of queries) {
        try {
          const resp = await fetch(OPUS_GRAPHQL, {
            method: "POST",
            headers: OPUS_HEADERS(sessionId),
            body: JSON.stringify(q.body),
          });
          const data = await resp.json();
          console.log(`[opus-service] ${q.name}: status=${resp.status} hasData=${!!data?.data?.AdminEmployees}`);
          
          const employees = data?.data?.AdminEmployees?.objects;
          if (employees && employees.length > 0) {
            return new Response(JSON.stringify({
              success: true,
              query_used: q.name,
              total: data.data.AdminEmployees.totalCount || employees.length,
              employees: employees.map((e: any) => ({
                opus_id: e.id,
                name: e.name || `${e.firstName} ${e.lastName}`.trim(),
                firstName: e.firstName,
                lastName: e.lastName,
                email: e.email,
              })),
            }), {
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }
          results.push({ query: q.name, status: resp.status, hasData: false, errors: data?.errors });
        } catch (e: any) {
          results.push({ query: q.name, error: e.message });
        }
      }

      return new Response(JSON.stringify({
        success: false,
        message: "No working employee list query found. All attempts logged.",
        attempts: results,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Unknown action" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("[opus-service] Error:", e);
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
