// @vitest-environment node
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const staff = '00000000-0000-0000-0000-0000000000b1';
const outsider = '00000000-0000-0000-0000-0000000000b2';
const google = '20000000-0000-0000-0000-000000000001';
const ovation = '20000000-0000-0000-0000-000000000002';

async function setup() {
  const db = new PGlite();
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA auth; CREATE SCHEMA cron;
    CREATE TABLE cron.job(jobid serial PRIMARY KEY, jobname text, schedule text, command text);
    CREATE FUNCTION cron.schedule(text, text, text) RETURNS bigint LANGUAGE sql AS $$ INSERT INTO cron.job(jobname, schedule, command) VALUES ($1,$2,$3) RETURNING jobid $$;
    CREATE FUNCTION cron.unschedule(bigint) RETURNS boolean LANGUAGE sql AS $$ DELETE FROM cron.job WHERE jobid = $1 RETURNING true $$;
    GRANT USAGE ON SCHEMA auth TO authenticated, anon;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('test.uid', true), '')::uuid $$;
    CREATE TABLE locations(id uuid PRIMARY KEY);
    CREATE TABLE ovation_location_mappings(location_id uuid, ovation_location_id text);
    CREATE FUNCTION has_location_access(uuid, uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT $1 = '${staff}'::uuid $$;
    INSERT INTO locations VALUES ('${google}'),('${ovation}');
    INSERT INTO ovation_location_mappings VALUES ('${ovation}','ov-1');`);
  await db.exec(readFileSync('supabase/migrations/20261112200100_location_google_reviews.sql', 'utf8'));
  await db.exec(`INSERT INTO location_google_reviews(location_id, place_id, rating, user_rating_count) VALUES
    ('${google}','ChIJgoogle000001',4.5,10),('${ovation}','ChIJovation00001',4.1,5)`);
  return db;
}
async function asUser(db: PGlite, role: 'authenticated' | 'anon', uid: string | null) {
  await db.exec(`SET test.uid = '${uid ?? ''}'; SET ROLE ${role};`);
}

describe('location_google_reviews access', () => {
  it('store staff read their row; outsiders and anon read nothing', async () => {
    const db = await setup();
    try {
      await asUser(db, 'authenticated', staff);
      expect((await db.query(`SELECT location_id FROM location_google_reviews`)).rows.length).toBe(2);
      await asUser(db, 'authenticated', outsider);
      expect((await db.query(`SELECT location_id FROM location_google_reviews`)).rows.length).toBe(0);
      await db.exec('RESET ROLE');
      await asUser(db, 'anon', null);
      await expect(db.query(`SELECT 1 FROM location_google_reviews`)).rejects.toMatchObject({ code: '42501' });
      await expect(db.query(`SELECT * FROM get_location_google_reviews('${google}')`)).rejects.toMatchObject({ code: '42501' });
    } finally { await db.close(); }
  }, 20000);

  it('signed-in users cannot write', async () => {
    const db = await setup();
    try {
      await asUser(db, 'authenticated', staff);
      await expect(db.query(`UPDATE location_google_reviews SET rating = 5`)).rejects.toMatchObject({ code: '42501' });
      await expect(db.query(`INSERT INTO location_google_reviews(location_id, place_id) VALUES ('${google}','x')`)).rejects.toMatchObject({ code: '42501' });
      await expect(db.query(`DELETE FROM location_google_reviews`)).rejects.toMatchObject({ code: '42501' });
    } finally { await db.close(); }
  }, 20000);

  it('the app RPC hides Ovation stores and stores the caller cannot see', async () => {
    const db = await setup();
    try {
      await asUser(db, 'authenticated', staff);
      expect((await db.query(`SELECT * FROM get_location_google_reviews('${google}')`)).rows.length).toBe(1);
      expect((await db.query(`SELECT * FROM get_location_google_reviews('${ovation}')`)).rows.length).toBe(0);
      await asUser(db, 'authenticated', outsider);
      expect((await db.query(`SELECT * FROM get_location_google_reviews('${google}')`)).rows.length).toBe(0);
    } finally { await db.close(); }
  }, 20000);

  it('wakes hourly and only calls during 8 AM-10 PM Eastern (DST-safe)', async () => {
    const db = await setup();
    try {
      const jobs = (await db.query<{ schedule: string; command: string }>(`SELECT schedule, command FROM cron.job WHERE jobname = 'google-reviews-refresh'`)).rows;
      expect(jobs).toHaveLength(1);
      expect(jobs[0].schedule).toBe('17 * * * *');
      expect(jobs[0].command).toContain('WHERE public._google_reviews_refresh_due()');
      const due = async (ts: string) => ((await db.query<{ d: boolean }>(`SELECT public._google_reviews_refresh_due('${ts}'::timestamptz) AS d`)).rows[0].d);
      expect(await due('2026-07-01T12:17:00Z')).toBe(true);  // 8:17 EDT
      expect(await due('2026-07-01T11:17:00Z')).toBe(false); // 7:17 EDT
      expect(await due('2026-07-02T02:17:00Z')).toBe(true);  // 10:17 PM EDT
      expect(await due('2026-07-02T03:17:00Z')).toBe(false); // 11:17 PM EDT
      expect(await due('2026-12-02T13:17:00Z')).toBe(true);  // 8:17 EST
      expect(await due('2026-12-02T12:17:00Z')).toBe(false); // 7:17 EST
      expect(await due('2026-12-03T03:17:00Z')).toBe(true);  // 10:17 PM EST
      expect(await due('2026-12-03T04:17:00Z')).toBe(false); // 11:17 PM EST
      await db.exec(`UPDATE location_google_reviews SET active = false`);
      expect(await due('2026-12-02T15:17:00Z')).toBe(false);
    } finally { await db.close(); }
  }, 20000);

  it('stores the last full pull time', async () => {
    const db = await setup();
    try {
      const cols = (await db.query<{ column_name: string }>(`SELECT column_name FROM information_schema.columns WHERE table_name = 'location_google_reviews'`)).rows.map(r => r.column_name);
      expect(cols).toEqual(expect.arrayContaining(['user_rating_count', 'last_full_fetch_at', 'fetched_at', 'reviews']));
    } finally { await db.close(); }
  }, 20000);
});
