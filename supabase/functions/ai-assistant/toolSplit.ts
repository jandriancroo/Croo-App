// Speed only: inside one AI round, read-only lookups run together; everything else
// (proposals, previews, cancel, screen-setting lookups, and find_crew, which feeds id snapping)
// runs one at a time, in the model's original order, after the reads. Results come back in
// the original tool_call order.

// Pure reads with no shared state. Unknown names are NOT reads (they stay sequential).
const READ_ONLY_EXACT = new Set(["fetch_resource_content", "find_chats", "read_chat"]);
export function isReadOnlyTool(name: string): boolean {
  return name.startsWith("query_") || READ_ONLY_EXACT.has(name);
}

export async function runToolsSplit<T>(calls: T[], isRead: (c: T) => boolean, run: (c: T) => Promise<string>): Promise<string[]> {
  const out: string[] = new Array(calls.length);
  const readIdx = calls.map((c, i) => (isRead(c) ? i : -1)).filter((i) => i >= 0);
  await Promise.all(readIdx.map(async (i) => { out[i] = await run(calls[i]); }));
  for (let i = 0; i < calls.length; i++) {
    if (!isRead(calls[i])) out[i] = await run(calls[i]);
  }
  return out;
}
