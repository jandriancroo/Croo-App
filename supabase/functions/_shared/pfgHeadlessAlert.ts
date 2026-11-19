// PFG headless-login failure alerts.
//
// The GitHub Actions job (.github/workflows/pfg-token-refresh.yml) posts
// `headless_login_failed` when a store's browser login fails or the run itself
// breaks. Each post opens a support ticket right away, one open ticket per
// vendor + store. The ticket text carries only the store, a fixed status label
// and the run link. Free text from the caller (error messages, page text,
// token-exchange responses) is never stored.

export const PFG_HEADLESS_VENDOR = 'pfg';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Only runs of this repo's workflows are accepted as links.
const RUN_URL_RE = /https:\/\/github\.com\/jandriancroo\/Croo-App\/actions\/runs\/\d+(?:\/attempts\/\d+)?/;

// Fixed status labels. Anything else maps to the generic login failure.
export const HEADLESS_STATUS_LABELS: Record<string, string> = {
  login_failed: 'Headless login failed for this store',
  workflow_failed_install: 'Login run failed while installing the browser',
  workflow_failed_login: 'Login run failed during the login step',
  workflow_failed_setup: 'Login run failed during setup',
};

export function isUuid(v: unknown): v is string {
  return typeof v === 'string' && UUID_RE.test(v);
}

export function headlessAlertMarker(locationId: string): string {
  return `[${PFG_HEADLESS_VENDOR}-headless-login-failed:${locationId}]`;
}

export function normalizeStatus(raw: unknown): keyof typeof HEADLESS_STATUS_LABELS {
  return typeof raw === 'string' && Object.prototype.hasOwnProperty.call(HEADLESS_STATUS_LABELS, raw)
    ? raw
    : 'login_failed';
}

// Prefers an explicit runUrl; older callers only embed the link in `error`.
// Only the matched link is kept, never the surrounding text.
export function extractRunUrl(body: any): string | null {
  for (const candidate of [body?.runUrl, body?.error]) {
    if (typeof candidate !== 'string') continue;
    const m = candidate.match(RUN_URL_RE);
    if (m) return m[0];
  }
  return null;
}

export function buildHeadlessTicketDescription(opts: {
  locationId: string;
  locationName: string | null;
  status: string;
  runUrl: string | null;
}): string {
  const label = HEADLESS_STATUS_LABELS[normalizeStatus(opts.status)];
  return [
    headlessAlertMarker(opts.locationId),
    '',
    `PFG headless login failed: ${opts.locationName || opts.locationId}`,
    `Status: ${label}`,
    `Run: ${opts.runUrl ?? 'not provided'}`,
  ].join('\n');
}

export type HeadlessAlertResult =
  | { ok: true; ticket: 'created' | 'deduped'; ticketNumber: number | null }
  | { ok: false; status: number; error: string };

// Opens (or dedupes onto) the one open headless-login ticket for this store.
export async function openHeadlessLoginTicket(
  supabase: any,
  body: any,
  systemOwnerId: string,
): Promise<HeadlessAlertResult> {
  const locationId = body?.locationId;
  if (!isUuid(locationId)) return { ok: false, status: 400, error: 'Missing or invalid locationId' };

  const { data: integration, error: intErr } = await supabase
    .from('location_integrations')
    .select('id')
    .eq('location_id', locationId)
    .eq('integration_type', PFG_HEADLESS_VENDOR)
    .eq('is_active', true)
    .maybeSingle();
  if (intErr) return { ok: false, status: 500, error: 'Integration lookup failed' };
  if (!integration) return { ok: false, status: 404, error: 'No active PFG integration for this location' };

  const marker = headlessAlertMarker(locationId);
  const { data: existing, error: dupErr } = await supabase
    .from('support_tickets')
    .select('id, ticket_number')
    .in('status', ['open', 'in_progress'])
    .ilike('description', `%${marker}%`)
    .limit(1)
    .maybeSingle();
  if (dupErr) return { ok: false, status: 500, error: 'Ticket lookup failed' };
  if (existing?.id) return { ok: true, ticket: 'deduped', ticketNumber: existing.ticket_number ?? null };

  const { data: loc } = await supabase
    .from('locations')
    .select('name')
    .eq('id', locationId)
    .maybeSingle();

  const description = buildHeadlessTicketDescription({
    locationId,
    locationName: loc?.name ?? null,
    status: normalizeStatus(body?.status),
    runUrl: extractRunUrl(body),
  });

  const { data: inserted, error: insErr } = await supabase
    .from('support_tickets')
    .insert({
      user_id: systemOwnerId,
      category: 'data_sync_issues',
      description,
      occurrence_time: new Date().toISOString(),
      is_system: true,
    })
    .select('ticket_number')
    .maybeSingle();
  if (insErr) return { ok: false, status: 500, error: 'Ticket insert failed' };
  return { ok: true, ticket: 'created', ticketNumber: inserted?.ticket_number ?? null };
}
