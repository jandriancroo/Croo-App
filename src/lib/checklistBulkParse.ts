import { newItemKey, type EditorItem, type EditorItemType } from '@/lib/checklistEditorItems';

/**
 * Paste rules (unchanged from the old Create page "Bulk Add"):
 * Photo: / Temp: / Text: / Confirm: or Check: / MC: or Choice: (question | opt1, opt2).
 * Any other line becomes a checkmark task. Empty lines are skipped.
 */
export function parseBulkText(text: string): EditorItem[] {
  const out: EditorItem[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const lower = line.toLowerCase();
    const item: EditorItem = { _key: newItemKey(), question: line, item_type: 'confirmation', is_required: true };
    if (lower.startsWith('photo:')) { item.question = line.substring(6).trim(); item.item_type = 'image'; }
    else if (lower.startsWith('temp:')) { item.question = line.substring(5).trim(); item.item_type = 'temperature'; }
    else if (lower.startsWith('text:')) { item.question = line.substring(5).trim(); item.item_type = 'text'; }
    else if (lower.startsWith('confirm:') || lower.startsWith('check:')) {
      item.question = line.substring(line.indexOf(':') + 1).trim();
      item.item_type = 'confirmation';
    } else if (lower.startsWith('mc:') || lower.startsWith('choice:')) {
      const rest = line.substring(line.indexOf(':') + 1).trim();
      const pipe = rest.indexOf('|');
      item.item_type = 'multiple_choice';
      if (pipe > -1) {
        item.question = rest.substring(0, pipe).trim();
        item.options = rest.substring(pipe + 1).split(',').map((o) => o.trim()).filter(Boolean);
      } else {
        item.question = rest;
        item.options = ['Yes', 'No', 'N/A'];
      }
    }
    if (item.question) out.push(item);
  }
  return out;
}

/** Type words accepted in a CSV type column (paste prefixes or type names). */
export function typeFromWord(word: string | undefined): EditorItemType | null {
  const w = (word ?? '').trim().toLowerCase().replace(/[:\s_-]+/g, ' ').trim();
  if (!w) return null;
  if (['photo', 'image', 'picture'].includes(w)) return 'image';
  if (['temp', 'temp photo', 'temperature', 'temperature photo'].includes(w)) return 'temperature';
  if (['text', 'note'].includes(w)) return 'text';
  if (['check', 'confirm', 'confirmation', 'checkbox', 'checkmark'].includes(w)) return 'confirmation';
  if (['choice', 'mc', 'multiple choice'].includes(w)) return 'multiple_choice';
  if (['number', 'count'].includes(w)) return 'number';
  if (['section', 'section header', 'header', 'heading'].includes(w)) return 'section_header';
  if (['prep', 'prep list'].includes(w)) return 'prep_list';
  if (['manager approval', 'approval'].includes(w)) return 'manager_approval';
  return null;
}

/** Split CSV text into rows (handles quotes, "" escapes and newlines inside quotes). */
export function splitCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

export const CSV_MAX_ROWS = 500;

const HEADER_NAMES = ['task', 'tasks', 'name', 'task name', 'item', 'question', 'step'];

/** CSV: column 1 name, optional 2 type, optional 3 notes. Header row skipped. Max 500 rows. */
export function parseCsvTasks(text: string): { items: EditorItem[]; truncated: boolean } {
  let rows = splitCsv(text.replace(/^\uFEFF/, ''));
  if (rows.length && HEADER_NAMES.includes((rows[0][0] ?? '').trim().toLowerCase())) rows = rows.slice(1);
  const truncated = rows.length > CSV_MAX_ROWS;
  const items: EditorItem[] = [];
  for (const r of rows.slice(0, CSV_MAX_ROWS)) {
    const name = (r[0] ?? '').trim();
    if (!name) continue;
    const type = typeFromWord(r[1]) ?? 'confirmation';
    const notes = (r[2] ?? '').trim();
    const item: EditorItem = { _key: newItemKey(), question: name, item_type: type, is_required: type !== 'section_header' };
    if (type === 'multiple_choice') item.options = ['Yes', 'No', 'N/A'];
    if (notes) item.reference_notes = notes;
    items.push(item);
  }
  return { items, truncated };
}

/** Tasks read from a PDF or photo. Default Check unless clearly photo/temperature. */
export function itemsFromExtracted(tasks: { name?: string; type?: string; section?: boolean }[]): EditorItem[] {
  return (tasks ?? []).flatMap((t) => {
    const name = (t.name ?? '').trim();
    if (!name) return [];
    const type: EditorItemType = t.section ? 'section_header' : t.type === 'photo' ? 'image' : t.type === 'temperature' ? 'temperature' : 'confirmation';
    return [{ _key: newItemKey(), question: name, item_type: type, is_required: type !== 'section_header' }];
  });
}
