import { assertEquals, assert } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { createHandler } from './index.ts';

function fixture() {
 const tables:Record<string,any[]>={
  schedules:[{id:'schedule',week_start_date:'2026-11-02',week_end_date:'2026-11-08'}],
  locations:[{id:'store',name:'Seed Store'}],
  scheduled_shifts:[{schedule_id:'schedule',user_id:'employee',shift_date:'2026-11-02',start_time:'09:00',end_time:'17:00',is_time_off:false}],
  profiles:[{id:'employee',full_name:'Seed Employee',email:'seed@croohq.test',is_active:true}],
  user_notification_settings:[{user_id:'employee',push_enabled:false,email_enabled:false,notification_type:'schedule_updates'}],
  bounced_emails:[],suppressed_emails:[],
 };
 const reads:string[]=[];const queued:any[]=[];
 const client={from(table:string){reads.push(table);let filtered=[...tables[table]??[]];let single=false;
  const q:any={select:()=>q,eq:(k:string,v:any)=>{filtered=filtered.filter(r=>r[k]===v);return q;},in:(k:string,v:any[])=>{filtered=filtered.filter(r=>v.includes(r[k]));return q;},not:(k:string,_op:string,v:any)=>{filtered=filtered.filter(r=>r[k]!==v);return q;},single:()=>{single=true;return q;},maybeSingle:()=>{single=true;return q;},then:(fn:any)=>Promise.resolve({data:single?filtered[0]??null:filtered,error:null}).then(fn)};return q;}};
 const handler=createHandler({client:()=>client,authenticate:async()=>({caller:{kind:'service',userId:null}}),queue:async opts=>{queued.push(opts);}});
 const run=()=>handler(new Request('http://localhost/schedule-email',{method:'POST',body:JSON.stringify({schedule_id:'schedule',location_id:'store'})}));
 return {tables,reads,queued,run};
}
Deno.test('weekly scheduled employee with push AND email off still gets weekly schedule',async()=>{
 const f=fixture();const r=await f.run();assertEquals(r.status,200);assertEquals((await r.json()).sentCount,1);
 assertEquals(f.queued[0].to,['seed@croohq.test']);assertEquals(f.queued[0].dedupKey,'schedule_schedule_employee');
 assert(!f.reads.includes('user_notification_settings'));
});
for(const reason of ['example','inactive','bounced','suppressed','invalid']) Deno.test(`weekly address exclusion ${reason}`,async()=>{
 const f=fixture();if(reason==='example')f.tables.profiles[0].email='seed@example.com';
 if(reason==='inactive')f.tables.profiles[0].is_active=false;
 if(reason==='bounced')f.tables.bounced_emails=[{email_address:'SEED@CROOHQ.TEST'}];
 if(reason==='suppressed')f.tables.suppressed_emails=[{email:'seed@croohq.test'}];
 if(reason==='invalid')f.tables.profiles[0].email='bad-address';
 const r=await f.run();assertEquals(r.status,200);await r.text();assertEquals(f.queued.length,0);
});