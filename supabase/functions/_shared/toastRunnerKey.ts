// Toast runner key — lets the Mac mini Toast runner call the Toast functions
// with the `x-toast-runner-secret` header instead of CRON_SECRET.
// The constant below is the SHA-256 hex of the runner's key (safe to commit);
// the raw key lives only on the runner. Never log the header value.

export const TOAST_RUNNER_KEY_SHA256 =
  "299b746e2d3cbfa669c61c4420cafa399e2d4ef3d0a1b3677d618afc7c0275c4";

export const TOAST_RUNNER_HEADER = "x-toast-runner-secret";

export async function isToastRunner(req: Request): Promise<boolean> {
  const value = req.headers.get(TOAST_RUNNER_HEADER);
  if (!value) return false;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  if (hex.length !== TOAST_RUNNER_KEY_SHA256.length) return false;
  let diff = 0;
  for (let i = 0; i < hex.length; i++) {
    diff |= hex.charCodeAt(i) ^ TOAST_RUNNER_KEY_SHA256.charCodeAt(i);
  }
  return diff === 0;
}
