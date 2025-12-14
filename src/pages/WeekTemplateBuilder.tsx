import { useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Layout } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { useUserRole } from "@/hooks/useUserRole";
import { useLocation as useAppLocation } from "@/hooks/useLocation";
import { toast } from "sonner";
import { ArrowLeft, Save, GripVertical } from "lucide-react";
import { DndContext, DragEndEvent, DragStartEvent, DragOverlay, useSensor, useSensors, PointerSensor, TouchSensor, closestCenter } from "@dnd-kit/core";
import { useDroppable, useDraggable } from "@dnd-kit/core";
import { formatTime12Hour } from "@/lib/utils";

interface ShiftTemplate {
  id: string;
  template_name: string;
  start_time: string;
  end_time: string;
  role: string;
  color: string;
  position: string | null;
}

interface Assignment {
  id?: string;
  shift_template_id: string;
  day_of_week: number;
  shift_template?: ShiftTemplate;
}

function DraggableShiftTemplate({ template }: { template: ShiftTemplate }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `template-${template.id}`,
    data: { template, isFromList: true },
  });

  const style = transform
    ? {
        transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
        opacity: isDragging ? 0.5 : 1,
      }
    : undefined;

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      className="p-3 bg-card border rounded-lg cursor-grab active:cursor-grabbing hover:border-primary/50 transition-colors"
    >
      <div className="flex items-center gap-2">
        <div
          className="w-3 h-3 rounded-full flex-shrink-0"
          style={{ backgroundColor: template.color }}
        />
        <div className="flex-1 min-w-0">
          <p className="font-medium text-sm truncate">{template.position || template.template_name}</p>
          <p className="text-xs text-muted-foreground">
            {formatTime12Hour(template.start_time)} - {formatTime12Hour(template.end_time)}
          </p>
        </div>
        <GripVertical className="h-4 w-4 text-muted-foreground flex-shrink-0" />
      </div>
    </div>
  );
}

function AssignedShiftCard({ assignment, onRemove }: { assignment: Assignment; onRemove: () => void }) {
  const template = assignment.shift_template;
  if (!template) return null;

  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `assigned-${assignment.shift_template_id}-${assignment.day_of_week}-${Math.random()}`,
    data: { assignment, isFromList: false },
  });

  const style = transform
    ? {
        transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
        opacity: isDragging ? 0.5 : 1,
      }
    : undefined;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="p-2 bg-card border rounded flex items-center gap-2 group"
    >
      <div {...listeners} {...attributes} className="cursor-grab active:cursor-grabbing">
        <GripVertical className="h-3 w-3 text-muted-foreground" />
      </div>
      <div
        className="w-2 h-2 rounded-full flex-shrink-0"
        style={{ backgroundColor: template.color }}
      />
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium truncate">{template.position}</p>
        <p className="text-[10px] text-muted-foreground">
          {formatTime12Hour(template.start_time)} - {formatTime12Hour(template.end_time)}
        </p>
      </div>
      <button
        onClick={onRemove}
        className="text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity text-xs"
      >
        ×
      </button>
    </div>
  );
}

function DroppableDay({ 
  dayIndex, 
  dayName, 
  assignments,
  onRemoveAssignment 
}: { 
  dayIndex: number; 
  dayName: string; 
  assignments: Assignment[];
  onRemoveAssignment: (index: number) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `day-${dayIndex}`,
    data: { dayIndex },
  });

  return (
    <div
      ref={setNodeRef}
      className={`p-3 border-2 rounded-lg min-h-[200px] flex flex-col ${
        isOver ? "border-primary bg-accent/50" : "border-border"
      }`}
    >
      <h3 className="font-semibold text-sm mb-2 text-center">{dayName}</h3>
      <div className="flex-1 space-y-2">
        {assignments.map((assignment, index) => (
          <AssignedShiftCard
            key={`${assignment.shift_template_id}-${index}`}
            assignment={assignment}
            onRemove={() => onRemoveAssignment(index)}
          />
        ))}
        {assignments.length === 0 && (
          <p className="text-xs text-muted-foreground text-center mt-4">
            Drop shifts here
          </p>
        )}
      </div>
    </div>
  );
}

export default function WeekTemplateBuilder() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { isAdmin, isManager, loading: roleLoading } = useUserRole();
  const { currentLocation } = useAppLocation();
  
  const [templateName, setTemplateName] = useState("");
  const [description, setDescription] = useState("");
  const [shiftTemplates, setShiftTemplates] = useState<ShiftTemplate[]>([]);
  const [assignmentsByDay, setAssignmentsByDay] = useState<Map<number, Assignment[]>>(new Map());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeTemplate, setActiveTemplate] = useState<ShiftTemplate | null>(null);

  const dayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const isNew = id === 'new';

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 200, tolerance: 8 },
    })
  );

  useEffect(() => {
    if (!roleLoading && !isAdmin && !isManager) {
      navigate('/schedule-templates');
      toast.error('Access denied');
    }
  }, [isAdmin, isManager, roleLoading, navigate]);

  useEffect(() => {
    if ((isAdmin || isManager) && currentLocation?.id) {
      fetchData();
    }
  }, [isAdmin, isManager, currentLocation?.id, id]);

  const fetchData = async () => {
    if (!currentLocation?.id) return;
    
    try {
      setLoading(true);

      // Fetch shift templates
      const { data: shiftData, error: shiftError } = await supabase
        .from("shift_templates")
        .select("*")
        .eq("location_id", currentLocation.id)
        .order("start_time", { ascending: true });

      if (shiftError) throw shiftError;
      setShiftTemplates(shiftData || []);

      // If editing existing template, fetch it
      if (!isNew && id) {
        const { data: weekTemplate, error: weekError } = await supabase
          .from("week_templates")
          .select("*")
          .eq("id", id)
          .single();

        if (weekError) throw weekError;
        
        setTemplateName(weekTemplate.template_name);
        setDescription(weekTemplate.description || "");

        // Fetch assignments
        const { data: assignments, error: assignError } = await supabase
          .from("week_template_assignments")
          .select("*, shift_templates(*)")
          .eq("week_template_id", id);

        if (assignError) throw assignError;

        // Group by day
        const byDay = new Map<number, Assignment[]>();
        (assignments || []).forEach((a: any) => {
          const dayAssignments = byDay.get(a.day_of_week) || [];
          dayAssignments.push({
            id: a.id,
            shift_template_id: a.shift_template_id,
            day_of_week: a.day_of_week,
            shift_template: a.shift_templates,
          });
          byDay.set(a.day_of_week, dayAssignments);
        });
        setAssignmentsByDay(byDay);
      }
    } catch (error) {
      console.error('Error fetching data:', error);
      toast.error('Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  const handleDragStart = (event: DragStartEvent) => {
    const data = event.active.data.current;
    if (data?.template) {
      setActiveTemplate(data.template);
    } else if (data?.assignment?.shift_template) {
      setActiveTemplate(data.assignment.shift_template);
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveTemplate(null);

    if (!over) return;

    const overId = over.id as string;
    if (!overId.startsWith('day-')) return;

    const dayIndex = parseInt(overId.replace('day-', ''));
    const data = active.data.current;

    if (data?.isFromList && data?.template) {
      // Adding from shift templates list
      const newAssignment: Assignment = {
        shift_template_id: data.template.id,
        day_of_week: dayIndex,
        shift_template: data.template,
      };

      setAssignmentsByDay(prev => {
        const newMap = new Map(prev);
        const dayAssignments = [...(newMap.get(dayIndex) || []), newAssignment];
        newMap.set(dayIndex, dayAssignments);
        return newMap;
      });
    }
  };

  const handleRemoveAssignment = (dayIndex: number, assignmentIndex: number) => {
    setAssignmentsByDay(prev => {
      const newMap = new Map(prev);
      const dayAssignments = [...(newMap.get(dayIndex) || [])];
      dayAssignments.splice(assignmentIndex, 1);
      newMap.set(dayIndex, dayAssignments);
      return newMap;
    });
  };

  const handleSave = async () => {
    if (!templateName.trim()) {
      toast.error('Please enter a template name');
      return;
    }

    if (!currentLocation?.id) {
      toast.error('No location selected');
      return;
    }

    try {
      setSaving(true);

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      let weekTemplateId = id;

      if (isNew) {
        // Create new week template
        const { data: newTemplate, error: createError } = await supabase
          .from("week_templates")
          .insert({
            template_name: templateName.trim(),
            description: description.trim() || null,
            location_id: currentLocation.id,
            created_by: user.id,
          })
          .select()
          .single();

        if (createError) throw createError;
        weekTemplateId = newTemplate.id;
      } else {
        // Update existing
        const { error: updateError } = await supabase
          .from("week_templates")
          .update({
            template_name: templateName.trim(),
            description: description.trim() || null,
          })
          .eq("id", id);

        if (updateError) throw updateError;

        // Delete existing assignments
        const { error: deleteError } = await supabase
          .from("week_template_assignments")
          .delete()
          .eq("week_template_id", id);

        if (deleteError) throw deleteError;
      }

      // Insert all assignments
      const allAssignments: { week_template_id: string; shift_template_id: string; day_of_week: number }[] = [];
      assignmentsByDay.forEach((assignments, dayIndex) => {
        assignments.forEach(a => {
          allAssignments.push({
            week_template_id: weekTemplateId!,
            shift_template_id: a.shift_template_id,
            day_of_week: dayIndex,
          });
        });
      });

      if (allAssignments.length > 0) {
        const { error: insertError } = await supabase
          .from("week_template_assignments")
          .insert(allAssignments);

        if (insertError) throw insertError;
      }

      toast.success(isNew ? 'Week template created!' : 'Week template updated!');
      navigate('/schedule-templates?tab=weeks');
    } catch (error) {
      console.error('Error saving template:', error);
      toast.error('Failed to save template');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-64">
          <p>Loading...</p>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-4">
            <Button variant="outline" onClick={() => navigate('/schedule-templates?tab=weeks')}>
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back
            </Button>
            <h1 className="text-2xl font-bold">
              {isNew ? 'Create Week Template' : 'Edit Week Template'}
            </h1>
          </div>
          <Button onClick={handleSave} disabled={saving}>
            <Save className="h-4 w-4 mr-2" />
            {saving ? 'Saving...' : 'Save Template'}
          </Button>
        </div>

        {/* Template Info */}
        <Card className="p-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <Label htmlFor="name">Template Name</Label>
              <Input
                id="name"
                value={templateName}
                onChange={(e) => setTemplateName(e.target.value)}
                placeholder="e.g., Standard Week, Holiday Week"
              />
            </div>
            <div>
              <Label htmlFor="description">Description (optional)</Label>
              <Textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Notes about this template..."
                rows={1}
              />
            </div>
          </div>
        </Card>

        <DndContext
          sensors={sensors}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          collisionDetection={closestCenter}
        >
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
            {/* Shift Templates List */}
            <Card className="p-4 lg:col-span-1 h-fit lg:sticky lg:top-4">
              <h2 className="font-semibold mb-3">Shift Templates</h2>
              <p className="text-xs text-muted-foreground mb-4">
                Drag shifts to days on the right
              </p>
              
              {shiftTemplates.length > 0 ? (
                <div className="space-y-2">
                  {shiftTemplates.map((template) => (
                    <DraggableShiftTemplate key={template.id} template={template} />
                  ))}
                </div>
              ) : (
                <div className="text-center py-4">
                  <p className="text-sm text-muted-foreground mb-2">No shift templates</p>
                  <Button variant="outline" size="sm" onClick={() => navigate('/shift-templates')}>
                    Create Shift Templates
                  </Button>
                </div>
              )}
            </Card>

            {/* Days Grid - Two Rows */}
            <div className="lg:col-span-3 space-y-4">
              {/* Row 1: Mon-Thu */}
              <div className="grid grid-cols-4 gap-3">
                {dayNames.slice(0, 4).map((dayName, index) => (
                  <DroppableDay
                    key={index}
                    dayIndex={index}
                    dayName={dayName}
                    assignments={assignmentsByDay.get(index) || []}
                    onRemoveAssignment={(assignmentIndex) => handleRemoveAssignment(index, assignmentIndex)}
                  />
                ))}
              </div>
              {/* Row 2: Fri-Sun */}
              <div className="grid grid-cols-3 gap-3">
                {dayNames.slice(4).map((dayName, sliceIndex) => {
                  const index = sliceIndex + 4;
                  return (
                    <DroppableDay
                      key={index}
                      dayIndex={index}
                      dayName={dayName}
                      assignments={assignmentsByDay.get(index) || []}
                      onRemoveAssignment={(assignmentIndex) => handleRemoveAssignment(index, assignmentIndex)}
                    />
                  );
                })}
              </div>
            </div>
          </div>

          <DragOverlay>
            {activeTemplate && (
              <div className="p-3 bg-card border rounded-lg shadow-lg opacity-90">
                <div className="flex items-center gap-2">
                  <div
                    className="w-3 h-3 rounded-full"
                    style={{ backgroundColor: activeTemplate.color }}
                  />
                  <div>
                    <p className="font-medium text-sm">{activeTemplate.position}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatTime12Hour(activeTemplate.start_time)} - {formatTime12Hour(activeTemplate.end_time)}
                    </p>
                  </div>
                </div>
              </div>
            )}
          </DragOverlay>
        </DndContext>
      </div>
    </Layout>
  );
}
