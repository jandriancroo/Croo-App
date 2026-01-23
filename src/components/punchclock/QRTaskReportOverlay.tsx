import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Check, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";

interface QRReport {
  id: string;
  task_id: string;
  selected_issues: string[];
  guest_note: string | null;
  reported_at: string;
  task: {
    title: string;
    accent_color: string;
  };
}

interface QRTaskReportOverlayProps {
  locationId: string;
  onDismiss?: () => void;
}

export function QRTaskReportOverlay({ locationId, onDismiss }: QRTaskReportOverlayProps) {
  const [activeReport, setActiveReport] = useState<QRReport | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [isAcknowledging, setIsAcknowledging] = useState(false);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  const getAudioContext = () => {
    if (!audioCtxRef.current) {
      const Ctx = window.AudioContext || (window as any).webkitAudioContext;
      audioCtxRef.current = new Ctx();
    }
    return audioCtxRef.current;
  };

  // Play alert sound
  const playAlertSound = async () => {
    try {
      const audioContext = getAudioContext();
      if (audioContext.state === "suspended") {
        await audioContext.resume();
      }

      if (audioContext.state !== "running") return;

      const playBeep = (time: number, freq: number, duration: number = 0.15) => {
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();

        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);

        oscillator.type = "sawtooth";
        oscillator.frequency.setValueAtTime(freq, audioContext.currentTime + time);

        gainNode.gain.setValueAtTime(0.001, audioContext.currentTime + time);
        gainNode.gain.exponentialRampToValueAtTime(0.4, audioContext.currentTime + time + 0.02);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + time + duration);

        oscillator.start(audioContext.currentTime + time);
        oscillator.stop(audioContext.currentTime + time + duration);
      };

      // Alert pattern - urgent but different from alarm
      playBeep(0, 523, 0.1);
      playBeep(0.15, 659, 0.1);
      playBeep(0.3, 784, 0.2);
    } catch (e) {
      console.log("Could not play alert sound:", e);
    }
  };

  // Subscribe to new QR reports
  useEffect(() => {
    if (!locationId) return;

    const channel = supabase
      .channel('qr-task-reports-overlay')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'qr_task_reports',
          filter: `location_id=eq.${locationId}`,
        },
        async (payload: any) => {
          const report = payload.new;

          // Fetch the task details
          const { data: task } = await supabase
            .from('temporary_tasks')
            .select('title, accent_color, qr_notify_punch_clock')
            .eq('id', report.task_id)
            .single();

          if (!task?.qr_notify_punch_clock) return;

          setActiveReport({
            id: report.id,
            task_id: report.task_id,
            selected_issues: report.selected_issues || [],
            guest_note: report.guest_note,
            reported_at: report.reported_at,
            task: {
              title: task.title,
              accent_color: task.accent_color || '#EF4444',
            },
          });
          setIsVisible(true);
          playAlertSound();

          // Auto-dismiss after 60 seconds
          if (timeoutRef.current) {
            clearTimeout(timeoutRef.current);
          }
          timeoutRef.current = setTimeout(() => {
            handleDismiss();
          }, 60000);
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

  const handleAcknowledge = async () => {
    if (!activeReport) return;

    setIsAcknowledging(true);
    try {
      // Mark the report as acknowledged
      await supabase
        .from('qr_task_reports')
        .update({ acknowledged_at: new Date().toISOString() })
        .eq('id', activeReport.id);

      toast.success("Report acknowledged");
      handleDismiss();
      onDismiss?.();
    } catch (error) {
      console.error("Error acknowledging report:", error);
      toast.error("Failed to acknowledge");
    } finally {
      setIsAcknowledging(false);
    }
  };

  const handleDismiss = () => {
    setIsVisible(false);
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    setTimeout(() => {
      setActiveReport(null);
    }, 300);
  };

  if (!activeReport) return null;

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
          className="fixed inset-0 z-[100] flex items-center justify-center p-4"
          onClick={handleDismiss}
        >
          {/* Backdrop */}
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
                border: `4px solid ${activeReport.task.accent_color}`,
                boxShadow: `0 0 60px ${activeReport.task.accent_color}60`,
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
                background: `linear-gradient(145deg, ${activeReport.task.accent_color}15, ${activeReport.task.accent_color}05)`,
                borderColor: `${activeReport.task.accent_color}40`,
                boxShadow: `0 25px 50px -12px ${activeReport.task.accent_color}40, 0 0 0 1px ${activeReport.task.accent_color}20 inset`,
              }}
            >
              {/* Top accent bar */}
              <div
                className="h-1.5"
                style={{ background: `linear-gradient(90deg, ${activeReport.task.accent_color}, ${activeReport.task.accent_color}80)` }}
              />

              {/* Close button */}
              <button
                onClick={handleDismiss}
                className="absolute top-4 right-4 p-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors"
              >
                <X className="h-5 w-5 text-white/70" />
              </button>

              <div className="p-10 space-y-6">
                {/* Icon */}
                <div className="flex justify-center">
                  <motion.div
                    animate={{ scale: [1, 1.08, 1] }}
                    transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut" }}
                    className="w-28 h-28 rounded-full flex items-center justify-center"
                    style={{
                      background: `radial-gradient(circle, ${activeReport.task.accent_color}40 0%, ${activeReport.task.accent_color}15 70%, transparent 100%)`,
                      boxShadow: `0 0 60px ${activeReport.task.accent_color}50`,
                    }}
                  >
                    <div
                      className="w-20 h-20 rounded-full flex items-center justify-center"
                      style={{
                        background: `linear-gradient(145deg, ${activeReport.task.accent_color}, ${activeReport.task.accent_color}cc)`,
                        boxShadow: `0 8px 30px ${activeReport.task.accent_color}60`,
                      }}
                    >
                      <AlertTriangle className="h-10 w-10 text-white" />
                    </div>
                  </motion.div>
                </div>

                {/* Content */}
                <div className="text-center space-y-4">
                  <div
                    className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold uppercase tracking-wider"
                    style={{
                      backgroundColor: `${activeReport.task.accent_color}25`,
                      color: activeReport.task.accent_color,
                    }}
                  >
                    Guest Report
                  </div>

                  <h2 className="text-2xl font-bold text-white tracking-tight">
                    {activeReport.task.title}
                  </h2>

                  {/* Issues */}
                  <div className="flex flex-wrap justify-center gap-2">
                    {activeReport.selected_issues.map((issue, idx) => (
                      <span
                        key={idx}
                        className="px-3 py-1.5 rounded-full text-sm font-medium bg-white/10 text-white/90"
                      >
                        {issue}
                      </span>
                    ))}
                  </div>

                  {/* Guest note if present */}
                  {activeReport.guest_note && (
                    <div className="mt-4 p-4 rounded-xl bg-white/5 border border-white/10">
                      <p className="text-sm text-white/70 italic">
                        "{activeReport.guest_note}"
                      </p>
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div className="flex gap-4">
                  <Button
                    variant="outline"
                    size="lg"
                    className="flex-1 gap-3 h-14 text-lg rounded-2xl bg-white/5 border-white/20 text-white hover:bg-white/10 hover:text-white"
                    onClick={handleDismiss}
                  >
                    <X className="h-5 w-5" />
                    Dismiss
                  </Button>
                  <Button
                    size="lg"
                    className="flex-1 gap-3 h-14 text-lg rounded-2xl text-white border-0 shadow-lg"
                    onClick={handleAcknowledge}
                    disabled={isAcknowledging}
                    style={{
                      background: `linear-gradient(145deg, ${activeReport.task.accent_color}, ${activeReport.task.accent_color}dd)`,
                      boxShadow: `0 10px 30px -5px ${activeReport.task.accent_color}60`,
                    }}
                  >
                    <Check className="h-5 w-5" />
                    {isAcknowledging ? "..." : "Got It"}
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