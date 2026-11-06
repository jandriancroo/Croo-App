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
import { queueEmail } from './index.ts';
const fakeDb=(error:any)=>{const inserted:any[]=[];return {inserted,from:(_t:string)=>({insert:async(row:any)=>{inserted.push(row);return {error};}})};};
const opts={from:'f',to:['a@croohq.test'],subject:'s',html:'h',source:'schedule_published',dedupKey:'schedule_x_y'};
Deno.test('queueEmail plain insert keeps fields and returns queued',async()=>{
 const db=fakeDb(null);assertEquals(await queueEmail(opts,db),'queued');
 assertEquals(db.inserted[0].source,'schedule_published');assertEquals(db.inserted[0].dedup_key,'schedule_x_y');
});
Deno.test('queueEmail 23505 is a dedup skip, not an error',async()=>{
 assertEquals(await queueEmail(opts,fakeDb({code:'23505',message:'dup'})),'duplicate');
});
Deno.test('queueEmail other error throws',async()=>{
 let threw=false;try{await queueEmail(opts,fakeDb({code:'42P10',message:'no constraint'}));}catch{threw=true;}assert(threw);
});
function withQueue(q:any){const f=fixture();f.tables.profiles.push({id:'e2',full_name:'Two',email:'two@croohq.test',is_active:true});
 f.tables.scheduled_shifts.push({schedule_id:'schedule',user_id:'e2',shift_date:'2026-11-03',start_time:'09:00',end_time:'17:00',is_time_off:false});
 const handler=createHandler({client:()=>({from:(t:string)=>{let rows=[...f.tables[t]??[]];let single=false;const qq:any={select:()=>qq,eq:(k:string,v:any)=>{rows=rows.filter(r=>r[k]===v);return qq;},in:(k:string,v:any[])=>{rows=rows.filter(r=>v.includes(r[k]));return qq;},not:()=>qq,single:()=>{single=true;return qq;},maybeSingle:()=>{single=true;return qq;},then:(fn:any)=>Promise.resolve({data:single?rows[0]??null:rows,error:null}).then(fn)};return qq;}}),authenticate:async()=>({caller:{kind:'service',userId:null}}),queue:q});
 return handler(new Request('http://localhost/x',{method:'POST',body:JSON.stringify({schedule_id:'schedule',location_id:'store'})}));}
Deno.test('all enqueue failures return 500, never success with 0 sent',async()=>{
 const r=await withQueue(async()=>{throw {code:'42P10'};});const b=await r.json();
 assertEquals(r.status,500);assertEquals(b.success,false);assertEquals(b.sentCount,0);assertEquals(b.failCount,2);
});
Deno.test('all duplicates: success, skipped counted, no failures',async()=>{
 const r=await withQueue(async()=>'duplicate');const b=await r.json();
 assertEquals(r.status,200);assertEquals(b.sentCount,0);assertEquals(b.skippedCount,2);assertEquals(b.failCount,0);
});
Deno.test('mixed: success with both counts',async()=>{
 let n=0;const r=await withQueue(async()=>{if(n++===0)return 'queued';throw {code:'XX'};});const b=await r.json();
 assertEquals(r.status,200);assertEquals(b.sentCount,1);assertEquals(b.failCount,1);
});
