import 'https://deno.land/std@0.224.0/dotenv/load.ts';
import { assertEquals, assert } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { createHandler, KNOWN_NOTIFICATION_TYPES } from './index.ts';
import type { Caller } from '../_shared/callerAuth.ts';

const A = '10000000-0000-0000-0000-000000000001';
const B = '10000000-0000-0000-0000-000000000002';
const TEAM = '20000000-0000-0000-0000-000000000001';
const MANAGER = '20000000-0000-0000-0000-000000000002';
const EMPLOYEE = '20000000-0000-0000-0000-000000000003';
const OUTSIDER = '20000000-0000-0000-0000-000000000004';
const ADMIN = '20000000-0000-0000-0000-000000000005';
const CHAT = '30000000-0000-0000-0000-000000000001';
const RECORD = '40000000-0000-0000-0000-000000000001';
type Row = Record<string, any>;

function fixture(caller: Caller | null = { kind: 'user', userId: TEAM }) {
  const writes: { table: string; rows: unknown }[] = [];
  const sent: { ids: string[]; content: { title: string; body: string }; data: Row }[] = [];
  const logs: string[] = [];
  const lookups: string[] = [];
  const tables: Record<string, Row[]> = {
    user_locations: [{user_id:TEAM,location_id:A},{user_id:MANAGER,location_id:A},{user_id:EMPLOYEE,location_id:A},{user_id:OUTSIDER,location_id:B}],
    user_roles: [{user_id:TEAM,role:'team_member'},{user_id:MANAGER,role:'shift_manager'},{user_id:EMPLOYEE,role:'team_member'},{user_id:OUTSIDER,role:'team_member'},{user_id:ADMIN,role:'admin'}],
    chats: [{id:CHAT,location_id:A}],
    schedules: [{id:RECORD,location_id:A}],
    announcement_posts: [{id:RECORD,location_id:A}],
    support_tickets: [{id:RECORD,user_id:OUTSIDER}],
    hiring_conversations: [{id:RECORD,application_id:RECORD}],
    job_applications: [{id:RECORD,location_id:A}],
    profiles: [{id:TEAM,default_location_id:A},{id:MANAGER,default_location_id:A}],
    locations: [{id:A,organization_id:RECORD}],
  };
  let failRpc = false;
  const client = {
    rpc(name: string, args: Row) {
      lookups.push(name);
      if (failRpc) return Promise.resolve({data:null,error:{message:'private lookup details'}});
      let data: unknown = null;
      if (name === 'has_location_access') data = tables.user_locations.some(r => r.user_id===args._user_id && r.location_id===args._location_id);
      if (name === 'get_user_role') data = tables.user_roles.find(r => r.user_id===args._user_id)?.role;
      if (name === 'is_chat_member') data = args._chat_id===CHAT && [TEAM,EMPLOYEE,OUTSIDER].includes(args._user_id);
      return Promise.resolve({data,error:null});
    },
    from(table: string) {
      lookups.push(table);
      let filters: ((r: Row) => boolean)[] = [];
      let single = false;
      const query: any = {
        select() {return query;}, eq(key:string,value:unknown) {filters.push(r=>r[key]===value);return query;},
        in(key:string,values:unknown[]) {filters.push(r=>values.includes(r[key]));return query;},
        maybeSingle() {single=true;return query;},
        upsert(rows:unknown) {writes.push({table,rows});return Promise.resolve({error:null});},
        then(resolve:any,reject:any) {const rows=(tables[table]??[]).filter(r=>filters.every(f=>f(r)));return Promise.resolve({data:single?(rows[0]??null):rows,error:null}).then(resolve,reject);},
      };
      return query;
    },
  };
  const handler = createHandler({
    authenticate: async () => caller ? {caller} : {response:new Response('{}',{status:401})},
    client:()=>client, clockedIn:async()=>[TEAM,MANAGER,EMPLOYEE], throttle:()=>false,
    rejectLog:line=>logs.push(line),
    deliver:async(ids,content,data)=>{sent.push({ids,content,data});return new Response(JSON.stringify({successful:ids.length}),{status:200});},
  });
  const request = (overrides:Row={}) => handler(new Request('http://localhost/notification',{method:'POST',body:JSON.stringify({user_ids:[EMPLOYEE],location_id:A,title:'Title',body:'Body',notification_type:'chat_messages',...overrides})}));
  return {request,sent,writes,logs,lookups,tables,setFailRpc:()=>{failRpc=true;}};
}

Deno.test('team Store A targeting Store B: 403, nothing sent or written', async()=>{
  const f=fixture(); const r=await f.request({user_ids:[OUTSIDER]});
  assertEquals(r.status,403); assertEquals(await r.json(),{error:'Forbidden'}); assertEquals(f.sent.length,0); assertEquals(f.writes.length,0); assertEquals(f.logs.length,1);
});
Deno.test('shift manager sends same-store schedule update: 200 and stub push delivered', async()=>{
  const f=fixture({kind:'user',userId:MANAGER});const r=await f.request({notification_type:'schedule_updates'});
  assertEquals(r.status,200);await r.text();assertEquals(f.sent[0].ids,[EMPLOYEE]);
});
Deno.test('team member schedule update: 403', async()=>{
  const f=fixture();const r=await f.request({notification_type:'schedule_updates'});assertEquals(r.status,403);await r.text();assertEquals(f.sent.length,0);
});
for (const [path,type,data] of [
  ['alert-push-sender cron','late_arrival',{type:'late_arrival'}],
  ['notify_feed_post_push trigger','announcements',{type:'announcement',post_id:RECORD}],
  ['notify_feed_comment_push trigger','chat_messages',{type:'feed_comment',post_id:RECORD}],
  ['future NCNS service payload (step 3 not implemented)','late_arrivals',{type:'ncns',shift_id:RECORD}],
] as const) Deno.test(`${path}: service bypass retained, stub delivery`,async()=>{
  const f=fixture({kind:'service',userId:null});const r=await f.request({notification_type:type,data});
  assertEquals(r.status,200);await r.text();assertEquals(f.sent.length,1);assert(!f.lookups.includes('has_location_access'));assert(!f.lookups.includes('get_user_role'));
});
Deno.test('HTML/subject/email fields ignored; 2000-character body plain and capped; no email queue write',async()=>{
  const f=fixture();const r=await f.request({title:'<b>'+ 'T'.repeat(100)+'</b>',body:'<script>private()</script><b>'+ 'x'.repeat(2000)+'</b>',html:'unsafe',subject:'unsafe',email_html:'unsafe',data:{html:'unsafe',subject:'unsafe',email_body:'unsafe',message_id:RECORD}});
  assertEquals(r.status,200);await r.text();assertEquals(f.sent[0].content.body,'x'.repeat(200));assertEquals(Array.from(f.sent[0].content.title).length,80);assertEquals(f.sent[0].data,{message_id:RECORD});assertEquals(f.writes.filter(w=>w.table==='email_queue').length,0);assert(!f.lookups.includes('email_queue'));
});
for(const kind of ['user','service'] as const) Deno.test(`unknown notification type rejected for ${kind}`,async()=>{
  const f=fixture(kind==='user'?{kind,userId:TEAM}:{kind,userId:null});const r=await f.request({notification_type:'unrecognized-secret-text'});
  assertEquals(r.status,403);assertEquals(await r.json(),{error:'Unknown notification type'});assertEquals(f.sent.length,0);assert(!f.logs.join('').includes('unrecognized-secret-text'));
});
Deno.test('missing/invalid authentication: 401 before parsing or lookups',async()=>{
  const f=fixture(null);const r=await f.request();assertEquals(r.status,401);assertEquals(await r.json(),{error:'Unauthorized'});assertEquals(f.lookups.length,0);
});
Deno.test('mixed explicit and role-expanded unauthorized targets reject whole request',async()=>{
  const f=fixture();const r=await f.request({user_ids:[OUTSIDER],roles:['team_member']});assertEquals(r.status,403);await r.text();assertEquals(f.sent.length,0);
});
Deno.test('role expansion same store works for manager task assignment',async()=>{
  const f=fixture({kind:'user',userId:MANAGER});const r=await f.request({user_ids:[],roles:['team_member'],notification_type:'task_assigned'});assertEquals(r.status,200);await r.text();assertEquals(f.sent[0].ids.sort(),[TEAM,EMPLOYEE].sort());
});
Deno.test('cross-store chat member delivery works with camelCase chatId',async()=>{
  const f=fixture();const r=await f.request({user_ids:[OUTSIDER],location_id:undefined,data:{chatId:CHAT}});assertEquals(r.status,200);await r.text();assertEquals(f.sent[0].ids,[OUTSIDER]);assertEquals(f.sent[0].data.chat_id,CHAT);
});
Deno.test('chat nonmember target rejected',async()=>{
  const f=fixture();const r=await f.request({user_ids:[MANAGER],data:{chat_id:CHAT}});assertEquals(r.status,403);await r.text();assertEquals(f.sent.length,0);
});
Deno.test('chat nonmember caller rejected',async()=>{
  const f=fixture({kind:'user',userId:MANAGER});const r=await f.request({data:{chat_id:CHAT}});assertEquals(r.status,403);await r.text();
});
Deno.test('hiring conversation without chat membership uses verified same-location checks',async()=>{
  const f=fixture({kind:'user',userId:MANAGER});const r=await f.request({roles:['team_member'],user_ids:[],data:{type:'hiring_message',conversation_id:RECORD}});assertEquals(r.status,200);await r.text();assertEquals(f.sent.length,1);
});
Deno.test('support admin reply to verified ticket owner works across stores, without location',async()=>{
  const f=fixture({kind:'user',userId:ADMIN});const r=await f.request({user_ids:[OUTSIDER],location_id:undefined,data:{type:'support_message',ticket_id:RECORD}});assertEquals(r.status,200);await r.text();assertEquals(f.sent[0].ids,[OUTSIDER]);
});
Deno.test('forged support marker does not authorize caller or unrelated target',async()=>{
  const f=fixture();const r=await f.request({user_ids:[OUTSIDER],location_id:undefined,data:{type:'support_message',ticket_id:RECORD}});assertEquals(r.status,403);await r.text();assertEquals(f.sent.length,0);
});
Deno.test('missing schedule location derived from verified record',async()=>{
  const f=fixture({kind:'user',userId:MANAGER});const r=await f.request({notification_type:'shift_approvals',location_id:undefined,data:{schedule_id:RECORD}});assertEquals(r.status,200);await r.text();assertEquals(f.sent.length,1);
});
Deno.test('missing post location derived for manager announcement reminder',async()=>{
  const f=fixture({kind:'user',userId:MANAGER});const r=await f.request({notification_type:'announcements',location_id:undefined,data:{postId:RECORD}});assertEquals(r.status,200);await r.text();
});
Deno.test('self test uses caller default location; other-person test forbidden',async()=>{
  const f=fixture();let r=await f.request({notification_type:'test',user_ids:[TEAM],location_id:undefined});assertEquals(r.status,200);await r.text();
  r=await f.request({notification_type:'test'});assertEquals(r.status,403);await r.text();assertEquals(f.sent.length,1);
});
Deno.test('strict diagnostics reject service-only type and fake chat id',async()=>{
  const f=fixture();let r=await f.request({notification_type:'late_arrivals',user_ids:[TEAM]});assertEquals(r.status,403);await r.text();
  r=await f.request({user_ids:[TEAM],data:{chat_id:'diagnostic-test'}});assertEquals(r.status,403);await r.text();
});
Deno.test('authorization lookup errors fail closed with one sanitized rejection',async()=>{
  const f=fixture();f.setFailRpc();const r=await f.request();assertEquals(r.status,403);assertEquals(await r.json(),{error:'Forbidden'});assertEquals(f.logs.length,1);assert(!f.logs[0].includes('private'));assertEquals(f.sent.length,0);
});
Deno.test('known type catalog has no duplicates and includes every seeded user type',()=>{
  assertEquals(new Set(KNOWN_NOTIFICATION_TYPES).size,KNOWN_NOTIFICATION_TYPES.length);
  for(const type of ['chat_messages','announcements','schedule_updates','shift_approvals','logbook_entry','drawer_count','safe_count','waste_log','catering_order','task_assigned','quick_task','test']) assert((KNOWN_NOTIFICATION_TYPES as readonly string[]).includes(type));
});
for (const type of ['announcements','shift_approvals','logbook_entry','drawer_count','safe_count','waste_log','catering_order','task_assigned','quick_task']) {
  Deno.test(`${type}: team sender blocked, shift manager with store targets permitted`,async()=>{
    const team=fixture();let r=await team.request({notification_type:type});assertEquals(r.status,403);await r.text();assertEquals(team.sent.length,0);
    const manager=fixture({kind:'user',userId:MANAGER});r=await manager.request({notification_type:type});assertEquals(r.status,200);await r.text();assertEquals(manager.sent[0].ids,[EMPLOYEE]);
  });
}
Deno.test('AnnouncementStats chatId reminder resolves its store',async()=>{
  const f=fixture({kind:'user',userId:MANAGER});const r=await f.request({notification_type:'announcements',location_id:undefined,data:{chatId:CHAT}});assertEquals(r.status,200);await r.text();assertEquals(f.sent.length,1);
});
Deno.test('support caller cannot push to an unrelated non-admin using a valid ticket',async()=>{
  const f=fixture({kind:'user',userId:ADMIN});const r=await f.request({user_ids:[EMPLOYEE],location_id:undefined,data:{type:'support_message',ticket_id:RECORD}});assertEquals(r.status,403);await r.text();assertEquals(f.sent.length,0);
});
Deno.test('real requireCaller denies missing token before any injected client can run',async()=>{
  let clientUsed=false;const logs:string[]=[];
  const handler=createHandler({client:()=>{clientUsed=true;throw new Error('must not run');},rejectLog:line=>logs.push(line)});
  const r=await handler(new Request('http://localhost/notification',{method:'POST',body:'not-json'}));
  assertEquals(r.status,401);assertEquals(await r.json(),{error:'Unauthorized'});assertEquals(clientUsed,false);assertEquals(logs.length,1);
});