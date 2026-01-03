-- First, drop the existing constraint
ALTER TABLE public.game_high_scores DROP CONSTRAINT IF EXISTS game_high_scores_game_type_check;

-- Add updated constraint that includes all game types
ALTER TABLE public.game_high_scores ADD CONSTRAINT game_high_scores_game_type_check 
CHECK (game_type IN ('snake', 'minesweeper', 'basketball', 'pizza'));