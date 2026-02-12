import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Upload, Camera, X, Loader2 } from 'lucide-react';
import { format } from 'date-fns';

interface CreateTicketDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const CATEGORIES = [
  { value: 'ui_glitch', label: 'UI Glitch', description: 'Visual bugs, display issues' },
  { value: 'broken_feature', label: 'Broken Feature', description: 'Something not working as expected' },
  { value: 'login_issues', label: 'Login Issues', description: 'Authentication problems' },
  { value: 'data_sync_issues', label: 'Data/Sync Issues', description: 'Missing or incorrect data' },
  { value: 'notification_issues', label: 'Notification Issues', description: 'Push notifications not working' },
  { value: 'scheduling_issues', label: 'Scheduling Issues', description: 'Schedule-related problems' },
  { value: 'other', label: 'Other', description: 'Something else' },
];

export function CreateTicketDialog({ open, onOpenChange }: CreateTicketDialogProps) {
  const [category, setCategory] = useState<string>('');
  const [description, setDescription] = useState('');
  const [occurrenceTime, setOccurrenceTime] = useState(format(new Date(), "yyyy-MM-dd'T'HH:mm"));
  const [screenshot, setScreenshot] = useState<File | null>(null);
  const [screenshotPreview, setScreenshotPreview] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setScreenshot(file);
      const reader = new FileReader();
      reader.onload = () => setScreenshotPreview(reader.result as string);
      reader.readAsDataURL(file);
    }
  };

  const removeScreenshot = () => {
    setScreenshot(null);
    setScreenshotPreview(null);
  };

  const resetForm = () => {
    setCategory('');
    setDescription('');
    setOccurrenceTime(format(new Date(), "yyyy-MM-dd'T'HH:mm"));
    setScreenshot(null);
    setScreenshotPreview(null);
  };

  const handleSubmit = async () => {
    if (!category || !description.trim()) {
      toast.error('Please select a category and describe the issue');
      return;
    }

    setIsSubmitting(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      let screenshotUrl: string | null = null;

      // Upload screenshot if provided
      if (screenshot) {
        const fileExt = screenshot.name.split('.').pop();
        const fileName = `${user.id}/${Date.now()}.${fileExt}`;
        
        const { error: uploadError } = await supabase.storage
          .from('support-attachments')
          .upload(fileName, screenshot);

        if (uploadError) throw uploadError;

        const { data: urlData } = supabase.storage
          .from('support-attachments')
          .getPublicUrl(fileName);
        
        screenshotUrl = urlData.publicUrl;
      }

      // Create ticket
      const { data: ticket, error: ticketError } = await supabase
        .from('support_tickets')
        .insert({
          user_id: user.id,
          category: category as any,
          description: description.trim(),
          screenshot_url: screenshotUrl,
          occurrence_time: new Date(occurrenceTime).toISOString(),
        })
        .select('id, ticket_number')
        .single();

      if (ticketError) throw ticketError;

      // Notify support admins about new ticket
      try {
        await supabase.functions.invoke('support-email-service', {
          body: {
            action: 'support_ticket',
            payload: {
              ticket_id: ticket.id,
              event_type: 'new_ticket',
            },
          },
        });
      } catch (notifyError) {
        console.error('Error notifying support team:', notifyError);
        // Don't fail the ticket creation if notification fails
      }

      toast.success(`Support ticket #SUP-${String(ticket.ticket_number).padStart(3, '0')} created!`);
      resetForm();
      onOpenChange(false);
    } catch (error: any) {
      console.error('Error creating ticket:', error);
      toast.error('Failed to create support ticket');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Create Support Ticket</DialogTitle>
          <DialogDescription>
            Describe your issue and our team will help you resolve it.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Category */}
          <div className="space-y-2">
            <Label>Issue Category *</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger>
                <SelectValue placeholder="Select category..." />
              </SelectTrigger>
              <SelectContent>
                {CATEGORIES.map((cat) => (
                  <SelectItem key={cat.value} value={cat.value}>
                    <div className="flex flex-col">
                      <span>{cat.label}</span>
                      <span className="text-xs text-muted-foreground">{cat.description}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label>Describe the Issue *</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Please describe what happened, what you expected, and steps to reproduce..."
              rows={4}
            />
          </div>

          {/* Occurrence Time */}
          <div className="space-y-2">
            <Label>When did this happen?</Label>
            <Input
              type="datetime-local"
              value={occurrenceTime}
              onChange={(e) => setOccurrenceTime(e.target.value)}
            />
          </div>

          {/* Screenshot */}
          <div className="space-y-2">
            <Label>Screenshot (optional but helpful)</Label>
            {screenshotPreview ? (
              <div className="relative">
                <img
                  src={screenshotPreview}
                  alt="Screenshot preview"
                  className="w-full h-40 object-cover rounded-lg border"
                />
                <Button
                  variant="destructive"
                  size="icon"
                  className="absolute top-2 right-2 h-6 w-6"
                  onClick={removeScreenshot}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              <div className="flex gap-2">
                <label className="flex-1">
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleFileChange}
                  />
                  <Button variant="outline" className="w-full gap-2" asChild>
                    <span>
                      <Upload className="h-4 w-4" />
                      Upload
                    </span>
                  </Button>
                </label>
                <label>
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className="hidden"
                    onChange={handleFileChange}
                  />
                  <Button variant="outline" className="gap-2" asChild>
                    <span>
                      <Camera className="h-4 w-4" />
                    </span>
                  </Button>
                </label>
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={isSubmitting}>
            {isSubmitting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Submitting...
              </>
            ) : (
              'Submit Ticket'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
