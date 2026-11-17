import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { notifyEmail, EMAIL_ALWAYS_KEYS, managerClockAlertCopy, formatShiftStartLabel, type NotifyEmailInput } from './notifyEmail.ts';
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
    toast_shifts:[{id:REF,toast_shift_id:REF,croo_user_id:USER,location_id:STORE,in_time:'2026-11-02T17:00:00Z'}],
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
      if(!dup) rows.email_queue.push({dedup_key,html:args._html,subject:args._subject,chat:args._chat_id,time:now});
      return Promise.resolve({data:!dup,error:null});
    },
  };
  const input:NotifyEmailInput={notification_type:'announcements',eligible_user_ids:[USER],location_id:STORE,data:{post_id:REF},tokenUsers:new Set(),pushResults:new Map(),fromHomeAllowed:new Set([USER])};
  const setting=(enabled:boolean,type='announcements')=>rows.user_notification_settings.push({user_id:USER,location_id:STORE,notification_type:type,email_enabled:enabled});
  return {rows,input,setting,run:()=>notifyEmail(client,input),setNow:(n:number)=>{now=n;}};
}
for(const [type,data] of [['schedule_updates',{schedule_id:REF}],['shift_offer',{offer_id:REF}],['announcements',{post_id:REF}]] as const) Deno.test(`${type}: no token fallback correct dedup, repeat suppressed`,async()=>{
  const f=fixture();f.input.notification_type=type;f.input.data=data;
  assertEquals(await f.run(),{emailed:1,emailed_fallback:1});assertEquals(f.rows.email_queue[0].dedup_key,`${type}:${REF}:version1:${USER}`);
  assertEquals(await f.run(),{emailed:0,emailed_fallback:0});assertEquals(f.rows.email_queue.length,1);
});
Deno.test('schedule_published exclusively uses weekly email path; no generic duplicate',async()=>{
 const f=fixture();f.input.notification_type='schedule_published';f.input.data={schedule_id:REF};
 assertEquals((await f.run()).emailed,0);assertEquals(f.rows.email_queue.length,0);
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
Deno.test('manager clock alert copy uses store and employee in subject and body', () => {
  const late = managerClockAlertCopy({
    notificationType: 'late_arrivals',
    locationName: 'Hayward',
    employeeName: 'Chazzlin Davidson',
    startTimeLabel: formatShiftStartLabel('09:00:00'),
  });
  const ncns = managerClockAlertCopy({
    notificationType: 'no_call_no_show',
    locationName: 'Hayward',
    employeeName: 'Chazzlin Davidson',
    startTimeLabel: formatShiftStartLabel('09:00:00'),
  });
  assertEquals(formatShiftStartLabel('09:00:00'), '9:00 AM');
  assertEquals(late?.subject, 'Late arrival: Hayward · Chazzlin Davidson');
  assertEquals(late?.paragraph, 'Chazzlin Davidson was scheduled at 9:00 AM at Hayward and has not clocked in.');
  assertEquals(ncns?.subject, 'No-call/no-show: Hayward · Chazzlin Davidson');
  assertEquals(ncns?.paragraph, "Chazzlin Davidson was scheduled at 9:00 AM at Hayward and hasn't clocked in.");
  assertEquals(managerClockAlertCopy({ notificationType: 'late_arrivals', locationName: 'Hayward', employeeName: '  ' }), null);
});
for (const type of ['late_arrivals', 'no_call_no_show'] as const) {
  Deno.test(`${type}: manager email names Hayward and Chazzlin Davidson, keeps Open CrooHQ, uses Late arrivals setting`, async () => {
    const HAYWARD = '0d1477e5-791d-42f4-9245-ad8b2e75c41c';
    const SHIFT = 'b5d38125-0ba5-42c4-8ba2-70133c3ac7d2';
    const EMPLOYEE = '241cd70a-31c0-41b6-840d-7b802466eefc';
    const MANAGER = 'a2e81a39-0e0b-47b1-a1aa-0e53f3869d37';
    const OTHER = '20000000-0000-0000-0000-000000000099';
    const f = fixture();
    f.rows.locations[0] = {id:HAYWARD,name:'Hayward'};
    f.rows.schedules[0] = {id:SHIFT,location_id:HAYWARD,updated_at:'version1'};
    f.rows.scheduled_shifts[0] = {id:SHIFT,user_id:EMPLOYEE,schedule_id:SHIFT,start_time:'09:00:00'};
    f.rows.profiles.push({id:EMPLOYEE,full_name:'Chazzlin Davidson',email:'staff@croohq.test',is_active:true});
    f.rows.profiles[0] = {id:MANAGER,full_name:'Jordan Andrian',email:'manager@croohq.test',is_active:true};
    f.rows.profiles.push({id:OTHER,full_name:'Not Eligible',email:'other@croohq.test',is_active:true});
    f.input.location_id = HAYWARD;
    f.input.notification_type = type;
    f.input.data = {shift_id:SHIFT,body:'UNTRUSTED',html:'UNTRUSTED'};
    f.input.eligible_user_ids = [MANAGER];
    f.input.fromHomeAllowed = new Set([MANAGER]);
    assertEquals(await f.run(), {emailed:1,emailed_fallback:1});
    assertEquals(f.rows.email_queue.length, 1);
    const mail = f.rows.email_queue[0];
    const expectedSubject = type === 'no_call_no_show'
      ? 'No-call/no-show: Hayward · Chazzlin Davidson'
      : 'Late arrival: Hayward · Chazzlin Davidson';
    assertEquals(mail.subject, expectedSubject);
    assert(mail.html.includes('Chazzlin Davidson'));
    assert(mail.html.includes('Hayward'));
    assert(mail.html.includes('9:00 AM'));
    assert(mail.html.includes('Open CrooHQ'));
    assert(mail.html.includes('https://croohq.com/schedule'));
    assert(mail.html.includes('email is on for Late arrivals'));
    assert(!mail.html.includes('UNTRUSTED'));
    assert(!mail.subject.includes('Late arrivals —'));
    assertEquals(mail.dedup_key.endsWith(':' + MANAGER), true);
    assertEquals((await f.run()).emailed, 0);
    assertEquals(f.rows.email_queue.length, 1);
  });
}
Deno.test('late_arrival_self wording is unchanged and still names the store and time', async () => {
  const f = fixture();
  f.rows.locations[0].name = 'Hayward';
  f.input.notification_type = 'late_arrival_self';
  f.input.data = {shift_id:REF};
  f.input.fromHomeAllowed.clear();
  assertEquals((await f.run()).emailed, 1);
  const html = f.rows.email_queue[0].html;
  assert(html.includes('You were scheduled at 9:00 AM at Hayward'));
  assert(!f.rows.email_queue[0].subject.startsWith('Late arrival: Hayward ·'));
  assertEquals(f.rows.email_queue[0].subject, 'Your late arrival — Hayward');
});
Deno.test('equipment_check: email on by default, subject + both readings from the stored alert row, other store refused',async()=>{
  const f=fixture();
  f.rows.equipment_check_alerts=[{id:REF,location_id:STORE,unit_name:'TEMP - Walk-In Cooler',location_name:'Seeded Store',equipment_type:'walk_in',timezone:'America/Los_Angeles',
    readings:[{temp:46.2,at:'2026-11-16T22:10:00Z'},{temp:44.8,at:'2026-11-17T16:05:00Z'}]}];
  f.input.notification_type='equipment_check';f.input.data={type:'equipment_check',equipment_alert_id:REF,title:'ignored',body:'ignored'};f.input.tokenUsers.add(USER);
  assert(defaultEmailEnabled('equipment_check'));
  assertEquals((await f.run()).emailed,1);
  const mail=f.rows.email_queue[0];
  assertEquals(mail.subject,'Please check equipment: TEMP - Walk-In Cooler, Seeded Store');
  assert(mail.html.includes('46.2°F on Mon Nov 16, 2:10 PM and 44.8°F on Tue Nov 17, 8:05 AM'));
  assert(mail.html.includes('Safe range for walk-ins: 30–41°F'));
  assert(!mail.html.includes('ignored'));
  const g=fixture();g.rows.equipment_check_alerts=[{...f.rows.equipment_check_alerts[0],location_id:'10000000-0000-0000-0000-000000000009'}];
  g.input.notification_type='equipment_check';g.input.data={equipment_alert_id:REF};
  assertEquals((await g.run()).emailed,0);
});
