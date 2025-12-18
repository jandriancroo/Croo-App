-- Add columns to temporary_tasks to link to audit items
ALTER TABLE public.temporary_tasks
ADD COLUMN audit_id uuid REFERENCES public.food_safety_audits(id) ON DELETE SET NULL,
ADD COLUMN audit_item_index integer,
ADD COLUMN audit_priority_level text;

-- Add index for faster lookups
CREATE INDEX idx_temporary_tasks_audit_id ON public.temporary_tasks(audit_id) WHERE audit_id IS NOT NULL;

-- Create a function to mark audit item as corrected when task is completed
CREATE OR REPLACE FUNCTION public.mark_audit_item_corrected_on_task_completion()
RETURNS TRIGGER AS $$
DECLARE
  current_corrections jsonb;
  item_key text;
BEGIN
  -- Only trigger when task is being completed (completed_at changes from NULL to a value)
  IF NEW.completed_at IS NOT NULL AND OLD.completed_at IS NULL AND NEW.audit_id IS NOT NULL THEN
    -- Build the item key
    item_key := NEW.audit_priority_level || '_' || NEW.audit_item_index;
    
    -- Get current corrections
    SELECT item_corrections INTO current_corrections
    FROM public.food_safety_audits
    WHERE id = NEW.audit_id;
    
    -- Update the corrections jsonb with completion info
    UPDATE public.food_safety_audits
    SET item_corrections = COALESCE(current_corrections, '{}'::jsonb) || 
        jsonb_build_object(item_key, jsonb_build_object(
          'completed_at', NOW(),
          'completed_by', NEW.completed_by,
          'completed_by_name', (SELECT full_name FROM public.profiles WHERE id = NEW.completed_by)
        )),
        updated_at = NOW()
    WHERE id = NEW.audit_id;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Create trigger
CREATE TRIGGER trigger_mark_audit_item_on_task_completion
AFTER UPDATE ON public.temporary_tasks
FOR EACH ROW
EXECUTE FUNCTION public.mark_audit_item_corrected_on_task_completion();