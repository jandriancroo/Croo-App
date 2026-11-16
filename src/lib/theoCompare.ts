// Theo Dashboards: the compare_metrics card payload (built on the server in
// supabase/functions/ai-assistant/compareTool.ts) and its display formatting.
// Values are numbers or plain strings only; the card renders them as text (no HTML/markdown).

export type CompareUnit = 'usd' | 'pct' | 'hours' | 'count';
export interface CompareRow {
  key: string; label: string; unit: CompareUnit;
  a: number | null; b: number | null; change: number | null; change_pct: number | null;
  note?: string; a_units?: number | null; b_units?: number | null;
}
export interface CompareGroup {
  key: 'product_mix' | 'checklist_completion'; title: string; unit: 'usd' | 'pct';
  rows: CompareRow[]; header?: CompareRow; note?: string; hidden_reason?: string;
}
export interface ComparePeriod { label: string; start: string; end: string; range: string }
export interface ComparePayload {
  kind: 'theo_compare'; version: 1; title: string; store_name: string;
  period_a: ComparePeriod; period_b: ComparePeriod;
  rows: CompareRow[]; groups: CompareGroup[]; notes: string[]; footnote?: string; spoken_summary: string;
}

const str = (v: unknown, max = 160): string => (typeof v === 'string' ? v : v == null ? '' : String(v)).slice(0, max);
const numOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const UNITS: CompareUnit[] = ['usd', 'pct', 'hours', 'count'];
// Labor dollars are never allowed on the card, even if a payload carried them.
const BLOCKED_KEYS = /^(labor_cost|labor_dollars|wages?)$/i;
type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object';

function readRow(r: unknown): CompareRow | null {
  if (!isObj(r)) return null;
  const key = str(r.key, 200);
  if (BLOCKED_KEYS.test(key)) return null;
  return {
    key, label: str(r.label), unit: UNITS.includes(r.unit as CompareUnit) ? (r.unit as CompareUnit) : 'count',
    a: numOrNull(r.a), b: numOrNull(r.b), change: numOrNull(r.change), change_pct: numOrNull(r.change_pct),
    ...(r.note ? { note: str(r.note, 240) } : {}),
    ...(r.a_units !== undefined || r.b_units !== undefined ? { a_units: numOrNull(r.a_units), b_units: numOrNull(r.b_units) } : {}),
  };
}
const readPeriod = (p: unknown): ComparePeriod => {
  const o: Obj = isObj(p) ? p : {};
  return { label: str(o.label, 80), start: str(o.start, 10), end: str(o.end, 10), range: str(o.range, 80) };
};

/** Validates an unknown server value into a ComparePayload (or null). Everything becomes plain text/numbers. */
export function readComparePayload(raw: unknown): ComparePayload | null {
  if (!isObj(raw) || raw.kind !== 'theo_compare') return null;
  const p = raw;
  const rows = (Array.isArray(p.rows) ? p.rows : []).map(readRow).filter(Boolean) as CompareRow[];
  const groups = (Array.isArray(p.groups) ? p.groups : []).filter((g: unknown): g is Obj => isObj(g) && (g.key === 'product_mix' || g.key === 'checklist_completion')).map((g): CompareGroup => ({
    key: g.key as CompareGroup['key'], title: str(g.title, 80), unit: g.unit === 'pct' ? 'pct' : 'usd',
    rows: (Array.isArray(g.rows) ? g.rows : []).slice(0, 50).map(readRow).filter(Boolean) as CompareRow[],
    ...(g.header ? { header: readRow(g.header) || undefined } : {}),
    ...(g.note ? { note: str(g.note, 240) } : {}),
    ...(g.hidden_reason ? { hidden_reason: str(g.hidden_reason, 240) } : {}),
  }));
  if (!rows.length && !groups.length) return null;
  return {
    kind: 'theo_compare', version: 1, title: str(p.title, 80) || 'Comparison', store_name: str(p.store_name, 80),
    period_a: readPeriod(p.period_a), period_b: readPeriod(p.period_b), rows, groups,
    notes: (Array.isArray(p.notes) ? p.notes : []).slice(0, 6).map((n: unknown) => str(n, 240)).filter(Boolean),
    ...(p.footnote ? { footnote: str(p.footnote, 200) } : {}),
    spoken_summary: str(p.spoken_summary, 800),
  };
}

const DASH = '—';
/** Same formats as DataCube cubes: whole dollars, $x.xx ticket, one-decimal % and hours. */
export function formatCompareValue(v: number | null, unit: CompareUnit, key = ''): string {
  if (v == null) return DASH;
  if (unit === 'usd') return key === 'avg_ticket'
    ? `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : `$${Math.round(v).toLocaleString('en-US')}`;
  if (unit === 'pct') return `${v.toFixed(1)}%`;
  if (unit === 'hours') return `${v.toLocaleString('en-US', { maximumFractionDigits: 1 })} h`;
  return Math.round(v).toLocaleString('en-US');
}
export function formatCompareChange(r: CompareRow): string {
  if (r.change == null) return DASH;
  const sign = r.change > 0 ? '+' : r.change < 0 ? '−' : '';
  const abs = Math.abs(r.change);
  if (r.unit === 'pct') return `${sign}${abs.toFixed(abs >= 10 || r.key.startsWith('checklist') ? 0 : 1)} pts`;
  return `${sign}${formatCompareValue(abs, r.unit, r.key)}`;
}
export function formatComparePct(r: CompareRow): string {
  if (r.change_pct == null) return '';
  const sign = r.change_pct > 0 ? '+' : r.change_pct < 0 ? '−' : '';
  return `${sign}${Math.abs(r.change_pct).toFixed(Math.abs(r.change_pct) >= 10 ? 0 : 1)}%`;
}
/** Good / bad tone for the change: lower labor % is better; everything else higher is better. */
export function changeTone(r: CompareRow): 'up' | 'down' | 'flat' {
  if (r.change == null || r.change === 0) return 'flat';
  const better = r.key === 'labor_pct' ? r.change < 0 : r.change > 0;
  return better ? 'up' : 'down';
}
