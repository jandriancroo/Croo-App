-- Add phone number and birthday to profiles
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS phone_number text;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS birthday date;

-- Create index for birthday lookups
CREATE INDEX IF NOT EXISTS idx_profiles_birthday ON profiles(birthday) WHERE birthday IS NOT NULL;