-- Make food-safety-audits bucket public so stored URLs work correctly
UPDATE storage.buckets 
SET public = true 
WHERE name = 'food-safety-audits';