-- Make the resumes bucket public so resume files can be accessed
UPDATE storage.buckets SET public = true WHERE id = 'resumes';