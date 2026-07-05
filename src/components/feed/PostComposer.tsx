import { useRef, useState } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Image as ImageIcon, X, Loader2, Pin, Paperclip, FileText } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { toast } from 'sonner';
import type { FeedChannel, FeedMedia } from '@/hooks/useAnnouncementFeed';

interface PostComposerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  channels: FeedChannel[];
  onSubmit: (input: { body: string; media: FeedMedia[]; channelId: string | null; pinned: boolean }) => Promise<any>;
}

export function PostComposer({ open, onOpenChange, channels, onSubmit }: PostComposerProps) {
  const { user } = useAuth();
  const fileRef = useRef<HTMLInputElement>(null);
  const [body, setBody] = useState('');
  const [media, setMedia] = useState<FeedMedia[]>([]);
  const [channelId, setChannelId] = useState<string | null>(null);
  const [pinned, setPinned] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const reset = () => { setBody(''); setMedia([]); setChannelId(null); setPinned(false); };

  const handleFiles = async (files: FileList | null) => {
    if (!files || !user) return;
    setUploading(true);
    try {
      const uploaded: FeedMedia[] = [];
      for (const file of Array.from(files).slice(0, 4 - media.length)) {
        if (!file.type.startsWith('image/')) continue;
        const ext = file.name.split('.').pop() || 'jpg';
        const path = `${user.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
        const { error } = await supabase.storage.from('announcement-media').upload(path, file, { upsert: false });
        if (error) throw error;
        const { data: signed } = await supabase.storage.from('announcement-media').createSignedUrl(path, 60 * 60 * 24 * 365 * 5);
        if (signed?.signedUrl) uploaded.push({ url: signed.signedUrl, type: 'image' });
      }
      setMedia(m => [...m, ...uploaded]);
    } catch (e: any) {
      toast.error(e.message ?? 'Upload failed');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const canSubmit = (body.trim().length > 0 || media.length > 0) && !submitting;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await onSubmit({ body: body.trim(), media, channelId, pinned });
      reset();
      onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <SheetContent side="bottom" className="h-[90vh] rounded-t-2xl p-0 flex flex-col">
        <SheetHeader className="px-4 pt-4 pb-2 shrink-0 flex-row items-center justify-between">
          <SheetTitle>New post</SheetTitle>
          <Button size="sm" onClick={handleSubmit} disabled={!canSubmit}>
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Post'}
          </Button>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-4">
          <Textarea
            autoFocus
            value={body}
            onChange={e => setBody(e.target.value)}
            placeholder="Share an update with your team..."
            className="min-h-[140px] text-base border-0 shadow-none focus-visible:ring-0 resize-none p-0"
            maxLength={4000}
          />

          {media.length > 0 && (
            <div className="grid grid-cols-2 gap-2">
              {media.map((m, i) => (
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

          <div className="space-y-3 pt-2 border-t border-border">
            {channels.length > 0 && (
              <div className="space-y-1.5">
                <Label className="text-xs uppercase tracking-wide text-muted-foreground">Channel</Label>
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={() => setChannelId(null)}
                    className={`px-3 h-8 rounded-full text-sm border ${channelId === null ? 'bg-primary text-primary-foreground border-primary' : 'bg-background border-border'}`}
                  >
                    General
                  </button>
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

            <div className="flex items-center justify-between">
              <Label htmlFor="pin-post" className="flex items-center gap-2 text-sm">
                <Pin className="h-4 w-4" /> Pin to top of feed
              </Label>
              <Switch id="pin-post" checked={pinned} onCheckedChange={setPinned} />
            </div>
          </div>
        </div>

        <div className="border-t border-border p-3 flex items-center gap-2 shrink-0 bg-background">
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={e => handleFiles(e.target.files)}
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => fileRef.current?.click()}
            disabled={uploading || media.length >= 4}
          >
            {uploading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <ImageIcon className="h-4 w-4 mr-2" />}
            Add photo {media.length > 0 && `(${media.length}/4)`}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
