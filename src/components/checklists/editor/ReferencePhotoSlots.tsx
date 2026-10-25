import { useState } from 'react';
import { Camera, Loader2, Trash2, RefreshCw } from 'lucide-react';
import { PhotoPickerButton } from '@/components/PhotoPickerButton';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';

interface Props {
  urls: string[];
  slots: number;
  /** Upload and return the public URL. Throw on failure. */
  upload: (file: File) => Promise<string>;
  onChange: (urls: string[]) => void;
}

/** "Ref 1", "Ref 2", … slots. Count follows "Photos required". */
export function ReferencePhotoSlots({ urls, slots, upload, onChange }: Props) {
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [viewing, setViewing] = useState<number | null>(null);

  const put = async (slot: number, file: File) => {
    setBusy(slot);
    setError(null);
    try {
      const url = await upload(file);
      const next = [...urls];
      if (slot < next.length) next[slot] = url; else next.push(url);
      onChange(next);
    } catch {
      setError("Photo didn't upload. Check your connection and try again.");
    } finally {
      setBusy(null);
    }
  };

  const remove = (slot: number) => {
    onChange(urls.filter((_, i) => i !== slot));
    setViewing(null);
  };

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap gap-2">
        {Array.from({ length: slots }, (_, i) => {
          const url = urls[i];
          const label = `Ref ${i + 1}`;
          const inner = (
            <span className="flex h-16 w-16 flex-col items-center justify-center gap-0.5 overflow-hidden rounded-md border border-dashed bg-muted/40 text-muted-foreground">
              {busy === i ? <Loader2 className="h-5 w-5 animate-spin" /> : url
                ? <img src={url} alt={label} className="h-full w-full object-cover" />
                : <><Camera className="h-5 w-5" /><span className="text-xs">{label}</span></>}
            </span>
          );
          // Empty slots fill in order: only the next empty slot is pickable.
          if (!url) {
            const pickable = i === urls.length;
            return pickable ? (
              <PhotoPickerButton key={i} onFileSelected={(f) => put(i, f)} disabled={busy !== null}>
                <button type="button" aria-label={`Add ${label}`} className="block rounded-md">{inner}</button>
              </PhotoPickerButton>
            ) : <span key={i} className="opacity-50" aria-label={`${label} (add Ref ${urls.length + 1} first)`}>{inner}</span>;
          }
          return (
            <button key={i} type="button" aria-label={`Open ${label}`} onClick={() => setViewing(i)} className="rounded-md">
              {inner}
            </button>
          );
        })}
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}

      <Dialog open={viewing !== null} onOpenChange={(o) => !o && setViewing(null)}>
        <DialogContent className="duo-popup max-w-lg">
          <DialogTitle>{viewing !== null ? `Reference photo ${viewing + 1}` : ''}</DialogTitle>
          {viewing !== null && urls[viewing] && (
            <>
              <img src={urls[viewing]} alt={`Ref ${viewing + 1}`} className="max-h-[60vh] w-full rounded-md object-contain" />
              <div className="flex gap-2">
                <label className="flex-1">
                  <input type="file" accept="image/*" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; const s = viewing; setViewing(null); if (f) put(s, f); }} />
                  <span className="inline-flex h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-md border text-sm font-medium"><RefreshCw className="h-4 w-4" /> Replace</span>
                </label>
                <Button type="button" variant="outline" className="h-11 flex-1 text-destructive" onClick={() => remove(viewing)}>
                  <Trash2 className="h-4 w-4 mr-2" /> Remove
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
