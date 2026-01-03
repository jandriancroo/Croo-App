import { useCallback, useRef } from 'react';

// WebAudio-based sound effects that work without external APIs
class SoundGenerator {
  private audioContext: AudioContext | null = null;
  private musicOscillators: OscillatorNode[] = [];
  private musicGain: GainNode | null = null;
  private isPlaying = false;

  private getContext(): AudioContext {
    if (!this.audioContext) {
      this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    return this.audioContext;
  }

  // Play a simple tone
  playTone(frequency: number, duration: number, type: OscillatorType = 'square', volume = 0.1) {
    try {
      const ctx = this.getContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      
      osc.type = type;
      osc.frequency.setValueAtTime(frequency, ctx.currentTime);
      
      gain.gain.setValueAtTime(volume, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
      
      osc.connect(gain);
      gain.connect(ctx.destination);
      
      osc.start();
      osc.stop(ctx.currentTime + duration);
    } catch (e) {
      console.warn('Audio not available:', e);
    }
  }

  // Shoot sound - pew pew
  playShoot() {
    this.playTone(880, 0.1, 'square', 0.15);
    setTimeout(() => this.playTone(440, 0.15, 'square', 0.1), 50);
  }

  // Explosion/hit sound
  playExplosion() {
    try {
      const ctx = this.getContext();
      const bufferSize = ctx.sampleRate * 0.3;
      const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      
      for (let i = 0; i < bufferSize; i++) {
        const decay = 1 - i / bufferSize;
        data[i] = (Math.random() * 2 - 1) * decay * decay;
      }
      
      const source = ctx.createBufferSource();
      const gain = ctx.createGain();
      const filter = ctx.createBiquadFilter();
      
      source.buffer = buffer;
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(1500, ctx.currentTime);
      filter.frequency.exponentialRampToValueAtTime(100, ctx.currentTime + 0.3);
      
      gain.gain.setValueAtTime(0.4, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
      
      source.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);
      
      source.start();
    } catch (e) {
      console.warn('Audio not available:', e);
    }
  }

  // Splat/gore sound
  playSplat() {
    try {
      const ctx = this.getContext();
      const bufferSize = ctx.sampleRate * 0.15;
      const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      
      for (let i = 0; i < bufferSize; i++) {
        const decay = 1 - i / bufferSize;
        data[i] = (Math.random() * 2 - 1) * decay * Math.sin(i * 0.05);
      }
      
      const source = ctx.createBufferSource();
      const gain = ctx.createGain();
      
      source.buffer = buffer;
      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      
      source.connect(gain);
      gain.connect(ctx.destination);
      source.start();
    } catch (e) {
      console.warn('Audio not available:', e);
    }
  }

  // Jump sound
  playJump() {
    try {
      const ctx = this.getContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      
      osc.type = 'square';
      osc.frequency.setValueAtTime(200, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(600, ctx.currentTime + 0.15);
      
      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
      
      osc.connect(gain);
      gain.connect(ctx.destination);
      
      osc.start();
      osc.stop(ctx.currentTime + 0.15);
    } catch (e) {
      console.warn('Audio not available:', e);
    }
  }

  // Pickup/collect sound
  playPickup() {
    this.playTone(523, 0.08, 'square', 0.15);
    setTimeout(() => this.playTone(659, 0.08, 'square', 0.15), 80);
    setTimeout(() => this.playTone(784, 0.15, 'square', 0.15), 160);
  }

  // Hurt/damage sound
  playHurt() {
    try {
      const ctx = this.getContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(300, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(100, ctx.currentTime + 0.2);
      
      gain.gain.setValueAtTime(0.2, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);
      
      osc.connect(gain);
      gain.connect(ctx.destination);
      
      osc.start();
      osc.stop(ctx.currentTime + 0.2);
    } catch (e) {
      console.warn('Audio not available:', e);
    }
  }

  // Game over sound
  playGameOver() {
    const notes = [392, 349, 330, 262];
    notes.forEach((freq, i) => {
      setTimeout(() => this.playTone(freq, 0.3, 'sawtooth', 0.15), i * 250);
    });
  }

  // Start background music (procedural dungeon music)
  startMusic(theme: 'dungeon' | 'retro' | 'action' = 'dungeon') {
    if (this.isPlaying) return;
    this.isPlaying = true;

    try {
      const ctx = this.getContext();
      this.musicGain = ctx.createGain();
      this.musicGain.gain.setValueAtTime(0.08, ctx.currentTime);
      this.musicGain.connect(ctx.destination);

      // Bass drone
      const bass = ctx.createOscillator();
      bass.type = 'triangle';
      bass.frequency.setValueAtTime(theme === 'dungeon' ? 55 : 82, ctx.currentTime);
      
      const bassGain = ctx.createGain();
      bassGain.gain.setValueAtTime(0.15, ctx.currentTime);
      
      bass.connect(bassGain);
      bassGain.connect(this.musicGain);
      bass.start();
      this.musicOscillators.push(bass);

      // Arpeggio
      const arp = ctx.createOscillator();
      arp.type = 'square';
      
      const arpGain = ctx.createGain();
      arpGain.gain.setValueAtTime(0.05, ctx.currentTime);
      
      const arpFilter = ctx.createBiquadFilter();
      arpFilter.type = 'lowpass';
      arpFilter.frequency.setValueAtTime(800, ctx.currentTime);
      
      arp.connect(arpFilter);
      arpFilter.connect(arpGain);
      arpGain.connect(this.musicGain);
      arp.start();
      this.musicOscillators.push(arp);

      // Animate the arpeggio
      const notes = theme === 'dungeon' 
        ? [110, 131, 165, 196, 165, 131]
        : [165, 196, 220, 262, 220, 196];
      let noteIndex = 0;
      
      const playNote = () => {
        if (!this.isPlaying) return;
        arp.frequency.setValueAtTime(notes[noteIndex], ctx.currentTime);
        noteIndex = (noteIndex + 1) % notes.length;
        setTimeout(playNote, theme === 'dungeon' ? 300 : 200);
      };
      playNote();

    } catch (e) {
      console.warn('Music not available:', e);
    }
  }

  // Stop music
  stopMusic() {
    this.isPlaying = false;
    this.musicOscillators.forEach(osc => {
      try {
        osc.stop();
      } catch (e) {
        // Already stopped
      }
    });
    this.musicOscillators = [];
    this.musicGain = null;
  }
}

const soundGenerator = new SoundGenerator();

export function useGameSounds() {
  const shoot = useCallback(() => soundGenerator.playShoot(), []);
  const explosion = useCallback(() => soundGenerator.playExplosion(), []);
  const splat = useCallback(() => soundGenerator.playSplat(), []);
  const jump = useCallback(() => soundGenerator.playJump(), []);
  const pickup = useCallback(() => soundGenerator.playPickup(), []);
  const hurt = useCallback(() => soundGenerator.playHurt(), []);
  const gameOver = useCallback(() => soundGenerator.playGameOver(), []);
  const startMusic = useCallback((theme: 'dungeon' | 'retro' | 'action' = 'dungeon') => soundGenerator.startMusic(theme), []);
  const stopMusic = useCallback(() => soundGenerator.stopMusic(), []);

  return {
    shoot,
    explosion,
    splat,
    jump,
    pickup,
    hurt,
    gameOver,
    startMusic,
    stopMusic,
  };
}
