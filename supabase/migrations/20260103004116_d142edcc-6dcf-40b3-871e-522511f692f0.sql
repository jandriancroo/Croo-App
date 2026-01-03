-- Create table for game high scores
CREATE TABLE public.game_high_scores (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  game_type TEXT NOT NULL CHECK (game_type IN ('snake', 'minesweeper')),
  score INTEGER NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create index for efficient leaderboard queries
CREATE INDEX idx_game_high_scores_game_type_score ON public.game_high_scores(game_type, score DESC);
CREATE INDEX idx_game_high_scores_user_id ON public.game_high_scores(user_id);

-- Enable RLS
ALTER TABLE public.game_high_scores ENABLE ROW LEVEL SECURITY;

-- Everyone can view high scores (public leaderboard)
CREATE POLICY "High scores are viewable by everyone"
  ON public.game_high_scores
  FOR SELECT
  USING (true);

-- Users can insert their own scores
CREATE POLICY "Users can insert their own scores"
  ON public.game_high_scores
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Users can delete their own scores
CREATE POLICY "Users can delete their own scores"
  ON public.game_high_scores
  FOR DELETE
  USING (auth.uid() = user_id);