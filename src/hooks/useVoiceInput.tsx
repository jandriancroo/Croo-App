import { useState, useCallback, useRef, useEffect } from "react";
import { useScribe, CommitStrategy } from "@elevenlabs/react";
import { supabase } from "@/integrations/supabase/client";

interface UseVoiceInputOptions {
  onTranscript: (transcript: string) => void;
  continuous?: boolean;
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

// Hook that uses native Web Speech API
const useNativeSpeechRecognition = ({ onTranscript, continuous = true }: UseVoiceInputOptions) => {
  const [isListening, setIsListening] = useState(false);
  const [isSupported, setIsSupported] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  // Use an independent ref (NOT synced to state) so onend can reliably check intent
  const isListeningRef = useRef(false);
  const onTranscriptRef = useRef(onTranscript);

  onTranscriptRef.current = onTranscript;

  useEffect(() => {
    const SpeechRecognitionClass = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    setIsSupported(!!SpeechRecognitionClass);

    if (SpeechRecognitionClass) {
      const recognition = new SpeechRecognitionClass() as SpeechRecognitionInstance;
      recognition.continuous = continuous;
      recognition.interimResults = false;
      recognition.lang = 'en-US';

      recognition.onresult = (event: SpeechRecognitionEventType) => {
        console.log('[Voice Native] Got result event');
        const lastResult = event.results[event.results.length - 1];
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
        if (event.error === 'not-allowed' || event.error === 'aborted') {
          setIsListening(false);
        }
      };

      recognition.onend = () => {
        console.log('[Voice Native] Recognition ended, shouldContinue:', isListeningRef.current);
        if (isListeningRef.current && continuous) {
          setTimeout(() => {
            if (isListeningRef.current && recognitionRef.current) {
              try {
                console.log('[Voice Native] Restarting...');
                recognitionRef.current.start();
              } catch (e) {
                console.error('[Voice Native] Restart failed:', e);
                setIsListening(false);
              }
            }
          }, 100);
        } else {
          setIsListening(false);
        }
      };

      recognitionRef.current = recognition;
    }

    return () => {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch (e) {
          // Ignore
        }
      }
    };
  }, [continuous]);

  const startListening = useCallback(async () => {
    if (!recognitionRef.current) {
      console.error('[Voice Native] Recognition not available');
      return;
    }

    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });
      isListeningRef.current = true; // Set ref BEFORE starting so onend can restart
      recognitionRef.current.start();
      setIsListening(true);
      console.log('[Voice Native] Started listening');
    } catch (error) {
      console.error('[Voice Native] Failed to start:', error);
      isListeningRef.current = false;
      setIsListening(false);
    }
  }, []);

  const stopListening = useCallback(() => {
    if (!recognitionRef.current) return;

    try {
      isListeningRef.current = false; // Clear ref BEFORE stopping so onend doesn't restart
      setIsListening(false);
      recognitionRef.current.stop();
      console.log('[Voice Native] Stopped listening');
    } catch (error) {
      console.error('[Voice Native] Failed to stop:', error);
    }
  }, []);

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
  const nativeHook = useNativeSpeechRecognition(options);
  const elevenLabsHook = useElevenLabsScribe(options);

  // Prefer native Web Speech API when available (faster, no API costs)
  // Fall back to ElevenLabs for iOS and unsupported browsers
  if (hasNativeSpeechAPI()) {
    console.log('[Voice] Using native Web Speech API');
    return nativeHook;
  } else {
    console.log('[Voice] Using ElevenLabs Scribe (fallback for iOS)');
    return elevenLabsHook;
  }
};
