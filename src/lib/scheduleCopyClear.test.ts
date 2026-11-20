// Execute the shipped schedule Copy / Clear drafts / history-retention SQL in an isolated database, never production.
// @vitest-environment node
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

const sql = readFileSync('drizzle/migrations/0103_schedule_week_unique_copy_clear.sql', 'utf8')
  + '\n' + readFileSync('drizzle/migrations/0105_schedule_history_12_weeks.sql', 'utf8');
const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ids = { mgr: U(1), loc: U(2), other: U(3), src: U(10), tgt: U(11), a: U(20), b: U(21), st: U(30), stOther: U(31), live: U(12) };

// Production helpers this migration builds on (bodies as live on Nov 19, 2026; auth/role checks stubbed).
const BASE = `
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE SCHEMA auth;
  CREATE TABLE auth_uid (id uuid); INSERT INTO auth_uid VALUES ('${ids.mgr}');
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM auth_uid $$;
  CREATE TABLE editors (user_id uuid, location_id uuid);
  CREATE FUNCTION _can_edit_schedule(_user uuid, _location_id uuid) RETURNS boolean LANGUAGE sql AS
    $$ SELECT EXISTS (SELECT 1 FROM editors WHERE user_id = _user AND location_id = _location_id) $$;
  CREATE TABLE location_settings (location_id uuid, timezone text);
  CREATE TABLE location_stations (id uuid PRIMARY KEY, location_id uuid);
  CREATE TABLE time_punches (shift_id uuid);
  CREATE TABLE temporary_tasks (schedule_id uuid, is_active boolean, completed_at timestamptz);
  CREATE TABLE schedule_events (id uuid DEFAULT gen_random_uuid(), schedule_id uuid);
  CREATE TABLE profiles (id uuid, full_name text);
  CREATE TABLE schedules (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), week_start_date date NOT NULL, week_end_date date NOT NULL,
    created_by uuid, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), is_published boolean DEFAULT false,
    location_id uuid, published_shifts_snapshot jsonb, last_status_changed_at timestamptz, last_status_changed_by uuid, last_status_action text,
    original_shifts_snapshot jsonb, original_published_at timestamptz, original_published_by uuid, original_replace_on_next_post boolean NOT NULL DEFAULT false,
    approval_status text, approval_requested_by uuid, approval_requested_at timestamptz, approval_decided_by uuid, approval_decided_at timestamptz, approval_message text);
  CREATE TABLE scheduled_shifts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), schedule_id uuid REFERENCES schedules(id) ON DELETE CASCADE,
    template_id uuid, user_id uuid, day_of_week int NOT NULL, shift_date date NOT NULL, start_time time NOT NULL, end_time time NOT NULL,
    is_time_off boolean DEFAULT false, created_at timestamptz DEFAULT now(), was_trimmed boolean DEFAULT false, original_end_time time,
    is_phantom boolean NOT NULL DEFAULT false, station_id uuid, breaks jsonb NOT NULL DEFAULT '[]', is_coverage_only boolean NOT NULL DEFAULT false);
  CREATE TABLE schedule_change_log (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), schedule_id uuid NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
    user_id uuid, change_type text NOT NULL, old_shift_data jsonb, new_shift_data jsonb, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    changed_by uuid, is_draft boolean NOT NULL DEFAULT true, week_live boolean NOT NULL DEFAULT true, note text, shift_id uuid,
    source text NOT NULL DEFAULT 'edit', batch_id uuid, reverts_log_id uuid, undone_at timestamptz, undone_by uuid,
    CONSTRAINT schedule_change_log_source_check CHECK (source IN ('edit','shift_offer','undo','revert_original','revert_today','system')),
    CONSTRAINT schedule_change_log_change_type_check CHECK (change_type IN ('added','removed','time_changed','date_changed','reassigned','details_changed','published','withdrawn','update_sent','reverted','approval_requested','approved','sent_back')));
  CREATE TABLE today_override (d date);
  CREATE FUNCTION business_date(_location_id uuid, _at timestamptz DEFAULT now()) RETURNS date LANGUAGE sql AS
    $$ SELECT coalesce((SELECT d FROM today_override LIMIT 1), current_date) $$;
  CREATE FUNCTION _schedule_approval_required(uuid, uuid, uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
  CREATE FUNCTION _shift_change_desc(_r schedule_change_log) RETURNS text LANGUAGE sql AS $$ SELECT _r.change_type $$;
  CREATE FUNCTION _shift_cmp(_s jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
    SELECT jsonb_build_object('user_id', _s->'user_id', 'template_id', _s->'template_id', 'day_of_week', _s->'day_of_week',
      'shift_date', _s->'shift_date', 'start_time', _s->'start_time', 'end_time', _s->'end_time',
      'is_time_off', coalesce(_s->'is_time_off', 'false'::jsonb), 'was_trimmed', coalesce(_s->'was_trimmed', 'false'::jsonb),
      'original_end_time', _s->'original_end_time', 'station_id', _s->'station_id',
      'breaks', coalesce(_s->'breaks', '[]'::jsonb), 'is_coverage_only', coalesce(_s->'is_coverage_only', 'false'::jsonb)) $$;
  CREATE FUNCTION _invert_log_rows(_state jsonb, _rows schedule_change_log[]) RETURNS jsonb LANGUAGE plpgsql IMMUTABLE AS $$
  DECLARE r schedule_change_log; m jsonb := _state;
  BEGIN
    FOREACH r IN ARRAY _rows LOOP
      IF r.change_type = 'added' THEN m := m - r.shift_id::text;
      ELSIF r.old_shift_data IS NOT NULL THEN m := m || jsonb_build_object(r.shift_id::text, r.old_shift_data); END IF;
    END LOOP;
    RETURN m;
  END $$;
`;

async function setup() {
  const db = new PGlite();
  await db.exec(BASE);
  await db.exec(readFileSync('src/lib/__fixtures__/apply_schedule_state.sql', 'utf8'));
  await db.exec(readFileSync('src/lib/__fixtures__/trg_log_scheduled_shift_change.sql', 'utf8'));
  await db.exec(sql);
  await db.exec(`
    CREATE TRIGGER trg_log_scheduled_shift_change AFTER INSERT OR DELETE OR UPDATE ON scheduled_shifts FOR EACH ROW EXECUTE FUNCTION trg_log_scheduled_shift_change();
    CREATE TRIGGER trg_schedules_lifecycle BEFORE UPDATE ON schedules FOR EACH ROW EXECUTE FUNCTION trg_schedules_lifecycle();
    INSERT INTO editors VALUES ('${ids.mgr}', '${ids.loc}');
    INSERT INTO location_settings VALUES ('${ids.loc}', 'America/Los_Angeles');
    INSERT INTO location_stations VALUES ('${ids.st}', '${ids.loc}'), ('${ids.stOther}', '${ids.other}');
    INSERT INTO today_override VALUES ('2026-11-01');
    INSERT INTO schedules (id, location_id, week_start_date, week_end_date) VALUES ('${ids.src}', '${ids.loc}', '2026-11-16', '2026-11-22');
    INSERT INTO scheduled_shifts (schedule_id, user_id, day_of_week, shift_date, start_time, end_time, station_id) VALUES
      ('${ids.src}', '${ids.a}', 1, '2026-11-16', '09:00', '17:00', '${ids.st}'),
      ('${ids.src}', '${ids.b}', 2, '2026-11-17', '16:00', '00:00', '${ids.stOther}'),
      ('${ids.src}', NULL, 3, '2026-11-18', '11:00', '15:00', NULL),
      ('${ids.src}', NULL, 3, '2026-11-18', '11:00', '15:00', NULL);
    DELETE FROM schedule_change_log;
  `);
  return db;
}
const one = async <T,>(db: PGlite, q: string, p: unknown[] = []) => (await db.query<T>(q, p)).rows[0];

describe('one schedule per store per week', () => {
  it('rejects a second row for the same store and week', async () => {
    const db = await setup();
    try {
      await expect(db.query(`INSERT INTO schedules (location_id, week_start_date, week_end_date) VALUES ($1, '2026-11-16', '2026-11-22')`, [ids.loc])).rejects.toThrow(/schedules_location_week_uidx|duplicate key/);
      await expect(db.query(`INSERT INTO schedules (location_id, week_start_date, week_end_date) VALUES (NULL, '2026-12-07', '2026-12-13')`)).rejects.toThrow(/null/i);
    } finally { await db.close(); }
  }, 30000);
});

describe('copy_schedule_week', () => {
  it('copies into a new draft week as one labeled batch, carries own-store stations, and Undo removes it all', async () => {
    const db = await setup();
    try {
      const r = await one<{ r: any }>(db, `SELECT copy_schedule_week($1, '2026-11-23', 'copy', 'current') AS r`, [ids.src]);
      expect(r.r).toMatchObject({ added: 4, skipped: 0 });
      const tgt = r.r.target_schedule_id;
      const shifts = (await db.query<any>(`SELECT shift_date::text, station_id, user_id FROM scheduled_shifts WHERE schedule_id = $1 ORDER BY shift_date, start_time`, [tgt])).rows;
      expect(shifts.map(s => s.shift_date)).toEqual(['2026-11-23', '2026-11-24', '2026-11-25', '2026-11-25']);
      expect(shifts[0].station_id).toBe(ids.st);
      expect(shifts[1].station_id).toBeNull(); // other store's station is never carried
      const log = (await db.query<any>(`SELECT change_type, source, batch_id, note FROM schedule_change_log WHERE schedule_id = $1`, [tgt])).rows;
      expect(log.filter(l => l.change_type === 'added')).toHaveLength(4);
      const header = log.find(l => l.change_type === 'copied');
      expect(header.note).toBe('Copied from week of Nov 16: 4 shifts');
      expect(new Set(log.map(l => l.batch_id)).size).toBe(1);
      expect(log.every(l => l.source === 'copy')).toBe(true);

      const u = await one<{ r: any }>(db, `SELECT undo_schedule_change($1) AS r`, [tgt]);
      expect(u.r.description).toBe('Copy (4 changes)');
      expect((await one<{ n: number }>(db, `SELECT count(*)::int n FROM scheduled_shifts WHERE schedule_id = $1`, [tgt])).n).toBe(0);
      expect((await one<{ n: number }>(db, `SELECT count(*)::int n FROM schedule_change_log WHERE schedule_id = $1 AND change_type = 'copied' AND undone_at IS NOT NULL`, [tgt])).n).toBe(1);
    } finally { await db.close(); }
  }, 30000);

  it('refuses copy-mode onto drafts, merges skipping exact dupes (open slots counted), writes one summary line', async () => {
    const db = await setup();
    try {
      await db.exec(`INSERT INTO schedules (id, location_id, week_start_date, week_end_date) VALUES ('${ids.tgt}', '${ids.loc}', '2026-11-23', '2026-11-29');
        INSERT INTO scheduled_shifts (schedule_id, user_id, day_of_week, shift_date, start_time, end_time) VALUES
          ('${ids.tgt}', '${ids.a}', 1, '2026-11-23', '09:00', '17:00'), ('${ids.tgt}', NULL, 3, '2026-11-25', '11:00', '15:00');`);
      await expect(db.query(`SELECT copy_schedule_week($1, '2026-11-23', 'copy')`, [ids.src])).rejects.toThrow('target_has_shifts');
      const r = await one<{ r: any }>(db, `SELECT copy_schedule_week($1, '2026-11-23', 'merge') AS r`, [ids.src]);
      expect(r.r).toMatchObject({ added: 2, skipped: 2, target_schedule_id: ids.tgt });
      expect((await one<{ n: number }>(db, `SELECT count(*)::int n FROM scheduled_shifts WHERE schedule_id = $1`, [ids.tgt])).n).toBe(4);
      const h = await one<{ note: string }>(db, `SELECT note FROM schedule_change_log WHERE change_type = 'copied'`);
      expect(h.note).toBe('Merged from week of Nov 16: 2 added, 2 duplicates skipped');
      expect((await one<{ n: number }>(db, `SELECT count(*)::int n FROM schedules WHERE location_id = $1 AND week_start_date = '2026-11-23'`, [ids.loc])).n).toBe(1);
    } finally { await db.close(); }
  }, 30000);

  it('a posted target is refused with no write and no record; strangers are refused', async () => {
    const db = await setup();
    try {
      await db.exec(`INSERT INTO schedules (id, location_id, week_start_date, week_end_date, is_published, published_shifts_snapshot) VALUES ('${ids.live}', '${ids.loc}', '2026-11-30', '2026-12-06', true, '[]');`);
      await expect(db.query(`SELECT copy_schedule_week($1, '2026-11-30', 'merge')`, [ids.src])).rejects.toThrow('target_is_live');
      expect((await one<{ n: number }>(db, `SELECT count(*)::int n FROM scheduled_shifts WHERE schedule_id = $1`, [ids.live])).n).toBe(0);
      expect((await one<{ n: number }>(db, `SELECT count(*)::int n FROM schedule_change_log`)).n).toBe(0);
      await db.exec(`UPDATE auth_uid SET id = '${ids.other}'`);
      await expect(db.query(`SELECT copy_schedule_week($1, '2026-12-07', 'copy')`, [ids.src])).rejects.toThrow('permission denied');
    } finally { await db.close(); }
  }, 30000);
});

describe('clear_schedule_drafts', () => {
  it('unposted week: deletes drafts except punched ones, never touches publish state, Undo restores', async () => {
    const db = await setup();
    try {
      await db.exec(`INSERT INTO time_punches SELECT id FROM scheduled_shifts WHERE user_id = '${ids.a}'`);
      const r = await one<{ r: any }>(db, `SELECT clear_schedule_drafts($1) AS r`, [ids.src]);
      expect(r.r).toMatchObject({ shifts_affected: 3, skipped_punched: 1, week_live: false });
      expect((await one<{ n: number }>(db, `SELECT count(*)::int n FROM scheduled_shifts WHERE schedule_id = $1`, [ids.src])).n).toBe(1);
      const h = await one<{ note: string; source: string }>(db, `SELECT note, source FROM schedule_change_log WHERE change_type = 'cleared_drafts'`);
      expect(h).toMatchObject({ note: 'Cleared drafts: 3 changes, 1 skipped (worked or punched)', source: 'clear_drafts' });
      const u = await one<{ r: any }>(db, `SELECT undo_schedule_change($1) AS r`, [ids.src]);
      expect(u.r.description).toBe('Clear drafts (3 changes)');
      expect((await one<{ n: number }>(db, `SELECT count(*)::int n FROM scheduled_shifts WHERE schedule_id = $1`, [ids.src])).n).toBe(4);
    } finally { await db.close(); }
  }, 30000);

  it('posted week: restores the posted snapshot (adds out, edits back, deletes back) and stays posted', async () => {
    const db = await setup();
    try {
      await db.exec(`UPDATE schedules SET is_published = true, published_shifts_snapshot = (SELECT jsonb_agg(to_jsonb(s)) FROM scheduled_shifts s WHERE s.schedule_id = '${ids.src}') WHERE id = '${ids.src}'`);
      await db.exec(`
        INSERT INTO scheduled_shifts (schedule_id, user_id, day_of_week, shift_date, start_time, end_time) VALUES ('${ids.src}', '${ids.b}', 4, '2026-11-19', '08:00', '12:00');
        UPDATE scheduled_shifts SET station_id = NULL WHERE user_id = '${ids.a}';
        DELETE FROM scheduled_shifts WHERE user_id = '${ids.b}' AND shift_date = '2026-11-17';`);
      const r = await one<{ r: any }>(db, `SELECT clear_schedule_drafts($1) AS r`, [ids.src]);
      expect(r.r).toMatchObject({ shifts_affected: 3, week_live: true });
      const s = await one<any>(db, `SELECT is_published, jsonb_array_length(published_shifts_snapshot) n FROM schedules WHERE id = $1`, [ids.src]);
      expect(s).toMatchObject({ is_published: true, n: 4 });
      const cur = (await db.query<any>(`SELECT user_id, shift_date::text, station_id FROM scheduled_shifts WHERE schedule_id = $1 ORDER BY shift_date, start_time`, [ids.src])).rows;
      expect(cur).toHaveLength(4);
      expect(cur[0]).toMatchObject({ user_id: ids.a, station_id: ids.st });
      expect(cur.some(c => c.shift_date === '2026-11-19')).toBe(false);
    } finally { await db.close(); }
  }, 30000);

  it('Withdraw on an empty week logs plain withdrawn (no "Cleared" note)', async () => {
    const db = await setup();
    try {
      await db.exec(`INSERT INTO schedules (id, location_id, week_start_date, week_end_date, is_published, published_shifts_snapshot) VALUES ('${ids.live}', '${ids.loc}', '2026-11-30', '2026-12-06', true, '[]');
        UPDATE schedules SET is_published = false, published_shifts_snapshot = NULL WHERE id = '${ids.live}';`);
      const w = await one<{ note: string | null }>(db, `SELECT note FROM schedule_change_log WHERE change_type = 'withdrawn'`);
      expect(w.note).toBeNull();
      expect((await one<{ n: number }>(db, `SELECT count(*)::int n FROM scheduled_shifts`)).n).toBe(4);
    } finally { await db.close(); }
  }, 30000);
});

describe('purge_completed_week_change_log', () => {
  it('purges every week whose last shift ended more than 84 days (12 weeks) ago (overnight by its end), keeps the rest', async () => {
    const db = await setup();
    try {
      const mk = async (id: string, ws: string, shifts: [string, string, string][]) => {
        await db.query(`INSERT INTO schedules (id, location_id, week_start_date, week_end_date) VALUES ($1, $2, $3::date, $3::date + 6)`, [id, ids.loc, ws]);
        for (const [d, st, en] of shifts) await db.query(`INSERT INTO scheduled_shifts (schedule_id, user_id, day_of_week, shift_date, start_time, end_time) VALUES ($1, $2, 0, $3, $4, $5)`, [id, ids.a, d, st, en]);
        await db.query(`INSERT INTO schedule_change_log (schedule_id, change_type, note) VALUES ($1, 'published', 'x')`, [id]);
      };
      const day = (n: number) => (new Date(Date.now() + n * 86400000)).toISOString().slice(0, 10);
      await mk(U(100), day(-120), [[day(-118), '09:00', '17:00']]);       // long done
      await mk(U(101), day(-110), [[day(-105), '09:00', '17:00']]);       // also done: older weeks go in the same run
      await mk(U(102), day(-92), []);                                      // empty: week_start + 7 = 85 days ago -> purge
      await mk(U(103), day(-90), []);                                      // empty: week_start + 7 = 83 days ago -> keep
      await mk(U(104), day(-93), [[day(-86), '22:00', '21:00']]);         // overnight, ends next day 21:00 (~85 days ago) -> purge
      await mk(U(105), day(-2), [[day(1), '09:00', '17:00']]);            // current/future -> keep
      await mk(U(106), day(-30), [[day(-25), '09:00', '17:00']]);         // ended 25 days ago: inside 12 weeks -> keep
      await db.query(`INSERT INTO schedule_change_log (schedule_id, change_type, user_id, shift_id, note) VALUES ($1, 'reassigned', $2, gen_random_uuid(), 'stats')`, [U(101), ids.a]);
      const before = await one<any>(db, `SELECT count(*)::int n FROM scheduled_shifts`);
      const n = await one<{ n: number }>(db, `SELECT purge_completed_week_change_log() AS n`);
      const left = (await db.query<{ schedule_id: string; note: string }>(`SELECT schedule_id, note FROM schedule_change_log ORDER BY schedule_id`)).rows;
      expect(left.find(r => r.schedule_id === U(100))).toBeUndefined();
      expect(left.some(r => r.schedule_id === U(101))).toBe(false); // no separate exception: reassigned/removed rows go too
      expect(left.some(r => r.schedule_id === U(102))).toBe(false);
      expect(left.some(r => r.schedule_id === U(104))).toBe(false);
      expect(left.some(r => r.schedule_id === U(103))).toBe(true);
      expect(left.some(r => r.schedule_id === U(105))).toBe(true);
      expect(left.some(r => r.schedule_id === U(106))).toBe(true);
      expect(n.n).toBe(5);
      expect((await one<any>(db, `SELECT count(*)::int n FROM scheduled_shifts`)).n).toBe(before.n);
      expect((await one<{ c: boolean }>(db, `SELECT _schedule_week_completed($1) c`, [U(105)])).c).toBe(false);
      // Overnight shifts count by their end, in the store's time zone.
      const end = await one<{ t: string }>(db, `SELECT (_schedule_week_completed_at($1) AT TIME ZONE 'America/Los_Angeles')::text t`, [U(104)]);
      expect(end.t).toBe(`${day(-85)} 21:00:00`);
    } finally { await db.close(); }
  }, 30000);
});
