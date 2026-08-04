import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { useLocation } from '@/hooks/useLocation';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Loader2, UserPlus, Copy, Check, CheckCircle } from 'lucide-react';

interface HireApplicantDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  applicant: {
    id: string;
    full_name: string;
    email: string;
    phone?: string;
  } | null;
  onSuccess: () => void;
}

type AppRole = 'team_member' | 'shift_manager_in_training' | 'shift_manager' | 'manager' | 'admin' | 'org_admin' | 'brand_admin';

export function HireApplicantDialog({ open, onOpenChange, applicant, onSuccess }: HireApplicantDialogProps) {
  const { currentLocation } = useLocation();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  
  // Form state
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState<AppRole>('team_member');
  const [hourlyWage, setHourlyWage] = useState('');
  const [birthday, setBirthday] = useState('');
  const [selectedLocationId, setSelectedLocationId] = useState('');

  // Fetch available locations
  const { data: locations } = useQuery({
    queryKey: ['user-locations'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('locations')
        .select('id, name')
        .order('name');
      if (error) throw error;
      return data;
    },
  });

  // Pre-fill form when applicant changes
  useEffect(() => {
    if (applicant) {
      setFullName(applicant.full_name || '');
      setEmail(applicant.email || '');
      setPhone(applicant.phone || '');
      setRole('team_member');
      setHourlyWage('');
      setBirthday('');
      setSelectedLocationId(currentLocation?.id || '');
      setInviteLink(null);
    }
  }, [applicant, currentLocation?.id]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!email || !fullName || !selectedLocationId) {
      toast.error('Please fill in all required fields');
      return;
    }

    setIsSubmitting(true);

    try {
      const { data, error } = await supabase.functions.invoke('user-service', {
        body: {
          action: 'invite',
          email,
          fullName,
          role,
          locationId: selectedLocationId,
          phoneNumber: phone || null,
          hourlyWage: hourlyWage ? parseFloat(hourlyWage) : null,
          birthday: birthday || null,
        },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      // Update application status to hired
      if (applicant?.id) {
        await supabase
          .from('job_applications')
          .update({ status: 'hired', updated_at: new Date().toISOString() })
          .eq('id', applicant.id);
      }

      if (data?.resetLink) {
        setInviteLink(data.resetLink);
        toast.success('Account created! Share the invite link with the new hire.');
      } else {
        toast.success('Account created successfully');
        onOpenChange(false);
        onSuccess();
      }
    } catch (error: any) {
      console.error('Error creating account:', error);
      toast.error(error.message || 'Failed to create account');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    if (inviteLink) {
      onSuccess();
    }
    setInviteLink(null);
    onOpenChange(false);
  };

  if (!applicant) return null;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="h-5 w-5" />
            Hire {applicant.full_name}
          </DialogTitle>
          <DialogDescription>
            Create an account for this new team member
          </DialogDescription>
        </DialogHeader>

        {inviteLink ? (
          <div className="space-y-4">
            <div className="flex flex-col items-center gap-4 py-4">
              <CheckCircle className="h-12 w-12 text-green-500" />
              <p className="text-center font-medium">Account created for {fullName}!</p>
              <p className="text-sm text-muted-foreground text-center">
                Share this link so they can set their password:
              </p>
              <div className="w-full flex items-center gap-2">
                <Input value={inviteLink} readOnly className="text-xs" />
                <Button 
                  variant="outline" 
                  size="icon"
                  onClick={() => {
                    navigator.clipboard.writeText(inviteLink);
                    toast.success('Link copied!');
                  }}
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <Button onClick={handleClose} className="w-full">
              Done
            </Button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <Label htmlFor="fullName">Full Name *</Label>
                <Input
                  id="fullName"
                  value={fullName}
                  onChange={e => setFullName(e.target.value)}
                  required
                />
              </div>

              <div className="col-span-2">
                <Label htmlFor="email">Email *</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  required
                />
              </div>

              <div className="col-span-2 sm:col-span-1">
                <Label htmlFor="phone">Phone</Label>
                <Input
                  id="phone"
                  type="tel"
                  value={phone}
                  onChange={e => setPhone(e.target.value)}
                />
              </div>

              <div className="col-span-2 sm:col-span-1">
                <Label htmlFor="birthday">Birthday</Label>
                <Input
                  id="birthday"
                  type="date"
                  value={birthday}
                  onChange={e => setBirthday(e.target.value)}
                />
              </div>

              <div className="col-span-2 sm:col-span-1">
                <Label htmlFor="role">Role *</Label>
                <Select value={role} onValueChange={(val) => setRole(val as AppRole)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="team_member">Team Member</SelectItem>
                    <SelectItem value="shift_manager_in_training">Shift Manager in Training</SelectItem>
                    <SelectItem value="shift_manager">Shift Manager</SelectItem>
                    <SelectItem value="manager">Manager</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                    <SelectItem value="org_admin">Org Admin</SelectItem>
                    <SelectItem value="brand_admin">Brand Admin</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="col-span-2 sm:col-span-1">
                <Label htmlFor="wage">Hourly Wage ($)</Label>
                <Input
                  id="wage"
                  type="number"
                  step="0.01"
                  min="0"
                  value={hourlyWage}
                  onChange={e => setHourlyWage(e.target.value)}
                  placeholder="15.00"
                />
              </div>

              <div className="col-span-2">
                <Label htmlFor="location">Assign to Location *</Label>
                <Select value={selectedLocationId} onValueChange={setSelectedLocationId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a location" />
                  </SelectTrigger>
                  <SelectContent>
                    {locations?.map(loc => (
                      <SelectItem key={loc.id} value={loc.id}>
                        {loc.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={handleClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Create Account
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
