import { useState, useCallback, useRef, useEffect } from "react";

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

const isIOSDevice = () => {
  if (typeof navigator === 'undefined') return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent);
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

// Hook that uses native Web Speech API (Chrome, Android, desktop)
const useNativeSpeechRecognition = ({
  onTranscript,
  continuous = true,
  silenceTimeoutMs = 8000,
}: UseVoiceInputOptions) => {
  const [isListening, setIsListening] = useState(false);
  const [isSupported, setIsSupported] = useState(false);

  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const isListeningRef = useRef(false);
  const onTranscriptRef = useRef(onTranscript);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const silenceTimeoutMsRef = useRef(silenceTimeoutMs);
  const continuousRef = useRef(continuous);
  const restartAttemptsRef = useRef(0);
  const MAX_RESTART_ATTEMPTS = 10;

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

  useEffect(() => {
    const SpeechRecognitionClass =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;

    setIsSupported(!!SpeechRecognitionClass);
    if (!SpeechRecognitionClass) return;

    const recognition = new SpeechRecognitionClass() as SpeechRecognitionInstance;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    recognition.onresult = (event: SpeechRecognitionEventType) => {
      startSilenceTimer();
      restartAttemptsRef.current = 0;

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
    };

    recognition.onend = () => {
      console.log("[Voice Native] onend, shouldContinue:", isListeningRef.current, "attempts:", restartAttemptsRef.current);

      if (!isListeningRef.current || !continuousRef.current) {
        setIsListening(false);
        return;
      }

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

      setTimeout(() => {
        if (!isListeningRef.current || !recognitionRef.current) return;
        try {
          recognitionRef.current.start();
          console.log("[Voice Native] Restarted (attempt", restartAttemptsRef.current, ")");
        } catch (e: any) {
          if (e?.name === "InvalidStateError") {
            restartAttemptsRef.current = Math.max(0, restartAttemptsRef.current - 1);
            return;
          }
          console.error("[Voice Native] Restart failed:", e);
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
  }, []);

  const startListening = useCallback(async () => {
    if (!recognitionRef.current) {
      console.error("[Voice Native] Recognition not available");
      return;
    }
    if (isListeningRef.current) return;

    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });

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
    restartAttemptsRef.current = MAX_RESTART_ATTEMPTS;
    isListeningRef.current = false;
    setIsListening(false);
    try { recognitionRef.current?.stop(); } catch (e) { /* ignore */ }
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

// Main hook — uses native Web Speech API on Chrome/Android, skips iOS (handled separately)
export const useVoiceInput = (options: UseVoiceInputOptions) => {
  const nativeHook = useNativeSpeechRecognition(options);

  // On iOS, native speech is unreliable — return unsupported so the component
  // can use useAudioVoiceInput instead
  if (isIOSDevice()) {
    return {
      isListening: false,
      isSupported: false,
      startListening: async () => {},
      stopListening: () => {},
      toggleListening: () => {},
    };
  }

  return nativeHook;
};
