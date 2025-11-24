-- Fix chat_members RLS policy infinite recursion
DROP POLICY IF EXISTS "Users can view chat members for their chats" ON public.chat_members;

-- Create a non-recursive policy using the chats table directly
CREATE POLICY "Users can view chat members for their chats"
ON public.chat_members
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM public.chat_members cm
    WHERE cm.chat_id = chat_members.chat_id
    AND cm.user_id = auth.uid()
  )
);

-- Actually, that's still recursive. Let's use a simpler approach - allow users to view members of chats they've created or are part of
DROP POLICY IF EXISTS "Users can view chat members for their chats" ON public.chat_members;

CREATE POLICY "Users can view chat members for their chats"
ON public.chat_members
FOR SELECT
USING (
  -- User is viewing their own membership
  user_id = auth.uid()
  OR
  -- User created the chat
  chat_id IN (
    SELECT id FROM public.chats WHERE created_by = auth.uid()
  )
);

-- Create wage_history table to track wage changes over time
CREATE TABLE IF NOT EXISTS public.wage_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  hourly_wage NUMERIC(10,2) NOT NULL,
  effective_date DATE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  created_by UUID REFERENCES public.profiles(id),
  UNIQUE(user_id, effective_date)
);

-- Enable RLS
ALTER TABLE public.wage_history ENABLE ROW LEVEL SECURITY;

-- RLS policies for wage_history
CREATE POLICY "Admins can view all wage history"
ON public.wage_history
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid() AND role = 'admin'
  )
);

CREATE POLICY "Admins can insert wage history"
ON public.wage_history
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid() AND role = 'admin'
  )
);

CREATE POLICY "Admins can update wage history"
ON public.wage_history
FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid() AND role = 'admin'
  )
);

CREATE POLICY "Admins can delete wage history"
ON public.wage_history
FOR DELETE
USING (
  EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid() AND role = 'admin'
  )
);

-- Create index for faster lookups
CREATE INDEX idx_wage_history_user_date ON public.wage_history(user_id, effective_date DESC);

-- Create function to get current wage for a user on a specific date
CREATE OR REPLACE FUNCTION public.get_current_wage(p_user_id UUID, p_date DATE DEFAULT CURRENT_DATE)
RETURNS NUMERIC AS $$
DECLARE
  v_wage NUMERIC;
BEGIN
  SELECT hourly_wage INTO v_wage
  FROM public.wage_history
  WHERE user_id = p_user_id
  AND effective_date <= p_date
  ORDER BY effective_date DESC
  LIMIT 1;
  
  -- If no wage history, return default from profile
  IF v_wage IS NULL THEN
    SELECT hourly_wage INTO v_wage
    FROM public.profiles
    WHERE id = p_user_id;
  END IF;
  
  RETURN COALESCE(v_wage, 15.00);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;