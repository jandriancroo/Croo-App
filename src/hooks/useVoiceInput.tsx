import { useState, useCallback, useRef, useEffect } from "react";

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

export const useVoiceInput = ({ onTranscript, continuous = true }: UseVoiceInputOptions) => {
  const [isListening, setIsListening] = useState(false);
  const [isSupported, setIsSupported] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const isListeningRef = useRef(false);

  // Keep ref in sync with state
  useEffect(() => {
    isListeningRef.current = isListening;
  }, [isListening]);

  useEffect(() => {
    // Check for browser support
    const SpeechRecognitionClass = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    setIsSupported(!!SpeechRecognitionClass);

    if (SpeechRecognitionClass) {
      const recognition = new SpeechRecognitionClass() as SpeechRecognitionInstance;
      recognition.continuous = continuous;
      recognition.interimResults = false;
      recognition.lang = 'en-US';

      recognition.onresult = (event: SpeechRecognitionEventType) => {
        const lastResult = event.results[event.results.length - 1];
        if (lastResult.isFinal) {
          const transcript = lastResult[0].transcript.trim();
          console.log('[Voice] Transcript:', transcript);
          if (transcript) {
            onTranscript(transcript);
          }
        }
      };

      recognition.onerror = (event: SpeechRecognitionErrorEventType) => {
        console.error('[Voice] Error:', event.error);
        if (event.error === 'not-allowed') {
          setIsListening(false);
        }
      };

      recognition.onend = () => {
        console.log('[Voice] Recognition ended, isListening:', isListeningRef.current);
        // Restart if we're supposed to be listening (continuous mode)
        if (isListeningRef.current && continuous) {
          try {
            setTimeout(() => {
              if (isListeningRef.current) {
                recognition.start();
              }
            }, 100);
          } catch (e) {
            console.error('[Voice] Restart failed:', e);
          }
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
  }, [continuous, onTranscript]);

  const startListening = useCallback(async () => {
    if (!recognitionRef.current) return;

    try {
      // Request microphone permission first
      await navigator.mediaDevices.getUserMedia({ audio: true });
      recognitionRef.current.start();
      setIsListening(true);
      console.log('[Voice] Started listening');
    } catch (error) {
      console.error('[Voice] Failed to start:', error);
    }
  }, []);

  const stopListening = useCallback(() => {
    if (!recognitionRef.current) return;

    try {
      setIsListening(false);
      recognitionRef.current.stop();
      console.log('[Voice] Stopped listening');
    } catch (error) {
      console.error('[Voice] Failed to stop:', error);
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
