import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Plus, Trash2, GripVertical, Edit2, Check, X, Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { DndContext, DragEndEvent, closestCenter, useSensor, useSensors, PointerSensor, TouchSensor } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useLocation as useAppLocation } from "@/hooks/useLocation";
import { cn } from "@/lib/utils";

interface ManageReviewItemsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface ReviewItem {
  id: string;
  name: string;
  description: string | null;
  display_order: number;
  is_active: boolean;
}

interface SortableItemProps {
  item: ReviewItem;
  isEditing: boolean;
  editName: string;
  editDescription: string;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: () => void;
  onEditNameChange: (value: string) => void;
  onEditDescriptionChange: (value: string) => void;
  onToggleActive: () => void;
  onDelete: () => void;
  isSaving: boolean;
}

function SortableItem({
  item,
  isEditing,
  editName,
  editDescription,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onEditNameChange,
  onEditDescriptionChange,
  onToggleActive,
  onDelete,
  isSaving,
}: SortableItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <Card
      ref={setNodeRef}
      style={style}
      className={cn(
        "mb-2 transition-shadow",
        isDragging && "shadow-lg",
        !item.is_active && "opacity-60"
      )}
    >
      <CardContent className="p-3">
        {isEditing ? (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Name</Label>
              <Input
                value={editName}
                onChange={(e) => onEditNameChange(e.target.value)}
                placeholder="Rating category name"
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Description (optional)</Label>
              <Textarea
                value={editDescription}
                onChange={(e) => onEditDescriptionChange(e.target.value)}
                placeholder="Brief description of what this measures..."
                rows={2}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={onCancelEdit}
                disabled={isSaving}
              >
                <X className="h-4 w-4 mr-1" />
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={onSaveEdit}
                disabled={isSaving || !editName.trim()}
              >
                {isSaving ? (
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                ) : (
                  <Check className="h-4 w-4 mr-1" />
                )}
                Save
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex items-start gap-3">
            <div
              {...attributes}
              {...listeners}
              className="cursor-grab active:cursor-grabbing touch-none pt-1"
            >
              <GripVertical className="h-4 w-4 text-muted-foreground" />
            </div>

            <div className="flex-1 min-w-0">
              <div className="font-medium text-sm">{item.name}</div>
              {item.description && (
                <div className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                  {item.description}
                </div>
              )}
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <div className="flex items-center gap-1.5">
                <Switch
                  checked={item.is_active}
                  onCheckedChange={onToggleActive}
                  className="scale-75"
                />
                <span className="text-xs text-muted-foreground">Active</span>
              </div>
              
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={onStartEdit}
              >
                <Edit2 className="h-3.5 w-3.5" />
              </Button>
              
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-destructive hover:text-destructive"
                onClick={onDelete}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function ManageReviewItemsDialog({ open, onOpenChange }: ManageReviewItemsDialogProps) {
  const queryClient = useQueryClient();
  const { currentLocation } = useAppLocation();
  
  const [localItems, setLocalItems] = useState<ReviewItem[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [newItemName, setNewItemName] = useState("");
  const [newItemDescription, setNewItemDescription] = useState("");
  const [showAddForm, setShowAddForm] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 200, tolerance: 8 },
    })
  );

  // Fetch review items
  const { data: reviewItems = [], isLoading } = useQuery({
    queryKey: ['performance-review-items-manage', currentLocation?.id],
    queryFn: async () => {
      if (!currentLocation) return [];
      const { data, error } = await supabase
        .from('performance_review_items')
        .select('*')
        .eq('location_id', currentLocation.id)
        .order('display_order');
      if (error) throw error;
      return data as ReviewItem[];
    },
    enabled: open && !!currentLocation,
  });

  // Sync local state when data loads
  useEffect(() => {
    if (reviewItems.length > 0) {
      setLocalItems(reviewItems);
    }
  }, [reviewItems]);

  const displayItems = localItems.length > 0 ? localItems : reviewItems;

  // Create mutation
  const createMutation = useMutation({
    mutationFn: async ({ name, description }: { name: string; description: string }) => {
      if (!currentLocation) throw new Error("No location");
      const maxOrder = Math.max(...displayItems.map(i => i.display_order), 0);
      const { error } = await supabase
        .from('performance_review_items')
        .insert({
          location_id: currentLocation.id,
          name,
          description: description || null,
          display_order: maxOrder + 1,
          is_active: true,
        });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Rating category added");
      queryClient.invalidateQueries({ queryKey: ['performance-review-items-manage'] });
      queryClient.invalidateQueries({ queryKey: ['performance-review-items'] });
      setNewItemName("");
      setNewItemDescription("");
      setShowAddForm(false);
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to add category");
    },
  });

  // Update mutation
  const updateMutation = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Partial<ReviewItem> }) => {
      const { error } = await supabase
        .from('performance_review_items')
        .update(updates)
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['performance-review-items-manage'] });
      queryClient.invalidateQueries({ queryKey: ['performance-review-items'] });
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to update");
    },
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('performance_review_items')
        .delete()
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Rating category deleted");
      queryClient.invalidateQueries({ queryKey: ['performance-review-items-manage'] });
      queryClient.invalidateQueries({ queryKey: ['performance-review-items'] });
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to delete");
    },
  });

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = displayItems.findIndex(i => i.id === active.id);
    const newIndex = displayItems.findIndex(i => i.id === over.id);
    const reordered = arrayMove(displayItems, oldIndex, newIndex);

    setLocalItems(reordered);

    try {
      await Promise.all(
        reordered.map((item, index) =>
          supabase
            .from('performance_review_items')
            .update({ display_order: index })
            .eq('id', item.id)
        )
      );
      queryClient.invalidateQueries({ queryKey: ['performance-review-items-manage'] });
      queryClient.invalidateQueries({ queryKey: ['performance-review-items'] });
      toast.success("Order updated");
    } catch (error) {
      console.error("Error updating order:", error);
      toast.error("Failed to update order");
      setLocalItems(reviewItems);
    }
  };

  const handleStartEdit = (item: ReviewItem) => {
    setEditingId(item.id);
    setEditName(item.name);
    setEditDescription(item.description || "");
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditName("");
    setEditDescription("");
  };

  const handleSaveEdit = async () => {
    if (!editingId || !editName.trim()) return;
    setIsSaving(true);
    try {
      await updateMutation.mutateAsync({
        id: editingId,
        updates: { name: editName.trim(), description: editDescription.trim() || null },
      });
      toast.success("Category updated");
      handleCancelEdit();
    } finally {
      setIsSaving(false);
    }
  };

  const handleToggleActive = (item: ReviewItem) => {
    updateMutation.mutate({
      id: item.id,
      updates: { is_active: !item.is_active },
    });
  };

  const handleDelete = (item: ReviewItem) => {
    if (confirm(`Delete "${item.name}"? This cannot be undone.`)) {
      deleteMutation.mutate(item.id);
    }
  };

  const handleAddItem = () => {
    if (!newItemName.trim()) return;
    createMutation.mutate({
      name: newItemName.trim(),
      description: newItemDescription.trim(),
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Manage Rating Categories</DialogTitle>
          <DialogDescription>
            Customize the categories used for performance reviews. Drag to reorder.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto py-2">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : displayItems.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No rating categories yet. Add one below.
            </div>
          ) : (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={displayItems.map(i => i.id)}
                strategy={verticalListSortingStrategy}
              >
                {displayItems.map((item) => (
                  <SortableItem
                    key={item.id}
                    item={item}
                    isEditing={editingId === item.id}
                    editName={editName}
                    editDescription={editDescription}
                    onStartEdit={() => handleStartEdit(item)}
                    onCancelEdit={handleCancelEdit}
                    onSaveEdit={handleSaveEdit}
                    onEditNameChange={setEditName}
                    onEditDescriptionChange={setEditDescription}
                    onToggleActive={() => handleToggleActive(item)}
                    onDelete={() => handleDelete(item)}
                    isSaving={isSaving}
                  />
                ))}
              </SortableContext>
            </DndContext>
          )}
        </div>

        {/* Add new item section */}
        <div className="border-t pt-4 mt-2">
          {showAddForm ? (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Name</Label>
                <Input
                  value={newItemName}
                  onChange={(e) => setNewItemName(e.target.value)}
                  placeholder="e.g., Customer Service"
                  autoFocus
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Description (optional)</Label>
                <Textarea
                  value={newItemDescription}
                  onChange={(e) => setNewItemDescription(e.target.value)}
                  placeholder="Brief description..."
                  rows={2}
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setShowAddForm(false);
                    setNewItemName("");
                    setNewItemDescription("");
                  }}
                  disabled={createMutation.isPending}
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={handleAddItem}
                  disabled={createMutation.isPending || !newItemName.trim()}
                >
                  {createMutation.isPending ? (
                    <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                  ) : (
                    <Plus className="h-4 w-4 mr-1" />
                  )}
                  Add Category
                </Button>
              </div>
            </div>
          ) : (
            <Button
              variant="outline"
              className="w-full"
              onClick={() => setShowAddForm(true)}
            >
              <Plus className="h-4 w-4 mr-2" />
              Add Rating Category
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
