import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Bell, Check, Clock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";

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
  const [audioUnlocked, setAudioUnlocked] = useState(false);
  const [countdown, setCountdown] = useState(30);
  const [isSnoozed, setIsSnoozed] = useState(false);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const countdownRef = useRef<NodeJS.Timeout | null>(null);
  const snoozeTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const snoozedAlarmRef = useRef<AlarmTask | null>(null);
  const alarmLoopRef = useRef<NodeJS.Timeout | null>(null);
  const alarmLoopTokenRef = useRef(0);

  const getAudioContext = () => {
    if (!audioCtxRef.current) {
      const Ctx = window.AudioContext || (window as any).webkitAudioContext;
      audioCtxRef.current = new Ctx();
    }
    return audioCtxRef.current;
  };

  // Unlock audio on first user interaction (autoplay policies can block alarms)
  useEffect(() => {
    const unlock = async () => {
      try {
        const ctx = getAudioContext();
        if (ctx.state === "suspended") {
          await ctx.resume();
        }
        setAudioUnlocked(true);
      } catch (e) {
        console.log("Audio could not be unlocked", e);
      }
    };

    const onFirst = () => {
      void unlock();
    };

    window.addEventListener("pointerdown", onFirst, { once: true });
    window.addEventListener("keydown", onFirst, { once: true });

    return () => {
      window.removeEventListener("pointerdown", onFirst);
      window.removeEventListener("keydown", onFirst);
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

        // If we're already showing this exact alarm interval, don't start another loop.
        if (
          activeAlarm?.id === task.id &&
          activeAlarm?.interval_key === intervalKey &&
          isVisible
        ) {
          return;
        }

        // Check if already completed
        const { data: completion, error: completionError } = await supabase
          .from('alarm_task_completions')
          .select('id')
          .eq('task_id', task.id)
          .eq('interval_key', intervalKey)
          .maybeSingle();

        if (completionError) {
          console.error('Error checking alarm completion:', completionError);
          return;
        }

        if (!completion) {
          setActiveAlarm({
            id: task.id,
            title: task.title,
            description: task.description,
            accent_color: task.accent_color || '#8B5CF6',
            interval_key: intervalKey,
          });
          setIsVisible(true);
          startAlarmLoop(task.title);
          
          // Calculate remaining time (30s from trigger)
          const elapsed = (now.getTime() - triggeredAt.getTime()) / 1000;
          const remaining = Math.max(30 - elapsed, 5);
          setCountdown(Math.ceil(remaining));
          startCountdown(remaining);
          
          timeoutRef.current = setTimeout(() => {
            handleSnooze();
          }, remaining * 1000);
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

              // If we're already showing this exact alarm interval, don't start another loop.
              if (
                activeAlarm?.id === task.id &&
                activeAlarm?.interval_key === intervalKey &&
                isVisible
              ) {
                return;
              }
              
              setActiveAlarm({
                id: task.id,
                title: task.title,
                description: task.description,
                accent_color: task.accent_color || '#8B5CF6',
                interval_key: intervalKey,
              });
              setIsVisible(true);
              
               // Play alarm sound loop
               startAlarmLoop(task.title);
              
              // Auto-dismiss 30s after trigger (with a minimum of 5s)
              if (timeoutRef.current) {
                clearTimeout(timeoutRef.current);
              }
              const remaining = Math.max(30 - secondsSinceTrigger, 5);
              setCountdown(Math.ceil(remaining));
              startCountdown(remaining);
              
              timeoutRef.current = setTimeout(() => {
                handleSnooze();
              }, remaining * 1000);
            }
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
      stopAlarmLoop();
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      if (countdownRef.current) {
        clearInterval(countdownRef.current);
      }
      if (snoozeTimeoutRef.current) {
        clearTimeout(snoozeTimeoutRef.current);
      }
    };
  }, [locationId]);

  const startCountdown = (seconds: number) => {
    if (countdownRef.current) {
      clearInterval(countdownRef.current);
    }
    setCountdown(Math.ceil(seconds));
    countdownRef.current = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          if (countdownRef.current) clearInterval(countdownRef.current);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  const playAlarmBurst = async () => {
    try {
      const audioContext = getAudioContext();
      if (audioContext.state === "suspended") {
        await audioContext.resume();
      }

      // If we still couldn't unlock audio, bail quietly.
      if (audioContext.state !== "running") {
        console.log("Audio context is not running; alarm sound suppressed");
        return;
      }

      const playBeep = (time: number, freq: number, duration: number = 0.2) => {
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();

        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);

        oscillator.type = "square";
        oscillator.frequency.setValueAtTime(freq, audioContext.currentTime + time);

        // Louder, but start from 0 to avoid clicks
        gainNode.gain.setValueAtTime(0.001, audioContext.currentTime + time);
        gainNode.gain.exponentialRampToValueAtTime(0.6, audioContext.currentTime + time + 0.01);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + time + duration);

        oscillator.start(audioContext.currentTime + time);
        oscillator.stop(audioContext.currentTime + time + duration);
      };

      // Alarm pattern - 1 cycle only (~1.2 seconds)
      playBeep(0, 880, 0.15);
      playBeep(0.2, 660, 0.15);
      playBeep(0.4, 880, 0.15);
      playBeep(0.6, 660, 0.15);
      playBeep(0.8, 988, 0.25);
    } catch (e) {
      console.log("Could not play alarm sound:", e);
    }
  };

  // Fallback to browser speech synthesis
  const speakWithBrowserTTS = (title: string): Promise<void> => {
    return new Promise((resolve) => {
      if (!('speechSynthesis' in window)) {
        resolve();
        return;
      }
      
      const utterance = new SpeechSynthesisUtterance(title);
      utterance.rate = 1.0;
      utterance.pitch = 1.0;
      utterance.volume = 1.0;
      utterance.onend = () => resolve();
      utterance.onerror = () => resolve();
      
      window.speechSynthesis.speak(utterance);
    });
  };

  const speakAlarmName = async (title: string): Promise<void> => {
    try {
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/elevenlabs-alarm-tts`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
            Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          },
          body: JSON.stringify({ text: title }),
        }
      );

      if (!response.ok) {
        console.log("TTS request failed, using browser fallback");
        await speakWithBrowserTTS(title);
        return;
      }

      const data = await response.json();
      if (!data.audioContent) {
        await speakWithBrowserTTS(title);
        return;
      }

      // Play using data URI
      const audioUrl = `data:audio/mpeg;base64,${data.audioContent}`;
      const audio = new Audio(audioUrl);
      
      return new Promise((resolve) => {
        audio.onended = () => resolve();
        audio.onerror = () => resolve();
        audio.play().catch(() => resolve());
      });
    } catch (e) {
      console.log("TTS error, using browser fallback:", e);
      await speakWithBrowserTTS(title);
    }
  };

  const playAlarmSequence = async (title: string) => {
    // Play beep once
    await playAlarmBurst();
    
    // Wait for beep to finish (~1.2 seconds)
    await new Promise((r) => setTimeout(r, 1300));
    
    // Speak the alarm name
    await speakAlarmName(title);
    
    // Small pause
    await new Promise((r) => setTimeout(r, 300));
    
    // Play beep again
    await playAlarmBurst();
  };

  const startAlarmLoop = (title?: string) => {
    // Stop any existing loop
    stopAlarmLoop();

    // Token cancels any in-flight async sequences from previous runs
    const token = ++alarmLoopTokenRef.current;

    const effectiveTitle = title ?? activeAlarm?.title;
    if (!effectiveTitle) return;

    let loopCount = 0;
    const maxLoops = 2;

    // Play the sequence up to maxLoops times
    const runSequence = async () => {
      // cancelled
      if (alarmLoopTokenRef.current !== token) return;

      loopCount++;
      await playAlarmSequence(effectiveTitle);

      // cancelled
      if (alarmLoopTokenRef.current !== token) return;

      // Only continue if we haven't reached max loops
      if (loopCount < maxLoops) {
        alarmLoopRef.current = setTimeout(() => {
          runSequence();
        }, 2000);
      }
    };

    runSequence();
  };

  const stopAlarmLoop = () => {
    // Invalidate any running async sequence immediately
    alarmLoopTokenRef.current++;
    if (alarmLoopRef.current) {
      clearTimeout(alarmLoopRef.current);
      alarmLoopRef.current = null;
    }
  };

  const handleComplete = async () => {
    if (!activeAlarm) return;

    setIsCompleting(true);
    try {
      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError) throw userError;
      if (!userData.user) {
        toast.error("Please sign in to complete this task");
        return;
      }

      const { error } = await supabase
        .from("alarm_task_completions")
        .insert({
          task_id: activeAlarm.id,
          interval_key: activeAlarm.interval_key,
          completed_by: userData.user.id,
        });

      if (error) throw error;

      toast.success("Task completed!");
      handleDismissComplete();
      onComplete?.();
    } catch (error: any) {
      console.error("Error completing alarm task:", error);
      toast.error(error?.message ? `Failed to complete task: ${error.message}` : "Failed to complete task");
    } finally {
      setIsCompleting(false);
    }
  };

  const handleSnooze = () => {
    // Store the alarm for snooze
    snoozedAlarmRef.current = activeAlarm;
    setIsSnoozed(true);
    setIsVisible(false);
    stopAlarmLoop();
    
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    if (countdownRef.current) {
      clearInterval(countdownRef.current);
    }
    
    // Clear any existing snooze timer
    if (snoozeTimeoutRef.current) {
      clearTimeout(snoozeTimeoutRef.current);
    }
    
    // Show again in 2 minutes
    snoozeTimeoutRef.current = setTimeout(() => {
      if (snoozedAlarmRef.current) {
        setActiveAlarm(snoozedAlarmRef.current);
        setIsVisible(true);
        setIsSnoozed(false);
         startAlarmLoop(snoozedAlarmRef.current.title);
        setCountdown(30);
        startCountdown(30);
        
        // Auto-dismiss after 30 seconds
        timeoutRef.current = setTimeout(() => {
          handleSnooze();
        }, 30000);
      }
    }, 120000); // 2 minutes
    
    setTimeout(() => {
      setActiveAlarm(null);
    }, 300);
    
    toast.info("Snoozed for 2 minutes", { duration: 2000 });
  };

  const handleDismissComplete = () => {
    // Full dismiss after task is completed - no snooze
    setIsVisible(false);
    setIsSnoozed(false);
    snoozedAlarmRef.current = null;
    stopAlarmLoop();
    
    if (snoozeTimeoutRef.current) {
      clearTimeout(snoozeTimeoutRef.current);
    }
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    if (countdownRef.current) {
      clearInterval(countdownRef.current);
    }
    
    setTimeout(() => {
      setActiveAlarm(null);
    }, 300);
  };

  if (!activeAlarm) return null;

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
          className="fixed inset-0 z-[100] flex items-center justify-center p-4"
          onClick={handleSnooze}
        >
          {/* Backdrop with animated gradient */}
          <div className="absolute inset-0 bg-black/70 backdrop-blur-xl" />
          
          {/* Pulsing ring effect */}
          <motion.div
            className="absolute inset-0 flex items-center justify-center pointer-events-none"
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1.5, opacity: 0 }}
            transition={{ duration: 2, repeat: Infinity, ease: "easeOut" }}
          >
            <div 
              className="w-64 h-64 rounded-full"
              style={{ 
                border: `4px solid ${activeAlarm.accent_color}`,
                boxShadow: `0 0 60px ${activeAlarm.accent_color}60`
              }}
            />
          </motion.div>
          
          {/* Main Card */}
          <motion.div
            initial={{ scale: 0.9, y: 20 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.9, y: 20 }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
            className="relative w-full max-w-xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Glass card */}
            <div 
              className="relative overflow-hidden rounded-3xl backdrop-blur-2xl border"
              style={{ 
                background: `linear-gradient(145deg, ${activeAlarm.accent_color}15, ${activeAlarm.accent_color}05)`,
                borderColor: `${activeAlarm.accent_color}40`,
                boxShadow: `0 25px 50px -12px ${activeAlarm.accent_color}40, 0 0 0 1px ${activeAlarm.accent_color}20 inset`
              }}
            >
              {/* Top accent bar */}
              <div 
                className="h-1.5"
                style={{ background: `linear-gradient(90deg, ${activeAlarm.accent_color}, ${activeAlarm.accent_color}80)` }}
              />
              
              <div className="p-10 space-y-8">
                {/* Icon - larger circular with animated pulse */}
                <div className="flex justify-center">
                  <div className="relative">
                    <motion.div
                      animate={{ scale: [1, 1.08, 1] }}
                      transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut" }}
                      className="w-32 h-32 rounded-full flex items-center justify-center"
                      style={{ 
                        background: `radial-gradient(circle, ${activeAlarm.accent_color}40 0%, ${activeAlarm.accent_color}15 70%, transparent 100%)`,
                        boxShadow: `0 0 60px ${activeAlarm.accent_color}50, inset 0 0 30px ${activeAlarm.accent_color}20`
                      }}
                    >
                      <div 
                        className="w-24 h-24 rounded-full flex items-center justify-center"
                        style={{ 
                          background: `linear-gradient(145deg, ${activeAlarm.accent_color}, ${activeAlarm.accent_color}cc)`,
                          boxShadow: `0 8px 30px ${activeAlarm.accent_color}60`
                        }}
                      >
                        <Bell className="h-12 w-12 text-white" />
                      </div>
                    </motion.div>
                    
                    {/* Countdown badge */}
                    <motion.div 
                      animate={{ scale: [1, 1.1, 1] }}
                      transition={{ duration: 1, repeat: Infinity }}
                      className="absolute -top-2 -right-2 w-12 h-12 rounded-full flex items-center justify-center text-lg font-bold text-white shadow-lg"
                      style={{ backgroundColor: activeAlarm.accent_color }}
                    >
                      {countdown}
                    </motion.div>
                  </div>
                </div>
                
                {/* Content */}
                <div className="text-center space-y-4">
                  <h2 className="text-3xl font-bold text-white tracking-tight">
                    {activeAlarm.title}
                  </h2>
                  {activeAlarm.description && (
                    <p className="text-white/70 text-base leading-relaxed max-w-sm mx-auto">
                      {activeAlarm.description}
                    </p>
                  )}
                  <div 
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold"
                    style={{ 
                      backgroundColor: `${activeAlarm.accent_color}25`, 
                      color: activeAlarm.accent_color 
                    }}
                  >
                    <Clock className="h-4 w-4" />
                    RECURRING TASK
                  </div>
                </div>
                
                {/* Actions */}
                <div className="flex gap-4">
                  <Button
                    variant="outline"
                    size="lg"
                    className="flex-1 gap-3 h-16 text-lg rounded-2xl bg-white/5 border-white/20 text-white hover:bg-white/10 hover:text-white"
                    onClick={handleSnooze}
                  >
                    <Clock className="h-6 w-6" />
                    Snooze
                  </Button>
                  <Button
                    size="lg"
                    className="flex-1 gap-3 h-16 text-lg rounded-2xl text-white border-0 shadow-lg"
                    onClick={handleComplete}
                    disabled={isCompleting}
                    style={{ 
                      background: `linear-gradient(145deg, ${activeAlarm.accent_color}, ${activeAlarm.accent_color}dd)`,
                      boxShadow: `0 10px 30px -5px ${activeAlarm.accent_color}60`
                    }}
                  >
                    <Check className="h-6 w-6" />
                    {isCompleting ? 'Saving...' : 'Complete'}
                  </Button>
                </div>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
