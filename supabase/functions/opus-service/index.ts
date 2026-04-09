import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPUS_GRAPHQL = "https://api.opus.so/graphql";

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
    // Fetches employee training data from OPUS GraphQL and syncs to our DB
    if (action === "sync_training") {
      const { location_id } = body;
      if (!location_id) {
        return new Response(JSON.stringify({ error: "Missing location_id" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Get OPUS session from location_integrations
      const { data: integration, error: intError } = await supabase
        .from("location_integrations")
        .select("credentials")
        .eq("location_id", location_id)
        .eq("integration_type", "opus")
        .eq("is_active", true)
        .maybeSingle();

      if (intError || !integration) {
        return new Response(JSON.stringify({ error: "OPUS integration not configured" }), {
          status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const creds = integration.credentials as any;
      const sessionId = creds?.sessionid;
      if (!sessionId) {
        return new Response(JSON.stringify({ error: "No OPUS sessionid configured" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Query OPUS GraphQL for employee training progress
      const graphqlQuery = {
        query: `
          query TeamProgress {
            employees {
              edges {
                node {
                  id
                  name
                  email
                  assignedModules {
                    edges {
                      node {
                        id
                        title
                        completionPercentage
                        completed
                      }
                    }
                  }
                }
              }
            }
          }
        `,
      };

      const opusResp = await fetch(OPUS_GRAPHQL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Cookie": `sessionid=${sessionId}`,
        },
        body: JSON.stringify(graphqlQuery),
      });

      if (!opusResp.ok) {
        const errText = await opusResp.text();
        console.error("[opus-service] OPUS API error:", opusResp.status, errText);
        return new Response(JSON.stringify({ 
          error: "OPUS API request failed", 
          status: opusResp.status,
          hint: opusResp.status === 401 ? "Session expired — please paste a fresh sessionid in settings" : undefined,
        }), {
          status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const opusData = await opusResp.json();
      const employees = opusData?.data?.employees?.edges || [];

      // Get all profiles at this location for name matching
      const { data: locationProfiles } = await supabase
        .from("user_locations")
        .select("user_id, profiles:user_id(id, full_name, email)")
        .eq("location_id", location_id);

      const profilesList = (locationProfiles || []).map((lp: any) => ({
        id: lp.profiles?.id,
        name: (lp.profiles?.full_name || "").toLowerCase().trim(),
        email: (lp.profiles?.email || "").toLowerCase().trim(),
      })).filter((p: any) => p.id);

      // Match OPUS employee to Croo profile by name or email
      function matchProfile(opusName: string, opusEmail?: string) {
        const normalizedName = opusName.toLowerCase().trim();
        // Try exact name match
        let match = profilesList.find((p: any) => p.name === normalizedName);
        if (match) return match.id;
        // Try email match
        if (opusEmail) {
          match = profilesList.find((p: any) => p.email === opusEmail.toLowerCase().trim());
          if (match) return match.id;
        }
        // Try last name + first initial
        const parts = normalizedName.split(/\s+/);
        if (parts.length >= 2) {
          match = profilesList.find((p: any) => {
            const pParts = p.name.split(/\s+/);
            return pParts.length >= 2 &&
              pParts[pParts.length - 1] === parts[parts.length - 1] &&
              pParts[0][0] === parts[0][0];
          });
          if (match) return match.id;
        }
        return null;
      }

      let syncedCount = 0;
      let tasksCreated = 0;
      const unmatchedNames: string[] = [];

      for (const empEdge of employees) {
        const emp = empEdge.node;
        const matchedUserId = matchProfile(emp.name, emp.email);
        if (!matchedUserId) {
          unmatchedNames.push(emp.name);
        }

        const modules = emp.assignedModules?.edges || [];
        for (const modEdge of modules) {
          const mod = modEdge.node;
          const completionPct = mod.completionPercentage ?? (mod.completed ? 100 : 0);

          // Upsert module record
          const { data: upserted, error: upsertErr } = await supabase
            .from("opus_training_modules")
            .upsert({
              location_id: location_id,
              opus_employee_name: emp.name,
              user_id: matchedUserId,
              module_name: mod.title,
              completion_pct: completionPct,
              opus_module_id: mod.id,
              last_synced_at: new Date().toISOString(),
            }, {
              onConflict: "location_id,opus_module_id,user_id",
            })
            .select("id, task_id, completion_pct")
            .single();

          if (upsertErr) {
            console.error("[opus-service] Upsert error:", upsertErr);
            continue;
          }
          syncedCount++;

          // Auto-create/resolve Quick Tasks
          if (matchedUserId && completionPct < 100) {
            // Create a Quick Task if none exists
            if (!upserted.task_id) {
              const { data: task, error: taskErr } = await supabase
                .from("temporary_tasks")
                .insert({
                  location_id: location_id,
                  title: `Complete OPUS: ${mod.title}`,
                  description: `Training module "${mod.title}" is ${completionPct}% complete. Tap GO to open OPUS and finish this module.`,
                  icon_name: "GraduationCap",
                  accent_color: "#8B5CF6",
                  is_active: true,
                  show_on_dashboard: true,
                  task_style: "default",
                  created_by: matchedUserId,
                })
                .select("id")
                .single();

              if (!taskErr && task) {
                // Assign to the specific user
                await supabase.from("temporary_task_assignments").insert({
                  task_id: task.id,
                  user_id: matchedUserId,
                });
                // Link task back to module
                await supabase.from("opus_training_modules").update({ task_id: task.id }).eq("id", upserted.id);
                tasksCreated++;
              }
            }
          } else if (completionPct >= 100 && upserted.task_id) {
            // Auto-resolve: mark task as completed
            await supabase
              .from("temporary_tasks")
              .update({
                completed_at: new Date().toISOString(),
                completed_by: matchedUserId,
                is_active: false,
              })
              .eq("id", upserted.task_id);
          }
        }
      }

      return new Response(JSON.stringify({
        success: true,
        synced: syncedCount,
        tasks_created: tasksCreated,
        unmatched_employees: unmatchedNames,
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

      const opusHeaders = {
        "Content-Type": "application/json",
        "Cookie": `sessionid=${sessionid}`,
        "Origin": "https://dashboard.opus.so",
        "Referer": "https://dashboard.opus.so/",
        "x-opus-role": "admin",
      };

      const aId = "2ec1ef91-acd4-4cdf-ba16-bc0e4e9d2567";
      const probes = [
        { operationName: "P1", query: `query P1 { Assignment(id: "${aId}") { id contentObject { id name __typename } } }` },
        { operationName: "P2", query: `query P2 { Assignment(id: "${aId}") { id assignable { id name __typename } } }` },
        { operationName: "P3", query: `query P3 { Assignment(id: "${aId}") { id item { id name __typename } } }` },
        { operationName: "P4", query: `query P4 { Assignment(id: "${aId}") { id resource { id name __typename } } }` },
        { operationName: "P5", query: `query P5 { Assignment(id: "${aId}") { id target { id name __typename } } }` },
        { operationName: "P6", query: `query P6 { Assignment(id: "${aId}") { id contentType assignedAt dueAt completedAt } }` },
        { operationName: "P7", query: `query P7 { Assignment(id: "${aId}") { id content { id name __typename } } }` },
        { operationName: "P8", query: `query P8 { AdminLocation(id: 1491) { id name employees { id name } } }` },
      ];

      const results = await Promise.all(
        probes.map(q => fetch(OPUS_GRAPHQL, { method: "POST", headers: opusHeaders, body: JSON.stringify(q) }).then(r => r.json()))
      );
      
      return new Response(JSON.stringify({ authenticated: true, ...Object.fromEntries(results.map((r, i) => [`p${i+1}`, r])) }), {
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

      const { data: integration } = await supabase
        .from("location_integrations")
        .select("credentials")
        .eq("location_id", location_id)
        .eq("integration_type", "opus")
        .eq("is_active", true)
        .maybeSingle();

      const sessionId = (integration?.credentials as any)?.sessionid;
      if (!sessionId) {
        return new Response(JSON.stringify({ error: "OPUS session not configured" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const fileResp = await fetch(file_url, {
        headers: { "Cookie": `sessionid=${sessionId}` },
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
    // Fetches OPUS library resources to inject into Theo knowledge
    if (action === "fetch_library") {
      const { location_id } = body;
      if (!location_id) {
        return new Response(JSON.stringify({ error: "Missing location_id" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: integration } = await supabase
        .from("location_integrations")
        .select("credentials")
        .eq("location_id", location_id)
        .eq("integration_type", "opus")
        .eq("is_active", true)
        .maybeSingle();

      const sessionId = (integration?.credentials as any)?.sessionid;
      if (!sessionId) {
        return new Response(JSON.stringify({ error: "OPUS session not configured" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const libraryQuery = {
        query: `
          query LibraryResources {
            resources {
              edges {
                node {
                  id
                  title
                  description
                  fileUrl
                  fileType
                  category
                }
              }
            }
          }
        `,
      };

      const resp = await fetch(OPUS_GRAPHQL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Cookie": `sessionid=${sessionId}`,
        },
        body: JSON.stringify(libraryQuery),
      });

      if (!resp.ok) {
        return new Response(JSON.stringify({ error: "OPUS library fetch failed" }), {
          status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const data = await resp.json();
      const resources = data?.data?.resources?.edges || [];

      // Inject each resource into theo_knowledge
      let injected = 0;
      for (const edge of resources) {
        const res = edge.node;
        const content = `[OPUS Document] ${res.title}\n\nCategory: ${res.category || "General"}\n${res.description || ""}\n\nSource: OPUS Library\nFile: ${res.fileUrl || "N/A"}`;

        const { error } = await supabase
          .from("theo_knowledge")
          .upsert({
            location_id: location_id,
            topic: `opus_${res.category || "general"}`,
            content: content,
            created_by: userId,
          }, {
            onConflict: "location_id,topic,content",
            ignoreDuplicates: true,
          });

        if (!error) injected++;
      }

      return new Response(JSON.stringify({
        success: true,
        resources_found: resources.length,
        injected: injected,
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
