import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Bell, Check, ArrowLeft } from "lucide-react";
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

const FULL_SCREEN_SECONDS = 60; // Show full-screen for 60s, then minimize to banner
const AUDIO_CYCLES = 5; // 2x beep → 15s pause, repeat 5 times
const AUDIO_PAUSE_MS = 15_000; // 15 seconds between audio cycles

export function AlarmTaskOverlay({ locationId, onComplete }: AlarmTaskOverlayProps) {
  const [activeAlarm, setActiveAlarm] = useState<AlarmTask | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [_audioUnlocked, setAudioUnlocked] = useState(false);
  const [timezone, setTimezone] = useState<string>(DEFAULT_TIMEZONE);
  
  // Employee picker state
  const [showEmployeePicker, setShowEmployeePicker] = useState(false);
  const [clockedInEmployees, setClockedInEmployees] = useState<ClockedInEmployee[]>([]);
  const [loadingEmployees, setLoadingEmployees] = useState(false);
  const [completingUserId, setCompletingUserId] = useState<string | null>(null);
  
  // Confirmation screen state
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [completedByUser, setCompletedByUser] = useState<{ name: string; photo_url: string | null } | null>(null);
  const [completedAlarmTitle, setCompletedAlarmTitle] = useState("");
  const confirmationTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Avoid stale-closure bugs inside realtime/poll handlers
  const activeAlarmRef = useRef<AlarmTask | null>(null);
  const isVisibleRef = useRef(false);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const minimizeTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const alarmLoopRef = useRef<NodeJS.Timeout | null>(null);
  const alarmLoopTokenRef = useRef(0);

  useEffect(() => {
    activeAlarmRef.current = activeAlarm;
  }, [activeAlarm]);

  useEffect(() => {
    isVisibleRef.current = isVisible;
  }, [isVisible]);

  const getAudioContext = () => {
    if (!audioCtxRef.current) {
      const Ctx = window.AudioContext || (window as any).webkitAudioContext;
      audioCtxRef.current = new Ctx();
    }
    return audioCtxRef.current;
  };

  // Unlock audio on first user interaction
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

    const onFirst = () => { void unlock(); };
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
      if (settings?.timezone) setTimezone(settings.timezone);
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
      const startOfDay = new Date(`${todayStr}T00:00:00${offset}`);
      const startMinus = new Date(startOfDay);
      startMinus.setHours(startMinus.getHours() - 12);
      const endOfDayPlus = new Date(`${todayStr}T23:59:59${offset}`);
      endOfDayPlus.setHours(endOfDayPlus.getHours() + 12);

      const { data: punches, error } = await supabase
        .from('time_punches')
        .select('id, user_id, punch_time, punch_type')
        .eq('location_id', locationId)
        .gte('punch_time', startMinus.toISOString())
        .lte('punch_time', endOfDayPlus.toISOString())
        .order('punch_time', { ascending: true });
      if (error) throw error;

      const userPunches: Record<string, typeof punches> = {};
      (punches || []).forEach(p => {
        if (!userPunches[p.user_id]) userPunches[p.user_id] = [];
        userPunches[p.user_id].push(p);
      });

      const clockedInUserIds: string[] = [];
      Object.entries(userPunches).forEach(([userId, userPunchList]) => {
        const sorted = [...userPunchList].sort((a, b) =>
          new Date(a.punch_time).getTime() - new Date(b.punch_time).getTime()
        );
        let isClockedIn = false;
        sorted.forEach(p => {
          if (p.punch_type === 'clock_in') isClockedIn = true;
          else if (p.punch_type === 'clock_out') isClockedIn = false;
        });
        if (isClockedIn) clockedInUserIds.push(userId);
      });

      if (clockedInUserIds.length === 0) {
        setClockedInEmployees([]);
        return;
      }
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

  // ── Audio: 2x beep burst → 15s pause → repeat for AUDIO_CYCLES ──
  const playAlarmBurst = async () => {
    try {
      const audioContext = getAudioContext();
      if (audioContext.state === "suspended") await audioContext.resume();
      if (audioContext.state !== "running") return;

      const playBeep = (time: number, freq: number, duration: number = 0.2) => {
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();
        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);
        oscillator.type = "square";
        oscillator.frequency.setValueAtTime(freq, audioContext.currentTime + time);
        gainNode.gain.setValueAtTime(0.001, audioContext.currentTime + time);
        gainNode.gain.exponentialRampToValueAtTime(0.6, audioContext.currentTime + time + 0.01);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + time + duration);
        oscillator.start(audioContext.currentTime + time);
        oscillator.stop(audioContext.currentTime + time + duration);
      };

      // Alarm pattern - 1 cycle (~1.2 seconds)
      playBeep(0, 880, 0.15);
      playBeep(0.2, 660, 0.15);
      playBeep(0.4, 880, 0.15);
      playBeep(0.6, 660, 0.15);
      playBeep(0.8, 988, 0.25);
    } catch (e) {
      console.log("Could not play alarm sound:", e);
    }
  };

  const playAlarmSequence = async () => {
    await playAlarmBurst();
    await new Promise((r) => setTimeout(r, 1300));
    await playAlarmBurst();
  };

  /** Start audio loop: 2x beep → 15s pause → repeat AUDIO_CYCLES times */
  const startAlarmLoop = () => {
    stopAlarmLoop();
    const token = ++alarmLoopTokenRef.current;
    let cycle = 0;

    const runCycle = async () => {
      if (alarmLoopTokenRef.current !== token) return;
      cycle++;
      await playAlarmSequence();
      if (alarmLoopTokenRef.current !== token) return;
      if (cycle < AUDIO_CYCLES) {
        alarmLoopRef.current = setTimeout(() => runCycle(), AUDIO_PAUSE_MS);
      }
    };
    runCycle();
  };

  const stopAlarmLoop = () => {
    alarmLoopTokenRef.current++;
    if (alarmLoopRef.current) {
      clearTimeout(alarmLoopRef.current);
      alarmLoopRef.current = null;
    }
  };

  // ── Initialize alarm (no snooze) ──
  const initializeAlarm = (task: any, intervalKey: string) => {
    setActiveAlarm({
      id: task.id,
      title: task.title,
      description: task.description,
      accent_color: task.accent_color || '#8B5CF6',
      interval_key: intervalKey,
    });
    setIsVisible(true);
    setIsMinimized(false);
    setShowEmployeePicker(false);
    setClockedInEmployees([]);
    startAlarmLoop();

    // Auto-minimize after 60s
    if (minimizeTimeoutRef.current) clearTimeout(minimizeTimeoutRef.current);
    minimizeTimeoutRef.current = setTimeout(() => {
      setIsMinimized(true);
    }, FULL_SCREEN_SECONDS * 1000);
  };

  // Check for pending alarms
  useEffect(() => {
    if (!locationId) return;

    const checkPendingAlarms = async () => {
      // Look for alarms triggered in the last 5 minutes (wider window)
      const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();

      const { data: pendingTasks } = await supabase
        .from('temporary_tasks')
        .select('*')
        .eq('location_id', locationId)
        .eq('task_style', 'alarm')
        .eq('show_on_punch_clock', true)
        .gte('last_triggered_at', fiveMinAgo)
        .order('last_triggered_at', { ascending: false })
        .limit(1);

      if (pendingTasks && pendingTasks.length > 0) {
        const task = pendingTasks[0];
        const triggeredAt = new Date(task.last_triggered_at);
        const intervalKey = getAlarmIntervalKey(triggeredAt, timezone);

        // Already showing this exact alarm
        if (
          activeAlarmRef.current?.id === task.id &&
          activeAlarmRef.current?.interval_key === intervalKey &&
          isVisibleRef.current
        ) return;

        // Check if already completed
        const { data: completion } = await supabase
          .from('alarm_task_completions')
          .select('id')
          .eq('task_id', task.id)
          .eq('interval_key', intervalKey)
          .maybeSingle();

        if (!completion) {
          initializeAlarm(task, intervalKey);
        }
      }
    };

    checkPendingAlarms();

    // Poll every 10s - catches missed realtime + expired iOS timers
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
          if (task.task_style === 'alarm' && task.last_triggered_at && task.show_on_punch_clock) {
            const triggeredAt = new Date(task.last_triggered_at);
            const now = new Date();
            const secondsSinceTrigger = (now.getTime() - triggeredAt.getTime()) / 1000;

            if (secondsSinceTrigger <= 60) {
              const intervalKey = getAlarmIntervalKey(triggeredAt, timezone);
              if (
                activeAlarmRef.current?.id === task.id &&
                activeAlarmRef.current?.interval_key === intervalKey &&
                isVisibleRef.current
              ) return;

              // Check completion
              const { data: completion } = await supabase
                .from('alarm_task_completions')
                .select('id')
                .eq('task_id', task.id)
                .eq('interval_key', intervalKey)
                .maybeSingle();

              if (!completion) {
                initializeAlarm(task, intervalKey);
              }
            }
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
      clearInterval(pollRef);
      stopAlarmLoop();
      if (minimizeTimeoutRef.current) clearTimeout(minimizeTimeoutRef.current);
      if (confirmationTimeoutRef.current) clearTimeout(confirmationTimeoutRef.current);
    };
  }, [locationId, timezone]);

  // ── Employee selection → complete ──
  const handleEmployeeSelect = async (employee: ClockedInEmployee) => {
    if (!activeAlarm || completingUserId) return;
    setCompletingUserId(employee.id);
    try {
      const { error } = await supabase
        .from("alarm_task_completions")
        .insert({
          task_id: activeAlarm.id,
          interval_key: activeAlarm.interval_key,
          completed_by: employee.id,
        });
      if (error) throw error;

      const userName = employee.full_name || 'User';
      const alarmTitle = activeAlarm.title;

      // Clear alarm
      setIsVisible(false);
      setIsMinimized(false);
      setShowEmployeePicker(false);
      setActiveAlarm(null);
      stopAlarmLoop();
      if (minimizeTimeoutRef.current) clearTimeout(minimizeTimeoutRef.current);

      // Show confirmation
      setCompletedByUser({ name: userName, photo_url: employee.profile_photo_url });
      setCompletedAlarmTitle(alarmTitle);
      setShowConfirmation(true);

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
    setShowEmployeePicker(true);
    setIsMinimized(false); // Expand back to full if minimized
    fetchClockedInEmployees();
    stopAlarmLoop();
  };

  const handleBackFromPicker = () => {
    setShowEmployeePicker(false);
    setClockedInEmployees([]);
    startAlarmLoop();
  };

  // ── Minimized banner tap → expand ──
  const handleBannerTap = () => {
    setIsMinimized(false);
    // Re-start the 60s minimize timer
    if (minimizeTimeoutRef.current) clearTimeout(minimizeTimeoutRef.current);
    minimizeTimeoutRef.current = setTimeout(() => {
      setIsMinimized(true);
    }, FULL_SCREEN_SECONDS * 1000);
  };

  if (!activeAlarm && !showConfirmation) return null;

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
            <div 
              className="relative overflow-hidden rounded-3xl backdrop-blur-2xl border border-green-500/40 p-10"
              style={{ 
                background: 'linear-gradient(145deg, rgba(34, 197, 94, 0.15), rgba(34, 197, 94, 0.05))',
                boxShadow: '0 25px 50px -12px rgba(34, 197, 94, 0.3), 0 0 0 1px rgba(34, 197, 94, 0.2) inset'
              }}
            >
              <div 
                className="absolute top-0 left-0 right-0 h-1.5"
                style={{ background: 'linear-gradient(90deg, #22c55e, #16a34a)' }}
              />
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ delay: 0.2, type: "spring", damping: 15 }}
                className="mx-auto mb-6 w-20 h-20 rounded-full bg-green-500/20 flex items-center justify-center"
              >
                <Check className="h-10 w-10 text-green-400" />
              </motion.div>
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

      {/* Minimized Banner - persistent red bar at top */}
      {isVisible && activeAlarm && isMinimized && !showEmployeePicker && (
        <motion.div
          key="minimized-banner"
          initial={{ y: -80, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -80, opacity: 0 }}
          transition={{ type: "spring", damping: 25, stiffness: 300 }}
          className="fixed top-0 left-0 right-0 z-[100] cursor-pointer"
          onClick={handleBannerTap}
        >
          <div 
            className="flex items-center justify-between px-6 py-4"
            style={{ 
              background: `linear-gradient(135deg, ${activeAlarm.accent_color}, ${activeAlarm.accent_color}cc)`,
              boxShadow: `0 4px 20px ${activeAlarm.accent_color}60`
            }}
          >
            <div className="flex items-center gap-4">
              <motion.div
                animate={{ scale: [1, 1.3, 1] }}
                transition={{ duration: 0.8, repeat: Infinity }}
              >
                <Bell className="h-7 w-7 text-white" />
              </motion.div>
              <div>
                <p className="text-white font-black text-xl tracking-tight">
                  {activeAlarm.title}
                </p>
                <p className="text-white/80 text-sm font-medium">
                  Tap to complete
                </p>
              </div>
            </div>
            <Button
              className="h-12 px-6 text-base font-bold bg-white/20 hover:bg-white/30 text-white border border-white/30"
              onClick={(e) => {
                e.stopPropagation();
                handleCompleteClick();
              }}
            >
              <Check className="h-5 w-5 mr-2" />
              Complete
            </Button>
          </div>
        </motion.div>
      )}
      
      {/* Main Alarm Overlay - 3/4 screen */}
      {isVisible && activeAlarm && !isMinimized && (
        <motion.div
          key="full-alarm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
          className="fixed inset-0 z-[100] flex items-end justify-center"
          style={{ 
            background: `radial-gradient(ellipse at center bottom, ${activeAlarm.accent_color}30 0%, rgba(0,0,0,0.97) 70%)`,
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
              className="w-80 h-80 rounded-full"
              style={{ 
                border: `4px solid ${activeAlarm.accent_color}`,
                boxShadow: `0 0 80px ${activeAlarm.accent_color}60`
              }}
            />
          </motion.div>
          
          {/* 3/4 height card */}
          <motion.div
            initial={{ y: 100, scale: 0.95 }}
            animate={{ y: 0, scale: 1 }}
            exit={{ y: 100, scale: 0.95 }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
            className="relative w-full h-[75vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div 
              className="relative overflow-hidden rounded-t-[2rem] backdrop-blur-2xl border border-b-0 flex-1 flex flex-col"
              style={{ 
                background: `linear-gradient(145deg, ${activeAlarm.accent_color}18, ${activeAlarm.accent_color}06, rgba(0,0,0,0.9))`,
                borderColor: `${activeAlarm.accent_color}40`,
                boxShadow: `0 -25px 50px -12px ${activeAlarm.accent_color}40, 0 0 0 1px ${activeAlarm.accent_color}20 inset`
              }}
            >
              {/* Top accent bar */}
              <div 
                className="h-2 flex-shrink-0"
                style={{ background: `linear-gradient(90deg, ${activeAlarm.accent_color}, ${activeAlarm.accent_color}80)` }}
              />
              
              {showEmployeePicker ? (
                // Employee Picker Screen
                <div className="flex-1 flex flex-col p-8 overflow-hidden">
                  <div className="flex items-center gap-4 mb-8">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-white/70 hover:text-white hover:bg-white/10 h-12 w-12"
                      onClick={handleBackFromPicker}
                    >
                      <ArrowLeft className="h-7 w-7" />
                    </Button>
                    <div>
                      <h2 className="text-3xl font-black text-white tracking-tight">
                        Who Completed the Task?
                      </h2>
                      <p className="text-white/60 mt-1 text-lg">
                        {activeAlarm.title}
                      </p>
                    </div>
                  </div>
                  
                  <div className="flex-1 overflow-y-auto py-4">
                    {loadingEmployees ? (
                      <div className="flex justify-center py-12">
                        <motion.div
                          animate={{ rotate: 360 }}
                          transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                          className="w-10 h-10 border-3 border-white border-t-transparent rounded-full"
                        />
                      </div>
                    ) : clockedInEmployees.length === 0 ? (
                      <div className="text-center py-12">
                        <p className="text-white/60 text-xl">No employees currently clocked in</p>
                      </div>
                    ) : (
                      <div className="flex flex-wrap justify-center gap-8">
                        {clockedInEmployees.map((employee) => (
                          <motion.button
                            key={employee.id}
                            whileHover={{ scale: 1.05 }}
                            whileTap={{ scale: 0.95 }}
                            onClick={() => handleEmployeeSelect(employee)}
                            disabled={!!completingUserId}
                            className="flex flex-col items-center gap-3 p-4 rounded-2xl transition-colors hover:bg-white/10 disabled:opacity-50"
                          >
                            <div className="relative">
                              <Avatar className="h-24 w-24 border-3 border-white/30">
                                <AvatarImage src={employee.profile_photo_url || undefined} />
                                <AvatarFallback className="text-3xl bg-white/20 text-white">
                                  {employee.full_name.charAt(0).toUpperCase()}
                                </AvatarFallback>
                              </Avatar>
                              {completingUserId === employee.id && (
                                <div className="absolute inset-0 flex items-center justify-center bg-black/50 rounded-full">
                                  <motion.div
                                    animate={{ rotate: 360 }}
                                    transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                                    className="w-8 h-8 border-2 border-white border-t-transparent rounded-full"
                                  />
                                </div>
                              )}
                            </div>
                            <span className="text-white font-semibold text-base max-w-[100px] truncate">
                              {employee.full_name.split(' ')[0]}
                            </span>
                          </motion.button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                // Main Alarm Screen - large text, centered
                <div className="flex-1 flex flex-col items-center justify-center p-8 text-center gap-10">
                  {/* Pulsing bell icon */}
                  <motion.div
                    animate={{ scale: [1, 1.2, 1] }}
                    transition={{ duration: 0.6, repeat: Infinity }}
                    className="w-24 h-24 rounded-3xl flex items-center justify-center"
                    style={{ 
                      background: `linear-gradient(135deg, ${activeAlarm.accent_color}, ${activeAlarm.accent_color}80)`,
                      boxShadow: `0 12px 40px ${activeAlarm.accent_color}50`
                    }}
                  >
                    <Bell className="h-12 w-12 text-white" />
                  </motion.div>

                  {/* Large alarm title */}
                  <div className="space-y-4 max-w-lg">
                    <h1 className="text-5xl sm:text-6xl font-black text-white tracking-tight leading-tight">
                      {activeAlarm.title}
                    </h1>
                    {activeAlarm.description && (
                      <p className="text-white/60 text-xl sm:text-2xl">
                        {activeAlarm.description}
                      </p>
                    )}
                  </div>
                  
                  {/* Complete button */}
                  <Button
                    className="w-full max-w-sm h-20 text-2xl font-black gap-4 rounded-2xl"
                    style={{ 
                      background: `linear-gradient(135deg, ${activeAlarm.accent_color}, ${activeAlarm.accent_color}dd)`,
                      boxShadow: `0 12px 40px ${activeAlarm.accent_color}40`
                    }}
                    onClick={handleCompleteClick}
                  >
                    <Check className="h-8 w-8" />
                    Complete
                  </Button>
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}