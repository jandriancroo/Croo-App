import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Bell, Check, Clock, ArrowLeft } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";
import { getAlarmIntervalKey, DEFAULT_TIMEZONE, getTimezoneOffset, getTodayInTimezone } from "@/utils/timezoneUtils";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

interface AlarmTask {
  id: string;
  title: string;
  description?: string;
  accent_color: string;
  interval_key: string;
}

interface ClockedInEmployee {
  id: string;
  full_name: string;
  profile_photo_url: string | null;
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
  
  // Employee picker state (replaces PIN entry)
  const [showEmployeePicker, setShowEmployeePicker] = useState(false);
  const [clockedInEmployees, setClockedInEmployees] = useState<ClockedInEmployee[]>([]);
  const [loadingEmployees, setLoadingEmployees] = useState(false);
  const [completingUserId, setCompletingUserId] = useState<string | null>(null);
  
  // Confirmation screen state
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [completedByUser, setCompletedByUser] = useState<{ name: string; photo_url: string | null } | null>(null);
  const [completedAlarmTitle, setCompletedAlarmTitle] = useState("");
  const confirmationTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  
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

  // Fetch clocked-in employees when employee picker opens
  const fetchClockedInEmployees = async () => {
    if (!locationId || !timezone) return;
    
    setLoadingEmployees(true);
    try {
      const todayStr = getTodayInTimezone(timezone);
      const offset = getTimezoneOffset(timezone);
      
      // Query window for today's punches
      const startOfDay = new Date(`${todayStr}T00:00:00${offset}`);
      const startMinus = new Date(startOfDay);
      startMinus.setHours(startMinus.getHours() - 12);
      const startOfDayTime = startMinus.toISOString();
      
      const endOfDayPlus = new Date(`${todayStr}T23:59:59${offset}`);
      endOfDayPlus.setHours(endOfDayPlus.getHours() + 12);
      const endOfDayTime = endOfDayPlus.toISOString();
      
      // Fetch today's punches
      const { data: punches, error } = await supabase
        .from('time_punches')
        .select('id, user_id, punch_time, punch_type')
        .eq('location_id', locationId)
        .gte('punch_time', startOfDayTime)
        .lte('punch_time', endOfDayTime)
        .order('punch_time', { ascending: true });
      
      if (error) throw error;
      
      // Group by user and find who is currently clocked in
      const userPunches: Record<string, typeof punches> = {};
      (punches || []).forEach(p => {
        if (!userPunches[p.user_id]) userPunches[p.user_id] = [];
        userPunches[p.user_id].push(p);
      });
      
      const clockedInUserIds: string[] = [];
      
      Object.entries(userPunches).forEach(([userId, userPunchList]) => {
        let isClockedIn = false;
        let hasClockIn = false;
        
        userPunchList.forEach(p => {
          if (p.punch_type === 'clock_in') {
            if (!hasClockIn) {
              hasClockIn = true;
              isClockedIn = true;
            } else if (!isClockedIn) {
              isClockedIn = true;
            }
          }
          if (p.punch_type === 'clock_out') {
            if (hasClockIn) {
              isClockedIn = false;
            }
          }
        });
        
        // Filter to only those who clocked in today (in location timezone)
        if (isClockedIn && hasClockIn) {
          const clockInPunch = userPunchList.find(p => p.punch_type === 'clock_in');
          if (clockInPunch) {
            const clockInDate = new Date(clockInPunch.punch_time);
            const clockInLocalDate = clockInDate.toLocaleDateString('en-CA', { timeZone: timezone });
            if (clockInLocalDate === todayStr) {
              clockedInUserIds.push(userId);
            }
          }
        }
      });
      
      if (clockedInUserIds.length === 0) {
        setClockedInEmployees([]);
        return;
      }
      
      // Fetch profiles for clocked-in users
      const { data: profiles, error: profileError } = await supabase
        .from('profiles')
        .select('id, full_name, profile_photo_url')
        .in('id', clockedInUserIds);
      
      if (profileError) throw profileError;
      
      setClockedInEmployees(profiles || []);
    } catch (error) {
      console.error('Error fetching clocked-in employees:', error);
      setClockedInEmployees([]);
    } finally {
      setLoadingEmployees(false);
    }
  };

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
    setShowEmployeePicker(false);
    setClockedInEmployees([]);
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
      if (confirmationTimeoutRef.current) {
        clearTimeout(confirmationTimeoutRef.current);
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

  const handleEmployeeSelect = async (employee: ClockedInEmployee) => {
    if (!activeAlarm || completingUserId) return;
    
    setCompletingUserId(employee.id);
    
    try {
      // Complete the task with this user
      const { error } = await supabase
        .from("alarm_task_completions")
        .insert({
          task_id: activeAlarm.id,
          interval_key: activeAlarm.interval_key,
          completed_by: employee.id,
        });

      if (error) throw error;

      // Show confirmation screen - hide alarm first
      const userName = employee.full_name || 'User';
      const alarmTitle = activeAlarm.title;
      
      // Clear alarm state to prevent re-triggering
      setIsVisible(false);
      setShowEmployeePicker(false);
      setActiveAlarm(null);
      snoozedAlarmRef.current = null;
      stopAlarmLoop();
      
      // Clear all timers
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      if (countdownRef.current) clearInterval(countdownRef.current);
      if (snoozeTimeoutRef.current) clearTimeout(snoozeTimeoutRef.current);
      
      // Reset snooze count
      setSnoozeCount(0);
      snoozeCountRef.current = 0;
      
      // Now show confirmation
      setCompletedByUser({ name: userName, photo_url: employee.profile_photo_url });
      setCompletedAlarmTitle(alarmTitle);
      setShowConfirmation(true);
      
      // Auto-dismiss after 7 seconds
      if (confirmationTimeoutRef.current) clearTimeout(confirmationTimeoutRef.current);
      confirmationTimeoutRef.current = setTimeout(() => {
        setShowConfirmation(false);
        setCompletedByUser(null);
        setCompletedAlarmTitle("");
        onComplete?.();
      }, 7000);
    } catch (error: any) {
      console.error("Error completing alarm task:", error);
      toast.error(error?.message ? `Failed to complete task: ${error.message}` : "Failed to complete task");
    } finally {
      setCompletingUserId(null);
    }
  };

  const handleCompleteClick = () => {
    // Show employee picker instead of immediately completing
    setShowEmployeePicker(true);
    fetchClockedInEmployees();
    
    // Stop auto-dismiss timer while picking
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    if (countdownRef.current) {
      clearInterval(countdownRef.current);
    }
    stopAlarmLoop();
  };

  const handleBackFromPicker = () => {
    setShowEmployeePicker(false);
    setClockedInEmployees([]);
    
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
    setShowEmployeePicker(false);
    setClockedInEmployees([]);
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
        setShowEmployeePicker(false);
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

  if (!activeAlarm && !showConfirmation) return null;

  const canSnooze = snoozeCount < MAX_SNOOZES;
  const snoozesRemaining = MAX_SNOOZES - snoozeCount;

  return (
    <AnimatePresence>
      {/* Confirmation Screen */}
      {showConfirmation && completedByUser && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
          className="fixed inset-0 z-[100] flex items-center justify-center p-6"
          style={{ 
            background: 'radial-gradient(ellipse at center, rgba(34, 197, 94, 0.2) 0%, rgba(0,0,0,0.95) 70%)',
            backdropFilter: 'blur(20px)'
          }}
        >
          {/* Success ring effect */}
          <motion.div
            className="absolute inset-0 flex items-center justify-center pointer-events-none"
            initial={{ scale: 0.8, opacity: 0.5 }}
            animate={{ scale: 1.3, opacity: 0 }}
            transition={{ duration: 1.5, repeat: Infinity, ease: "easeOut" }}
          >
            <div 
              className="w-64 h-64 rounded-full border-4 border-green-500"
              style={{ boxShadow: '0 0 60px rgba(34, 197, 94, 0.4)' }}
            />
          </motion.div>
          
          <motion.div
            initial={{ scale: 0.8, y: 20 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.8, y: 20 }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
            className="relative w-full max-w-md text-center"
          >
            {/* Glass card */}
            <div 
              className="relative overflow-hidden rounded-3xl backdrop-blur-2xl border border-green-500/40 p-10"
              style={{ 
                background: 'linear-gradient(145deg, rgba(34, 197, 94, 0.15), rgba(34, 197, 94, 0.05))',
                boxShadow: '0 25px 50px -12px rgba(34, 197, 94, 0.3), 0 0 0 1px rgba(34, 197, 94, 0.2) inset'
              }}
            >
              {/* Top accent bar */}
              <div 
                className="absolute top-0 left-0 right-0 h-1.5"
                style={{ background: 'linear-gradient(90deg, #22c55e, #16a34a)' }}
              />
              
              {/* Checkmark */}
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ delay: 0.2, type: "spring", damping: 15 }}
                className="mx-auto mb-6 w-20 h-20 rounded-full bg-green-500/20 flex items-center justify-center"
              >
                <Check className="h-10 w-10 text-green-400" />
              </motion.div>
              
              {/* Profile Photo */}
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 }}
                className="mb-6"
              >
                <div className="mx-auto w-24 h-24 rounded-full overflow-hidden border-4 border-green-500/50 shadow-lg">
                  {completedByUser.photo_url ? (
                    <img 
                      src={completedByUser.photo_url} 
                      alt={completedByUser.name}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full bg-gradient-to-br from-green-500/30 to-green-600/30 flex items-center justify-center">
                      <span className="text-3xl font-bold text-white">
                        {completedByUser.name.charAt(0).toUpperCase()}
                      </span>
                    </div>
                  )}
                </div>
                <h3 className="mt-4 text-2xl font-bold text-white">
                  {completedByUser.name}
                </h3>
              </motion.div>
              
              {/* Thank You Message */}
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.4 }}
              >
                <p className="text-xl text-green-300 font-medium">
                  Thank You for Completing
                </p>
                <p className="mt-2 text-2xl font-bold text-white">
                  "{completedAlarmTitle}"
                </p>
              </motion.div>
            </div>
          </motion.div>
        </motion.div>
      )}
      
      {/* Main Alarm Overlay */}
      {isVisible && activeAlarm && (
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
                {showEmployeePicker ? (
                  // Employee Picker Screen
                  <>
                    <div className="flex items-center gap-4">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-white/70 hover:text-white hover:bg-white/10"
                        onClick={handleBackFromPicker}
                      >
                        <ArrowLeft className="h-6 w-6" />
                      </Button>
                      <div>
                        <h2 className="text-2xl font-bold text-white">
                          Who Completed the Task?
                        </h2>
                        <p className="text-white/60 mt-1">
                          {activeAlarm.title}
                        </p>
                      </div>
                    </div>
                    
                    {/* Clocked-in employees */}
                    <div className="py-4">
                      {loadingEmployees ? (
                        <div className="flex justify-center py-8">
                          <motion.div
                            animate={{ rotate: 360 }}
                            transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                            className="w-8 h-8 border-2 border-white border-t-transparent rounded-full"
                          />
                        </div>
                      ) : clockedInEmployees.length === 0 ? (
                        <div className="text-center py-8">
                          <p className="text-white/60">No employees currently clocked in</p>
                        </div>
                      ) : (
                        <div className="flex flex-wrap justify-center gap-6">
                          {clockedInEmployees.map((employee) => (
                            <motion.button
                              key={employee.id}
                              whileHover={{ scale: 1.05 }}
                              whileTap={{ scale: 0.95 }}
                              onClick={() => handleEmployeeSelect(employee)}
                              disabled={!!completingUserId}
                              className="flex flex-col items-center gap-2 p-3 rounded-2xl transition-colors hover:bg-white/10 disabled:opacity-50"
                            >
                              <div className="relative">
                                <Avatar className="h-20 w-20 border-3 border-white/30">
                                  <AvatarImage src={employee.profile_photo_url || undefined} />
                                  <AvatarFallback className="text-2xl bg-white/20 text-white">
                                    {employee.full_name.charAt(0).toUpperCase()}
                                  </AvatarFallback>
                                </Avatar>
                                {completingUserId === employee.id && (
                                  <div className="absolute inset-0 flex items-center justify-center bg-black/50 rounded-full">
                                    <motion.div
                                      animate={{ rotate: 360 }}
                                      transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                                      className="w-6 h-6 border-2 border-white border-t-transparent rounded-full"
                                    />
                                  </div>
                                )}
                              </div>
                              <span className="text-white font-medium text-sm max-w-[90px] truncate">
                                {employee.full_name.split(' ')[0]}
                              </span>
                            </motion.button>
                          ))}
                        </div>
                      )}
                    </div>
                  </>
                ) : (
                  // Main Alarm Screen
                  <>
                    {/* Header */}
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-4">
                        <motion.div
                          animate={{ scale: [1, 1.2, 1] }}
                          transition={{ duration: 0.6, repeat: Infinity }}
                          className="w-14 h-14 rounded-2xl flex items-center justify-center"
                          style={{ 
                            background: `linear-gradient(135deg, ${activeAlarm.accent_color}, ${activeAlarm.accent_color}80)`,
                            boxShadow: `0 8px 32px ${activeAlarm.accent_color}50`
                          }}
                        >
                          <Bell className="h-7 w-7 text-white" />
                        </motion.div>
                        <div>
                          <h2 className="text-3xl font-black text-white tracking-tight">
                            {activeAlarm.title}
                          </h2>
                          {activeAlarm.description && (
                            <p className="text-white/60 text-base mt-1">
                              {activeAlarm.description}
                            </p>
                          )}
                        </div>
                      </div>
                      
                      {/* Countdown badge */}
                      {countdown > 0 && (
                        <div 
                          className="flex items-center gap-2 px-4 py-2 rounded-full"
                          style={{ background: `${activeAlarm.accent_color}30` }}
                        >
                          <Clock className="h-4 w-4 text-white/80" />
                          <span className="text-white font-bold tabular-nums">{countdown}s</span>
                        </div>
                      )}
                      {countdown === 0 && snoozeCount >= MAX_SNOOZES && (
                        <div 
                          className="flex items-center gap-2 px-4 py-2 rounded-full bg-red-500/30"
                        >
                          <span className="text-white font-bold text-sm">Must Complete</span>
                        </div>
                      )}
                    </div>
                    
                    {/* Snooze info */}
                    {!canSnooze && (
                      <div className="text-center py-2 px-4 rounded-xl bg-red-500/20 border border-red-500/30">
                        <p className="text-red-300 text-sm font-medium">
                          No snoozes remaining - Please complete the task
                        </p>
                      </div>
                    )}
                    
                    {/* Action Buttons */}
                    <div className="flex gap-4">
                      {canSnooze && (
                        <Button
                          variant="outline"
                          className="flex-1 h-16 text-lg font-bold border-white/20 text-white hover:bg-white/10 gap-3"
                          onClick={handleSnooze}
                        >
                          <Clock className="h-6 w-6" />
                          Snooze ({snoozesRemaining} left)
                        </Button>
                      )}
                      <Button
                        className={`${canSnooze ? 'flex-1' : 'w-full'} h-16 text-lg font-bold gap-3`}
                        style={{ 
                          background: `linear-gradient(135deg, ${activeAlarm.accent_color}, ${activeAlarm.accent_color}dd)`,
                          boxShadow: `0 8px 32px ${activeAlarm.accent_color}40`
                        }}
                        onClick={handleCompleteClick}
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
