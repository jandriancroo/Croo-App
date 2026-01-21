import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { Loader2, Mail, Send } from 'lucide-react';

interface RejectionEmailDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  applicationId: string;
  applicantName: string;
  applicantEmail: string;
  organizationId: string;
  onComplete: () => void;
}

export function RejectionEmailDialog({
  open,
  onOpenChange,
  applicationId,
  applicantName,
  applicantEmail,
  organizationId,
  onComplete,
}: RejectionEmailDialogProps) {
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
  const [skipEmail, setSkipEmail] = useState(false);

  // Fetch active rejection templates
  const { data: templates, isLoading } = useQuery({
    queryKey: ['rejection-email-templates', organizationId, 'active'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('rejection_email_templates')
        .select('id, name, subject')
        .eq('organization_id', organizationId)
        .eq('is_active', true)
        .order('name');
      
      if (error) throw error;
      return data;
    },
    enabled: open && !!organizationId,
  });

  const sendEmailMutation = useMutation({
    mutationFn: async () => {
      if (skipEmail) {
        return { skipped: true };
      }
      
      if (!selectedTemplateId) {
        throw new Error('Please select an email template');
      }

      const { data, error } = await supabase.functions.invoke('send-rejection-email', {
        body: { applicationId, templateId: selectedTemplateId }
      });

      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      if (data?.skipped) {
        toast.success('Application marked as rejected (no email sent)');
      } else {
        toast.success('Rejection email sent successfully');
      }
      onOpenChange(false);
      onComplete();
    },
    onError: (error) => {
      console.error('Error sending rejection email:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to send email');
    },
  });

  const handleConfirm = () => {
    sendEmailMutation.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5" />
            Send Rejection Email
          </DialogTitle>
          <DialogDescription>
            Send a rejection email to {applicantName} ({applicantEmail})
          </DialogDescription>
        </DialogHeader>

        <div className="py-4 space-y-4">
          {isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : templates?.length === 0 ? (
            <div className="text-center py-4">
              <p className="text-muted-foreground mb-2">No email templates available</p>
              <p className="text-sm text-muted-foreground">
                Create templates in the Templates tab first
              </p>
            </div>
          ) : (
            <RadioGroup
              value={skipEmail ? 'skip' : selectedTemplateId}
              onValueChange={(value) => {
                if (value === 'skip') {
                  setSkipEmail(true);
                  setSelectedTemplateId('');
                } else {
                  setSkipEmail(false);
                  setSelectedTemplateId(value);
                }
              }}
              className="space-y-3"
            >
              {templates?.map(template => (
                <div key={template.id} className="flex items-center space-x-3 p-3 rounded-lg border hover:bg-muted/50 transition-colors">
                  <RadioGroupItem value={template.id} id={template.id} />
                  <Label htmlFor={template.id} className="flex-1 cursor-pointer">
                    <span className="font-medium">{template.name}</span>
                    <p className="text-sm text-muted-foreground">{template.subject}</p>
                  </Label>
                </div>
              ))}
              <div className="flex items-center space-x-3 p-3 rounded-lg border hover:bg-muted/50 transition-colors">
                <RadioGroupItem value="skip" id="skip" />
                <Label htmlFor="skip" className="flex-1 cursor-pointer">
                  <span className="font-medium">Don't send email</span>
                  <p className="text-sm text-muted-foreground">Mark as rejected without notifying</p>
                </Label>
              </div>
            </RadioGroup>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={sendEmailMutation.isPending || (!skipEmail && !selectedTemplateId)}
            variant={skipEmail ? 'secondary' : 'default'}
          >
            {sendEmailMutation.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : skipEmail ? null : (
              <Send className="h-4 w-4 mr-2" />
            )}
            {skipEmail ? 'Skip & Reject' : 'Send Email'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
