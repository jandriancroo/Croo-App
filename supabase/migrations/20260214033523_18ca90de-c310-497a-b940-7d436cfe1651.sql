-- Remove the public INSERT policy that allows anyone to upload resumes
-- Uploads now go through the utility-service edge function with Turnstile CAPTCHA verification
DROP POLICY IF EXISTS "Anyone can upload resumes" ON storage.objects;