import type { Database } from '@/integrations/supabase/types';

export type SystemAlert = Database['public']['Tables']['system_alerts']['Row'];
export const ALERT_THEMES = [
  { value: 'default', label: 'Default' }, { value: 'oled', label: 'Dark Mode' },
  { value: 'earth', label: 'Warm Earth' }, { value: 'beach', label: 'Beach' },
  { value: 'cupcake', label: 'Cupcake' }, { value: 'spookified', label: 'Spookified' },
];

export function safeAlertLink(value: string): boolean {
  if (/^\/[^/\\]/.test(value) && !value.includes('\\')) return true;
  try { return new URL(value).protocol === 'https:'; } catch { return false; }
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