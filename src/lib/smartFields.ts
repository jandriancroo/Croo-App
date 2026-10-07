// Pure helpers for the shared smart-field editor (nudge templates + hiring rejection emails).
// The stored text never changes format: a field is kept as the exact token text it was parsed from.

export type SmartField = { token: string; label: string };
export type Segment =
  | { type: 'text'; text: string }
  | { type: 'field'; token: string; raw: string; label: string };

const TOKEN_RE = /\{\{\s*[A-Za-z_][A-Za-z0-9_]*\s*\}\}|\{[A-Za-z_][A-Za-z0-9_]*\}/g;

const keyOf = (t: string) => {
  const double = t.startsWith('{{');
  const name = t.replace(/[{}\s]/g, '').toLowerCase();
  return `${double ? 2 : 1}:${name}`;
};

export function findField(raw: string, fields: SmartField[]): SmartField | undefined {
  const k = keyOf(raw);
  return fields.find((f) => keyOf(f.token) === k);
}

export function parseTokens(text: string, fields: SmartField[]): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  const push = (t: string) => {
    if (!t) return;
    const prev = out[out.length - 1];
    if (prev && prev.type === 'text') prev.text += t;
    else out.push({ type: 'text', text: t });
  };
  for (const m of text.matchAll(TOKEN_RE)) {
    const raw = m[0];
    const i = m.index ?? 0;
    const f = findField(raw, fields);
    push(text.slice(last, i));
    if (f) out.push({ type: 'field', token: f.token, raw, label: f.label });
    else push(raw);
    last = i + raw.length;
  }
  push(text.slice(last));
  return out;
}

export function serializeSegments(segments: Segment[]): string {
  return segments.map((s) => (s.type === 'text' ? s.text : s.raw)).join('');
}

export const NUDGE_FIELDS: SmartField[] = [
  { token: '{sender_first_name}', label: 'Your name' },
  { token: '{recipient_first_name}', label: 'Crew member name' },
  { token: '{checklist}', label: 'Checklist' },
  { token: '{done}', label: 'Done' },
  { token: '{total}', label: 'Total' },
];

// Only the fields hiring-email-service replaces.
export const HIRING_FIELDS: SmartField[] = [
  { token: '{{name}}', label: 'Applicant name' },
  { token: '{{first_name}}', label: 'Applicant first name' },
  { token: '{{organization}}', label: 'Company name' },
];
