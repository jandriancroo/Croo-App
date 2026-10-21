/**
 * Run-screen grouping helper: which task a section header follows when
 * position/station groups are on. A header goes with the first task below it
 * (before the next header); with no task below, it goes with the previous task;
 * first with nothing below = hidden (anchorId null).
 */
export interface SectionHeaderPlacement {
  /** Task whose group the header joins; null = hide the header. */
  anchorId: string | null;
  /** Tasks under this header (until the next header), in list order. */
  taskIds: string[];
}

export function placeSectionHeaders<T extends { id: string; item_type: string }>(items: T[]): Map<string, SectionHeaderPlacement> {
  const out = new Map<string, SectionHeaderPlacement>();
  let lastTaskId: string | null = null;
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (it.item_type !== 'section_header') { lastTaskId = it.id; continue; }
    const taskIds: string[] = [];
    for (let j = i + 1; j < items.length && items[j].item_type !== 'section_header'; j++) taskIds.push(items[j].id);
    out.set(it.id, { anchorId: taskIds[0] ?? lastTaskId, taskIds });
  }
  return out;
}
