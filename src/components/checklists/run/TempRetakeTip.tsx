import { RotateCcw } from 'lucide-react';
import { PhotoPickerButton } from '@/components/PhotoPickerButton';

/** Shown when a thermometer photo was too unclear to read: the photo is not saved. */
export function TempRetakeTip({ tip, uploading, onRetake }: { tip: string; uploading?: boolean; onRetake: (f: File) => void }) {
  return (
    <div role="alert" className="space-y-2 rounded-xl bg-[hsl(var(--warning)/0.12)] p-3">
      <div className="text-sm font-semibold">We couldn't read that photo</div>
      <div className="text-sm text-muted-foreground">{tip}</div>
      {uploading ? (
        <span className="flex h-11 items-center justify-center text-sm text-primary">Uploading…</span>
      ) : (
        <PhotoPickerButton direct="camera" onFileSelected={onRetake} className="block w-full">
          <span className="flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-border bg-card text-sm font-medium"><RotateCcw className="h-4 w-4" />Retake</span>
        </PhotoPickerButton>
      )}
    </div>
  );
}
