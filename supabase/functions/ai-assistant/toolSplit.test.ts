import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { isReadOnlyTool, runToolsSplit } from "./toolSplit.ts";

Deno.test("reads run together, actions run in order after reads, results keep original order", async () => {
  const calls = ["propose_nudge", "query_sales", "propose_action", "query_labor", "cancel_pending_action"];
  const log: string[] = [];
  let active = 0, maxActive = 0;
  const res = await runToolsSplit(calls, isReadOnlyTool, async (n) => {
    active++; maxActive = Math.max(maxActive, active);
    log.push(`start:${n}`);
    await new Promise((r) => setTimeout(r, isReadOnlyTool(n) ? 20 : 1));
    log.push(`end:${n}`); active--;
    return `r:${n}`;
  });
  assertEquals(res, calls.map((n) => `r:${n}`));
  assertEquals(maxActive, 2); // the two reads overlapped; actions never overlap
  const actionOrder = log.filter((l) => l.startsWith("start:") && !isReadOnlyTool(l.slice(6)));
  assertEquals(actionOrder, ["start:propose_nudge", "start:propose_action", "start:cancel_pending_action"]);
  assertEquals(log.indexOf("start:propose_nudge") > log.indexOf("end:query_sales"), true);
});

Deno.test("classification", () => {
  for (const n of ["query_sales", "query_task_history", "query_checklist_items", "query_my_chats", "fetch_resource_content", "find_chats", "read_chat"]) assertEquals(isReadOnlyTool(n), true);
  for (const n of ["find_crew", "find_shifts", "cover_candidates", "propose_action", "propose_message", "propose_punch", "propose_nudge", "propose_announcement", "cancel_pending_action", "mystery"]) assertEquals(isReadOnlyTool(n), false);
});
