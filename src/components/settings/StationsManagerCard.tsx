import { useState, type ReactNode } from "react";
import { DndContext, closestCenter, PointerSensor, KeyboardSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, useSortable, arrayMove, verticalListSortingStrategy, sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Plus, Trash2, GripVertical, MapPin } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useLocationStations, useStationMode, type LocationStation } from "@/hooks/useLocationStations";

const PRESET_COLORS = [
  "#ef4444", "#f97316", "#f59e0b", "#84cc16",
  "#22c55e", "#14b8a6", "#06b6d4", "#3b82f6",
  "#6366f1", "#8b5cf6", "#d946ef", "#ec4899",
  "#64748b",
];

interface StationsManagerCardProps {
  locationId: string;
}

function SortableStationRow({ station, disabled, children }: { station: LocationStation; disabled: boolean; children: ReactNode }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: station.id, disabled });
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`flex items-center gap-2 rounded-md border bg-card px-2 py-1.5 ${isDragging ? "relative z-10 opacity-70" : ""}`}>
      <Button ref={setActivatorNodeRef} type="button" variant="ghost" size="icon"
        className="h-9 w-9 shrink-0 touch-none cursor-grab active:cursor-grabbing text-muted-foreground"
        disabled={disabled} {...attributes} {...listeners} aria-label={`Reorder ${station.name}`}>
        <GripVertical className="h-4 w-4" />
      </Button>
      {children}
    </div>
  );
}

export function StationsManagerCard({ locationId }: StationsManagerCardProps) {
  const { enabled } = useStationMode(locationId);
  const { stations, create, update, remove, reorder } = useLocationStations(locationId);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const handleDragEnd = async ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id || reorder.isPending) return;
    const from = stations.findIndex(station => station.id === active.id);
    const to = stations.findIndex(station => station.id === over.id);
    if (from < 0 || to < 0) return;
    try {
      await reorder.mutateAsync(arrayMove(stations, from, to).map(station => station.id));
    } catch { toast.error("Could not save station order. Refresh to check the saved order."); }
  };

  // Local edit buffer for inline name editing
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState(PRESET_COLORS[7]);

  const handleAdd = async () => {
    const name = newName.trim();
    if (!name) {
      toast.error("Station name is required");
      return;
    }
    try {
      await create.mutateAsync({ name, color: newColor });
      setNewName("");
      setNewColor(PRESET_COLORS[Math.floor(Math.random() * PRESET_COLORS.length)]);
    } catch (e: any) {
      toast.error(e.message ?? "Could not add station");
    }
  };

  const handleRename = async (station: LocationStation) => {
    const next = (edits[station.id] ?? station.name).trim();
    if (!next || next === station.name) {
      setEdits((p) => {
        const { [station.id]: _, ...rest } = p;
        return rest;
      });
      return;
    }
    try {
      await update.mutateAsync({ id: station.id, name: next });
      setEdits((p) => {
        const { [station.id]: _, ...rest } = p;
        return rest;
      });
    } catch (e: any) {
      toast.error(e.message ?? "Could not rename");
    }
  };

  const handleColor = async (station: LocationStation, color: string) => {
    try {
      await update.mutateAsync({ id: station.id, color });
    } catch (e: any) {
      toast.error(e.message ?? "Could not update color");
    }
  };

  const handleRemove = async (station: LocationStation) => {
    if (!confirm(`Remove station "${station.name}"? Existing shifts will become unassigned.`)) return;
    try {
      await remove.mutateAsync(station.id);
    } catch (e: any) {
      toast.error(e.message ?? "Could not remove");
    }
  };

  if (!enabled) return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed bg-muted/20 px-4 py-3 text-xs text-muted-foreground">
      <MapPin className="h-4 w-4 shrink-0" />
      <span>Stations · Not used in Position mode</span>
      <div className="ml-auto flex items-center gap-1">
        {stations.map(s => <span key={s.id} title={s.name} className="h-2 w-2 rounded-full" style={{ backgroundColor: s.color }} />)}
        <span className="ml-1">{stations.length} saved</span>
      </div>
    </div>
  );

  return (
    <Card className="rounded-lg">
      <CardHeader className="py-3 px-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <MapPin className="h-4 w-4 text-muted-foreground shrink-0" />
            <CardTitle className="text-sm font-semibold">Stations</CardTitle>
            <Badge variant="secondary" className="text-[10px]">In use</Badge>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">Schedule groups into these sections; each template gets one station. FOH / BOH / Patio, etc.</p>
      </CardHeader>
      {enabled && (
      <CardContent className="space-y-3 pt-0 px-4 pb-4">
        <div className="border-t pt-3 space-y-2">
            <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Your stations</Label>

            {stations.length === 0 && (
              <p className="text-xs text-muted-foreground">
                No stations yet. Add your first one below.
              </p>
            )}


            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={stations.map(station => station.id)} strategy={verticalListSortingStrategy}>
            <div className="space-y-2">
              {stations.map((s) => {
                const editingValue = edits[s.id];
                const isDirty = editingValue !== undefined && editingValue !== s.name;
                return (
                  <SortableStationRow key={s.id} station={s} disabled={reorder.isPending}>
                    <input
                      type="color"
                      value={s.color}
                      onChange={(e) => handleColor(s, e.target.value)}
                      className="h-7 w-9 rounded cursor-pointer border bg-transparent shrink-0"
                      title="Station color"
                    />
                    <Input
                      value={editingValue ?? s.name}
                      onChange={(e) =>
                        setEdits((p) => ({ ...p, [s.id]: e.target.value }))
                      }
                      onBlur={() => handleRename(s)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                        if (e.key === "Escape") {
                          setEdits((p) => {
                            const { [s.id]: _, ...rest } = p;
                            return rest;
                          });
                          (e.target as HTMLInputElement).blur();
                        }
                      }}
                      className="h-8 text-sm"
                    />
                    {isDirty && (
                      <span className="text-[10px] text-muted-foreground">
                        Press Enter
                      </span>
                    )}
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                      onClick={() => handleRemove(s)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </SortableStationRow>
                );
              })}
            </div>
            </SortableContext>
            </DndContext>

            <div className="flex items-center gap-2 pt-2 border-t">
              <input
                type="color"
                value={newColor}
                onChange={(e) => setNewColor(e.target.value)}
                className="h-9 w-10 rounded cursor-pointer border bg-transparent shrink-0"
                title="Color"
              />
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="New station name (e.g. FOH, BOH, Patio)"
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleAdd();
                }}
                className="h-9 text-sm"
              />
              <Button
                type="button"
                onClick={handleAdd}
                disabled={create.isPending}
                size="sm"
              >
                <Plus className="h-4 w-4 mr-1" />
                Add
              </Button>
            </div>
          </div>
      </CardContent>
      )}
    </Card>

  );
}
