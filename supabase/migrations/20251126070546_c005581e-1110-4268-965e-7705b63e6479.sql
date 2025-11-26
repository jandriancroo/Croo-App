-- Add location_code column to locations table
ALTER TABLE public.locations 
ADD COLUMN location_code text UNIQUE;

-- Function to generate a random 3-word location code
CREATE OR REPLACE FUNCTION generate_location_code()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  words text[] := ARRAY[
    'happy', 'sunny', 'bright', 'swift', 'calm', 'quiet', 'warm', 'cool', 'fresh', 'clean',
    'river', 'mountain', 'forest', 'ocean', 'meadow', 'garden', 'valley', 'creek', 'lake', 'field',
    'eagle', 'falcon', 'dolphin', 'tiger', 'panda', 'otter', 'fox', 'bear', 'wolf', 'deer'
  ];
  new_code text;
  code_exists boolean;
BEGIN
  LOOP
    -- Generate random 3-word code
    new_code := words[1 + floor(random() * 10)::int] || '-' || 
                words[11 + floor(random() * 10)::int] || '-' || 
                words[21 + floor(random() * 10)::int];
    
    -- Check if code already exists
    SELECT EXISTS(SELECT 1 FROM locations WHERE location_code = new_code) INTO code_exists;
    
    -- Exit loop if code is unique
    EXIT WHEN NOT code_exists;
  END LOOP;
  
  RETURN new_code;
END;
$$;

-- Generate codes for existing locations
UPDATE public.locations
SET location_code = generate_location_code()
WHERE location_code IS NULL;