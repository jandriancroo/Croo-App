-- Make certificates bucket public so stored URLs work correctly
UPDATE storage.buckets 
SET public = true 
WHERE name = 'certificates';