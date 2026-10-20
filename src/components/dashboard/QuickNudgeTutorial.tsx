// One-time "new way to nudge" tutorial for managers and up. Once per user (saved in onboarding_completions, tour 'quick_nudge_v2').
import { useEffect, useState } from 'react';
import { useLocation as useRouterLocation } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { useUserRole } from '@/hooks/useUserRole';
import { useIsMobile } from '@/hooks/use-mobile';
import { NUDGE_ROLES_CLIENT } from '@/lib/quickNudges';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import videoAsset from '@/assets/quick-nudge.mp4.asset.json';
import posterAsset from '@/assets/quick-nudge-poster.jpg.asset.json';

const TIP = 'quick_nudge_v2';

export function QuickNudgeTutorial() {
  const { user } = useAuth();
  const { role, loading } = useUserRole() as { role: string | null; loading: boolean };
  const isMobile = useIsMobile();
  const route = useRouterLocation();
  const [eligible, setEligible] = useState(false);
  const [open, setOpen] = useState(false);
  const [videoFailed, setVideoFailed] = useState(false);
  const [posterFailed, setPosterFailed] = useState(false);

  // 1) Has this person already seen it (any device)?
  useEffect(() => {
    if (!user?.id || loading || !role || !NUDGE_ROLES_CLIENT.includes(role)) return;
    let cancelled = false;
    supabase.from('onboarding_completions').select('id').eq('user_id', user.id).eq('tour_id', TIP).maybeSingle()
      .then(({ data, error }) => { if (!cancelled && !error && !data) setEligible(true); });
    return () => { cancelled = true; };
  }, [user?.id, role, loading]);

  // 2) Wait until the Dash is idle: on the Dash, no other dialog/tour/punch clock open.
  useEffect(() => {
    if (!eligible || open) return;
    const onDash = route.pathname === '/' || route.pathname === '/dashboard';
    if (!onDash) return;
    const busy = () => !!document.querySelector('[role="dialog"],[role="alertdialog"],.react-joyride__overlay,[data-punch-clock]');
    let calm = 0;
    const t = window.setInterval(() => {
      calm = busy() ? 0 : calm + 1;
      if (calm >= 3) { window.clearInterval(t); setOpen(true); }
    }, 1000);
    return () => window.clearInterval(t);
  }, [eligible, open, route.pathname]);

  // 3) Seen the moment it opens, so any way of closing counts.
  useEffect(() => {
    if (!open || !user?.id) return;
    setEligible(false);
    supabase.from('onboarding_completions').upsert({ user_id: user.id, tour_id: TIP, skipped: false }, { onConflict: 'user_id,tour_id' }).then(() => {});
  }, [open, user?.id]);

  const hideMedia = videoFailed && posterFailed;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-center">Here is the new and cleaner way to nudge!</DialogTitle>
          <DialogDescription className="sr-only">A short video showing where Nudge lives now.</DialogDescription>
        </DialogHeader>
        {!hideMedia && (
          <div className="flex justify-center">
            {!videoFailed ? (
              <video
                src={videoAsset.url}
                poster={posterAsset.url}
                autoPlay muted loop playsInline
                onError={() => setVideoFailed(true)}
                className="max-h-[60vh] w-auto rounded-[18px]"
              />
            ) : (
              <img src={posterAsset.url} alt="" onError={() => setPosterFailed(true)} className="max-h-[60vh] w-auto rounded-[18px]" />
            )}
          </div>
        )}
        <p className="text-center text-[15px] font-medium">
          {isMobile ? "Swipe up the dock, open Nudge, and tap what's slipping." : 'Nudge now lives at the top of your Dash.'}
        </p>
        <Button className="w-full" onClick={() => setOpen(false)}>Got it</Button>
      </DialogContent>
    </Dialog>
  );
}
