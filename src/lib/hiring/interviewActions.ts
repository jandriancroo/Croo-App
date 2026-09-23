import { format } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';

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
}: {
  applicationId: string;
  date: Date;
  time: string;
  userId: string;
}): Promise<void> {
  const conversation = await ensureHiringConversation(applicationId);
  const conversationId = conversation.id;

  const interviewData = {
    date: format(date, 'yyyy-MM-dd'),
    time,
    status: 'pending',
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
      interview_status: 'pending',
      status: 'interviewing',
    })
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
      },
    })
    .then(({ error }) => {
      if (error) console.error('Failed to send interview invite email:', error);
    });
}
