import { DateTime } from 'luxon';
import { supabase } from '@/integrations/supabase/client';

export type LawCheckKind = 'build' | 'recheck';

export interface LawCheckResult {
  status: 'pending' | 'no_changes' | 'rate_limited' | 'failed' | 'not_connected';
  proposal_id?: string;
  state?: string;
  changes?: number;
  reason?: string;
  next_at?: string;
  error?: string;
}

/** The only place the app asks the server for a labor-law check. */
export async function requestLaborLawCheck(locationId: string, kind: LawCheckKind): Promise<LawCheckResult> {
  const { data, error } = await supabase.functions.invoke('labor-rules-ai', {
    body: { action: 'propose', location_id: locationId, kind },
  });
  if (error) {
    let msg = error.message;
    try { const t = await (error as any).context?.text?.(); if (t) msg = JSON.parse(t).error || msg; } catch { /* keep message */ }
    throw new Error(msg);
  }
  return data as LawCheckResult;
}

export interface ProposalDiffRow {
  field: string;
  current: unknown;
  suggested: unknown;
  current_source?: string | null;
  citation?: { url: string; quote?: string; state?: string } | null;
  confidence?: number | null;
}

/** Ticked by default only when the AI is confident and a person didn't set the current value by hand. */
export function defaultTicked(row: Pick<ProposalDiffRow, 'confidence' | 'current_source' | 'citation'>): boolean {
  if (!row.citation?.url) return false;
  if (row.current_source === 'manual') return false;
  return typeof row.confidence === 'number' && row.confidence >= 0.7;
}

export function hostOf(url: string): string {
  try { return new URL(url).hostname; } catch { return url; }
}

export const formatPT = (iso: string | null | undefined, fmt = 'MMM d, yyyy h:mm a') =>
  iso ? DateTime.fromISO(iso).setZone('America/Los_Angeles').toFormat(fmt) + ' PT' : '';

/** "…, Palm Springs, CA 92262" → "CA" */
export function stateFromAddress(address: string | null | undefined): string | null {
  const m = /,\s*([A-Z]{2})\s*\d{5}/.exec(address || '');
  return m ? m[1] : null;
}
