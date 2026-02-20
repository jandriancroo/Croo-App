import { useState, useCallback, useRef, useEffect } from "react";
import { useScribe, CommitStrategy } from "@elevenlabs/react";
import { supabase } from "@/integrations/supabase/client";

interface UseVoiceInputOptions {
  onTranscript: (transcript: string) => void;
  continuous?: boolean;
  silenceTimeoutMs?: number; // Auto-deactivate after this many ms of silence (default 8000)
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

// Check if native Web Speech API is available
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
    osc.frequency.setValueAtTime(440, ctx.currentTime);       // A4
    osc.frequency.setValueAtTime(330, ctx.currentTime + 0.12); // E4 (descending = "off")
    gain.gain.setValueAtTime(0.25, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.35);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.35);
    setTimeout(() => ctx.close(), 500);
  } catch (e) {
    // Ignore
  }
};

// Hook that uses native Web Speech API
const useNativeSpeechRecognition = ({ onTranscript, continuous = true, silenceTimeoutMs = 8000 }: UseVoiceInputOptions) => {
  const [isListening, setIsListening] = useState(false);
  const [isSupported, setIsSupported] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  // Independent ref — NOT synced to state — so async handlers read correct intent
  const isListeningRef = useRef(false);
  const onTranscriptRef = useRef(onTranscript);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  onTranscriptRef.current = onTranscript;

  const clearSilenceTimer = useCallback(() => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
  }, []);

  const startSilenceTimer = useCallback(() => {
    clearSilenceTimer();
    silenceTimerRef.current = setTimeout(() => {
      // Silence timeout — deactivate mic and notify user
      if (isListeningRef.current) {
        console.log('[Voice Native] Silence timeout — auto-deactivating mic');
        isListeningRef.current = false;
        setIsListening(false);
        try { recognitionRef.current?.stop(); } catch (e) { /* ignore */ }
        playTimeoutChime();
      }
    }, silenceTimeoutMs);
  }, [clearSilenceTimer, silenceTimeoutMs]);

  useEffect(() => {
    const SpeechRecognitionClass = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    setIsSupported(!!SpeechRecognitionClass);

    if (SpeechRecognitionClass) {
      const recognition = new SpeechRecognitionClass() as SpeechRecognitionInstance;
      recognition.continuous = continuous;
      recognition.interimResults = true; // Must be true so interim speech resets the silence timer
      recognition.lang = 'en-US';

      recognition.onresult = (event: SpeechRecognitionEventType) => {
        const lastResult = event.results[event.results.length - 1];

        // Reset silence timer on ANY speech activity (interim or final)
        // This prevents the timer from killing the session mid-sentence
        startSilenceTimer();

        if (lastResult.isFinal) {
          const transcript = lastResult[0].transcript.trim();
          console.log('[Voice Native] Final transcript:', transcript);
          if (transcript) {
            onTranscriptRef.current(transcript);
          }
        }
      };

      recognition.onerror = (event: SpeechRecognitionErrorEventType) => {
        console.error('[Voice Native] Error:', event.error);
        // Only stop on explicit mic denial
        if (event.error === 'not-allowed') {
          clearSilenceTimer();
          isListeningRef.current = false;
          setIsListening(false);
        }
        // 'aborted', 'no-speech', 'network' are all normal — onend will restart
      };

      recognition.onend = () => {
        console.log('[Voice Native] Recognition ended, shouldContinue:', isListeningRef.current);
        // Restart the browser session so silence timer stays in control
        if (isListeningRef.current && continuous) {
          setTimeout(() => {
            if (!isListeningRef.current || !recognitionRef.current) return;
            try {
              recognitionRef.current.start();
            } catch (e: any) {
              if (e?.name === 'InvalidStateError') return; // already running
              console.error('[Voice Native] Restart failed:', e);
              // Retry once
              setTimeout(() => {
                if (!isListeningRef.current || !recognitionRef.current) return;
                try { recognitionRef.current.start(); } catch (e2) {
                  console.error('[Voice Native] Retry also failed:', e2);
                  clearSilenceTimer();
                  isListeningRef.current = false;
                  setIsListening(false);
                }
              }, 500);
            }
          }, 250);
        } else if (!isListeningRef.current) {
          setIsListening(false);
        }
      };

      recognitionRef.current = recognition;
    }

    return () => {
      clearSilenceTimer();
      try { recognitionRef.current?.stop(); } catch (e) { /* ignore */ }
    };
  }, [continuous, startSilenceTimer, clearSilenceTimer]);

  const startListening = useCallback(async () => {
    if (!recognitionRef.current) {
      console.error('[Voice Native] Recognition not available');
      return;
    }

    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });
      isListeningRef.current = true;
      recognitionRef.current.start();
      setIsListening(true);
      startSilenceTimer(); // Start silence countdown immediately
      console.log('[Voice Native] Started listening');
    } catch (error) {
      console.error('[Voice Native] Failed to start:', error);
      isListeningRef.current = false;
      setIsListening(false);
    }
  }, [startSilenceTimer]);

  const stopListening = useCallback(() => {
    if (!recognitionRef.current) return;
    clearSilenceTimer();
    isListeningRef.current = false;
    setIsListening(false);
    try { recognitionRef.current.stop(); } catch (e) { /* ignore */ }
    console.log('[Voice Native] Stopped listening');
  }, [clearSilenceTimer]);

  const toggleListening = useCallback(() => {
    if (isListening) {
      stopListening();
    } else {
      startListening();
    }
  }, [isListening, startListening, stopListening]);

  return {
    isListening,
    isSupported,
    startListening,
    stopListening,
    toggleListening,
  };
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
      console.log('[Voice ElevenLabs] Committed transcript:', data.text);
      if (data.text?.trim()) {
        onTranscriptRef.current(data.text.trim());
      }
    },
    onPartialTranscript: (data) => {
      console.log('[Voice ElevenLabs] Partial:', data.text);
    },
  });

  const startListening = useCallback(async () => {
    if (isConnecting || scribe.isConnected) return;

    setIsConnecting(true);
    console.log('[Voice ElevenLabs] Getting scribe token...');

    try {
      const { data, error } = await supabase.functions.invoke("elevenlabs-service?action=scribe-token");

      if (error) throw error;
      if (!data?.token) throw new Error("No token received");

      console.log('[Voice ElevenLabs] Connecting with token...');
      await scribe.connect({
        token: data.token,
        microphone: {
          echoCancellation: true,
          noiseSuppression: true,
        },
      });

      setIsConnected(true);
      console.log('[Voice ElevenLabs] Connected and listening');
    } catch (error) {
      console.error('[Voice ElevenLabs] Failed to start:', error);
      setIsConnected(false);
    } finally {
      setIsConnecting(false);
    }
  }, [isConnecting, scribe]);

  const stopListening = useCallback(() => {
    console.log('[Voice ElevenLabs] Stopping...');
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

  // Sync state with scribe.isConnected
  useEffect(() => {
    setIsConnected(scribe.isConnected);
  }, [scribe.isConnected]);

  return {
    isListening: isConnected || scribe.isConnected,
    isSupported: true, // ElevenLabs works everywhere with microphone access
    startListening,
    stopListening,
    toggleListening,
  };
};

// Main hook that chooses the best available speech recognition
export const useVoiceInput = (options: UseVoiceInputOptions) => {
  // Capture once at mount so the hook order never changes between renders
  const useNativeRef = useRef(hasNativeSpeechAPI());

  const nativeHook = useNativeSpeechRecognition(options);
  const elevenLabsHook = useElevenLabsScribe(options);

  // Prefer native Web Speech API when available (faster, no API costs)
  // Fall back to ElevenLabs for iOS and unsupported browsers
  if (useNativeRef.current) {
    return nativeHook;
  } else {
    return elevenLabsHook;
  }
};
