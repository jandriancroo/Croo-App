import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
  buildHeadlessTicketDescription, extractRunUrl, headlessAlertMarker, normalizeStatus, openHeadlessLoginTicket,
} from './pfgHeadlessAlert.ts';

const STORE = '2d309714-f808-4c98-b612-10909e569fac';
const OWNER = 'a2e81a39-0e0b-47b1-a1aa-0e53f3869d37';
const RUN = 'https://github.com/jandriancroo/Croo-App/actions/runs/123456789';

// Tiny in-memory stand-in for the supabase-js query builder.
function fakeDb(rows: Record<string, any[]>) {
  let nextTicket = 100;
  return {
    rows,
    from(table: string) {
      const filters: ((r: any) => boolean)[] = [];
      let insertRow: any = null;
      const b: any = {
        select: () => b,
        eq: (c: string, v: any) => { filters.push((r) => r[c] === v); return b; },
        in: (c: string, v: any[]) => { filters.push((r) => v.includes(r[c])); return b; },
        ilike: (c: string, p: string) => {
          const needle = p.replace(/^%|%$/g, '').toLowerCase();
          filters.push((r) => String(r[c] ?? '').toLowerCase().includes(needle));
          return b;
        },
        limit: () => b,
        insert: (row: any) => { insertRow = { id: crypto.randomUUID(), ...row, status: 'open', ticket_number: nextTicket++ }; return b; },
        maybeSingle: async () => {
          if (insertRow) { (rows[table] ||= []).push(insertRow); return { data: insertRow, error: null }; }
          const hit = (rows[table] || []).find((r) => filters.every((f) => f(r)));
          return { data: hit ?? null, error: null };
        },
      };
      return b;
    },
  };
}

function seeded() {
  return fakeDb({
    location_integrations: [{ id: 'i1', location_id: STORE, integration_type: 'pfg', is_active: true }],
    locations: [{ id: STORE, name: 'Sparks' }],
    support_tickets: [
      // An unrelated open PFG alert for the same store must not count as a dupe.
      { id: 'old', status: 'open', ticket_number: 70, description: 'Sparks — System Alert: nightly maintenance task "vendor_pfg_masters" failed' },
    ],
  });
}

Deno.test('first failure opens a ticket; a second call dedupes onto it', async () => {
  const db = seeded();
  const first = await openHeadlessLoginTicket(db, { locationId: STORE, status: 'login_failed', runUrl: RUN }, OWNER);
  assertEquals(first, { ok: true, ticket: 'created', ticketNumber: 100 });
  const second = await openHeadlessLoginTicket(db, { locationId: STORE, status: 'workflow_failed_login', runUrl: RUN }, OWNER);
  assertEquals(second, { ok: true, ticket: 'deduped', ticketNumber: 100 });
  assertEquals(db.rows.support_tickets.filter((t) => t.description.includes(headlessAlertMarker(STORE))).length, 1);
});

Deno.test('a resolved ticket lets the next failure open a fresh one', async () => {
  const db = seeded();
  await openHeadlessLoginTicket(db, { locationId: STORE, runUrl: RUN }, OWNER);
  db.rows.support_tickets.find((t) => t.ticket_number === 100)!.status = 'resolved';
  const again = await openHeadlessLoginTicket(db, { locationId: STORE, runUrl: RUN }, OWNER);
  assertEquals(again, { ok: true, ticket: 'created', ticketNumber: 101 });
});

Deno.test('ticket text is the status and run link only; caller error text is dropped', async () => {
  const db = seeded();
  const leaky = `Token exchange failed: {"refresh_token":"eyJraWQiOiJBSECRET"} <html>page dump</html> Run: ${RUN}`;
  await openHeadlessLoginTicket(db, { locationId: STORE, error: leaky }, OWNER);
  const t = db.rows.support_tickets.find((r) => r.ticket_number === 100)!;
  assertEquals(t.description, [
    headlessAlertMarker(STORE), '', 'PFG headless login failed: Sparks',
    'Status: Headless login failed for this store', `Run: ${RUN}`,
  ].join('\n'));
  assert(!t.description.includes('eyJ'));
  assert(!t.description.includes('html'));
  assertEquals(t.is_system, true);
  assertEquals(t.user_id, OWNER);
});

Deno.test('rejects bad location ids and stores without an active PFG integration', async () => {
  const db = seeded();
  assertEquals((await openHeadlessLoginTicket(db, { locationId: 'nope' }, OWNER) as any).status, 400);
  assertEquals((await openHeadlessLoginTicket(db, { locationId: '00000000-0000-0000-0000-000000000000' }, OWNER) as any).status, 404);
  assertEquals(db.rows.support_tickets.length, 1);
});

Deno.test('status is a fixed label and run links must belong to this repo', () => {
  assertEquals(normalizeStatus('workflow_failed_install'), 'workflow_failed_install');
  assertEquals(normalizeStatus('eyJraWQ secret token'), 'login_failed');
  assertEquals(extractRunUrl({ runUrl: 'https://evil.example/actions/runs/1' }), null);
  assertEquals(extractRunUrl({ runUrl: `${RUN}/attempts/2` }), `${RUN}/attempts/2`);
  assertEquals(
    buildHeadlessTicketDescription({ locationId: STORE, locationName: null, status: 'bogus', runUrl: null }).split('\n').slice(2),
    [`PFG headless login failed: ${STORE}`, 'Status: Headless login failed for this store', 'Run: not provided'],
  );
});
