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

/**
 * Guard for internal-only endpoints (cron ticks, database triggers,
 * service-to-service invokes). These are never called from the browser, so a
 * plain end-user token is NOT enough — the caller must present either the
 * service role key or the shared CRON_SECRET (`x-cron-secret` header).
 *
 * Returns `null` when the caller is authorized, otherwise a 401 Response.
 */
export function requireInternalCaller(
  req: Request,
  corsHeaders: Record<string, string>,
): Response | null {
  const authHeader = req.headers.get("Authorization") || req.headers.get("authorization") || "";
  const bearer = authHeader.replace(/^Bearer\s+/i, "").trim();
  const cronSecret = Deno.env.get("CRON_SECRET");
  const providedCronSecret = req.headers.get("x-cron-secret");

  const isService = !!SERVICE_ROLE_KEY && bearer === SERVICE_ROLE_KEY;
  const isCron = !!cronSecret && providedCronSecret === cronSecret;

  if (isService || isCron) return null;

  return new Response(JSON.stringify({ error: "Unauthorized" }), {
    status: 401,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}


/**
 * Guard for integration endpoints that are reachable from the app UI but must
 * never be open to the internet.
 *
 * Authorized callers:
 *   1. service role key (edge-to-edge / cron)
 *   2. the shared CRON_SECRET via `x-cron-secret` (GitHub Actions workers)
 *   3. a signed-in user whose token verifies — optionally gated on a minimum
 *      role via public.has_role_or_higher()
 *
 * Returns `null` when authorized, otherwise a 401/403 Response.
 */
export async function requireAuthorizedCaller(
  req: Request,
  corsHeaders: Record<string, string>,
  opts: { minRole?: string } = {},
): Promise<Response | null> {
  const deny = (status: number, error: string) =>
    new Response(JSON.stringify({ error }), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  const authHeader = req.headers.get("Authorization") || req.headers.get("authorization") || "";
  const bearer = authHeader.replace(/^Bearer\s+/i, "").trim();
  const cronSecret = Deno.env.get("CRON_SECRET");

  if (SERVICE_ROLE_KEY && bearer === SERVICE_ROLE_KEY) return null;
  if (cronSecret && req.headers.get("x-cron-secret") === cronSecret) return null;

  if (!bearer) return deny(401, "Unauthorized");

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const { data, error } = await admin.auth.getUser(bearer);
  const userId = data?.user?.id;
  if (error || !userId) return deny(401, "Unauthorized");

  if (opts.minRole) {
    const { data: ok, error: roleErr } = await admin.rpc("has_role_or_higher", {
      _user_id: userId,
      _minimum_role: opts.minRole,
    });
    if (roleErr || ok !== true) return deny(403, "Forbidden");
  }

  return null;
}
