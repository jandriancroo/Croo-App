-- Add write_up_id column to temporary_tasks for linking write-ups to signature tasks
ALTER TABLE public.temporary_tasks 
ADD COLUMN write_up_id uuid REFERENCES public.employee_writeups(id) ON DELETE CASCADE;

-- Create index for faster lookup
CREATE INDEX idx_temporary_tasks_write_up_id ON public.temporary_tasks(write_up_id) WHERE write_up_id IS NOT NULL;