// Toast runner key — lets the Toast runners call the Toast functions
// with the `x-toast-runner-secret` header instead of CRON_SECRET.
// The constants below are SHA-256 hex digests of the runners' keys (safe to commit);
// the raw keys live only on the runners. Never log the header value.

// Mac mini runner (permanent).
export const TOAST_RUNNER_KEY_SHA256 =
  "299b746e2d3cbfa669c61c4420cafa399e2d4ef3d0a1b3677d618afc7c0275c4";

// All accepted runner digests.
export const TOAST_RUNNER_KEY_SHA256S: readonly string[] = [
  TOAST_RUNNER_KEY_SHA256,
  // Jordan's MacBook Pro runner — TEMPORARY, remove when it is no longer needed.
  "b2f0a20318c06e5bff9c4618a45c9e0a13ad64f3e972bc2b343de84b44ad8d86",
];

export const TOAST_RUNNER_HEADER = "x-toast-runner-secret";

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function isToastRunner(req: Request): Promise<boolean> {
  const value = req.headers.get(TOAST_RUNNER_HEADER);
  if (!value) return false;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  // Compare against every entry; no early exit on a match.
  let matched = false;
  for (const expected of TOAST_RUNNER_KEY_SHA256S) {
    matched = constantTimeEqual(hex, expected) || matched;
  }
  return matched;
}
