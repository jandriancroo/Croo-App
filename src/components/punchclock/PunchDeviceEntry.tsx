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
  isPairingDead,
} from '@/lib/punchDevicePairing';

export const PunchDeviceEntry = () => {
  const navigate = useNavigate();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);

  const goToKiosk = async () => {
    setBusy(true);
    const ok = await enterKioskMode('boot-restore');
    if (ok) {
      navigate('/punch-clock', { replace: true });
    } else if (isPairingDead()) {
      // Server says this device row is gone or was revoked — a new code is the
      // only way back.
      toast.error('This tablet was unpaired by a manager. Enter a new pairing code.');
      setDialogOpen(true);
      setBusy(false);
    } else {
      // Retryable (offline / hiccup). Do NOT ask for a new code.
      toast.error('Could not reach CrooHQ. Check the tablet’s internet and tap again.');
      setBusy(false);
    }
  };

  const handleLinkClick = () => {
    if (isPaired() && !isPairingDead()) {
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

  const label = isPaired() && !isPairingDead()
    ? ['Open Punch Clock', '(Paired Device)']
    : isPairingDead()
      ? ['Punch Clock Needs Re-Pairing', 'Click Here']
      : ['Setting Up a Punch Clock', 'Click Here'];

  return (
    <>
      <button
        type="button"
        onClick={handleLinkClick}
        disabled={busy}
        className="w-full flex items-center gap-3 px-4 py-3.5 text-left rounded-2xl border-2 border-primary/30 bg-primary/10 backdrop-blur-xl shadow-xl ring-1 ring-primary/20 hover:bg-primary/15 active:scale-[0.98] transition-all disabled:opacity-60"
      >
        <div className="flex-shrink-0 w-10 h-10 rounded-xl bg-primary flex items-center justify-center shadow-sm">
          <MonitorSmartphone className="h-5 w-5 text-primary-foreground" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold leading-tight text-foreground">{label[0]}</p>
          <p className="text-[11px] text-muted-foreground leading-tight">{label[1]}</p>
        </div>
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
