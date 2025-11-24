-- Add profile_photo_url to profiles table
ALTER TABLE public.profiles
ADD COLUMN profile_photo_url TEXT;

-- Create storage bucket for profile photos if it doesn't exist
INSERT INTO storage.buckets (id, name, public)
VALUES ('profile-photos', 'profile-photos', true)
ON CONFLICT (id) DO NOTHING;

-- Create policies for profile photos bucket
CREATE POLICY "Profile photos are publicly accessible"
ON storage.objects
FOR SELECT
USING (bucket_id = 'profile-photos');

CREATE POLICY "Users can upload their own profile photo"
ON storage.objects
FOR INSERT
WITH CHECK (
  bucket_id = 'profile-photos' 
  AND auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "Users can update their own profile photo"
ON storage.objects
FOR UPDATE
USING (
  bucket_id = 'profile-photos' 
  AND auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "Users can delete their own profile photo"
ON storage.objects
FOR DELETE
USING (
  bucket_id = 'profile-photos' 
  AND auth.uid()::text = (storage.foldername(name))[1]
);