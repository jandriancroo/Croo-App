import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Loader2, Boxes } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useUserRole } from "@/hooks/useUserRole";

interface Props {
  locationId: string | undefined;
}

export function InventoryAccessCard({ locationId }: Props) {
  const { isSuperAdmin, loading: roleLoading } = useUserRole();
  const queryClient = useQueryClient();
  const [pendingDirection, setPendingDirection] = useState<"on" | "off" | null>(null);
  const [saving, setSaving] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["location-inventory-enabled", locationId],
    enabled: !!locationId && isSuperAdmin,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("locations")
        .select("id, name, inventory_enabled")
        .eq("id", locationId!)
        .single();
      if (error) throw error;
      return data as { id: string; name: string; inventory_enabled: boolean };
    },
  });

  if (roleLoading || !isSuperAdmin || !locationId) return null;

  const enabled = !!data?.inventory_enabled;
  const locationName = data?.name ?? "this location";

  const handleToggleRequest = (checked: boolean) => {
    setPendingDirection(checked ? "on" : "off");
  };

  const confirmToggle = async () => {
    if (!pendingDirection) return;
    const nextValue = pendingDirection === "on";
    setSaving(true);
    try {
      const { error } = await supabase
        .from("locations")
        .update({ inventory_enabled: nextValue })
        .eq("id", locationId);
      if (error) throw error;
      toast.success(
        nextValue
          ? `Inventory enabled for ${locationName}`
          : `Inventory disabled for ${locationName}`
      );
      await queryClient.invalidateQueries({ queryKey: ["location-inventory-enabled", locationId] });
    } catch (e: any) {
      toast.error(e?.message || "Failed to update inventory access");
    } finally {
      setSaving(false);
      setPendingDirection(null);
    }
  };

  return (
    <>
      <div className="flex items-center gap-3 p-3 rounded-xl bg-card border border-border/50">
        <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-muted/60 shrink-0">
          <Boxes className="h-4 w-4 text-muted-foreground" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h4 className="text-sm font-semibold leading-tight truncate">Inventory Access</h4>
            {isLoading ? (
              <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
            ) : enabled ? (
              <Badge className="bg-green-500/15 text-green-700 dark:text-green-400 border-transparent hover:bg-green-500/15">
                Active
              </Badge>
            ) : (
              <Badge variant="secondary" className="text-muted-foreground">
                Not enabled
              </Badge>
            )}
          </div>
          <p className="text-[10px] text-muted-foreground leading-tight mt-0.5 truncate">
            Super admin only — controls counts, syncs, and deploys
          </p>
        </div>
        <Switch
          checked={enabled}
          disabled={isLoading || saving}
          onCheckedChange={handleToggleRequest}
          aria-label="Inventory enabled"
        />
      </div>

      <AlertDialog
        open={pendingDirection !== null}
        onOpenChange={(open) => !open && !saving && setPendingDirection(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pendingDirection === "on"
                ? `Enable inventory for ${locationName}?`
                : `Disable inventory for ${locationName}?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDirection === "on"
                ? `Before enabling inventory for ${locationName}, confirm that all required integrations have been configured — POS, primary food vendor, and any secondary vendors. Enabling inventory without integrations will result in missing cost data. Have all integrations been set up for this location?`
                : `Disabling inventory will prevent counts, syncs, and deploys at this location. This will not delete any existing count data. Continue?`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                confirmToggle();
              }}
              disabled={saving}
            >
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : pendingDirection === "on" ? (
                "Yes, enable inventory"
              ) : (
                "Yes, disable inventory"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
