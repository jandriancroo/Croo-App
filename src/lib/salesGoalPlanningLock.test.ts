// @vitest-environment node
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

async function setup() {
  const db = new PGlite();
  await db.exec(`CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT NULL::uuid $$;
    CREATE FUNCTION public._can_override_goal(uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
    CREATE FUNCTION public.business_date(uuid) RETURNS date LANGUAGE sql AS $$ SELECT DATE '2026-11-02' $$;
    CREATE TABLE sales_cache (id int PRIMARY KEY, location_id uuid, sale_date date, net_sales numeric,
      initial_projection numeric, living_projection numeric, projected_sales numeric, override_projection numeric,
      override_at timestamptz, override_by uuid, override_excluded_dates jsonb);
  `);
  await db.exec(readFileSync('drizzle/migrations/0079_daily_goal_planning_insert_once.sql', 'utf8'));
  await db.exec('CREATE TRIGGER guard BEFORE INSERT OR UPDATE ON sales_cache FOR EACH ROW EXECUTE FUNCTION guard_sales_cache_goals()');
  return db;
}
describe('Planning insert-once lock', () => {
  it('allows NULL Planning to fill once and blocks later service-role changes, including zero', async () => {
    const db = await setup();
    try {
      await db.exec("INSERT INTO sales_cache(id,sale_date) VALUES (1,'2026-11-09'); UPDATE sales_cache SET initial_projection=0 WHERE id=1");
      await expect(db.exec('UPDATE sales_cache SET initial_projection=100 WHERE id=1')).rejects.toMatchObject({ code: '42501', message: 'Planning goal is locked' });
      await expect(db.exec('UPDATE sales_cache SET initial_projection=NULL WHERE id=1')).rejects.toMatchObject({ code: '42501' });
    } finally { await db.close(); }
  }, 20000);
  it('keeps actuals, Living and identical Planning updates writable', async () => {
    const db = await setup();
    try {
      await db.exec("INSERT INTO sales_cache(id,sale_date,initial_projection) VALUES (1,'2026-11-09',100); UPDATE sales_cache SET initial_projection=100,living_projection=120,net_sales=412.35 WHERE id=1");
      expect((await db.query('SELECT initial_projection,living_projection,net_sales FROM sales_cache')).rows[0]).toEqual({ initial_projection: '100', living_projection: '120', net_sales: '412.35' });
    } finally { await db.close(); }
  }, 20000);
  it('permits an explicit migration backfill switch only', async () => {
    const db = await setup();
    try {
      await db.exec("INSERT INTO sales_cache(id,initial_projection) VALUES (1,100); SET croo.goal_backfill='on'; UPDATE sales_cache SET initial_projection=200 WHERE id=1");
      expect((await db.query('SELECT initial_projection FROM sales_cache')).rows[0]).toEqual({ initial_projection: '200' });
    } finally { await db.close(); }
  }, 20000);
  it('preserves the existing non-service goal-write prohibition', async () => {
    const db = await setup();
    try {
      await db.exec(`SET request.jwt.claims='{"role":"authenticated"}'`);
      await expect(db.exec('INSERT INTO sales_cache(id,living_projection) VALUES(1,100)')).rejects.toMatchObject({ code: '42501', message: 'Planning/Living goals are system-managed' });
    } finally { await db.close(); }
  }, 20000);
});