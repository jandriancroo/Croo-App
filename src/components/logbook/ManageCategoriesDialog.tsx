import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Plus, Trash2, GripVertical, Edit2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { DndContext, DragEndEvent, closestCenter, useSensor, useSensors, PointerSensor, TouchSensor } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useLocation as useAppLocation } from "@/hooks/useLocation";

interface ManageCategoriesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface SortableCategoryItemProps {
  category: any;
  onDelete: (id: string) => void;
  onToggleAlert: (id: string, currentValue: boolean) => void;
  onTogglePushNotification: (id: string, currentValue: boolean) => void;
  onToggleActive: (id: string, currentValue: boolean) => void;
  onEditFields: (categoryId: string, fields: any[]) => void;
}

function SortableCategoryItem({ category, onDelete, onToggleAlert, onTogglePushNotification, onToggleActive, onEditFields }: SortableCategoryItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: category.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <AccordionItem 
      ref={setNodeRef} 
      style={style} 
      value={category.id} 
      className="border rounded-lg px-3"
    >
      <div className="flex items-center gap-3">
        <div
          {...attributes}
          {...listeners}
          className="cursor-grab active:cursor-grabbing touch-none"
        >
          <GripVertical className="h-4 w-4 text-muted-foreground" />
        </div>
        
        <AccordionTrigger className="flex-1 hover:no-underline py-3">
          <div className="flex items-center justify-between w-full pr-4">
            <div className="flex items-center gap-2">
              <span className="font-medium">{category.name}</span>
              <Badge variant="secondary" className="text-xs">
                {category.logbook_fields?.length || 0} fields
              </Badge>
            </div>
            <div className="flex items-center gap-2">
              {!category.is_active && (
                <Badge variant="outline">Inactive</Badge>
              )}
              {category.alert_enabled && (
                <Badge variant="outline" className="text-xs">Alert</Badge>
              )}
            </div>
          </div>
        </AccordionTrigger>

        <Button
          variant="ghost"
          size="icon"
          onClick={(e) => {
            e.stopPropagation();
            if (confirm(`Delete "${category.name}"? This will also delete all associated entries.`)) {
              onDelete(category.id);
            }
          }}
        >
          <Trash2 className="h-4 w-4 text-destructive" />
        </Button>
      </div>

      <AccordionContent className="pb-3">
        <div className="space-y-3 pt-2">
          {/* Category Settings */}
          <div className="flex flex-col gap-2 p-2 bg-muted rounded">
            <div className="flex items-center justify-between">
              <div className="flex items-center flex-wrap gap-4">
                <div className="flex items-center gap-2">
                  <Switch
                    checked={category.alert_enabled}
                    onCheckedChange={() => onToggleAlert(category.id, category.alert_enabled)}
                  />
                  <Label className="text-xs">Dashboard Alert</Label>
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    checked={category.push_notification_enabled}
                    onCheckedChange={() => onTogglePushNotification(category.id, category.push_notification_enabled)}
                  />
                  <Label className="text-xs">Push Notification</Label>
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    checked={category.is_active}
                    onCheckedChange={() => onToggleActive(category.id, category.is_active)}
                  />
                  <Label className="text-xs">Active</Label>
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => onEditFields(category.id, category.logbook_fields || [])}
              >
                <Edit2 className="h-4 w-4 mr-2" />
                Configure Fields
              </Button>
            </div>
          </div>

          {/* Show current fields */}
          {category.logbook_fields && category.logbook_fields.length > 0 && (
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Current Fields:</Label>
              <div className="grid grid-cols-2 gap-2">
                {category.logbook_fields.map((field: any) => (
                  <div key={field.id} className="text-xs p-2 bg-muted/50 rounded">
                    <span className="font-medium">{field.field_name}</span>
                    <span className="text-muted-foreground"> • {field.field_type}</span>
                    {field.is_required && <Badge variant="secondary" className="ml-1 text-[10px]">Required</Badge>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </AccordionContent>
    </AccordionItem>
  );
}

export function ManageCategoriesDialog({ open, onOpenChange }: ManageCategoriesDialogProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { currentLocation } = useAppLocation();
  const [newCategoryName, setNewCategoryName] = useState("");
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
  const [editingFields, setEditingFields] = useState<any[]>([]);
  const [localCategories, setLocalCategories] = useState<any[]>([]);

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

  const { data: categories = [] } = useQuery({
    queryKey: ['logbook-categories-manage', currentLocation?.id],
    queryFn: async () => {
      if (!currentLocation) return [];
      const { data, error } = await supabase
        .from('logbook_categories')
        .select(`
          *,
          logbook_fields(*)
        `)
        .eq('location_id', currentLocation.id)
        .order('display_order');
      if (error) throw error;
      setLocalCategories(data || []);
      return data;
    },
    enabled: open && !!currentLocation,
  });

  // Sync local categories with fetched data when categories change
  const displayCategories = localCategories.length > 0 ? localCategories : categories;

  const createCategoryMutation = useMutation({
    mutationFn: async (name: string) => {
      if (!currentLocation) throw new Error("No location selected");
      const maxOrder = Math.max(...displayCategories.map(c => c.display_order), 0);
      const { error } = await supabase
        .from('logbook_categories')
        .insert({
          name,
          display_order: maxOrder + 1,
          is_active: true,
          alert_enabled: false,
          location_id: currentLocation.id,
        });
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Category created successfully" });
      queryClient.invalidateQueries({ queryKey: ['logbook-categories-manage'] });
      queryClient.invalidateQueries({ queryKey: ['logbook-categories'] });
      setNewCategoryName("");
    },
    onError: (error: any) => {
      toast({
        title: "Error creating category",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const updateCategoryMutation = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: any }) => {
      const { error } = await supabase
        .from('logbook_categories')
        .update(updates)
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['logbook-categories-manage'] });
      queryClient.invalidateQueries({ queryKey: ['logbook-categories'] });
    },
    onError: (error: any) => {
      toast({
        title: "Error updating category",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const deleteCategoryMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('logbook_categories')
        .delete()
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Category deleted successfully" });
      queryClient.invalidateQueries({ queryKey: ['logbook-categories-manage'] });
      queryClient.invalidateQueries({ queryKey: ['logbook-categories'] });
    },
    onError: (error: any) => {
      toast({
        title: "Error deleting category",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    
    if (!over || active.id === over.id) return;

    const oldIndex = displayCategories.findIndex(c => c.id === active.id);
    const newIndex = displayCategories.findIndex(c => c.id === over.id);

    const reorderedCategories = arrayMove(displayCategories, oldIndex, newIndex);
    
    // Update local state immediately for real-time feedback
    setLocalCategories(reorderedCategories);

    // Update display_order in database
    try {
      await Promise.all(
        reorderedCategories.map((category, index) =>
          supabase
            .from('logbook_categories')
            .update({ display_order: index })
            .eq('id', category.id)
        )
      );
      
      queryClient.invalidateQueries({ queryKey: ['logbook-categories-manage'] });
      queryClient.invalidateQueries({ queryKey: ['logbook-categories'] });
      toast({ title: "Category order updated" });
    } catch (error) {
      console.error("Error updating category order:", error);
      toast({
        title: "Error updating order",
        variant: "destructive",
      });
      // Revert on error
      setLocalCategories(categories);
    }
  };

  const handleToggleAlert = (id: string, currentValue: boolean) => {
    updateCategoryMutation.mutate({
      id,
      updates: { alert_enabled: !currentValue },
    });
  };

  const handleTogglePushNotification = (id: string, currentValue: boolean) => {
    updateCategoryMutation.mutate({
      id,
      updates: { push_notification_enabled: !currentValue },
    });
  };

  const handleToggleActive = (id: string, currentValue: boolean) => {
    updateCategoryMutation.mutate({
      id,
      updates: { is_active: !currentValue },
    });
  };

  const handleCreateCategory = () => {
    if (!newCategoryName.trim()) return;
    createCategoryMutation.mutate(newCategoryName);
  };

  const handleEditFields = (categoryId: string, fields: any[]) => {
    setEditingCategoryId(categoryId);
    setEditingFields(fields.map((f, idx) => ({
      ...f,
      tempId: f.id || `temp-${idx}`,
    })));
  };

  const handleAddField = () => {
    setEditingFields([
      ...editingFields,
      {
        tempId: `temp-${Date.now()}`,
        field_name: '',
        field_type: 'text',
        is_required: false,
        display_order: editingFields.length,
      },
    ]);
  };

  const handleUpdateField = (tempId: string, updates: any) => {
    setEditingFields(editingFields.map(f => 
      f.tempId === tempId ? { ...f, ...updates } : f
    ));
  };

  const handleRemoveField = (tempId: string) => {
    setEditingFields(editingFields.filter(f => f.tempId !== tempId));
  };

  const handleSaveFields = async () => {
    if (!editingCategoryId) return;
    
    try {
      // Delete existing fields for this category
      await supabase
        .from('logbook_fields')
        .delete()
        .eq('category_id', editingCategoryId);

      // Insert new fields
      const fieldsToInsert = editingFields.map((field, index) => ({
        category_id: editingCategoryId,
        field_name: field.field_name,
        field_type: field.field_type,
        is_required: field.is_required,
        display_order: index,
      }));

      const { error } = await supabase
        .from('logbook_fields')
        .insert(fieldsToInsert);

      if (error) throw error;

      toast({ title: "Fields saved successfully" });
      queryClient.invalidateQueries({ queryKey: ['logbook-categories-manage'] });
      queryClient.invalidateQueries({ queryKey: ['logbook-fields'] });
      setEditingCategoryId(null);
      setEditingFields([]);
    } catch (error: any) {
      toast({
        title: "Error saving fields",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {editingCategoryId ? 'Edit Category Fields' : 'Manage Logs Categories'}
          </DialogTitle>
          <DialogDescription>
            {editingCategoryId 
              ? 'Configure the fields for this category' 
              : 'Drag to reorder categories, configure fields, and manage settings'
            }
          </DialogDescription>
        </DialogHeader>

        {editingCategoryId ? (
          /* Field Editor */
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold">
                Configure Fields for {displayCategories.find(c => c.id === editingCategoryId)?.name}
              </h3>
              <Button variant="ghost" size="sm" onClick={() => {
                setEditingCategoryId(null);
                setEditingFields([]);
              }}>
                <X className="h-4 w-4 mr-2" />
                Back to Categories
              </Button>
            </div>

            <div className="space-y-3">
              {editingFields.map((field) => (
                <div key={field.tempId} className="flex items-start gap-3 p-3 border rounded-lg">
                  <GripVertical className="h-4 w-4 text-muted-foreground mt-2" />
                  
                  <div className="flex-1 grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs">Field Name</Label>
                      <Input
                        placeholder="e.g., Customer Name"
                        value={field.field_name}
                        onChange={(e) => handleUpdateField(field.tempId, { field_name: e.target.value })}
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Field Type</Label>
                      <Select
                        value={field.field_type}
                        onValueChange={(value) => handleUpdateField(field.tempId, { field_type: value })}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="text">Text (short)</SelectItem>
                          <SelectItem value="textarea">Text Area (long)</SelectItem>
                          <SelectItem value="number">Number</SelectItem>
                          <SelectItem value="date">Date</SelectItem>
                          <SelectItem value="attachment">File Attachment</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={field.is_required}
                        onCheckedChange={(checked) => handleUpdateField(field.tempId, { is_required: checked })}
                      />
                      <Label className="text-xs">Required Field</Label>
                    </div>
                  </div>

                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleRemoveField(field.tempId)}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              ))}
            </div>

            <div className="flex gap-2">
              <Button onClick={handleAddField} variant="outline">
                <Plus className="h-4 w-4 mr-2" />
                Add Field
              </Button>
              <Button onClick={handleSaveFields}>
                Save Fields
              </Button>
            </div>
          </div>
        ) : (
          /* Category Manager */
          <div className="space-y-4">
            {/* Create New Category */}
            <div className="flex gap-2">
              <Input
                placeholder="New category name..."
                value={newCategoryName}
                onChange={(e) => setNewCategoryName(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && handleCreateCategory()}
              />
              <Button onClick={handleCreateCategory} disabled={!newCategoryName.trim()}>
                <Plus className="h-4 w-4 mr-2" />
                Add
              </Button>
            </div>

            {/* Categories List with Drag & Drop */}
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={displayCategories.map(c => c.id)}
                strategy={verticalListSortingStrategy}
              >
                <Accordion type="single" collapsible className="space-y-2">
                  {displayCategories.map((category: any) => (
                    <SortableCategoryItem
                      key={category.id}
                      category={category}
                      onDelete={(id) => deleteCategoryMutation.mutate(id)}
                      onToggleAlert={handleToggleAlert}
                      onTogglePushNotification={handleTogglePushNotification}
                      onToggleActive={handleToggleActive}
                      onEditFields={handleEditFields}
                    />
                  ))}
                </Accordion>
              </SortableContext>
            </DndContext>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
