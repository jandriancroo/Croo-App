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
      // Create a loud, attention-grabbing alarm using Web Audio API
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      
      const playBeep = (time: number, freq: number, duration: number = 0.2) => {
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();
        
        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);
        
        oscillator.type = 'square'; // More attention-grabbing than sine
        oscillator.frequency.setValueAtTime(freq, audioContext.currentTime + time);
        gainNode.gain.setValueAtTime(0.5, audioContext.currentTime + time); // Louder
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + time + duration);
        
        oscillator.start(audioContext.currentTime + time);
        oscillator.stop(audioContext.currentTime + time + duration);
      };
      
      // Play loud alarm pattern - 3 cycles
      for (let cycle = 0; cycle < 3; cycle++) {
        const offset = cycle * 1.2;
        playBeep(offset + 0, 880, 0.15);
        playBeep(offset + 0.2, 660, 0.15);
        playBeep(offset + 0.4, 880, 0.15);
        playBeep(offset + 0.6, 660, 0.15);
        playBeep(offset + 0.8, 988, 0.25); // Higher note at end of each cycle
      }
    } catch (e) {
      console.log('Could not play alarm sound:', e);
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
        "fixed inset-0 z-50 flex items-center justify-center transition-all duration-300",
        isVisible ? "opacity-100" : "opacity-0 pointer-events-none"
      )}
      onClick={handleDismiss}
    >
      {/* Full screen colored backdrop */}
      <div 
        className="absolute inset-0 animate-pulse"
        style={{ backgroundColor: `${activeAlarm.accent_color}15` }}
      />
      <div className="absolute inset-0 bg-background/60 backdrop-blur-md" />
      
      {/* Large Alarm Card - takes up most of the screen */}
      <Card 
        className={cn(
          "relative w-[90vw] max-w-2xl min-h-[60vh] shadow-2xl flex flex-col justify-center",
          "border-8 rounded-3xl"
        )}
        style={{ 
          borderColor: activeAlarm.accent_color,
          boxShadow: `0 0 60px ${activeAlarm.accent_color}40, 0 0 120px ${activeAlarm.accent_color}20`
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <CardContent className="p-8 md:p-12 space-y-8 flex flex-col items-center justify-center">
          {/* Large Alarm Icon */}
          <div 
            className="w-32 h-32 md:w-40 md:h-40 rounded-full flex items-center justify-center animate-bounce"
            style={{ 
              backgroundColor: `${activeAlarm.accent_color}25`,
              boxShadow: `0 0 40px ${activeAlarm.accent_color}30`
            }}
          >
            <AlarmClock 
              className="h-16 w-16 md:h-20 md:w-20" 
              style={{ color: activeAlarm.accent_color }} 
            />
          </div>
          
          {/* Large Title */}
          <div className="text-center space-y-4">
            <h2 className="text-4xl md:text-5xl font-bold tracking-tight">{activeAlarm.title}</h2>
            {activeAlarm.description && (
              <p className="text-xl text-muted-foreground max-w-md">{activeAlarm.description}</p>
            )}
            <div 
              className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold"
              style={{ 
                backgroundColor: `${activeAlarm.accent_color}20`, 
                color: activeAlarm.accent_color 
              }}
            >
              <AlarmClock className="h-4 w-4" />
              RECURRING TASK
            </div>
          </div>
          
          {/* Large Action Buttons */}
          <div className="flex gap-4 w-full max-w-md">
            <Button
              variant="outline"
              size="lg"
              className="flex-1 gap-2 h-16 text-lg rounded-xl"
              onClick={handleDismiss}
            >
              <X className="h-6 w-6" />
              Dismiss
            </Button>
            <Button
              size="lg"
              className="flex-1 gap-2 h-16 text-lg rounded-xl text-white"
              onClick={handleComplete}
              disabled={isCompleting}
              style={{ 
                backgroundColor: activeAlarm.accent_color,
                borderColor: activeAlarm.accent_color 
              }}
            >
              <Check className="h-6 w-6" />
              {isCompleting ? 'Completing...' : 'Complete'}
            </Button>
          </div>
          
          <p className="text-sm text-center text-muted-foreground">
            Tap outside to dismiss • Auto-dismisses in 30s
          </p>
        </CardContent>
      </Card>
    </div>
  );
}