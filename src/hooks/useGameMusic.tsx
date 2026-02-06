import { useRef, useCallback, useEffect } from 'react';

type MusicTheme = 'bad-pop' | 'dungeon' | 'retro-arcade' | 'puzzle' | 'sports';

const MUSIC_PROMPTS: Record<MusicTheme, string> = {
  'bad-pop': 'Cheesy 2010s pop music with annoying catchy hooks, overly autotuned vocals style, generic club beat, slightly ironic and comedic tone, upbeat and energetic',
  'dungeon': 'Dark atmospheric dungeon crawler music, ominous synth pads, 90s FPS game style like Doom or Duke Nukem, heavy metal guitar riffs, aggressive drums, retro gaming vibes',
  'retro-arcade': '8-bit chiptune arcade game music, classic NES style, energetic and bouncy, pixel game nostalgia, fast tempo, bleeps and bloops',
  'puzzle': 'Calm puzzle game background music, minesweeper style, light electronic ambient, thinking music, subtle tension, minimalist',
  'sports': 'Energetic basketball game music, hip hop inspired beats, sports arena vibe, pumping bass, crowd energy, competitive spirit',
};

export function useGameMusic(theme: MusicTheme) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const isLoadingRef = useRef(false);
  const hasPlayedRef = useRef(false);
  const audioUrlRef = useRef<string | null>(null);

  const loadAndPlay = useCallback(async () => {
    if (isLoadingRef.current || hasPlayedRef.current) return;
    isLoadingRef.current = true;

    try {
      console.log(`Loading ${theme} music...`);
      
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/elevenlabs-service?action=music`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
            'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          },
          body: JSON.stringify({
            prompt: MUSIC_PROMPTS[theme],
            duration: 60, // 60 seconds of music
          }),
        }
      );

      if (!response.ok) {
        throw new Error(`Music request failed: ${response.status}`);
      }

      const audioBlob = await response.blob();
      const audioUrl = URL.createObjectURL(audioBlob);
      audioUrlRef.current = audioUrl;

      const audio = new Audio(audioUrl);
      audio.loop = true;
      audio.volume = 0.3; // Background music volume
      audioRef.current = audio;
      
      await audio.play();
      hasPlayedRef.current = true;
      console.log(`${theme} music playing`);
    } catch (error) {
      console.error('Failed to load music:', error);
    } finally {
      isLoadingRef.current = false;
    }
  }, [theme]);

  const play = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.play().catch(console.error);
    } else {
      loadAndPlay();
    }
  }, [loadAndPlay]);

  const pause = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
    }
  }, []);

  const stop = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
  }, []);

  const setVolume = useCallback((volume: number) => {
    if (audioRef.current) {
      audioRef.current.volume = Math.max(0, Math.min(1, volume));
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      if (audioUrlRef.current) {
        URL.revokeObjectURL(audioUrlRef.current);
        audioUrlRef.current = null;
      }
    };
  }, []);

  return { play, pause, stop, setVolume };
}
