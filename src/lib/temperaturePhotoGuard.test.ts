// @vitest-environment node
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const crew = '00000000-0000-0000-0000-0000000000c1';
const mgr = '00000000-0000-0000-0000-0000000000a1';
const tempItem = '10000000-0000-0000-0000-000000000001';
const tempPhotoItem = '10000000-0000-0000-0000-000000000002';
const checkItem = '10000000-0000-0000-0000-000000000003';
const PHOTO = 'https://x/checklist-images/u/1.jpg';

async function setup() {
  const db = new PGlite();
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('test.uid', true), '')::uuid $$;
    CREATE FUNCTION has_role_or_higher(uuid, text) RETURNS boolean LANGUAGE sql AS $$ SELECT $1 = '${mgr}'::uuid $$;
    CREATE TABLE checklist_items(id uuid PRIMARY KEY, item_type text, requires_temperature_validation boolean DEFAULT false);
    CREATE TABLE checklist_responses(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), item_id uuid, response_text text, response_image_url text, extracted_temperature numeric);
    INSERT INTO checklist_items VALUES ('${tempItem}','temperature',false),('${tempPhotoItem}','image',true),('${checkItem}','confirmation',false);`);
  await db.exec(readFileSync('supabase/migrations/20261112200000_temperature_photo_required.sql', 'utf8'));
  return db;
}
const as = (db: PGlite, uid: string | null) => db.exec(`SET test.uid = '${uid ?? ''}'`);
const ins = (db: PGlite, item: string, img: string | null, text: string | null) =>
  db.query(`INSERT INTO checklist_responses(item_id, response_image_url, response_text) VALUES ($1,$2,$3) RETURNING id`, [item, img, text]);

describe('temperature answers need a photo', () => {
  it('rejects a typed temperature with no photo, for crew and managers', async () => {
    const db = await setup();
    try {
      for (const uid of [crew, mgr]) {
        await as(db, uid);
        await expect(ins(db, tempItem, null, '38')).rejects.toMatchObject({ code: '23514', message: expect.stringContaining('temp_photo_required') });
        await expect(ins(db, tempPhotoItem, null, null)).rejects.toMatchObject({ code: '23514' });
      }
    } finally { await db.close(); }
  }, 20000);

  it('accepts a photo or a JSON photo list, and leaves other tasks alone', async () => {
    const db = await setup();
    try {
      await as(db, crew);
      await ins(db, tempItem, PHOTO, null);
      await ins(db, tempItem, null, JSON.stringify([PHOTO]));
      await ins(db, checkItem, null, 'true');
    } finally { await db.close(); }
  }, 20000);

  it('lets crew fix the number on a photo but never remove the photo', async () => {
    const db = await setup();
    try {
      await as(db, crew);
      const id = (await ins(db, tempItem, PHOTO, null)).rows[0] as { id: string };
      await db.query(`UPDATE checklist_responses SET extracted_temperature = 39 WHERE id = $1`, [id.id]);
      await db.query(`UPDATE checklist_responses SET response_image_url = 'https://x/2.jpg' WHERE id = $1`, [id.id]);
      await expect(db.query(`UPDATE checklist_responses SET response_image_url = NULL, response_text = '39' WHERE id = $1`, [id.id])).rejects.toMatchObject({ code: '23514' });
      await as(db, mgr);
      await expect(db.query(`UPDATE checklist_responses SET response_image_url = NULL WHERE id = $1`, [id.id])).rejects.toMatchObject({ code: '23514' });
      // Undo / delete still works.
      await as(db, crew);
      await db.query(`DELETE FROM checklist_responses WHERE id = $1`, [id.id]);
    } finally { await db.close(); }
  }, 20000);

  it('old photo-less readings: managers and server jobs may correct, crew may not', async () => {
    const db = await setup();
    try {
      await as(db, null);
      const id = ((await ins(db, tempItem, null, '38')).rows[0] as { id: string }).id; // server path (legacy-style row)
      await as(db, crew);
      await expect(db.query(`UPDATE checklist_responses SET extracted_temperature = 40 WHERE id = $1`, [id])).rejects.toMatchObject({ code: '23514' });
      await as(db, mgr);
      await db.query(`UPDATE checklist_responses SET extracted_temperature = 40 WHERE id = $1`, [id]);
      await as(db, null);
      await db.query(`UPDATE checklist_responses SET extracted_temperature = 41 WHERE id = $1`, [id]);
    } finally { await db.close(); }
  }, 20000);
});
