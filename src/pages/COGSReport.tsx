import { useState, useMemo } from "react";

import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft, ChevronLeft, ChevronRight, TrendingDown, TrendingUp, Package, ShoppingCart, DollarSign, AlertTriangle, Loader2 } from "lucide-react";
import { format, startOfWeek, endOfWeek, addWeeks, subWeeks, subDays, addDays, isAfter } from "date-fns";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";

export const COGSReportContent = ({ locationId }: { locationId: string }) => {
  
  // Week period: Mon-Sun
  const [weekStart, setWeekStart] = useState(() => 
    startOfWeek(new Date(), { weekStartsOn: 1 })
  );
  const weekEnd = useMemo(() => endOfWeek(weekStart, { weekStartsOn: 1 }), [weekStart]);
  const weekStartStr = format(weekStart, "yyyy-MM-dd");
  const weekEndStr = format(weekEnd, "yyyy-MM-dd");

  // Fetch inventory counts that bracket this week
  const { data: counts, isLoading: countsLoading } = useQuery({
    queryKey: ["cogs-counts", locationId, weekStartStr, weekEndStr],
    queryFn: async () => {
      if (!locationId) return { beginning: null, ending: null };
      
      // Beginning: most recent completed count with period_end_date on or before week start
      const { data: beginCounts } = await supabase
        .from("inventory_counts")
        .select("id, count_date, completed_at, period_type, counted_at, period_end_date")
        .eq("location_id", locationId)
        .eq("status", "completed")
        .lte("period_end_date", weekStartStr)
        .order("period_end_date", { ascending: false })
        .limit(1);
      
      // Ending: first completed count with period_end_date on or after week end
      const { data: endCounts } = await supabase
        .from("inventory_counts")
        .select("id, count_date, completed_at, period_type, counted_at, period_end_date")
        .eq("location_id", locationId)
        .eq("status", "completed")
        .gte("period_end_date", weekEndStr)
        .order("period_end_date", { ascending: true })
        .limit(1);

      const beginning = beginCounts?.[0] || null;
      const ending = endCounts?.[0] || null;

      // Fetch count items for both
      const [beginItems, endItems] = await Promise.all([
        beginning ? supabase
          .from("inventory_count_items")
          .select("item_id, quantity")
          .eq("count_id", beginning.id) : { data: [] },
        ending ? supabase
          .from("inventory_count_items")
          .select("item_id, quantity")
          .eq("count_id", ending.id) : { data: [] },
      ]);

      return {
        beginning: beginning ? { ...beginning, items: beginItems.data || [] } : null,
        ending: ending ? { ...ending, items: endItems.data || [] } : null,
      };
    },
    enabled: !!locationId,
  });

  // Fetch inventory items (for cost lookup)
  const { data: inventoryItems } = useQuery({
    queryKey: ["cogs-inventory-items", locationId],
    queryFn: async () => {
      if (!locationId) return [];
      const { data } = await supabase
        .from("inventory_items")
        .select("id, name, cost_per_unit, pack_quantity, pack_quantity_override, unit, vendor_source, category, is_recipe")
        .eq("location_id", locationId)
        .eq("is_active", true);
      return data || [];
    },
    enabled: !!locationId,
  });

  // Fetch purchases (PFG + PA orders) within the week
  const { data: purchases, isLoading: purchasesLoading } = useQuery({
    queryKey: ["cogs-purchases", locationId, weekStartStr, weekEndStr, "v2"],
    queryFn: async () => {
      if (!locationId) return { pfg: [], pa: [], totalCost: 0 };
      
      const [pfgResult, paResult] = await Promise.all([
        supabase
          .from("pfg_orders")
          .select("*")
          .eq("location_id", locationId)
          .gte("delivery_date", weekStartStr)
          .lte("delivery_date", weekEndStr),
        supabase
          .from("pa_orders")
          .select("*")
          .eq("location_id", locationId)
          .gte("delivery_date", weekStartStr)
          .lte("delivery_date", weekEndStr),
      ]);

      const pfg = pfgResult.data || [];
      const pa = paResult.data || [];
      console.log("[COGS] PA orders fetched:", pa.length, pa.map((o: any) => ({ id: o.pa_order_id, delivery: o.delivery_date, amount: o.total_amount })));
      console.log("[COGS] PFG orders fetched:", pfg.length);
      const totalCost = [...pfg, ...pa].reduce((sum, o) => sum + (Number(o.total_amount) || 0), 0);

      return { pfg, pa, totalCost };
    },
    enabled: !!locationId,
  });

  // Fetch sales for theoretical usage
  const { data: salesData, isLoading: salesLoading } = useQuery({
    queryKey: ["cogs-sales", locationId, weekStartStr, weekEndStr],
    queryFn: async () => {
      if (!locationId) return { totalSales: 0, productMix: [] };
      
      const { data } = await supabase
        .from("sales_cache")
        .select("net_sales, product_mix")
        .eq("location_id", locationId)
        .gte("sale_date", weekStartStr)
        .lte("sale_date", weekEndStr);

      const totalSales = (data || []).reduce((sum, d) => sum + (Number(d.net_sales) || 0), 0);
      
      // Aggregate product mix across the week
      const mixMap = new Map<string, { quantity: number; netSales: number }>();
      for (const day of data || []) {
        const mix = (day.product_mix as any[]) || [];
        for (const item of mix) {
          const key = item.itemName?.toLowerCase()?.trim();
          if (!key) continue;
          const existing = mixMap.get(key) || { quantity: 0, netSales: 0 };
          existing.quantity += Number(item.quantity) || 0;
          existing.netSales += Number(item.netSales) || 0;
          mixMap.set(key, existing);
        }
      }

      return { totalSales, productMix: Array.from(mixMap.entries()).map(([name, data]) => ({ name, ...data })) };
    },
    enabled: !!locationId,
  });

  // Fetch BOM data for theoretical usage
  const { data: bomData } = useQuery({
    queryKey: ["cogs-bom", locationId],
    queryFn: async () => {
      if (!locationId) return { menuItems: [], recipes: [], ingredients: [] };
      
      const [menuRes, recipeRes, ingredientRes] = await Promise.all([
        supabase.from("bom_menu_items").select("id, clean_name, r365_name").eq("location_id", locationId),
        supabase.from("bom_recipe_ingredients").select("menu_item_id, ingredient_id, quantity_normalized, quantity, unit_of_measure").eq("location_id", locationId),
        supabase.from("bom_ingredients").select("id, clean_name, r365_name, inventory_item_id").eq("location_id", locationId),
      ]);

      return {
        menuItems: menuRes.data || [],
        recipes: recipeRes.data || [],
        ingredients: ingredientRes.data || [],
      };
    },
    enabled: !!locationId,
  });

  // Calculate COGS
  const cogs = useMemo(() => {
    if (!inventoryItems?.length) return null;

    const itemCostMap = new Map(inventoryItems.map(i => {
      const packQty = (i as any).pack_quantity_override ?? (i as any).pack_quantity ?? 1;
      const perUnitCost = (Number(i.cost_per_unit) || 0) / (packQty || 1);
      return [i.id, { cost: perUnitCost, name: i.name, vendor: i.vendor_source, category: i.category }];
    }));

    // Beginning inventory value
    let beginValue = 0;
    const beginItems = counts?.beginning?.items || [];
    for (const ci of beginItems) {
      const cost = itemCostMap.get(ci.item_id)?.cost || 0;
      beginValue += Number(ci.quantity) * cost;
    }

    // Ending inventory value
    let endValue = 0;
    const endItems = counts?.ending?.items || [];
    for (const ci of endItems) {
      const cost = itemCostMap.get(ci.item_id)?.cost || 0;
      endValue += Number(ci.quantity) * cost;
    }

    const purchasesCost = purchases?.totalCost || 0;
    const actualUsage = beginValue + purchasesCost - endValue;
    const totalSales = salesData?.totalSales || 0;
    const actualCOGSPercent = totalSales > 0 ? (actualUsage / totalSales) * 100 : 0;

    // Theoretical usage via BOM
    let theoreticalUsage = 0;
    let mappedItems = 0;
    let unmappedItems = 0;

    if (bomData && salesData?.productMix) {
      const menuItemMap = new Map<string, string>(); // clean_name -> menu_item_id
      for (const mi of bomData.menuItems) {
        if (mi.clean_name) menuItemMap.set(mi.clean_name.toLowerCase().trim(), mi.id);
        if (mi.r365_name) menuItemMap.set(mi.r365_name.toLowerCase().trim(), mi.id);
      }

      const ingredientCostMap = new Map<string, number>(); // ingredient_id -> cost
      for (const ing of bomData.ingredients) {
        if (ing.inventory_item_id) {
          const cost = itemCostMap.get(ing.inventory_item_id)?.cost || 0;
          ingredientCostMap.set(ing.id, cost);
        }
      }

      for (const sold of salesData.productMix) {
        const menuItemId = menuItemMap.get(sold.name);
        if (!menuItemId) {
          unmappedItems++;
          continue;
        }
        mappedItems++;

        const recipes = bomData.recipes.filter(r => r.menu_item_id === menuItemId);
        for (const recipe of recipes) {
          const ingredientCost = ingredientCostMap.get(recipe.ingredient_id || "") || 0;
          const qty = Number(recipe.quantity_normalized || recipe.quantity) || 0;
          theoreticalUsage += qty * ingredientCost * sold.quantity;
        }
      }
    }

    const variance = actualUsage - theoreticalUsage;
    const variancePercent = theoreticalUsage > 0 ? (variance / theoreticalUsage) * 100 : 0;

    return {
      beginValue,
      endValue,
      purchasesCost,
      actualUsage,
      totalSales,
      actualCOGSPercent,
      theoreticalUsage,
      variance,
      variancePercent,
      mappedItems,
      unmappedItems,
      hasBeginning: !!counts?.beginning,
      hasEnding: !!counts?.ending,
      beginDate: counts?.beginning?.period_end_date || counts?.beginning?.count_date,
      endDate: counts?.ending?.period_end_date || counts?.ending?.count_date,
    };
  }, [counts, inventoryItems, purchases, salesData, bomData]);

  const isLoading = countsLoading || purchasesLoading || salesLoading;
  const canGoForward = !isAfter(addWeeks(weekStart, 1), new Date());

  return (
    <div className="space-y-4">
        {/* Week Navigator */}
        <Card>
          <CardContent className="py-3 px-4">
            <div className="flex items-center justify-between">
              <Button variant="ghost" size="icon" onClick={() => setWeekStart(s => subWeeks(s, 1))}>
                <ChevronLeft className="h-5 w-5" />
              </Button>
              <div className="text-center">
                <p className="text-sm font-medium">
                  {format(weekStart, "MMM d")} — {format(weekEnd, "MMM d, yyyy")}
                </p>
                <p className="text-xs text-muted-foreground">Week of {format(weekStart, "MMMM d")}</p>
              </div>
              <Button variant="ghost" size="icon" disabled={!canGoForward} onClick={() => setWeekStart(s => addWeeks(s, 1))}>
                <ChevronRight className="h-5 w-5" />
              </Button>
            </div>
          </CardContent>
        </Card>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            {/* Warnings */}
            {cogs && (!cogs.hasBeginning || !cogs.hasEnding) && (
              <Card className="border-amber-500/30 bg-amber-500/5">
                <CardContent className="py-3 px-4">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
                    <div className="text-sm">
                      {!cogs.hasBeginning && !cogs.hasEnding && (
                        <p className="text-amber-700 dark:text-amber-400">No inventory counts found. Complete counts before and after this period for accurate COGS.</p>
                      )}
                      {cogs.hasBeginning && !cogs.hasEnding && (
                        <p className="text-amber-700 dark:text-amber-400">No ending count found. Complete a count after {format(weekEnd, "MMM d")} to calculate usage.</p>
                      )}
                      {!cogs.hasBeginning && cogs.hasEnding && (
                        <p className="text-amber-700 dark:text-amber-400">No beginning count found. Complete a count before {format(weekStart, "MMM d")} for accurate COGS.</p>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* COGS Summary Cards */}
            {cogs && (
              <>
                {/* The Formula */}
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base flex items-center gap-2">
                      <DollarSign className="h-5 w-5 text-primary" />
                      COGS Formula
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div className="p-3 rounded-lg bg-muted/50">
                        <p className="text-xs text-muted-foreground">Beginning Inventory</p>
                        <p className="text-lg font-semibold">${cogs.beginValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                        {cogs.beginDate && <p className="text-xs text-muted-foreground">{cogs.beginDate}</p>}
                      </div>
                      <div className="p-3 rounded-lg bg-muted/50">
                        <p className="text-xs text-muted-foreground">Ending Inventory</p>
                        <p className="text-lg font-semibold">${cogs.endValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                        {cogs.endDate && <p className="text-xs text-muted-foreground">{cogs.endDate}</p>}
                      </div>
                    </div>

                    <div className="p-3 rounded-lg bg-muted/50">
                      <div className="flex items-center gap-2">
                        <ShoppingCart className="h-4 w-4 text-muted-foreground" />
                        <p className="text-xs text-muted-foreground">Purchases (PFG + Produce Alliance)</p>
                      </div>
                      <p className="text-lg font-semibold">${cogs.purchasesCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                      <div className="flex gap-2 mt-1">
                        <Badge variant="secondary" className="text-xs">{purchases?.pfg?.length || 0} PFG orders</Badge>
                        <Badge variant="secondary" className="text-xs">{purchases?.pa?.length || 0} Produce Alliance orders</Badge>
                      </div>
                    </div>

                    <Separator />

                    <div className="p-3 rounded-lg bg-primary/10 border border-primary/20">
                      <p className="text-xs text-muted-foreground">Actual Usage (COGS)</p>
                      <p className="text-2xl font-bold">${cogs.actualUsage.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                      {cogs.totalSales > 0 && (
                        <p className="text-sm text-muted-foreground">
                          {cogs.actualCOGSPercent.toFixed(1)}% of ${cogs.totalSales.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })} net sales
                        </p>
                      )}
                    </div>
                  </CardContent>
                </Card>

                {/* Theoretical vs Actual */}
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Package className="h-5 w-5 text-primary" />
                      Actual vs Theoretical
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div className="p-3 rounded-lg bg-muted/50">
                        <p className="text-xs text-muted-foreground">Actual Usage</p>
                        <p className="text-lg font-semibold">${cogs.actualUsage.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                      </div>
                      <div className="p-3 rounded-lg bg-muted/50">
                        <p className="text-xs text-muted-foreground">Theoretical Usage</p>
                        <p className="text-lg font-semibold">${cogs.theoreticalUsage.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                      </div>
                    </div>

                    <div className={`p-3 rounded-lg border ${
                      cogs.variance > 0 
                        ? "bg-destructive/5 border-destructive/20" 
                        : "bg-green-500/5 border-green-500/20"
                    }`}>
                      <div className="flex items-center gap-2">
                        {cogs.variance > 0 ? (
                          <TrendingUp className="h-4 w-4 text-destructive" />
                        ) : (
                          <TrendingDown className="h-4 w-4 text-green-600 dark:text-green-400" />
                        )}
                        <p className="text-xs text-muted-foreground">Variance</p>
                      </div>
                      <p className={`text-xl font-bold ${cogs.variance > 0 ? "text-destructive" : "text-green-600 dark:text-green-400"}`}>
                        {cogs.variance > 0 ? "+" : ""}${cogs.variance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {cogs.variancePercent > 0 ? "+" : ""}{cogs.variancePercent.toFixed(1)}% {cogs.variance > 0 ? "over theoretical" : "under theoretical"}
                      </p>
                    </div>

                    {/* BOM Coverage */}
                    {(cogs.mappedItems > 0 || cogs.unmappedItems > 0) && (
                      <div className="p-3 rounded-lg bg-muted/30">
                        <p className="text-xs text-muted-foreground mb-2">BOM Coverage</p>
                        <div className="flex items-center gap-2">
                          <Progress 
                            value={cogs.mappedItems + cogs.unmappedItems > 0 
                              ? (cogs.mappedItems / (cogs.mappedItems + cogs.unmappedItems)) * 100 
                              : 0} 
                            className="h-2 flex-1" 
                          />
                          <span className="text-xs text-muted-foreground whitespace-nowrap">
                            {cogs.mappedItems}/{cogs.mappedItems + cogs.unmappedItems} items
                          </span>
                        </div>
                        {cogs.unmappedItems > 0 && (
                          <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
                            {cogs.unmappedItems} sold items have no BOM recipe mapped
                          </p>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Purchase Detail */}
                {(purchases?.pfg?.length || 0) + (purchases?.pa?.length || 0) > 0 && (
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base flex items-center gap-2">
                        <ShoppingCart className="h-5 w-5 text-primary" />
                        Purchase Orders
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ScrollArea className="max-h-96">
                        <div className="space-y-2">
                          {purchases?.pfg?.map((o: any) => (
                            <div key={o.id} className="flex items-center justify-between p-2 rounded-lg bg-muted/30">
                              <div>
                                <p className="text-sm font-medium">PFG #{o.order_number || o.pfg_order_id}</p>
                                <p className="text-xs text-muted-foreground">Delivered {o.delivery_date || o.order_date}</p>
                              </div>
                              <p className="text-sm font-semibold">${Number(o.total_amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
                            </div>
                          ))}
                          {purchases?.pa?.map((o: any) => (
                            <div key={o.id} className="flex items-center justify-between p-2 rounded-lg bg-muted/30">
                              <div>
                                <p className="text-sm font-medium">Produce Alliance #{o.order_number || o.pa_order_id}</p>
                                <p className="text-xs text-muted-foreground">Delivered {o.delivery_date || o.order_date}</p>
                              </div>
                              <p className="text-sm font-semibold">${Number(o.total_amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
                            </div>
                          ))}
                        </div>
                      </ScrollArea>
                    </CardContent>
                  </Card>
                )}
              </>
            )}
          </>
        )}
    </div>
  );
};

const COGSReport = () => {
  const { locationId } = useParams<{ locationId: string }>();
  const navigate = useNavigate();
  
  return (
    <div className="min-h-screen bg-background">
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b border-border px-4 py-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate(`/inventory/${locationId}`)}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="flex-1">
            <h1 className="text-lg font-semibold">COGS Report</h1>
            <p className="text-xs text-muted-foreground">Cost of Goods Sold Analysis</p>
          </div>
        </div>
      </div>
      <div className="p-4 space-y-4 max-w-2xl mx-auto">
        <COGSReportContent locationId={locationId!} />
      </div>
    </div>
  );
};

export default COGSReport;
