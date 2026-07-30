DELETE FROM public.opus_training_modules;
DELETE FROM public.opus_resource_index;
DELETE FROM public.maintenance_queue WHERE task_type LIKE 'opus%';
DELETE FROM public.location_integrations WHERE integration_type = 'opus';