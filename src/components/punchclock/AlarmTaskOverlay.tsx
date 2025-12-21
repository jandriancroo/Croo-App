import { useState, useEffect, useRef } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlarmClock, Check, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface AlarmTask {
  id: string;
  title: string;
  description?: string;
  accent_color: string;
  interval_key: string;
}

interface AlarmTaskOverlayProps {
  locationId: string;
  onComplete?: () => void;
}

export function AlarmTaskOverlay({ locationId, onComplete }: AlarmTaskOverlayProps) {
  const [activeAlarm, setActiveAlarm] = useState<AlarmTask | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [isCompleting, setIsCompleting] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Create alarm sound on mount
  useEffect(() => {
    // Create audio context for alarm sound
    const createAlarmSound = () => {
      try {
        const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();
        
        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);
        
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(880, audioContext.currentTime);
        gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
        
        // Pulse the alarm
        const pulseAlarm = () => {
          if (!activeAlarm) return;
          oscillator.frequency.setValueAtTime(880, audioContext.currentTime);
          oscillator.frequency.setValueAtTime(660, audioContext.currentTime + 0.1);
          oscillator.frequency.setValueAtTime(880, audioContext.currentTime + 0.2);
        };
        
        return { audioContext, oscillator, gainNode, pulseAlarm };
      } catch (e) {
        console.log('Audio context not available');
        return null;
      }
    };

    return () => {
      // Cleanup
    };
  }, []);

  // Check for recently triggered alarms on mount and subscribe to updates
  useEffect(() => {
    if (!locationId) return;

    // Check for any alarms triggered in the last 30 seconds on page load
    const checkPendingAlarms = async () => {
      const thirtySecondsAgo = new Date(Date.now() - 30000).toISOString();
      
      const { data: pendingTasks } = await supabase
        .from('temporary_tasks')
        .select('*')
        .eq('location_id', locationId)
        .eq('task_style', 'alarm')
        .eq('show_on_punch_clock', true)
        .gte('last_triggered_at', thirtySecondsAgo)
        .order('last_triggered_at', { ascending: false })
        .limit(1);

      if (pendingTasks && pendingTasks.length > 0) {
        const task = pendingTasks[0];
        const triggeredAt = new Date(task.last_triggered_at);
        const now = new Date();
        const intervalKey = `${triggeredAt.toISOString().split('T')[0]}_${String(triggeredAt.getHours()).padStart(2, '0')}${String(triggeredAt.getMinutes()).padStart(2, '0')}`;

        // Check if already completed
        const { data: completion } = await supabase
          .from('alarm_task_completions')
          .select('id')
          .eq('task_id', task.id)
          .eq('interval_key', intervalKey)
          .single();

        if (!completion) {
          setActiveAlarm({
            id: task.id,
            title: task.title,
            description: task.description,
            accent_color: task.accent_color || '#8B5CF6',
            interval_key: intervalKey,
          });
          setIsVisible(true);
          playAlarmSound();
          
          // Calculate remaining time (30s from trigger)
          const elapsed = (now.getTime() - triggeredAt.getTime()) / 1000;
          const remaining = Math.max(30 - elapsed, 5) * 1000;
          
          timeoutRef.current = setTimeout(() => {
            handleDismiss();
          }, remaining);
        }
      }
    };

    checkPendingAlarms();

    const channel = supabase
      .channel('alarm-tasks-overlay')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'temporary_tasks',
          filter: `location_id=eq.${locationId}`,
        },
        async (payload: any) => {
          const task = payload.new;
          
          // Check if this is an alarm task that was just triggered AND has punch clock display enabled
          if (task.task_style === 'alarm' && task.last_triggered_at && task.show_on_punch_clock) {
            const triggeredAt = new Date(task.last_triggered_at);
            const now = new Date();
            const secondsSinceTrigger = (now.getTime() - triggeredAt.getTime()) / 1000;
            
            // Show if triggered within last 30 seconds (realtime events can arrive late)
            if (secondsSinceTrigger <= 30) {
              const intervalKey = `${triggeredAt.toISOString().split('T')[0]}_${String(triggeredAt.getHours()).padStart(2, '0')}${String(triggeredAt.getMinutes()).padStart(2, '0')}`;
              
              setActiveAlarm({
                id: task.id,
                title: task.title,
                description: task.description,
                accent_color: task.accent_color || '#8B5CF6',
                interval_key: intervalKey,
              });
              setIsVisible(true);
              
              // Play alarm sound
              playAlarmSound();
              
              // Auto-dismiss 30s after trigger (with a minimum of 5s)
              if (timeoutRef.current) {
                clearTimeout(timeoutRef.current);
              }
              const remaining = Math.max(30 - secondsSinceTrigger, 5) * 1000;
              timeoutRef.current = setTimeout(() => {
                handleDismiss();
              }, remaining);
            }
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [locationId]);

  const playAlarmSound = () => {
    try {
      // Create a simple beep pattern using Web Audio API
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      
      const playBeep = (time: number, freq: number) => {
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();
        
        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);
        
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(freq, audioContext.currentTime + time);
        gainNode.gain.setValueAtTime(0.3, audioContext.currentTime + time);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + time + 0.15);
        
        oscillator.start(audioContext.currentTime + time);
        oscillator.stop(audioContext.currentTime + time + 0.15);
      };
      
      // Play alarm pattern
      playBeep(0, 880);
      playBeep(0.2, 660);
      playBeep(0.4, 880);
      playBeep(0.6, 660);
      playBeep(0.8, 880);
    } catch (e) {
      console.log('Could not play alarm sound');
    }
  };

  const handleComplete = async () => {
    if (!activeAlarm) return;
    
    setIsCompleting(true);
    try {
      // Record completion with "Store" as the completer
      const { error } = await supabase
        .from('alarm_task_completions')
        .insert({
          task_id: activeAlarm.id,
          interval_key: activeAlarm.interval_key,
          completed_by: null, // null indicates "Store" completion
        });

      if (error) throw error;

      toast.success('Task completed!');
      handleDismiss();
      onComplete?.();
    } catch (error: any) {
      console.error('Error completing alarm task:', error);
      toast.error('Failed to complete task');
    } finally {
      setIsCompleting(false);
    }
  };

  const handleDismiss = () => {
    setIsVisible(false);
    setTimeout(() => {
      setActiveAlarm(null);
    }, 300);
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
  };

  if (!activeAlarm || !isVisible) return null;

  return (
    <div 
      className={cn(
        "fixed inset-0 z-50 flex items-center justify-center p-4 transition-all duration-300",
        isVisible ? "opacity-100" : "opacity-0 pointer-events-none"
      )}
      onClick={handleDismiss}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-background/80 backdrop-blur-sm" />
      
      {/* Alarm Card */}
      <Card 
        className={cn(
          "relative max-w-md w-full shadow-2xl animate-pulse",
          "border-4"
        )}
        style={{ borderColor: activeAlarm.accent_color }}
        onClick={(e) => e.stopPropagation()}
      >
        <CardContent className="p-6 space-y-4">
          {/* Alarm Icon */}
          <div 
            className="w-16 h-16 rounded-full mx-auto flex items-center justify-center animate-bounce"
            style={{ backgroundColor: `${activeAlarm.accent_color}20` }}
          >
            <AlarmClock 
              className="h-8 w-8" 
              style={{ color: activeAlarm.accent_color }} 
            />
          </div>
          
          {/* Title */}
          <div className="text-center space-y-2">
            <h2 className="text-xl font-bold">{activeAlarm.title}</h2>
            {activeAlarm.description && (
              <p className="text-sm text-muted-foreground">{activeAlarm.description}</p>
            )}
            <div 
              className="inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium"
              style={{ 
                backgroundColor: `${activeAlarm.accent_color}20`, 
                color: activeAlarm.accent_color 
              }}
            >
              <AlarmClock className="h-3 w-3" />
              RECURRING TASK
            </div>
          </div>
          
          {/* Actions */}
          <div className="flex gap-3">
            <Button
              variant="outline"
              className="flex-1 gap-2"
              onClick={handleDismiss}
            >
              <X className="h-4 w-4" />
              Dismiss
            </Button>
            <Button
              className="flex-1 gap-2"
              onClick={handleComplete}
              disabled={isCompleting}
              style={{ 
                backgroundColor: activeAlarm.accent_color,
                borderColor: activeAlarm.accent_color 
              }}
            >
              <Check className="h-4 w-4" />
              {isCompleting ? 'Completing...' : 'Complete'}
            </Button>
          </div>
          
          <p className="text-xs text-center text-muted-foreground">
            Tap anywhere to dismiss • Auto-dismisses in 30s
          </p>
        </CardContent>
      </Card>
    </div>
  );
}