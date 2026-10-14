import { useEffect, useState } from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useAuth } from '@/lib/auth';
import { syncChromeColor } from '@/utils/syncChrome';

// Test mode: only these emails see the invite. Empty the list to show everyone.
const TEST_ONLY_EMAILS: string[] = [];
const SEEN_KEY = 'spookified-invite-seen-v1';

export function SpookifiedInvite() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!user?.email) return;
    const email = user.email.toLowerCase();
    if (TEST_ONLY_EMAILS.length && !TEST_ONLY_EMAILS.includes(email)) return;
    if (localStorage.getItem(SEEN_KEY)) return;
    if (document.documentElement.getAttribute('data-theme') === 'spookified') return;
    const t = window.setTimeout(() => setOpen(true), 1200);
    return () => window.clearTimeout(t);
  }, [user?.email]);

  const close = () => {
    localStorage.setItem(SEEN_KEY, new Date().toISOString());
    setOpen(false);
  };

  const tryIt = () => {
    localStorage.setItem('app-theme', 'spookified');
    document.documentElement.setAttribute('data-theme', 'spookified');
    syncChromeColor();
    close();
  };

  return (
    <AlertDialog open={open} onOpenChange={(o) => { if (!o) close(); }}>
      <AlertDialogContent className="spooky-invite max-w-sm">
        <AlertDialogHeader>
          <div className="text-4xl text-center" aria-hidden>🎃🦇</div>
          <AlertDialogTitle className="spooky-invite-title text-center">Try the new Spookified theme!</AlertDialogTitle>
          <AlertDialogDescription className="text-center">
            Fog, bats, a full moon and a little lightning for Halloween. You can switch back anytime in Settings.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="flex-col gap-2 sm:flex-col sm:space-x-0">
          <AlertDialogAction onClick={tryIt} className="spooky-invite-cta w-full">Make it spooky</AlertDialogAction>
          <AlertDialogCancel onClick={close} className="spooky-invite-skip w-full mt-0">No thanks</AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
