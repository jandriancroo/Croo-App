import { assertEquals, assert } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { DateTime } from 'https://esm.sh/luxon@3.7.2';
import { runDigest, closeWindow, remainingItems, dueToday } from './digest.ts';
import { createHandler } from './index.ts';

const NOW=DateTime.fromISO('2026-11-30T06:15:00Z'); // Sunday 22:15 Pacific.
function fixture() {
 const tables:Record<string,any[]>={
  locations:[{id:'store',name:'Seed Store',organization_id:'org',is_active:true}],
  location_settings:[{location_id:'store',timezone:'America/Los_Angeles',hours_close:'21:00'}],
  checklists:[
   {id:'daily',title:'Daily <safe>',location_id:'store',is_active:true,superseded_at:null,template_type:'standard',frequency:'daily',due_by_time:'18:00'},
   {id:'weekly',title:'Weekly',location_id:'store',is_active:true,superseded_at:null,template_type:'standard',schedule_mode:'last_n',schedule_period:'week',due_by_time:'19:00'},
   {id:'monthly',title:'Monthly',location_id:'store',is_active:true,superseded_at:null,template_type:'standard',frequency:'monthly',due_by_time:'20:00'},
  ],checklist_items:['daily','weekly','monthly'].map(id=>({id:id+'-item',checklist_id:id,item_type:'text',order_index:0,deleted_at:null,station_id:'station',assigned_role:'shift_manager'})),
  checklist_role_tags:[],location_stations:[{id:'station',location_id:'store',name:'Kitchen'}],location_hours:[{location_id:'store',day_of_week:6,close_time:'21:00'}],
  checklist_submissions:[],checklist_responses:[],
  user_locations:['off','fallback','optin','crew','sandbox'].map(user_id=>({user_id,location_id:'store'})),
  user_roles:['off','fallback','optin','crew','sandbox'].map(user_id=>({user_id,role:user_id==='crew'?'team_member':'manager'})),
  profiles:['off','fallback','optin','crew','sandbox'].map(id=>({id,email:id==='sandbox'?'seed@example.com':`${id}@croohq.test`,is_active:true})),
  user_notification_settings:['off','fallback','optin'].map(user_id=>({user_id,location_id:'store',notification_type:'overdue_checklists',email_enabled:user_id==='optin'})),
  push_notification_tokens:[{user_id:'off'},{user_id:'optin'}],
  role_notification_settings:[],role_notification_settings_template:[],bounced_emails:[],suppressed_emails:[],email_queue:[],
 };
 const client={rpc:async(_name:string,args:any)=>({data:tables.user_roles.find(r=>r.user_id===args._user_id)?.role,error:null}),
 from(table:string){let filtered=[...tables[table]??[]];let single=false;let writes:any[]|null=null;
 const q:any={select:()=>q,eq:(k:string,v:any)=>{filtered=filtered.filter(r=>r[k]===v);return q;},is:(k:string,v:any)=>{filtered=filtered.filter(r=>(r[k]??null)===v);return q;},in:(k:string,v:any[])=>{filtered=filtered.filter(r=>v.includes(r[k]));return q;},gte:(k:string,v:any)=>{filtered=filtered.filter(r=>r[k]>=v);return q;},lt:(k:string,v:any)=>{filtered=filtered.filter(r=>r[k]<v);return q;},maybeSingle:()=>{single=true;return q;},upsert:(row:any)=>{writes=[];if(!tables.email_queue.some(r=>r.dedup_key===row.dedup_key)){tables.email_queue.push(row);writes=[{id:'queued'}];}return q;},then:(fn:any)=>Promise.resolve({data:writes??(single?filtered[0]??null:filtered),error:null}).then(fn)};return q;}};
 return {tables,client,run:(now=NOW,dry=false)=>runDigest(client,now,dry)};
}
Deno.test('3 overdue lists -> exactly one digest per eligible manager; token OFF none; no-token fallback; rerun dedup',async()=>{
 const f=fixture();assertEquals((await f.run()).queued,2);assertEquals(f.tables.email_queue.length,2);
 assertEquals(f.tables.email_queue.map(r=>r.metadata.user_id).sort(),['fallback','optin']);
 for(const row of f.tables.email_queue){assertEquals(row.subject,'Seed Store: 3 checklists overdue today');assertEquals(row.dedup_key,`overdue_digest_store_2026-11-29_${row.metadata.user_id}`);assert(row.html.includes('Kitchen'));assert(row.html.includes('&lt;safe&gt;'));}
 assertEquals((await f.run()).queued,0);assertEquals(f.tables.email_queue.length,2);
});
Deno.test('before local close, empty lists or fully complete -> no email',async()=>{
 const f=fixture();assertEquals((await f.run(DateTime.fromISO('2026-11-30T04:45:00Z'))).queued,0);
 f.tables.checklists=[];assertEquals((await f.run()).queued,0);
 const g=fixture();g.tables.checklist_items=[];assertEquals((await g.run()).queued,0);
});
Deno.test('role ceiling excludes manager even when no token; address exclusions honored',async()=>{
 const f=fixture();f.tables.role_notification_settings=[{role:'manager',enabled:false,organization_id:'org',notification_type:'overdue_checklists'}];assertEquals((await f.run()).queued,0);
 const g=fixture();g.tables.bounced_emails=[{email_address:'fallback@croohq.test'}];g.tables.suppressed_emails=[{email:'optin@croohq.test'}];assertEquals((await g.run()).queued,0);
});
Deno.test('dry-run returns counts and never queues',async()=>{const f=fixture();assertEquals((await f.run(NOW,true)).eligible,2);assertEquals(f.tables.email_queue.length,0);});
Deno.test('close fallback 21:00, store timezone honored',()=>{
 assertEquals(closeWindow(DateTime.fromISO('2026-11-30T05:00Z'),'America/Los_Angeles',null).ready,true);
 assertEquals(closeWindow(DateTime.fromISO('2026-11-30T04:59Z'),'America/Los_Angeles',null).ready,false);
 assertEquals(closeWindow(DateTime.fromISO('2026-11-30T03:00Z'),'America/Chicago',null).ready,true);
});
Deno.test('archived items excluded; dynamic weekdays and section-header scoring match alerts',()=>{
 const items=[{id:'header',item_type:'section_header',order_index:0},{id:'one',item_type:'text',order_index:1,days_of_week:[6]},{id:'two',item_type:'text',order_index:2,days_of_week:[0]},{id:'old',item_type:'text',order_index:3,days_of_week:[6],deleted_at:'yesterday'}];
 assertEquals(remainingItems({template_type:'dynamic'},items,new Set(['one']),6),[]);
});
Deno.test('weekly only Sunday, daily schedule excludes wrong weekday',()=>{
 const local=NOW.setZone('America/Los_Angeles');const close=closeWindow(NOW,'America/Los_Angeles').close;
 assertEquals(dueToday({is_active:true,template_type:'standard',schedule_mode:'last_n',schedule_period:'week',due_by_time:'18:00'},'2026-11-29',local,close),true);
 assertEquals(dueToday({is_active:true,template_type:'standard',schedule_mode:'days',schedule_period:'week',schedule_weekdays:[0],due_by_time:'18:00'},'2026-11-29',local,close),false);
});
Deno.test('internal guard rejects user/missing request before reads; invalid internal body 400',async()=>{
 let reads=0;const h=createHandler({client:()=>{reads++;throw new Error('not reached');}});
 const r=await h(new Request('http://localhost/digest',{method:'POST',body:'{}'}));assertEquals(r.status,401);await r.text();assertEquals(reads,0);
 const internal=createHandler({authorize:()=>null,client:()=>{throw new Error('not reached');}});
 const bad=await internal(new Request('http://localhost/digest',{method:'POST',body:'{"dry_run":"yes"}'}));assertEquals(bad.status,400);await bad.text();
});