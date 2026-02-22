import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Shield, CreditCard, FileText, Fingerprint, BookOpen, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useLocation as useAppLocation } from "@/hooks/useLocation";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";

const DOCUMENT_TYPES = [
  { id: "photo_id" as const, label: "Photo ID", description: "Driver's license or state ID", icon: CreditCard },
  { id: "ssn_card" as const, label: "Social Security Card", description: "SSN card", icon: Fingerprint },
  { id: "work_authorization" as const, label: "Work Authorization", description: "Employment authorization document", icon: FileText },
  { id: "passport" as const, label: "Passport", description: "Valid passport", icon: BookOpen },
] as const;

type I9DocType = typeof DOCUMENT_TYPES[number]["id"];

interface I9RequestDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Single employee */
  employee?: { id: string; full_name: string } | null;
  /** Bulk: array of employees */
  employees?: { id: string; full_name: string }[];
}

export function I9RequestDialog({ open, onOpenChange, employee, employees }: I9RequestDialogProps) {
  const { user } = useAuth();
  const { currentLocation } = useAppLocation();
  const queryClient = useQueryClient();
  const [selectedTypes, setSelectedTypes] = useState<I9DocType[]>([]);
  const [notes, setNotes] = useState("");
  const [sending, setSending] = useState(false);

  const targets = employees?.length ? employees : employee ? [employee] : [];

  const toggleType = (type: I9DocType) => {
    setSelectedTypes((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]
    );
  };

  const handleSubmit = async () => {
    if (!user?.id || !currentLocation?.id || selectedTypes.length === 0 || targets.length === 0) return;
    setSending(true);

    try {
      const inserts = targets.map((t) => ({
        employee_id: t.id,
        location_id: currentLocation.id,
        requested_by: user.id,
        document_types: selectedTypes,
        notes: notes.trim() || null,
      }));

      const { error } = await supabase.from("i9_document_requests").insert(inserts);
      if (error) throw error;

      toast.success(`Document request sent to ${targets.length} employee${targets.length > 1 ? "s" : ""}`);
      queryClient.invalidateQueries({ queryKey: ["i9-requests"] });
      queryClient.invalidateQueries({ queryKey: ["i9-pending-upload"] });
      onOpenChange(false);
      setSelectedTypes([]);
      setNotes("");
    } catch (err) {
      console.error("Error creating hiring doc request:", err);
      toast.error("Failed to send request");
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-primary" />
            Request Hiring Documents
          </DialogTitle>
          <DialogDescription>
            {targets.length === 1
              ? `Request identity documents from ${targets[0].full_name}`
              : `Request identity documents from ${targets.length} employees`}
          </DialogDescription>
        </DialogHeader>

        {/* Recipients preview (bulk) */}
        {targets.length > 1 && (
          <div className="flex flex-wrap gap-1 max-h-20 overflow-y-auto">
            {targets.map((t) => (
              <Badge key={t.id} variant="secondary" className="text-xs">
                {t.full_name}
              </Badge>
            ))}
          </div>
        )}

        {/* Document type selection */}
        <div className="space-y-2">
          <Label className="text-sm font-medium">Select documents to request</Label>
          <div className="grid grid-cols-1 gap-2">
            {DOCUMENT_TYPES.map((doc) => {
              const Icon = doc.icon;
              const checked = selectedTypes.includes(doc.id);
              return (
                <button
                  key={doc.id}
                  type="button"
                  onClick={() => toggleType(doc.id)}
                  className={`flex items-center gap-3 p-3 rounded-lg border transition-colors text-left ${
                    checked
                      ? "border-primary bg-primary/5"
                      : "border-border hover:bg-muted/50"
                  }`}
                >
                  <Checkbox checked={checked} className="pointer-events-none" />
                  <Icon className={`h-4 w-4 ${checked ? "text-primary" : "text-muted-foreground"}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">{doc.label}</p>
                    <p className="text-xs text-muted-foreground">{doc.description}</p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Notes */}
        <div className="space-y-2">
          <Label className="text-sm">Notes (optional)</Label>
          <Textarea
            placeholder="Any special instructions..."
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="min-h-[60px]"
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={sending || selectedTypes.length === 0}
          >
            {sending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Sending...
              </>
            ) : (
              <>
                <Shield className="h-4 w-4 mr-2" />
                Send Request
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
