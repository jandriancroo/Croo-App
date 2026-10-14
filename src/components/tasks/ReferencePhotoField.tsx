import { useRef, useState } from 'react';
import { Loader2, Upload, RefreshCw, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface Props {
  url?: string | null;
  /** Upload the picked file and store its URL on the item. Throw on failure. */
  onUpload: (file: File) => Promise<void>;
  /** Clear the photo (sets reference_image_url to null). */
  onRemove: () => void;
  compact?: boolean;
}

/** Reference photo editor: thumbnail + Replace / Remove, or a picker when empty. */
export function ReferencePhotoField({ url, onUpload, onRemove, compact }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handlePick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Reset so the same file can be picked again
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      await onUpload(file);
    } catch {
      setError("Photo didn't upload. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  const text = compact ? 'text-[10px]' : 'text-xs';
  const fileInput = (
    <Input
      ref={inputRef}
      type="file"
      accept="image/*"
      disabled={busy}
      className={url ? 'hidden' : `${text} ${compact ? 'h-7' : ''} w-full`}
      onChange={handlePick}
    />
  );

  return (
    <div className="space-y-1">
      <Label className={`${text} flex items-center gap-1`}>
        <Upload className={compact ? 'h-2.5 w-2.5' : 'h-3 w-3'} /> Reference Photo
      </Label>
      {fileInput}
      {url && (
        <div className="flex items-center gap-2">
          <img src={url} alt="Reference" className={`rounded object-cover ${compact ? 'h-14 w-14' : 'h-16 w-16'}`} />
          <div className="flex flex-col gap-1">
            <Button type="button" size="sm" variant="outline" className="h-7 text-xs" disabled={busy}
              onClick={() => inputRef.current?.click()}>
              <RefreshCw className="h-3 w-3 mr-1" /> Replace
            </Button>
            <Button type="button" size="sm" variant="outline" className="h-7 text-xs text-destructive" disabled={busy}
              onClick={() => { setError(null); onRemove(); }}>
              <Trash2 className="h-3 w-3 mr-1" /> Remove
            </Button>
          </div>
        </div>
      )}
      {busy && (
        <p className={`${text} text-muted-foreground flex items-center gap-1`}>
          <Loader2 className="h-3 w-3 animate-spin" /> Uploading photo…
        </p>
      )}
      {error && <p className={`${text} text-destructive`}>{error}</p>}
    </div>
  );
}
