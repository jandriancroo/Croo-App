import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Corrective Action conversation recorder (iPad-first PWA).
 *
 * - Mic permission is requested on the first start() call, never on mount.
 * - Audio is captured as self-contained ~75 second segments (a fresh
 *   MediaRecorder per segment so every upload has a valid container header).
 * - Each segment is transcribed verbatim server-side (GPT-4o Mini Transcribe,
 *   fallback GPT-4o Transcribe). Transcripts are concatenated in order.
 * - The bullet pass runs ONCE on the full transcript after stop.
 * - Audio blobs are dropped as soon as a segment is sent. Nothing is stored.
 * - If iOS backgrounds the PWA or drops the mic, we auto-stop and keep the
 *   partial recording for transcription.
 */

export type NoteBullet = { speaker: string; text: string };

const SEGMENT_MS = 75_000; // ~75s per chunk, inside STT timeouts
export const MAX_RECORDING_SECONDS = 15 * 60;

type RecorderStatus = "idle" | "recording" | "processing" | "done" | "error";

interface Options {
  managerName: string;
  employeeName: string;
}

export function useConversationRecorder({ managerName, employeeName }: Options) {
  const [status, setStatus] = useState<RecorderStatus>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [transcript, setTranscript] = useState("");
  const [bullets, setBullets] = useState<NoteBullet[]>([]);
  const [sttModel, setSttModel] = useState<"mini" | "standard" | null>(null);
  const [pendingChunks, setPendingChunks] = useState(0);
  const [autoStopped, setAutoStopped] = useState(false);

  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const segmentTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recordingRef = useRef(false);
  const startedAtRef = useRef(0);
  const transcriptPartsRef = useRef<string[]>([]);
  const chunkQueueRef = useRef<Promise<void>>(Promise.resolve());
  const durationRef = useRef(0);
  const namesRef = useRef({ managerName, employeeName });

  useEffect(() => {
    namesRef.current = { managerName, employeeName };
  }, [managerName, employeeName]);

  const pickMime = () => {
    const candidates = [
      "audio/mp4",
      "audio/webm;codecs=opus",
      "audio/webm",
    ];
    for (const c of candidates) {
      if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported?.(c)) return c;
    }
    return "";
  };

  const blobToBase64 = (blob: Blob) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = String(reader.result || "");
        resolve(result.includes(",") ? result.split(",")[1] : result);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });

  const sendChunk = useCallback(async (blob: Blob) => {
    if (!blob || blob.size < 2048) return; // silent / header-only
    setPendingChunks((n) => n + 1);
    try {
      const audioBase64 = await blobToBase64(blob);
      const { data, error: fnError } = await supabase.functions.invoke("corrective-action-transcribe", {
        body: { action: "transcribe_chunk", audioBase64, mimeType: blob.type },
      });
      if (fnError) throw fnError;
      if (data?.error) throw new Error(data.error);
      if (data?.model_used) setSttModel(data.model_used);
      const text = (data?.text || "").trim();
      if (text) {
        transcriptPartsRef.current.push(text);
        setTranscript(transcriptPartsRef.current.join(" "));
      }
    } catch (e: any) {
      console.error("[recorder] chunk transcription failed", e);
      setError(e?.message || "Part of the recording could not be transcribed.");
    } finally {
      setPendingChunks((n) => Math.max(0, n - 1));
    }
  }, []);

  const enqueueChunk = useCallback((blob: Blob) => {
    chunkQueueRef.current = chunkQueueRef.current.then(() => sendChunk(blob));
  }, [sendChunk]);

  const teardownStream = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  };

  const clearTimers = () => {
    if (segmentTimerRef.current) clearTimeout(segmentTimerRef.current);
    if (tickRef.current) clearInterval(tickRef.current);
    segmentTimerRef.current = null;
    tickRef.current = null;
  };

  const startSegment = useCallback(() => {
    const stream = streamRef.current;
    if (!stream || !recordingRef.current) return;

    const mime = pickMime();
    let recorder: MediaRecorder;
    try {
      recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
    } catch (e) {
      console.error("[recorder] MediaRecorder failed", e);
      setError("This device could not start recording.");
      setStatus("error");
      recordingRef.current = false;
      teardownStream();
      return;
    }

    const parts: Blob[] = [];
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) parts.push(e.data);
    };
    recorder.onstop = () => {
      const blob = new Blob(parts, { type: recorder.mimeType || mime || "audio/webm" });
      parts.length = 0; // drop audio references immediately
      enqueueChunk(blob);
      if (recordingRef.current) startSegment();
    };

    recorderRef.current = recorder;
    recorder.start();
    segmentTimerRef.current = setTimeout(() => {
      if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    }, SEGMENT_MS);
  }, [enqueueChunk]);

  const finish = useCallback(async () => {
    setStatus("processing");
    // wait for all queued chunks
    await chunkQueueRef.current;
    const full = transcriptPartsRef.current.join(" ").trim();
    if (!full) {
      setStatus("error");
      setError("Nothing could be transcribed from that recording.");
      return;
    }
    try {
      const { data, error: fnError } = await supabase.functions.invoke("corrective-action-transcribe", {
        body: {
          action: "summarize",
          transcript: full,
          managerName: namesRef.current.managerName,
          employeeName: namesRef.current.employeeName,
        },
      });
      if (fnError) throw fnError;
      if (data?.error) throw new Error(data.error);
      setBullets(Array.isArray(data?.notes_bullets) ? data.notes_bullets : []);
      setStatus("done");
    } catch (e: any) {
      console.error("[recorder] summarize failed", e);
      // Transcript survives; manager can still write notes by hand.
      setError(e?.message || "Notes could not be generated, but the transcript was kept.");
      setStatus("done");
    }
  }, []);

  const stop = useCallback((opts?: { auto?: boolean }) => {
    if (!recordingRef.current) return;
    recordingRef.current = false;
    if (opts?.auto) setAutoStopped(true);
    clearTimers();
    durationRef.current = Math.round((Date.now() - startedAtRef.current) / 1000);
    const rec = recorderRef.current;
    if (rec && rec.state !== "inactive") {
      // onstop enqueues the final partial segment
      rec.stop();
    }
    teardownStream();
    // give onstop a tick to enqueue the tail
    setTimeout(() => { void finish(); }, 250);
  }, [finish]);

  const start = useCallback(async () => {
    setError(null);
    setAutoStopped(false);
    setTranscript("");
    setBullets([]);
    setSttModel(null);
    transcriptPartsRef.current = [];
    chunkQueueRef.current = Promise.resolve();
    setElapsed(0);
    durationRef.current = 0;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      });
      streamRef.current = stream;
      stream.getAudioTracks().forEach((track) => {
        track.onended = () => { if (recordingRef.current) stop({ auto: true }); };
      });
    } catch (e: any) {
      console.error("[recorder] mic permission denied", e);
      setError("Microphone access is needed to record this conversation.");
      setStatus("error");
      return false;
    }

    recordingRef.current = true;
    startedAtRef.current = Date.now();
    setStatus("recording");
    startSegment();

    tickRef.current = setInterval(() => {
      const secs = Math.round((Date.now() - startedAtRef.current) / 1000);
      setElapsed(secs);
      if (secs >= MAX_RECORDING_SECONDS) stop({ auto: true });
    }, 500);

    return true;
  }, [startSegment, stop]);

  // iOS backgrounding: auto-stop and keep the partial recording.
  useEffect(() => {
    const onHide = () => {
      if (recordingRef.current && document.visibilityState === "hidden") stop({ auto: true });
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", onHide);
    };
  }, [stop]);

  // Cleanup on unmount: never leave the mic open.
  useEffect(() => () => {
    recordingRef.current = false;
    clearTimers();
    try { recorderRef.current?.stop(); } catch { /* noop */ }
    teardownStream();
  }, []);

  const reset = useCallback(() => {
    setStatus("idle");
    setError(null);
    setTranscript("");
    setBullets([]);
    setElapsed(0);
    setSttModel(null);
    setAutoStopped(false);
    transcriptPartsRef.current = [];
    durationRef.current = 0;
  }, []);

  return {
    status,
    elapsed,
    error,
    transcript,
    setTranscript,
    bullets,
    setBullets,
    sttModel,
    pendingChunks,
    autoStopped,
    durationSeconds: durationRef.current,
    start,
    stop: () => stop(),
    reset,
    isRecording: status === "recording",
  };
}
