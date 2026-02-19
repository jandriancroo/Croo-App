import { useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";

// Simple success/error chime using Web Audio API (no external files needed)
const createAudioContext = () => {
  return new (window.AudioContext || (window as any).webkitAudioContext)();
};

const playSuccessChime = () => {
  try {
    const ctx = createAudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    
    // Pleasant ascending two-note chime
    osc.type = "sine";
    osc.frequency.setValueAtTime(523.25, ctx.currentTime); // C5
    osc.frequency.setValueAtTime(659.25, ctx.currentTime + 0.1); // E5
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
    
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.3);
    
    setTimeout(() => ctx.close(), 500);
  } catch (e) {
    console.warn("[VoiceFeedback] Chime failed:", e);
  }
};

const playErrorBuzz = () => {
  try {
    const ctx = createAudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    
    // Low descending buzz
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(300, ctx.currentTime);
    osc.frequency.setValueAtTime(200, ctx.currentTime + 0.15);
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.25);
    
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.25);
    
    setTimeout(() => ctx.close(), 400);
  } catch (e) {
    console.warn("[VoiceFeedback] Error buzz failed:", e);
  }
};

export const useInventoryVoiceFeedback = () => {
  const ttsQueueRef = useRef<string[]>([]);
  const isSpeakingRef = useRef(false);

  // Process TTS queue sequentially
  const processQueue = useCallback(async () => {
    if (isSpeakingRef.current || ttsQueueRef.current.length === 0) return;
    
    isSpeakingRef.current = true;
    const text = ttsQueueRef.current.shift()!;
    
    try {
      const { data, error } = await supabase.functions.invoke(
        "elevenlabs-service?action=inventory-confirm-tts",
        { body: { text } }
      );
      
      if (error || data?.fallback) {
        // Fallback to browser TTS
        fallbackSpeak(text);
      } else if (data?.audioContent) {
        const audioUrl = `data:audio/mpeg;base64,${data.audioContent}`;
        const audio = new Audio(audioUrl);
        audio.onended = () => {
          isSpeakingRef.current = false;
          processQueue();
        };
        audio.onerror = () => {
          isSpeakingRef.current = false;
          processQueue();
        };
        await audio.play();
        return; // Don't set isSpeaking to false yet
      }
    } catch (e) {
      console.warn("[VoiceFeedback] TTS failed, using fallback:", e);
      fallbackSpeak(text);
    }
    
    isSpeakingRef.current = false;
    processQueue();
  }, []);

  const fallbackSpeak = (text: string) => {
    if ("speechSynthesis" in window) {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 1.2;
      utterance.volume = 0.8;
      window.speechSynthesis.speak(utterance);
    }
  };

  // Play success feedback: chime + spoken confirmation
  const playSuccess = useCallback((itemName: string, cases: number, units: number) => {
    playSuccessChime();
    
    // Build spoken confirmation
    const parts: string[] = [];
    if (cases > 0) parts.push(`${cases} case${cases !== 1 ? "s" : ""}`);
    if (units > 0) parts.push(`${units} unit${units !== 1 ? "s" : ""}`);
    const qty = parts.join(" and ");
    const spoken = `${qty} ${itemName} confirmed`;
    
    ttsQueueRef.current.push(spoken);
    processQueue();
  }, [processQueue]);

  // Play error feedback: buzz sound
  const playError = useCallback(() => {
    playErrorBuzz();
  }, []);

  return { playSuccess, playError };
};
