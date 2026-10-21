import type { Database } from '@/integrations/supabase/types';

export type SystemAlert = Database['public']['Tables']['system_alerts']['Row'];
export const ALERT_THEMES = [
  { value: 'default', label: 'Default' }, { value: 'oled', label: 'Dark Mode' },
  { value: 'earth', label: 'Warm Earth' }, { value: 'beach', label: 'Beach' },
  { value: 'cupcake', label: 'Cupcake' }, { value: 'spookified', label: 'Spookified' },
];

export function safeAlertLink(value: string): boolean {
  if (value.includes('\\') || !(/^(https:\/\/|\/)/.test(value))) return false;
  if (/^\/[^/\\]/.test(value) && !value.includes('\\')) return true;
  try { return new URL(value).protocol === 'https:'; } catch { return false; }
}

export function systemAlertIsDeliverable(status: string): boolean {
  return status === 'published';
}

export function validateSystemAlert(alert: Pick<SystemAlert, 'title' | 'body' | 'action_kind' | 'action_value' | 'action_label' | 'video_url'>): string | null {
  if (!alert.title.trim() || alert.title.trim().length > 160) return 'Enter a title (up to 160 characters).';
  if (alert.body.length > 4000) return 'Keep the message under 4,000 characters.';
  if (!alert.action_label.trim()) return 'Enter a button label.';
  if (alert.action_kind === 'theme' && !ALERT_THEMES.some(t => t.value === alert.action_value)) return 'Choose a theme.';
  if (alert.action_kind === 'link' && !safeAlertLink(alert.action_value || '')) return 'Use an app path or a secure https link.';
  if (alert.video_url && !/^https:\/\//.test(alert.video_url)) return 'Use a secure https video link.';
  return null;
}

export function videoEmbedUrl(value: string): string | null {
  try {
    const url = new URL(value);
    let id: string | null = null;
    if (url.hostname === 'youtu.be') id = url.pathname.slice(1);
    if (['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(url.hostname)) id = url.searchParams.get('v') || url.pathname.split('/').filter(Boolean)[1];
    if (id && /^[a-zA-Z0-9_-]{11}$/.test(id)) return `https://www.youtube-nocookie.com/embed/${id}`;
    if (['vimeo.com', 'www.vimeo.com'].includes(url.hostname) && /^\/\d+$/.test(url.pathname)) return `https://player.vimeo.com/video${url.pathname}`;
  } catch { return null; }
  return null;
}
export type AlertBodyBlock = { kind: 'p' | 'ul' | 'ol'; lines: string[] };
/** Lines starting with "- " or "• " become bullets; "1. " style lines become a numbered list. */
export function alertBodyBlocks(body: string): AlertBodyBlock[] {
  const blocks: AlertBodyBlock[] = [];
  for (const raw of body.split('\n')) {
    const ul = raw.match(/^\s*[-•*]\s+(.*)$/); const ol = raw.match(/^\s*\d+[.)]\s+(.*)$/);
    const kind = ul ? 'ul' : ol ? 'ol' : 'p';
    const text = ul ? ul[1] : ol ? ol[1] : raw;
    const last = blocks[blocks.length - 1];
    if (kind === 'p' && !raw.trim()) { if (last?.kind === 'p') blocks.push({ kind: 'p', lines: [] }); continue; }
    if (last && last.kind === kind) last.lines.push(text); else blocks.push({ kind, lines: [text] });
  }
  return blocks.filter(b => b.lines.length);
}

export const ALERT_BUTTON_PRESETS = ['Got it', 'Try it now', 'Watch the video', 'Learn more', 'Take me there'];
