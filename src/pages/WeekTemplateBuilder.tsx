import { useState, useEffect, useMemo } from "react";
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
import { ArrowLeft, Save, GripVertical, ChevronLeft, ChevronRight, Clock } from "lucide-react";
import { DndContext, DragEndEvent, DragStartEvent, DragOverlay, useSensor, useSensors, PointerSensor, TouchSensor, closestCenter } from "@dnd-kit/core";
import { useDroppable, useDraggable } from "@dnd-kit/core";
import { formatTime12Hour } from "@/lib/utils";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export interface ShiftTemplate {
  id: string;
  template_name: string;
  start_time: string;
  end_time: string;
  role: string;
  color: string;
  position: string | null;
}

export interface Assignment {
  id?: string;
  shift_template_id: string;
  day_of_week: number;
  shift_template?: ShiftTemplate;
}

interface DaySPLHGoals {
  am: string;
  pm: string;
}

function calculateShiftHours(startTime: string, endTime: string): number {
  const [startHour, startMin] = startTime.split(':').map(Number);
  const [endHour, endMin] = endTime.split(':').map(Number);
  
  let hours = endHour - startHour;
  let minutes = endMin - startMin;
  
  if (minutes < 0) {
    hours -= 1;
    minutes += 60;
  }
  
  // Handle overnight shifts
  if (hours < 0) {
    hours += 24;
  }
  
  let totalHours = hours + minutes / 60;
  
  // Deduct 30 minutes for shifts over 5 hours
  if (totalHours > 5) {
    totalHours -= 0.5;
  }
  
  return Math.max(0, totalHours);
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
  onRemoveAssignment,
  onCopyToPrevious,
  onCopyToNext,
  splhGoals,
  onSplhChange,
  totalHours,
  isFirst,
  isLast
}: { 
  dayIndex: number; 
  dayName: string; 
  assignments: Assignment[];
  onRemoveAssignment: (index: number) => void;
  onCopyToPrevious: () => void;
  onCopyToNext: () => void;
  splhGoals: DaySPLHGoals;
  onSplhChange: (field: 'am' | 'pm', value: string) => void;
  totalHours: number;
  isFirst: boolean;
  isLast: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `day-${dayIndex}`,
    data: { dayIndex },
  });

  return (
    <div
      ref={setNodeRef}
      className={`p-3 border-2 rounded-lg min-h-[280px] flex flex-col ${
        isOver ? "border-primary bg-accent/50" : "border-border"
      }`}
    >
      {/* Header with copy buttons */}
      <div className="flex items-center justify-between mb-2">
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={onCopyToPrevious}
          disabled={isFirst}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <h3 className="font-semibold text-sm text-center">{dayName}</h3>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={onCopyToNext}
          disabled={isLast}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      {/* Assignments */}
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

      {/* Footer: Labor Hours & SPLH Goals */}
      <div className="mt-3 pt-3 border-t border-border space-y-2">
        {/* Labor Hours */}
        <div className="flex items-center justify-center gap-1 text-xs">
          <Clock className="h-3 w-3 text-muted-foreground" />
          <span className="font-medium">{totalHours.toFixed(1)}h</span>
        </div>

        {/* SPLH Goals */}
        <div className="grid grid-cols-2 gap-1">
          <div>
            <label className="text-[10px] text-muted-foreground block text-center">AM $/LH</label>
            <Input
              type="number"
              value={splhGoals.am}
              onChange={(e) => onSplhChange('am', e.target.value)}
              className="h-7 text-xs text-center px-1"
              placeholder="--"
            />
          </div>
          <div>
            <label className="text-[10px] text-muted-foreground block text-center">PM $/LH</label>
            <Input
              type="number"
              value={splhGoals.pm}
              onChange={(e) => onSplhChange('pm', e.target.value)}
              className="h-7 text-xs text-center px-1"
              placeholder="--"
            />
          </div>
        </div>
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
  const [splhGoalsByDay, setSplhGoalsByDay] = useState<Map<number, DaySPLHGoals>>(new Map());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeTemplate, setActiveTemplate] = useState<ShiftTemplate | null>(null);
  
  // Copy dialog state
  const [copyDialogOpen, setCopyDialogOpen] = useState(false);
  const [copyDirection, setCopyDirection] = useState<'prev' | 'next'>('next');
  const [copyFromDay, setCopyFromDay] = useState(0);

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

  // Calculate daily labor hours
  const dailyHours = useMemo(() => {
    const hours = new Map<number, number>();
    assignmentsByDay.forEach((assignments, dayIndex) => {
      let total = 0;
      assignments.forEach(a => {
        if (a.shift_template) {
          total += calculateShiftHours(a.shift_template.start_time, a.shift_template.end_time);
        }
      });
      hours.set(dayIndex, total);
    });
    return hours;
  }, [assignmentsByDay]);

  // Calculate weekly total hours
  const weeklyTotalHours = useMemo(() => {
    let total = 0;
    dailyHours.forEach(hours => {
      total += hours;
    });
    return total;
  }, [dailyHours]);

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

        // Group by day and extract SPLH goals
        const byDay = new Map<number, Assignment[]>();
        const splhByDay = new Map<number, DaySPLHGoals>();
        
        (assignments || []).forEach((a: any) => {
          const dayAssignments = byDay.get(a.day_of_week) || [];
          dayAssignments.push({
            id: a.id,
            shift_template_id: a.shift_template_id,
            day_of_week: a.day_of_week,
            shift_template: a.shift_templates,
          });
          byDay.set(a.day_of_week, dayAssignments);
          
          // Set SPLH goals from first assignment of each day (they should be same for all)
          if (!splhByDay.has(a.day_of_week)) {
            splhByDay.set(a.day_of_week, {
              am: a.am_splh_goal?.toString() || '',
              pm: a.pm_splh_goal?.toString() || ''
            });
          }
        });
        
        setAssignmentsByDay(byDay);
        setSplhGoalsByDay(splhByDay);
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

  const handleSplhChange = (dayIndex: number, field: 'am' | 'pm', value: string) => {
    setSplhGoalsByDay(prev => {
      const newMap = new Map(prev);
      const goals = newMap.get(dayIndex) || { am: '', pm: '' };
      newMap.set(dayIndex, { ...goals, [field]: value });
      return newMap;
    });
  };

  const handleCopyClick = (fromDay: number, direction: 'prev' | 'next') => {
    setCopyFromDay(fromDay);
    setCopyDirection(direction);
    setCopyDialogOpen(true);
  };

  const handleCopyConfirm = () => {
    const targetDay = copyDirection === 'prev' ? copyFromDay - 1 : copyFromDay + 1;
    const sourceAssignments = assignmentsByDay.get(copyFromDay) || [];
    const sourceSplh = splhGoalsByDay.get(copyFromDay) || { am: '', pm: '' };
    
    // Copy assignments
    setAssignmentsByDay(prev => {
      const newMap = new Map(prev);
      const copiedAssignments = sourceAssignments.map(a => ({
        ...a,
        id: undefined,
        day_of_week: targetDay,
      }));
      newMap.set(targetDay, copiedAssignments);
      return newMap;
    });

    // Copy SPLH goals
    setSplhGoalsByDay(prev => {
      const newMap = new Map(prev);
      newMap.set(targetDay, { ...sourceSplh });
      return newMap;
    });

    setCopyDialogOpen(false);
    toast.success(`Copied ${dayNames[copyFromDay]} to ${dayNames[targetDay]}`);
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
            target_weekly_hours: weeklyTotalHours,
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
            target_weekly_hours: weeklyTotalHours,
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

      // Insert all assignments with SPLH goals
      const allAssignments: { 
        week_template_id: string; 
        shift_template_id: string; 
        day_of_week: number;
        am_splh_goal: number | null;
        pm_splh_goal: number | null;
      }[] = [];
      
      assignmentsByDay.forEach((assignments, dayIndex) => {
        const splhGoals = splhGoalsByDay.get(dayIndex) || { am: '', pm: '' };
        assignments.forEach(a => {
          allAssignments.push({
            week_template_id: weekTemplateId!,
            shift_template_id: a.shift_template_id,
            day_of_week: dayIndex,
            am_splh_goal: splhGoals.am ? parseFloat(splhGoals.am) : null,
            pm_splh_goal: splhGoals.pm ? parseFloat(splhGoals.pm) : null,
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
          <div className="flex items-center gap-4">
            {/* Weekly Total Hours */}
            <div className="flex items-center gap-2 bg-muted px-4 py-2 rounded-lg">
              <Clock className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">Weekly Hours:</span>
              <span className="text-lg font-bold">{weeklyTotalHours.toFixed(1)}h</span>
            </div>
            <Button onClick={handleSave} disabled={saving}>
              <Save className="h-4 w-4 mr-2" />
              {saving ? 'Saving...' : 'Save Template'}
            </Button>
          </div>
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
                    onCopyToPrevious={() => handleCopyClick(index, 'prev')}
                    onCopyToNext={() => handleCopyClick(index, 'next')}
                    splhGoals={splhGoalsByDay.get(index) || { am: '', pm: '' }}
                    onSplhChange={(field, value) => handleSplhChange(index, field, value)}
                    totalHours={dailyHours.get(index) || 0}
                    isFirst={index === 0}
                    isLast={index === 6}
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
                      onCopyToPrevious={() => handleCopyClick(index, 'prev')}
                      onCopyToNext={() => handleCopyClick(index, 'next')}
                      splhGoals={splhGoalsByDay.get(index) || { am: '', pm: '' }}
                      onSplhChange={(field, value) => handleSplhChange(index, field, value)}
                      totalHours={dailyHours.get(index) || 0}
                      isFirst={index === 0}
                      isLast={index === 6}
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

      {/* Copy Day Dialog */}
      <AlertDialog open={copyDialogOpen} onOpenChange={setCopyDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Copy Day</AlertDialogTitle>
            <AlertDialogDescription>
              Copy all shifts and SPLH goals from {dayNames[copyFromDay]} to {dayNames[copyDirection === 'prev' ? copyFromDay - 1 : copyFromDay + 1]}?
              This will replace any existing shifts on {dayNames[copyDirection === 'prev' ? copyFromDay - 1 : copyFromDay + 1]}.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleCopyConfirm}>Copy</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Layout>
  );
}
