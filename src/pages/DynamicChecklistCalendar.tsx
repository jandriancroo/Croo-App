import { useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Layout } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { useUserRole } from "@/hooks/useUserRole";
import { toast } from "sonner";
import { ArrowLeft, Save } from "lucide-react";
import { format, startOfWeek, addDays } from "date-fns";
import { DndContext, DragEndEvent, DragStartEvent, DragOverlay, useSensor, useSensors, PointerSensor, TouchSensor, closestCenter } from "@dnd-kit/core";
import { useDroppable } from "@dnd-kit/core";
import { useDraggable } from "@dnd-kit/core";

interface ChecklistItem {
  id: string;
  question: string;
  item_type: string;
  order_index: number;
  days_of_week: number[] | null;
}

interface Checklist {
  id: string;
  title: string;
  description: string | null;
}

interface TaskAssignment {
  itemId: string;
  question: string;
  dayIndex: number;
}

function DraggableTask({ task }: { task: ChecklistItem }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: task.id,
    data: { task },
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
      className="p-2 bg-card border rounded cursor-grab active:cursor-grabbing hover:bg-accent"
    >
      <p className="text-sm">{task.question}</p>
    </div>
  );
}

function DroppableDay({ dayIndex, dayName, tasks }: { dayIndex: number; dayName: string; tasks: ChecklistItem[] }) {
  const { setNodeRef, isOver } = useDroppable({
    id: `day-${dayIndex}`,
    data: { dayIndex },
  });

  return (
    <div
      ref={setNodeRef}
      className={`p-4 border-2 rounded-lg min-h-[300px] ${
        isOver ? "border-primary bg-accent" : "border-border"
      }`}
    >
      <h3 className="font-semibold mb-3">{dayName}</h3>
      <div className="space-y-2">
        {tasks.map((task) => (
          <div key={task.id} className="p-2 bg-muted rounded text-sm">
            {task.question}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function DynamicChecklistCalendar() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { isAdmin, loading: roleLoading } = useUserRole();
  const [checklist, setChecklist] = useState<Checklist | null>(null);
  const [items, setItems] = useState<ChecklistItem[]>([]);
  const [unassignedItems, setUnassignedItems] = useState<ChecklistItem[]>([]);
  const [assignedByDay, setAssignedByDay] = useState<Map<number, ChecklistItem[]>>(new Map());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeTask, setActiveTask] = useState<ChecklistItem | null>(null);

  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const currentWeekStart = startOfWeek(new Date(), { weekStartsOn: 0 });
  const weekDays = Array.from({ length: 7 }, (_, i) => ({
    index: i,
    name: dayNames[i],
    date: addDays(currentWeekStart, i),
  }));

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: 200,
        tolerance: 8,
      },
    })
  );

  useEffect(() => {
    if (!roleLoading && !isAdmin) {
      navigate('/tasks');
      toast.error('Access denied. Only admins can manage dynamic checklists.');
    }
  }, [isAdmin, roleLoading, navigate]);

  useEffect(() => {
    if (isAdmin && id) {
      fetchChecklistData();
    }
  }, [isAdmin, id]);

  const fetchChecklistData = async () => {
    try {
      setLoading(true);

      const { data: checklistData, error: checklistError } = await supabase
        .from('checklists')
        .select('*')
        .eq('id', id)
        .single();

      if (checklistError) throw checklistError;
      setChecklist(checklistData);

      const { data: itemsData, error: itemsError } = await supabase
        .from('checklist_items')
        .select('*')
        .eq('checklist_id', id)
        .order('order_index');

      if (itemsError) throw itemsError;
      setItems(itemsData || []);

      // Organize items by day assignment
      const unassigned: ChecklistItem[] = [];
      const byDay = new Map<number, ChecklistItem[]>();

      itemsData?.forEach((item) => {
        if (!item.days_of_week || item.days_of_week.length === 0) {
          unassigned.push(item);
        } else {
          item.days_of_week.forEach((day: number) => {
            if (!byDay.has(day)) {
              byDay.set(day, []);
            }
            byDay.get(day)!.push(item);
          });
        }
      });

      setUnassignedItems(unassigned);
      setAssignedByDay(byDay);
    } catch (error) {
      console.error('Error fetching checklist:', error);
      toast.error('Failed to load checklist');
      navigate('/tasks');
    } finally {
      setLoading(false);
    }
  };

  const handleDragStart = (event: DragStartEvent) => {
    const task = event.active.data.current?.task;
    setActiveTask(task || null);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveTask(null);

    if (!over) return;

    const task = active.data.current?.task as ChecklistItem;
    const overId = over.id as string;

    if (overId.startsWith('day-')) {
      const dayIndex = parseInt(overId.replace('day-', ''));

      // Update local state
      const newUnassigned = unassignedItems.filter((item) => item.id !== task.id);
      const newAssignedByDay = new Map(assignedByDay);

      // Remove from other days
      assignedByDay.forEach((tasks, day) => {
        newAssignedByDay.set(
          day,
          tasks.filter((t) => t.id !== task.id)
        );
      });

      // Add to target day
      if (!newAssignedByDay.has(dayIndex)) {
        newAssignedByDay.set(dayIndex, []);
      }
      newAssignedByDay.get(dayIndex)!.push(task);

      setUnassignedItems(newUnassigned);
      setAssignedByDay(newAssignedByDay);
    }
  };

  const handleSave = async () => {
    try {
      setSaving(true);

      // Update all items with their day assignments
      for (const item of items) {
        const assignedDays: number[] = [];

        assignedByDay.forEach((tasks, dayIndex) => {
          if (tasks.some((t) => t.id === item.id)) {
            assignedDays.push(dayIndex);
          }
        });

        const { error } = await supabase
          .from('checklist_items')
          .update({ days_of_week: assignedDays.length > 0 ? assignedDays : null })
          .eq('id', item.id);

        if (error) throw error;
      }

      toast.success('Task assignments saved!');
      navigate('/tasks');
    } catch (error) {
      console.error('Error saving assignments:', error);
      toast.error('Failed to save assignments');
    } finally {
      setSaving(false);
    }
  };

  if (roleLoading || loading) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-64">
          <p>Loading...</p>
        </div>
      </Layout>
    );
  }

  if (!isAdmin) return null;

  return (
    <Layout>
      <div className="container mx-auto p-6 max-w-7xl space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => navigate('/tasks')}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div>
              <h1 className="text-3xl font-bold">{checklist?.title}</h1>
              <p className="text-muted-foreground">Assign tasks to days of the week</p>
            </div>
          </div>
          <Button onClick={handleSave} disabled={saving}>
            <Save className="mr-2 h-4 w-4" />
            {saving ? 'Saving...' : 'Save Assignments'}
          </Button>
        </div>

        <div className="grid lg:grid-cols-4 gap-6">
          <Card className="p-4 lg:col-span-1">
            <h2 className="font-semibold mb-3">Unassigned Tasks</h2>
            <p className="text-sm text-muted-foreground mb-4">
              Drag tasks to days to assign them
            </p>
            <div className="space-y-2">
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragStart={handleDragStart}
                onDragEnd={handleDragEnd}
              >
                {unassignedItems.map((task) => (
                  <DraggableTask key={task.id} task={task} />
                ))}
                <DragOverlay>
                  {activeTask ? (
                    <div className="p-2 bg-card border rounded shadow-lg">
                      <p className="text-sm">{activeTask.question}</p>
                    </div>
                  ) : null}
                </DragOverlay>
              </DndContext>
            </div>
          </Card>

          <div className="lg:col-span-3">
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
            >
              <div className="grid md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {weekDays.map((day) => (
                  <DroppableDay
                    key={day.index}
                    dayIndex={day.index}
                    dayName={`${day.name} (${format(day.date, 'MMM d')})`}
                    tasks={assignedByDay.get(day.index) || []}
                  />
                ))}
              </div>
              <DragOverlay>
                {activeTask ? (
                  <div className="p-2 bg-card border rounded shadow-lg">
                    <p className="text-sm">{activeTask.question}</p>
                  </div>
                ) : null}
              </DragOverlay>
            </DndContext>
          </div>
        </div>
      </div>
    </Layout>
  );
}
