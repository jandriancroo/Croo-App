import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';
import { Bell, Palette, Play, Sparkles } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { alertBodyBlocks, SystemAlert, videoEmbedUrl } from '@/lib/systemAlerts';

interface Props {
  alert: SystemAlert | null;
  open: boolean;
  busy?: boolean;
  onDismiss: () => void;
  onAction: () => void;
}

export function SystemAlertHeroMedia({ path, type, className }: { path: string; type: string | null; className?: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let live = true; setUrl(null);
    void supabase.storage.from('system-alert-media').createSignedUrl(path, 3600).then(({ data }) => { if (live) setUrl(data?.signedUrl ?? null); });
    return () => { live = false; };
  }, [path]);
  const box = cn('w-full overflow-hidden rounded-lg bg-muted object-cover', className);
  if (!url) return <div className={cn(box, 'aspect-video')} aria-hidden />;
  if (type === 'video') return <video src={url} controls muted playsInline preload="metadata" className={cn(box, !className && 'aspect-video')} />;
  return <img src={url} alt="" className={cn(box, !className && 'aspect-video')} />;
}

export function SystemAlertDialog({ alert, open, busy, onDismiss, onAction }: Props) {
  if (!alert) return null;
  const Icon = alert.kind === 'theme' ? Palette : alert.kind === 'feature' ? Sparkles : Bell;
  const embed = alert.video_url ? videoEmbedUrl(alert.video_url) : null;
  const directVideo = alert.video_url && /\.(mp4|webm)(\?|$)/i.test(alert.video_url);
  return <Dialog open={open} onOpenChange={value => { if (!value && !busy) onDismiss(); }}>
    <DialogContent className="max-w-md max-h-[85dvh] overflow-y-auto rounded-lg">
      {alert.hero_media_path && <div className="-mx-6 -mt-6 overflow-hidden rounded-t-[22px]"><SystemAlertHeroMedia path={alert.hero_media_path} type={alert.hero_media_type} className="aspect-[4/3] max-h-[50dvh] rounded-none" /></div>}
      <DialogHeader className="pr-8">
        {!alert.hero_media_path && <div className="mb-2 flex h-11 w-11 items-center justify-center rounded-full bg-primary/10 text-primary"><Icon className="h-6 w-6" /></div>}
        <DialogTitle className="text-2xl font-extrabold leading-tight">{alert.title}</DialogTitle>
        <DialogDescription asChild><div className="space-y-2 text-left leading-relaxed">{alertBodyBlocks(alert.body).map((b, i) => b.kind === 'p'
          ? <p key={i} className="whitespace-pre-wrap">{b.lines.join('\n')}</p>
          : b.kind === 'ul' ? <ul key={i} className="list-disc space-y-1 pl-5">{b.lines.map((l, j) => <li key={j}>{l}</li>)}</ul>
          : <ol key={i} className="list-decimal space-y-1 pl-5">{b.lines.map((l, j) => <li key={j}>{l}</li>)}</ol>)}</div></DialogDescription>
      </DialogHeader>
      {alert.video_url && <div className="space-y-2">
        {embed ? <iframe title="Training video" src={embed} className="aspect-video w-full rounded-lg border border-border" allow="fullscreen; picture-in-picture" allowFullScreen />
          : directVideo ? <video controls preload="none" src={alert.video_url} className="aspect-video w-full rounded-lg bg-muted" />
          : <Button variant="outline" asChild><a href={alert.video_url} target="_blank" rel="noopener noreferrer"><Play className="mr-2 h-4 w-4" />Watch training video</a></Button>}
      </div>}
      <div className="flex flex-col gap-2">
        <Button className="w-full" disabled={busy} onClick={onAction}>{busy ? 'Saving…' : alert.action_label}</Button>
        {alert.action_kind !== 'none' && <Button className="w-full" variant="outline" disabled={busy} onClick={onDismiss}>No thanks</Button>}
      </div>
    </DialogContent>
  </Dialog>;
}