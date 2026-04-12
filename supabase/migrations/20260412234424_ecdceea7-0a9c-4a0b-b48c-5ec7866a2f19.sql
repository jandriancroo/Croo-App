
CREATE POLICY "Users can delete their own completions"
  ON public.onboarding_completions
  FOR DELETE
  USING (auth.uid() = user_id);
