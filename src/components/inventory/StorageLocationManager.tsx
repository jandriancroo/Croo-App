import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { GripVertical, Plus, Pencil, Trash2, Check, X, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragOverlay,
  type DragStartEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

interface StorageLocationManagerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  locationId: string;
}

interface StorageLocation {
  id: string;
  name: string;
  display_order: number;
}

function SortableLocationRow({
  loc,
  count,
  isEditing,
  editingName,
  setEditingName,
  onStartEdit,
  onConfirmEdit,
  onCancelEdit,
  onDelete,
}: {
  loc: StorageLocation;
  count: number;
  isEditing: boolean;
  editingName: string;
  setEditingName: (v: string) => void;
  onStartEdit: () => void;
  onConfirmEdit: () => void;
  onCancelEdit: () => void;
  onDelete: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: loc.id, disabled: isEditing });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    zIndex: isDragging ? 50 : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-2 px-2 py-2 rounded-md border transition-shadow ${
        isDragging ? "border-primary/40 border-dashed bg-primary/5 shadow-lg" : "border-border"
      }`}
    >
      <div
        {...attributes}
        {...listeners}
        className="touch-none cursor-grab active:cursor-grabbing shrink-0"
      >
        <GripVertical className="h-4 w-4 text-muted-foreground" />
      </div>

      {isEditing ? (
        <div className="flex items-center gap-1 flex-1 min-w-0">
          <Input
            value={editingName}
            onChange={(e) => setEditingName(e.target.value)}
            className="h-7 text-sm flex-1"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") onConfirmEdit();
              if (e.key === "Escape") onCancelEdit();
            }}
          />
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onConfirmEdit}>
            <Check className="h-3 w-3" />
          </Button>
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onCancelEdit}>
            <X className="h-3 w-3" />
          </Button>
        </div>
      ) : (
        <>
          <span className="text-sm flex-1 min-w-0 truncate">{loc.name}</span>
          <Badge variant="secondary" className="text-[10px] px-1.5 py-0 shrink-0">
            {count}
          </Badge>
          <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={onStartEdit}>
            <Pencil className="h-3 w-3" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 shrink-0 text-destructive hover:text-destructive"
            onClick={onDelete}
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        </>
      )}
    </div>
  );
}

function OverlayRow({ loc, count }: { loc: StorageLocation; count: number }) {
  return (
    <div className="flex items-center gap-2 px-2 py-2 rounded-md border border-primary bg-background shadow-xl scale-105">
      <GripVertical className="h-4 w-4 text-primary shrink-0" />
      <span className="text-sm flex-1 min-w-0 truncate font-medium">{loc.name}</span>
      <Badge variant="secondary" className="text-[10px] px-1.5 py-0 shrink-0">
        {count}
      </Badge>
    </div>
  );
}

export default function StorageLocationManager({ open, onOpenChange, locationId }: StorageLocationManagerProps) {
  const queryClient = useQueryClient();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [newName, setNewName] = useState("");
  const [addingNew, setAddingNew] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor)
  );

  const { data: locations, isLoading } = useQuery({
    queryKey: ["inventory-storage-locations", locationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory_locations")
        .select("*")
        .eq("location_id", locationId)
        .order("display_order");
      if (error) throw error;
      return data as StorageLocation[];
    },
    enabled: open,
  });

  const { data: itemCounts } = useQuery({
    queryKey: ["inventory-location-item-counts", locationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory_items")
        .select("storage_location_id")
        .eq("location_id", locationId)
        .eq("is_active", true);
      if (error) throw error;
      const counts: Record<string, number> = {};
      data.forEach(item => {
        const key = item.storage_location_id || "__none__";
        counts[key] = (counts[key] || 0) + 1;
      });
      return counts;
    },
    enabled: open,
  });

  const createMutation = useMutation({
    mutationFn: async (name: string) => {
      const maxOrder = locations?.reduce((max, l) => Math.max(max, l.display_order), -1) ?? -1;
      const { error } = await supabase
        .from("inventory_locations")
        .insert({ location_id: locationId, name, display_order: maxOrder + 1 });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inventory-storage-locations", locationId] });
      setNewName("");
      setAddingNew(false);
      toast.success("Location created");
    },
    onError: () => toast.error("Failed to create location"),
  });

  const renameMutation = useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) => {
      const { error } = await supabase
        .from("inventory_locations")
        .update({ name })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inventory-storage-locations", locationId] });
      queryClient.invalidateQueries({ queryKey: ["inventory-items", locationId] });
      setEditingId(null);
      toast.success("Location renamed");
    },
    onError: () => toast.error("Failed to rename"),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error: unassignError } = await supabase
        .from("inventory_items")
        .update({ storage_location_id: null })
        .eq("storage_location_id", id);
      if (unassignError) throw unassignError;
      const { error } = await supabase
        .from("inventory_locations")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inventory-storage-locations", locationId] });
      queryClient.invalidateQueries({ queryKey: ["inventory-items", locationId] });
      toast.success("Location deleted, items moved to Unassigned");
    },
    onError: () => toast.error("Failed to delete location"),
  });

  const reorderMutation = useMutation({
    mutationFn: async (orderedIds: string[]) => {
      const updates = orderedIds.map((id, index) =>
        supabase.from("inventory_locations").update({ display_order: index }).eq("id", id)
      );
      await Promise.all(updates);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inventory-storage-locations", locationId] });
    },
    onError: () => toast.error("Failed to reorder"),
  });

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as string);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = event;
    if (!over || active.id === over.id || !locations) return;
    const oldIndex = locations.findIndex(l => l.id === active.id);
    const newIndex = locations.findIndex(l => l.id === over.id);
    const reordered = arrayMove(locations, oldIndex, newIndex);
    reorderMutation.mutate(reordered.map(l => l.id));
  };

  const startEdit = (loc: StorageLocation) => {
    setEditingId(loc.id);
    setEditingName(loc.name);
  };

  const confirmEdit = () => {
    if (!editingId || !editingName.trim()) return;
    renameMutation.mutate({ id: editingId, name: editingName.trim() });
  };

  const confirmCreate = () => {
    if (!newName.trim()) return;
    createMutation.mutate(newName.trim());
  };

  const activeLoc = locations?.find(l => l.id === activeId);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="text-base">Storage Locations</DialogTitle>
        </DialogHeader>

        <p className="text-xs text-muted-foreground">
          Drag to reorder. Items are grouped by these during counting.
        </p>

        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={locations?.map(l => l.id) || []}
              strategy={verticalListSortingStrategy}
            >
              <div className="flex-1 overflow-y-auto space-y-1 min-h-0">
                {locations?.map(loc => {
                  const count = itemCounts?.[loc.id] || 0;
                  const isEditing = editingId === loc.id;

                  return (
                    <SortableLocationRow
                      key={loc.id}
                      loc={loc}
                      count={count}
                      isEditing={isEditing}
                      editingName={editingName}
                      setEditingName={setEditingName}
                      onStartEdit={() => startEdit(loc)}
                      onConfirmEdit={confirmEdit}
                      onCancelEdit={() => setEditingId(null)}
                      onDelete={() => {
                        if (count > 0) {
                          if (confirm(`This will move ${count} item${count !== 1 ? 's' : ''} to Unassigned. Continue?`)) {
                            deleteMutation.mutate(loc.id);
                          }
                        } else {
                          deleteMutation.mutate(loc.id);
                        }
                      }}
                    />
                  );
                })}

                {(itemCounts?.["__none__"] || 0) > 0 && (
                  <div className="flex items-center gap-2 px-2 py-2 rounded-md bg-muted/30">
                    <div className="w-4" />
                    <span className="text-sm text-muted-foreground flex-1 italic">Unassigned</span>
                    <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                      {itemCounts?.["__none__"] || 0}
                    </Badge>
                  </div>
                )}
              </div>
            </SortableContext>

            <DragOverlay>
              {activeLoc ? (
                <OverlayRow loc={activeLoc} count={itemCounts?.[activeLoc.id] || 0} />
              ) : null}
            </DragOverlay>
          </DndContext>
        )}

        {addingNew ? (
          <div className="flex items-center gap-1">
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="New location name..."
              className="h-8 text-sm flex-1"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") confirmCreate();
                if (e.key === "Escape") { setAddingNew(false); setNewName(""); }
              }}
            />
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={confirmCreate} disabled={createMutation.isPending}>
              {createMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setAddingNew(false); setNewName(""); }}>
              <X className="h-3 w-3" />
            </Button>
          </div>
        ) : (
          <Button variant="outline" size="sm" onClick={() => setAddingNew(true)} className="w-full">
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            Add Location
          </Button>
        )}
      </DialogContent>
    </Dialog>
  );
}
