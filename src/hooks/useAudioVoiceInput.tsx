import { useState, useCallback, useRef, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

interface UseAudioVoiceInputOptions {
  onResult: (commands: any[], transcript: string) => void;
  onPending?: (transcript: string) => void;
  onError?: (message: string) => void;
  items: { item_id: string; item_name: string }[];
  silenceTimeoutMs?: number;
}

// Plays a soft descending two-note chime to signal mic auto-deactivation
const playTimeoutChime = () => {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = "sine";
    osc.frequency.setValueAtTime(440, ctx.currentTime);
    osc.frequency.setValueAtTime(330, ctx.currentTime + 0.12);
    gain.gain.setValueAtTime(0.25, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.35);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.35);
    setTimeout(() => ctx.close(), 500);
  } catch (e) { /* ignore */ }
};

/**
 * Audio-based voice input for iOS PWA (Safari doesn't support SpeechRecognition reliably).
 * Records audio chunks via MediaRecorder, sends to Gemini Flash Lite for
 * transcription + item matching in a single round trip.
 * 
 * Features:
 * - 16kHz mono opus for small uploads
 * - Silence detection via AudioAnalyser (auto-send after 1.5s silence)
 * - Queued processing (chunks queue up and process sequentially, never dropped)
 * - Fallback to full clip on network error
 */
export const useAudioVoiceInput = ({
  onResult,
  onPending,
  onError,
  items,
  silenceTimeoutMs = 8000,
}: UseAudioVoiceInputOptions) => {
  const [isListening, setIsListening] = useState(false);
  const isListeningRef = useRef(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const overallSilenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const fullChunksRef = useRef<Blob[]>([]); // Fallback: all audio since start
  const rafRef = useRef<number | null>(null);
  const itemsRef = useRef(items);
  const onResultRef = useRef(onResult);
  const onPendingRef = useRef(onPending);
  const onErrorRef = useRef(onError);

  // Queue for processing audio chunks sequentially
  const sendQueueRef = useRef<Blob[]>([]);
  const isProcessingQueueRef = useRef(false);

  // Keep refs in sync
  itemsRef.current = items;
  onResultRef.current = onResult;
  onPendingRef.current = onPending;
  onErrorRef.current = onError;

  const clearTimers = useCallback(() => {
    if (silenceTimerRef.current) { clearTimeout(silenceTimerRef.current); silenceTimerRef.current = null; }
    if (overallSilenceTimerRef.current) { clearTimeout(overallSilenceTimerRef.current); overallSilenceTimerRef.current = null; }
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
  }, []);

  // Process a single audio blob
  const processAudioBlob = useCallback(async (audioBlob: Blob) => {
    try {
      const arrayBuffer = await audioBlob.arrayBuffer();
      const uint8Array = new Uint8Array(arrayBuffer);
      let binary = '';
      for (let i = 0; i < uint8Array.length; i++) {
        binary += String.fromCharCode(uint8Array[i]);
      }
      const base64 = btoa(binary);

      console.log(`[AudioVoice] Sending chunk: ${(audioBlob.size / 1024).toFixed(1)}KB`);

      const { data, error } = await supabase.functions.invoke(
        'ai-extraction-service?action=parse-inventory-audio',
        {
          body: {
            audioBase64: base64,
            mimeType: audioBlob.type || 'audio/webm;codecs=opus',
            items: itemsRef.current,
          },
        }
      );

      if (error) throw error;

      if (data?.transcript) {
        console.log(`[AudioVoice] Transcript: "${data.transcript}"`);
        if (data.commands?.length > 0) {
          onResultRef.current(data.commands, data.transcript);
        } else if (data.transcript.trim()) {
          onErrorRef.current?.(`Didn't catch that — try again`);
        }
      }
    } catch (err) {
      console.error('[AudioVoice] Send error:', err);
      onErrorRef.current?.(`Voice processing failed — try again`);
    }
  }, []);

  // Drain the queue sequentially
  const drainQueue = useCallback(async () => {
    if (isProcessingQueueRef.current) return;
    isProcessingQueueRef.current = true;

    while (sendQueueRef.current.length > 0) {
      const blob = sendQueueRef.current.shift()!;
      await processAudioBlob(blob);
    }

    isProcessingQueueRef.current = false;
  }, [processAudioBlob]);

  // Enqueue an audio chunk for processing (never drops)
  const enqueueAudioChunk = useCallback((audioBlob: Blob) => {
    if (audioBlob.size < 500) return;
    sendQueueRef.current.push(audioBlob);
    console.log(`[AudioVoice] Queued chunk (${sendQueueRef.current.length} in queue)`);
    drainQueue();
  }, [drainQueue]);

  // Monitor audio levels for silence detection
  const monitorSilence = useCallback(() => {
    if (!analyserRef.current || !isListeningRef.current) return;

    const analyser = analyserRef.current;
    const dataArray = new Uint8Array(analyser.fftSize);

    const check = () => {
      if (!isListeningRef.current) return;
      analyser.getByteTimeDomainData(dataArray);

      // Calculate RMS volume
      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) {
        const val = (dataArray[i] - 128) / 128;
        sum += val * val;
      }
      const rms = Math.sqrt(sum / dataArray.length);

      if (rms > 0.015) {
        // Speech detected — reset silence timer
        if (silenceTimerRef.current) {
          clearTimeout(silenceTimerRef.current);
          silenceTimerRef.current = null;
        }
        // Reset overall silence timer too
        if (overallSilenceTimerRef.current) {
          clearTimeout(overallSilenceTimerRef.current);
          overallSilenceTimerRef.current = setTimeout(() => {
            if (isListeningRef.current) {
              console.log("[AudioVoice] Overall silence timeout — stopping");
              stopListening();
              playTimeoutChime();
            }
          }, silenceTimeoutMs);
        }
      } else if (!silenceTimerRef.current && isListeningRef.current) {
        // Silence started — send chunk after 1.5s
        silenceTimerRef.current = setTimeout(() => {
          silenceTimerRef.current = null;
          if (!isListeningRef.current) return;

          // Harvest current chunks
          const recorder = mediaRecorderRef.current;
          if (recorder && recorder.state === 'recording') {
            recorder.requestData(); // triggers ondataavailable
          }
        }, 1500);
      }

      rafRef.current = requestAnimationFrame(check);
    };

    rafRef.current = requestAnimationFrame(check);
  }, [silenceTimeoutMs]);

  const startListening = useCallback(async () => {
    if (isListeningRef.current) return;

    try {
      // Stop any browser TTS
      if ("speechSynthesis" in window) window.speechSynthesis.cancel();

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 16000,
          channelCount: 1,
        },
      });

      streamRef.current = stream;

      // Set up audio analyser for silence detection
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      audioContextRef.current = audioContext;
      analyserRef.current = analyser;

      // Determine best supported format
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/mp4')
          ? 'audio/mp4'
          : '';

      const recorder = new MediaRecorder(stream, {
        mimeType: mimeType || undefined,
        audioBitsPerSecond: 32000,
      });

      chunksRef.current = [];
      fullChunksRef.current = [];
      sendQueueRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
          fullChunksRef.current.push(e.data);

          // Build blob from accumulated chunks and enqueue
          const blob = new Blob(chunksRef.current, { type: mimeType || 'audio/webm' });
          chunksRef.current = []; // Reset for next chunk

          if (blob.size > 500) {
            onPendingRef.current?.("Processing...");
            enqueueAudioChunk(blob);
          }
        }
      };

      recorder.start(3000); // Collect data every 3 seconds as backup
      mediaRecorderRef.current = recorder;

      isListeningRef.current = true;
      setIsListening(true);

      // Start silence monitoring
      monitorSilence();

      // Overall silence timeout
      overallSilenceTimerRef.current = setTimeout(() => {
        if (isListeningRef.current) {
          console.log("[AudioVoice] Overall silence timeout — stopping");
          stopListening();
          playTimeoutChime();
        }
      }, silenceTimeoutMs);

      console.log("[AudioVoice] Started listening");
    } catch (error) {
      console.error("[AudioVoice] Failed to start:", error);
      isListeningRef.current = false;
      setIsListening(false);
      onErrorRef.current?.("Microphone access denied");
    }
  }, [silenceTimeoutMs, monitorSilence, enqueueAudioChunk]);

  const stopListening = useCallback(() => {
    clearTimers();
    isListeningRef.current = false;
    setIsListening(false);

    // Stop recorder
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop();
    }
    mediaRecorderRef.current = null;

    // Stop stream tracks
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;

    // Close audio context
    if (audioContextRef.current?.state !== 'closed') {
      audioContextRef.current?.close().catch(() => {});
    }
    audioContextRef.current = null;
    analyserRef.current = null;

    // Send any remaining audio as fallback (only if queue is empty)
    if (fullChunksRef.current.length > 0 && sendQueueRef.current.length === 0 && !isProcessingQueueRef.current) {
      const blob = new Blob(fullChunksRef.current, { type: 'audio/webm' });
      if (blob.size > 1000) {
        console.log("[AudioVoice] Sending remaining audio on stop");
        enqueueAudioChunk(blob);
      }
    }
    fullChunksRef.current = [];
    chunksRef.current = [];

    console.log("[AudioVoice] Stopped listening");
  }, [clearTimers, enqueueAudioChunk]);

  const toggleListening = useCallback(() => {
    if (isListening) {
      stopListening();
    } else {
      startListening();
    }
  }, [isListening, startListening, stopListening]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      clearTimers();
      isListeningRef.current = false;
      mediaRecorderRef.current?.stop();
      streamRef.current?.getTracks().forEach(t => t.stop());
      audioContextRef.current?.close().catch(() => {});
    };
  }, [clearTimers]);

  return {
    isListening,
    isSupported: typeof MediaRecorder !== 'undefined',
    startListening,
    stopListening,
    toggleListening,
  };
};
