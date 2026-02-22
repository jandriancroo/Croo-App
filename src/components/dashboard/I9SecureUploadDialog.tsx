import { useState, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Shield, Lock, Upload, CheckCircle2, FileImage, X, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";

const DOC_TYPE_LABELS: Record<string, { label: string; hint: string }> = {
  photo_id: { label: "Photo ID", hint: "Driver's license or state-issued ID (front)" },
  ssn_card: { label: "Social Security Card", hint: "Clear photo of your SSN card" },
  work_authorization: { label: "Work Authorization", hint: "Employment authorization document" },
  passport: { label: "Passport", hint: "Photo page of your valid passport" },
};

interface I9SecureUploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  request: {
    id: string;
    document_types: string[];
    notes?: string;
    requested_by_profile?: { full_name: string };
    location?: { name: string };
  };
}

interface FileSlot {
  type: string;
  file: File | null;
  preview: string | null;
  uploaded: boolean;
}

export function I9SecureUploadDialog({ open, onOpenChange, request }: I9SecureUploadDialogProps) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [activeSlot, setActiveSlot] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState(0);

  const [slots, setSlots] = useState<FileSlot[]>(() =>
    (request.document_types || []).map((t) => ({
      type: t,
      file: null,
      preview: null,
      uploaded: false,
    }))
  );

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !activeSlot) return;

    // Max 10MB
    if (file.size > 10 * 1024 * 1024) {
      toast.error("File too large — max 10MB");
      return;
    }

    const preview = file.type.startsWith("image/") ? URL.createObjectURL(file) : null;

    setSlots((prev) =>
      prev.map((s) => (s.type === activeSlot ? { ...s, file, preview } : s))
    );
    setActiveSlot(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const removeFile = (type: string) => {
    setSlots((prev) =>
      prev.map((s) => {
        if (s.type === type) {
          if (s.preview) URL.revokeObjectURL(s.preview);
          return { ...s, file: null, preview: null };
        }
        return s;
      })
    );
  };

  const allFilled = slots.every((s) => s.file !== null);

  const handleSubmit = async () => {
    if (!user?.id || !allFilled) return;
    setSubmitting(true);
    setProgress(0);

    try {
      const total = slots.length;
      let completed = 0;

      for (const slot of slots) {
        if (!slot.file) continue;

        const ext = slot.file.name.split(".").pop() || "jpg";
        const storagePath = `${user.id}/${request.id}/${slot.type}.${ext}`;

        // Upload to storage
        const { error: uploadError } = await supabase.storage
          .from("i9-documents")
          .upload(storagePath, slot.file, { upsert: true });

        if (uploadError) throw uploadError;

        // Create document record
        const { error: docError } = await supabase.from("i9_documents").insert({
          request_id: request.id,
          employee_id: user.id,
          document_type: slot.type as any,
          storage_path: storagePath,
          file_name: slot.file.name,
        });

        if (docError) throw docError;

        completed++;
        setProgress(Math.round((completed / total) * 100));
      }

      // Update request status to uploaded
      await supabase
        .from("i9_document_requests")
        .update({ status: "uploaded" as any })
        .eq("id", request.id);

      // Log audit
      const { data: reqData } = await supabase
        .from("i9_document_requests")
        .select("location_id")
        .eq("id", request.id)
        .single();

      if (reqData) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("full_name")
          .eq("id", user.id)
          .single();

        await supabase.from("i9_audit_log").insert({
          request_id: request.id,
          employee_id: user.id,
          location_id: reqData.location_id,
          action: "uploaded",
          performed_by: user.id,
          performed_by_name: profile?.full_name || "",
          employee_name: profile?.full_name || "",
          metadata: { document_types: request.document_types },
        });
      }

      toast.success("Documents uploaded securely");
      queryClient.invalidateQueries({ queryKey: ["i9-pending-upload"] });
      queryClient.invalidateQueries({ queryKey: ["i9-requests"] });
      queryClient.invalidateQueries({ queryKey: ["i9-documents"] });
      onOpenChange(false);
    } catch (err) {
      console.error("Error uploading hiring documents:", err);
      toast.error("Upload failed — please try again");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,.pdf"
          className="hidden"
          onChange={handleFileSelect}
        />

        {/* Secure header */}
        <DialogHeader>
          <div className="flex items-center justify-center pb-2">
            <div className="relative">
              <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center">
                <Shield className="h-7 w-7 text-primary" />
              </div>
              <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-primary flex items-center justify-center">
                <Lock className="h-3 w-3 text-primary-foreground" />
              </div>
            </div>
          </div>
          <DialogTitle className="text-center">Secure Document Upload</DialogTitle>
          <DialogDescription className="text-center space-y-1">
            <p>Your documents are encrypted and will be auto-deleted after admin review.</p>
            {request.notes && (
              <p className="text-xs italic">Note: {request.notes}</p>
            )}
          </DialogDescription>
        </DialogHeader>

        {/* Security badges */}
        <div className="flex items-center justify-center gap-2">
          <Badge variant="outline" className="text-[10px] gap-1 text-primary border-primary/30">
            <Lock className="h-2.5 w-2.5" /> Encrypted at rest
          </Badge>
          <Badge variant="outline" className="text-[10px] gap-1 text-primary border-primary/30">
            <Shield className="h-2.5 w-2.5" /> Auto-deleted
          </Badge>
        </div>

        {/* Upload slots */}
        <div className="space-y-3">
          {slots.map((slot) => {
            const info = DOC_TYPE_LABELS[slot.type] || { label: slot.type, hint: "" };
            return (
              <div
                key={slot.type}
                className={`rounded-lg border-2 border-dashed p-4 transition-colors ${
                  slot.file
                    ? "border-primary/50 bg-primary/5"
                    : "border-border hover:border-primary/30"
                }`}
              >
                {slot.file ? (
                  <div className="flex items-center gap-3">
                    {slot.preview ? (
                      <img
                        src={slot.preview}
                        alt={info.label}
                        className="w-12 h-12 rounded object-cover border border-border"
                      />
                    ) : (
                      <div className="w-12 h-12 rounded bg-muted flex items-center justify-center">
                        <FileImage className="h-5 w-5 text-muted-foreground" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium flex items-center gap-1.5">
                        <CheckCircle2 className="h-3.5 w-3.5 text-primary" />
                        {info.label}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">{slot.file.name}</p>
                    </div>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8"
                      onClick={() => removeFile(slot.type)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="w-full text-center space-y-1"
                    onClick={() => {
                      setActiveSlot(slot.type);
                      fileInputRef.current?.click();
                    }}
                  >
                    <Upload className="h-5 w-5 mx-auto text-muted-foreground" />
                    <p className="text-sm font-medium">{info.label}</p>
                    <p className="text-xs text-muted-foreground">{info.hint}</p>
                  </button>
                )}
              </div>
            );
          })}
        </div>

        {/* Progress bar during upload */}
        {submitting && (
          <div className="space-y-1">
            <Progress value={progress} className="h-2" />
            <p className="text-xs text-center text-muted-foreground">
              Encrypting and uploading... {progress}%
            </p>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!allFilled || submitting}>
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Uploading...
              </>
            ) : (
              <>
                <Shield className="h-4 w-4 mr-2" />
                Submit Securely
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
