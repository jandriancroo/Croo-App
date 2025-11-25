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
import { useUserRole } from '@/hooks/useUserRole';
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, DragEndEvent } from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

interface ChecklistItem {
  id?: string;
  question: string;
  item_type: 'text' | 'multiple_choice' | 'image' | 'confirmation';
  is_required: boolean;
  options?: string[];
  reference_image_url?: string;
  reference_link?: string;
  reference_video_url?: string;
  reference_notes?: string;
  order_index: number;
  days_of_week?: number[];
}

interface SortableChecklistItemProps {
  id: string;
  item: ChecklistItem;
  index: number;
  updateItem: (index: number, field: keyof ChecklistItem, value: any) => void;
  removeItem: (index: number) => void;
  templateType: 'standard' | 'weekly';
  dayNames: string[];
}

function SortableChecklistItem({ id, item, index, updateItem, removeItem, templateType, dayNames }: SortableChecklistItemProps) {
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
            placeholder="Question"
            className="flex-1"
          />
          <Select
            value={item.item_type}
            onValueChange={(value) => updateItem(index, 'item_type', value)}
          >
            <SelectTrigger className="w-[160px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="text">Text</SelectItem>
              <SelectItem value="multiple_choice">Multiple Choice</SelectItem>
              <SelectItem value="image">Photo</SelectItem>
              <SelectItem value="confirmation">Checkmark</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="ghost" size="icon" onClick={() => removeItem(index)}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        {item.item_type === 'multiple_choice' && (
          <Input
            value={item.options?.join(', ') || ''}
            onChange={(e) =>
              updateItem(index, 'options', e.target.value.split(',').map((opt) => opt.trim()))
            }
            placeholder="Options (comma-separated)"
            className="text-sm"
          />
        )}

        {templateType === 'weekly' && (
          <div className="space-y-2">
            <Label className="text-sm">Days of Week</Label>
            <div className="grid grid-cols-4 gap-2">
              {dayNames.map((day, dayIndex) => (
                <div key={dayIndex} className="flex items-center space-x-2">
                  <Checkbox
                    id={`item-${index}-day-${dayIndex}`}
                    checked={item.days_of_week?.includes(dayIndex) || false}
                    onCheckedChange={(checked) => {
                      const currentDays = item.days_of_week || [];
                      if (checked) {
                        updateItem(index, 'days_of_week', [...currentDays, dayIndex].sort());
                      } else {
                        updateItem(index, 'days_of_week', currentDays.filter(d => d !== dayIndex));
                      }
                    }}
                  />
                  <Label htmlFor={`item-${index}-day-${dayIndex}`} className="text-xs font-normal">
                    {day.substring(0, 3)}
                  </Label>
                </div>
              ))}
            </div>
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
  const [templateType, setTemplateType] = useState<'standard' | 'weekly'>('standard');
  const [selectedRoles, setSelectedRoles] = useState<string[]>([]);
  const [items, setItems] = useState<ChecklistItem[]>([]);

  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  useEffect(() => {
    if (!roleLoading && !isAdmin) {
      navigate('/dashboard');
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

  const fetchChecklist = async () => {
    try {
      setLoading(true);
      
      const { data: checklist, error: checklistError } = await supabase
        .from('checklists')
        .select('*')
        .eq('id', id)
        .single();

      if (checklistError) throw checklistError;

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
      setDueByTime(checklist.due_by_time || '');
      setTemplateType((checklist.template_type || 'standard') as 'standard' | 'weekly');
      setSelectedRoles(roleTags?.map(rt => rt.role) || []);
      setItems(checklistItems.map(item => ({
        id: item.id,
        question: item.question,
        // Map database types - 'text' in DB can be 'confirmation' in UI
        item_type: (item.item_type === 'text' && item.question.includes('Ready')) ? 'confirmation' : item.item_type as 'text' | 'multiple_choice' | 'image' | 'confirmation',
        is_required: item.is_required,
        options: item.options as string[] | undefined,
        reference_image_url: item.reference_image_url || undefined,
        reference_link: item.reference_link || undefined,
        reference_video_url: item.reference_video_url || undefined,
        reference_notes: item.reference_notes || undefined,
        order_index: item.order_index,
        days_of_week: item.days_of_week as number[] | undefined,
      })));
    } catch (error) {
      console.error('Error fetching checklist:', error);
      toast({
        title: 'Error',
        description: 'Failed to load checklist',
        variant: 'destructive',
      });
      navigate('/dashboard');
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

      // Update checklist
      const { error: checklistError } = await supabase
        .from('checklists')
        .update({
          title,
          description,
          frequency,
          due_by_time: dueByTime || null,
          template_type: templateType,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id);

      if (checklistError) throw checklistError;

      // Delete existing items
      const { error: deleteError } = await supabase
        .from('checklist_items')
        .delete()
        .eq('checklist_id', id);

      if (deleteError) throw deleteError;

      // Insert updated items - map 'confirmation' to 'text' for database
      const itemsToInsert = items.map((item, index) => ({
        checklist_id: id,
        question: item.question,
        item_type: item.item_type === 'confirmation' ? 'text' : item.item_type,
        is_required: item.is_required,
        options: item.item_type === 'multiple_choice' ? item.options : null,
        reference_image_url: item.reference_image_url || null,
        reference_link: item.reference_link || null,
        reference_video_url: item.reference_video_url || null,
        reference_notes: item.reference_notes || null,
        order_index: index,
        days_of_week: item.days_of_week || null,
      }));

      const { error: itemsError } = await supabase
        .from('checklist_items')
        .insert(itemsToInsert);

      if (itemsError) throw itemsError;

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

      navigate('/dashboard');
    } catch (error) {
      console.error('Error updating checklist:', error);
      toast({
        title: 'Error',
        description: 'Failed to update checklist',
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
      const fileExt = file.name.split('.').pop();
      const fileName = `references/${Date.now()}.${fileExt}`;
      
      const { error: uploadError } = await supabase.storage
        .from('checklist-images')
        .upload(fileName, file);

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
          <Button variant="ghost" size="icon" onClick={() => navigate('/dashboard')}>
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
            <div className="space-y-2">
              <Label htmlFor="due_by_time">Due By Time (Optional)</Label>
              <Input
                id="due_by_time"
                type="time"
                value={dueByTime}
                onChange={(e) => setDueByTime(e.target.value)}
              />
              <p className="text-sm text-muted-foreground">Suggested completion time</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="template_type">Template Type</Label>
              <Select value={templateType} onValueChange={(value: 'standard' | 'weekly') => setTemplateType(value)}>
                <SelectTrigger id="template_type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="standard">Standard Checklist</SelectItem>
                  <SelectItem value="weekly">Weekly Template</SelectItem>
                </SelectContent>
              </Select>
              {templateType === 'weekly' && (
                <p className="text-xs text-muted-foreground">
                  Assign items to specific days of the week
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label>Assigned Roles (Optional)</Label>
              <p className="text-sm text-muted-foreground mb-2">
                If no roles are selected, all users can see this checklist
              </p>
              <div className="space-y-2">
                {['admin', 'manager', 'team_member'].map((role) => (
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
                    <Label htmlFor={`role-${role}`} className="text-sm font-normal capitalize">
                      {role.replace('_', ' ')}
                    </Label>
                  </div>
                ))}
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
                    templateType={templateType}
                    dayNames={dayNames}
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
          <Button onClick={() => navigate('/dashboard')} variant="outline" className="flex-1">
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
