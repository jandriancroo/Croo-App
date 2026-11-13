// @vitest-environment node
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { canConfirmDeactivate, DEACTIVATE_COOLDOWN_SECONDS } from './activeSwitch';

const ORG = '00000000-0000-0000-0000-0000000000a1';
const L1 = '00000000-0000-0000-0000-0000000000b1';
const L2 = '00000000-0000-0000-0000-0000000000b2';
const JORDAN = '00000000-0000-0000-0000-000000000001';
const ORG_ADMIN = '00000000-0000-0000-0000-000000000002';

async function setup() {
  const db = new PGlite();
  await db.exec(`CREATE ROLE service_role; CREATE ROLE anon; CREATE ROLE authenticated;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT NULLIF(current_setting('test.uid', true), '')::uuid $$;
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$ SELECT NULLIF(current_setting('test.role', true), '') $$;
    CREATE FUNCTION is_super_admin(uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT $1 = '${JORDAN}'::uuid $$;
    CREATE TABLE organizations(id uuid PRIMARY KEY, name text, is_active boolean NOT NULL DEFAULT true);
    CREATE TABLE locations(id uuid PRIMARY KEY, name text, organization_id uuid, is_active boolean NOT NULL DEFAULT true);
    CREATE TABLE alert_queue(id serial PRIMARY KEY, location_id uuid);
    CREATE TABLE email_queue(id serial PRIMARY KEY, location_id uuid);
    INSERT INTO organizations VALUES ('${ORG}', 'HH Blaze Inc', true);
    INSERT INTO locations VALUES ('${L1}', 'Anaheim', '${ORG}', true), ('${L2}', 'Second', '${ORG}', true);`);
  await db.exec(readFileSync('drizzle/migrations/0095_location_org_active_switch.sql', 'utf8'));
  return db;
}
const as = (db: PGlite, uid: string, role = 'authenticated') => db.exec(`SET test.uid='${uid}'; SET test.role='${role}'`);
const live = async (db: PGlite, id: string) => (await db.query<{ v: boolean }>(`SELECT location_is_live('${id}') AS v`)).rows[0].v;

describe('Make Inactive safety box', () => {
  it('waits 10 seconds', () => expect(DEACTIVATE_COOLDOWN_SECONDS).toBe(10));
  it('stays locked until the countdown ends', () => expect(canConfirmDeactivate('Anaheim', 'Anaheim', 1)).toBe(false));
  it('stays locked until the exact name is typed', () => expect(canConfirmDeactivate('anaheim', 'Anaheim', 0)).toBe(false));
  it('unlocks with the exact name after the countdown', () => expect(canConfirmDeactivate(' Anaheim ', 'Anaheim', 0)).toBe(true));
});

describe('Org / Location active switch', () => {
  it('Location off leaves its Org on', async () => {
    const db = await setup();
    try {
      await as(db, JORDAN);
      await db.query(`SELECT set_location_active('${L1}', false)`);
      expect(await live(db, L1)).toBe(false);
      expect((await db.query<{ a: boolean }>(`SELECT is_active a FROM organizations`)).rows[0].a).toBe(true);
      expect(await live(db, L2)).toBe(true);
    } finally { await db.close(); }
  }, 20000);

  it('Org off turns all of its Locations off', async () => {
    const db = await setup();
    try {
      await as(db, JORDAN);
      await db.query(`SELECT set_organization_active('${ORG}', false)`);
      expect(await live(db, L1)).toBe(false);
      expect(await live(db, L2)).toBe(false);
    } finally { await db.close(); }
  }, 20000);

  it('Org back on restores only the Locations that were on before', async () => {
    const db = await setup();
    try {
      await as(db, JORDAN);
      await db.query(`SELECT set_location_active('${L1}', false)`);
      await db.query(`SELECT set_organization_active('${ORG}', false)`);
      await db.query(`SELECT set_organization_active('${ORG}', true)`);
      expect(await live(db, L1)).toBe(false);
      expect(await live(db, L2)).toBe(true);
    } finally { await db.close(); }
  }, 20000);

  it('a Location cannot be turned on while its Org is off', async () => {
    const db = await setup();
    try {
      await as(db, JORDAN);
      await db.query(`SELECT set_organization_active('${ORG}', false)`);
      await expect(db.query(`SELECT set_location_active('${L1}', true)`)).rejects.toMatchObject({ message: 'Turn the organization back on first' });
    } finally { await db.close(); }
  }, 20000);

  it('only the super admin can use the switch', async () => {
    const db = await setup();
    try {
      await as(db, ORG_ADMIN);
      await expect(db.query(`SELECT set_location_active('${L1}', false)`)).rejects.toMatchObject({ code: '42501' });
      await expect(db.query(`SELECT set_organization_active('${ORG}', false)`)).rejects.toMatchObject({ code: '42501' });
      await expect(db.query(`UPDATE locations SET is_active = false WHERE id = '${L1}'`)).rejects.toMatchObject({ code: '42501' });
      await expect(db.query(`UPDATE organizations SET is_active = false`)).rejects.toMatchObject({ code: '42501' });
      expect(await live(db, L1)).toBe(true);
    } finally { await db.close(); }
  }, 20000);

  it('other Location edits by org admins still work', async () => {
    const db = await setup();
    try {
      await as(db, ORG_ADMIN);
      await db.query(`UPDATE locations SET name = 'Anaheim Hills' WHERE id = '${L1}'`);
      expect((await db.query<{ n: string }>(`SELECT name n FROM locations WHERE id='${L1}'`)).rows[0].n).toBe('Anaheim Hills');
    } finally { await db.close(); }
  }, 20000);

  it('no new alerts or emails queue for an inactive Location; active ones still queue', async () => {
    const db = await setup();
    try {
      await as(db, JORDAN);
      await db.query(`SELECT set_location_active('${L1}', false)`);
      await db.query(`INSERT INTO alert_queue(location_id) VALUES ('${L1}'), ('${L2}'), (NULL)`);
      await db.query(`INSERT INTO email_queue(location_id) VALUES ('${L1}'), ('${L2}')`);
      expect((await db.query<{ n: number }>(`SELECT count(*)::int n FROM alert_queue`)).rows[0].n).toBe(2);
      expect((await db.query<{ n: number }>(`SELECT count(*)::int n FROM email_queue`)).rows[0].n).toBe(1);
    } finally { await db.close(); }
  }, 20000);
});
