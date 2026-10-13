// Keep-warm ping: a POST whose body is exactly {"warm": true} (one key, value true).
// Callers answer 200 {"ok":true} at once: no auth, no data, no AI, no embedding, no TTS.
// Any other body (including {"warm": true, ...more}) is a normal request.
export async function isWarmPing(req: Request): Promise<boolean> {
  if (req.method !== "POST") return false;
  try {
    const b = await req.clone().json();
    return !!b && typeof b === "object" && !Array.isArray(b) && Object.keys(b).length === 1 && b.warm === true;
  } catch {
    return false;
  }
}

export function warmResponse(cors: Record<string, string>): Response {
  return new Response(JSON.stringify({ ok: true }), { headers: { ...cors, "Content-Type": "application/json" } });
}
