// @vitest-environment node
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const ids = ['852fcf73-2686-4a6d-9134-0f3ac0655a9a','9838fbb4-88e4-420f-a97e-165d8dcee936','c4982065-de7f-4c32-ab38-52125d2fea42','7b8a2011-4c18-4d01-a896-68bac8cd94f7','d9ad73a4-aa52-4515-8967-82843542153c','90b3df95-ad3c-4693-9588-87f6f04c1b25','32ab6435-54d6-4f8f-8245-b8903e35ee6c','c1e1a063-1c6b-4cf8-aac4-6c5894b0e26c'];
const user = '00000000-0000-0000-0000-000000000001';
async function setup() {
  const db = new PGlite();
  await db.exec(`CREATE ROLE service_role; CREATE ROLE anon; CREATE ROLE authenticated;
    CREATE SCHEMA auth;
    CREATE TYPE app_role AS ENUM ('shift_manager','shift_manager_in_training','scheduling_manager','team_member','manager','general_manager','admin','org_admin','fbc','brand_admin','super_admin');
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT '${user}'::uuid $$;
    CREATE FUNCTION get_user_role(uuid) RETURNS app_role LANGUAGE sql AS $$ SELECT 'shift_manager'::app_role $$;
    CREATE FUNCTION has_role_or_higher(uuid,text) RETURNS boolean LANGUAGE sql AS $$ SELECT current_setting('test.role',true) IN ('manager','general_manager','admin','org_admin','fbc','brand_admin','super_admin') $$;
    CREATE FUNCTION _validate_widget_authority(uuid,text,uuid,uuid,uuid,uuid) RETURNS void LANGUAGE plpgsql AS $$ BEGIN END $$;
    CREATE TABLE dashboard_widgets(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),widget_type text,config jsonb,display_order int,created_by uuid,authority_scope text,brand_id uuid,organization_id uuid,location_id uuid,audience_roles app_role[],title text,accent_color text,widget_size text,reference_id uuid);`);
  for (const [index, id] of ids.entries()) {
    await db.query(`INSERT INTO dashboard_widgets(id,widget_type,authority_scope,audience_roles,created_by) VALUES($1,'data-3d',$2,$3,$4)`, [id,index < 4 ? 'org' : 'self',index < 4 ? ['shift_manager'] : null,user]);
  }
  await db.exec(`INSERT INTO dashboard_widgets(id,widget_type,authority_scope,created_by) VALUES('585e5e16-0000-0000-0000-000000000000','sales-chart','org','${user}'),('1421546b-9fe1-4aff-8e91-aa275e86b965','sales-chart','org','${user}'),('00000000-0000-0000-0000-000000000002','data-3d','org','${user}')`);
  await db.exec(readFileSync('drizzle/migrations/0083_dashboard_cube_manager_add_guard.sql','utf8'));
  return db;
}

describe('Manager-only cube creation and guarded cleanup', () => {
  it.each(['shift_manager','shift_manager_in_training','scheduling_manager','team_member'])('blocks both cube types for %s but permits Sales Overview', async role => {
    const db = await setup();
    try {
      await db.exec(`SET test.role='${role}'`);
      for (const type of ['data','data-3d']) {
        await expect(db.query(`SELECT create_dashboard_widget('${type}','{}','self')`)).rejects.toMatchObject({code:'42501'});
      }
      const result = await db.query(`SELECT create_dashboard_widget('sales-chart','{}','self') AS id`);
      expect(result.rows[0].id).toEqual(expect.any(String));
    } finally { await db.close(); }
  },20000);
  it.each(['manager','general_manager','admin','org_admin','fbc','brand_admin','super_admin'])('allows both cube types for %s', async role => {
    const db = await setup();
    try {
      await db.exec(`SET test.role='${role}'`);
      for (const type of ['data','data-3d']) expect((await db.query(`SELECT create_dashboard_widget('${type}','{}','self') AS id`)).rows[0].id).toEqual(expect.any(String));
    } finally { await db.close(); }
  },20000);
  it('backs up and deletes exactly eight, preserves charts/other cubes, and rejects reruns', async () => {
    const db = await setup();
    try {
      expect((await db.query(`SELECT remove_dashboard_cubes_20261101() AS result`)).rows[0].result).toEqual({backed_up:8,deleted:8});
      expect((await db.query(`SELECT count(*)::int AS n FROM dashboard_widgets`)).rows[0].n).toBe(3);
      expect((await db.query(`SELECT count(*)::int AS n FROM dashboard_widgets WHERE widget_type='sales-chart'`)).rows[0].n).toBe(2);
      await expect(db.query(`SELECT remove_dashboard_cubes_20261101()`)).rejects.toMatchObject({message:'Cube preview does not match exactly the 8 approved IDs'});
    } finally { await db.close(); }
  },20000);
  it('refuses changed targets without deleting any rows', async () => {
    const db = await setup();
    try {
      await db.exec(`UPDATE dashboard_widgets SET title='changed' WHERE id='${ids[0]}'`);
      await expect(db.query(`SELECT remove_dashboard_cubes_20261101()`)).rejects.toMatchObject({message:'Expected exactly 8 unchanged backup rows'});
      expect((await db.query(`SELECT count(*)::int AS n FROM dashboard_widgets`)).rows[0].n).toBe(11);
    } finally { await db.close(); }
  },20000);
});