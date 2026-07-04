import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  GripVertical,
  Plus,
  Pencil,
  Trash2,
  Check,
  X,
  Loader2,
  Warehouse,
} from "lucide-react";
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

interface Props {
  locationId: string;
}

interface Storage {
  id: string;
  name: string;
  sort_order: number;
}

/**
 * Lite storage locations manager — parity with StorageLocationManager.tsx:
 * drag-to-reorder with grip handles, inline rename, per-storage item counts,
 * delete with "moves N items to Unassigned" confirmation.
 *
 * Differences from Brand: Lite uses `sort_order` (not `display_order`) and
 * soft-archives via `is_active = false` (not DELETE). Items unassign via
 * `storage_id` (not `storage_location_id`).
 */
function SortableStorageRow({
  s,
  count,
  isEditing,
  editingName,
  setEditingName,
  onStartEdit,
  onConfirmEdit,
  onCancelEdit,
  onDelete,
}: {
  s: Storage;
  count: number;
  isEditing: boolean;
  editingName: string;
  setEditingName: (v: string) => void;
  onStartEdit: () => void;
  onConfirmEdit: () => void;
  onCancelEdit: () => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: s.id, disabled: isEditing });

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
          <span className="text-sm flex-1 min-w-0 truncate">{s.name}</span>
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

function OverlayRow({ s, count }: { s: Storage; count: number }) {
  return (
    <div className="flex items-center gap-2 px-2 py-2 rounded-md border border-primary bg-background shadow-xl scale-105">
      <GripVertical className="h-4 w-4 text-primary shrink-0" />
      <span className="text-sm flex-1 min-w-0 truncate font-medium">{s.name}</span>
      <Badge variant="secondary" className="text-[10px] px-1.5 py-0 shrink-0">
        {count}
      </Badge>
    </div>
  );
}

export default function LiteStorageLocationsManager({ locationId }: Props) {
  const qc = useQueryClient();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [newName, setNewName] = useState("");
  const [addingNew, setAddingNew] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor),
  );

  const { data: storages, isLoading } = useQuery({
    queryKey: ["lite-storages", locationId],
    enabled: !!locationId,
    queryFn: async (): Promise<Storage[]> => {
      const { data, error } = await supabase
        .from("lite_storage_locations" as any)
        .select("id, name, sort_order")
        .eq("location_id", locationId)
        .eq("is_active", true)
        .order("sort_order")
        .order("name");
      if (error) throw error;
      return (data as any) || [];
    },
  });

  const { data: itemCounts } = useQuery({
    queryKey: ["lite-storage-item-counts", locationId],
    enabled: !!locationId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("lite_inventory_items" as any)
        .select("storage_id")
        .eq("location_id", locationId)
        .eq("is_active", true);
      if (error) throw error;
      const counts: Record<string, number> = {};
      (data as any[]).forEach((it) => {
        const key = it.storage_id || "__none__";
        counts[key] = (counts[key] || 0) + 1;
      });
      return counts;
    },
  });

  const createMutation = useMutation({
    mutationFn: async (name: string) => {
      const maxOrder =
        storages?.reduce((m, s) => Math.max(m, s.sort_order ?? 0), -1) ?? -1;
      const { error } = await supabase
        .from("lite_storage_locations" as any)
        .insert({ location_id: locationId, name, sort_order: maxOrder + 1 });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["lite-storages", locationId] });
      setNewName("");
      setAddingNew(false);
      toast.success("Storage added");
    },
    onError: (e: any) => toast.error("Couldn't add", { description: e.message }),
  });

  const renameMutation = useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) => {
      const { error } = await supabase
        .from("lite_storage_locations" as any)
        .update({ name })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["lite-storages", locationId] });
      qc.invalidateQueries({ queryKey: ["lite-inventory-items", locationId] });
      setEditingId(null);
      toast.success("Renamed");
    },
    onError: (e: any) => toast.error("Couldn't rename", { description: e.message }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      // Unassign items (single-assignment model), then soft-archive the storage
      const { error: unassignError } = await supabase
        .from("lite_inventory_items" as any)
        .update({ storage_id: null })
        .eq("storage_id", id);
      if (unassignError) throw unassignError;
      const { error } = await supabase
        .from("lite_storage_locations" as any)
        .update({ is_active: false })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["lite-storages", locationId] });
      qc.invalidateQueries({ queryKey: ["lite-inventory-items", locationId] });
      qc.invalidateQueries({ queryKey: ["lite-storage-item-counts", locationId] });
      toast.success("Removed, items moved to Unassigned");
    },
    onError: (e: any) => toast.error("Couldn't remove", { description: e.message }),
  });

  const reorderMutation = useMutation({
    mutationFn: async (orderedIds: string[]) => {
      const updates = orderedIds.map((id, index) =>
        supabase
          .from("lite_storage_locations" as any)
          .update({ sort_order: index })
          .eq("id", id),
      );
      await Promise.all(updates);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["lite-storages", locationId] });
    },
    onError: () => toast.error("Couldn't reorder"),
  });

  const handleDragStart = (event: DragStartEvent) => setActiveId(event.active.id as string);
  const handleDragEnd = (event: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = event;
    if (!over || active.id === over.id || !storages) return;
    const oldIndex = storages.findIndex((s) => s.id === active.id);
    const newIndex = storages.findIndex((s) => s.id === over.id);
    const reordered = arrayMove(storages, oldIndex, newIndex);
    reorderMutation.mutate(reordered.map((s) => s.id));
  };

  const startEdit = (s: Storage) => {
    setEditingId(s.id);
    setEditingName(s.name);
  };
  const confirmEdit = () => {
    if (!editingId || !editingName.trim()) return;
    renameMutation.mutate({ id: editingId, name: editingName.trim() });
  };
  const confirmCreate = () => {
    if (!newName.trim()) return;
    createMutation.mutate(newName.trim());
  };

  const activeStorage = storages?.find((s) => s.id === activeId);

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border/50">
        <Warehouse className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold">Storage Locations</h3>
      </div>

      <p className="text-xs text-muted-foreground px-4 pt-3">
        Drag to reorder. Items are grouped by these during counting.
      </p>

      <div className="p-3 space-y-1">
        {isLoading ? (
          <div className="flex items-center justify-center py-6">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : (storages?.length ?? 0) === 0 && !(itemCounts?.["__none__"] ?? 0) ? (
          <p className="text-sm text-muted-foreground text-center py-4">
            No storage areas yet. Add "Walk-in", "Freezer", "Dry Storage", etc.
          </p>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={storages?.map((s) => s.id) || []}
              strategy={verticalListSortingStrategy}
            >
              <div className="space-y-1">
                {storages?.map((s) => {
                  const count = itemCounts?.[s.id] || 0;
                  return (
                    <SortableStorageRow
                      key={s.id}
                      s={s}
                      count={count}
                      isEditing={editingId === s.id}
                      editingName={editingName}
                      setEditingName={setEditingName}
                      onStartEdit={() => startEdit(s)}
                      onConfirmEdit={confirmEdit}
                      onCancelEdit={() => setEditingId(null)}
                      onDelete={() => {
                        if (count > 0) {
                          if (
                            confirm(
                              `This will move ${count} item${count !== 1 ? "s" : ""} to Unassigned. Continue?`,
                            )
                          ) {
                            deleteMutation.mutate(s.id);
                          }
                        } else {
                          deleteMutation.mutate(s.id);
                        }
                      }}
                    />
                  );
                })}

                {(itemCounts?.["__none__"] || 0) > 0 && (
                  <div className="flex items-center gap-2 px-2 py-2 rounded-md bg-muted/30">
                    <div className="w-4" />
                    <span className="text-sm text-muted-foreground flex-1 italic">
                      Unassigned
                    </span>
                    <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                      {itemCounts?.["__none__"] || 0}
                    </Badge>
                  </div>
                )}
              </div>
            </SortableContext>

            <DragOverlay>
              {activeStorage ? (
                <OverlayRow s={activeStorage} count={itemCounts?.[activeStorage.id] || 0} />
              ) : null}
            </DragOverlay>
          </DndContext>
        )}

        {addingNew ? (
          <div className="flex items-center gap-1 pt-2">
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. Walk-in, Freezer, Bar"
              className="h-8 text-sm flex-1"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") confirmCreate();
                if (e.key === "Escape") {
                  setAddingNew(false);
                  setNewName("");
                }
              }}
            />
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={confirmCreate}
              disabled={createMutation.isPending}
            >
              {createMutation.isPending ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Check className="h-3 w-3" />
              )}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => {
                setAddingNew(false);
                setNewName("");
              }}
            >
              <X className="h-3 w-3" />
            </Button>
          </div>
        ) : (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setAddingNew(true)}
            className="w-full mt-2"
          >
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            Add Storage
          </Button>
        )}
      </div>
    </Card>
  );
}
