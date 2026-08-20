import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Camera, Check, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

const BUCKET = "bank-verification";

export async function getBankVerificationUrl(path: string): Promise<string | null> {
  const { data } = await supabase.storage.from(BUCKET).createSignedUrl(path, 60 * 60);
  return data?.signedUrl ?? null;
}

interface BankVerificationPhotoProps {
  locationId: string;
  /** storage path of the uploaded image, or null when nothing uploaded yet */
  value: string | null;
  onChange: (path: string | null) => void;
  /** used in the file name so records stay readable */
  slug: string;
  label: string;
  variant?: "icon" | "button";
  disabled?: boolean;
}

export function BankVerificationPhoto({
  locationId,
  value,
  onChange,
  slug,
  label,
  variant = "icon",
  disabled,
}: BankVerificationPhotoProps) {
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (previewOpen && value) {
      getBankVerificationUrl(value).then((url) => {
        if (!cancelled) setPreviewUrl(url);
      });
    }
    return () => {
      cancelled = true;
    };
  }, [previewOpen, value]);

  const handleFile = async (file: File) => {
    if (!file) return;
    setUploading(true);
    try {
      const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
      const path = `${locationId}/${slug}-${Date.now()}.${ext}`;
      const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
        contentType: file.type || "image/jpeg",
        upsert: true,
      });
      if (error) throw error;
      onChange(path);
      toast({ title: "Photo uploaded", description: label });
    } catch (e: any) {
      toast({ title: "Upload failed", description: e.message, variant: "destructive" });
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const handleRemove = async () => {
    if (!value) return;
    await supabase.storage.from(BUCKET).remove([value]);
    setPreviewUrl(null);
    setPreviewOpen(false);
    onChange(null);
  };

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
        }}
      />

      {value ? (
        <div className="inline-flex items-center rounded-md border border-emerald-200 bg-emerald-50 dark:bg-emerald-950/30 dark:border-emerald-900 h-9 overflow-hidden">
          <button
            type="button"
            className="h-full px-2.5 flex items-center text-emerald-600 hover:bg-emerald-100 dark:hover:bg-emerald-900/40 disabled:opacity-50"
            disabled={disabled || uploading}
            aria-label={`Undo ${label} upload`}
            onClick={handleRemove}
          >
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
          </button>
          <button
            type="button"
            className={
              variant === "icon"
                ? "h-full px-2 flex items-center hover:bg-emerald-100 dark:hover:bg-emerald-900/40"
                : "h-full pl-1 pr-3 flex items-center text-sm font-medium hover:bg-emerald-100 dark:hover:bg-emerald-900/40"
            }
            aria-label={`View ${label}`}
            onClick={() => setPreviewOpen(true)}
          >
            {variant === "icon" ? <Eye className="h-4 w-4" /> : "View"}
          </button>
        </div>
      ) : variant === "icon" ? (
        <Button
          type="button"
          variant="secondary"
          size="icon"
          className="h-9 w-9"
          disabled={disabled || uploading}
          aria-label={`Upload ${label}`}
          title={label}
          onClick={() => inputRef.current?.click()}
        >
          {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
        </Button>
      ) : (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="gap-2"
          disabled={disabled || uploading}
          aria-label={`Upload ${label}`}
          onClick={() => inputRef.current?.click()}
        >
          {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
          <span className="font-medium">{label}</span>
        </Button>
      )}


      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{label}</DialogTitle>
          </DialogHeader>
          {previewUrl ? (
            <img src={previewUrl} alt={label} className="w-full rounded-lg" />
          ) : (
            <div className="flex justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          )}
        </DialogContent>
      </Dialog>

    </>
  );
}
