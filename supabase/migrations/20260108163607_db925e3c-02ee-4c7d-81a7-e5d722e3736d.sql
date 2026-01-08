-- Ensure support attachments bucket is publicly readable so screenshot URLs work
update storage.buckets
set public = true
where id = 'support-attachments';

-- If the bucket somehow doesn't exist (fresh env), create it
insert into storage.buckets (id, name, public)
select 'support-attachments', 'support-attachments', true
where not exists (select 1 from storage.buckets where id = 'support-attachments');