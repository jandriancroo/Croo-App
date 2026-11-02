// @vitest-environment node
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

const STORE='10000000-0000-0000-0000-000000000001';
const EMPLOYEE='20000000-0000-0000-0000-000000000001';
const MANAGER='20000000-0000-0000-0000-000000000002';
const SHIFT='30000000-0000-0000-0000-000000000001';
const SCHEDULE='40000000-0000-0000-0000-000000000001';
const CERT='50000000-0000-0000-0000-000000000001';
const DOC='60000000-0000-0000-0000-000000000001';
const ASSIGNMENT='70000000-0000-0000-0000-000000000001';
async function setup(minutes=16) {
 const db=new PGlite();
 await db.exec(`CREATE TABLE location_settings(location_id uuid, ncns_alert_minutes integer DEFAULT 30);
 CREATE TABLE user_locations(user_id uuid,location_id uuid); CREATE TABLE user_roles(user_id uuid,role text);
 CREATE TABLE user_notification_settings(user_id uuid,location_id uuid,notification_type text,push_enabled boolean);
 CREATE TABLE scheduled_shifts(id uuid,user_id uuid,schedule_id uuid,shift_date date,start_time time,is_time_off boolean,is_phantom boolean,is_coverage_only boolean);
 CREATE TABLE schedules(id uuid,location_id uuid,week_start_date date,week_end_date date,is_published boolean);
 CREATE TABLE profiles(id uuid,full_name text);
 CREATE TABLE time_punches(user_id uuid,location_id uuid,punch_type text,punch_time timestamptz);
 CREATE TABLE toast_shifts(croo_user_id uuid,location_id uuid,shift_date date,in_time timestamptz);
 CREATE TABLE certifications(id uuid,user_id uuid,certification_type text,expiration_date date,status text);
 CREATE TABLE read_and_sign_documents(id uuid,location_id uuid,title text,is_active boolean,scheduled_at timestamptz);
 CREATE TABLE read_and_sign_assignments(id uuid,employee_id uuid,document_id uuid,assigned_at timestamptz,signed_at timestamptz);
 CREATE TABLE alert_queue(alert_type text,dedup_key text UNIQUE,location_id uuid,payload jsonb);
 INSERT INTO location_settings VALUES('${STORE}',30);
 INSERT INTO user_locations VALUES('${EMPLOYEE}','${STORE}'),('${MANAGER}','${STORE}');
 INSERT INTO user_roles VALUES('${EMPLOYEE}','team_member'),('${MANAGER}','manager');
 INSERT INTO profiles VALUES('${EMPLOYEE}','Seed Employee'),('${MANAGER}','Seed Manager');
 INSERT INTO schedules VALUES('${SCHEDULE}','${STORE}','2026-11-02','2026-11-08',true);
 INSERT INTO scheduled_shifts VALUES('${SHIFT}','${EMPLOYEE}','${SCHEDULE}','2026-11-02', ('09:05'::time - interval '${minutes} minutes'),false,false,false);`);
 // Execute the exact deployed sections in isolation, using a fixed store-local test clock.
 const sql=readFileSync('drizzle/migrations/0086_employee_job_alerts.sql','utf8');
 const late=sql.split('$late$')[1]; const cert=sql.split('$cert$')[1];
 const blocks=(late+cert).replaceAll('now()',"TIMESTAMPTZ '2026-11-02 17:05:00+00'");
 await db.exec(`CREATE FUNCTION test_alerts() RETURNS void LANGUAGE plpgsql AS $fn$
 DECLARE loc record; tz text := 'America/Los_Angeles';local_date text := '2026-11-02';current_total_minutes integer := 545;
 start_of_day_utc timestamptz := '2026-11-02 08:00:00+00';end_of_day_utc timestamptz := '2026-11-03 07:59:59+00';v_dedup_key text;
 BEGIN SELECT '${STORE}'::uuid AS id,'Seed Store'::text AS name INTO loc;
 ${blocks}
 END $fn$;`);
 const run=()=>db.query('SELECT test_alerts()');
 const rows=async()=> (await db.query<{alert_type:string;dedup_key:string;payload:any}>('SELECT * FROM alert_queue ORDER BY alert_type')).rows;
 return {db,run,rows};
}

describe('Employee job alerts: actual SQL sections, isolated seeded database',()=>{
 it('16 minutes: one manager late and employee copy, rerun deduplicated',async()=>{const f=await setup();try{await f.run();await f.run();const rows=await f.rows();expect(rows.map(r=>r.alert_type)).toEqual(['late_arrival','late_arrival_self']);expect(rows[1].payload.user_ids).toEqual([EMPLOYEE]);expect(rows[1].dedup_key).toBe(`late_self_${SHIFT}_2026-11-02`);}finally{await f.db.close();}},20000);
 it('31 minutes: NCNS manager and employee once with correct keys',async()=>{const f=await setup(31);try{await f.run();await f.run();const rows=await f.rows();expect(rows.map(r=>r.alert_type)).toEqual(['no_call_no_show','no_call_no_show_self']);expect(rows[0].payload.user_ids).toEqual([MANAGER]);expect(rows[1].payload.user_ids).toEqual([EMPLOYEE]);expect(rows[1].dedup_key).toBe(`ncns_self_${SHIFT}_2026-11-02`);}finally{await f.db.close();}},20000);
 it.each(['punch','toast','disabled','time-off','phantom','coverage','unpublished'])('31 minutes skips %s',async reason=>{const f=await setup(31);try{
 if(reason==='punch')await f.db.exec(`INSERT INTO time_punches VALUES('${EMPLOYEE}','${STORE}','clock_in','2026-11-02 16:40:00+00')`);
 if(reason==='toast')await f.db.exec(`INSERT INTO toast_shifts VALUES('${EMPLOYEE}','${STORE}','2026-11-02','2026-11-02 16:40:00+00')`);
 if(reason==='disabled')await f.db.exec('UPDATE location_settings SET ncns_alert_minutes=0');
 if(reason==='time-off')await f.db.exec('UPDATE scheduled_shifts SET is_time_off=true');
 if(reason==='phantom')await f.db.exec('UPDATE scheduled_shifts SET is_phantom=true');
 if(reason==='coverage')await f.db.exec('UPDATE scheduled_shifts SET is_coverage_only=true');
 if(reason==='unpublished')await f.db.exec('UPDATE schedules SET is_published=false');
 await f.run();expect(await f.rows()).toEqual([]);
 }finally{await f.db.close();}},20000);
 it.each([29,35])('NCNS window excludes minute %i',async minute=>{const f=await setup(minute);try{await f.run();expect(await f.rows()).toEqual([]);}finally{await f.db.close();}},20000);
 it('NULL setting uses 30-minute default',async()=>{const f=await setup(31);try{await f.db.exec('UPDATE location_settings SET ncns_alert_minutes=NULL');await f.run();expect((await f.rows()).length).toBe(2);}finally{await f.db.close();}},20000);
 it('7 days at 9:05: manager cert and employee cert once',async()=>{const f=await setup(0);try{await f.db.exec(`INSERT INTO certifications VALUES('${CERT}','${EMPLOYEE}','Food handler','2026-11-09','approved')`);await f.run();await f.run();expect((await f.rows()).map(r=>r.alert_type)).toEqual(['cert_expiring_self','certificate_expiry']);}finally{await f.db.close();}},20000);
 it('new released unsigned read-and-sign assigned once; old/signed/inactive/future excluded',async()=>{const f=await setup(0);try{await f.db.exec(`INSERT INTO read_and_sign_documents VALUES('${DOC}','${STORE}','Seed document',true,NULL);INSERT INTO read_and_sign_assignments VALUES('${ASSIGNMENT}','${EMPLOYEE}','${DOC}','2026-11-02 08:00:00+00',NULL)`);await f.run();await f.run();expect((await f.rows()).map(r=>r.dedup_key)).toEqual([`rs_${ASSIGNMENT}`]);
 for(const change of ["UPDATE read_and_sign_assignments SET assigned_at='2026-11-02 07:19:59+00'", "UPDATE read_and_sign_assignments SET assigned_at='2026-11-02 08:00:00+00',signed_at='2026-11-02 09:00:00+00'",'UPDATE read_and_sign_assignments SET signed_at=NULL;UPDATE read_and_sign_documents SET is_active=false',"UPDATE read_and_sign_documents SET is_active=true,scheduled_at='2026-11-03 08:00:00+00'"]){await f.db.exec('DELETE FROM alert_queue;'+change);await f.run();expect(await f.rows()).toEqual([]);}
 }finally{await f.db.close();}},20000);
});
