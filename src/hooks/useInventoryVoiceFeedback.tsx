import { useCallback } from "react";

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

// Instant browser TTS — no API call, zero latency
const browserSpeak = (text: string) => {
  if ("speechSynthesis" in window) {
    // Cancel any queued speech to avoid pile-up
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.3; // Fast for snappy confirmation
    utterance.volume = 0.8;
    utterance.pitch = 1.0;
    window.speechSynthesis.speak(utterance);
  }
};

export const useInventoryVoiceFeedback = () => {
  // Play success feedback: chime + instant spoken confirmation
  const playSuccess = useCallback((itemName: string, cases: number, units: number) => {
    playSuccessChime();
    
    // Build spoken confirmation
    const parts: string[] = [];
    if (cases > 0) parts.push(`${cases} case${cases !== 1 ? "s" : ""}`);
    if (units > 0) parts.push(`${units} unit${units !== 1 ? "s" : ""}`);
    const qty = parts.join(" and ");
    const spoken = `${qty} ${itemName} confirmed`;
    
    browserSpeak(spoken);
  }, []);

  // Play error feedback: buzz sound
  const playError = useCallback(() => {
    playErrorBuzz();
  }, []);

  return { playSuccess, playError };
};
