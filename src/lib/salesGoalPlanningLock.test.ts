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
  await db.exec(readFileSync('drizzle/migrations/0081_daily_goal_past_living_freeze.sql', 'utf8'));
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
describe('Past Living freeze', () => {
  it('blocks service changes and inserts for yesterday, but preserves actuals and today', async () => {
    const db = await setup();
    try {
      await db.exec("SET croo.goal_backfill='on'; INSERT INTO sales_cache(id,sale_date,living_projection) VALUES(1,'2026-11-01',900); SET croo.goal_backfill='off'");
      await expect(db.exec('UPDATE sales_cache SET living_projection=1000 WHERE id=1')).rejects.toMatchObject({code:'42501', message:'Past goals are locked'});
      await expect(db.exec("INSERT INTO sales_cache(id,sale_date,living_projection) VALUES(2,'2026-11-01',1000)")).rejects.toMatchObject({code:'42501'});
      await db.exec("UPDATE sales_cache SET net_sales=123.45 WHERE id=1; INSERT INTO sales_cache(id,sale_date,living_projection) VALUES(3,'2026-11-02',1000)");
      expect((await db.query('SELECT net_sales FROM sales_cache WHERE id=1')).rows[0]).toEqual({net_sales:'123.45'});
    } finally { await db.close(); }
  }, 20000);
  it('allows explicit backfill of historical Living', async () => {
    const db = await setup();
    try {
      await db.exec("SET croo.goal_backfill='on'; INSERT INTO sales_cache(id,sale_date,living_projection) VALUES(1,'2026-11-01',900); UPDATE sales_cache SET living_projection=1000 WHERE id=1");
      expect((await db.query('SELECT living_projection FROM sales_cache')).rows[0]).toEqual({living_projection:'1000'});
    } finally { await db.close(); }
  }, 20000);
});

describe('Legacy backfill safety', () => {
  it('backs up every legacy row, fills only double-null gaps, clears legacy and preserves monthly totals', async () => {
    const db = await setup();
    try {
      await db.exec(`CREATE ROLE service_role; CREATE ROLE anon; CREATE ROLE authenticated;
        CREATE TABLE schedule_projected_sales(id int);
        CREATE FUNCTION _schedule_week_labor_check(uuid) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$;
        INSERT INTO sales_cache(id,location_id,sale_date,projected_sales,initial_projection,living_projection,override_projection) VALUES
          (1,'00000000-0000-0000-0000-000000000001','2026-11-02',100,NULL,NULL,NULL),
          (2,'00000000-0000-0000-0000-000000000001','2026-11-03',900,200,NULL,NULL),
          (3,'00000000-0000-0000-0000-000000000001','2026-11-04',900,200,300,NULL),
          (4,'00000000-0000-0000-0000-000000000001','2026-11-05',900,200,300,400);
        BEGIN;`);
      await db.exec(readFileSync('drizzle/migrations/0080_daily_goal_legacy_backfill_and_resolver.sql', 'utf8'));
      await db.exec('COMMIT');
      expect((await db.query('SELECT count(*)::int AS n FROM sales_goal_legacy_backup_20261101')).rows[0]).toEqual({n:4});
      expect((await db.query('SELECT initial_projection,living_projection,projected_sales FROM sales_cache WHERE id=1')).rows[0]).toEqual({initial_projection:'100',living_projection:null,projected_sales:null});
      expect((await db.query('SELECT initial_projection,living_projection FROM sales_cache WHERE id=2')).rows[0]).toEqual({initial_projection:'200',living_projection:null});
      expect((await db.query('SELECT sum(coalesce(nullif(override_projection,0),living_projection,initial_projection,0)) AS total FROM sales_cache')).rows[0]).toEqual({total:'1000'});
      expect((await db.query('SELECT count(*)::int AS n FROM sales_cache WHERE projected_sales IS NOT NULL')).rows[0]).toEqual({n:0});
    } finally { await db.close(); }
  }, 20000);
});
