import { DateTime } from 'https://esm.sh/luxon@3.7.2';
import { checklistScorePeriod, checklistShowsOn } from '../_shared/taskHistory/schedule.ts';
import { deliverableEmail, suppressedEmailSet } from '../_shared/emailRecipients.ts';
import { escapeEmailHtml, renderEmailHeader, resolveEmailLogo } from '../_shared/emailHeader.ts';

type Row = Record<string, any>;
const MANAGER_ROLES = ['shift_manager','manager','general_manager','admin','org_admin','brand_admin','super_admin','fbc'];

async function rows(query: any): Promise<Row[]> {
  const result = await query;
  if (result.error) throw new Error('Digest data unavailable');
  return result.data ?? [];
}

export function closeWindow(now: DateTime, timezone: string, hoursClose?: string | null) {
  const local = now.setZone(timezone);
  const time = /^\d{2}:\d{2}/.test(hoursClose ?? '') ? String(hoursClose).slice(0,5) : '21:00';
  const close = DateTime.fromFormat(`${local.toFormat('yyyy-MM-dd')} ${time}`, 'yyyy-MM-dd HH:mm', { zone: timezone });
  return { local, date: local.toFormat('yyyy-MM-dd'), close, ready: close.isValid && local >= close };
}

/** Alert scoring: live items only; answered child also completes its section header. */
export function remainingItems(checklist: Row, items: Row[], answered: Set<string>, weekday: number): Row[] {
  const live = items.filter(i => i.deleted_at == null).sort((a,b) => a.order_index-b.order_index);
  const scoped = live.filter(i => i.item_type === 'section_header' || checklist.template_type !== 'dynamic'
    || (Array.isArray(i.days_of_week) && i.days_of_week.includes(weekday)));
  const sections = new Set<number>();
  for (const item of scoped) {
    if (item.item_type === 'section_header' || !answered.has(item.id)) continue;
    const header = live.filter(h => h.item_type === 'section_header' && h.order_index <= item.order_index).at(-1);
    if (header) sections.add(header.order_index);
  }
  return scoped.filter(i => i.item_type === 'section_header' ? !sections.has(i.order_index) : !answered.has(i.id));
}

export function dueToday(c: Row, date: string, local: DateTime, close: DateTime): boolean {
  if (!c.is_active || c.superseded_at || c.template_type === 'training') return false;
  const period = checklistScorePeriod(c,date);
  if (period.kind === 'week' && local.weekday !== 7) return false;
  if ((period.kind === 'month' || period.kind === 'quarter') &&
    (!checklistShowsOn(c,date) || DateTime.fromFormat(period.end,'yyyy-MM-dd',{zone:local.zoneName ?? 'America/Los_Angeles'}).diff(local.startOf('day'),'days').days > 3)) return false;
  if (period.kind === 'day' && !checklistShowsOn(c,date)) return false;
  if (!c.due_by_time && period.kind !== 'month' && period.kind !== 'quarter') return false;
  const due = c.due_by_time ? DateTime.fromFormat(`${date} ${String(c.due_by_time).slice(0,5)}`,'yyyy-MM-dd HH:mm',{zone:local.zoneName ?? 'America/Los_Angeles'}) : close;
  return due.isValid && local >= due;
}

async function overdueAt(client: any, loc: Row, window: ReturnType<typeof closeWindow>): Promise<Row[]> {
  const lists = await rows(client.from('checklists').select('*').eq('location_id',loc.id).eq('is_active',true).is('superseded_at',null));
  const candidates = lists.filter(c => dueToday(c,window.date,window.local,window.close));
  if (!candidates.length) return [];
  const ids = candidates.map(c=>c.id);
  const [items,tags,stations,hours] = await Promise.all([
    rows(client.from('checklist_items').select('id,checklist_id,item_type,order_index,days_of_week,deleted_at,station_id,assigned_role').in('checklist_id',ids)),
    rows(client.from('checklist_role_tags').select('checklist_id,role').in('checklist_id',ids)),
    rows(client.from('location_stations').select('id,name').eq('location_id',loc.id)),
    rows(client.from('location_hours').select('day_of_week,close_time').eq('location_id',loc.id)),
  ]);
  const dayClose = hours.find(h=>h.day_of_week === window.local.weekday-1)?.close_time;
  const closeHour = dayClose ? Number(String(dayClose).slice(0,2)) : -1;
  const cutoff = closeHour >= 0 ? (closeHour+3)%24 : 3;
  const startHour = cutoff > 0 && cutoff < 12 ? cutoff : 0;
  const result: Row[] = [];
  const families = new Set<string>();
  for (const c of candidates) {
    const period = checklistScorePeriod(c,window.date);
    const start = DateTime.fromFormat(period.start,'yyyy-MM-dd',{zone:window.local.zoneName ?? 'America/Los_Angeles'})
      .startOf('day').plus({hours:period.kind === 'day' ? startHour : 0});
    const end = period.kind === 'day' ? start.plus({days:1}) : DateTime.fromFormat(period.end,'yyyy-MM-dd',{zone:window.local.zoneName ?? 'America/Los_Angeles'}).plus({days:1}).startOf('day');
    const submissions = await rows(client.from('checklist_submissions').select('id').eq('checklist_id',c.id).eq('location_id',loc.id).gte('submitted_at',start.toUTC().toISO()).lt('submitted_at',end.toUTC().toISO()));
    const responses = submissions.length ? await rows(client.from('checklist_responses').select('item_id').in('submission_id',submissions.map(s=>s.id))) : [];
    const pending = remainingItems(c,items.filter(i=>i.checklist_id===c.id),new Set(responses.map(r=>r.item_id)),window.local.weekday-1);
    const family = c.family_id ?? c.id;
    if (!pending.length || families.has(family)) continue;
    families.add(family);
    const assigned = new Set<string>(tags.filter(t=>t.checklist_id===c.id).map(t=>String(t.role).replaceAll('_',' ')));
    for (const item of pending) {
      if (item.assigned_role) assigned.add(String(item.assigned_role).replaceAll('_',' '));
      const station = stations.find(s=>s.id===item.station_id);
      if (station) assigned.add(station.name);
    }
    result.push({title:c.title,due:c.due_by_time ? String(c.due_by_time).slice(0,5) : window.close.toFormat('HH:mm'),assigned:[...assigned].join(', ') || 'Store team'});
  }
  return result;
}

export async function runDigest(client: any, now: DateTime = DateTime.now(), dryRun = false) {
  const counts = { locations_checked:0, eligible:0, queued:0 };
  const locations = await rows(client.from('locations').select('id,name,organization_id').eq('is_active',true));
  const settings = await rows(client.from('location_settings').select('location_id,timezone,hours_close'));
  const blocked = await suppressedEmailSet(client);
  for (const loc of locations) {
    const ls = settings.find(s=>s.location_id===loc.id);
    const window = closeWindow(now,ls?.timezone ?? 'America/Los_Angeles',ls?.hours_close);
    if (!window.ready) continue;
    counts.locations_checked++;
    const overdue = await overdueAt(client,loc,window);
    if (!overdue.length) continue;
    const members = await rows(client.from('user_locations').select('user_id').eq('location_id',loc.id));
    if (!members.length) continue;
    const ids = [...new Set(members.map(m=>m.user_id))];
    const [roles,profiles,toggles,tokens,orgRules,defaults] = await Promise.all([
      rows(client.from('user_roles').select('user_id,role').in('user_id',ids)),
      rows(client.from('profiles').select('id,email,is_active').in('id',ids)),
      rows(client.from('user_notification_settings').select('user_id,email_enabled').eq('location_id',loc.id).eq('notification_type','overdue_checklists').in('user_id',ids)),
      rows(client.from('push_notification_tokens').select('user_id').in('user_id',ids)),
      loc.organization_id ? rows(client.from('role_notification_settings').select('role,enabled').eq('organization_id',loc.organization_id).eq('notification_type','overdue_checklists')) : Promise.resolve([]),
      rows(client.from('role_notification_settings_template').select('role,enabled').eq('notification_type','overdue_checklists')),
    ]);
    const tokenUsers = new Set(tokens.map(t=>t.user_id));
    const logo = await resolveEmailLogo(client,{locationId:loc.id});
    const subject = `${loc.name}: ${overdue.length} checklists overdue today`;
    const e=escapeEmailHtml;
    const html=`<html><body style="background:#f4f5f6;font-family:Arial,sans-serif"><table role="presentation" style="max-width:600px;width:100%;margin:auto;background:#fff">${renderEmailHeader({title:'Overdue checklists',logoUrl:logo.logoUrl,alt:logo.alt,line1:loc.name})}<tr><td style="padding:28px"><p>${e(String(overdue.length))} checklists are still incomplete today.</p><ul>${overdue.map(c=>`<li><strong>${e(c.title)}</strong> — due ${e(DateTime.fromFormat(c.due,'HH:mm').toFormat('h:mm a'))}; ${e(c.assigned)}</li>`).join('')}</ul><a href="https://croohq.com/dashboard" style="display:inline-block;background:#0a7a8a;color:#fff;padding:12px 20px;text-decoration:none">Open CrooHQ</a><p style="font-size:12px;color:#666">Manage notification emails at <a href="https://croohq.com/settings?section=notifications">CrooHQ Settings</a>.</p></td></tr></table></body></html>`;
    for (const profile of profiles) {
      // Resolve highest role server-side; do not let a secondary crew role suppress a manager.
      const roleResult = await client.rpc('get_user_role',{_user_id:profile.id});
      if (roleResult.error || !MANAGER_ROLES.includes(roleResult.data) || !roles.some(r=>r.user_id===profile.id && MANAGER_ROLES.includes(r.role))) continue;
      const role=roleResult.data;
      const rule=orgRules.find(r=>r.role===role) ?? defaults.find(r=>r.role===role);
      if (rule?.enabled === false) continue;
      const email=deliverableEmail(profile,blocked);
      if (!email || !(toggles.find(t=>t.user_id===profile.id)?.email_enabled === true || !tokenUsers.has(profile.id))) continue;
      counts.eligible++;
      if (dryRun) continue;
      const dedup=`overdue_digest_${loc.id}_${window.date}_${profile.id}`;
      const queued=await client.from('email_queue').upsert({to_addresses:[email],subject,html,source:'overdue_checklist_digest',email_type:'notification',location_id:loc.id,target_date:window.date,dedup_key:dedup,metadata:{user_id:profile.id,checklist_count:overdue.length}}, {onConflict:'dedup_key',ignoreDuplicates:true}).select('id');
      if (queued.error) throw new Error('Digest queue unavailable');
      counts.queued+=(queued.data ?? []).length;
    }
  }
  return counts;
}