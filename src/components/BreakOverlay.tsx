import { useState, useEffect } from 'react';
import { X, Coffee } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/button';

export default function BreakOverlay() {
  const { user } = useAuth();
  const [breakInfo, setBreakInfo] = useState<{ remaining: number; duration: number } | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setLoading(false);
      return;
    }

    const checkBreakStatus = async () => {
      try {
        // Get today's punches for this user
        const today = new Date().toISOString().split('T')[0];
        const { data: punches, error } = await supabase
          .from('time_punches')
          .select('*')
          .eq('user_id', user.id)
          .gte('punch_time', today)
          .order('punch_time', { ascending: false });

        if (error) throw error;

        // Find the last punch
        const lastPunch = punches?.[0];
        
        if (lastPunch?.punch_type === 'break_start') {
          const breakDuration = lastPunch.notes?.includes('30 minute') ? 30 : 10;
          const breakStartTime = new Date(lastPunch.punch_time);
          const breakEndTime = new Date(breakStartTime.getTime() + breakDuration * 60000);
          const now = new Date();
          const remainingMs = breakEndTime.getTime() - now.getTime();

          if (remainingMs > 0) {
            setBreakInfo({
              remaining: Math.ceil(remainingMs / 1000),
              duration: breakDuration
            });
          } else {
            setBreakInfo(null);
          }
        } else {
          setBreakInfo(null);
        }
      } catch (error) {
        console.error('Error checking break status:', error);
      } finally {
        setLoading(false);
      }
    };

    checkBreakStatus();
    
    // Check every 30 seconds
    const interval = setInterval(checkBreakStatus, 30000);
    return () => clearInterval(interval);
  }, [user]);

  // Update countdown every second
  useEffect(() => {
    if (!breakInfo || dismissed) return;

    const timer = setInterval(() => {
      setBreakInfo(prev => {
        if (!prev || prev.remaining <= 1) {
          return null;
        }
        return { ...prev, remaining: prev.remaining - 1 };
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [breakInfo, dismissed]);

  if (loading || !breakInfo || dismissed) return null;

  const minutes = Math.floor(breakInfo.remaining / 60);
  const seconds = breakInfo.remaining % 60;

  return (
    <div className="fixed inset-0 z-50 bg-gradient-to-br from-amber-500 via-orange-500 to-amber-600 flex flex-col items-center justify-center p-6 text-white">
      {/* Dismiss button */}
      <Button
        variant="ghost"
        size="icon"
        className="absolute top-4 right-4 text-white/70 hover:text-white hover:bg-white/10"
        onClick={() => setDismissed(true)}
      >
        <X className="h-6 w-6" />
      </Button>

      {/* Main content */}
      <div className="text-center space-y-8 animate-fade-in">
        <Coffee className="h-24 w-24 mx-auto opacity-90" />
        
        <div className="space-y-2">
          <h1 className="text-4xl md:text-5xl font-bold">Enjoy Your Break!</h1>
          <p className="text-xl opacity-90">Take some time to relax and recharge</p>
        </div>

        <div className="bg-white/20 backdrop-blur-sm rounded-2xl px-8 py-6 inline-block">
          <p className="text-sm uppercase tracking-wide opacity-80 mb-2">Time Remaining</p>
          <p className="text-6xl md:text-7xl font-mono font-bold">
            {minutes}:{seconds.toString().padStart(2, '0')}
          </p>
        </div>

        <p className="text-lg opacity-80 max-w-sm mx-auto">
          {breakInfo.duration === 30 
            ? "You've earned this meal break. Step away and enjoy!"
            : "Quick rest! Stretch, hydrate, and breathe."}
        </p>
      </div>

      {/* Decorative elements */}
      <div className="absolute bottom-8 text-center opacity-60">
        <p className="text-sm">Tap the X to continue using the app</p>
      </div>
    </div>
  );
}