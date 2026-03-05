import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Layout } from '@/components/Layout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Save, ArrowLeft, X, GripVertical } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { useUserRole } from '@/hooks/useUserRole';
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, DragEndEvent } from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { compressImage } from '@/utils/imageCompression';

interface ChecklistItem {
  id?: string;
  question: string;
  item_type: 'text' | 'multiple_choice' | 'image' | 'confirmation';
  is_required: boolean;
  requires_temperature_validation?: boolean;
  temperature_alert_enabled?: boolean;
  options?: string[] | { minPhotos?: number };
  reference_image_url?: string;
  reference_link?: string;
  reference_video_url?: string;
  reference_notes?: string;
  order_index: number;
  manager_shift?: 'am' | 'pm' | null;
  position?: string | null;
}

interface SortableChecklistItemProps {
  id: string;
  item: ChecklistItem;
  index: number;
  updateItem: (index: number, field: keyof ChecklistItem, value: any) => void;
  removeItem: (index: number) => void;
  showAmPmSelector?: boolean;
}

function SortableChecklistItem({ id, item, index, updateItem, removeItem, showAmPmSelector }: SortableChecklistItemProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style = { transform: CSS.Transform.toString(transform), transition };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex gap-2 p-3 border rounded-lg bg-background ${isDragging ? 'opacity-50 z-50' : ''}`}
    >
      <button
        className="touch-none cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground mt-1"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-5 w-5" />
      </button>
      
      <div className="flex-1 space-y-3">
        <div className="flex items-start gap-2">
          <Input
            value={item.question}
            onChange={(e) => updateItem(index, 'question', e.target.value)}
            placeholder="Question/Task Name"
            className="flex-1"
          />
          <Button variant="ghost" size="icon" onClick={() => removeItem(index)} className="shrink-0">
            <X className="h-4 w-4" />
          </Button>
        </div>
        <Select
          value={item.item_type}
          onValueChange={(value) => updateItem(index, 'item_type', value)}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="text">Text</SelectItem>
            <SelectItem value="multiple_choice">Multiple Choice</SelectItem>
            <SelectItem value="image">Photo</SelectItem>
            <SelectItem value="confirmation">Checkmark</SelectItem>
          </SelectContent>
        </Select>

        {item.item_type === 'multiple_choice' && (
          <Input
            value={Array.isArray(item.options) ? item.options.join(', ') : ''}
            onChange={(e) =>
              updateItem(index, 'options', e.target.value.split(',').map((opt) => opt.trim()))
            }
            placeholder="Options (comma-separated)"
            className="text-sm"
          />
        )}

        {item.item_type === 'image' && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Label className="text-sm text-muted-foreground whitespace-nowrap">Min Photos:</Label>
              <Select
                value={String((item.options && typeof item.options === 'object' && !Array.isArray(item.options)) ? item.options.minPhotos || 1 : 1)}
                onValueChange={(value) => updateItem(index, 'options', { minPhotos: parseInt(value) })}
              >
                <SelectTrigger className="w-20">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[1, 2, 3, 4, 5, 6].map(n => (
                    <SelectItem key={n} value={String(n)}>{n}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center space-x-2">
              <Checkbox
                id={`temp-validation-${index}`}
                checked={item.requires_temperature_validation || false}
                onCheckedChange={(checked) => updateItem(index, 'requires_temperature_validation', checked)}
              />
              <Label htmlFor={`temp-validation-${index}`} className="text-sm font-normal">
                Requires Temperature Validation
              </Label>
            </div>
            {item.requires_temperature_validation && (
              <div className="flex items-center space-x-2 ml-6">
                <Checkbox
                  id={`temp-alert-${index}`}
                  checked={item.temperature_alert_enabled || false}
                  onCheckedChange={(checked) => updateItem(index, 'temperature_alert_enabled', checked)}
                />
                <Label htmlFor={`temp-alert-${index}`} className="text-sm font-normal text-muted-foreground">
                  Send push notification to managers when out of range
                </Label>
              </div>
            )}
          </div>
        )}

        {item.item_type === 'confirmation' && (
          <Textarea
            value={item.reference_notes || ''}
            onChange={(e) => updateItem(index, 'reference_notes', e.target.value)}
            placeholder="Instructions (optional)"
            rows={2}
            className="text-sm"
          />
        )}

        {showAmPmSelector && (
          <div className="flex items-center gap-2">
            <Label className="text-sm text-muted-foreground whitespace-nowrap">Shift:</Label>
            <Select
              value={item.manager_shift || 'none'}
              onValueChange={(value) => updateItem(index, 'manager_shift', value === 'none' ? null : value)}
            >
              <SelectTrigger className="w-32">
                <SelectValue placeholder="None" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                <SelectItem value="am">AM</SelectItem>
                <SelectItem value="pm">PM</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
      </div>
    </div>
  );
}

export default function EditChecklist() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { isAdmin, loading: roleLoading } = useUserRole();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [frequency, setFrequency] = useState<'daily' | 'weekly' | 'monthly'>('daily');
  const [dueByTime, setDueByTime] = useState('');
  const [lockUntilTime, setLockUntilTime] = useState('');
  const [lockTimeEnabled, setLockTimeEnabled] = useState(false);
  const [templateType, setTemplateType] = useState<'standard' | 'dynamic'>('standard');
  const [selectedRoles, setSelectedRoles] = useState<string[]>([]);
  const [visibleDaysBeforeMonthEnd, setVisibleDaysBeforeMonthEnd] = useState<number | null>(7);
  const [enableAmPmDivision, setEnableAmPmDivision] = useState(false);
  const [items, setItems] = useState<ChecklistItem[]>([]);

  useEffect(() => {
    if (!roleLoading && !isAdmin) {
      navigate('/tasks');
      toast({
        title: 'Access Denied',
        description: 'Only admins can edit checklist templates.',
        variant: 'destructive',
      });
    }
  }, [isAdmin, roleLoading, navigate, toast]);

  useEffect(() => {
    if (isAdmin && id) {
      fetchChecklist();
    }
  }, [isAdmin, id]);

  const normalizeTimeForInput = (value: string | null | undefined) => {
    if (!value) return '';
    // DB may store HH:mm:ss while <input type="time"> expects HH:mm
    return value.slice(0, 5);
  };

  const normalizeTimeForDb = (value: string | null | undefined) => {
    if (!value) return null;
    // Ensure HH:mm:ss for consistency (Postgres accepts HH:mm too, but we standardize)
    if (/^\d{2}:\d{2}$/.test(value)) return `${value}:00`;
    return value;
  };

  const fetchChecklist = async () => {
    try {
      setLoading(true);

      const { data: checklist, error: checklistError } = await supabase
        .from('checklists')
        .select('*')
        .eq('id', id)
        .maybeSingle();

      if (checklistError) throw checklistError;
      if (!checklist) {
        toast({
          title: 'Not found',
          description: 'Checklist was not found (or you do not have access).',
          variant: 'destructive',
        });
        navigate('/tasks');
        return;
      }

      const { data: checklistItems, error: itemsError } = await supabase
        .from('checklist_items')
        .select('*')
        .eq('checklist_id', id)
        .order('order_index');

      if (itemsError) throw itemsError;

      // Fetch role tags
      const { data: roleTags, error: roleTagsError } = await supabase
        .from('checklist_role_tags')
        .select('role')
        .eq('checklist_id', id);

      if (roleTagsError) throw roleTagsError;

      setTitle(checklist.title);
      setDescription(checklist.description || '');
      setFrequency(checklist.frequency as 'daily' | 'weekly' | 'monthly');
      setDueByTime(normalizeTimeForInput(checklist.due_by_time));

      const savedLockTimeRaw = checklist.lock_until_time;
      const savedLockTime = normalizeTimeForInput(savedLockTimeRaw);
      setLockUntilTime(savedLockTime);
      setLockTimeEnabled(!!savedLockTime);

      setTemplateType((checklist.template_type || 'standard') as 'standard' | 'dynamic');
      setVisibleDaysBeforeMonthEnd(checklist.visible_days_before_month_end || 7);
      setEnableAmPmDivision((checklist as any).enable_am_pm_division || false);
      setSelectedRoles(roleTags?.map(rt => rt.role) || []);
      setItems((checklistItems || []).map(item => {
        // Map legacy 'temperature' type to 'image' with requires_temperature_validation
        const itemType = item.item_type === 'temperature' ? 'image' : item.item_type;
        const requiresTempValidation = item.item_type === 'temperature' || item.requires_temperature_validation || false;

        return {
          id: item.id,
          question: item.question,
          item_type: itemType as 'text' | 'multiple_choice' | 'image' | 'confirmation',
          is_required: item.is_required,
          requires_temperature_validation: requiresTempValidation,
          temperature_alert_enabled: (item as any).temperature_alert_enabled || false,
          options: item.options as string[] | undefined,
          reference_image_url: item.reference_image_url || undefined,
          reference_link: item.reference_link || undefined,
          reference_video_url: item.reference_video_url || undefined,
          reference_notes: item.reference_notes || undefined,
          order_index: item.order_index,
          manager_shift: (item as any).manager_shift || null,
        };
      }));
    } catch (error: any) {
      console.error('Error fetching checklist:', error);
      toast({
        title: 'Error',
        description: error?.message || 'Failed to load checklist',
        variant: 'destructive',
      });
      navigate('/tasks');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!title.trim() || items.length === 0) {
      toast({
        title: 'Validation Error',
        description: 'Please provide a title and at least one checklist item.',
        variant: 'destructive',
      });
      return;
    }

    try {
      setSaving(true);

      const lockDb = lockTimeEnabled ? normalizeTimeForDb(lockUntilTime) : null;
      const dueDb = normalizeTimeForDb(dueByTime);

      // Update checklist
      const checklistUpdate = {
        title,
        description,
        frequency,
        due_by_time: dueDb,
        lock_until_time: lockDb,
        template_type: templateType,
        visible_days_before_month_end: frequency === 'monthly' ? visibleDaysBeforeMonthEnd : null,
        enable_am_pm_division: enableAmPmDivision,
        updated_at: new Date().toISOString(),
      };

      console.log('[EditChecklist] Saving checklist update:', { id, ...checklistUpdate });

      const { error: checklistError } = await supabase
        .from('checklists')
        .update(checklistUpdate)
        .eq('id', id);

      if (checklistError) throw checklistError;

      // Delete items that were removed (query DB ids → delete missing)
      const currentIds = new Set(items.filter(i => i.id).map(i => i.id as string));
      const { data: dbItems, error: dbItemsError } = await supabase
        .from('checklist_items')
        .select('id')
        .eq('checklist_id', id);

      if (dbItemsError) throw dbItemsError;

      const removedIds = (dbItems || [])
        .map(r => r.id)
        .filter((dbId) => !currentIds.has(dbId));

      if (removedIds.length > 0) {
        const { error: deleteError } = await supabase
          .from('checklist_items')
          .delete()
          .in('id', removedIds);

        if (deleteError) throw deleteError;
      }

      // Filter out empty items before saving
      const validItems = items.filter(item => item.question.trim() !== '');

      // Update existing items and insert new ones
      for (let index = 0; index < validItems.length; index++) {
        const item = validItems[index];
        const itemData = {
          checklist_id: id,
          question: item.question,
          item_type: item.item_type,
          is_required: item.is_required,
          requires_temperature_validation: item.item_type === 'image' ? (item.requires_temperature_validation || false) : false,
          temperature_alert_enabled: item.item_type === 'image' && item.requires_temperature_validation ? (item.temperature_alert_enabled || false) : false,
          options: item.item_type === 'multiple_choice' ? item.options : null,
          reference_image_url: item.reference_image_url || null,
          reference_link: item.reference_link || null,
          reference_video_url: item.reference_video_url || null,
          reference_notes: item.reference_notes || null,
          order_index: index,
          manager_shift: enableAmPmDivision ? (item.manager_shift || null) : null,
        };

        if (item.id) {
          const { error: updateError } = await supabase
            .from('checklist_items')
            .update(itemData)
            .eq('id', item.id);

          if (updateError) throw updateError;
        } else {
          const { error: insertError } = await supabase
            .from('checklist_items')
            .insert(itemData);

          if (insertError) throw insertError;
        }
      }

      // Delete existing role tags
      const { error: deleteRoleTagsError } = await supabase
        .from('checklist_role_tags')
        .delete()
        .eq('checklist_id', id);

      if (deleteRoleTagsError) throw deleteRoleTagsError;

      // Insert new role tags if any are selected
      if (selectedRoles.length > 0) {
        const roleTagsToInsert = selectedRoles.map(role => ({
          checklist_id: id,
          role: role as 'admin' | 'manager' | 'team_member',
        }));

        const { error: roleTagsError } = await supabase
          .from('checklist_role_tags')
          .insert(roleTagsToInsert);

        if (roleTagsError) throw roleTagsError;
      }

      toast({
        title: 'Success',
        description: 'Checklist updated successfully',
      });

      navigate('/tasks');
    } catch (error: any) {
      console.error('Error updating checklist:', error);
      toast({
        title: 'Error',
        description: error?.message || error?.details || 'Failed to update checklist',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  const addItem = () => {
    setItems([...items, {
      question: '',
      item_type: 'text',
      is_required: true,
      order_index: items.length,
    }]);
  };

  const handleReferenceImageUpload = async (index: number, file: File) => {
    try {
      // Compress image to reduce memory usage on mobile
      const compressedFile = await compressImage(file, 1200, 1200, 0.8);
      const fileName = `references/${Date.now()}.jpg`;
      
      const { error: uploadError } = await supabase.storage
        .from('checklist-images')
        .upload(fileName, compressedFile);

      if (uploadError) throw uploadError;

      const { data } = supabase.storage
        .from('checklist-images')
        .getPublicUrl(fileName);

      updateItem(index, 'reference_image_url', data.publicUrl);
      toast({
        title: 'Success',
        description: 'Reference image uploaded',
      });
    } catch (error: any) {
      toast({
        title: 'Error',
        description: 'Failed to upload image',
        variant: 'destructive',
      });
    }
  };

  const removeItem = (index: number) => {
    setItems(items.filter((_, i) => i !== index));
  };

  const updateItem = (index: number, field: keyof ChecklistItem, value: any) => {
    const newItems = [...items];
    newItems[index] = { ...newItems[index], [field]: value };
    setItems(newItems);
  };

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      setItems((items) => {
        const oldIndex = items.findIndex((_, i) => `item-${i}` === active.id);
        const newIndex = items.findIndex((_, i) => `item-${i}` === over.id);
        return arrayMove(items, oldIndex, newIndex);
      });
    }
  };

  if (roleLoading || loading) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </Layout>
    );
  }

  if (!isAdmin) return null;

  return (
    <Layout>
      <div className="container mx-auto p-6 max-w-4xl space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate('/tasks')}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-3xl font-bold">Edit Checklist Template</h1>
            <p className="text-muted-foreground">Update your checklist template</p>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Basic Information</CardTitle>
            <CardDescription>Update the checklist details</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="title">Title</Label>
              <Input
                id="title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g., Morning Kitchen Check"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Brief description of this checklist"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="frequency">Frequency</Label>
              <Select value={frequency} onValueChange={(value: 'daily' | 'weekly' | 'monthly') => setFrequency(value)}>
                <SelectTrigger id="frequency">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="daily">Daily</SelectItem>
                  <SelectItem value="weekly">Weekly</SelectItem>
                  <SelectItem value="monthly">Monthly</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {frequency === 'monthly' && (
              <div className="space-y-2">
                <Label htmlFor="visible_days">Show During Last X Days of Month</Label>
                <Select 
                  value={visibleDaysBeforeMonthEnd?.toString() || '7'} 
                  onValueChange={(value) => setVisibleDaysBeforeMonthEnd(parseInt(value))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="3">Last 3 days</SelectItem>
                    <SelectItem value="5">Last 5 days</SelectItem>
                    <SelectItem value="7">Last 7 days (1 week)</SelectItem>
                    <SelectItem value="10">Last 10 days</SelectItem>
                    <SelectItem value="14">Last 14 days (2 weeks)</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  This checklist will only appear during the selected window at the end of each month
                </p>
              </div>
            )}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label htmlFor="lock_time_toggle">Lock Until Time</Label>
                <Switch
                  id="lock_time_toggle"
                  checked={lockTimeEnabled}
                  onCheckedChange={(checked) => {
                    setLockTimeEnabled(checked);
                    if (!checked) setLockUntilTime('');
                  }}
                />
              </div>
              {lockTimeEnabled && (
                <Input
                  id="lock_until_time"
                  type="time"
                  value={lockUntilTime}
                  onChange={(e) => setLockUntilTime(e.target.value)}
                  placeholder="Select time"
                />
              )}
              <p className="text-xs text-muted-foreground">
                {lockTimeEnabled 
                  ? 'Checklist will be visible but locked until this time each day'
                  : 'Enable to lock this checklist until a specific time each day'}
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="due_by_time">Alert Time</Label>
              <Input
                id="due_by_time"
                type="time"
                value={dueByTime}
                onChange={(e) => setDueByTime(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Push notification alerts will be sent if this checklist is incomplete after this time
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="template_type">Template Type</Label>
              <Select value={templateType} onValueChange={(value: 'standard' | 'dynamic') => setTemplateType(value)}>
                <SelectTrigger id="template_type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="standard">Standard Checklist</SelectItem>
                  <SelectItem value="dynamic">Dynamic Calendar Template</SelectItem>
                </SelectContent>
              </Select>
              {templateType === 'dynamic' && (
                <p className="text-xs text-muted-foreground">
                  Go to calendar view to assign tasks to specific days
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label>Assigned Roles (Optional)</Label>
              <p className="text-sm text-muted-foreground mb-2">
                If no roles are selected, all users can see this checklist
              </p>
              <div className="space-y-2">
                {['admin', 'manager', 'shift_manager', 'team_member'].map((role) => (
                  <div key={role} className="flex items-center space-x-2">
                    <Checkbox
                      id={`role-${role}`}
                      checked={selectedRoles.includes(role)}
                      onCheckedChange={(checked) => {
                        if (checked) {
                          setSelectedRoles([...selectedRoles, role]);
                        } else {
                          setSelectedRoles(selectedRoles.filter(r => r !== role));
                        }
                      }}
                    />
                    <Label htmlFor={`role-${role}`} className="text-sm font-normal">
                      {role === 'manager' ? 'Manager' : role === 'shift_manager' ? 'Shift Manager' : role === 'team_member' ? 'Team Member' : 'Admin'}
                    </Label>
                  </div>
                ))}
              </div>
            </div>
            <div className="space-y-2 pt-4 border-t">
              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor="am-pm-division">AM/PM Manager Division</Label>
                  <p className="text-xs text-muted-foreground">
                    Separate checklist items by shift responsibility
                  </p>
                </div>
                <Switch
                  id="am-pm-division"
                  checked={enableAmPmDivision}
                  onCheckedChange={setEnableAmPmDivision}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Checklist Items</CardTitle>
            <CardDescription>Drag items to reorder</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={items.map((_, i) => `item-${i}`)} strategy={verticalListSortingStrategy}>
                {items.map((item, index) => (
                  <SortableChecklistItem
                    key={`item-${index}`}
                    id={`item-${index}`}
                    item={item}
                    index={index}
                    updateItem={updateItem}
                    removeItem={removeItem}
                    showAmPmSelector={enableAmPmDivision}
                  />
                ))}
              </SortableContext>
            </DndContext>

            <Button onClick={addItem} variant="outline" className="w-full">
              Add Item
            </Button>
          </CardContent>
        </Card>

        <div className="flex gap-4">
          <Button onClick={() => navigate('/tasks')} variant="outline" className="flex-1">
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving} className="flex-1">
            {saving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Save className="mr-2 h-4 w-4" />
                Save Changes
              </>
            )}
          </Button>
        </div>
      </div>
    </Layout>
  );
}
