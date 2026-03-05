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
import { Loader2, Save, ArrowLeft, X, GripVertical, ChevronDown, ChevronUp, Upload, Link as LinkIcon, Video, Plus } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { useUserRole } from '@/hooks/useUserRole';
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, DragEndEvent } from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { compressImage } from '@/utils/imageCompression';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';

interface ChecklistItem {
  id?: string;
  question: string;
  item_type: 'text' | 'multiple_choice' | 'image' | 'confirmation' | 'temperature';
  is_required: boolean;
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
  handleReferenceImageUpload: (index: number, file: File) => void;
  showAmPmSelector?: boolean;
  showPositionSelector?: boolean;
  availablePositions?: string[];
  onEnterKey?: (index: number) => void;
  isFocused?: boolean;
  onFocus?: (index: number) => void;
  onBlur?: () => void;
}

function SortableChecklistItem({ id, item, index, updateItem, removeItem, handleReferenceImageUpload, showAmPmSelector, showPositionSelector, availablePositions, onEnterKey, isFocused, onFocus, onBlur }: SortableChecklistItemProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style = { transform: CSS.Transform.toString(transform), transition };
  const [showReference, setShowReference] = useState(false);

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex gap-1.5 p-2 border rounded-lg bg-background transition-colors ${isDragging ? 'opacity-50 z-50' : ''} ${isFocused ? 'border-primary ring-1 ring-primary/30' : ''}`}
    >
      <button
        className="touch-none cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground mt-1.5 shrink-0"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4" />
      </button>
      
      <div className="flex-1 space-y-1.5 min-w-0">
        {/* Row 1: question input + position badge + delete */}
        <div className="flex items-center gap-1.5">
          <Input
            data-checklist-item-input
            value={item.question}
            onChange={(e) => updateItem(index, 'question', e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                onEnterKey?.(index);
              }
            }}
            onFocus={() => onFocus?.(index)}
            onBlur={() => onBlur?.()}
            placeholder="Task name"
            className="flex-1 min-w-0 h-8 text-sm"
          />
          {showPositionSelector && availablePositions && availablePositions.length > 0 && (
            <Select
              value={item.position || 'none'}
              onValueChange={(value) => updateItem(index, 'position', value === 'none' ? null : value)}
            >
              <SelectTrigger className="w-auto min-w-0 h-7 px-2 text-[11px] border-dashed shrink-0">
                <SelectValue placeholder="All" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">All Positions</SelectItem>
                {availablePositions.map(pos => (
                  <SelectItem key={pos} value={pos}>{pos}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Button variant="ghost" size="icon" onClick={() => removeItem(index)} className="shrink-0 h-7 w-7">
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>

        {/* Row 2: type + shift + min photos + temp alert — all inline */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <Select
            value={item.item_type}
            onValueChange={(value) => updateItem(index, 'item_type', value)}
          >
            <SelectTrigger className="w-28 h-7 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="confirmation">Check</SelectItem>
              <SelectItem value="text">Text</SelectItem>
              <SelectItem value="image">Photo</SelectItem>
              <SelectItem value="temperature">Temp Photo</SelectItem>
              <SelectItem value="multiple_choice">Multiple Choice</SelectItem>
            </SelectContent>
          </Select>

          {showAmPmSelector && (
            <Select
              value={item.manager_shift || 'none'}
              onValueChange={(value) => updateItem(index, 'manager_shift', value === 'none' ? null : value)}
            >
              <SelectTrigger className="w-20 h-7 text-xs">
                <SelectValue placeholder="Shift" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">All</SelectItem>
                <SelectItem value="am">AM</SelectItem>
                <SelectItem value="pm">PM</SelectItem>
              </SelectContent>
            </Select>
          )}

          {(item.item_type === 'image' || item.item_type === 'temperature') && (
            <Select
              value={String((item.options && typeof item.options === 'object' && !Array.isArray(item.options)) ? item.options.minPhotos || 1 : 1)}
              onValueChange={(value) => updateItem(index, 'options', { minPhotos: parseInt(value) })}
            >
              <SelectTrigger className="w-20 h-7 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[1, 2, 3, 4, 5, 6].map(n => (
                  <SelectItem key={n} value={String(n)}>{n} photo{n > 1 ? 's' : ''}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {item.item_type === 'temperature' && (
            <label className="flex items-center gap-1 text-[11px] text-muted-foreground cursor-pointer">
              <Checkbox
                checked={item.temperature_alert_enabled || false}
                onCheckedChange={(checked) => updateItem(index, 'temperature_alert_enabled', checked)}
                className="h-3.5 w-3.5"
              />
              Temp alerts
            </label>
          )}
        </div>

        {item.item_type === 'multiple_choice' && (
          <Input
            value={Array.isArray(item.options) ? item.options.join(', ') : ''}
            onChange={(e) =>
              updateItem(index, 'options', e.target.value.split(',').map((opt) => opt.trim()))
            }
            placeholder="Options (comma-separated)"
            className="text-xs h-7"
          />
        )}

        {/* Collapsible notes + reference materials */}
        <Collapsible open={showReference} onOpenChange={setShowReference}>
          <CollapsibleTrigger asChild>
            <button type="button" className="text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-1">
              {showReference ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              {item.reference_notes ? 'Notes ✓' : 'Notes & reference'}
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-1.5 pt-1.5">
            <Textarea
              value={item.reference_notes || ''}
              onChange={(e) => updateItem(index, 'reference_notes', e.target.value)}
              placeholder="Instructions / notes (optional)"
              rows={2}
              className="text-xs"
            />
            <div className="grid grid-cols-3 gap-1.5">
              <div className="space-y-0.5">
                <Label className="text-[10px] flex items-center gap-1"><Upload className="h-2.5 w-2.5" /> Photo</Label>
                <Input
                  type="file"
                  accept="image/*"
                  className="text-[10px] h-7"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleReferenceImageUpload(index, file);
                  }}
                />
                {item.reference_image_url && (
                  <img src={item.reference_image_url} alt="Reference" className="rounded max-h-16 object-cover" />
                )}
              </div>
              <div className="space-y-0.5">
                <Label className="text-[10px] flex items-center gap-1"><LinkIcon className="h-2.5 w-2.5" /> Link</Label>
                <Input
                  type="url"
                  value={item.reference_link || ''}
                  onChange={(e) => updateItem(index, 'reference_link', e.target.value)}
                  placeholder="https://..."
                  className="text-[10px] h-7"
                />
              </div>
              <div className="space-y-0.5">
                <Label className="text-[10px] flex items-center gap-1"><Video className="h-2.5 w-2.5" /> Video</Label>
                <Input
                  type="url"
                  value={item.reference_video_url || ''}
                  onChange={(e) => updateItem(index, 'reference_video_url', e.target.value)}
                  placeholder="https://youtube.com/..."
                  className="text-[10px] h-7"
                />
              </div>
            </div>
          </CollapsibleContent>
        </Collapsible>
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
  const [positionFilteringEnabled, setPositionFilteringEnabled] = useState(false);
  const [availablePositions, setAvailablePositions] = useState<string[]>([]);
  const [items, setItems] = useState<ChecklistItem[]>([]);
  const [focusedItemIndex, setFocusedItemIndex] = useState<number | null>(null);

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
    return value.slice(0, 5);
  };

  const normalizeTimeForDb = (value: string | null | undefined) => {
    if (!value) return null;
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
      setPositionFilteringEnabled((checklist as any).position_filtering_enabled || false);
      setSelectedRoles(roleTags?.map(rt => rt.role) || []);

      // Fetch available positions
      if (checklist.location_id) {
        const { data: locData } = await supabase
          .from('locations')
          .select('organization_id')
          .eq('id', checklist.location_id)
          .single();
        
        if (locData?.organization_id) {
          const { data: orgLocs } = await supabase
            .from('locations')
            .select('id')
            .eq('organization_id', locData.organization_id);
          
          const locIds = orgLocs?.map(l => l.id) || [checklist.location_id];
          const { data: templates } = await supabase
            .from('shift_templates')
            .select('position')
            .in('location_id', locIds);
          
          const uniquePositions = [...new Set((templates || []).map(t => t.position).filter(Boolean))] as string[];
          setAvailablePositions(uniquePositions.sort());
        }
      }

      setItems((checklistItems || []).map(item => {
        // temperature is now a first-class type — also migrate old image+requires_temp items
        let itemType = item.item_type as string;
        if (itemType === 'image' && item.requires_temperature_validation) {
          itemType = 'temperature';
        }

        return {
          id: item.id,
          question: item.question,
          item_type: itemType as ChecklistItem['item_type'],
          is_required: item.is_required,
          temperature_alert_enabled: (item as any).temperature_alert_enabled || false,
          options: item.options as string[] | undefined,
          reference_image_url: item.reference_image_url || undefined,
          reference_link: item.reference_link || undefined,
          reference_video_url: item.reference_video_url || undefined,
          reference_notes: item.reference_notes || undefined,
          order_index: item.order_index,
          manager_shift: (item as any).manager_shift || null,
          position: (item as any).position || null,
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

      const checklistUpdate = {
        title,
        description,
        frequency,
        due_by_time: dueDb,
        lock_until_time: lockDb,
        template_type: templateType,
        visible_days_before_month_end: frequency === 'monthly' ? visibleDaysBeforeMonthEnd : null,
        enable_am_pm_division: enableAmPmDivision,
        position_filtering_enabled: positionFilteringEnabled,
        updated_at: new Date().toISOString(),
      };

      const { error: checklistError } = await supabase
        .from('checklists')
        .update(checklistUpdate)
        .eq('id', id);

      if (checklistError) throw checklistError;

      // Delete removed items
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

      const validItems = items.filter(item => item.question.trim() !== '');

      for (let index = 0; index < validItems.length; index++) {
        const item = validItems[index];
        // Store temperature as 'temperature' item_type directly
        const dbItemType = item.item_type;
        const itemData = {
          checklist_id: id,
          question: item.question,
          item_type: dbItemType,
          is_required: item.is_required,
          requires_temperature_validation: dbItemType === 'temperature',
          temperature_alert_enabled: dbItemType === 'temperature' ? (item.temperature_alert_enabled || false) : false,
          options: item.item_type === 'multiple_choice' ? item.options : (item.item_type === 'image' || item.item_type === 'temperature') ? item.options : null,
          reference_image_url: item.reference_image_url || null,
          reference_link: item.reference_link || null,
          reference_video_url: item.reference_video_url || null,
          reference_notes: item.reference_notes || null,
          order_index: index,
          manager_shift: enableAmPmDivision ? (item.manager_shift || null) : null,
          position: positionFilteringEnabled ? (item.position || null) : null,
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

      // Role tags
      const { error: deleteRoleTagsError } = await supabase
        .from('checklist_role_tags')
        .delete()
        .eq('checklist_id', id);
      if (deleteRoleTagsError) throw deleteRoleTagsError;

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

  const addItem = (atIndex?: number) => {
    const newItem: ChecklistItem = {
      question: '',
      item_type: 'confirmation',
      is_required: true,
      order_index: 0,
    };
    const insertAt = atIndex !== undefined ? atIndex : 0;
    const newItems = [...items];
    newItems.splice(insertAt, 0, newItem);
    setItems(newItems.map((it, i) => ({ ...it, order_index: i })));
    setFocusedItemIndex(insertAt);
    setTimeout(() => {
      const inputs = document.querySelectorAll<HTMLInputElement>('[data-checklist-item-input]');
      inputs[insertAt]?.focus();
    }, 50);
  };

  const handleReferenceImageUpload = async (index: number, file: File) => {
    try {
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
      toast({ title: 'Success', description: 'Reference image uploaded' });
    } catch (error: any) {
      toast({ title: 'Error', description: 'Failed to upload image', variant: 'destructive' });
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
      <div className="container mx-auto p-4 max-w-4xl space-y-4">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate('/tasks')}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-xl font-bold">Edit Checklist</h1>
        </div>

        {/* Condensed Basic Info */}
        <Card>
          <CardContent className="pt-4 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="title" className="text-xs">Title</Label>
                <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g., Morning Kitchen Check" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="frequency" className="text-xs">Frequency</Label>
                <Select value={frequency} onValueChange={(value: 'daily' | 'weekly' | 'monthly') => setFrequency(value)}>
                  <SelectTrigger id="frequency"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="daily">Daily</SelectItem>
                    <SelectItem value="weekly">Weekly</SelectItem>
                    <SelectItem value="monthly">Monthly</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1">
              <Label htmlFor="description" className="text-xs">Description</Label>
              <Textarea id="description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Brief description" rows={2} />
            </div>

            {frequency === 'monthly' && (
              <div className="space-y-1">
                <Label className="text-xs">Show During Last X Days of Month</Label>
                <Select value={visibleDaysBeforeMonthEnd?.toString() || '7'} onValueChange={(value) => setVisibleDaysBeforeMonthEnd(parseInt(value))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="3">Last 3 days</SelectItem>
                    <SelectItem value="5">Last 5 days</SelectItem>
                    <SelectItem value="7">Last 7 days</SelectItem>
                    <SelectItem value="10">Last 10 days</SelectItem>
                    <SelectItem value="14">Last 14 days</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <Label className="text-xs">Lock Until Time</Label>
                  <Switch checked={lockTimeEnabled} onCheckedChange={(checked) => { setLockTimeEnabled(checked); if (!checked) setLockUntilTime(''); }} />
                </div>
                {lockTimeEnabled && <Input type="time" value={lockUntilTime} onChange={(e) => setLockUntilTime(e.target.value)} />}
                <p className="text-[10px] text-muted-foreground">{lockTimeEnabled ? 'Locked until this time each day' : 'Lock checklist until a time'}</p>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Alert Time</Label>
                <Input type="time" value={dueByTime} onChange={(e) => setDueByTime(e.target.value)} />
                <p className="text-[10px] text-muted-foreground">Alert if incomplete after this time</p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Template Type</Label>
                <Select value={templateType} onValueChange={(value: 'standard' | 'dynamic') => setTemplateType(value)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="standard">Standard</SelectItem>
                    <SelectItem value="dynamic">Dynamic Calendar</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Assigned Roles</Label>
                <div className="flex flex-wrap gap-2">
                  {['admin', 'manager', 'shift_manager', 'team_member'].map((role) => (
                    <label key={role} className="flex items-center gap-1 text-xs cursor-pointer">
                      <Checkbox
                        checked={selectedRoles.includes(role)}
                        onCheckedChange={(checked) => {
                          if (checked) setSelectedRoles([...selectedRoles, role]);
                          else setSelectedRoles(selectedRoles.filter(r => r !== role));
                        }}
                      />
                      {role === 'manager' ? 'Mgr' : role === 'shift_manager' ? 'Shift Mgr' : role === 'team_member' ? 'Team' : 'Admin'}
                    </label>
                  ))}
                </div>
              </div>
            </div>

            {/* Toggle row */}
            <div className="flex flex-wrap gap-4 pt-2 border-t">
              <label className="flex items-center gap-2 text-xs cursor-pointer">
                <Switch checked={enableAmPmDivision} onCheckedChange={setEnableAmPmDivision} />
                AM/PM Division
              </label>
              <label className="flex items-center gap-2 text-xs cursor-pointer">
                <Switch checked={positionFilteringEnabled} onCheckedChange={setPositionFilteringEnabled} />
                Position Filtering
              </label>
            </div>
            {positionFilteringEnabled && availablePositions.length === 0 && (
              <p className="text-xs text-amber-600 dark:text-amber-400">No positions found. Create positions in Schedule Templates first.</p>
            )}
          </CardContent>
        </Card>

        {/* Checklist Items */}
        <Card>
          <CardHeader className="pb-2 pt-4 px-4 flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-base">Checklist Items</CardTitle>
              <CardDescription className="text-xs">Drag to reorder · Enter to add next</CardDescription>
            </div>
            <Button onClick={() => addItem()} variant="outline" size="icon" className="h-8 w-8 shrink-0">
              <Plus className="h-4 w-4" />
            </Button>
          </CardHeader>
          <CardContent className="space-y-3 px-4">
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
                    handleReferenceImageUpload={handleReferenceImageUpload}
                    showAmPmSelector={enableAmPmDivision}
                    showPositionSelector={positionFilteringEnabled}
                    availablePositions={availablePositions}
                    onEnterKey={(idx) => addItem(idx)}
                    isFocused={focusedItemIndex === index}
                    onFocus={(idx) => setFocusedItemIndex(idx)}
                    onBlur={() => setFocusedItemIndex(null)}
                  />
                ))}
              </SortableContext>
            </DndContext>
          </CardContent>
        </Card>

        <div className="flex gap-4">
          <Button onClick={() => navigate('/tasks')} variant="outline" className="flex-1">Cancel</Button>
          <Button onClick={handleSave} disabled={saving} className="flex-1">
            {saving ? (<><Loader2 className="mr-2 h-4 w-4 animate-spin" />Saving...</>) : (<><Save className="mr-2 h-4 w-4" />Save Changes</>)}
          </Button>
        </div>
      </div>
    </Layout>
  );
}
