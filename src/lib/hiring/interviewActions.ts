import { format } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';

export type InterviewModality = 'in_person' | 'virtual' | 'phone';

export const MODALITY_LABEL: Record<InterviewModality, string> = {
  in_person: 'In person',
  virtual: 'Virtual',
  phone: 'Phone',
};

export function isValidMeetingUrl(v: string | null | undefined): boolean {
  if (!v) return false;
  try {
    const u = new URL(v.trim());
    return u.protocol === 'https:' && !!u.hostname;
  } catch {
    return false;
  }
}

export interface HiringConversationRow {
  id: string;
  access_token: string | null;
}

/** Returns the single hiring conversation for an application, creating it if needed. */
export async function ensureHiringConversation(applicationId: string): Promise<HiringConversationRow> {
  const select = () =>
    supabase
      .from('hiring_conversations')
      .select('id, access_token')
      .eq('application_id', applicationId)
      .maybeSingle();

  const { data: existing, error: selErr } = await select();
  if (selErr) throw selErr;
  if (existing) return existing as HiringConversationRow;

  const { data: created, error: insErr } = await supabase
    .from('hiring_conversations')
    .insert({ application_id: applicationId })
    .select('id, access_token')
    .single();

  if (insErr) {
    if ((insErr as any).code === '23505') {
      const { data: again, error: againErr } = await select();
      if (againErr) throw againErr;
      if (again) return again as HiringConversationRow;
    }
    throw insErr;
  }
  return created as HiringConversationRow;
}

/** Sends an interview invite: chat message, application update, then email (fire-and-forget). */
export async function sendInterviewInvite({
  applicationId,
  date,
  time,
  userId,
  modality = 'in_person',
  meetingUrl = null,
  keepStatus = 'pending',
}: {
  applicationId: string;
  date: Date;
  time: string;
  userId: string;
  modality?: InterviewModality;
  meetingUrl?: string | null;
  keepStatus?: 'pending' | 'accepted';
}): Promise<void> {
  const url = modality === 'virtual' ? (meetingUrl || '').trim() : '';
  if (modality === 'virtual' && !isValidMeetingUrl(url)) {
    throw new Error('A valid https meeting link is required for a virtual interview');
  }
  const conversation = await ensureHiringConversation(applicationId);
  const conversationId = conversation.id;

  const interviewData = {
    date: format(date, 'yyyy-MM-dd'),
    time,
    status: keepStatus,
    modality,
    ...(url ? { meeting_url: url } : {}),
  };

  const { error: msgError } = await supabase.from('hiring_messages').insert({
    conversation_id: conversationId,
    sender_type: 'staff',
    sender_id: userId,
    content: `INTERVIEW_INVITE:${JSON.stringify(interviewData)}`,
  });
  if (msgError) throw msgError;

  const { data: application, error: appError } = await supabase
    .from('job_applications')
    .update({
      interview_date: interviewData.date,
      interview_time: time,
      interview_status: keepStatus,
      interview_modality: modality,
      interview_meeting_url: url || null,
      status: 'interviewing',
    } as any)
    .eq('id', applicationId)
    .select('location:locations(name, address)')
    .single();
  if (appError) throw appError;

  const { data: senderProfile, error: profErr } = await supabase
    .from('profiles')
    .select('full_name')
    .eq('id', userId)
    .maybeSingle();
  if (profErr) console.error('Failed to load sender name:', profErr);

  const location = (application as any)?.location;

  supabase.functions
    .invoke('hiring-email-service', {
      body: {
        action: 'send_interview_invite',
        conversationId,
        interviewDate: interviewData.date,
        interviewTime: time,
        locationName: location?.name || 'TBD',
        locationAddress: location?.address,
        scheduledByName: senderProfile?.full_name || 'Hiring Team',
        modality,
        meetingUrl: url || null,
      },
    })
    .then(({ error }) => {
      if (error) console.error('Failed to send interview invite email:', error);
    });
}

/**
 * Cancels the current interview. Marks the latest open invite bubble cancelled,
 * clears the date/time/link on the application, sets interview_status
 * 'cancelled' and leaves the applicant in Interviewing (never bounces to pending).
 */
export async function cancelInterview({
  applicationId,
  userId,
  postMessage = true,
}: {
  applicationId: string;
  userId: string;
  postMessage?: boolean;
}): Promise<void> {
  if (postMessage) {
    const { data: conv, error: convErr } = await supabase
      .from('hiring_conversations')
      .select('id')
      .eq('application_id', applicationId)
      .maybeSingle();
    if (convErr) throw convErr;
    if (conv) {
      const { data: msgs, error: mErr } = await supabase
        .from('hiring_messages')
        .select('id, content')
        .eq('conversation_id', conv.id)
        .like('content', 'INTERVIEW_INVITE:%')
        .order('created_at', { ascending: false })
        .limit(1);
      if (mErr) throw mErr;
      const latest = msgs?.[0];
      if (latest) {
        try {
          const data = JSON.parse(latest.content.replace('INTERVIEW_INVITE:', ''));
          if (data.status !== 'cancelled' && data.status !== 'declined') {
            data.status = 'cancelled';
            const { error: insErr } = await supabase.from('hiring_messages').insert({
              conversation_id: conv.id,
              sender_type: 'staff',
              sender_id: userId,
              content: `INTERVIEW_INVITE:${JSON.stringify(data)}`,
            });
            if (insErr) throw insErr;
          }
        } catch (e) {
          if ((e as any)?.code) throw e;
        }
      }
    }
  }

  const { error } = await supabase
    .from('job_applications')
    .update({
      interview_date: null,
      interview_time: null,
      interview_status: 'cancelled',
      interview_meeting_url: null,
      interview_modality: null,
      status: 'interviewing',
    } as any)
    .eq('id', applicationId);
  if (error) throw error;
}

/**
 * Quick bump: pushes an upcoming interview back N minutes (same day, same link).
 * Posts a new invite bubble + email with the new time. An already-accepted
 * interview stays accepted. Returns the new HH:mm.
 */
export async function bumpInterview({
  app,
  minutes,
  userId,
}: {
  app: {
    id: string;
    interview_date: string;
    interview_time: string;
    interview_status?: string | null;
    interview_modality?: InterviewModality | null;
    interview_meeting_url?: string | null;
  };
  minutes: number;
  userId: string;
}): Promise<string> {
  const [h, m] = app.interview_time.slice(0, 5).split(':').map(Number);
  const total = h * 60 + m + minutes;
  if (total >= 24 * 60) throw new Error('That would push the interview past midnight');
  const newTime = `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
  const [y, mo, d] = app.interview_date.split('-').map(Number);
  await sendInterviewInvite({
    applicationId: app.id,
    date: new Date(y, mo - 1, d),
    time: newTime,
    userId,
    modality: app.interview_modality || 'in_person',
    meetingUrl: app.interview_meeting_url || null,
    keepStatus: app.interview_status === 'accepted' ? 'accepted' : 'pending',
  });
  return newTime;
}
