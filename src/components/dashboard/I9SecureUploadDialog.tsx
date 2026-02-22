import { useState, useRef, useCallback, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Shield, Lock, Upload, CheckCircle2, FileImage, X, Loader2, ScanLine } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { DocumentScanOverlay, type DocumentValidationResult } from "./DocumentScanOverlay";
import { getDisplayName } from "@/utils/displayName";

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
  validationResult: DocumentValidationResult | null;
  validated: boolean;
}

export function I9SecureUploadDialog({ open, onOpenChange, request }: I9SecureUploadDialogProps) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [activeSlot, setActiveSlot] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [scanningSlot, setScanningSlot] = useState<string | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [employeeName, setEmployeeName] = useState<string>("");

  const [slots, setSlots] = useState<FileSlot[]>(() =>
    (request.document_types || []).map((t) => ({
      type: t,
      file: null,
      preview: null,
      uploaded: false,
      validationResult: null,
      validated: false,
    }))
  );

  // Fetch employee name for validation (legal name for ID matching)
  useEffect(() => {
    if (user?.id) {
      supabase
        .from("profiles")
        .select("full_name")
        .eq("id", user.id)
        .single()
        .then(({ data }) => {
          if (data?.full_name) setEmployeeName(data.full_name);
        });
    }
  }, [user?.id]);

  const fileToBase64 = useCallback((file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        // Remove data URL prefix
        const base64 = result.split(",")[1];
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }, []);

  const validateDocument = useCallback(
    async (file: File, slotType: string) => {
      setScanningSlot(slotType);
      setScanError(null);

      try {
        const base64 = await fileToBase64(file);
        const docLabel = DOC_TYPE_LABELS[slotType]?.label || slotType;

        const { data, error } = await supabase.functions.invoke(
          "document-validation",
          {
            body: {
              imageBase64: base64,
              employeeName: employeeName || "Unknown",
              documentType: docLabel,
            },
          }
        );

        if (error) throw error;

        if (data?.error) {
          setScanError(data.error);
          return;
        }

        setSlots((prev) =>
          prev.map((s) =>
            s.type === slotType
              ? { ...s, validationResult: data as DocumentValidationResult }
              : s
          )
        );
      } catch (err: any) {
        console.error("Validation error:", err);
        setScanError(err?.message || "Validation failed — you can still upload manually");
      } finally {
        setScanningSlot(null);
      }
    },
    [employeeName, fileToBase64]
  );

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !activeSlot) return;

    if (file.size > 10 * 1024 * 1024) {
      toast.error("File too large — max 10MB");
      return;
    }

    const preview = file.type.startsWith("image/") ? URL.createObjectURL(file) : null;
    const currentSlot = activeSlot;

    setSlots((prev) =>
      prev.map((s) => (s.type === currentSlot ? { ...s, file, preview, validationResult: null, validated: false } : s))
    );
    setActiveSlot(null);
    if (fileInputRef.current) fileInputRef.current.value = "";

    // Auto-trigger scan for image files
    if (file.type.startsWith("image/")) {
      await validateDocument(file, currentSlot);
    }
  };

  const handleRetake = (type: string) => {
    setSlots((prev) =>
      prev.map((s) => {
        if (s.type === type) {
          if (s.preview) URL.revokeObjectURL(s.preview);
          return { ...s, file: null, preview: null, validationResult: null, validated: false };
        }
        return s;
      })
    );
    setScanError(null);
  };

  const handleAcceptValidation = (type: string) => {
    setSlots((prev) =>
      prev.map((s) => (s.type === type ? { ...s, validated: true } : s))
    );
  };

  const removeFile = (type: string) => {
    handleRetake(type);
  };

  const allFilled = slots.every((s) => s.file !== null);
  const allValidated = slots.every((s) => s.validated || !s.file?.type.startsWith("image/"));

  const handleSubmit = async () => {
    console.log("[I9-UPLOAD] Submit triggered", { userId: user?.id, allFilled, slotsCount: slots.length });
    if (!user?.id || !allFilled) {
      console.warn("[I9-UPLOAD] Blocked: userId=", user?.id, "allFilled=", allFilled);
      return;
    }
    setSubmitting(true);
    setProgress(0);

    try {
      const total = slots.length;
      let completed = 0;

      for (const slot of slots) {
        if (!slot.file) continue;

        const ext = slot.file.name.split(".").pop() || "jpg";
        const storagePath = `${user.id}/${request.id}/${slot.type}.${ext}`;
        console.log("[I9-UPLOAD] Uploading to storage:", storagePath, "fileSize:", slot.file.size, "fileType:", slot.file.type);

        const { error: uploadError } = await supabase.storage
          .from("i9-documents")
          .upload(storagePath, slot.file, { upsert: true });

        if (uploadError) {
          console.error("[I9-UPLOAD] Storage upload FAILED:", JSON.stringify(uploadError));
          throw uploadError;
        }
        console.log("[I9-UPLOAD] Storage upload SUCCESS for", slot.type);

        const { error: docError } = await supabase.from("i9_documents").insert({
          request_id: request.id,
          employee_id: user.id,
          document_type: slot.type as any,
          storage_path: storagePath,
          file_name: slot.file.name,
        });

        if (docError) {
          console.error("[I9-UPLOAD] DB insert FAILED:", JSON.stringify(docError));
          throw docError;
        }
        console.log("[I9-UPLOAD] DB insert SUCCESS for", slot.type);

        completed++;
        setProgress(Math.round((completed / total) * 100));
      }

      await supabase
        .from("i9_document_requests")
        .update({ status: "uploaded" as any })
        .eq("id", request.id);

      const { data: reqData } = await supabase
        .from("i9_document_requests")
        .select("location_id")
        .eq("id", request.id)
        .single();

      if (reqData) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("full_name, nickname")
          .eq("id", user.id)
          .single();

        const empName = profile ? getDisplayName(profile.full_name, profile.nickname) : "Employee";

        await supabase.from("i9_audit_log").insert({
          request_id: request.id,
          employee_id: user.id,
          location_id: reqData.location_id,
          action: "uploaded",
          performed_by: user.id,
          performed_by_name: empName,
          employee_name: empName,
          metadata: { document_types: request.document_types },
        });

        // Send push notification to the requesting manager
        const { data: reqFull } = await supabase
          .from("i9_document_requests")
          .select("requested_by")
          .eq("id", request.id)
          .single();

        if (reqFull?.requested_by) {
          const docLabels = (request.document_types || [])
            .map((t) => DOC_TYPE_LABELS[t]?.label || t)
            .join(", ");

          await supabase.from("alert_queue").insert({
            alert_type: "hiring_doc_uploaded",
            dedup_key: `hiring_doc_uploaded_${request.id}`,
            location_id: reqData.location_id,
            payload: {
              user_ids: [reqFull.requested_by],
              title: "Hiring Documents Uploaded",
              body: `${empName} uploaded: ${docLabels}`,
              notification_type: "hiring_doc_uploaded",
              data: {
                type: "hiring_doc_uploaded",
                employee_id: user.id,
                location_id: reqData.location_id,
              },
            },
          });
        }
      }

      toast.success("Documents uploaded securely");
      queryClient.invalidateQueries({ queryKey: ["i9-pending-upload"] });
      queryClient.invalidateQueries({ queryKey: ["i9-requests"] });
      queryClient.invalidateQueries({ queryKey: ["i9-documents"] });
      onOpenChange(false);
    } catch (err: any) {
      console.error("[I9-UPLOAD] FULL ERROR:", err, "message:", err?.message, "statusCode:", err?.statusCode);
      toast.error(`Upload failed: ${err?.message || "please try again"}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,.pdf"
          capture="environment"
          className="hidden"
          onChange={handleFileSelect}
        />

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
            <p className="text-[10px] text-muted-foreground italic">
              These documents are collected for onboarding purposes only and are not a substitute for Form I-9 verification.
            </p>
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
            <ScanLine className="h-2.5 w-2.5" /> AI Verified
          </Badge>
          <Badge variant="outline" className="text-[10px] gap-1 text-primary border-primary/30">
            <Shield className="h-2.5 w-2.5" /> Auto-deleted
          </Badge>
        </div>

        {/* Upload slots */}
        <div className="space-y-3">
          {slots.map((slot) => {
            const info = DOC_TYPE_LABELS[slot.type] || { label: slot.type, hint: "" };
            const isScanning = scanningSlot === slot.type;
            const showScanOverlay = slot.file && slot.preview && (isScanning || slot.validationResult) && !slot.validated;

            return (
              <div key={slot.type} className="space-y-1">
                {/* Label */}
                <p className="text-xs font-medium text-foreground pl-1">{info.label}</p>

                {showScanOverlay ? (
                  /* Scan overlay with validation */
                  <DocumentScanOverlay
                    imageUrl={slot.preview!}
                    scanning={isScanning}
                    result={slot.validationResult}
                    error={isScanning ? null : scanError}
                    onRetake={() => handleRetake(slot.type)}
                    onAccept={() => handleAcceptValidation(slot.type)}
                  />
                ) : slot.file && slot.validated ? (
                  /* Validated & accepted */
                  <div
                    className="rounded-lg border-2 border-green-500/50 bg-green-500/5 p-3"
                  >
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
                          <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                          Verified
                        </p>
                        <p className="text-xs text-muted-foreground truncate">{slot.file.name}</p>
                        {slot.validationResult?.name && (
                          <p className="text-[10px] text-green-600 dark:text-green-400">
                            Name: {slot.validationResult.name.extracted_name}
                          </p>
                        )}
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
                  </div>
                ) : slot.file && !slot.preview ? (
                  /* Non-image file (PDF) — no scan */
                  <div className="rounded-lg border-2 border-primary/50 bg-primary/5 p-3">
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 rounded bg-muted flex items-center justify-center">
                        <FileImage className="h-5 w-5 text-muted-foreground" />
                      </div>
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
                  </div>
                ) : (
                  /* Empty slot — upload prompt */
                  <div
                    className="rounded-lg border-2 border-dashed border-border hover:border-primary/30 p-4 transition-colors"
                  >
                    <button
                      type="button"
                      className="w-full text-center space-y-2"
                      onClick={() => {
                        setActiveSlot(slot.type);
                        fileInputRef.current?.click();
                      }}
                    >
                      <Upload className="h-5 w-5 mx-auto text-muted-foreground" />
                      <p className="text-sm font-medium">Take Photo or Upload</p>
                      <p className="text-xs text-muted-foreground">{info.hint}</p>
                      <p className="text-[10px] text-muted-foreground/70 italic">
                        📋 Place document flat on a dark surface • Good lighting • No glare
                      </p>
                    </button>
                  </div>
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
