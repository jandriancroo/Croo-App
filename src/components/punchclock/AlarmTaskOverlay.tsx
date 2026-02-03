import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Bell, Check, Clock, Delete, ArrowLeft } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";
import { getAlarmIntervalKey, DEFAULT_TIMEZONE } from "@/utils/timezoneUtils";

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

const MAX_SNOOZES = 2;
const SNOOZE_DURATION_MS = 5 * 60 * 1000; // 5 minutes
const AUTO_DISMISS_SECONDS = 30;

export function AlarmTaskOverlay({ locationId, onComplete }: AlarmTaskOverlayProps) {
  const [activeAlarm, setActiveAlarm] = useState<AlarmTask | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [_audioUnlocked, setAudioUnlocked] = useState(false);
  const [countdown, setCountdown] = useState(AUTO_DISMISS_SECONDS);
  const [_isSnoozed, setIsSnoozed] = useState(false);
  const [timezone, setTimezone] = useState<string>(DEFAULT_TIMEZONE);
  
  // PIN entry state
  const [showPinEntry, setShowPinEntry] = useState(false);
  const [pin, setPin] = useState("");
  const [pinError, setPinError] = useState(false);
  const [validatingPin, setValidatingPin] = useState(false);
  
  // Snooze tracking - persisted per alarm interval
  const [snoozeCount, setSnoozeCount] = useState(0);
  const snoozeCountRef = useRef(0);

  // Avoid stale-closure bugs inside realtime/poll handlers
  const activeAlarmRef = useRef<AlarmTask | null>(null);
  const isVisibleRef = useRef(false);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const countdownRef = useRef<NodeJS.Timeout | null>(null);
  const snoozeTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const snoozedAlarmRef = useRef<AlarmTask | null>(null);
  const alarmLoopRef = useRef<NodeJS.Timeout | null>(null);
  const alarmLoopTokenRef = useRef(0);

  useEffect(() => {
    activeAlarmRef.current = activeAlarm;
  }, [activeAlarm]);

  useEffect(() => {
    isVisibleRef.current = isVisible;
  }, [isVisible]);
  
  useEffect(() => {
    snoozeCountRef.current = snoozeCount;
  }, [snoozeCount]);

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

  // Fetch timezone when locationId changes
  useEffect(() => {
    if (!locationId) return;
    
    const fetchTimezone = async () => {
      const { data: settings } = await supabase
        .from('location_settings')
        .select('timezone')
        .eq('location_id', locationId)
        .single();
      
      if (settings?.timezone) {
        setTimezone(settings.timezone);
      }
    };
    
    fetchTimezone();
  }, [locationId]);

  // Reset state when a new alarm appears
  const initializeAlarm = (task: any, intervalKey: string, remainingSeconds: number) => {
    // Check if this is a different alarm interval than what we had
    if (activeAlarmRef.current?.interval_key !== intervalKey) {
      // New alarm interval - reset snooze count
      setSnoozeCount(0);
      snoozeCountRef.current = 0;
    }
    
    setActiveAlarm({
      id: task.id,
      title: task.title,
      description: task.description,
      accent_color: task.accent_color || '#8B5CF6',
      interval_key: intervalKey,
    });
    setIsVisible(true);
    setShowPinEntry(false);
    setPin("");
    setPinError(false);
    startAlarmLoop(task.title);
    setCountdown(Math.ceil(remainingSeconds));
    startCountdown(remainingSeconds);
    
    // Set auto-action timeout based on snooze count
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      // If max snoozes reached, just keep showing (force PIN)
      if (snoozeCountRef.current >= MAX_SNOOZES) {
        // Don't auto-dismiss, keep visible - but stop countdown
        if (countdownRef.current) clearInterval(countdownRef.current);
        setCountdown(0);
      } else {
        handleSnooze();
      }
    }, remainingSeconds * 1000);
  };

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
        // Use timezone-aware interval key generation
        const intervalKey = getAlarmIntervalKey(triggeredAt, timezone);

        // If we're already showing this exact alarm interval, don't start another loop.
        if (
          activeAlarmRef.current?.id === task.id &&
          activeAlarmRef.current?.interval_key === intervalKey &&
          isVisibleRef.current
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
          // Calculate remaining time (30s from trigger)
          const elapsed = (now.getTime() - triggeredAt.getTime()) / 1000;
          const remaining = Math.max(AUTO_DISMISS_SECONDS - elapsed, 5);
          initializeAlarm(task, intervalKey, remaining);
        }
      }
    };

    checkPendingAlarms();

    // IMPORTANT: Realtime can occasionally miss events on kiosk devices.
    // Polling ensures the Punch Clock still alarms even if the UPDATE event is dropped.
    const pollRef = setInterval(() => {
      void checkPendingAlarms();
    }, 10_000);

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
            if (secondsSinceTrigger <= AUTO_DISMISS_SECONDS) {
              // Use timezone-aware interval key generation
              const intervalKey = getAlarmIntervalKey(triggeredAt, timezone);

              // If we're already showing this exact alarm interval, don't start another loop.
              if (
                activeAlarmRef.current?.id === task.id &&
                activeAlarmRef.current?.interval_key === intervalKey &&
                isVisibleRef.current
              ) {
                return;
              }
              
              const remaining = Math.max(AUTO_DISMISS_SECONDS - secondsSinceTrigger, 5);
              initializeAlarm(task, intervalKey, remaining);
            }
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
      clearInterval(pollRef);
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
  }, [locationId, timezone]);

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

  const _speakAlarmName = async (title: string): Promise<void> => {
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

  const playAlarmSequence = async (_title: string) => {
    // Play beep once
    await playAlarmBurst();
    
    // Wait for beep to finish (~1.2 seconds)
    await new Promise((r) => setTimeout(r, 1300));
    
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

  const handlePinDigit = (digit: string) => {
    if (pin.length < 4) {
      setPin(prev => prev + digit);
      setPinError(false);
    }
  };

  const handlePinBackspace = () => {
    setPin(prev => prev.slice(0, -1));
    setPinError(false);
  };

  const handlePinClear = () => {
    setPin("");
    setPinError(false);
  };

  const validateAndComplete = async () => {
    if (!activeAlarm || pin.length < 4) return;
    
    setValidatingPin(true);
    setPinError(false);
    
    try {
      // Look up user by PIN - check both default_location and all_locations_enabled
      const { data: profiles, error: profileError } = await supabase
        .from('profiles')
        .select('id, full_name, default_location_id, all_locations_enabled')
        .eq('employee_pin', pin)
        .eq('is_active', true);
      
      if (profileError) throw profileError;
      
      // Filter to users who can access this location
      const profile = profiles?.find(p => 
        p.default_location_id === locationId || p.all_locations_enabled
      );
      
      if (!profile) {
        setPinError(true);
        setPin("");
        return;
      }
      
      // Valid PIN - complete the task with this user
      const { error } = await supabase
        .from("alarm_task_completions")
        .insert({
          task_id: activeAlarm.id,
          interval_key: activeAlarm.interval_key,
          completed_by: profile.id,
        });

      if (error) throw error;

      const userName = profile.full_name || 'User';
      toast.success(`Task completed by ${userName}!`);
      handleDismissComplete();
      onComplete?.();
    } catch (error: any) {
      console.error("Error completing alarm task:", error);
      toast.error(error?.message ? `Failed to complete task: ${error.message}` : "Failed to complete task");
    } finally {
      setValidatingPin(false);
    }
  };

  const handleCompleteClick = () => {
    // Show PIN entry instead of immediately completing
    setShowPinEntry(true);
    setPin("");
    setPinError(false);
    
    // Stop auto-dismiss timer while entering PIN
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    if (countdownRef.current) {
      clearInterval(countdownRef.current);
    }
    stopAlarmLoop();
  };

  const handleBackFromPin = () => {
    setShowPinEntry(false);
    setPin("");
    setPinError(false);
    
    // Restart alarm loop and countdown if snoozes available
    if (activeAlarm) {
      startAlarmLoop(activeAlarm.title);
      
      if (snoozeCount < MAX_SNOOZES) {
        setCountdown(AUTO_DISMISS_SECONDS);
        startCountdown(AUTO_DISMISS_SECONDS);
        timeoutRef.current = setTimeout(() => {
          handleSnooze();
        }, AUTO_DISMISS_SECONDS * 1000);
      } else {
        // No snoozes left - keep showing
        setCountdown(0);
      }
    }
  };

  const handleSnooze = () => {
    // Check if max snoozes reached
    if (snoozeCountRef.current >= MAX_SNOOZES) {
      // Can't snooze anymore - keep visible
      toast.error("No snoozes remaining - please complete the task");
      return;
    }
    
    // Increment snooze count
    const newCount = snoozeCountRef.current + 1;
    setSnoozeCount(newCount);
    snoozeCountRef.current = newCount;
    
    // Store the alarm for snooze
    snoozedAlarmRef.current = activeAlarm;
    setIsSnoozed(true);
    setIsVisible(false);
    setShowPinEntry(false);
    setPin("");
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
    
    // Show again after snooze duration
    snoozeTimeoutRef.current = setTimeout(() => {
      if (snoozedAlarmRef.current) {
        setActiveAlarm(snoozedAlarmRef.current);
        setIsVisible(true);
        setIsSnoozed(false);
        setShowPinEntry(false);
        startAlarmLoop(snoozedAlarmRef.current.title);
        setCountdown(AUTO_DISMISS_SECONDS);
        startCountdown(AUTO_DISMISS_SECONDS);
        
        // Set auto-action based on remaining snoozes
        timeoutRef.current = setTimeout(() => {
          if (snoozeCountRef.current >= MAX_SNOOZES) {
            // No more snoozes - keep visible, force PIN
            if (countdownRef.current) clearInterval(countdownRef.current);
            setCountdown(0);
          } else {
            handleSnooze();
          }
        }, AUTO_DISMISS_SECONDS * 1000);
      }
    }, SNOOZE_DURATION_MS);
    
    setTimeout(() => {
      setActiveAlarm(null);
    }, 300);
    
    const snoozesRemaining = MAX_SNOOZES - newCount;
    toast.info(`Snoozed for 5 minutes (${snoozesRemaining} snooze${snoozesRemaining !== 1 ? 's' : ''} remaining)`, { duration: 3000 });
  };

  const handleDismissComplete = () => {
    // Full dismiss after task is completed - no snooze
    setIsVisible(false);
    setIsSnoozed(false);
    setShowPinEntry(false);
    setPin("");
    snoozedAlarmRef.current = null;
    stopAlarmLoop();
    
    // Reset snooze count for next alarm
    setSnoozeCount(0);
    snoozeCountRef.current = 0;
    
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

  const canSnooze = snoozeCount < MAX_SNOOZES;
  const snoozesRemaining = MAX_SNOOZES - snoozeCount;

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
          className="fixed inset-0 z-[100] flex items-center justify-center p-6"
          style={{ 
            background: `radial-gradient(ellipse at center, ${activeAlarm.accent_color}30 0%, rgba(0,0,0,0.95) 70%)`,
            backdropFilter: 'blur(20px)'
          }}
        >
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
                {showPinEntry ? (
                  // PIN Entry Screen
                  <>
                    <div className="flex items-center gap-4">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-white/70 hover:text-white hover:bg-white/10"
                        onClick={handleBackFromPin}
                      >
                        <ArrowLeft className="h-6 w-6" />
                      </Button>
                      <h2 className="text-2xl font-bold text-white">
                        Enter Your PIN
                      </h2>
                    </div>
                    
                    <div className="text-center space-y-2">
                      <p className="text-white/70">
                        Complete: <span className="text-white font-semibold">{activeAlarm.title}</span>
                      </p>
                    </div>
                    
                    {/* PIN Display */}
                    <motion.div 
                      className="flex justify-center gap-3"
                      animate={pinError ? { x: [0, -10, 10, -10, 10, 0] } : {}}
                      transition={{ duration: 0.4 }}
                    >
                      {[0, 1, 2, 3, 4, 5].map((i) => (
                        <div
                          key={i}
                          className={`w-4 h-4 rounded-full transition-all ${
                            pin.length > i 
                              ? pinError 
                                ? 'bg-red-500' 
                                : 'bg-white' 
                              : 'bg-white/20'
                          }`}
                        />
                      ))}
                    </motion.div>
                    
                    {pinError && (
                      <p className="text-center text-destructive text-sm">
                        Invalid PIN. Please try again.
                      </p>
                    )}
                    
                    {/* Numpad */}
                    <div className="grid grid-cols-3 gap-3 max-w-xs mx-auto">
                      {['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', '⌫'].map((key) => (
                        <Button
                          key={key}
                          variant="outline"
                          className={`h-16 text-2xl font-bold rounded-2xl transition-all ${
                            key === 'C' 
                              ? 'bg-red-500/20 border-red-500/40 text-red-400 hover:bg-red-500/30' 
                              : key === '⌫'
                              ? 'bg-white/5 border-white/20 text-white/70 hover:bg-white/10'
                              : 'bg-white/10 border-white/20 text-white hover:bg-white/20'
                          }`}
                          onClick={() => {
                            if (key === 'C') handlePinClear();
                            else if (key === '⌫') handlePinBackspace();
                            else handlePinDigit(key);
                          }}
                          disabled={validatingPin}
                        >
                          {key === '⌫' ? <Delete className="h-6 w-6" /> : key}
                        </Button>
                      ))}
                    </div>
                    
                    {/* Submit Button */}
                    <Button
                      size="lg"
                      className="w-full gap-3 h-16 text-lg rounded-2xl text-white border-0 shadow-lg disabled:opacity-50"
                      onClick={validateAndComplete}
                      disabled={pin.length < 4 || validatingPin}
                      style={{ 
                        background: pin.length >= 4 
                          ? `linear-gradient(145deg, ${activeAlarm.accent_color}, ${activeAlarm.accent_color}dd)`
                          : 'rgba(255,255,255,0.1)',
                        boxShadow: pin.length >= 4 
                          ? `0 10px 30px -5px ${activeAlarm.accent_color}60`
                          : 'none'
                      }}
                    >
                      <Check className="h-6 w-6" />
                      {validatingPin ? 'Verifying...' : 'Complete Task'}
                    </Button>
                  </>
                ) : (
                  // Main Alarm Screen
                  <>
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
                        {countdown > 0 && (
                          <motion.div 
                            animate={{ scale: [1, 1.1, 1] }}
                            transition={{ duration: 1, repeat: Infinity }}
                            className="absolute -top-2 -right-2 w-12 h-12 rounded-full flex items-center justify-center text-lg font-bold text-white shadow-lg"
                            style={{ backgroundColor: activeAlarm.accent_color }}
                          >
                            {countdown}
                          </motion.div>
                        )}
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
                        {!canSnooze ? 'COMPLETE REQUIRED' : 'RECURRING TASK'}
                      </div>
                      
                      {/* Snooze indicator */}
                      {canSnooze && (
                        <p className="text-white/50 text-sm">
                          {snoozesRemaining} snooze{snoozesRemaining !== 1 ? 's' : ''} remaining
                        </p>
                      )}
                    </div>
                    
                    {/* Actions */}
                    <div className="flex gap-4">
                      {canSnooze && (
                        <Button
                          variant="outline"
                          size="lg"
                          className="flex-1 gap-3 h-16 text-lg rounded-2xl bg-white/5 border-white/20 text-white hover:bg-white/10 hover:text-white"
                          onClick={handleSnooze}
                        >
                          <Clock className="h-6 w-6" />
                          Snooze
                        </Button>
                      )}
                      <Button
                        size="lg"
                        className={`${canSnooze ? 'flex-1' : 'w-full'} gap-3 h-16 text-lg rounded-2xl text-white border-0 shadow-lg`}
                        onClick={handleCompleteClick}
                        disabled={validatingPin}
                        style={{ 
                          background: `linear-gradient(145deg, ${activeAlarm.accent_color}, ${activeAlarm.accent_color}dd)`,
                          boxShadow: `0 10px 30px -5px ${activeAlarm.accent_color}60`
                        }}
                      >
                        <Check className="h-6 w-6" />
                        Complete
                      </Button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
