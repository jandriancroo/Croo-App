// Execute the shipped PostgreSQL functions in an isolated database, never production.
// @vitest-environment node
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

const ids = { schedule: '00000000-0000-4000-8000-000000000001', shift: '00000000-0000-4000-8000-000000000002', other: '00000000-0000-4000-8000-000000000003', owner: '00000000-0000-4000-8000-000000000004', winner: '00000000-0000-4000-8000-000000000005', offer: '00000000-0000-4000-8000-000000000006', location: '00000000-0000-4000-8000-000000000007' };
const sql = readFileSync('drizzle/migrations/0070_marketplace_publish_confirmed_shift.sql', 'utf8');
async function setup(published = true) {
  const db = new PGlite();
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT '${ids.winner}'::uuid $$;
    CREATE TABLE schedules (id uuid PRIMARY KEY, location_id uuid, is_published boolean, published_shifts_snapshot jsonb,
      last_status_changed_at timestamptz, last_status_changed_by uuid, last_status_action text,
      original_shifts_snapshot jsonb, original_published_at timestamptz, original_published_by uuid, original_replace_on_next_post boolean DEFAULT false,
      approval_status text, approval_requested_by uuid, approval_requested_at timestamptz, approval_decided_by uuid, approval_decided_at timestamptz, approval_message text);
    CREATE TABLE scheduled_shifts (id uuid PRIMARY KEY, schedule_id uuid, user_id uuid, is_phantom boolean DEFAULT false);
    CREATE TABLE shift_offers (id uuid PRIMARY KEY, shift_id uuid, offered_by_user_id uuid, claimed_by_user_id uuid, status text, approved_at timestamptz, approved_by_user_id uuid, approved_via text, updated_at timestamptz);
    CREATE TABLE shift_offer_claims (shift_offer_id uuid, user_id uuid, created_at timestamptz DEFAULT now(), UNIQUE(shift_offer_id,user_id));
    CREATE TABLE user_locations (user_id uuid,location_id uuid);
    CREATE TABLE schedule_change_log (schedule_id uuid,shift_id uuid,change_type text,changed_by uuid,is_draft boolean,week_live boolean,note text);
    CREATE TABLE temporary_tasks (schedule_id uuid, is_active boolean, completed_at timestamptz);
    CREATE FUNCTION _shift_has_started(uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
    CREATE FUNCTION _schedule_approval_required(uuid,uuid,uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
    CREATE FUNCTION _shift_offer_guard(_offer_id uuid, OUT o shift_offers, OUT shift_id uuid, OUT owner_id uuid, OUT loc uuid)
    LANGUAGE plpgsql AS $$ BEGIN
      SELECT * INTO o FROM shift_offers WHERE id=_offer_id;
      SELECT ss.id,ss.user_id,s.location_id INTO shift_id,owner_id,loc FROM scheduled_shifts ss JOIN schedules s ON s.id=ss.schedule_id WHERE ss.id=o.shift_id;
    END $$;
    INSERT INTO schedules (id,location_id,is_published,published_shifts_snapshot) VALUES ('${ids.schedule}','${ids.location}',${published},'[{"id":"${ids.shift}","user_id":"${ids.owner}"},{"id":"${ids.other}","user_id":"${ids.owner}"}]');
    INSERT INTO scheduled_shifts (id,schedule_id,user_id) VALUES ('${ids.shift}','${ids.schedule}','${ids.owner}'),('${ids.other}','${ids.schedule}','${ids.winner}');
    INSERT INTO shift_offers (id,shift_id,offered_by_user_id,status) VALUES ('${ids.offer}','${ids.shift}','${ids.owner}','available');
    INSERT INTO user_locations VALUES ('${ids.winner}','${ids.location}');
    INSERT INTO schedule_change_log VALUES ('${ids.schedule}','${ids.shift}','reassigned',NULL,true,true,NULL),('${ids.schedule}','${ids.other}','reassigned',NULL,true,true,NULL);
  `);
  await db.exec(sql);
  await db.exec('CREATE TRIGGER lifecycle BEFORE UPDATE ON schedules FOR EACH ROW EXECUTE FUNCTION trg_schedules_lifecycle()');
  return db;
}

describe('confirmed marketplace publication', () => {
  it('Assign publishes the winner immediately without publishing another draft', async () => {
    const db = await setup();
    try {
      await db.query('SELECT assign_shift_offer($1,$2)', [ids.offer,ids.winner]);
      const { rows } = await db.query<{ published_shifts_snapshot: {id:string;user_id:string}[] }>('SELECT published_shifts_snapshot FROM schedules');
      expect(rows[0]?.published_shifts_snapshot.find(x=>x.id===ids.shift)?.user_id).toBe(ids.winner);
      expect(rows[0]?.published_shifts_snapshot.find(x=>x.id===ids.other)?.user_id).toBe(ids.owner);
      const logs = await db.query<{shift_id:string;is_draft:boolean}>('SELECT shift_id,is_draft FROM schedule_change_log WHERE shift_id IS NOT NULL');
      expect(logs.rows.find(x=>x.shift_id===ids.shift)?.is_draft).toBe(false);
      expect(logs.rows.find(x=>x.shift_id===ids.other)?.is_draft).toBe(true);
    } finally { await db.close(); }
  }, 20000);
  it('Approve and Undo keep the published owner in sync', async () => {
    const db = await setup();
    try {
      await db.query('INSERT INTO shift_offer_claims VALUES ($1,$2,now())',[ids.offer,ids.winner]);
      await db.query('SELECT approve_shift_offer($1,$2)',[ids.offer,ids.winner]);
      let result = await db.query<{owner:string}>(`SELECT published_shifts_snapshot->0->>'user_id' AS owner FROM schedules`);
      expect(result.rows[0]?.owner).toBe(ids.winner);
      await db.query('SELECT undo_shift_offer($1)',[ids.offer]);
      result = await db.query<{owner:string}>(`SELECT published_shifts_snapshot->0->>'user_id' AS owner FROM schedules`);
      expect(result.rows[0]?.owner).toBe(ids.owner);
    } finally { await db.close(); }
  }, 20000);
  it('a draft week rejects the whole assignment rather than secretly publishing it', async () => {
    const db = await setup(false);
    try {
      await expect(db.query('SELECT assign_shift_offer($1,$2)',[ids.offer,ids.winner])).rejects.toThrow('Publish this schedule');
      const r = await db.query<{user_id:string}>('SELECT user_id FROM scheduled_shifts WHERE id=$1',[ids.shift]);
      expect(r.rows[0]?.user_id).toBe(ids.owner);
    } finally { await db.close(); }
  }, 20000);
  it('retrying a confirmed assignment publishes once without adding a second claim', async () => {
    const db = await setup();
    try {
      await db.query('SELECT assign_shift_offer($1,$2)',[ids.offer,ids.winner]);
      await db.query('SELECT assign_shift_offer($1,$2)',[ids.offer,ids.winner]);
      const r = await db.query<{count:number}>('SELECT count(*)::int AS count FROM shift_offer_claims');
      expect(r.rows[0]?.count).toBe(1);
      const l = await db.query<{count:number}>("SELECT count(*)::int AS count FROM schedule_change_log WHERE change_type='update_sent'");
      expect(l.rows[0]?.count).toBe(1);
    } finally { await db.close(); }
  }, 20000);
});