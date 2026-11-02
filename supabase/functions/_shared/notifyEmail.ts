import { escapeEmailHtml, renderEmailHeader, resolveEmailLogo } from './emailHeader.ts';
import { defaultEmailEnabled, emailSettingsKey, EMAIL_FALLBACK_KEYS } from './notificationDefaults.ts';
import { DateTime } from 'https://esm.sh/luxon@3.7.2';

export const EMAIL_ALWAYS_KEYS = new Set(['late_arrival_self', 'no_call_no_show_self', 'cert_expiring_self', 'read_and_sign']);

export type PushOutcome = { attempted: number; succeeded: number; dead: number };
export interface NotifyEmailInput {
  notification_type: string;
  eligible_user_ids: string[];
  location_id?: string;
  data: Record<string, any>;
  tokenUsers: Set<string>;
  pushResults: Map<string, PushOutcome>;
  fromHomeAllowed: Set<string>;
}
const UUID = /^[0-9a-f]{8}-[0-9a-f-]{27}$/i;
const LABELS: Record<string, string> = {
  announcements: 'Announcements', schedule_updates: 'Schedule updates', shift_reminders: 'Shift reminders',
  shift_approvals: 'Shift approvals', late_arrivals: 'Late arrivals', certification_expiring: 'Certification alerts',
  employee_write_up: 'Employee write-up', read_and_sign: 'Read and sign', training_approval: 'Training approval',
  chat_messages: 'Chat messages', hourly_sales_pulse: 'Hourly sales pulse', day_part_pulse: 'Day part pulse',
  shift_overstay: 'Shift overstay', cash_drawer_count: 'Drawer counts', cash_safe_count: 'Safe counts',
  cash_bank_deposit: 'Bank deposits', logbook_entry: 'Logbook entry', catering_order: 'Catering order',
  task_assigned: 'Task assigned', quick_task: 'Quick task', alarm_task: 'Task reminder',
  late_arrival_self: 'Your late arrival', no_call_no_show_self: 'Please contact your manager',
  cert_expiring_self: 'Your certification',
};

// Record values are used only after scope verification; no request title/body/html reaches this module.
async function template(client: any, i: NotifyEmailInput, key: string) {
  const d = i.data;
  const load = async (table: string, id: string) => {
    if (!UUID.test(id)) return null;
    const r = await client.from(table).select('*').eq('id', id).maybeSingle();
    if (r.error || !r.data || (r.data.location_id && r.data.location_id !== i.location_id)) return null;
    return r.data;
  };
  let ref: string | undefined;
  let paragraph = `There is a new ${LABELS[key]?.toLowerCase() ?? 'notification'} for you.`;
  let path = '/dashboard';
  let chat: string | null = null;
  let owner: string | null = null;
  const postId = d.post_id ?? d.postId;
  const chatId = d.chat_id ?? d.chatId;
  if (EMAIL_ALWAYS_KEYS.has(i.notification_type)) {
    const loc = await load('locations', i.location_id ?? '');
    const settings = await client.from('location_settings').select('timezone').eq('location_id', i.location_id).maybeSingle();
    if (!loc || settings.error) return null;
    const zone = settings.data?.timezone ?? 'America/Los_Angeles';
    if (i.notification_type === 'read_and_sign') {
      const assignment = await load('read_and_sign_assignments', d.assignment_id);
      const doc = assignment && await load('read_and_sign_documents', assignment.document_id);
      if (!assignment || !doc || !doc.is_active || assignment.signed_at || doc.location_id !== i.location_id) return null;
      owner = assignment.employee_id;
      ref = assignment.id;
      paragraph = `New document to read & sign: ${doc.title}.`;
    } else if (i.notification_type === 'cert_expiring_self') {
      const cert = await load('certifications', d.cert_id);
      if (!cert) return null;
      owner = cert.user_id;
      ref = cert.id;
      const expiry = DateTime.fromFormat(String(cert.expiration_date), 'yyyy-MM-dd', { zone });
      if (!expiry.isValid) return null;
      const days = Math.round(expiry.diff(DateTime.now().setZone(zone).startOf('day'), 'days').days);
      paragraph = `Your ${cert.certification_type} expires ${days === 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`}. Upload your new card in CrooHQ so you stay on the schedule.`;
      path = '/certifications';
    } else if (d.toast_shift_id) {
      const shift = await load('toast_shifts', d.toast_shift_id);
      if (!shift || shift.location_id !== i.location_id || !shift.in_time) return null;
      owner = shift.croo_user_id;
      ref = shift.id;
      paragraph = `You clocked in late at ${loc.name} today (from Toast).`;
      path = '/schedule';
    } else {
      const shift = await load('scheduled_shifts', d.shift_id);
      const schedule = shift && await load('schedules', shift.schedule_id);
      if (!shift || !schedule || schedule.location_id !== i.location_id) return null;
      owner = shift.user_id;
      ref = shift.id;
      const start = DateTime.fromFormat(String(shift.start_time).slice(0, 5), 'HH:mm', { zone }).toFormat('h:mm a');
      paragraph = i.notification_type === 'no_call_no_show_self'
        ? `You were scheduled at ${start} at ${loc.name} and haven't clocked in. Please contact your manager now.`
        : `You were scheduled at ${start} at ${loc.name}. You haven't clocked in yet. If you're running late, let your manager know.`;
      path = '/schedule';
    }
    if (!owner || !i.eligible_user_ids.includes(owner)) return null;
  } else if (postId) {
    const post = await load('announcement_posts', postId);
    if (!post || post.deleted_at) return null;
    paragraph = post.subject ? `New announcement: ${post.subject}` : 'A new team announcement is ready.';
    ref = `${post.id}:${post.updated_at ?? post.created_at}`;
    path = `/messages?post=${encodeURIComponent(post.id)}`;
  } else if (chatId) {
    const record = await load('chats', chatId);
    if (!record) return null;
    if (key === 'announcements' && !record.is_announcement) return null;
    chat = record.id;
    paragraph = `New messages in ${record.title || 'your chat'}.`;
    ref = `${record.id}:${record.updated_at ?? record.created_at}`;
    // Latest persisted message gives an event reference, never caller preview.
    const msg = await client.from('messages').select('id,created_at').eq('chat_id', record.id).order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (msg.error) return null;
    if (msg.data) ref = msg.data.id;
    path = `/messages?chat=${encodeURIComponent(record.id)}`;
  } else if (d.schedule_id || d.shift_id || d.offer_id) {
    const table = d.offer_id ? 'shift_offers' : d.shift_id ? 'scheduled_shifts' : 'schedules';
    let record = await load(table, d.offer_id ?? d.shift_id ?? d.schedule_id);
    if (!record) return null;
    if (!record.location_id && record.schedule_id) {
      const schedule = await load('schedules', record.schedule_id);
      if (!schedule) return null;
      record = { ...record, location_id: schedule.location_id };
    }
    if (record.location_id !== i.location_id) return null;
    ref = `${record.id}:${record.updated_at ?? record.published_at ?? record.created_at}`;
    paragraph = key === 'shift_approvals' ? 'Your shift offer or approval has an update.' : key === 'late_arrivals' ? 'A scheduled shift needs attention.' : 'Your schedule has an update. Check your shifts.';
    path = '/schedule';
  } else if (d.task_id || d.cert_id || d.certification_id) {
    const cert = d.cert_id ?? d.certification_id;
    const record = await load(cert ? 'certifications' : 'temporary_tasks', cert ?? d.task_id);
    if (!record) return null;
    if (cert && !i.eligible_user_ids.includes(record.user_id)) return null;
    ref = `${record.id}:${record.updated_at ?? record.created_at}`;
    paragraph = cert ? 'Your certification needs attention. Check its expiration date.' : `A task is ready: ${record.title || 'Assigned task'}.`;
    path = cert ? '/settings' : '/dashboard';
  } else if (d.ticket_id) {
    const ticket = await load('support_tickets', d.ticket_id);
    if (!ticket) return null;
    ref = `${ticket.id}:${ticket.updated_at ?? ticket.created_at}`;
    paragraph = 'There is a new response from CrooHQ support.';
    path = '/settings';
  } else if (['logbook_entry', 'cash_drawer_count', 'cash_safe_count', 'cash_bank_deposit', 'catering_order'].includes(key)) {
    let q = client.from(key === 'catering_order' ? 'catering_orders' : 'logbook_entries').select('id,updated_at,created_at').eq('location_id', i.location_id);
    if (d.entry_id || d.order_id) q = q.eq('id', d.entry_id ?? d.order_id);
    const r = await q.order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (r.error || !r.data) return null;
    ref = `${r.data.id}:${r.data.updated_at ?? r.data.created_at}`;
  }
  // Service-origin stable alert ref permits fixed generic text without private row values.
  if (typeof d.dedup_ref === 'string' && d.dedup_ref.length <= 500) ref = d.dedup_ref;
  if (!ref || !LABELS[key]) return null;
  if (key === 'hourly_sales_pulse' || key === 'day_part_pulse') ref = `${i.location_id}:${ref}`;
  return { ref, paragraph, path, chat, owner };
}

export async function notifyEmail(client: any, i: NotifyEmailInput): Promise<{ emailed: number; emailed_fallback: number }> {
  const counts = { emailed: 0, emailed_fallback: 0 };
  if (Deno.env.get('NOTIFY_EMAIL_ENABLED') === 'false') return counts;
  const key = emailSettingsKey(i.notification_type);
  const always = EMAIL_ALWAYS_KEYS.has(i.notification_type);
  if (!i.location_id || key === 'overdue_checklists' || key === 'test' || i.data.type === 'hiring_message') return counts;
  const content = await template(client, i, key);
  if (!content) return counts;
  const settings = await client.from('user_notification_settings').select('user_id,email_enabled').eq('notification_type', key).eq('location_id', i.location_id).in('user_id', i.eligible_user_ids);
  const profiles = await client.from('profiles').select('id,email,is_active').in('id', i.eligible_user_ids);
  const bounced = await client.from('bounced_emails').select('email_address');
  const suppressed = await client.from('suppressed_emails').select('email');
  if (settings.error || profiles.error || bounced.error || suppressed.error) return counts;
  const blocked = new Set<string>([...(bounced.data ?? []).map((r: any) => String(r.email_address).toLowerCase()), ...(suppressed.data ?? []).map((r: any) => String(r.email).toLowerCase())]);
  const loc = await client.from('locations').select('name').eq('id', i.location_id).maybeSingle();
  if (loc.error || !loc.data) return counts;
  const logo = await resolveEmailLogo(client, { locationId: i.location_id });
  for (const p of profiles.data ?? []) {
    if (content.owner && p.id !== content.owner) continue;
    const email = String(p.email ?? '').trim().toLowerCase();
    if (p.is_active !== true || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || /@example\.com$/i.test(email) || blocked.has(email)) continue;
    const outcome = i.pushResults.get(p.id);
    const fallback = EMAIL_FALLBACK_KEYS.has(key) && (!i.tokenUsers.has(p.id) || !!(outcome && outcome.attempted > 0 && outcome.dead === outcome.attempted && outcome.succeeded === 0));
    const enabled = (settings.data ?? []).find((s: any) => s.user_id === p.id)?.email_enabled ?? defaultEmailEnabled(key);
    if (!always && !fallback && (!enabled || !i.fromHomeAllowed.has(p.id))) continue;
    const e = escapeEmailHtml;
    const label = LABELS[key];
    const html = `<html><body style="background:#f4f5f6;font-family:Arial,sans-serif"><table role="presentation" style="max-width:600px;width:100%;margin:auto;background:#fff">${renderEmailHeader({ title: label, logoUrl: logo.logoUrl, alt: logo.alt, line1: loc.data.name })}<tr><td style="padding:28px"><p>${e(content.paragraph)}</p><a href="${e('https://croohq.com' + content.path)}" style="display:inline-block;background:#0a7a8a;color:#fff;padding:12px 20px;text-decoration:none">Open CrooHQ</a><p style="font-size:12px;color:#666">You're getting this because email is on for ${e(label)}, or push isn't set up on your phone. Manage: <a href="https://croohq.com/settings?section=notifications">https://croohq.com/settings</a> (Notifications).</p></td></tr></table></body></html>`;
    const queued = await client.rpc('queue_notification_email', { _user_id: p.id, _location_id: i.location_id, _type: i.notification_type, _ref: content.ref, _email: email, _subject: `${label} — ${loc.data.name}`, _html: html, _chat_id: key === 'chat_messages' ? content.chat : null });
    if (queued.error) throw new Error('notification_email_queue');
    if (queued.data === true) { counts.emailed++; if (fallback) counts.emailed_fallback++; }
  }
  console.log(JSON.stringify(counts));
  return counts;
}