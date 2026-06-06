import { motion } from 'framer-motion';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface SwipePagerHintProps {
  /** Which page the user is currently on */
  page: 'punch' | 'dashboard';
  isDayMode: boolean;
  onDotClick?: (target: 'punch' | 'dashboard') => void;
}

/**
 * Bottom-center pagination dots + animated "swipe for ___" hint.
 * Shared between PunchClock and ManagerDashboardOverlay for visual continuity.
 */
export function SwipePagerHint({ page, isDayMode, onDotClick }: SwipePagerHintProps) {
  const isPunch = page === 'punch';
  const muted = isDayMode ? 'text-neutral-500' : 'text-neutral-400';
  const dotActive = isDayMode ? 'bg-neutral-800' : 'bg-white';
  const dotIdle = isDayMode ? 'bg-neutral-300' : 'bg-white/30';

  // On punch page, swipe LEFT goes to dashboard. On dashboard, swipe RIGHT goes back to punch.
  const hint = isPunch ? (
    <>
      <span>Swipe for Dashboard</span>
      <motion.span
        animate={{ x: [0, -6, 0] }}
        transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
      >
        <ChevronLeft className="h-4 w-4" />
      </motion.span>
    </>
  ) : (
    <>
      <motion.span
        animate={{ x: [0, 6, 0] }}
        transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
      >
        <ChevronRight className="h-4 w-4" />
      </motion.span>
      <span>Swipe for Punch Clock</span>
    </>
  );

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[102] flex flex-col items-center gap-2 pointer-events-none">
      <div className={`flex items-center gap-2 text-xs font-medium tracking-wide ${muted}`}>
        {hint}
      </div>
      <div className="flex items-center gap-2 pointer-events-auto">
        <button
          aria-label="Go to punch clock"
          onClick={() => onDotClick?.('punch')}
          className={`h-2 rounded-full transition-all ${isPunch ? `w-6 ${dotActive}` : `w-2 ${dotIdle}`}`}
        />
        <button
          aria-label="Go to dashboard"
          onClick={() => onDotClick?.('dashboard')}
          className={`h-2 rounded-full transition-all ${!isPunch ? `w-6 ${dotActive}` : `w-2 ${dotIdle}`}`}
        />
      </div>
    </div>
  );
}
