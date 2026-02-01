-- =====================================================
-- EMPLOYEE PERFORMANCE REVIEW SYSTEM
-- Manager+ only, with signature requirement like Write-Ups
-- Shows in employee profile when signed like Read & Signs
-- =====================================================

-- 1. Performance review rating items (configurable per location)
CREATE TABLE public.performance_review_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id UUID REFERENCES public.locations(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  display_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(location_id, name)
);

-- 2. Performance reviews (the actual review document)
CREATE TABLE public.performance_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id UUID REFERENCES public.locations(id) ON DELETE CASCADE NOT NULL,
  employee_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  created_by UUID REFERENCES public.profiles(id) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  -- Review period
  review_period_start DATE,
  review_period_end DATE,
  
  -- Follow-up notes at the bottom
  follow_up_notes TEXT,
  
  -- Signature tracking (like Write-Ups)
  signature_url TEXT,
  signed_at TIMESTAMPTZ,
  viewed_at TIMESTAMPTZ,
  
  -- Task link for Quick Task on dashboard
  task_id UUID REFERENCES public.temporary_tasks(id) ON DELETE SET NULL
);

-- 3. Performance review ratings (star rating 1-10 per item with notes)
CREATE TABLE public.performance_review_ratings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id UUID REFERENCES public.performance_reviews(id) ON DELETE CASCADE NOT NULL,
  item_id UUID REFERENCES public.performance_review_items(id) ON DELETE CASCADE NOT NULL,
  rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 10),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(review_id, item_id)
);

-- =====================================================
-- ROW LEVEL SECURITY
-- =====================================================

ALTER TABLE public.performance_review_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.performance_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.performance_review_ratings ENABLE ROW LEVEL SECURITY;

-- Performance review items: Manager+ can manage
CREATE POLICY "Managers can view review items" 
ON public.performance_review_items 
FOR SELECT 
TO authenticated 
USING (
  EXISTS (
    SELECT 1 FROM public.user_locations ul
    WHERE ul.user_id = auth.uid() 
    AND ul.location_id = performance_review_items.location_id
  )
  AND public.has_role(auth.uid(), 'manager')
);

CREATE POLICY "Managers can insert review items" 
ON public.performance_review_items 
FOR INSERT 
TO authenticated 
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.user_locations ul
    WHERE ul.user_id = auth.uid() 
    AND ul.location_id = performance_review_items.location_id
  )
  AND public.has_role(auth.uid(), 'manager')
);

CREATE POLICY "Managers can update review items" 
ON public.performance_review_items 
FOR UPDATE 
TO authenticated 
USING (
  EXISTS (
    SELECT 1 FROM public.user_locations ul
    WHERE ul.user_id = auth.uid() 
    AND ul.location_id = performance_review_items.location_id
  )
  AND public.has_role(auth.uid(), 'manager')
);

CREATE POLICY "Managers can delete review items" 
ON public.performance_review_items 
FOR DELETE 
TO authenticated 
USING (
  EXISTS (
    SELECT 1 FROM public.user_locations ul
    WHERE ul.user_id = auth.uid() 
    AND ul.location_id = performance_review_items.location_id
  )
  AND public.has_role(auth.uid(), 'manager')
);

-- Performance reviews: Manager+ can manage, employees can view/sign their own
CREATE POLICY "Managers can view all reviews at their location" 
ON public.performance_reviews 
FOR SELECT 
TO authenticated 
USING (
  (
    EXISTS (
      SELECT 1 FROM public.user_locations ul
      WHERE ul.user_id = auth.uid() 
      AND ul.location_id = performance_reviews.location_id
    )
    AND public.has_role(auth.uid(), 'manager')
  )
  OR employee_id = auth.uid()
);

CREATE POLICY "Managers can insert reviews" 
ON public.performance_reviews 
FOR INSERT 
TO authenticated 
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.user_locations ul
    WHERE ul.user_id = auth.uid() 
    AND ul.location_id = performance_reviews.location_id
  )
  AND public.has_role(auth.uid(), 'manager')
);

CREATE POLICY "Managers can update reviews or employees can sign their own" 
ON public.performance_reviews 
FOR UPDATE 
TO authenticated 
USING (
  (
    EXISTS (
      SELECT 1 FROM public.user_locations ul
      WHERE ul.user_id = auth.uid() 
      AND ul.location_id = performance_reviews.location_id
    )
    AND public.has_role(auth.uid(), 'manager')
  )
  OR employee_id = auth.uid()
);

CREATE POLICY "Managers can delete reviews" 
ON public.performance_reviews 
FOR DELETE 
TO authenticated 
USING (
  EXISTS (
    SELECT 1 FROM public.user_locations ul
    WHERE ul.user_id = auth.uid() 
    AND ul.location_id = performance_reviews.location_id
  )
  AND public.has_role(auth.uid(), 'manager')
);

-- Performance review ratings: Same as reviews
CREATE POLICY "Managers can view ratings or employees can view their own" 
ON public.performance_review_ratings 
FOR SELECT 
TO authenticated 
USING (
  EXISTS (
    SELECT 1 FROM public.performance_reviews pr
    WHERE pr.id = performance_review_ratings.review_id
    AND (
      (
        EXISTS (
          SELECT 1 FROM public.user_locations ul
          WHERE ul.user_id = auth.uid() 
          AND ul.location_id = pr.location_id
        )
        AND public.has_role(auth.uid(), 'manager')
      )
      OR pr.employee_id = auth.uid()
    )
  )
);

CREATE POLICY "Managers can insert ratings" 
ON public.performance_review_ratings 
FOR INSERT 
TO authenticated 
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.performance_reviews pr
    WHERE pr.id = performance_review_ratings.review_id
    AND EXISTS (
      SELECT 1 FROM public.user_locations ul
      WHERE ul.user_id = auth.uid() 
      AND ul.location_id = pr.location_id
    )
    AND public.has_role(auth.uid(), 'manager')
  )
);

CREATE POLICY "Managers can update ratings" 
ON public.performance_review_ratings 
FOR UPDATE 
TO authenticated 
USING (
  EXISTS (
    SELECT 1 FROM public.performance_reviews pr
    WHERE pr.id = performance_review_ratings.review_id
    AND EXISTS (
      SELECT 1 FROM public.user_locations ul
      WHERE ul.user_id = auth.uid() 
      AND ul.location_id = pr.location_id
    )
    AND public.has_role(auth.uid(), 'manager')
  )
);

CREATE POLICY "Managers can delete ratings" 
ON public.performance_review_ratings 
FOR DELETE 
TO authenticated 
USING (
  EXISTS (
    SELECT 1 FROM public.performance_reviews pr
    WHERE pr.id = performance_review_ratings.review_id
    AND EXISTS (
      SELECT 1 FROM public.user_locations ul
      WHERE ul.user_id = auth.uid() 
      AND ul.location_id = pr.location_id
    )
    AND public.has_role(auth.uid(), 'manager')
  )
);

-- =====================================================
-- AUTO-PROVISION DEFAULT REVIEW ITEMS FOR LOCATIONS
-- =====================================================

CREATE OR REPLACE FUNCTION public.provision_default_review_items()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Insert default review items for the new location
  INSERT INTO public.performance_review_items (location_id, name, description, display_order)
  VALUES
    (NEW.id, 'Attendance', 'Punctuality and reliability in showing up for scheduled shifts', 1),
    (NEW.id, 'Attitude', 'Positive attitude, enthusiasm, and professional demeanor', 2),
    (NEW.id, 'Quality of Work', 'Accuracy, thoroughness, and attention to detail', 3),
    (NEW.id, 'Teamwork', 'Collaboration with coworkers and willingness to help others', 4),
    (NEW.id, 'Communication', 'Clear and effective communication with team and guests', 5),
    (NEW.id, 'Speed', 'Efficiency and ability to work under pressure', 6),
    (NEW.id, 'Initiative', 'Proactively identifies tasks and takes action without being asked', 7),
    (NEW.id, 'Problem Solving', 'Ability to handle challenges and find solutions', 8),
    (NEW.id, 'Leadership', 'Guides and supports teammates, leads by example', 9),
    (NEW.id, 'Reliability', 'Consistently meets expectations and follows through on commitments', 10)
  ON CONFLICT (location_id, name) DO NOTHING;
  
  RETURN NEW;
END;
$$;

-- Trigger to auto-provision for new locations
CREATE TRIGGER provision_review_items_for_new_location
AFTER INSERT ON public.locations
FOR EACH ROW
EXECUTE FUNCTION public.provision_default_review_items();

-- Provision for existing locations (one-time backfill)
INSERT INTO public.performance_review_items (location_id, name, description, display_order)
SELECT 
  l.id,
  items.name,
  items.description,
  items.display_order
FROM public.locations l
CROSS JOIN (
  VALUES
    ('Attendance', 'Punctuality and reliability in showing up for scheduled shifts', 1),
    ('Attitude', 'Positive attitude, enthusiasm, and professional demeanor', 2),
    ('Quality of Work', 'Accuracy, thoroughness, and attention to detail', 3),
    ('Teamwork', 'Collaboration with coworkers and willingness to help others', 4),
    ('Communication', 'Clear and effective communication with team and guests', 5),
    ('Speed', 'Efficiency and ability to work under pressure', 6),
    ('Initiative', 'Proactively identifies tasks and takes action without being asked', 7),
    ('Problem Solving', 'Ability to handle challenges and find solutions', 8),
    ('Leadership', 'Guides and supports teammates, leads by example', 9),
    ('Reliability', 'Consistently meets expectations and follows through on commitments', 10)
) AS items(name, description, display_order)
ON CONFLICT (location_id, name) DO NOTHING;

-- =====================================================
-- ADD LOGBOOK CATEGORY FOR ALL LOCATIONS
-- =====================================================

INSERT INTO public.logbook_categories (location_id, name, display_order)
SELECT id, 'Performance Review', 99
FROM public.locations
ON CONFLICT DO NOTHING;