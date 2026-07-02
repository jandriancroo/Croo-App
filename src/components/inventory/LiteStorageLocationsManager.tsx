import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Loader2, Plus, Trash2, Warehouse } from "lucide-react";
import { toast } from "sonner";

interface Props {
  locationId: string;
}

interface Storage {
  id: string;
  name: string;
  sort_order: number;
  is_active: boolean;
}

/**
 * Lite storage locations manager — simple list of walk-in/freezer/bar/etc.
 * Single-assignment: an item belongs to one storage area (nullable).
 * Multi-storage per item is intentionally not modeled for v1.
 */
export default function LiteStorageLocationsManager({ locationId }: Props) {
  const qc = useQueryClient();
  const [newName, setNewName] = useState("");
  const [adding, setAdding] = useState(false);

  const { data: storages, isLoading } = useQuery({
    queryKey: ["lite-storages", locationId],
    enabled: !!locationId,
    queryFn: async (): Promise<Storage[]> => {
      const { data, error } = await supabase
        .from("lite_storage_locations" as any)
        .select("id, name, sort_order, is_active")
        .eq("location_id", locationId)
        .eq("is_active", true)
        .order("sort_order")
        .order("name");
      if (error) throw error;
      return (data as any) || [];
    },
  });

  const addStorage = async () => {
    const name = newName.trim();
    if (!name) return;
    setAdding(true);
    const nextOrder = (storages?.length || 0) * 10;
    const { error } = await supabase
      .from("lite_storage_locations" as any)
      .insert({ location_id: locationId, name, sort_order: nextOrder });
    setAdding(false);
    if (error) {
      toast.error("Couldn't add storage", { description: error.message });
      return;
    }
    setNewName("");
    qc.invalidateQueries({ queryKey: ["lite-storages", locationId] });
    toast.success(`Added "${name}"`);
  };

  const archive = async (s: Storage) => {
    const { error } = await supabase
      .from("lite_storage_locations" as any)
      .update({ is_active: false })
      .eq("id", s.id);
    if (error) {
      toast.error("Couldn't remove", { description: error.message });
      return;
    }
    qc.invalidateQueries({ queryKey: ["lite-storages", locationId] });
    qc.invalidateQueries({ queryKey: ["lite-inventory-items", locationId] });
    toast.success(`Removed "${s.name}"`);
  };

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border/50">
        <Warehouse className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold">Storage Locations</h3>
      </div>

      <div className="p-3 border-b border-border/50 flex gap-2">
        <Input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); addStorage(); }
          }}
          placeholder="e.g. Walk-in, Freezer, Bar, Dry Storage"
          disabled={adding}
        />
        <Button onClick={addStorage} disabled={adding || !newName.trim()} size="sm" className="gap-2">
          <Plus className="h-4 w-4" />
          Add
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-6">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </div>
      ) : (storages?.length ?? 0) === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-6 px-4">
          No storage areas yet. Add "Walk-in", "Freezer", "Dry Storage", etc.
          Items you count can be grouped by area.
        </p>
      ) : (
        <div className="divide-y divide-border/50">
          {storages!.map((s) => (
            <div key={s.id} className="flex items-center justify-between px-4 py-2.5">
              <span className="text-sm">{s.name}</span>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground hover:text-destructive"
                onClick={() => archive(s)}
                aria-label={`Remove ${s.name}`}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
