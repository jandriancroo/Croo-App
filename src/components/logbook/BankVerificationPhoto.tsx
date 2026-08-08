import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Camera, Check, Loader2, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

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

      {variant === "icon" ? (
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className={cn(
              "h-7 px-2 rounded-full gap-1.5 text-xs",
              value ? "text-emerald-600 hover:text-emerald-700" : "text-muted-foreground"
            )}
            disabled={disabled || uploading}
            aria-label={value ? `View ${label}` : `Upload ${label}`}
            onClick={() => (value ? setPreviewOpen(true) : inputRef.current?.click())}
          >
            {uploading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : value ? (
              <Check className="h-4 w-4" />
            ) : (
              <Camera className="h-4 w-4" />
            )}
            <span className="font-medium">{value ? "View Slip" : "Upload Slip"}</span>
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant={value ? "outline" : "secondary"}
            size="sm"
            disabled={disabled || uploading}
            onClick={() => inputRef.current?.click()}
          >
            {uploading ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : value ? (
              <Check className="h-4 w-4 mr-2 text-emerald-600" />
            ) : (
              <Camera className="h-4 w-4 mr-2" />
            )}
            {value ? "Replace photo" : label}
          </Button>
          {value && (
            <>
              <Button type="button" variant="ghost" size="sm" onClick={() => setPreviewOpen(true)}>
                View
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-destructive"
                onClick={handleRemove}
                aria-label="Remove photo"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </>
          )}
        </div>
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
          {variant === "icon" && value && (
            <div className="flex justify-between">
              <Button type="button" variant="outline" size="sm" onClick={() => inputRef.current?.click()}>
                <Camera className="h-4 w-4 mr-2" />
                Replace
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-destructive"
                onClick={() => {
                  handleRemove();
                  setPreviewOpen(false);
                }}
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Remove
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
