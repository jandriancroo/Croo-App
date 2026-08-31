/**
 * PWA pairing entry on the login screen.
 *
 * Two behaviors based on device state:
 *   - Not yet paired  → open code entry dialog
 *   - Already paired  → enter kiosk mode directly (no code re-entry)
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { MonitorSmartphone } from 'lucide-react';
import {
  isPaired,
  redeemPairingCode,
  enterKioskMode,
  isPairingBroken,
} from '@/lib/punchDevicePairing';

export const PunchDeviceEntry = () => {
  const navigate = useNavigate();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);

  const goToKiosk = async () => {
    setBusy(true);
    const ok = await enterKioskMode();
    if (ok) {
      navigate('/punch-clock', { replace: true });
    } else {
      toast.error('Could not restore paired session. Please re-pair the device.');
      setDialogOpen(true);
      setBusy(false);
    }
  };

  const handleLinkClick = () => {
    if (isPaired() && !isPairingBroken()) {
      goToKiosk();
    } else {
      setDialogOpen(true);
    }
  };

  const handleRedeem = async (e: React.FormEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!code.trim()) return;
    setBusy(true);
    try {
      const cred = await redeemPairingCode(code.trim().toUpperCase());
      toast.success(`Paired as "${cred.deviceName}" at ${cred.location.name}`);
      setDialogOpen(false);
      const ok = await enterKioskMode();
      if (ok) navigate('/punch-clock', { replace: true });
    } catch (err: any) {
      toast.error(err?.message || 'Pairing failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={handleLinkClick}
        disabled={busy}
        className="mt-3 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary transition-colors underline-offset-4 hover:underline"
      >
        <MonitorSmartphone className="h-3 w-3" />
        {isPaired() && !isPairingBroken()
          ? 'Open Punch Clock (Paired Device)'
          : isPairingBroken()
            ? 'Punch Clock Needs Re-Pairing — Click Here'
            : 'Setting Up a Punch Clock — Click Here'}
      </button>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Pair This Device</DialogTitle>
            <DialogDescription>
              Ask an org admin to generate a pairing code from Organization Settings → Punch Clock Devices. Codes are single-use and expire after 1 hour.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleRedeem} className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="pairing-code">Pairing Code</Label>
              <Input
                id="pairing-code"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="e.g. K7X9P2"
                autoComplete="off"
                autoCapitalize="characters"
                className="uppercase tracking-widest text-center text-lg font-mono"
                maxLength={12}
                required
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setDialogOpen(false)} disabled={busy}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy || !code.trim()}>
                {busy ? 'Pairing…' : 'Pair Device'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
};
