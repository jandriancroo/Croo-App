-- Create temporary_tasks table
CREATE TABLE public.temporary_tasks (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    location_id UUID NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT,
    icon_name TEXT DEFAULT 'ClipboardList',
    accent_color TEXT DEFAULT '#8B5CF6',
    created_by UUID NOT NULL REFERENCES public.profiles(id),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    expires_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    completed_by UUID REFERENCES public.profiles(id),
    is_active BOOLEAN NOT NULL DEFAULT true
);

-- Create temporary_task_assignments table for employee/role assignments
CREATE TABLE public.temporary_task_assignments (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    task_id UUID NOT NULL REFERENCES public.temporary_tasks(id) ON DELETE CASCADE,
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    role app_role,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    CONSTRAINT assignment_type CHECK (
        (user_id IS NOT NULL AND role IS NULL) OR 
        (user_id IS NULL AND role IS NOT NULL)
    )
);

-- Create temporary_task_subtasks table
CREATE TABLE public.temporary_task_subtasks (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    task_id UUID NOT NULL REFERENCES public.temporary_tasks(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    order_index INTEGER NOT NULL DEFAULT 0,
    completed_at TIMESTAMP WITH TIME ZONE,
    completed_by UUID REFERENCES public.profiles(id),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.temporary_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.temporary_task_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.temporary_task_subtasks ENABLE ROW LEVEL SECURITY;

-- RLS Policies for temporary_tasks
CREATE POLICY "Users can view temporary tasks at their locations"
ON public.temporary_tasks FOR SELECT
USING (has_location_access(auth.uid(), location_id));

CREATE POLICY "Admins and managers can create temporary tasks"
ON public.temporary_tasks FOR INSERT
WITH CHECK (
    has_location_access(auth.uid(), location_id) AND 
    (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role))
);

CREATE POLICY "Admins and managers can update temporary tasks"
ON public.temporary_tasks FOR UPDATE
USING (
    has_location_access(auth.uid(), location_id) AND 
    (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role))
);

CREATE POLICY "Admins and managers can delete temporary tasks"
ON public.temporary_tasks FOR DELETE
USING (
    has_location_access(auth.uid(), location_id) AND 
    (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role))
);

-- RLS Policies for temporary_task_assignments
CREATE POLICY "Users can view task assignments at their locations"
ON public.temporary_task_assignments FOR SELECT
USING (
    EXISTS (
        SELECT 1 FROM public.temporary_tasks t
        WHERE t.id = task_id AND has_location_access(auth.uid(), t.location_id)
    )
);

CREATE POLICY "Admins and managers can manage task assignments"
ON public.temporary_task_assignments FOR ALL
USING (
    EXISTS (
        SELECT 1 FROM public.temporary_tasks t
        WHERE t.id = task_id AND has_location_access(auth.uid(), t.location_id)
        AND (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role))
    )
);

-- RLS Policies for temporary_task_subtasks
CREATE POLICY "Users can view subtasks at their locations"
ON public.temporary_task_subtasks FOR SELECT
USING (
    EXISTS (
        SELECT 1 FROM public.temporary_tasks t
        WHERE t.id = task_id AND has_location_access(auth.uid(), t.location_id)
    )
);

CREATE POLICY "Admins and managers can manage subtasks"
ON public.temporary_task_subtasks FOR ALL
USING (
    EXISTS (
        SELECT 1 FROM public.temporary_tasks t
        WHERE t.id = task_id AND has_location_access(auth.uid(), t.location_id)
        AND (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role))
    )
);

CREATE POLICY "Assigned users can complete subtasks"
ON public.temporary_task_subtasks FOR UPDATE
USING (
    EXISTS (
        SELECT 1 FROM public.temporary_tasks t
        JOIN public.temporary_task_assignments a ON a.task_id = t.id
        JOIN public.user_roles ur ON ur.user_id = auth.uid()
        WHERE t.id = temporary_task_subtasks.task_id 
        AND has_location_access(auth.uid(), t.location_id)
        AND (a.user_id = auth.uid() OR a.role = ur.role)
    )
);

-- Create indexes for performance
CREATE INDEX idx_temporary_tasks_location ON public.temporary_tasks(location_id);
CREATE INDEX idx_temporary_tasks_active ON public.temporary_tasks(is_active, location_id);
CREATE INDEX idx_temporary_task_assignments_task ON public.temporary_task_assignments(task_id);
CREATE INDEX idx_temporary_task_subtasks_task ON public.temporary_task_subtasks(task_id);