import { Bell, Palette, Play, Sparkles } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { SystemAlert, videoEmbedUrl } from '@/lib/systemAlerts';

interface Props {
  alert: SystemAlert | null;
  open: boolean;
  busy?: boolean;
  onDismiss: () => void;
  onAction: () => void;
}

export function SystemAlertDialog({ alert, open, busy, onDismiss, onAction }: Props) {
  if (!alert) return null;
  const Icon = alert.kind === 'theme' ? Palette : alert.kind === 'feature' ? Sparkles : Bell;
  const embed = alert.video_url ? videoEmbedUrl(alert.video_url) : null;
  const directVideo = alert.video_url && /\.(mp4|webm)(\?|$)/i.test(alert.video_url);
  return <Dialog open={open} onOpenChange={value => { if (!value && !busy) onDismiss(); }}>
    <DialogContent className="max-w-md max-h-[85dvh] overflow-y-auto rounded-lg">
      <DialogHeader className="pr-8">
        <div className="mb-2 flex h-11 w-11 items-center justify-center rounded-full bg-primary/10 text-primary"><Icon className="h-6 w-6" /></div>
        <p className="text-xs font-semibold uppercase text-muted-foreground">{alert.kind === 'theme' ? 'New theme' : alert.kind === 'feature' ? 'New feature' : 'System alert'}</p>
        <DialogTitle className="text-xl leading-tight">{alert.title}</DialogTitle>
        <DialogDescription className="whitespace-pre-wrap leading-relaxed">{alert.body}</DialogDescription>
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