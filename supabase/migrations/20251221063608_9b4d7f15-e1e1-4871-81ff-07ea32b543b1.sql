-- Enable realtime for alarm_task_completions to allow immediate sync
ALTER PUBLICATION supabase_realtime ADD TABLE public.alarm_task_completions;