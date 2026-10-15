import { describe, it, expect } from 'vitest';
import { pcmBuffer, outputRateFrom } from './theoPcm';

// Minimal offline AudioContext stand-in: AudioBuffer.duration = length / its own sampleRate (per Web Audio spec),
// independent of the context's running rate.
const fakeCtx = (ctxRate: number) => ({
  sampleRate: ctxRate,
  createBuffer: (ch: number, length: number, sampleRate: number) => {
    const data = new Float32Array(length);
    return { numberOfChannels: ch, length, sampleRate, duration: length / sampleRate, getChannelData: () => data } as unknown as AudioBuffer;
  },
});

describe('pcmBuffer', () => {
  for (const ctxRate of [16000, 24000, 44100, 48000]) {
    it(`plays 24k PCM at true speed when the context runs at ${ctxRate}`, () => {
      const samples = new Float32Array(24000 * 3);
      const buf = pcmBuffer(fakeCtx(ctxRate), samples, 24000);
      expect(buf.sampleRate).toBe(24000);
      expect(buf.duration).toBeCloseTo(samples.length / 24000, 9);
    });
  }
});

describe('outputRateFrom', () => {
  it('reads the confirmed PCM rate', () => {
    expect(outputRateFrom({ audio: { output: { format: { type: 'audio/pcm', rate: 24000 } } } })).toBe(24000);
    expect(outputRateFrom({ audio: { output: { format: { type: 'audio/pcm', rate: 16000 } } } })).toBe(16000);
  });
  it('ignores missing / non-PCM / bogus rates', () => {
    expect(outputRateFrom(undefined)).toBeNull();
    expect(outputRateFrom({ audio: { output: { format: { type: 'audio/pcmu' } } } })).toBeNull();
    expect(outputRateFrom({ audio: { output: { format: { type: 'audio/pcm', rate: 12345 } } } })).toBeNull();
  });
});
