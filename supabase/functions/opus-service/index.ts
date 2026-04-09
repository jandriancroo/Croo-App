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

    // Auth check
    const authHeader = req.headers.get("Authorization");
    const token = authHeader?.replace("Bearer ", "");
    let userId: string | null = null;

    if (token && token !== SUPABASE_SERVICE_ROLE_KEY) {
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
        
        // Query OPUS for this employee's incomplete PATH + COURSE assignments (confirmed working schema)
        const assignmentsQuery = {
          operationName: "UserAssignments",
          query: `query UserAssignments($id: Int!) {
  pathAssignments: Assignments(
    input: {filters: {userId: {value: $id}, contentTypes: {value: [PATH]}, accessTypes: {value: [ASSIGNMENT]}}}
  ) {
    objects { id status __typename }
    __typename
  }
  courseAssignments: Assignments(
    input: {filters: {userId: {value: $id}, contentTypes: {value: [COURSE]}, accessTypes: {value: [ASSIGNMENT]}}}
  ) {
    objects { id status __typename }
    __typename
  }
}`,
          variables: { id: opus_id },
        };

        const opusResp = await fetch(OPUS_GRAPHQL, {
          method: "POST",
          headers: OPUS_HEADERS(sessionId),
          body: JSON.stringify(assignmentsQuery),
        });

        if (!opusResp.ok) {
          const errText = await opusResp.text();
          console.error(`[opus-service] Assignment fetch failed for ${empName}:`, opusResp.status, errText);
          if (opusResp.status === 401) {
            return new Response(JSON.stringify({ 
              error: "OPUS session expired", 
              hint: "Paste a fresh sessionid in OPUS integration settings" 
            }), {
              status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }
          errors.push(`${empName}: API error ${opusResp.status}`);
          continue;
        }

        const opusData = await opusResp.json();
        const pathAssignments = opusData?.data?.pathAssignments?.objects || [];
        const courseAssignments = opusData?.data?.courseAssignments?.objects || [];
        const allAssignments = [...pathAssignments, ...courseAssignments];
        
        const incompleteCount = allAssignments.filter((a: any) => a.status === "incomplete").length;
        const totalCount = allAssignments.length;
        const completedCount = totalCount - incompleteCount;

        syncedCount++;

        // Upsert a summary record in opus_training_modules
        const { data: upserted, error: upsertErr } = await supabase
          .from("opus_training_modules")
          .upsert({
            location_id: location_id,
            opus_employee_name: empName,
            user_id: croo_user_id,
            module_name: `Training Summary (${totalCount} modules)`,
            completion_pct: totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 100,
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

        // Auto-create/resolve aggregated Quick Task
        if (incompleteCount > 0) {
          if (!upserted.task_id) {
            const { data: task, error: taskErr } = await supabase
              .from("temporary_tasks")
              .insert({
                location_id: location_id,
                title: `OPUS: ${incompleteCount} Incomplete Module${incompleteCount > 1 ? 's' : ''}`,
                description: `You have ${incompleteCount} incomplete training module${incompleteCount > 1 ? 's' : ''} on OPUS. Tap GO to open OPUS and complete your training.`,
                icon_name: "GraduationCap",
                accent_color: "#8B5CF6",
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
            // Update existing task description with current count
            await supabase
              .from("temporary_tasks")
              .update({
                title: `OPUS: ${incompleteCount} Incomplete Module${incompleteCount > 1 ? 's' : ''}`,
                description: `You have ${incompleteCount} incomplete training module${incompleteCount > 1 ? 's' : ''} on OPUS. Tap GO to open OPUS and complete your training.`,
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

      // Real OPUS query — uses LibraryItems (not AdminLibrary)
      const libraryQuery = {
        operationName: "GetLibraryItems",
        variables: { input: { pagination: { page: 1, pageSize: 500 } } },
        query: `query GetLibraryItems($input: LibraryItemsInput!) {
  LibraryItems(input: $input) {
    objects {
      id
      type
      path { id __typename }
      course { id __typename }
      trainingResource {
        id
        publishedVersion {
          id
          media {
            id
            mediaUrls { en __typename }
            imageUrls { original thumb __typename }
            unoptimizedUrl
            __typename
          }
          __typename
        }
        __typename
      }
      name { en __typename }
      coverImage {
        id
        emojiIcon
        background
        imageUrls { original wide thumb __typename }
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
      const objects = data?.data?.LibraryItems?.objects || [];

      // Inject each training module into theo_knowledge WITH embeddings
      let injected = 0;
      let embeddingsGenerated = 0;
      for (const item of objects) {
        const moduleName = item.name?.en || "Untitled Module";
        const moduleType = item.type || "UNKNOWN";
        const coverUrl = item.coverImage?.imageUrls?.original || item.coverImage?.imageUrls?.thumb || "";
        const mediaUrl = item.trainingResource?.publishedVersion?.media?.mediaUrls?.en || "";

        const content = [
          `[OPUS Training Module] ${moduleName}`,
          ``,
          `Type: ${moduleType}`,
          `OPUS ID: ${item.id}`,
          coverUrl ? `Cover Image: ${coverUrl}` : "",
          item.path?.id ? `Path ID: ${item.path.id}` : "",
          item.course?.id ? `Course ID: ${item.course.id}` : "",
          mediaUrl ? `Media URL: ${mediaUrl}` : "",
          ``,
          `Source: OPUS LMS (LibraryItems)`,
          `This is a training module available in the OPUS Learning Management System.`,
        ].filter(Boolean).join("\n");

        const topic = `opus_training_${moduleType.toLowerCase()}`;
        const contentHash = content; // md5 handled by unique index

        // Check if already exists (avoid re-embedding)
        const { data: existing } = await supabase
          .from("theo_knowledge")
          .select("id, embedding")
          .eq("location_id", location_id)
          .eq("topic", topic)
          .ilike("content", `%${moduleName}%`)
          .limit(1)
          .maybeSingle();

        if (existing?.id && existing?.embedding) {
          // Already exists with embedding — skip
          injected++;
          continue;
        }

        // Generate embedding for semantic search
        const embedding = await generateEmbedding(`${moduleName} - ${moduleType} training module from OPUS LMS`);
        if (embedding) embeddingsGenerated++;

        const insertData: any = {
          location_id: location_id,
          topic: topic,
          content: content,
          created_by: userId,
        };
        if (embedding) {
          insertData.embedding = JSON.stringify(embedding);
        }

        if (existing?.id) {
          // Update existing record with embedding
          await supabase.from("theo_knowledge").update({ embedding: JSON.stringify(embedding) }).eq("id", existing.id);
        } else {
          // Insert new
          const { error } = await supabase.from("theo_knowledge").insert(insertData);
          if (!error) injected++;
        }
      }

      return new Response(JSON.stringify({
        success: true,
        total_in_opus: objects.length,
        resources_found: objects.length,
        injected_to_theo: injected,
        embeddings_generated: embeddingsGenerated,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── ACTION: fetch_employees ──
    // Fetches all employees from OPUS for mapping UI
    if (action === "fetch_employees") {
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

      // Look up a single employee by OPUS ID (AdminEmployee works confirmed)
      const { opus_id } = body;
      if (!opus_id) {
        return new Response(JSON.stringify({ error: "Missing opus_id" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

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
