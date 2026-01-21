import { useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { Loader2, Mail, Send } from 'lucide-react';

export interface BulkRejectApplicant {
  id: string;
  full_name: string;
  email: string;
}

interface BulkRejectionEmailDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  applicants: BulkRejectApplicant[];
  /** Called after the dialog completes successfully (emails optional) */
  onComplete: () => Promise<void> | void;
}

export function BulkRejectionEmailDialog({
  open,
  onOpenChange,
  organizationId,
  applicants,
  onComplete,
}: BulkRejectionEmailDialogProps) {
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
  const [skipEmail, setSkipEmail] = useState(false);

  const count = applicants.length;
  const previewList = useMemo(() => applicants.slice(0, 3), [applicants]);

  const { data: templates = [], isLoading } = useQuery<any[]>({
    queryKey: ['rejection-email-templates', organizationId, 'active'],
    queryFn: async () => {
      const sb: any = supabase;
      const { data, error } = await sb
        .from('rejection_email_templates')
        .select('id, name, subject')
        .eq('organization_id', organizationId)
        .eq('is_active', true)
        .order('name');
      if (error) throw error;
      return (data ?? []) as any[];
    },
    enabled: open && !!organizationId,
  });

  const sendMutation = useMutation({
    mutationFn: async () => {
      if (count === 0) return;
      if (skipEmail) return;
      if (!selectedTemplateId) throw new Error('Please select an email template');

      // Keep concurrency modest to avoid provider limits.
      const batchSize = 5;
      for (let i = 0; i < applicants.length; i += batchSize) {
        const batch = applicants.slice(i, i + batchSize);
        const results = await Promise.allSettled(
          batch.map((a) =>
            supabase.functions.invoke('send-rejection-email', {
              body: { applicationId: a.id, templateId: selectedTemplateId },
            })
          )
        );

        const failures = results
          .map((r, idx) => ({ r, idx }))
          .filter(({ r }) => r.status === 'rejected' || (r.status === 'fulfilled' && (r.value as any)?.error));

        if (failures.length > 0) {
          const first = failures[0];
          const name = batch[first.idx]?.full_name || 'applicant';
          throw new Error(`Failed sending rejection email for ${name}.`);
        }
      }
    },
    onSuccess: async () => {
      if (skipEmail) {
        toast.success(`Marked ${count} applicants as rejected (no email sent)`);
      } else {
        toast.success(`Sent rejection emails to ${count} applicants`);
      }
      await onComplete();
      onOpenChange(false);
    },
    onError: (error) => {
      console.error('Bulk rejection email error:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to send rejection emails');
    },
  });

  const disabled = sendMutation.isPending || (!skipEmail && !selectedTemplateId);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5" />
            Bulk Reject Applicants
          </DialogTitle>
          <DialogDescription>
            {count === 0
              ? 'No applicants selected.'
              : `Send a rejection email to ${count} selected applicant${count === 1 ? '' : 's'}.`}
          </DialogDescription>
        </DialogHeader>

        {count > 0 && (
          <div className="pb-2 text-sm text-muted-foreground">
            {previewList.map((a) => (
              <div key={a.id} className="truncate">
                {a.full_name} ({a.email})
              </div>
            ))}
            {count > previewList.length && <div className="mt-1">…and {count - previewList.length} more</div>}
          </div>
        )}

        <div className="py-2 space-y-4">
          {isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : templates?.length === 0 ? (
            <div className="text-center py-4">
              <p className="text-muted-foreground mb-2">No email templates available</p>
              <p className="text-sm text-muted-foreground">Create templates in the Templates tab first</p>
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
              {templates?.map((template) => (
                <div
                  key={template.id}
                  className="flex items-center space-x-3 p-3 rounded-lg border hover:bg-muted/50 transition-colors"
                >
                  <RadioGroupItem value={template.id} id={`bulk-${template.id}`} />
                  <Label htmlFor={`bulk-${template.id}`} className="flex-1 cursor-pointer">
                    <span className="font-medium">{template.name}</span>
                    <p className="text-sm text-muted-foreground">{template.subject}</p>
                  </Label>
                </div>
              ))}
              <div className="flex items-center space-x-3 p-3 rounded-lg border hover:bg-muted/50 transition-colors">
                <RadioGroupItem value="skip" id="bulk-skip" />
                <Label htmlFor="bulk-skip" className="flex-1 cursor-pointer">
                  <span className="font-medium">Don't send email</span>
                  <p className="text-sm text-muted-foreground">Mark as rejected without notifying</p>
                </Label>
              </div>
            </RadioGroup>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={sendMutation.isPending}>
            Cancel
          </Button>
          <Button
            onClick={() => sendMutation.mutate()}
            disabled={disabled}
            variant={skipEmail ? 'secondary' : 'default'}
          >
            {sendMutation.isPending ? (
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
