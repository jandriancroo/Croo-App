import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DollarSign, Package, History, User, Clock, ChevronDown, BarChart3 } from "lucide-react";
import { format } from "date-fns";
import VarianceReport from "./VarianceReport";
import { calculateCountItemValue } from "@/utils/countItemValue";
import { useBrandConversions } from "@/hooks/useBrandConversions";
import { resolveBrandId } from "@/utils/resolveBrandId";
import { useLegsValuation, buildLegsForValuation } from "@/hooks/useLegsValuation";



interface InventoryCountViewProps {
  countId: string;
  locationId: string;
  periodEndDate?: string;
}

interface CountItem {
  id: string;
  item_id: string;
  quantity: number;
  cost_at_count?: number | null;
  pack_quantity_at_count?: number | null;
  inner_pack_quantity_at_count?: number | null;
  item: {
    name: string;
    unit: string;
    cost_per_unit: number | null;
    pack_quantity: number | null;
    inner_pack_quantity?: number | null;
    pack_quantity_override?: number | null;
    brand_item_id?: string | null;
    pack_size: string | null;
    item_number: string | null;
    storage_location: { name: string } | null;
  };
}

interface AuditEdit {
  id: string;
  item_id: string;
  old_qty: number;
  new_qty: number;
  logged_at: string;
  userName: string;
}

function getInnerPackLabel(itemName: string | null | undefined): string {
  const n = (itemName || '').toLowerCase();
  if (/\b(cup|lid)s?\b/.test(n)) return 'slv';
  if (/\b(pizza\s*box|to-?go\s*bag|bag|napkin|liner)s?\b/.test(n)) return 'bdl';
  if (/\b(glove|packet)s?\b/.test(n)) return 'box';
  return 'pk';
}

const InventoryCountView = ({ countId, locationId, periodEndDate }: InventoryCountViewProps) => {
  // Resolve brand for Pipeline 1 conversion fallback (standard SOT contract)
  const { data: brandId } = useQuery({
    queryKey: ["location-brand-id", locationId],
    queryFn: () => resolveBrandId(locationId),
    enabled: !!locationId,
    staleTime: 10 * 60 * 1000,
  });
  const { conversionMap } = useBrandConversions(brandId);

  // Step 3: legs-aware read path. All three queries + the leg→value math
  // live in the shared useLegsValuation hook — see src/hooks/useLegsValuation.ts.
  // When the location's legs_enabled flag is off, the hook returns empty maps
  // and getItemValueWithLegs falls through to the canonical parent-row path,
  // so this view renders byte-identically.
  const {
    legsEnabled: legsEnabledForLocation,
    legsByCountItemId,
    legsConfigsByBrandItemId: legsConfigsMap,
    getItemValueWithLegs,
  } = useLegsValuation(countId, locationId);


  // Fetch storage locations in order
  const { data: storageLocations } = useQuery({
    queryKey: ["inventory-storage-locations-view", locationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory_locations")
        .select("id, name, display_order")
        .eq("location_id", locationId)
        .order("display_order");
      
      if (error) throw error;
      return data;
    }
  });

  // Fetch count items with item details including display_order
  const { data: countItems, isLoading } = useQuery({
    queryKey: ["inventory-count-items-view", countId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory_count_items")
        .select(`
          id,
          item_id,
          quantity,
          cost_at_count,
          pack_quantity_at_count,
          inner_pack_quantity_at_count,
          entered_cases,
          entered_units,
          entered_inner_packs,
          storage_location_id,
          count_storage_location:inventory_locations(name, display_order),
          item:inventory_items(
            name,
            name,
            unit,
            cost_per_unit,
            pack_quantity,
            pack_quantity_override,
            inner_pack_quantity,
            brand_item_id,
            pack_size,
            item_number,
            display_order,
            is_recipe,
            recipe_yield_qty,
            recipe_yield_unit,
            storage_location_id,
            storage_location:inventory_locations(name, display_order)
          )
        `)
        .eq("count_id", countId);
      
      if (error) throw error;
      return data as unknown as (CountItem & { 
        storage_location_id: string | null;
        count_storage_location: { name: string; display_order: number } | null;
        item: CountItem['item'] & { display_order: number; storage_location_id: string; storage_location: { name: string; display_order: number } | null } 
      })[];
    }
  });

  // Fetch junction table display_order for shortcuts (unified ordering)
  const { data: junctionOrders } = useQuery({
    queryKey: ["inventory-item-location-orders-view", countId],
    queryFn: async () => {
      const itemIds = countItems?.map(ci => ci.item_id) || [];
      if (itemIds.length === 0) return [];
      const { data, error } = await supabase
        .from("inventory_item_locations")
        .select("item_id, storage_location_id, display_order")
        .in("item_id", itemIds);
      if (error) throw error;
      return data || [];
    },
    enabled: !!countItems && countItems.length > 0,
  });

  // Fetch edit history from audit log, grouped by item_id
  const { data: editHistory } = useQuery({
    queryKey: ["inventory-count-audit-edits", countId],
    queryFn: async (): Promise<Map<string, AuditEdit[]>> => {
      const { data, error } = await supabase
        .from("inventory_count_audit_log")
        .select("id, logged_at, user_id, details")
        .eq("count_id", countId)
        .eq("table_name", "inventory_count_items")
        .eq("operation", "UPDATE")
        .order("logged_at", { ascending: false })
        .limit(200);

      if (error) throw error;
      if (!data || data.length === 0) return new Map();

      // Filter to only qty changes
      const qtyChanges = (data as any[]).filter(d => 
        d.details?.old_qty !== undefined && d.details?.new_qty !== undefined && d.details.old_qty !== d.details.new_qty
      );

      // Fetch user profiles
      const userIds = [...new Set(qtyChanges.filter(d => d.user_id).map(d => d.user_id))];
      let profileMap: Record<string, string> = {};
      if (userIds.length > 0) {
        const { data: profiles } = await supabase
          .from("profiles")
          .select("id, full_name")
          .in("id", userIds);
        for (const p of profiles || []) {
          profileMap[p.id] = p.full_name || "Unknown";
        }
      }

      // Group by item_id
      const editsByItemId = new Map<string, AuditEdit[]>();
      for (const entry of qtyChanges) {
        const itemId = entry.details?.item_id;
        if (!itemId) continue;
        const edits = editsByItemId.get(itemId) || [];
        edits.push({
          id: entry.id,
          item_id: itemId,
          old_qty: entry.details.old_qty,
          new_qty: entry.details.new_qty,
          logged_at: entry.logged_at,
          userName: entry.user_id ? (profileMap[entry.user_id] || "Unknown") : "System",
        });
        editsByItemId.set(itemId, edits);
      }

      return editsByItemId;
    }
  });

  // Single source of truth — see src/utils/countItemValue.ts
  // forceLiveData=false → honor snapshots (cost_at_count, pack_quantity_at_count).
  // Review reads historical/in-progress counts as-stored.
  // Build per-leg valuation payload mirroring InventoryCountSession's contract.
  // Per spec §3.3 cost comes from a shared common-unit cost derived from the
  // DEFAULT cfg + parent item.cost_per_unit. Snapshots (when present on the
  // leg row) still win. Returns undefined when legs[] would not change math
  // (single config or missing config data) so callers preserve today's path.
  const buildLegsForValuation = (
    item: CountItem,
    legRows: Array<{ pack_config_id: string; entered_cases: number | null; entered_inner_packs: number | null; entered_units: number | null; quantity_common: number | null; pack_quantity_at_count: number | null; inner_pack_quantity_at_count: number | null; cost_at_count: number | null; }>,
  ) => {
    if (legRows.length < 2) return undefined;
    const itm: any = item.item || {};
    const bid = itm.brand_item_id;
    if (!bid) return undefined;
    const cfgs = legsConfigsMap?.get(bid) ?? [];
    if (cfgs.length < 2) return undefined;
    const cfgById = new Map(cfgs.map((c: any) => [c.pack_config_id, c]));
    const defaultCfg: any = cfgs.find((c: any) => c.is_default) ?? cfgs[0];
    const defaultUnitsPerCase = Number(defaultCfg?.count_units_per_case ?? 0);
    const costPerCase = Number(itm.cost_per_unit ?? 0);
    const commonUnitCost = (defaultUnitsPerCase > 0 && costPerCase > 0)
      ? costPerCase / defaultUnitsPerCase
      : null;
    if (commonUnitCost == null) return undefined;
    return legRows.map((leg) => {
      const cfg: any = cfgById.get(leg.pack_config_id);
      const cu = Number(cfg?.count_units_per_case ?? 0);
      // Snapshot-wins on the leg row, else derive from the leg's cfg.
      const pq = leg.pack_quantity_at_count != null ? Number(leg.pack_quantity_at_count) : (cu > 0 ? cu : null);
      const legCost = leg.cost_at_count != null
        ? Number(leg.cost_at_count)
        : (pq != null && pq > 0 ? pq * commonUnitCost : null);
      return {
        entered_cases: leg.entered_cases,
        entered_units: 0,
        entered_inner_packs: 0,
        quantity_common: leg.quantity_common,
        pack_quantity_at_count: pq,
        inner_pack_quantity_at_count: null,
        cost_at_count: legCost,
      };
    });
  };

  // Single source of truth — see src/utils/countItemValue.ts
  // forceLiveData=false → honor snapshots (cost_at_count, pack_quantity_at_count).
  // Review reads historical/in-progress counts as-stored.
  const getItemValue = (item: CountItem) => {
    const itm: any = item.item || {};
    const conversion = itm.brand_item_id ? conversionMap.get(itm.brand_item_id) : null;
    const legRows = legsByCountItemId?.get(item.id) ?? [];
    const legsForValuation = buildLegsForValuation(item, legRows);
    return calculateCountItemValue(
      item as any,
      {
        brand_item_id: itm.brand_item_id,
        cost_per_unit: itm.cost_per_unit,
        pack_quantity: itm.pack_quantity,
        pack_quantity_override: itm.pack_quantity_override,
        inner_pack_quantity: itm.inner_pack_quantity,
        is_recipe: itm.is_recipe === true,
        unit: itm.unit,
        recipe_yield_qty: itm.recipe_yield_qty,
        recipe_yield_unit: itm.recipe_yield_unit,
      },
      conversion || null,
      false,
      legsForValuation,
    );
  };

  // Build junction order map: "itemId|storLocId" -> display_order
  const junctionOrderMap = new Map<string, number>();
  (junctionOrders || []).forEach((jo: any) => {
    if (typeof jo.display_order === 'number') {
      junctionOrderMap.set(`${jo.item_id}|${jo.storage_location_id}`, jo.display_order);
    }
  });

  // Group items by storage location, maintaining display_order
  const itemsByLocation = countItems?.reduce((acc, item) => {
    // Prefer the count item's own storage location (for multi-location items)
    // Fall back to the item's primary storage location
    const locationName = (item as any).count_storage_location?.name 
      || item.item?.storage_location?.name 
      || "Uncategorized";
    const locationOrder = (item as any).count_storage_location?.display_order 
      ?? (item.item as any)?.storage_location?.display_order 
      ?? 999;
    if (!acc[locationName]) {
      acc[locationName] = { items: [], order: locationOrder };
    }
    acc[locationName].items.push(item);
    return acc;
  }, {} as Record<string, { items: CountItem[]; order: number }>) || {};

  // Sort locations by display_order and items within each location using unified ordering
  // Shortcuts use junction table display_order; primary items use item display_order
  const sortedLocations = Object.entries(itemsByLocation)
    .sort(([, a], [, b]) => a.order - b.order)
    .map(([name, data]) => ({
      name,
      items: data.items.sort((a, b) => {
        const aStorLocId = (a as any).storage_location_id || (a.item as any)?.storage_location_id;
        const bStorLocId = (b as any).storage_location_id || (b.item as any)?.storage_location_id;
        const aIsShortcut = aStorLocId && aStorLocId !== (a.item as any)?.storage_location_id;
        const bIsShortcut = bStorLocId && bStorLocId !== (b.item as any)?.storage_location_id;
        const aOrder = aIsShortcut 
          ? (junctionOrderMap.get(`${a.item_id}|${aStorLocId}`) ?? 9999)
          : ((a.item as any)?.display_order ?? 0);
        const bOrder = bIsShortcut
          ? (junctionOrderMap.get(`${b.item_id}|${bStorLocId}`) ?? 9999)
          : ((b.item as any)?.display_order ?? 0);
        return aOrder - bOrder;
      })
    }));

  // Calculate totals
  const totalValue = countItems?.reduce((sum, item) => {
    return sum + getItemValue(item);
  }, 0) || 0;

  const totalItems = countItems?.length || 0;
  const countedItems = countItems?.filter(i => i.quantity > 0).length || 0;

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-6 flex items-center justify-center">
          <div className="animate-pulse text-muted-foreground">Loading...</div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Tabs defaultValue="items" className="space-y-4">
      <TabsList className="w-full">
        <TabsTrigger value="items" className="flex-1 gap-1.5">
          <Package className="h-4 w-4" />
          Count
        </TabsTrigger>
        <TabsTrigger value="variance" className="flex-1 gap-1.5">
          <BarChart3 className="h-4 w-4" />
          Actual vs Theo
        </TabsTrigger>
      </TabsList>

      <TabsContent value="items" className="space-y-4">
        {/* Edit history now shown inline on highlighted item rows */}
        {/* Summary Card */}
        <Card>
          <CardContent className="p-4">
            <div className="grid grid-cols-3 gap-4 text-center">
              <div>
                <div className="flex items-center justify-center gap-1 text-muted-foreground text-sm mb-1">
                  <Package className="h-4 w-4" />
                  Items
                </div>
                <p className="text-2xl font-bold">{countedItems}/{totalItems}</p>
              </div>
              <div>
                <div className="flex items-center justify-center gap-1 text-muted-foreground text-sm mb-1">
                  <DollarSign className="h-4 w-4" />
                  Total Value
                </div>
                <p className="text-2xl font-bold text-primary">{formatCurrency(totalValue)}</p>
              </div>
              <div>
                <div className="flex items-center justify-center gap-1 text-muted-foreground text-sm mb-1">
                  <History className="h-4 w-4" />
                  Edits
                </div>
                <p className="text-2xl font-bold">{editHistory ? Array.from(editHistory.values()).reduce((sum, edits) => sum + edits.length, 0) : 0}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Items Table by Location */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Counted Items</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Accordion type="multiple" defaultValue={sortedLocations.map(l => l.name)} className="w-full">
              {sortedLocations.map(({ name: locationName, items }) => {
                const locationTotal = items.reduce((sum, item) => {
                  return sum + getItemValue(item);
                }, 0);
                
                return (
                  <AccordionItem value={locationName} key={locationName}>
                    <AccordionTrigger className="px-4 hover:no-underline">
                      <div className="flex items-center justify-between w-full pr-4">
                        <span className="font-medium">{locationName}</span>
                        <div className="flex items-center gap-3">
                          <Badge variant="secondary">{items.length} items</Badge>
                          <span className="text-sm text-primary font-medium">{formatCurrency(locationTotal)}</span>
                        </div>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent className="px-0">
                      <div className="w-full overflow-hidden">
                        <Table className="table-fixed w-full">
                          <TableHeader>
                            <TableRow>
                              <TableHead className="pl-3 w-[40%]">Item</TableHead>
                              <TableHead className="text-right w-[22%] px-1">Counted</TableHead>
                              <TableHead className="text-right w-[13%] px-1">Qty</TableHead>
                              <TableHead className="text-right pr-4 w-[25%]">Value</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {items.map((item) => {
                              const hasEnteredValues = (item as any).entered_cases != null || (item as any).entered_units != null || (item as any).entered_inner_packs != null;
                              let cases: number;
                              let innerPacks: number;
                              let units: number;
                              if (hasEnteredValues) {
                                cases = (item as any).entered_cases ?? 0;
                                innerPacks = (item as any).entered_inner_packs ?? 0;
                                units = (item as any).entered_units ?? 0;
                              } else {
                                const packQty = (item.item as any)?.pack_quantity_override ?? (item.item?.pack_quantity || null);
                                const hasPackQty = packQty != null && packQty > 1;
                                cases = hasPackQty ? Math.floor(item.quantity / packQty) : 0;
                                innerPacks = 0;
                                units = hasPackQty ? Math.round((item.quantity % packQty) * 100) / 100 : item.quantity;
                              }
                              const value = getItemValue(item);
                              const itemEdits = editHistory?.get(item.item_id) || [];
                              const hasEdits = itemEdits.length > 0;
                              const innerPackQty = item.inner_pack_quantity_at_count ?? item.item?.inner_pack_quantity ?? null;
                              const innerPackLabel = getInnerPackLabel(item.item?.name);
                              
                              const smartParts: string[] = [];
                              if (cases > 0) smartParts.push(`${cases} cs`);
                              if ((innerPacks || 0) > 0 && innerPackQty != null && innerPackQty > 0) smartParts.push(`${innerPacks} ${innerPackLabel}`);
                              if (units > 0) smartParts.push(`${units % 1 === 0 ? units : units.toFixed(1)} ea`);
                              if (smartParts.length === 0 && item.quantity === 0) smartParts.push("0");
                              if (smartParts.length === 0) smartParts.push(`${item.quantity} ea`);
                              const smartSummary = smartParts.join(", ");
                              
                              return (
                                <Collapsible key={item.id} asChild>
                                  <>
                                    <TableRow className={hasEdits ? "cursor-pointer bg-amber-50/60 dark:bg-amber-950/20 hover:bg-amber-100/60 dark:hover:bg-amber-950/30 border-l-2 border-l-amber-400" : ""}>
                                      <TableCell className="pl-3">
                                        <div className="flex items-center gap-2">
                                          {hasEdits && (
                                            <CollapsibleTrigger asChild>
                                              <button className="p-0.5 hover:bg-muted rounded">
                                                <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform duration-200 [&[data-state=open]]:rotate-180" />
                                              </button>
                                            </CollapsibleTrigger>
                                          )}
                                          <div className="min-w-0">
                                            <div className="flex items-center gap-1">
                                              <p className="font-medium truncate text-sm">{item.item?.name}</p>
                                              {hasEdits && (
                                                <Badge variant="outline" className="text-xs py-0 px-1 flex-shrink-0">
                                                  <History className="h-3 w-3" />
                                                  {itemEdits.length}
                                                </Badge>
                                              )}
                                            </div>
                                            <p className="text-xs text-muted-foreground truncate">
                                              {item.item?.item_number && `#${item.item.item_number} · `}
                                              {item.item?.pack_size}
                                            </p>
                                          </div>
                                        </div>
                                      </TableCell>
                                      <TableCell className="text-right font-mono text-sm px-1">{smartSummary}</TableCell>
                                      <TableCell className="text-right font-mono text-sm px-1">{item.quantity}</TableCell>
                                      <TableCell className="text-right pr-4 font-medium text-primary text-sm truncate">
                                        {formatCurrency(value)}
                                      </TableCell>
                                    </TableRow>
                                    {(() => {
                                      const legRows = legsByCountItemId?.get(item.id) ?? [];
                                      if (legRows.length < 2) return null;
                                      const bid = item.item?.brand_item_id;
                                      const cfgs = bid ? (legsConfigsMap?.get(bid) ?? []) : [];
                                      const cfgById = new Map(cfgs.map(c => [c.pack_config_id, c]));
                                      // Enriched per-leg payloads (default-leg cost derived from
                                      // commonUnitCost so each sub-row prices with its own cfg).
                                      const enrichedAll = buildLegsForValuation(item, legRows) ?? [];
                                      const enrichedByCfg = new Map<string, any>();
                                      legRows.forEach((lr, idx) => {
                                        if (enrichedAll[idx]) enrichedByCfg.set(lr.pack_config_id, enrichedAll[idx]);
                                      });
                                      const ordered = [...legRows].sort((a, b) => {
                                        const ca = cfgById.get(a.pack_config_id);
                                        const cb = cfgById.get(b.pack_config_id);
                                        const ad = ca?.is_default ? 0 : 1;
                                        const bd = cb?.is_default ? 0 : 1;
                                        if (ad !== bd) return ad - bd;
                                        return (ca?.label ?? "").localeCompare(cb?.label ?? "");
                                      });
                                      return ordered.map((leg) => {
                                        const cfg = cfgById.get(leg.pack_config_id);
                                        const label = cfg?.label
                                          || (cfg?.outer_qty != null && cfg?.inner_qty != null
                                                ? `${cfg.outer_qty}/${cfg.inner_qty} ${cfg.common_unit ?? ""}`.trim()
                                                : (leg.pack_quantity_at_count != null ? `${leg.pack_quantity_at_count} ${cfg?.common_unit ?? ""}`.trim() : "leg"));
                                        const enrichedLeg = enrichedByCfg.get(leg.pack_config_id);
                                        const legValue = enrichedLeg
                                          ? calculateCountItemValue(
                                              {
                                                quantity: null,
                                                entered_cases: leg.entered_cases,
                                                entered_units: leg.entered_units,
                                                entered_inner_packs: leg.entered_inner_packs,
                                                cost_at_count: null,
                                                pack_quantity_at_count: null,
                                                inner_pack_quantity_at_count: null,
                                              } as any,
                                              {
                                                brand_item_id: item.item?.brand_item_id,
                                                cost_per_unit: item.item?.cost_per_unit,
                                                pack_quantity: item.item?.pack_quantity,
                                                pack_quantity_override: (item.item as any)?.pack_quantity_override,
                                                inner_pack_quantity: item.item?.inner_pack_quantity,
                                                is_recipe: (item.item as any)?.is_recipe === true,
                                                unit: item.item?.unit,
                                              } as any,
                                              null,
                                              false,
                                              [enrichedLeg],
                                            )
                                          : 0;
                                        const entered: string[] = [];
                                        if ((leg.entered_cases ?? 0) > 0) entered.push(`${leg.entered_cases} cs`);
                                        if ((leg.entered_inner_packs ?? 0) > 0) entered.push(`${leg.entered_inner_packs} pk`);
                                        if ((leg.entered_units ?? 0) > 0) entered.push(`${leg.entered_units} ea`);
                                        return (
                                          <TableRow key={`${item.id}::${leg.pack_config_id}`} className="bg-muted/20">
                                            <TableCell className="pl-9 text-xs text-muted-foreground">{label}</TableCell>
                                            <TableCell className="text-right font-mono text-xs px-1 text-muted-foreground">{entered.join(", ") || "—"}</TableCell>
                                            <TableCell className="text-right font-mono text-xs px-1 text-muted-foreground">{leg.quantity_common ?? 0}</TableCell>
                                            <TableCell className="text-right pr-4 font-mono text-xs text-muted-foreground">{formatCurrency(legValue)}</TableCell>
                                          </TableRow>
                                        );
                                      });
                                    })()}
                                    {hasEdits && (
                                      <CollapsibleContent asChild>
                                        <TableRow className="bg-muted/30">
                                          <TableCell colSpan={5} className="p-0">
                                            <div className="py-2 px-4 space-y-2">
                                              {itemEdits.map((edit) => (
                                                <div key={edit.id} className="flex items-center justify-between text-sm border-l-2 border-amber-400/60 pl-3 py-1">
                                                  <div className="flex items-center gap-3 text-muted-foreground">
                                                    <span className="flex items-center gap-1">
                                                      <User className="h-3 w-3" />
                                                      {edit.userName}
                                                    </span>
                                                    <span className="flex items-center gap-1">
                                                      <Clock className="h-3 w-3" />
                                                      {format(new Date(edit.logged_at), "MMM d 'at' h:mm a")}
                                                    </span>
                                                  </div>
                                                  <Badge variant="outline" className="font-mono text-xs">
                                                    <span className="text-destructive">{edit.old_qty}</span>
                                                    {" → "}
                                                    <span className="text-emerald-600">{edit.new_qty}</span>
                                                  </Badge>
                                                </div>
                                              ))}
                                            </div>
                                          </TableCell>
                                        </TableRow>
                                      </CollapsibleContent>
                                    )}
                                  </>
                                </Collapsible>
                              );
                            })}
                          </TableBody>
                        </Table>
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                );
              })}
            </Accordion>
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="variance">
        {periodEndDate ? (
          <VarianceReport
            countId={countId}
            locationId={locationId}
            periodEndDate={periodEndDate}
          />
        ) : (
          <Card>
            <CardContent className="p-6 text-center text-muted-foreground text-sm">
              Period end date not available for this count.
            </CardContent>
          </Card>
        )}
      </TabsContent>
    </Tabs>
  );
};

export default InventoryCountView;
