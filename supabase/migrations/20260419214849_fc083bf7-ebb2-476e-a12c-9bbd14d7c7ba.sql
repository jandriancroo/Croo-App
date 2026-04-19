CREATE TABLE public.theo_helpful_feedback (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  location_id UUID,
  question TEXT,
  answer TEXT NOT NULL,
  message_index INTEGER,
  chat_date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX theo_helpful_feedback_unique_per_user
  ON public.theo_helpful_feedback (user_id, chat_date, message_index, location_id);

CREATE INDEX idx_theo_helpful_feedback_location_date
  ON public.theo_helpful_feedback (location_id, chat_date DESC);

ALTER TABLE public.theo_helpful_feedback ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can record their own helpful feedback"
ON public.theo_helpful_feedback
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can view their own helpful feedback"
ON public.theo_helpful_feedback
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Users can remove their own helpful feedback"
ON public.theo_helpful_feedback
FOR DELETE
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Admins can view all helpful feedback"
ON public.theo_helpful_feedback
FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'super_admin'::app_role)
  OR public.has_role(auth.uid(), 'admin'::app_role)
);