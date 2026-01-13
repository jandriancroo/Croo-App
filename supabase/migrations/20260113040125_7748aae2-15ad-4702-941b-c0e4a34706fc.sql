-- Add is_final_warning column to employee_writeups
ALTER TABLE public.employee_writeups 
ADD COLUMN is_final_warning boolean NOT NULL DEFAULT false;