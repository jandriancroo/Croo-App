import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { CalendarIcon } from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface EditCertificationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  certification: any;
  onSuccess: () => void;
}

export function EditCertificationDialog({
  open,
  onOpenChange,
  certification,
  onSuccess,
}: EditCertificationDialogProps) {
  const { toast } = useToast();
  const [certificationType, setCertificationType] = useState('');
  const [expirationDate, setExpirationDate] = useState<Date | undefined>();
  const [certificateUrl, setCertificateUrl] = useState('');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (certification && open) {
      setCertificationType(certification.certification_type);
      setExpirationDate(certification.expiration_date ? new Date(certification.expiration_date) : undefined);
      setCertificateUrl(certification.certificate_url);
      setStatus(certification.status);
    }
  }, [certification, open]);

  const handleSave = async () => {
    if (!certificationType || !expirationDate) {
      toast({
        title: 'Error',
        description: 'Please fill in all required fields',
        variant: 'destructive',
      });
      return;
    }

    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      
      const updateData: any = {
        certification_type: certificationType,
        expiration_date: format(expirationDate, 'yyyy-MM-dd'),
        certificate_url: certificateUrl,
        status,
      };

      // If status is being changed to approved, set approved_by and approved_at
      if (status === 'approved' && certification.status !== 'approved') {
        updateData.approved_by = user?.id;
        updateData.approved_at = new Date().toISOString();
      }

      const { error } = await supabase
        .from('certifications')
        .update(updateData)
        .eq('id', certification.id);

      if (error) throw error;

      toast({
        title: 'Success',
        description: 'Certification updated successfully',
      });
      
      onSuccess();
      onOpenChange(false);
    } catch (error: any) {
      console.error('Error updating certification:', error);
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Edit Certification</DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="cert-type">Certification Type</Label>
            <Select value={certificationType} onValueChange={setCertificationType}>
              <SelectTrigger id="cert-type">
                <SelectValue placeholder="Select certification type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="food_handlers">Food Handlers Card</SelectItem>
                <SelectItem value="servsafe">ServSafe</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Expiration Date</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn(
                    'w-full justify-start text-left font-normal',
                    !expirationDate && 'text-muted-foreground'
                  )}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {expirationDate ? format(expirationDate, 'PPP') : 'Pick a date'}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={expirationDate}
                  onSelect={setExpirationDate}
                  initialFocus
                  captionLayout="dropdown"
                  fromYear={new Date().getFullYear()}
                  toYear={new Date().getFullYear() + 10}
                  className="pointer-events-auto"
                />
              </PopoverContent>
            </Popover>
          </div>

          <div className="space-y-2">
            <Label htmlFor="cert-url">Certificate URL</Label>
            <Input
              id="cert-url"
              value={certificateUrl}
              onChange={(e) => setCertificateUrl(e.target.value)}
              placeholder="https://..."
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="status">Status</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger id="status">
                <SelectValue placeholder="Select status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="approved">Approved</SelectItem>
                <SelectItem value="rejected">Rejected</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={loading}>
            {loading ? 'Saving...' : 'Save Changes'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
