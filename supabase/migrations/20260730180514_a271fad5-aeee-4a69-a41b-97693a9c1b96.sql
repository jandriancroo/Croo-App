DELETE FROM public.temporary_task_assignments
WHERE task_id IN (SELECT id FROM public.temporary_tasks WHERE icon_name = 'opus_logo');
DELETE FROM public.temporary_tasks WHERE icon_name = 'opus_logo';