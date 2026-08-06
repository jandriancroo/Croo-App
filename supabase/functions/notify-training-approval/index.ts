// @ts-nocheck
// Notifies the approvers of a training checklist assignment that a trainee
// submitted their work for sign-off. Called from the client right after the
// assignment flips to `submitted`.
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";
import { requireCaller } from "../_shared/callerAuth.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const auth = await requireCaller(req, corsHeaders);
  if ("response" in auth) return auth.response;

  try {
    const { assignment_id } = await req.json();
    if (!assignment_id) return json({ error: "assignment_id is required" }, 400);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

    const { data: assignment, error } = await admin
      .from("checklist_assignments")
      .select("id, checklist_id, assignee_id, location_id, approver_roles, approver_user_ids, checklists(title)")
      .eq("id", assignment_id)
      .maybeSingle();

    if (error) throw error;
    if (!assignment) return json({ error: "Assignment not found" }, 404);

    const { data: trainee } = await admin
      .from("profiles")
      .select("full_name")
      .eq("id", assignment.assignee_id)
      .maybeSingle();

    const traineeName = trainee?.full_name || "A team member";
    const title = "Training needs your approval";
    const body = `${traineeName} submitted "${assignment.checklists?.title || "a training checklist"}" for sign-off.`;

    const roles: string[] = assignment.approver_roles || [];
    const userIds: string[] = assignment.approver_user_ids || [];

    const invokePush = (payload: Record<string, unknown>) =>
      fetch(`${SUPABASE_URL}/functions/v1/send-push-notification`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      }).then((r) => r.json()).catch((e) => ({ error: String(e) }));

    const results: unknown[] = [];

    if (userIds.length > 0) {
      results.push(
        await invokePush({
          user_ids: userIds,
          location_id: assignment.location_id,
          title,
          body,
          notification_type: "checklist",
          data: { url: `/complete/${assignment.checklist_id}?assignment=${assignment.id}` },
        }),
      );
    }

    if (roles.length > 0) {
      results.push(
        await invokePush({
          roles,
          location_id: assignment.location_id,
          title,
          body,
          notification_type: "checklist",
          data: { url: `/complete/${assignment.checklist_id}?assignment=${assignment.id}` },
        }),
      );
    }

    return json({ success: true, notified: { roles, users: userIds.length }, results });
  } catch (e: any) {
    console.error("[notify-training-approval]", e);
    return json({ error: e?.message || "Unexpected error" }, 500);
  }
});
