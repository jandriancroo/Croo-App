// @vitest-environment node
// Equipment-check alert (migration 20261117193000, section 4) on a real Postgres (PGlite).
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const LOC = '20000000-0000-0000-0000-000000000001';
const OTHER = '20000000-0000-0000-0000-000000000002';
const CL = '30000000-0000-0000-0000-000000000001';
const CL_V2 = '30000000-0000-0000-0000-000000000002';
const WALKIN = '10000000-0000-0000-0000-000000000001';
const WALKIN_V2 = '10000000-0000-0000-0000-000000000002';
const UNTAGGED = '10000000-0000-0000-0000-000000000003';
const MGR = '00000000-0000-0000-0000-0000000000a1';
const GM_OTHER = '00000000-0000-0000-0000-0000000000a2';
const SHIFT = '00000000-0000-0000-0000-0000000000b1';
const CREW = '00000000-0000-0000-0000-0000000000c1';
const SUB1 = '40000000-0000-0000-0000-000000000001';

const migration = readFileSync('supabase/migrations/20261117193000_temp_equipment_tags_and_check_alerts.sql', 'utf8');
const section4 = migration.slice(migration.indexOf('-- 4 ---'));

async function setup() {
  const db = new PGlite();
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('test.uid', true), '')::uuid $$;
    GRANT USAGE ON SCHEMA auth TO authenticated; GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;
    CREATE TABLE locations(id uuid PRIMARY KEY, name text);
    CREATE TABLE location_settings(location_id uuid, timezone text);
    CREATE TABLE checklists(id uuid PRIMARY KEY, family_id uuid, location_id uuid);
    CREATE TABLE checklist_items(id uuid PRIMARY KEY, checklist_id uuid, question text, equipment_type text);
    CREATE TABLE checklist_submissions(id uuid PRIMARY KEY, location_id uuid);
    CREATE TABLE checklist_responses(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), submission_id uuid, item_id uuid,
      extracted_temperature numeric, temperature_valid boolean, temperature_validated_at timestamptz, created_at timestamptz DEFAULT now());
    CREATE TABLE profiles(id uuid PRIMARY KEY, full_name text, is_active boolean DEFAULT true);
    CREATE TABLE user_locations(user_id uuid, location_id uuid);
    CREATE TABLE user_roles(user_id uuid, role text);
    CREATE TABLE alert_queue(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), alert_type text, dedup_key text UNIQUE, location_id uuid, payload jsonb);
    CREATE FUNCTION has_location_access(_user_id uuid, _location_id uuid) RETURNS boolean LANGUAGE sql SECURITY DEFINER
      AS $$ SELECT EXISTS (SELECT 1 FROM user_locations WHERE user_id = _user_id AND location_id = _location_id) $$;
    CREATE FUNCTION _is_shift_manager_plus(_user_id uuid) RETURNS boolean LANGUAGE sql SECURITY DEFINER
      AS $$ SELECT EXISTS (SELECT 1 FROM user_roles WHERE user_id = _user_id AND role IN ('manager','general_manager','admin','org_admin','brand_admin','super_admin')) $$;
    INSERT INTO auth.users VALUES ('${MGR}'),('${GM_OTHER}'),('${SHIFT}'),('${CREW}');
    INSERT INTO locations VALUES ('${LOC}','Sparks'),('${OTHER}','Reno');
    INSERT INTO location_settings VALUES ('${LOC}','America/Los_Angeles');
    INSERT INTO checklists VALUES ('${CL}','${CL}','${LOC}'),('${CL_V2}','${CL}','${LOC}');
    INSERT INTO checklist_items VALUES ('${WALKIN}','${CL}','TEMP - Walk-In Cooler','walk_in'),
      ('${WALKIN_V2}','${CL_V2}','TEMP - Walk-In Cooler','walk_in'),('${UNTAGGED}','${CL}','TEMP - Tomatoes',NULL);
    INSERT INTO checklist_submissions VALUES ('${SUB1}','${LOC}');
    INSERT INTO profiles(id, full_name) VALUES ('${MGR}','Jose Manager'),('${GM_OTHER}','Other GM'),('${SHIFT}','Sam Shift'),('${CREW}','Cara Crew');
    INSERT INTO user_locations VALUES ('${MGR}','${LOC}'),('${SHIFT}','${LOC}'),('${CREW}','${LOC}'),('${GM_OTHER}','${OTHER}');
    INSERT INTO user_roles VALUES ('${MGR}','manager'),('${GM_OTHER}','general_manager'),('${SHIFT}','shift_manager'),('${CREW}','team_member');`);
  await db.exec(section4);
  return db;
}
const as = (db: PGlite, uid: string | null) => db.exec(`RESET ROLE; SET test.uid = '${uid ?? ''}'` + (uid ? '; SET ROLE authenticated' : ''));
const reading = (db: PGlite, item: string, temp: number, valid: boolean, at: string) =>
  db.query(`INSERT INTO checklist_responses(submission_id, item_id, extracted_temperature, temperature_valid, temperature_validated_at, created_at) VALUES ($1,$2,$3,$4,$5,$5)`,
    [SUB1, item, temp, valid, at]);
const today = new Date();
const iso = (daysAgo: number, hourUtc = 18) => { const d = new Date(today); d.setUTCDate(d.getUTCDate() - daysAgo); d.setUTCHours(hourUtc, 0, 0, 0); return d.toISOString(); };
const count = async (db: PGlite, sql: string) => Number(((await db.query(sql)).rows[0] as { n: number }).n);

describe('equipment-check alert', () => {
  it('fires once when the same unit fails on 2 separate days, email/push to managers+ with store access only', async () => {
    const db = await setup();
    try {
      await reading(db, WALKIN, 46.2, false, iso(1));
      expect(await count(db, 'SELECT count(*) n FROM equipment_check_alerts')).toBe(0);
      await reading(db, WALKIN_V2, 44.8, false, iso(0)); // new checklist version, same unit
      const alerts = (await db.query('SELECT * FROM equipment_check_alerts')).rows as any[];
      expect(alerts).toHaveLength(1);
      expect(alerts[0]).toMatchObject({ unit_name: 'TEMP - Walk-In Cooler', location_name: 'Sparks', equipment_type: 'walk_in' });
      expect(alerts[0].readings.map((r: any) => Number(r.temp))).toEqual([46.2, 44.8]);
      const q = (await db.query('SELECT * FROM alert_queue')).rows as any[];
      expect(q).toHaveLength(1);
      expect(q[0].payload.user_ids).toEqual([MGR]); // not shift manager, not crew, not another store's GM
      expect(q[0].payload.notification_type).toBe('equipment_check');
      expect(q[0].payload.body).toBe('TEMP - Walk-In Cooler at Sparks failed temp checks 2 days in a row (44.8°F).');
      // Same streak: no second alert.
      await reading(db, WALKIN, 45, false, iso(0, 20));
      expect(await count(db, 'SELECT count(*) n FROM equipment_check_alerts')).toBe(1);
      expect(await count(db, 'SELECT count(*) n FROM alert_queue')).toBe(1);
    } finally { await db.close(); }
  }, 30000);

  it('does not fire for one failed day, passing readings, or untagged items', async () => {
    const db = await setup();
    try {
      await reading(db, WALKIN, 46, false, iso(0, 15));
      await reading(db, WALKIN, 47, false, iso(0, 20));
      await reading(db, WALKIN, 38, true, iso(1));
      await reading(db, UNTAGGED, 60, false, iso(1));
      await reading(db, UNTAGGED, 60, false, iso(0));
      expect(await count(db, 'SELECT count(*) n FROM equipment_check_alerts')).toBe(0);
      // Failures 3 days apart are not "within 2 days".
      await reading(db, WALKIN, 46, false, iso(3));
      expect(await count(db, 'SELECT count(*) n FROM equipment_check_alerts')).toBe(0);
    } finally { await db.close(); }
  }, 30000);

  it('badge rows and acknowledge are manager-and-up with store access only (server side)', async () => {
    const db = await setup();
    try {
      await reading(db, WALKIN, 46.2, false, iso(1));
      await reading(db, WALKIN, 44.8, false, iso(0));
      const id = ((await db.query('SELECT id FROM equipment_check_alerts')).rows[0] as any).id;
      for (const uid of [CREW, SHIFT, GM_OTHER]) {
        await as(db, uid);
        expect(await count(db, 'SELECT count(*) n FROM equipment_check_alerts')).toBe(0);
        await expect(db.query('SELECT acknowledge_equipment_check($1)', [id])).rejects.toMatchObject({ code: '42501' });
        await expect(db.query('UPDATE equipment_check_alerts SET acknowledged_at = now()')).rejects.toBeTruthy();
      }
      await as(db, MGR);
      expect(await count(db, 'SELECT count(*) n FROM equipment_check_alerts')).toBe(1);
      await db.query('SELECT acknowledge_equipment_check($1)', [id]);
      await as(db, null);
      const row = (await db.query('SELECT acknowledged_by, acknowledged_by_name, acknowledged_at FROM equipment_check_alerts')).rows[0] as any;
      expect(row).toMatchObject({ acknowledged_by: MGR, acknowledged_by_name: 'Jose Manager' });
      expect(row.acknowledged_at).toBeTruthy();
    } finally { await db.close(); }
  }, 30000);

  it('the alert check function is locked down (search_path, no execute for public/anon/authenticated)', async () => {
    const db = await setup();
    try {
      const fn = (await db.query(`SELECT prosecdef, proconfig, has_function_privilege('authenticated', oid, 'EXECUTE') auth_x, has_function_privilege('anon', oid, 'EXECUTE') anon_x FROM pg_proc WHERE proname = '_equipment_check_on_temp'`)).rows[0] as any;
      expect(fn.prosecdef).toBe(true);
      expect(fn.proconfig).toEqual(['search_path=public, pg_temp']);
      expect(fn.auth_x).toBe(false);
      expect(fn.anon_x).toBe(false);
    } finally { await db.close(); }
  }, 30000);
});
