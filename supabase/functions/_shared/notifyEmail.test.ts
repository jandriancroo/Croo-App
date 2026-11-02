import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { notifyEmail, EMAIL_ALWAYS_KEYS, type NotifyEmailInput } from './notifyEmail.ts';
import { defaultEmailEnabled } from './notificationDefaults.ts';

const STORE = '10000000-0000-0000-0000-000000000001';
const USER = '20000000-0000-0000-0000-000000000001';
const REF = '30000000-0000-0000-0000-000000000001';
function fixture() {
  const rows: Record<string, any[]> = {
    profiles: [{id:USER,email:'seeded@croohq.test',is_active:true}], locations: [{id:STORE,name:'Seeded Store'}],
    schedules:[{id:REF,location_id:STORE,updated_at:'version1'}], shift_offers:[{id:REF,location_id:STORE,updated_at:'version1'}],
    announcement_posts:[{id:REF,location_id:STORE,subject:'Saved announcement',updated_at:'version1'}],
    chats:[{id:REF,location_id:STORE,title:'Seeded chat'}], messages:[{id:REF,chat_id:REF,created_at:'version1'}],
    user_notification_settings:[], email_queue:[], bounced_emails:[],suppressed_emails:[],
    scheduled_shifts:[{id:REF,user_id:USER,schedule_id:REF,start_time:'09:00:00'}],
    certifications:[{id:REF,user_id:USER,certification_type:'Food handler',expiration_date:'2026-11-09'}],
    toast_shifts:[{id:REF,croo_user_id:USER,location_id:STORE,in_time:'2026-11-02T17:00:00Z'}],
    read_and_sign_assignments:[{id:REF,employee_id:USER,document_id:REF,signed_at:null}],
    read_and_sign_documents:[{id:REF,location_id:STORE,title:'Saved document',is_active:true}],
    location_settings:[{location_id:STORE,timezone:'America/Los_Angeles'}],
  };
  let now = 0;
  const client = {
    from(table:string) {
      let filtered = [...(rows[table] ?? [])];let single = false;
      const q:any = {select:()=>q,eq:(k:string,v:any)=>{filtered=filtered.filter(r=>r[k]===v);return q;},in:(k:string,v:any[])=>{filtered=filtered.filter(r=>v.includes(r[k]));return q;},order:()=>q,limit:(n:number)=>{filtered=filtered.slice(0,n);return q;},maybeSingle:()=>{single=true;return q;},then:(resolve:any)=>Promise.resolve({data:single?(filtered[0]??null):filtered,error:null}).then(resolve)};
      return q;
    },
    rpc(name:string,args:any) {
      assertEquals(name,'queue_notification_email');
      const dedup_key=`${args._type}:${args._ref}:${args._user_id}`;
      const dup=rows.email_queue.some(r=>r.dedup_key===dedup_key || (args._chat_id && r.chat===args._chat_id && now-r.time<30*60*1000));
      if(!dup) rows.email_queue.push({dedup_key,html:args._html,chat:args._chat_id,time:now});
      return Promise.resolve({data:!dup,error:null});
    },
  };
  const input:NotifyEmailInput={notification_type:'announcements',eligible_user_ids:[USER],location_id:STORE,data:{post_id:REF},tokenUsers:new Set(),pushResults:new Map(),fromHomeAllowed:new Set([USER])};
  const setting=(enabled:boolean,type='announcements')=>rows.user_notification_settings.push({user_id:USER,location_id:STORE,notification_type:type,email_enabled:enabled});
  return {rows,input,setting,run:()=>notifyEmail(client,input),setNow:(n:number)=>{now=n;}};
}
for(const [type,data] of [['schedule_published',{schedule_id:REF}],['shift_offer',{offer_id:REF}],['announcements',{post_id:REF}]] as const) Deno.test(`${type}: no token fallback correct dedup, repeat suppressed`,async()=>{
  const f=fixture();f.input.notification_type=type;f.input.data=data;
  assertEquals(await f.run(),{emailed:1,emailed_fallback:1});assertEquals(f.rows.email_queue[0].dedup_key,`${type}:${REF}:version1:${USER}`);
  assertEquals(await f.run(),{emailed:0,emailed_fallback:0});assertEquals(f.rows.email_queue.length,1);
});
Deno.test('announcement registered push + email OFF only push; ON adds email',async()=>{
  const f=fixture();f.input.tokenUsers.add(USER);f.setting(false);assertEquals((await f.run()).emailed,0);
  f.rows.user_notification_settings[0].email_enabled=true;assertEquals(await f.run(),{emailed:1,emailed_fallback:0});
});
Deno.test('chat no token OFF no fallback; ON rolling thirty-minute throttle',async()=>{
  const f=fixture();f.input.notification_type='chat_messages';f.input.data={chat_id:REF};f.setting(false,'chat_messages');
  assertEquals((await f.run()).emailed,0);f.rows.user_notification_settings[0].email_enabled=true;
  assertEquals((await f.run()).emailed,1);f.rows.messages[0].id='30000000-0000-0000-0000-000000000002';f.setNow(29*60*1000);assertEquals((await f.run()).emailed,0);
  f.setNow(31*60*1000);assertEquals((await f.run()).emailed,1);
});
for(const exclusion of ['example','inactive','bounce','suppression']) Deno.test(`${exclusion} address excluded`,async()=>{
  const f=fixture();
  if(exclusion==='example') f.rows.profiles[0].email='Seeded@EXAMPLE.com';
  if(exclusion==='inactive') f.rows.profiles[0].is_active=false;
  if(exclusion==='bounce') f.rows.bounced_emails.push({email_address:'SEEDED@croohq.test'});
  if(exclusion==='suppression') f.rows.suppressed_emails.push({email:'SEEDED@croohq.test'});
  assertEquals((await f.run()).emailed,0);
});
Deno.test('caller body/html never used; stored values escaped',async()=>{
  const f=fixture();f.input.data.body='CLIENT_SECRET_BODY';f.input.data.html='<script>CLIENT_SECRET_HTML</script>';
  f.rows.announcement_posts[0].subject='<b>Saved & safe</b>';await f.run();
  const html=f.rows.email_queue[0].html;assert(!html.includes('CLIENT_SECRET'));assert(html.includes('&lt;b&gt;Saved &amp; safe&lt;/b&gt;'));
});
Deno.test('only all-dead 404/410 pushes trigger fallback; transient/mixed success does not',async()=>{
  const f=fixture();f.input.tokenUsers.add(USER);f.setting(false);
  f.input.pushResults.set(USER,{attempted:2,dead:1,succeeded:0});assertEquals((await f.run()).emailed,0);
  f.input.pushResults.set(USER,{attempted:2,dead:2,succeeded:0});assertEquals((await f.run()).emailed_fallback,1);
});
Deno.test('off-clock opt-in email skipped, fallback bypasses From home',async()=>{
  const f=fixture();f.input.notification_type='chat_messages';f.input.data={chat_id:REF};f.setting(true,'chat_messages');f.input.fromHomeAllowed.clear();assertEquals((await f.run()).emailed,0);
  f.input.notification_type='announcements';f.input.data={post_id:REF};assertEquals((await f.run()).emailed_fallback,1);
});
Deno.test('no per-item overdue email even opt-in',async()=>{
  const f=fixture();f.input.notification_type='overdue_checklists';f.setting(true,'overdue_checklists');assertEquals((await f.run()).emailed,0);
});
Deno.test('rollback flag disables queueing',async()=>{
  Deno.env.set('NOTIFY_EMAIL_ENABLED','false');try{assertEquals((await fixture().run()).emailed,0);}finally{Deno.env.delete('NOTIFY_EMAIL_ENABLED');}
});
Deno.test('approved email defaults concrete values and identical copies',async()=>{
  for(const key of ['announcements','shift_reminders','certification_expiring','new_job_application','time_off_weekly_digest','hiring_interview_response']) assertEquals(defaultEmailEnabled(key),true);
  for(const key of ['overdue_checklists','late_arrivals','chat_messages','hourly_sales_pulse','day_part_pulse','shift_overstay','cash_drawer_count','cash_safe_count','cash_bank_deposit']) assertEquals(defaultEmailEnabled(key),false);
  assertEquals(await Deno.readTextFile(new URL('./notificationDefaults.ts',import.meta.url)),await Deno.readTextFile(new URL('../../../src/lib/notificationDefaults.ts',import.meta.url)));
});
for(const type of ['hourly_sales_pulse','day_part_pulse']) Deno.test(`${type}: deliberate opt-in only, one email per store pulse`,async()=>{
  const f=fixture();f.input.notification_type=type;f.input.data={dedup_ref:'verified-pulse-11'};
  assertEquals((await f.run()).emailed,0);f.setting(true,type);
  assertEquals((await f.run()).emailed,1);assertEquals((await f.run()).emailed,0);
  f.input.data.dedup_ref='verified-pulse-12';assertEquals((await f.run()).emailed,1);
});
for (const [type,data] of [
  ['late_arrival_self',{shift_id:REF}], ['no_call_no_show_self',{shift_id:REF}],
  ['cert_expiring_self',{cert_id:REF}], ['read_and_sign',{assignment_id:REF}],
] as const) {
  Deno.test(`${type}: always email with token, toggle OFF and off-clock; dedup and sandbox exclusion`,async()=>{
    const f=fixture();f.input.notification_type=type;f.input.data={...data,dedup_ref:`seed-${type}`,body:'UNTRUSTED',html:'UNTRUSTED'};
    f.input.tokenUsers.add(USER);f.input.fromHomeAllowed.clear();f.setting(false,type);
    assert(EMAIL_ALWAYS_KEYS.has(type));assertEquals(await f.run(),{emailed:1,emailed_fallback:0});
    assertEquals(f.rows.email_queue[0].dedup_key,`${type}:seed-${type}:${USER}`);
    assert(!f.rows.email_queue[0].html.includes('UNTRUSTED'));
    assertEquals((await f.run()).emailed,0);
    f.rows.email_queue=[];f.rows.profiles[0].email='sandbox@example.com';assertEquals((await f.run()).emailed,0);
  });
  Deno.test(`${type}: no token also emails, non-owner never receives content`,async()=>{
    const f=fixture();f.input.notification_type=type;f.input.data=data;f.input.fromHomeAllowed.clear();
    assertEquals((await f.run()).emailed,1);
    f.rows.email_queue=[];f.input.eligible_user_ids=['20000000-0000-0000-0000-000000000002'];assertEquals((await f.run()).emailed,0);
  });
}
Deno.test('Toast late employee copy uses stored mapped employee, not caller text',async()=>{
 const f=fixture();f.input.notification_type='late_arrival_self';f.input.data={toast_shift_id:REF};f.input.fromHomeAllowed.clear();
 assertEquals((await f.run()).emailed,1);assert(f.rows.email_queue[0].html.includes('from Toast'));
});