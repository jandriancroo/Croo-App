import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { CreditCard, Loader2, CheckCircle2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useQuery, useQueryClient } from '@tanstack/react-query';

interface Props {
  locationId: string;
  locationName: string;
}

export function InitiateBillingCard({ locationId, locationName }: Props) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [sending, setSending] = useState(false);

  const { data: loc } = useQuery({
    queryKey: ['location-billing-status', locationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('locations')
        .select('billing_initiated_at, billing_initiated_email')
        .eq('id', locationId)
        .single();
      if (error) throw error;
      return data;
    },
  });

  const initiated = !!loc?.billing_initiated_at;

  const handleSend = async () => {
    if (!email.trim()) {
      toast.error('Recipient email is required');
      return;
    }
    setSending(true);
    try {
      const { error } = await supabase.functions.invoke('initiate-billing', {
        body: { location_id: locationId, recipient_email: email.trim(), recipient_name: name.trim() || null },
      });
      if (error) throw error;
      toast.success(`Billing activation email sent to ${email}`);
      qc.invalidateQueries({ queryKey: ['location-billing-status', locationId] });
      qc.invalidateQueries({ queryKey: ['billing-banner-locations'] });
      setOpen(false);
      setEmail('');
      setName('');
    } catch (err: any) {
      toast.error(err.message || 'Failed to send billing email');
    } finally {
      setSending(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <CardTitle className="flex items-center gap-2">
              <CreditCard className="h-5 w-5" />
              Billing Activation
              {initiated && (
                <Badge variant="secondary" className="ml-1">
                  <CheckCircle2 className="h-3 w-3 mr-1" /> Initiated
                </Badge>
              )}
            </CardTitle>
            <CardDescription>
              Send the org admin an email with a direct link to activate their subscription, and surface a banner inside the app.
            </CardDescription>
          </div>
          <Button onClick={() => setOpen(true)}>
            {initiated ? 'Resend Billing Email' : 'Initiate Billing'}
          </Button>
        </div>
      </CardHeader>
      {initiated && (
        <CardContent className="text-sm text-muted-foreground">
          Last sent to <strong>{loc?.billing_initiated_email}</strong> on{' '}
          {new Date(loc!.billing_initiated_at!).toLocaleString()}.
        </CardContent>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Initiate Billing — {locationName}</DialogTitle>
            <DialogDescription>
              Choose who at the customer should receive the activation email. They'll get a direct link to Stripe Checkout and see a banner on their dashboard until the location is subscribed.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1">
              <Label htmlFor="bill-email">Recipient email *</Label>
              <Input
                id="bill-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="owner@theirdomain.com"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="bill-name">Recipient name (optional)</Label>
              <Input
                id="bill-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="First name"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={sending}>Cancel</Button>
            <Button onClick={handleSend} disabled={sending}>
              {sending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Send activation email
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
