import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface PosItem {
  name: string;
  category: string;
}

export interface PosMappingEntry {
  groupId: string;
  posItems: string[];
  mappingType: string;
  reconciliationGroup: string | null;
}

export interface PosMappingState {
  /** blueprint_id → product_group row */
  mappedBlueprints: Map<string, PosMappingEntry>;
  /** All distinct POS items from recent sales */
  posItems: PosItem[];
  /** Map a blueprint to a POS item (creates/updates product_group) */
  linkBlueprint: (blueprintId: string, blueprintName: string, posItemNames: string[], mappingType?: string, reconciliationGroup?: string | null) => void;
  /** Update mapping type / reconciliation group on existing mapping */
  updateMappingMeta: (blueprintId: string, mappingType: string, reconciliationGroup: string | null) => void;
  /** Unlink a blueprint */
  unlinkBlueprint: (blueprintId: string) => void;
  isLinking: boolean;
}

export function usePosMapping(locationId: string): PosMappingState {
  const qc = useQueryClient();

  // Fetch existing product_group → blueprint mappings
  const { data: groups } = useQuery({
    queryKey: ["pos-mapping-groups", locationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory_product_groups")
        .select("id, name, blueprint_id, pos_items, mapping_type, reconciliation_group")
        .eq("location_id", locationId)
        .not("blueprint_id", "is", null);
      if (error) throw error;
      return data || [];
    },
  });

  // Fetch distinct POS items from last 60 days of sales for full coverage
  const { data: posData } = useQuery({
    queryKey: ["pos-items-for-mapping", locationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sales_cache")
        .select("product_mix")
        .eq("location_id", locationId)
        .not("product_mix", "is", null)
        .order("sale_date", { ascending: false })
        .limit(60);
      if (error) throw error;

      const items = new Map<string, string>();
      for (const row of data || []) {
        const mix = row.product_mix as any[];
        if (Array.isArray(mix)) {
          for (const item of mix) {
            if (item.itemName && item.category) {
              items.set(item.itemName, item.category);
            }
          }
        }
      }
      return Array.from(items.entries())
        .map(([name, category]) => ({ name, category }))
        .sort((a, b) => a.name.localeCompare(b.name));
    },
  });

  const mappedBlueprints = new Map<string, PosMappingEntry>();
  for (const g of groups || []) {
    if (g.blueprint_id) {
      mappedBlueprints.set(g.blueprint_id, {
        groupId: g.id,
        posItems: (g.pos_items as string[]) || [],
        mappingType: (g as any).mapping_type || "direct",
        reconciliationGroup: (g as any).reconciliation_group || null,
      });
    }
  }

  const linkMutation = useMutation({
    mutationFn: async ({ blueprintId, blueprintName, posItemNames, mappingType, reconciliationGroup }: {
      blueprintId: string;
      blueprintName: string;
      posItemNames: string[];
      mappingType?: string;
      reconciliationGroup?: string | null;
    }) => {
      const mt = mappingType || "direct";
      const rg = reconciliationGroup ?? null;
      const existing = mappedBlueprints.get(blueprintId);
      if (existing) {
        const { error } = await supabase
          .from("inventory_product_groups")
          .update({ pos_items: posItemNames, name: blueprintName, mapping_type: mt, reconciliation_group: rg } as any)
          .eq("id", existing.groupId);
        if (error) throw error;
      } else {
        // Check if a group with this name already exists at this location
        const { data: existingByName } = await supabase
          .from("inventory_product_groups")
          .select("id")
          .eq("location_id", locationId)
          .eq("name", blueprintName)
          .maybeSingle();

        if (existingByName) {
          // Update existing group to link this blueprint
          const { error } = await supabase
            .from("inventory_product_groups")
            .update({ blueprint_id: blueprintId, pos_items: posItemNames, mapping_type: mt, reconciliation_group: rg } as any)
            .eq("id", existingByName.id);
          if (error) throw error;
        } else {
          const { error } = await supabase
            .from("inventory_product_groups")
            .insert({
              location_id: locationId,
              name: blueprintName,
              blueprint_id: blueprintId,
              pos_items: posItemNames,
              mapping_type: mt,
              reconciliation_group: rg,
              display_order: (groups?.length || 0),
            } as any);
          if (error) throw error;
        }
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pos-mapping-groups", locationId] });
      qc.invalidateQueries({ queryKey: ["inventory-product-groups", locationId] });
      toast.success("POS mapping saved");
    },
    onError: (err: any) => toast.error("Failed to save: " + err.message),
  });

  const unlinkMutation = useMutation({
    mutationFn: async (blueprintId: string) => {
      const existing = mappedBlueprints.get(blueprintId);
      if (!existing) return;
      const { error } = await supabase
        .from("inventory_product_groups")
        .delete()
        .eq("id", existing.groupId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pos-mapping-groups", locationId] });
      qc.invalidateQueries({ queryKey: ["inventory-product-groups", locationId] });
      toast.success("POS mapping removed");
    },
  });
  const updateMetaMutation = useMutation({
    mutationFn: async ({ blueprintId, mappingType, reconciliationGroup }: {
      blueprintId: string;
      mappingType: string;
      reconciliationGroup: string | null;
    }) => {
      const existing = mappedBlueprints.get(blueprintId);
      if (!existing) return;
      const { error } = await supabase
        .from("inventory_product_groups")
        .update({ mapping_type: mappingType, reconciliation_group: reconciliationGroup } as any)
        .eq("id", existing.groupId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pos-mapping-groups", locationId] });
      qc.invalidateQueries({ queryKey: ["inventory-product-groups", locationId] });
      toast.success("Mapping updated");
    },
    onError: (err: any) => toast.error("Failed to update: " + err.message),
  });

  return {
    mappedBlueprints,
    posItems: posData || [],
    linkBlueprint: (blueprintId, blueprintName, posItemNames, mappingType?, reconciliationGroup?) =>
      linkMutation.mutate({ blueprintId, blueprintName, posItemNames, mappingType, reconciliationGroup }),
    updateMappingMeta: (blueprintId, mappingType, reconciliationGroup) =>
      updateMetaMutation.mutate({ blueprintId, mappingType, reconciliationGroup }),
    unlinkBlueprint: (blueprintId) => unlinkMutation.mutate(blueprintId),
    isLinking: linkMutation.isPending,
  };
}
