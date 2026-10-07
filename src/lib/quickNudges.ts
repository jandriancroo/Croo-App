// THE only client path that sends a Quick Nudge (checklists, tasks, events): the dashboard sheet and Theo's Send nudge tap.
// The server (quick-nudge) decides who gets it: everyone on the clock at the store, minus the sender, minus cooldown.
import { NudgeTapIcon } from '@/components/icons/NudgeTapIcon';
import { supabase } from '@/integrations/supabase/client';
import type { TargetType } from '../../supabase/functions/_shared/nudgePlan';

/** One swappable icon for the badges, the sheet button and the alert card. */
export const NUDGE_ICON = NudgeTapIcon;

// Must equal NUDGE_ROLES in supabase/functions/_shared/theoActions.ts (checked by src/lib/nudgePlan.test.ts).
export const NUDGE_ROLES_CLIENT = ['manager', 'admin', 'org_admin', 'brand_admin', 'super_admin'];

export {
  renderNudgeText, fieldsFor, missingFields, DEFAULT_NUDGE_TEMPLATES, FIELD_LABELS,
  MAX_MESSAGE as NUDGE_MAX_MESSAGE, MAX_TEMPLATES as NUDGE_MAX_TEMPLATES,
} from '../../supabase/functions/_shared/nudgePlan';
export type { TargetType, FieldName } from '../../supabase/functions/_shared/nudgePlan';
export { NUDGE_FIELDS } from './smartFields';

export type NudgeTargetRef = { type: TargetType; id: string; title: string };

export type NudgeOptions = {
  allowed: boolean; reason: string | null;
  target: { type: TargetType; id: string; title: string; done: number | null; total: number | null; event_time: string | null };
  store: { id: string; name: string }; sender_first_name: string;
  going: { id: string; name: string; first_name: string }[];
  recently: { id: string; name: string; minutes_ago: number }[];
  templates: { id: string | null; name: string; body: string; is_default: boolean; missing_fields: string[] }[];
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

export async function getNudgeOptions({ targetType, targetId }: { targetType: TargetType; targetId: string }): Promise<NudgeOptions> {
  const { data, error } = await supabase.functions.invoke('quick-nudge', { body: { action: 'options', target_type: targetType, target_id: targetId } });
  if (error) throw new Error(await readError(error));
  return data as NudgeOptions;
}

export async function sendQuickNudge(args: { targetType: TargetType; targetId: string; message: string; templateId?: string | null; source: 'dashboard' | 'theo_chat' | 'theo_voice'; theoProposalId?: string | null }): Promise<NudgeSendResult> {
  const { data, error } = await supabase.functions.invoke('quick-nudge', {
    body: { action: 'send', target_type: args.targetType, target_id: args.targetId, message: args.message, template_id: args.templateId ?? null, source: args.source, theo_proposal_id: args.theoProposalId ?? null },
  });
  if (error) return { ok: false, error: await readError(error) };
  return data as NudgeSendResult;
}

export const nameList = (names: string[]) =>
  names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;

/** Which item types a template body works for, from the fields it uses (tasks: done/total only when they have subtasks). */
export function worksFor(body: string): TargetType[] {
  const uses = (f: string) => new RegExp(`\\{${f}\\}`, 'i').test(body);
  const out: TargetType[] = [];
  if (!uses('event_time')) out.push('checklist', 'task');
  if (!uses('done') && !uses('total')) out.push('event');
  return out;
}
