import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { LandscapeSignatureOverlay } from "@/components/ui/LandscapeSignatureOverlay";
import { AlertTriangle, FileText, Loader2, User, PenLine } from "lucide-react";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";

interface WriteUpSignatureViewProps {
  writeUp: {
    id: string;
    reason: string;
    issue_description: string;
    next_steps: string;
    photo_url?: string;
    created_at: string;
    created_by_profile?: { full_name: string };
    location?: { name: string };
  };
  onComplete: () => void;
}

export function WriteUpSignatureView({ writeUp, onComplete }: WriteUpSignatureViewProps) {
  const { user } = useAuth();
  const [isSigning, setIsSigning] = useState(false);
  const [showSignatureOverlay, setShowSignatureOverlay] = useState(false);

  const handleSignature = async (signatureDataUrl: string) => {
    setIsSigning(true);
    try {
      // Convert base64 to blob
      const response = await fetch(signatureDataUrl);
      const blob = await response.blob();
      
      // Upload signature to storage
      const fileName = `writeup-signatures/${writeUp.id}/${Date.now()}.png`;
      const { error: uploadError } = await supabase.storage
        .from('logbook-attachments')
        .upload(fileName, blob);

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('logbook-attachments')
        .getPublicUrl(fileName);

      // Update the writeup with signature
      const { error: updateError } = await supabase
        .from('employee_writeups')
        .update({
          signature_url: publicUrl,
          signed_at: new Date().toISOString(),
        })
        .eq('id', writeUp.id);

      if (updateError) throw updateError;

      // Send signed copy email to the employee
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
          console.log('Signed corrective action email sent to employee');
        }
      } catch (emailError) {
        console.error('Failed to send signed corrective action email:', emailError);
        // Don't block completion if email fails
      }

      toast.success("Corrective action acknowledged");
      onComplete();
    } catch (error: any) {
      toast.error("Failed to save signature: " + error.message);
    } finally {
      setIsSigning(false);
    }
  };

  const ACKNOWLEDGMENT_MESSAGE = "This corrective action documents an area where we need improvement to meet team standards. Please read through it carefully, note the next steps, and sign below with your finger to show you understand and agree to work on this going forward.";

  return (
    <div className="fixed inset-0 z-50 bg-background flex flex-col">
      {/* Header */}
      <div className="flex-shrink-0 flex items-center justify-between p-4 border-b bg-destructive/10">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-destructive" />
          <h1 className="font-semibold text-lg">Corrective Action</h1>
        </div>
        <Badge variant="outline" className="text-xs">
          {format(new Date(writeUp.created_at), 'MMM d, yyyy')}
        </Badge>
      </div>

      {/* Content - Scrollable */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 min-h-0">
        {/* Reason Badge */}
        <div className="flex items-center gap-2">
          <Badge variant="destructive" className="text-sm">
            {writeUp.reason}
          </Badge>
          <span className="text-sm text-muted-foreground">
            Issued by {writeUp.created_by_profile?.full_name || 'Manager'}
          </span>
        </div>

        {/* Issue Description */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <FileText className="h-4 w-4" />
              Issue Description
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm whitespace-pre-wrap">{writeUp.issue_description}</p>
          </CardContent>
        </Card>

        {/* Next Steps */}
        <Card className="border-primary/30 bg-primary/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <User className="h-4 w-4" />
              Next Steps for You
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm whitespace-pre-wrap">{writeUp.next_steps}</p>
          </CardContent>
        </Card>

        {/* Photo Evidence */}
        {writeUp.photo_url && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Supporting Photo</CardTitle>
            </CardHeader>
            <CardContent>
              <img 
                src={writeUp.photo_url} 
                alt="Evidence" 
                className="w-full h-48 object-cover rounded-lg"
              />
            </CardContent>
          </Card>
        )}

        <Separator />

        {/* Acknowledgment Message */}
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardContent className="p-4">
            <p className="text-sm text-amber-700 dark:text-amber-400 italic">
              {ACKNOWLEDGMENT_MESSAGE}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Sign Button - Fixed Footer */}
      <div className="flex-shrink-0 border-t bg-background p-4 pb-safe">
        <Button
          className="w-full h-12 text-base gap-2"
          onClick={() => setShowSignatureOverlay(true)}
          disabled={isSigning}
        >
          <PenLine className="h-5 w-5" />
          Tap to Acknowledge & Sign
        </Button>
      </div>

      {/* Landscape Signature Overlay */}
      <LandscapeSignatureOverlay
        open={showSignatureOverlay}
        onClose={() => setShowSignatureOverlay(false)}
        onSave={handleSignature}
        title="Acknowledge Corrective Action"
        disabled={isSigning}
      />

      {/* Loading overlay */}
      {isSigning && (
        <div className="absolute inset-0 bg-background/80 flex items-center justify-center z-10">
          <div className="flex flex-col items-center gap-2">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <span className="text-sm">Saving signature...</span>
          </div>
        </div>
      )}
    </div>
  );
}