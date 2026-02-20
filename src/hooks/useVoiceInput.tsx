import { useState, useCallback, useRef, useEffect } from "react";
import { useScribe, CommitStrategy } from "@elevenlabs/react";
import { supabase } from "@/integrations/supabase/client";

interface UseVoiceInputOptions {
  onTranscript: (transcript: string) => void;
  continuous?: boolean;
  silenceTimeoutMs?: number;
}

// Type definitions for Web Speech API
interface SpeechRecognitionResult {
  isFinal: boolean;
  [index: number]: SpeechRecognitionAlternative;
}
interface SpeechRecognitionAlternative {
  transcript: string;
  confidence: number;
}
interface SpeechRecognitionResultList {
  length: number;
  [index: number]: SpeechRecognitionResult;
}
interface SpeechRecognitionEventType extends Event {
  results: SpeechRecognitionResultList;
}
interface SpeechRecognitionErrorEventType extends Event {
  error: string;
}
interface SpeechRecognitionInstance extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  onresult: ((event: SpeechRecognitionEventType) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventType) => void) | null;
  onend: (() => void) | null;
}

const hasNativeSpeechAPI = () => {
  return !!(
    (window as any).SpeechRecognition ||
    (window as any).webkitSpeechRecognition
  );
};

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
  } catch (e) {
    // ignore
  }
};

// Hook that uses native Web Speech API
const useNativeSpeechRecognition = ({
  onTranscript,
  continuous = true,
  silenceTimeoutMs = 8000,
}: UseVoiceInputOptions) => {
  const [isListening, setIsListening] = useState(false);
  const [isSupported, setIsSupported] = useState(false);

  // All mutable state in refs so handlers never go stale
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const isListeningRef = useRef(false);
  const onTranscriptRef = useRef(onTranscript);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const silenceTimeoutMsRef = useRef(silenceTimeoutMs);
  const continuousRef = useRef(continuous);
  const restartAttemptsRef = useRef(0);
  const MAX_RESTART_ATTEMPTS = 10;

  // Keep refs in sync with latest props each render — no effect needed
  onTranscriptRef.current = onTranscript;
  silenceTimeoutMsRef.current = silenceTimeoutMs;
  continuousRef.current = continuous;

  const clearSilenceTimer = useCallback(() => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
  }, []);

  const startSilenceTimer = useCallback(() => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
    silenceTimerRef.current = setTimeout(() => {
      if (isListeningRef.current) {
        console.log("[Voice Native] Silence timeout — auto-deactivating mic");
        isListeningRef.current = false;
        setIsListening(false);
        try { recognitionRef.current?.stop(); } catch (e) { /* ignore */ }
        playTimeoutChime();
      }
    }, silenceTimeoutMsRef.current);
  }, []);

  // Initialize recognition ONCE on mount — stable effect, no changing deps
  useEffect(() => {
    const SpeechRecognitionClass =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;

    setIsSupported(!!SpeechRecognitionClass);
    if (!SpeechRecognitionClass) return;

    const recognition = new SpeechRecognitionClass() as SpeechRecognitionInstance;
    recognition.continuous = true; // Always true; we manage restarts manually
    recognition.interimResults = true;
    recognition.lang = "en-US";

    recognition.onresult = (event: SpeechRecognitionEventType) => {
      // Reset silence timer on ANY speech (interim or final) — prevents mid-sentence timeout
      startSilenceTimer();
      restartAttemptsRef.current = 0; // Successful speech resets the attempt counter

      const lastResult = event.results[event.results.length - 1];
      if (lastResult.isFinal) {
        const transcript = lastResult[0].transcript.trim();
        console.log("[Voice Native] Final transcript:", transcript);
        if (transcript) {
          onTranscriptRef.current(transcript);
        }
      }
    };

    recognition.onerror = (event: SpeechRecognitionErrorEventType) => {
      console.error("[Voice Native] Error:", event.error);
      if (event.error === "not-allowed") {
        clearSilenceTimer();
        isListeningRef.current = false;
        setIsListening(false);
        restartAttemptsRef.current = 0;
      }
      // 'aborted', 'no-speech', 'network' are normal — onend handles restart
    };

    recognition.onend = () => {
      console.log(
        "[Voice Native] onend, shouldContinue:",
        isListeningRef.current,
        "attempts:",
        restartAttemptsRef.current
      );

      if (!isListeningRef.current || !continuousRef.current) {
        setIsListening(false);
        return;
      }

      // Guard: too many failed restarts → give up
      if (restartAttemptsRef.current >= MAX_RESTART_ATTEMPTS) {
        console.warn("[Voice Native] Max restart attempts reached — stopping");
        isListeningRef.current = false;
        setIsListening(false);
        restartAttemptsRef.current = 0;
        clearSilenceTimer();
        playTimeoutChime();
        return;
      }

      restartAttemptsRef.current += 1;

      // Short delay then restart so the browser releases the mic handle
      setTimeout(() => {
        if (!isListeningRef.current || !recognitionRef.current) return;
        try {
          recognitionRef.current.start();
          console.log(
            "[Voice Native] Restarted (attempt",
            restartAttemptsRef.current,
            ")"
          );
        } catch (e: any) {
          if (e?.name === "InvalidStateError") {
            // Already running — this is fine
            restartAttemptsRef.current = Math.max(0, restartAttemptsRef.current - 1);
            return;
          }
          console.error("[Voice Native] Restart failed:", e);
          // One more retry after a longer pause
          setTimeout(() => {
            if (!isListeningRef.current || !recognitionRef.current) return;
            try {
              recognitionRef.current.start();
            } catch (e2) {
              console.error("[Voice Native] Retry also failed — stopping:", e2);
              clearSilenceTimer();
              isListeningRef.current = false;
              setIsListening(false);
              restartAttemptsRef.current = 0;
            }
          }, 600);
        }
      }, 200);
    };

    recognitionRef.current = recognition;

    return () => {
      clearSilenceTimer();
      isListeningRef.current = false;
      try { recognition.stop(); } catch (e) { /* ignore */ }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Empty deps — recognition is stable for the component lifetime

  const startListening = useCallback(async () => {
    if (!recognitionRef.current) {
      console.error("[Voice Native] Recognition not available");
      return;
    }
    if (isListeningRef.current) return; // Already listening

    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });

      // Stop any browser TTS that might compete with the microphone
      if ("speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }

      restartAttemptsRef.current = 0;
      isListeningRef.current = true;
      setIsListening(true);
      recognitionRef.current.start();
      startSilenceTimer();
      console.log("[Voice Native] Started listening");
    } catch (error) {
      console.error("[Voice Native] Failed to start:", error);
      isListeningRef.current = false;
      setIsListening(false);
    }
  }, [startSilenceTimer]);

  const stopListening = useCallback(() => {
    clearSilenceTimer();
    restartAttemptsRef.current = MAX_RESTART_ATTEMPTS; // Prevent onend from restarting
    isListeningRef.current = false;
    setIsListening(false);
    try { recognitionRef.current?.stop(); } catch (e) { /* ignore */ }
    // Reset after a tick so future starts work
    setTimeout(() => { restartAttemptsRef.current = 0; }, 300);
    console.log("[Voice Native] Stopped listening");
  }, [clearSilenceTimer]);

  const toggleListening = useCallback(() => {
    if (isListening) {
      stopListening();
    } else {
      startListening();
    }
  }, [isListening, startListening, stopListening]);

  return { isListening, isSupported, startListening, stopListening, toggleListening };
};

// Hook that uses ElevenLabs Scribe API (works on iOS)
const useElevenLabsScribe = ({ onTranscript }: UseVoiceInputOptions) => {
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const onTranscriptRef = useRef(onTranscript);
  onTranscriptRef.current = onTranscript;

  const scribe = useScribe({
    modelId: "scribe_v2_realtime",
    commitStrategy: CommitStrategy.VAD,
    onCommittedTranscript: (data) => {
      console.log("[Voice ElevenLabs] Committed transcript:", data.text);
      if (data.text?.trim()) {
        onTranscriptRef.current(data.text.trim());
      }
    },
    onPartialTranscript: (data) => {
      console.log("[Voice ElevenLabs] Partial:", data.text);
    },
  });

  const startListening = useCallback(async () => {
    if (isConnecting || scribe.isConnected) return;
    setIsConnecting(true);
    console.log("[Voice ElevenLabs] Getting scribe token...");
    try {
      const { data, error } = await supabase.functions.invoke(
        "elevenlabs-service?action=scribe-token"
      );
      if (error) throw error;
      if (!data?.token) throw new Error("No token received");
      console.log("[Voice ElevenLabs] Connecting with token...");
      await scribe.connect({
        token: data.token,
        microphone: { echoCancellation: true, noiseSuppression: true },
      });
      setIsConnected(true);
      console.log("[Voice ElevenLabs] Connected and listening");
    } catch (error) {
      console.error("[Voice ElevenLabs] Failed to start:", error);
      setIsConnected(false);
    } finally {
      setIsConnecting(false);
    }
  }, [isConnecting, scribe]);

  const stopListening = useCallback(() => {
    console.log("[Voice ElevenLabs] Stopping...");
    scribe.disconnect();
    setIsConnected(false);
  }, [scribe]);

  const toggleListening = useCallback(() => {
    if (isConnected || scribe.isConnected) {
      stopListening();
    } else {
      startListening();
    }
  }, [isConnected, scribe.isConnected, startListening, stopListening]);

  useEffect(() => {
    setIsConnected(scribe.isConnected);
  }, [scribe.isConnected]);

  return {
    isListening: isConnected || scribe.isConnected,
    isSupported: true,
    startListening,
    stopListening,
    toggleListening,
  };
};

// Main hook — picks the best available engine
export const useVoiceInput = (options: UseVoiceInputOptions) => {
  const useNativeRef = useRef(hasNativeSpeechAPI());
  const nativeHook = useNativeSpeechRecognition(options);
  const elevenLabsHook = useElevenLabsScribe(options);

  if (useNativeRef.current) {
    return nativeHook;
  } else {
    return elevenLabsHook;
  }
};
