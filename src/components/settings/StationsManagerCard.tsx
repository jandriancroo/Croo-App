import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Plus, Trash2, GripVertical, MapPin } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useLocationStations, type LocationStation } from "@/hooks/useLocationStations";

const PRESET_COLORS = [
  "#ef4444", "#f97316", "#f59e0b", "#84cc16",
  "#22c55e", "#14b8a6", "#06b6d4", "#3b82f6",
  "#6366f1", "#8b5cf6", "#d946ef", "#ec4899",
  "#64748b",
];

interface StationsManagerCardProps {
  locationId: string;
}

export function StationsManagerCard({ locationId }: StationsManagerCardProps) {
  const [enabled, setEnabled] = useState(false);
  const [loadingToggle, setLoadingToggle] = useState(false);
  const [savingToggle, setSavingToggle] = useState(false);

  const { stations, create, update, remove } = useLocationStations(locationId);

  // Local edit buffer for inline name editing
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState(PRESET_COLORS[7]);

  // Load enabled flag
  useEffect(() => {
    if (!locationId) return;
    let cancelled = false;
    (async () => {
      setLoadingToggle(true);
      const { data } = await supabase
        .from("location_settings")
        .select("stations_enabled")
        .eq("location_id", locationId)
        .maybeSingle();
      if (!cancelled) {
        setEnabled(!!(data as any)?.stations_enabled);
        setLoadingToggle(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [locationId]);

  const handleToggle = async (next: boolean) => {
    setEnabled(next);
    setSavingToggle(true);
    const { error } = await supabase
      .from("location_settings")
      .upsert(
        { location_id: locationId, stations_enabled: next } as any,
        { onConflict: "location_id" }
      );
    setSavingToggle(false);
    if (error) {
      toast.error("Could not save stations setting");
      setEnabled(!next);
    } else {
      toast.success(next ? "Stations enabled" : "Stations disabled");
    }
  };

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

  return (
    <Card>
      <CardHeader className="py-3 px-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <MapPin className="h-4 w-4 text-muted-foreground shrink-0" />
            <CardTitle className="text-sm font-semibold">Stations</CardTitle>
            <span className="text-xs text-muted-foreground truncate hidden sm:inline">
              Group your schedule by station (FOH / BOH / Patio, daycare rooms, etc.)
            </span>
          </div>
          <Switch
            checked={enabled}
            disabled={loadingToggle || savingToggle}
            onCheckedChange={handleToggle}
          />
        </div>
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


            <div className="space-y-2">
              {stations.map((s) => {
                const editingValue = edits[s.id];
                const isDirty = editingValue !== undefined && editingValue !== s.name;
                return (
                  <div
                    key={s.id}
                    className="flex items-center gap-2 rounded-md border bg-card px-2 py-1.5"
                  >
                    <GripVertical className="h-4 w-4 text-muted-foreground shrink-0" />
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
                  </div>
                );
              })}
            </div>

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
        )}
      </CardContent>
    </Card>
  );
}
