// @ts-nocheck
// Shared caller authentication for public (verify_jwt = false) edge functions.
//
// These endpoints must stay reachable without Supabase's built-in JWT gate
// (cron jobs, service-to-service invokes, webhooks), but they must NOT be an
// open relay. Every request must present either:
//   1. the service role key (server-to-server / cron), or
//   2. a valid, signature-verified end-user access token.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

export type Caller =
  | { kind: "service"; userId: null }
  | { kind: "user"; userId: string };

/**
 * Verifies the Authorization header. Returns the caller identity, or `null`
 * when the request is unauthenticated / invalid.
 */
export async function authenticateCaller(req: Request): Promise<Caller | null> {
  const authHeader = req.headers.get("Authorization") || req.headers.get("authorization");
  if (!authHeader) return null;

  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;

  // Service-to-service (cron, other edge functions, admin scripts).
  if (SERVICE_ROLE_KEY && token === SERVICE_ROLE_KEY) {
    return { kind: "service", userId: null };
  }

  // End-user token — signature verified server-side.
  try {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
    const { data, error } = await admin.auth.getUser(token);
    if (error || !data?.user?.id) return null;
    return { kind: "user", userId: data.user.id };
  } catch {
    return null;
  }
}

/**
 * Guard helper: returns a 401 Response when the caller is not authenticated,
 * otherwise returns the caller.
 */
export async function requireCaller(
  req: Request,
  corsHeaders: Record<string, string>,
): Promise<{ caller: Caller } | { response: Response }> {
  const caller = await authenticateCaller(req);
  if (!caller) {
    return {
      response: new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }),
    };
  }
  return { caller };
}
