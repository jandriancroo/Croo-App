import { useState, useEffect, useRef } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Layout } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useUserRole } from "@/hooks/useUserRole";
import { toast } from "sonner";
import { ArrowLeft, Save, Plus, X, ImagePlus, Trash2, Eye, Camera, CalendarDays, Sun, Moon } from "lucide-react";
import { DndContext, DragEndEvent, DragStartEvent, DragOverlay, useSensor, useSensors, PointerSensor, TouchSensor, closestCenter } from "@dnd-kit/core";
import { useDroppable } from "@dnd-kit/core";
import { useDraggable } from "@dnd-kit/core";
import { useLocationTimezone } from "@/hooks/useLocationTimezone";
import { useLocation } from "@/hooks/useLocation";

interface ChecklistItem {
  id: string;
  question: string;
  item_type: string;
  order_index: number;
  days_of_week: number[] | null;
  requires_temperature_validation: boolean;
  reference_image_url: string | null;
  reference_notes: string | null;
  manager_shift: 'am' | 'pm' | null;
}

type DbChecklistItem = {
  id: string;
  question: string;
  item_type: string;
  order_index: number;
  days_of_week: number[] | null;
  requires_temperature_validation: boolean;
  reference_image_url: string | null;
  reference_notes: string | null;
  manager_shift: string | null;
};

const normalizeItem = (row: DbChecklistItem): ChecklistItem => ({
  id: row.id,
  question: row.question,
  item_type: row.item_type,
  order_index: row.order_index,
  days_of_week: row.days_of_week ?? null,
  requires_temperature_validation: !!row.requires_temperature_validation,
  reference_image_url: row.reference_image_url ?? null,
  reference_notes: row.reference_notes ?? null,
  manager_shift: row.manager_shift === 'am' || row.manager_shift === 'pm' ? row.manager_shift : null,
});

interface Checklist {
  id: string;
  title: string;
  description: string | null;
}

interface Holiday {
  id: string;
  holiday_name: string;
  holiday_date: string;
  holiday_type: string;
}

function DraggableTask({ task, onDelete, onUpdateRefImage, onUpdateRefNotes, onOpenAssign }: { task: ChecklistItem; onDelete?: (id: string) => void; onUpdateRefImage?: (id: string, url: string | null) => void; onUpdateRefNotes?: (id: string, notes: string | null) => void; onOpenAssign?: (task: ChecklistItem) => void }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: task.id,
    data: { task },
  });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogNotes, setDialogNotes] = useState(task.reference_notes || '');
  const [dialogImageUrl, setDialogImageUrl] = useState(task.reference_image_url || '');
  const [uploading, setUploading] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);

  const style = transform
    ? {
        transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
        opacity: isDragging ? 0.5 : 1,
      }
    : undefined;

  const handleOpenDialog = () => {
    setDialogNotes(task.reference_notes || '');
    setDialogImageUrl(task.reference_image_url || '');
    setDialogOpen(true);
  };

  const handleDialogImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);

    try {
      const fileName = `checklist-refs/${task.id}-${Date.now()}.${file.name.split('.').pop()}`;
      const { error: uploadError } = await supabase.storage
        .from('checklist-images')
        .upload(fileName, file);

      if (uploadError) throw uploadError;

      const { data } = supabase.storage
        .from('checklist-images')
        .getPublicUrl(fileName);

      setDialogImageUrl(data.publicUrl);
    } catch (error) {
      console.error('Upload error:', error);
      toast.error('Failed to upload photo');
    }
    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleSaveReference = async () => {
    try {
      const updates: Record<string, any> = {
        reference_image_url: dialogImageUrl || null,
        reference_notes: dialogNotes.trim() || null,
      };

      await supabase
        .from('checklist_items')
        .update(updates)
        .eq('id', task.id);

      onUpdateRefImage?.(task.id, dialogImageUrl || null);
      onUpdateRefNotes?.(task.id, dialogNotes.trim() || null);
      setDialogOpen(false);
      toast.success('Reference standard saved');
    } catch (error) {
      console.error('Save error:', error);
      toast.error('Failed to save reference');
    }
  };

  const handleRemoveImage = async () => {
    if (!onUpdateRefImage) return;
    await supabase
      .from('checklist_items')
      .update({ reference_image_url: null, reference_notes: null })
      .eq('id', task.id);
    onUpdateRefImage(task.id, null);
    onUpdateRefNotes?.(task.id, null);
    toast.success('Reference removed');
  };

  const hasReference = !!task.reference_image_url || !!task.reference_notes;

  return (
    <>
    <div
      ref={setNodeRef}
      style={style}
      className="p-2 bg-card border rounded group"
    >
      <div className="flex items-center justify-between gap-1">
        <div {...listeners} {...attributes} className="flex-1 cursor-grab active:cursor-grabbing min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <p className="text-sm truncate">{task.question}</p>
            {task.manager_shift === 'am' && (
              <span className="inline-flex items-center gap-0.5 text-[9px] font-semibold px-1 py-0.5 rounded-full border bg-amber-100 text-amber-900 border-amber-300 dark:bg-amber-900/30 dark:text-amber-200 dark:border-amber-700">
                <Sun className="h-2.5 w-2.5" /> AM
              </span>
            )}
            {task.manager_shift === 'pm' && (
              <span className="inline-flex items-center gap-0.5 text-[9px] font-semibold px-1 py-0.5 rounded-full border bg-indigo-900 text-indigo-100 border-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-200">
                <Moon className="h-2.5 w-2.5" /> PM
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground">{task.item_type}</p>
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          {onOpenAssign && (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 opacity-70 hover:opacity-100"
              onClick={() => onOpenAssign(task)}
              title="Assign days & shift"
            >
              <CalendarDays className="h-3.5 w-3.5" />
            </Button>
          )}
          {onUpdateRefImage && (
            <Button
              variant="ghost"
              size="icon"
              className={`h-6 w-6 transition-opacity ${hasReference ? 'opacity-100 text-primary' : 'opacity-0 group-hover:opacity-100'}`}
              onClick={handleOpenDialog}
              title={hasReference ? "Edit reference standard" : "Add reference standard"}
            >
              <ImagePlus className="h-3.5 w-3.5" />
            </Button>
          )}
          {onDelete && (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
              onClick={() => onDelete(task.id)}
            >
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
      {task.reference_image_url && (
        <div className="mt-1.5 relative group/img">
          <img 
            src={task.reference_image_url} 
            alt="Reference" 
            className="rounded max-h-16 object-cover w-full cursor-pointer" 
            onClick={() => setPreviewOpen(true)}
          />
          {task.reference_notes && (
            <p className="text-[10px] text-muted-foreground italic mt-0.5 line-clamp-1">📋 {task.reference_notes}</p>
          )}
          {onUpdateRefImage && (
            <Button
              variant="destructive"
              size="icon"
              className="h-5 w-5 absolute top-1 right-1 opacity-0 group-hover/img:opacity-100 transition-opacity"
              onClick={handleRemoveImage}
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          )}
        </div>
      )}
      {!task.reference_image_url && task.reference_notes && (
        <p className="text-[10px] text-muted-foreground italic mt-1 line-clamp-1">📋 {task.reference_notes}</p>
      )}
    </div>

    {/* Reference Standard Dialog */}
    <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
      <DialogContent className="max-w-md max-w-[calc(100vw-2rem)]">
        <DialogHeader>
          <DialogTitle className="text-base">Reference Standard</DialogTitle>
          <p className="text-xs text-muted-foreground">
            Set the quality standard for "{task.question}". This helps team members understand expectations.
          </p>
        </DialogHeader>
        <div className="space-y-4">
          {/* Photo section */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">Reference Photo</Label>
            {dialogImageUrl ? (
              <div className="relative group/preview">
                <img 
                  src={dialogImageUrl} 
                  alt="Reference" 
                  className="rounded-lg w-full max-h-48 object-cover border"
                />
                <div className="absolute top-2 right-2 flex gap-1">
                  <Button
                    variant="secondary"
                    size="icon"
                    className="h-7 w-7 bg-background/80 hover:bg-background shadow-sm"
                    onClick={() => setPreviewOpen(true)}
                  >
                    <Eye className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="destructive"
                    size="icon"
                    className="h-7 w-7 shadow-sm"
                    onClick={() => setDialogImageUrl('')}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ) : (
              <div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleDialogImageUpload}
                />
                <Button
                  variant="outline"
                  className="w-full h-24 border-dashed flex flex-col gap-1"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                >
                  {uploading ? (
                    <span className="text-sm text-muted-foreground">Uploading...</span>
                  ) : (
                    <>
                      <Camera className="h-6 w-6 text-muted-foreground" />
                      <span className="text-xs text-muted-foreground">Tap to add photo</span>
                    </>
                  )}
                </Button>
              </div>
            )}
          </div>

          {/* Notes section */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">Description</Label>
            <Textarea
              value={dialogNotes}
              onChange={e => setDialogNotes(e.target.value)}
              placeholder="Describe what a properly completed task looks like..."
              className="min-h-[80px] text-sm resize-none"
            />
            <p className="text-[10px] text-muted-foreground">
              Tip: Be specific — "All items aligned, labels facing forward" works better than "Clean shelf"
            </p>
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={() => setDialogOpen(false)}>Cancel</Button>
          <Button onClick={handleSaveReference} disabled={!dialogImageUrl && !dialogNotes.trim()}>
            Save Standard
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    {/* Image Preview Dialog */}
    <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
      <DialogContent className="max-w-2xl">
        <img src={dialogOpen ? dialogImageUrl : (task.reference_image_url || '')} alt="Reference preview" className="w-full max-h-[70vh] object-contain rounded" />
      </DialogContent>
    </Dialog>
    </>
  );
}

function UnassignedDropzone({ unassignedItems, onDelete, onUpdateRefImage, onUpdateRefNotes, onOpenAssign, onQuickAdd, newQuestion, setNewQuestion, newItemType, setNewItemType, requiresTempValidation, setRequiresTempValidation }: { 
  unassignedItems: ChecklistItem[]; 
  onDelete: (id: string) => void; 
  onUpdateRefImage: (id: string, url: string | null) => void;
  onUpdateRefNotes: (id: string, notes: string | null) => void;
  onOpenAssign: (task: ChecklistItem) => void;
  onQuickAdd: () => void;
  newQuestion: string;
  setNewQuestion: (value: string) => void;
  newItemType: string;
  setNewItemType: (value: string) => void;
  requiresTempValidation: boolean;
  setRequiresTempValidation: (value: boolean) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: 'unassigned',
  });

  return (
    <Card 
      ref={setNodeRef} 
      className={`p-4 lg:col-span-1 ${isOver ? "border-2 border-primary" : ""}`}
    >
      <h2 className="font-semibold mb-3">Unassigned Tasks</h2>
      
      {/* Quick Add Form */}
      <div className="mb-4 space-y-2 pb-4 border-b">
        <Input
          placeholder="Task description..."
          value={newQuestion}
          onChange={(e) => setNewQuestion(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && onQuickAdd()}
        />
        <Select value={newItemType} onValueChange={setNewItemType}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="TEXT">Text</SelectItem>
            <SelectItem value="CHECKBOX">Checkbox</SelectItem>
            <SelectItem value="NUMBER">Number</SelectItem>
            <SelectItem value="PHOTO">Photo</SelectItem>
          </SelectContent>
        </Select>
        {newItemType === 'PHOTO' && (
          <div className="flex items-center space-x-2">
            <Checkbox
              id="tempValidation"
              checked={requiresTempValidation}
              onCheckedChange={(checked) => setRequiresTempValidation(checked === true)}
            />
            <label htmlFor="tempValidation" className="text-sm text-muted-foreground">
              Requires temperature validation
            </label>
          </div>
        )}
        <Button onClick={onQuickAdd} className="w-full" size="sm">
          <Plus className="h-4 w-4 mr-2" />
          Add Task
        </Button>
      </div>

      <p className="text-sm text-muted-foreground mb-4">
        Drag tasks to days to assign them
      </p>
      <div className="space-y-2">
        {unassignedItems.map((task) => (
          <DraggableTask key={task.id} task={task} onDelete={onDelete} onUpdateRefImage={onUpdateRefImage} onUpdateRefNotes={onUpdateRefNotes} onOpenAssign={onOpenAssign} />
        ))}
      </div>
    </Card>
  );
}

function DroppableDay({ dayIndex, dayName, tasks, holidays, blackoutDates, onUpdateRefImage, onUpdateRefNotes, onOpenAssign }: { 
  dayIndex: number; 
  dayName: string; 
  tasks: ChecklistItem[];
  holidays: Holiday[];
  blackoutDates: string[];
  onUpdateRefImage: (id: string, url: string | null) => void;
  onUpdateRefNotes: (id: string, notes: string | null) => void;
  onOpenAssign: (task: ChecklistItem) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `day-${dayIndex}`,
    data: { dayIndex },
  });

  // Calculate the date for this day of the week using the location timezone
  const { getBusinessDateInTimezone, getDateInTimezone, timezone } = useLocationTimezone();
  const todayStr = getBusinessDateInTimezone();
  const [year, month, day] = todayStr.split('-').map(Number);
  const baseDate = new Date(year, month - 1, day);

  // Determine today's day-of-week (Mon=0..Sun=6) in the location timezone
  const todayDowName = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short' }).format(baseDate);
  const todayDowMap: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
  const todayDow = todayDowMap[todayDowName] ?? 0;

  const offset = dayIndex - todayDow;
  const targetDate = new Date(baseDate);
  targetDate.setDate(baseDate.getDate() + offset);
  const dateString = getDateInTimezone(targetDate);

  const dayHolidays = holidays.filter(h => h.holiday_date === dateString);
  const isBlackout = blackoutDates.includes(dateString);

  return (
    <div
      ref={setNodeRef}
      className={`p-4 border-2 rounded-lg min-h-[300px] ${
        isOver ? "border-primary bg-accent" : "border-border"
      }`}
    >
      <div className="mb-3">
        <h3 className="font-semibold">{dayName}</h3>
        <div className="text-xs text-muted-foreground">{targetDate.toLocaleDateString()}</div>
        {dayHolidays.length > 0 && (
          <div className="mt-1 space-y-0.5">
            {dayHolidays.map(holiday => (
              <div key={holiday.id} className="text-xs text-primary font-medium">
                {holiday.holiday_name}
              </div>
            ))}
          </div>
        )}
        {isBlackout && (
          <div className="mt-1 text-xs text-destructive font-medium">
            🚫 Blackout Date
          </div>
        )}
      </div>
      <div className="space-y-2">
        {tasks.map((task) => (
          <DraggableTask key={task.id} task={task} onUpdateRefImage={onUpdateRefImage} onUpdateRefNotes={onUpdateRefNotes} onOpenAssign={onOpenAssign} />
        ))}
      </div>
    </div>
  );
}

export default function DynamicChecklistCalendar() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { isAdmin, loading: roleLoading } = useUserRole();
  const { currentLocation } = useLocation();
  const [checklist, setChecklist] = useState<Checklist | null>(null);
  const [items, setItems] = useState<ChecklistItem[]>([]);
  const [unassignedItems, setUnassignedItems] = useState<ChecklistItem[]>([]);
  const [assignedByDay, setAssignedByDay] = useState<Map<number, ChecklistItem[]>>(new Map());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeTask, setActiveTask] = useState<ChecklistItem | null>(null);
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [blackoutDates, setBlackoutDates] = useState<string[]>([]);
  const [assignDialogTask, setAssignDialogTask] = useState<ChecklistItem | null>(null);
  const [assignDialogDays, setAssignDialogDays] = useState<number[]>([]);
  const [assignDialogShift, setAssignDialogShift] = useState<'am' | 'pm' | null>(null);
  const [assignSaving, setAssignSaving] = useState(false);
  
  // Quick add form state
  const [newQuestion, setNewQuestion] = useState("");
  const [newItemType, setNewItemType] = useState("TEXT");
  const [requiresTempValidation, setRequiresTempValidation] = useState(false);

  const dayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

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
    if (isAdmin) {
      if (id === 'new') {
        createNewTemplate();
      } else if (id) {
        fetchChecklistData();
      }
      fetchHolidaysAndBlackouts();
    }
  }, [isAdmin, id]);

  const fetchHolidaysAndBlackouts = async () => {
    try {
      // Fetch holidays for the current week using the location timezone
      const { getBusinessDateInTimezone, getDateInTimezone, timezone } = useLocationTimezone();
      const todayStr = getBusinessDateInTimezone();
      const [year, month, day] = todayStr.split('-').map(Number);
      const baseDate = new Date(year, month - 1, day);

      const dayName = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short' }).format(baseDate);
      const todayDow = ({ Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 } as Record<string, number>)[dayName] ?? 0;

      const startOfWeekDate = new Date(baseDate);
      startOfWeekDate.setDate(baseDate.getDate() - todayDow);
      const endOfWeekDate = new Date(startOfWeekDate);
      endOfWeekDate.setDate(startOfWeekDate.getDate() + 6);

      const { data: holidaysData, error: holidaysError } = await supabase
        .from("holidays")
        .select("*")
        .gte("holiday_date", getDateInTimezone(startOfWeekDate))
        .lte("holiday_date", getDateInTimezone(endOfWeekDate));

      if (holidaysError) throw holidaysError;
      setHolidays(holidaysData || []);

      // Fetch location blackout dates
      const { data: settingsData, error: settingsError } = await supabase
        .from("location_settings")
        .select("blackout_dates")
        .single();

      if (!settingsError && settingsData) {
        setBlackoutDates(settingsData.blackout_dates || []);
      }
    } catch (error) {
      console.error('Error fetching holidays/blackouts:', error);
    }
  };

  const createNewTemplate = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      if (!currentLocation?.id) {
        toast.error('Pick a location before creating a template');
        navigate('/tasks');
        return;
      }

      const { data, error } = await supabase
        .from('checklists')
        .insert({
          title: 'New Dynamic Template',
          description: 'Weekly template - assign tasks to days',
          template_type: 'dynamic',
          frequency: 'weekly',
          created_by: user.id,
          location_id: currentLocation.id,
        })
        .select()
        .single();

      if (error) throw error;

      navigate(`/dynamic-checklist/${data.id}`, { replace: true });
      setChecklist(data);
      setLoading(false);
    } catch (error) {
      console.error('Error creating template:', error);
      toast.error('Failed to create template');
      navigate('/tasks');
    }
  };

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
      const normalized: ChecklistItem[] = (itemsData || []).map((r: any) => normalizeItem(r));
      setItems(normalized);

      // Organize items by day assignment
      const unassigned: ChecklistItem[] = [];
      const byDay = new Map<number, ChecklistItem[]>();

      normalized.forEach((item) => {
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

      // Load role + individual visibility tags
      const [{ data: roleTags }, { data: userTags }] = await Promise.all([
        supabase.from('checklist_role_tags').select('role').eq('checklist_id', id),
        supabase.from('checklist_user_tags').select('user_id').eq('checklist_id', id),
      ]);
      setSelectedRoles((roleTags ?? []).map((r: any) => r.role));
      setSelectedUserIds((userTags ?? []).map((u: any) => u.user_id));

    } catch (error) {
      console.error('Error fetching checklist:', error);
      toast.error('Failed to load checklist');
      navigate('/tasks');
    } finally {
      setLoading(false);
    }
  };

  const handleQuickAdd = async () => {
    if (!newQuestion.trim() || !id) return;

    try {
      const nextOrderIndex = items.length;
      
      const { data, error } = await supabase
        .from('checklist_items')
        .insert({
          checklist_id: id,
          question: newQuestion.trim(),
          item_type: newItemType,
          order_index: nextOrderIndex,
          is_required: true,
          requires_temperature_validation: newItemType === 'PHOTO' ? requiresTempValidation : false,
        })
        .select()
        .single();

      if (error) throw error;

      const newItem: ChecklistItem = normalizeItem({ ...(data as any), days_of_week: null });

      setItems([...items, newItem]);
      setUnassignedItems([...unassignedItems, newItem]);
      setNewQuestion("");
      setNewItemType("TEXT");
      setRequiresTempValidation(false);
      toast.success('Task added');
    } catch (error) {
      console.error('Error adding task:', error);
      toast.error('Failed to add task');
    }
  };

  const handleDeleteItem = async (itemId: string) => {
    try {
      const { error } = await supabase
        .from('checklist_items')
        .delete()
        .eq('id', itemId);

      if (error) throw error;

      setItems(items.filter(item => item.id !== itemId));
      setUnassignedItems(unassignedItems.filter(item => item.id !== itemId));
      
      // Remove from assigned days
      const newAssignedByDay = new Map(assignedByDay);
      newAssignedByDay.forEach((tasks, day) => {
        newAssignedByDay.set(day, tasks.filter(t => t.id !== itemId));
      });
      setAssignedByDay(newAssignedByDay);

      toast.success('Task deleted');
    } catch (error) {
      console.error('Error deleting task:', error);
      toast.error('Failed to delete task');
    }
  };

  const handleUpdateRefImage = (itemId: string, url: string | null) => {
    const updateItem = (item: ChecklistItem) =>
      item.id === itemId ? { ...item, reference_image_url: url } : item;
    
    setItems(prev => prev.map(updateItem));
    setUnassignedItems(prev => prev.map(updateItem));
    
    const newAssignedByDay = new Map(assignedByDay);
    newAssignedByDay.forEach((tasks, day) => {
      newAssignedByDay.set(day, tasks.map(updateItem));
    });
    setAssignedByDay(newAssignedByDay);
  };

  const handleUpdateRefNotes = (itemId: string, notes: string | null) => {
    const updateItem = (item: ChecklistItem) =>
      item.id === itemId ? { ...item, reference_notes: notes } : item;
    
    setItems(prev => prev.map(updateItem));
    setUnassignedItems(prev => prev.map(updateItem));
    
    const newAssignedByDay = new Map(assignedByDay);
    newAssignedByDay.forEach((tasks, day) => {
      newAssignedByDay.set(day, tasks.map(updateItem));
    });
    setAssignedByDay(newAssignedByDay);
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

    // Remove from current location first
    const newUnassigned = unassignedItems.filter((item) => item.id !== task.id);
    const newAssignedByDay = new Map(assignedByDay);

    // Remove from all days
    assignedByDay.forEach((tasks, day) => {
      newAssignedByDay.set(
        day,
        tasks.filter((t) => t.id !== task.id)
      );
    });

    if (overId === 'unassigned') {
      // Move back to unassigned
      newUnassigned.push(task);
    } else if (overId.startsWith('day-')) {
      // Move to a specific day
      const dayIndex = parseInt(overId.replace('day-', ''));

      if (!newAssignedByDay.has(dayIndex)) {
        newAssignedByDay.set(dayIndex, []);
      }
      newAssignedByDay.get(dayIndex)!.push(task);
    }

    setUnassignedItems(newUnassigned);
    setAssignedByDay(newAssignedByDay);
  };

  const handleSave = async () => {
    if (!checklist) return;

    try {
      setSaving(true);

      const trimmedTitle = (checklist.title ?? '').trim();
      if (!trimmedTitle) {
        toast.error('Please give the template a name');
        setSaving(false);
        return;
      }

      // Persist the template name
      const { error: titleError } = await supabase
        .from('checklists')
        .update({ title: trimmedTitle })
        .eq('id', checklist.id);
      if (titleError) throw titleError;

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

      toast.success('Dynamic weekly template saved!');
      navigate('/tasks');
    } catch (error) {
      console.error('Error saving:', error);
      toast.error('Failed to save template');
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

  const handleOpenAssign = (task: ChecklistItem) => {
    setAssignDialogTask(task);
    setAssignDialogDays(task.days_of_week ?? []);
    setAssignDialogShift(task.manager_shift ?? null);
  };

  const toggleDay = (dayIdx: number) => {
    setAssignDialogDays(prev =>
      prev.includes(dayIdx) ? prev.filter(d => d !== dayIdx) : [...prev, dayIdx].sort()
    );
  };

  const handleSaveAssign = async () => {
    if (!assignDialogTask) return;
    setAssignSaving(true);
    try {
      const days = assignDialogDays.length > 0 ? assignDialogDays : null;
      const shift = assignDialogShift;
      const { error } = await supabase
        .from('checklist_items')
        .update({ days_of_week: days, manager_shift: shift })
        .eq('id', assignDialogTask.id);
      if (error) throw error;

      const updated: ChecklistItem = { ...assignDialogTask, days_of_week: days, manager_shift: shift };

      // Update items
      setItems(prev => prev.map(i => (i.id === updated.id ? updated : i)));

      // Rebuild unassigned + assignedByDay from scratch for this item
      setUnassignedItems(prev => {
        const without = prev.filter(i => i.id !== updated.id);
        return days === null ? [...without, updated] : without;
      });

      setAssignedByDay(prev => {
        const next = new Map(prev);
        // Remove from every day
        next.forEach((tasks, d) => {
          next.set(d, tasks.filter(t => t.id !== updated.id));
        });
        // Add to selected days
        (days ?? []).forEach(d => {
          const list = next.get(d) ?? [];
          next.set(d, [...list, updated]);
        });
        return next;
      });

      toast.success('Task assigned');
      setAssignDialogTask(null);
    } catch (err) {
      console.error('Assign error:', err);
      toast.error('Failed to assign task');
    } finally {
      setAssignSaving(false);
    }
  };


  return (
    <Layout>
      <div className="container mx-auto p-6 max-w-7xl space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => navigate('/tasks')}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div className="flex-1">
              <Input
                value={checklist?.title ?? ''}
                onChange={(e) => setChecklist((c) => (c ? { ...c, title: e.target.value } : c))}
                placeholder="Template name (e.g. Weekly Cleaning)"
                className="text-3xl font-bold h-auto border-0 border-b border-transparent hover:border-border focus-visible:border-primary focus-visible:ring-0 px-0 bg-transparent shadow-none"
              />
              <p className="text-muted-foreground mt-1">Assign tasks to days of the week</p>
            </div>
          </div>
          <Button onClick={handleSave} disabled={saving}>
            <Save className="mr-2 h-4 w-4" />
            {saving ? 'Saving...' : 'Save Template'}
          </Button>
        </div>

        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <div className="grid lg:grid-cols-4 gap-6">
            <UnassignedDropzone unassignedItems={unassignedItems} onDelete={handleDeleteItem} onUpdateRefImage={handleUpdateRefImage} onUpdateRefNotes={handleUpdateRefNotes} onOpenAssign={handleOpenAssign} onQuickAdd={handleQuickAdd} newQuestion={newQuestion} setNewQuestion={setNewQuestion} newItemType={newItemType} setNewItemType={setNewItemType} requiresTempValidation={requiresTempValidation} setRequiresTempValidation={setRequiresTempValidation} />

            <div className="lg:col-span-3">
              <div className="grid md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {dayNames.map((dayName, index) => (
                  <DroppableDay
                    key={index}
                    dayIndex={index}
                    dayName={dayName}
                    tasks={assignedByDay.get(index) || []}
                    holidays={holidays}
                    blackoutDates={blackoutDates}
                    onUpdateRefImage={handleUpdateRefImage}
                    onUpdateRefNotes={handleUpdateRefNotes}
                    onOpenAssign={handleOpenAssign}
                  />
                ))}
              </div>
            </div>
          </div>

          <DragOverlay>
            {activeTask ? (
              <div className="p-2 bg-card border rounded shadow-lg">
                <p className="text-sm">{activeTask.question}</p>
                <p className="text-xs text-muted-foreground">{activeTask.item_type}</p>
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>

        {/* Assign Days & Shift Dialog */}
        <Dialog open={!!assignDialogTask} onOpenChange={(open) => !open && setAssignDialogTask(null)}>
          <DialogContent className="max-w-md max-w-[calc(100vw-2rem)]">
            <DialogHeader>
              <DialogTitle className="text-base">Assign Task</DialogTitle>
              <p className="text-xs text-muted-foreground line-clamp-2">
                {assignDialogTask?.question}
              </p>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label className="text-sm font-medium">Days of the week</Label>
                <div className="grid grid-cols-2 gap-2">
                  {dayNames.map((name, idx) => {
                    const active = assignDialogDays.includes(idx);
                    return (
                      <Button
                        key={idx}
                        type="button"
                        variant={active ? 'default' : 'outline'}
                        size="sm"
                        className="justify-start"
                        onClick={() => toggleDay(idx)}
                      >
                        {active && <span className="mr-1">✓</span>}
                        {name}
                      </Button>
                    );
                  })}
                </div>
                <p className="text-[10px] text-muted-foreground">
                  Leave all unchecked to move back to Unassigned.
                </p>
              </div>

              <div className="space-y-2">
                <Label className="text-sm font-medium">Day part (optional)</Label>
                <div className="grid grid-cols-3 gap-2">
                  <Button
                    type="button"
                    variant={assignDialogShift === null ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setAssignDialogShift(null)}
                  >
                    Any
                  </Button>
                  <Button
                    type="button"
                    variant={assignDialogShift === 'am' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setAssignDialogShift('am')}
                    className={assignDialogShift === 'am' ? 'bg-amber-500 hover:bg-amber-600 text-white' : ''}
                  >
                    <Sun className="h-3.5 w-3.5 mr-1" /> AM
                  </Button>
                  <Button
                    type="button"
                    variant={assignDialogShift === 'pm' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setAssignDialogShift('pm')}
                    className={assignDialogShift === 'pm' ? 'bg-indigo-700 hover:bg-indigo-800 text-white' : ''}
                  >
                    <Moon className="h-3.5 w-3.5 mr-1" /> PM
                  </Button>
                </div>
              </div>
            </div>
            <DialogFooter className="gap-2">
              <Button variant="ghost" onClick={() => setAssignDialogTask(null)}>Cancel</Button>
              <Button onClick={handleSaveAssign} disabled={assignSaving}>
                {assignSaving ? 'Saving...' : 'Save'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </Layout>
  );
}
