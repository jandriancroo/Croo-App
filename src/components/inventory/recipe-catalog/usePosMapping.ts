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

export function usePosMapping(locationId: string, brandId?: string): PosMappingState {
  const qc = useQueryClient();

  // Fetch existing product_group → blueprint mappings using inheritance merge
  const { data: groups } = useQuery({
    queryKey: ["pos-mapping-groups", locationId],
    queryFn: async () => {
      const { resolveBrandId } = await import("@/utils/resolveBrandId");
      const brandId = await resolveBrandId(locationId);

      const fields = "id, name, blueprint_id, pos_items, mapping_type, reconciliation_group";
      const [localRes, brandRes] = await Promise.all([
        supabase
          .from("inventory_product_groups")
          .select(fields)
          .eq("location_id", locationId)
          .not("blueprint_id", "is", null),
        brandId
          ? supabase
              .from("inventory_product_groups")
              .select(fields)
              .eq("brand_id", brandId)
              .not("blueprint_id", "is", null)
          : Promise.resolve({ data: [], error: null }),
      ]);
      if (localRes.error) throw localRes.error;
      if (brandRes.error) throw brandRes.error;

      // Merge: brand as base, local overrides on top (by blueprint_id)
      const merged = new Map<string, any>();
      for (const g of (brandRes.data || [])) merged.set(g.blueprint_id, g);
      for (const g of (localRes.data || [])) merged.set(g.blueprint_id, g);
      return Array.from(merged.values());
    },
  });

  // Fetch distinct POS items from last 60 days — aggregate across ALL brand locations
  const { data: posData } = useQuery({
    queryKey: ["pos-items-for-mapping", locationId],
    queryFn: async () => {
      const { resolveBrandId } = await import("@/utils/resolveBrandId");
      const brandId = await resolveBrandId(locationId);

      // Get all location IDs for this brand
      let locationIds = [locationId];
      if (brandId) {
        const { data: orgs } = await supabase
          .from("organizations")
          .select("id")
          .eq("brand_id", brandId);
        if (orgs?.length) {
          const orgIds = orgs.map(o => o.id);
          const { data: locs } = await supabase
            .from("locations")
            .select("id")
            .in("organization_id", orgIds);
          if (locs?.length) {
            locationIds = locs.map(l => l.id);
          }
        }
      }

      // Fetch from all brand locations
      const allRows: any[] = [];
      for (const locId of locationIds) {
        const { data, error } = await supabase
          .from("sales_cache")
          .select("product_mix")
          .eq("location_id", locId)
          .not("product_mix", "is", null)
          .order("sale_date", { ascending: false })
          .limit(60);
        if (!error && data?.length) {
          allRows.push(...data);
        }
      }

      const items = new Map<string, string>();
      for (const row of allRows) {
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
        // Check if a group with this name already exists
        const baseQuery = supabase
          .from("inventory_product_groups")
          .select("id")
          .eq("name", blueprintName);
        
        const { data: existingByName } = brandId
          ? await baseQuery.eq("brand_id", brandId).maybeSingle()
          : await baseQuery.eq("location_id", locationId).maybeSingle();

        const writePayload: any = {
          name: blueprintName,
          blueprint_id: blueprintId,
          pos_items: posItemNames,
          mapping_type: mt,
          reconciliation_group: rg,
        };
        if (brandId) {
          writePayload.brand_id = brandId;
        } else {
          writePayload.location_id = locationId;
        }

        if (existingByName) {
          const { error } = await supabase
            .from("inventory_product_groups")
            .update(writePayload)
            .eq("id", existingByName.id);
          if (error) throw error;
        } else {
          writePayload.display_order = (groups?.length || 0);
          const { error } = await supabase
            .from("inventory_product_groups")
            .insert(writePayload);
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
    linkBlueprint: (blueprintId, blueprintName, posItemNames, mappingType, reconciliationGroup) =>
      linkMutation.mutate({ blueprintId, blueprintName, posItemNames, mappingType, reconciliationGroup }),
    updateMappingMeta: (blueprintId, mappingType, reconciliationGroup) =>
      updateMetaMutation.mutate({ blueprintId, mappingType, reconciliationGroup }),
    unlinkBlueprint: (blueprintId) => unlinkMutation.mutate(blueprintId),
    isLinking: linkMutation.isPending,
  };
}
