import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { GripVertical, Plus, Pencil, Trash2, Check, X, Loader2 } from "lucide-react";
import { toast } from "sonner";

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

export default function StorageLocationManager({ open, onOpenChange, locationId }: StorageLocationManagerProps) {
  const queryClient = useQueryClient();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [newName, setNewName] = useState("");
  const [addingNew, setAddingNew] = useState(false);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

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

  // Get item counts per location
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
      // Unassign items first
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

  const handleDragStart = (e: React.DragEvent, id: string) => {
    setDraggedId(id);
    e.dataTransfer.effectAllowed = "move";
    // Use a transparent drag image so we rely on CSS styling
    const dragEl = e.currentTarget as HTMLElement;
    const rect = dragEl.getBoundingClientRect();
    e.dataTransfer.setDragImage(dragEl, rect.width / 2, rect.height / 2);
  };

  const handleDragOver = (e: React.DragEvent, id: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (id !== draggedId) setDragOverId(id);
  };

  const handleDrop = (targetId: string) => {
    if (!draggedId || !locations || draggedId === targetId) {
      setDraggedId(null);
      setDragOverId(null);
      return;
    }
    const ordered = [...locations];
    const fromIdx = ordered.findIndex(l => l.id === draggedId);
    const toIdx = ordered.findIndex(l => l.id === targetId);
    const [moved] = ordered.splice(fromIdx, 1);
    ordered.splice(toIdx, 0, moved);
    reorderMutation.mutate(ordered.map(l => l.id));
    setDraggedId(null);
    setDragOverId(null);
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
          <div className="flex-1 overflow-y-auto space-y-1 min-h-0">
            {locations?.map(loc => {
              const count = itemCounts?.[loc.id] || 0;
              const isEditing = editingId === loc.id;
              const isDragOver = dragOverId === loc.id;

              return (
                <div
                  key={loc.id}
                  draggable={!isEditing}
                  onDragStart={(e) => handleDragStart(e, loc.id)}
                  onDragOver={(e) => handleDragOver(e, loc.id)}
                  onDragEnd={() => { setDraggedId(null); setDragOverId(null); }}
                  onDrop={() => handleDrop(loc.id)}
                  className={`flex items-center gap-2 px-2 py-2 rounded-md border transition-all duration-200 ${
                    draggedId === loc.id 
                      ? "opacity-30 scale-95 border-dashed border-primary/40 bg-primary/5" 
                      : isDragOver 
                        ? "border-primary bg-primary/10 shadow-md scale-[1.02] ring-1 ring-primary/20" 
                        : "border-border hover:bg-muted/30"
                  }`}
                >
                  <GripVertical className="h-4 w-4 text-muted-foreground shrink-0 cursor-grab active:cursor-grabbing" />
                  
                  {isEditing ? (
                    <div className="flex items-center gap-1 flex-1 min-w-0">
                      <Input
                        value={editingName}
                        onChange={(e) => setEditingName(e.target.value)}
                        className="h-7 text-sm flex-1"
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === "Enter") confirmEdit();
                          if (e.key === "Escape") setEditingId(null);
                        }}
                      />
                      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={confirmEdit}>
                        <Check className="h-3 w-3" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setEditingId(null)}>
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  ) : (
                    <>
                      <span className="text-sm flex-1 min-w-0 truncate">{loc.name}</span>
                      <Badge variant="secondary" className="text-[10px] px-1.5 py-0 shrink-0">
                        {count}
                      </Badge>
                      <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={() => startEdit(loc)}>
                        <Pencil className="h-3 w-3" />
                      </Button>
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        className="h-6 w-6 shrink-0 text-destructive hover:text-destructive"
                        onClick={() => {
                          if (count > 0) {
                            if (confirm(`This will move ${count} item${count !== 1 ? 's' : ''} to Unassigned. Continue?`)) {
                              deleteMutation.mutate(loc.id);
                            }
                          } else {
                            deleteMutation.mutate(loc.id);
                          }
                        }}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </>
                  )}
                </div>
              );
            })}

            {/* Unassigned count */}
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
        )}

        {/* Add new */}
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
