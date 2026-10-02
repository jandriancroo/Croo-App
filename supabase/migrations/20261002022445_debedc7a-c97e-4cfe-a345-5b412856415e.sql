SELECT cron.unschedule('theo-voice-openers-hourly');
ALTER TABLE public.theo_voice_sessions ADD COLUMN IF NOT EXISTS tts_chars integer NOT NULL DEFAULT 0;
COMMENT ON COLUMN public.theo_voice_sessions.seconds IS 'Seconds the live (per-minute) voice connection was open';
COMMENT ON COLUMN public.theo_voice_sessions.tts_chars IS 'Characters read aloud with xAI text-to-speech (update playback)';