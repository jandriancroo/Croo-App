// THE only client path that sends a checklist nudge: the dashboard sheet and Theo's Send nudge tap both call this.
// The server (checklist-nudge) decides who gets it: everyone on the clock at the store, minus the sender, minus cooldown.
import { BellRing } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

/** One swappable icon for the badge, the sheet button and the alert card. */
export const NUDGE_ICON = BellRing;

// Must equal NUDGE_ROLES in supabase/functions/_shared/theoActions.ts (checked by src/lib/nudgePlan.test.ts).
export const NUDGE_ROLES_CLIENT = ['manager', 'admin', 'org_admin', 'brand_admin', 'super_admin'];

export { renderNudgeText, DEFAULT_NUDGE_TEMPLATES, MAX_MESSAGE as NUDGE_MAX_MESSAGE, MAX_TEMPLATES as NUDGE_MAX_TEMPLATES } from '../../supabase/functions/_shared/nudgePlan';

export type NudgeOptions = {
  allowed: boolean; reason: string | null;
  checklist: { id: string; title: string; done: number; total: number };
  store: { id: string; name: string }; sender_first_name: string;
  going: { id: string; name: string; first_name: string }[];
  recently: { id: string; name: string; minutes_ago: number }[];
  templates: { id: string | null; name: string; body: string; is_default: boolean }[];
  default_template_id: string | null;
};

export type NudgeSendResult =
  | { ok: true; batch_id: string; sent: { id: string; name: string }[]; recently: { id: string; name: string; minutes_ago: number }[] }
  | { ok: false; error: string };

async function readError(error: any): Promise<string> {
  try {
    const body = await error?.context?.json?.();
    if (body?.error) return body.error;
  } catch { /* ignore */ }
  return error?.message || 'Something went wrong.';
}

export async function getNudgeOptions(checklistId: string): Promise<NudgeOptions> {
  const { data, error } = await supabase.functions.invoke('checklist-nudge', { body: { action: 'options', checklist_id: checklistId } });
  if (error) throw new Error(await readError(error));
  return data as NudgeOptions;
}

export async function sendChecklistNudge(args: { checklistId: string; message: string; templateId?: string | null; source: 'dashboard' | 'theo_chat' | 'theo_voice'; theoProposalId?: string | null }): Promise<NudgeSendResult> {
  const { data, error } = await supabase.functions.invoke('checklist-nudge', {
    body: { action: 'send', checklist_id: args.checklistId, message: args.message, template_id: args.templateId ?? null, source: args.source, theo_proposal_id: args.theoProposalId ?? null },
  });
  if (error) return { ok: false, error: await readError(error) };
  return data as NudgeSendResult;
}

export const nameList = (names: string[]) =>
  names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
