import { useEffect, useRef, useState } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Image as ImageIcon, X, Loader2, Pin, Paperclip, FileText, Plus, Megaphone } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { toast } from 'sonner';
import type { FeedBadge, FeedChannel, FeedMedia } from '@/hooks/useAnnouncementFeed';

interface PostComposerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  channels: FeedChannel[];
  badges: FeedBadge[];
  canAnnounce: boolean;
  canCreateBadges: boolean;
  onSubmit: (input: {
    body: string;
    media: FeedMedia[];
    channelId: string | null;
    pinned: boolean;
    badgeId: string | null;
    isAnnouncement: boolean;
  }) => Promise<any>;
  onCreateBadge?: (input: { label: string; color?: string | null }) => Promise<any>;
}

export function PostComposer({
  open, onOpenChange, channels, badges, canAnnounce, canCreateBadges,
  onSubmit, onCreateBadge,
}: PostComposerProps) {
  const { user } = useAuth();
  const photoRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const [body, setBody] = useState('');
  const [media, setMedia] = useState<FeedMedia[]>([]);
  const [channelId, setChannelId] = useState<string | null>(null);
  const [badgeId, setBadgeId] = useState<string | null>(null);
  const [isAnnouncement, setIsAnnouncement] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [badgeDialogOpen, setBadgeDialogOpen] = useState(false);
  const [newBadgeLabel, setNewBadgeLabel] = useState('');
  const defaultChannelId = channels.find(c => c.slug === 'all')?.id
    ?? channels.find(c => c.audience_type === 'everyone')?.id
    ?? null;

  const reset = () => {
    setBody(''); setMedia([]); setChannelId(defaultChannelId); setBadgeId(null);
    setIsAnnouncement(false); setPinned(false);
  };

  useEffect(() => {
    if (!open) return;
    if (!channelId || !channels.some(c => c.id === channelId)) {
      setChannelId(defaultChannelId);
    }
  }, [open, channelId, channels, defaultChannelId]);

  const handleFiles = async (files: FileList | null, kind: 'image' | 'file') => {
    if (!files || !user) return;
    setUploading(true);
    try {
      const uploaded: FeedMedia[] = [];
      const remaining = Math.max(0, 8 - media.length);
      for (const file of Array.from(files).slice(0, remaining)) {
        if (kind === 'image' && !file.type.startsWith('image/')) continue;
        if (file.size > 25 * 1024 * 1024) { toast.error(`${file.name} is over 25MB`); continue; }
        const safeBase = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 60);
        const path = `${user.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeBase}`;
        const { error } = await supabase.storage.from('announcement-media').upload(path, file, { upsert: false, contentType: file.type || undefined });
        if (error) throw error;
        const { data: signed } = await supabase.storage.from('announcement-media').createSignedUrl(path, 60 * 60 * 24 * 365 * 5);
        if (signed?.signedUrl) {
          const isImage = kind === 'image' || file.type.startsWith('image/');
          uploaded.push({
            url: signed.signedUrl,
            type: isImage ? 'image' : 'file',
            name: file.name,
            mime: file.type || undefined,
          });
        }
      }
      setMedia(m => [...m, ...uploaded]);
    } catch (e: any) {
      toast.error(e.message ?? 'Upload failed');
    } finally {
      setUploading(false);
      if (photoRef.current) photoRef.current.value = '';
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const canSubmit = (body.trim().length > 0 || media.length > 0) && !submitting;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await onSubmit({
        body: body.trim(),
        media,
        channelId: channelId ?? defaultChannelId,
        pinned: canAnnounce ? pinned : false,
        badgeId,
        isAnnouncement: canAnnounce ? isAnnouncement : false,
      });
      reset();
      onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  };

  const handleCreateBadge = async () => {
    if (!onCreateBadge || !newBadgeLabel.trim()) return;
    const created = await onCreateBadge({ label: newBadgeLabel.trim() });
    setNewBadgeLabel('');
    setBadgeDialogOpen(false);
    if (created?.id) setBadgeId(created.id);
  };

  return (
    <>
      <Sheet open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
        <SheetContent side="bottom" className="h-[90vh] rounded-t-2xl p-0 flex flex-col">
          <SheetHeader className="px-4 pt-4 pb-2 shrink-0 flex-row items-center justify-between">
            <SheetTitle>{isAnnouncement ? 'New announcement' : 'New post'}</SheetTitle>
            <Button size="sm" onClick={handleSubmit} disabled={!canSubmit}>
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Post'}
            </Button>
          </SheetHeader>

          <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-4">
            <Textarea
              autoFocus
              value={body}
              onChange={e => setBody(e.target.value)}
              placeholder="Share something with the team..."
              className="min-h-[140px] text-base border-0 shadow-none focus-visible:ring-0 resize-none p-0"
              maxLength={4000}
            />

            {media.length > 0 && (
              <div className="space-y-2">
                {media.some(m => m.type === 'image') && (
                  <div className="grid grid-cols-2 gap-2">
                    {media.map((m, i) => m.type === 'image' && (
                      <div key={i} className="relative aspect-square rounded-lg overflow-hidden bg-muted">
                        <img src={m.url} alt="" className="w-full h-full object-cover" />
                        <button
                          type="button"
                          onClick={() => setMedia(list => list.filter((_, idx) => idx !== i))}
                          className="absolute top-1 right-1 h-7 w-7 rounded-full bg-black/60 text-white flex items-center justify-center"
                          aria-label="Remove image"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                {media.filter(m => m.type !== 'image').length > 0 && (
                  <div className="flex flex-col gap-1.5">
                    {media.map((m, i) => m.type !== 'image' && (
                      <div key={i} className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm">
                        <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <span className="truncate flex-1 min-w-0">{m.name || 'Attachment'}</span>
                        <button
                          type="button"
                          onClick={() => setMedia(list => list.filter((_, idx) => idx !== i))}
                          className="text-muted-foreground hover:text-destructive shrink-0"
                          aria-label="Remove file"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="space-y-3 pt-2 border-t border-border">
              {/* Badge picker */}
              <div className="space-y-1.5">
                <Label className="text-xs uppercase tracking-wide text-muted-foreground">Category</Label>
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={() => setBadgeId(null)}
                    className={`px-3 h-8 rounded-full text-sm border ${
                      badgeId === null ? 'bg-primary text-primary-foreground border-primary' : 'bg-background border-border'
                    }`}
                  >
                    None
                  </button>
                  {badges.map(b => {
                    const active = badgeId === b.id;
                    const color = b.color ?? '#3B82F6';
                    return (
                      <button
                        key={b.id}
                        type="button"
                        onClick={() => setBadgeId(b.id)}
                        className={`px-3 h-8 rounded-full text-sm border transition-colors ${
                          active ? 'text-white border-transparent' : 'bg-background border-border'
                        }`}
                        style={active ? { backgroundColor: color } : { color }}
                      >
                        {b.label}
                      </button>
                    );
                  })}
                  {canCreateBadges && (
                    <button
                      type="button"
                      onClick={() => setBadgeDialogOpen(true)}
                      className="px-3 h-8 rounded-full text-sm border border-dashed border-border text-muted-foreground inline-flex items-center gap-1"
                    >
                      <Plus className="h-3.5 w-3.5" /> New
                    </button>
                  )}
                </div>
              </div>

              {channels.length > 0 && (
                <div className="space-y-1.5">
                  <Label className="text-xs uppercase tracking-wide text-muted-foreground">Audience</Label>
                  <div className="flex flex-wrap gap-1.5">
                    {channels.map(c => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => setChannelId(c.id)}
                        className={`px-3 h-8 rounded-full text-sm border ${channelId === c.id ? 'bg-primary text-primary-foreground border-primary' : 'bg-background border-border'}`}
                      >
                        {c.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {canAnnounce && (
                <>
                  <div className="flex items-center justify-between">
                    <Label htmlFor="announcement-toggle" className="flex items-center gap-2 text-sm">
                      <Megaphone className="h-4 w-4" /> Post as announcement
                    </Label>
                    <Switch id="announcement-toggle" checked={isAnnouncement} onCheckedChange={setIsAnnouncement} />
                  </div>
                  {isAnnouncement && (
                    <div className="flex items-center justify-between pl-6">
                      <Label htmlFor="pin-post" className="flex items-center gap-2 text-sm">
                        <Pin className="h-4 w-4" /> Pin to top of feed
                      </Label>
                      <Switch id="pin-post" checked={pinned} onCheckedChange={setPinned} />
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          <div className="border-t border-border p-3 flex items-center gap-2 shrink-0 bg-background">
            <input ref={photoRef} type="file" accept="image/*" multiple hidden onChange={e => handleFiles(e.target.files, 'image')} />
            <input ref={fileRef} type="file" multiple hidden onChange={e => handleFiles(e.target.files, 'file')} />
            <Button variant="outline" size="sm" onClick={() => photoRef.current?.click()} disabled={uploading || media.length >= 8}>
              {uploading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <ImageIcon className="h-4 w-4 mr-2" />}
              Photo
            </Button>
            <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()} disabled={uploading || media.length >= 8}>
              <Paperclip className="h-4 w-4 mr-2" /> File
            </Button>
            {media.length > 0 && (
              <span className="text-xs text-muted-foreground ml-1">{media.length}/8</span>
            )}
          </div>
        </SheetContent>
      </Sheet>

      <Dialog open={badgeDialogOpen} onOpenChange={setBadgeDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>New badge</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor="badge-label">Label</Label>
            <Input id="badge-label" value={newBadgeLabel} onChange={e => setNewBadgeLabel(e.target.value)} placeholder="e.g. Training" maxLength={40} />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setBadgeDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleCreateBadge} disabled={!newBadgeLabel.trim()}>Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
