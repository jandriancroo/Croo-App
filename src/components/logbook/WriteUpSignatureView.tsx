import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { LandscapeSignatureOverlay } from "@/components/ui/LandscapeSignatureOverlay";
import { AlertTriangle, Loader2 } from "lucide-react";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";

interface WriteUpSignatureViewProps {
  writeUp: {
    id: string;
    reason: string;
    issue_description?: string | null;
    next_steps?: string | null;
    photo_url?: string;
    created_at: string;
    signed_at?: string | null;
    created_by_profile?: { full_name: string };
    location?: { name: string };
  };
  onComplete: () => void;
  onCancel?: () => void;
}

const ACKNOWLEDGMENT_MESSAGE =
  "This corrective action documents an area where we need improvement to meet team standards. Please read it carefully, note the next steps, and sign below with your finger to show you understand and agree to work on this going forward.";

export function WriteUpSignatureView({ writeUp, onComplete, onCancel }: WriteUpSignatureViewProps) {
  const { user } = useAuth();
  const [isSigning, setIsSigning] = useState(false);

  const handleSignature = async (signatureDataUrl: string) => {
    setIsSigning(true);
    try {
      // If it is already signed, do not re-sign — just close the task.
      if (!writeUp.signed_at) {
        const response = await fetch(signatureDataUrl);
        const blob = await response.blob();

        const fileName = `writeup-signatures/${writeUp.id}/${Date.now()}.png`;
        const { error: uploadError } = await supabase.storage
          .from('logbook-attachments')
          .upload(fileName, blob);

        if (uploadError) throw uploadError;

        const { data: { publicUrl } } = supabase.storage
          .from('logbook-attachments')
          .getPublicUrl(fileName);

        const { error: updateError } = await supabase
          .from('employee_writeups')
          .update({
            signature_url: publicUrl,
            signed_at: new Date().toISOString(),
          })
          .eq('id', writeUp.id)
          .is('signed_at', null);

        if (updateError) throw updateError;

        // Send signed copy email to the employee (locked template — untouched)
        try {
          if (user?.email) {
            await supabase.functions.invoke('send-notification-email', {
              body: {
                type: 'employee_writeup_signed',
                to: user.email,
                data: {
                  reason: writeUp.reason,
                  issue_description: writeUp.issue_description,
                  next_steps: writeUp.next_steps,
                  manager_name: writeUp.created_by_profile?.full_name || 'Management',
                  location_name: writeUp.location?.name,
                  signed_date: new Date().toLocaleDateString(),
                },
              },
            });
          }
        } catch (emailError) {
          console.error('Failed to send signed corrective action email:', emailError);
        }
      }

      toast.success("Corrective action acknowledged");
      onComplete();
    } catch (error: any) {
      toast.error("Failed to save signature: " + error.message);
    } finally {
      setIsSigning(false);
    }
  };

  const details = (
    <div className="space-y-3 text-left">
      <div className="flex flex-wrap items-center gap-2">
        <AlertTriangle className="h-5 w-5 text-destructive" />
        <span className="font-semibold">Corrective Action</span>
        <Badge variant="destructive" className="text-xs">{writeUp.reason}</Badge>
        <Badge variant="outline" className="text-xs">
          {format(new Date(writeUp.created_at), 'MMM d, yyyy')}
        </Badge>
        <span className="text-xs text-muted-foreground">
          Issued by {writeUp.created_by_profile?.full_name || 'Manager'}
        </span>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {writeUp.issue_description ? (
          <div className="rounded-lg border p-3">
            <p className="text-xs font-medium text-muted-foreground mb-1">Issue Description</p>
            <p className="text-sm whitespace-pre-wrap">{writeUp.issue_description}</p>
          </div>
        ) : null}
        {writeUp.next_steps ? (
          <div className="rounded-lg border border-primary/30 bg-primary/5 p-3">
            <p className="text-xs font-medium text-muted-foreground mb-1">Next Steps for You</p>
            <p className="text-sm whitespace-pre-wrap">{writeUp.next_steps}</p>
          </div>
        ) : null}
      </div>

      {writeUp.photo_url && (
        <div className="rounded-lg border p-3">
          <p className="text-xs font-medium text-muted-foreground mb-2">Supporting Photo</p>
          <img
            src={writeUp.photo_url}
            alt="Corrective action supporting photo"
            className="max-h-40 rounded-md object-cover"
            loading="lazy"
          />
        </div>
      )}

      <p className="text-xs italic text-amber-700 dark:text-amber-400">{ACKNOWLEDGMENT_MESSAGE}</p>
    </div>
  );

  return (
    <>
      <LandscapeSignatureOverlay
        open
        onClose={() => (onCancel ? onCancel() : undefined)}
        onSave={handleSignature}
        title="Acknowledge Corrective Action"
        disabled={isSigning}
        details={details}
        rotateMessage="Rotate your device to review and sign this corrective action."
      />

      {isSigning && (
        <div className="fixed inset-0 z-[110] bg-background/80 flex items-center justify-center">
          <div className="flex flex-col items-center gap-2">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <span className="text-sm">Saving signature...</span>
          </div>
        </div>
      )}
    </>
  );
}
