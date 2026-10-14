/**
 * Local safety copy of a checklist in progress. If the phone reloads the app
 * mid-checklist, unsaved answers come back. The server always wins: drafts
 * only fill items that have no saved server response yet.
 */
const PREFIX = 'checklist-draft:v1:';
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

interface DraftShape {
  savedAt: number;
  values: Record<string, unknown>;
}

export function checklistDraftKeys(opts: {
  userId?: string | null;
  submissionId?: string | null;
  checklistId?: string | null;
  assignmentId?: string | null;
  localDate: string;
}): string[] {
  if (!opts.userId) return [];
  const keys: string[] = [];
  if (opts.submissionId) keys.push(`${PREFIX}${opts.userId}:${opts.submissionId}`);
  if (opts.checklistId) {
    keys.push(`${PREFIX}${opts.userId}:${opts.checklistId}+${opts.assignmentId || 'none'}+${opts.localDate}`);
  }
  return keys;
}

/** Only keep values that are safe to restore (never blob: photo previews). */
function sanitize(value: unknown): unknown {
  if (typeof value === 'string') return value.startsWith('blob:') ? undefined : value;
  if (typeof value === 'boolean' || typeof value === 'number') return value;
  if (Array.isArray(value)) {
    const urls = value.filter((v) => typeof v === 'string' && !v.startsWith('blob:'));
    return urls.length ? urls : undefined;
  }
  return undefined;
}

function read(key: string): DraftShape | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DraftShape;
    if (!parsed || typeof parsed.savedAt !== 'number' || Date.now() - parsed.savedAt > MAX_AGE_MS) {
      localStorage.removeItem(key);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function saveChecklistDraftValue(keys: string[], itemId: string, value: unknown): void {
  const clean = sanitize(value);
  for (const key of keys) {
    try {
      const draft = read(key) ?? { savedAt: Date.now(), values: {} };
      if (clean === undefined || clean === '') delete draft.values[itemId];
      else draft.values[itemId] = clean;
      draft.savedAt = Date.now();
      localStorage.setItem(key, JSON.stringify(draft));
    } catch {
      /* storage full or blocked — ignore */
    }
  }
}

/** Drop one item from the draft once the server has it. */
export function clearChecklistDraftValue(keys: string[], itemId: string): void {
  for (const key of keys) {
    try {
      const draft = read(key);
      if (!draft || !(itemId in draft.values)) continue;
      delete draft.values[itemId];
      if (Object.keys(draft.values).length === 0) localStorage.removeItem(key);
      else localStorage.setItem(key, JSON.stringify(draft));
    } catch {
      /* ignore */
    }
  }
}

/** Draft values for items the server has no response for. */
export function loadChecklistDraft(
  keys: string[],
  serverResponses: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    const draft = read(key);
    if (!draft) continue;
    for (const [itemId, value] of Object.entries(draft.values)) {
      const server = serverResponses[itemId];
      const hasServer = server !== undefined && server !== null && server !== '';
      if (!hasServer && !(itemId in out)) {
        const clean = sanitize(value);
        if (clean !== undefined) out[itemId] = clean;
      }
    }
  }
  return out;
}

/** Remove expired drafts left behind on this device. */
export function pruneOldChecklistDrafts(): void {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key && key.startsWith(PREFIX)) read(key);
    }
  } catch {
    /* ignore */
  }
}
