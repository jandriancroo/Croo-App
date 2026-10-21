import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { DateTime } from 'luxon';
import { ArrowLeft, Bell, Eye, Loader2, Pencil, Plus, Send, Archive, Save } from 'lucide-react';
import { toast } from 'sonner';
import { Layout } from '@/components/Layout';
import { PageTitle } from '@/components/PageTitle';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from '@/components/ui/alert-dialog';
import { useUserRole } from '@/hooks/useUserRole';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/integrations/supabase/client';
import { ALERT_THEMES, SystemAlert, validateSystemAlert } from '@/lib/systemAlerts';
import { SystemAlertDialog, SystemAlertHeroMedia } from '@/components/system-alerts/SystemAlertDialog';

function blankAlert(userId: string): SystemAlert {
  return { id: '', title: '', body: '', kind: 'system', status: 'draft', audience: 'super_admin', action_kind: 'none', action_label: 'Got it', action_value: null, video_url: null, hero_media_path: null, hero_media_type: null, created_by: userId, created_at: '', published_at: null };
}

export default function SystemAlertsAdmin() {
  const { isSuperAdmin, loading } = useUserRole();
  const { user } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<SystemAlert | null>(null);
  const [preview, setPreview] = useState<SystemAlert | null>(null);
  const [publishing, setPublishing] = useState<SystemAlert | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const uploadHero = async (file: File | undefined) => {
    if (!file || !editing) return;
    const type = file.type.startsWith('video/') ? 'video' : file.type.startsWith('image/') ? 'image' : null;
    if (!type) { toast.error('Choose a photo or a video.'); return; }
    if (file.size > (type === 'video' ? 50 : 10) * 1024 * 1024) { toast.error(type === 'video' ? 'Videos must be under 50 MB.' : 'Photos must be under 10 MB.'); return; }
    setUploading(true);
    try {
      const ext = (file.name.split('.').pop() || type === 'video' ? 'mp4' : 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '');
      const path = `${crypto.randomUUID()}.${ext}`;
      const { error } = await supabase.storage.from('system-alert-media').upload(path, file, { contentType: file.type });
      if (error) throw error;
      update({ hero_media_path: path, hero_media_type: type });
    } catch { toast.error('Upload failed. Please try again.'); }
    finally { setUploading(false); }
  };
  const { data: alerts = [], isLoading, error } = useQuery({
    queryKey: ['admin-system-alerts'], enabled: isSuperAdmin,
    queryFn: async () => {
      const { data, error } = await supabase.from('system_alerts').select('*').order('created_at', { ascending: false });
      if (error) throw error;
      return data;
    },
  });
  const update = (changes: Partial<SystemAlert>) => setEditing(old => old ? { ...old, ...changes } : old);
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['admin-system-alerts'] }); void qc.invalidateQueries({ queryKey: ['next-system-alert'] }); };
  const save = async () => {
    if (!editing || !user || busy) return;
    const problem = validateSystemAlert(editing);
    if (problem) { toast.error(problem); return; }
    setBusy(true);
    const payload = { title: editing.title.trim(), body: editing.body, kind: editing.kind, audience: editing.audience, action_kind: editing.action_kind, action_label: editing.action_label.trim(), action_value: editing.action_kind === 'none' ? null : editing.action_value, video_url: editing.video_url || null, hero_media_path: editing.hero_media_path, hero_media_type: editing.hero_media_type };
    try {
      const result = editing.id
        ? await supabase.from('system_alerts').update(payload).eq('id', editing.id).eq('status', 'draft').select().single()
        : await supabase.from('system_alerts').insert({ ...payload, created_by: user.id }).select().single();
      if (result.error) throw result.error;
      refresh(); setEditing(null); toast.success('Draft saved');
    } catch { toast.error('Could not save the alert. Please try again.'); }
    finally { setBusy(false); }
  };
  const changeStatus = async (alert: SystemAlert, status: 'published' | 'retired') => {
    if (busy) return;
    setBusy(true);
    try {
      const { error } = await supabase.from('system_alerts').update({ status, ...(status === 'published' ? { published_at: DateTime.utc().toISO() } : {}) }).eq('id', alert.id).select().single();
      if (error) throw error;
      refresh(); setPublishing(null); toast.success(status === 'published' ? 'Alert shipped' : 'Alert retired');
    } catch { toast.error('Could not update the alert. Please try again.'); }
    finally { setBusy(false); }
  };
  if (loading) return <Layout><Loader2 className="mx-auto my-12 h-6 w-6 animate-spin" /></Layout>;
  if (!isSuperAdmin) return <Layout><PageTitle color="teal" status={null}>System Alerts</PageTitle><p className="text-muted-foreground">Only the super admin can manage system alerts.</p></Layout>;

  return <Layout><div className="mx-auto w-full max-w-4xl">
    <PageTitle color="slate" status={null} leading={<Button variant="ghost" size="icon" aria-label="Back to Settings" onClick={() => navigate('/settings')}><ArrowLeft className="h-5 w-5" /></Button>}>System Alerts</PageTitle>
    <div className="space-y-4">
    {!editing && <Button className="w-full" onClick={() => user && setEditing(blankAlert(user.id))}><Plus className="mr-2 h-4 w-4" />New alert</Button>}
    {editing ? <div className="space-y-4">
      <div className="flex items-center justify-between"><h2 className="text-lg font-semibold">{editing.id ? 'Edit draft' : 'New alert'}</h2><Badge variant="secondary">Draft</Badge></div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2"><Label>Alert type</Label><Select value={editing.kind} onValueChange={kind => update({ kind })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="theme">Theme</SelectItem><SelectItem value="feature">New feature</SelectItem><SelectItem value="system">System</SelectItem></SelectContent></Select></div>
        <div className="space-y-2"><Label>Audience</Label><Select value={editing.audience} onValueChange={audience => update({ audience })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="super_admin">Only me (test)</SelectItem><SelectItem value="all">Everyone</SelectItem></SelectContent></Select></div>
      </div>
      <div className="space-y-2"><Label htmlFor="alert-title">Title</Label><Input id="alert-title" value={editing.title} maxLength={160} onChange={e => update({ title: e.target.value })} /></div>
      <div className="space-y-2"><Label htmlFor="alert-message">Message</Label><Textarea id="alert-message" value={editing.body} maxLength={4000} rows={4} onChange={e => update({ body: e.target.value })} /></div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2"><Label>Button action</Label><Select value={editing.action_kind} onValueChange={action_kind => update({ action_kind, action_value: null })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">Acknowledge</SelectItem><SelectItem value="theme">Apply theme</SelectItem><SelectItem value="link">Open page or link</SelectItem></SelectContent></Select></div>
        <div className="space-y-2"><Label htmlFor="alert-button">Button label</Label><Input id="alert-button" value={editing.action_label} onChange={e => update({ action_label: e.target.value })} /></div>
      </div>
      {editing.action_kind === 'theme' && <div className="space-y-2"><Label>Theme</Label><Select value={editing.action_value || ''} onValueChange={action_value => update({ action_value })}><SelectTrigger><SelectValue placeholder="Choose theme" /></SelectTrigger><SelectContent>{ALERT_THEMES.map(theme => <SelectItem key={theme.value} value={theme.value}>{theme.label}</SelectItem>)}</SelectContent></Select></div>}
      {editing.action_kind === 'link' && <div className="space-y-2"><Label htmlFor="alert-link">Page or secure link</Label><Input id="alert-link" placeholder="/settings or https://…" value={editing.action_value || ''} onChange={e => update({ action_value: e.target.value })} /></div>}
      <div className="space-y-2"><Label htmlFor="alert-video">Training video link (optional)</Label><Input id="alert-video" type="url" placeholder="https://…" value={editing.video_url || ''} onChange={e => update({ video_url: e.target.value })} /></div>
      <div className="space-y-2"><Label htmlFor="alert-hero">Top photo or video (optional)</Label>
        {editing.hero_media_path ? <div className="flex items-center gap-2"><SystemAlertHeroMedia path={editing.hero_media_path} type={editing.hero_media_type} className="h-20 w-32" /><Button variant="outline" size="sm" onClick={() => update({ hero_media_path: null, hero_media_type: null })}>Remove</Button></div>
          : <Input id="alert-hero" type="file" accept="image/*,video/mp4,video/webm,video/quicktime" disabled={uploading} onChange={e => void uploadHero(e.target.files?.[0])} />}
        {uploading && <p className="text-sm text-muted-foreground">Uploading…</p>}
        <p className="text-xs text-muted-foreground">Photos up to 10 MB, videos up to 50 MB (about 1–2 minutes).</p>
      </div>
      <div className="flex flex-wrap gap-2"><Button disabled={busy || uploading} onClick={() => void save()}><Save className="mr-2 h-4 w-4" />Save draft</Button><Button variant="outline" onClick={() => setPreview(editing)}><Eye className="mr-2 h-4 w-4" />Preview</Button><Button variant="ghost" disabled={busy} onClick={() => setEditing(null)}>Cancel</Button></div>
    </div> : <div className="space-y-3">
      {isLoading && <Loader2 className="h-5 w-5 animate-spin" />}
      {error && <p role="alert" className="text-destructive">Could not load alerts. Please refresh.</p>}
      {!isLoading && !error && alerts.length === 0 && <div className="py-10 text-center text-muted-foreground"><Bell className="mx-auto mb-3 h-8 w-8" /><p>No system alerts yet.</p></div>}
      {alerts.map(alert => <article key={alert.id} className="rounded-lg border border-border bg-card p-4">
        <div className="flex flex-wrap items-center gap-2"><h2 className="min-w-0 break-words font-semibold">{alert.title}</h2><Badge variant={alert.status === 'published' ? 'default' : 'secondary'}>{alert.status}</Badge></div>
        <p className="mt-1 text-xs text-muted-foreground">{alert.kind === 'feature' ? 'New feature' : alert.kind === 'theme' ? 'Theme' : 'System'} · {alert.audience === 'all' ? 'Everyone' : 'Only me (test)'}</p>
        <p className="mt-2 line-clamp-2 whitespace-pre-wrap text-sm text-muted-foreground">{alert.body}</p>
        <div className="mt-3 flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => setPreview(alert)}><Eye className="mr-2 h-4 w-4" />Preview</Button>
          {alert.status === 'draft' && <><Button size="sm" variant="outline" onClick={() => setEditing(alert)}><Pencil className="mr-2 h-4 w-4" />Edit</Button><Button size="sm" disabled={busy} onClick={() => setPublishing(alert)}><Send className="mr-2 h-4 w-4" />Ship alert</Button></>}
          {alert.status === 'published' && <Button size="sm" variant="outline" disabled={busy} onClick={() => void changeStatus(alert, 'retired')}><Archive className="mr-2 h-4 w-4" />Retire</Button>}
          {alert.status !== 'draft' && <Button size="sm" variant="ghost" onClick={() => user && setEditing({ ...blankAlert(user.id), title: alert.title, body: alert.body, kind: alert.kind, action_kind: alert.action_kind, action_label: alert.action_label, action_value: alert.action_value, video_url: alert.video_url, hero_media_path: alert.hero_media_path, hero_media_type: alert.hero_media_type })}>Copy to draft</Button>}
        </div>
      </article>)}
    </div>}
    <SystemAlertDialog alert={preview} open={!!preview} onDismiss={() => setPreview(null)} onAction={() => setPreview(null)} />
    <AlertDialog open={!!publishing} onOpenChange={open => { if (!open && !busy) setPublishing(null); }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Ship this system alert?</AlertDialogTitle><AlertDialogDescription>{publishing?.audience === 'all' ? 'Everyone will see this once when they next open Dash.' : 'Only you will see this test alert on Dash.'} Retiring it stops future delivery.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel><AlertDialogAction disabled={busy} onClick={e => { e.preventDefault(); if (publishing) void changeStatus(publishing, 'published'); }}>Ship alert</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </div></div></Layout>;
}