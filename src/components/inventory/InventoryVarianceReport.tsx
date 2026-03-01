import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { TrendingDown, TrendingUp, AlertTriangle, Calendar, Calculator, ArrowDown, ArrowUp, Minus, ChevronDown, ChevronRight } from "lucide-react";
import { format, subDays } from "date-fns";
import { cn } from "@/lib/utils";
import { calculateTheoreticalUsage, TheoreticalUsageResult } from "@/utils/theoreticalUsage";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, ReferenceLine } from "recharts";

interface InventoryVarianceReportProps {
  locationId: string;
}

const InventoryVarianceReport = ({ locationId }: InventoryVarianceReportProps) => {
  const [dateRange, setDateRange] = useState("7");
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());
  const days = parseInt(dateRange);

  const startDate = subDays(new Date(), days).toISOString().split("T")[0];
  const prevStartDate = subDays(new Date(), days * 2).toISOString().split("T")[0];
  const today = new Date().toISOString().split("T")[0];

  // Fetch completed counts with items (current period) — include category
  const { data: counts } = useQuery({
    queryKey: ["inventory-variance", locationId, dateRange],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory_counts")
        .select(`
          *,
          inventory_count_items(
            quantity,
            theoretical_quantity,
            variance,
            variance_cost,
            item:inventory_items(name, unit, cost_per_unit, category)
          )
        `)
        .eq("location_id", locationId)
        .eq("status", "completed")
        .gte("count_date", startDate)
        .order("count_date", { ascending: true });
      
      if (error) throw error;
      return data;
    }
  });

  // Fetch previous period counts for comparison
  const { data: prevCounts } = useQuery({
    queryKey: ["inventory-variance-prev", locationId, dateRange],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory_counts")
        .select(`
          *,
          inventory_count_items(
            variance_cost
          )
        `)
        .eq("location_id", locationId)
        .eq("status", "completed")
        .gte("count_date", prevStartDate)
        .lt("count_date", startDate)
        .order("count_date", { ascending: true });
      
      if (error) throw error;
      return data;
    }
  });

  // Fetch theoretical usage for the period
  const { data: theoreticalData } = useQuery({
    queryKey: ["theoretical-usage", locationId, dateRange],
    queryFn: () => calculateTheoreticalUsage(locationId, startDate, today),
  });

  // Fetch item categories for theoretical grouping
  const { data: itemCategories } = useQuery({
    queryKey: ["inventory-item-categories", locationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory_items")
        .select("id, name, category")
        .eq("location_id", locationId)
        .eq("is_active", true);
      if (error) throw error;
      const map = new Map<string, string>();
      data?.forEach(item => {
        if (item.category) map.set(item.id, item.category);
        if (item.category) map.set(item.name, item.category);
      });
      return map;
    }
  });

  // Fetch sales data for QU integration note
  const { data: salesData } = useQuery({
    queryKey: ["qubeyond-sales-for-variance", locationId, dateRange],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sales_cache")
        .select("sale_date")
        .eq("location_id", locationId)
        .gte("sale_date", startDate)
        .order("sale_date", { ascending: false });
      
      if (error) throw error;
      return data;
    }
  });

  // Calculate variance summary for current period
  const varianceSummary = useMemo(() => {
    return counts?.reduce((acc, count) => {
      count.inventory_count_items?.forEach((ci: any) => {
        if (ci.variance_cost) {
          acc.totalVarianceCost += Math.abs(ci.variance_cost);
          if (ci.variance_cost < 0) {
            acc.shortageCount++;
            acc.shortageCost += Math.abs(ci.variance_cost);
          } else {
            acc.overageCount++;
            acc.overageCost += ci.variance_cost;
          }
        }
      });
      return acc;
    }, { 
      totalVarianceCost: 0, shortageCount: 0, overageCount: 0,
      shortageCost: 0, overageCost: 0
    }) || { totalVarianceCost: 0, shortageCount: 0, overageCount: 0, shortageCost: 0, overageCost: 0 };
  }, [counts]);

  // Calculate previous period total for comparison
  const prevTotalVariance = useMemo(() => {
    return prevCounts?.reduce((total, count) => {
      return total + (count.inventory_count_items || []).reduce((sum: number, ci: any) => {
        return sum + Math.abs(ci.variance_cost || 0);
      }, 0);
    }, 0) || 0;
  }, [prevCounts]);

  const varianceChange = varianceSummary.totalVarianceCost - prevTotalVariance;
  const varianceChangePercent = prevTotalVariance > 0 
    ? ((varianceChange / prevTotalVariance) * 100).toFixed(0) 
    : null;

  // Build trend chart data
  const trendData = useMemo(() => {
    if (!counts) return [];
    return counts.map(count => {
      let shortage = 0;
      let overage = 0;
      (count.inventory_count_items || []).forEach((ci: any) => {
        if (ci.variance_cost && ci.variance_cost < 0) {
          shortage += Math.abs(ci.variance_cost);
        } else if (ci.variance_cost && ci.variance_cost > 0) {
          overage += ci.variance_cost;
        }
      });
      return {
        date: format(new Date(count.count_date), "MMM d"),
        shortage: -shortage,
        overage,
        net: overage - shortage,
      };
    });
  }, [counts]);

  // Get items with significant variances
  const significantVariances = useMemo(() => {
    return counts?.flatMap(count => 
      (count.inventory_count_items || [])
        .filter((ci: any) => ci.variance && Math.abs(ci.variance) > 0)
        .map((ci: any) => ({
          ...ci,
          count_date: count.count_date
        }))
    ).sort((a: any, b: any) => Math.abs(b.variance_cost || 0) - Math.abs(a.variance_cost || 0))
    .slice(0, 10) || [];
  }, [counts]);

  // Build theoretical lookup by item name
  const theoreticalByItem = useMemo(() => {
    const map = new Map<string, TheoreticalUsageResult>();
    theoreticalData?.forEach(t => {
      const existing = map.get(t.itemName);
      if (existing) {
        existing.theoreticalUsage += t.theoreticalUsage;
        existing.unitsSold += t.unitsSold;
      } else {
        map.set(t.itemName, { ...t });
      }
    });
    return map;
  }, [theoreticalData]);

  // Group theoretical data by category
  const theoreticalByCategory = useMemo(() => {
    if (!theoreticalData || !itemCategories) return new Map<string, TheoreticalUsageResult[]>();
    const grouped = new Map<string, TheoreticalUsageResult[]>();
    
    for (const t of theoreticalData) {
      const category = itemCategories.get(t.itemId) || itemCategories.get(t.itemName) || "Uncategorized";
      const existing = grouped.get(category) || [];
      existing.push(t);
      grouped.set(category, existing);
    }
    
    // Sort categories alphabetically, with Uncategorized last
    return new Map(
      [...grouped.entries()].sort(([a], [b]) => {
        if (a === "Uncategorized") return 1;
        if (b === "Uncategorized") return -1;
        return a.localeCompare(b);
      })
    );
  }, [theoreticalData, itemCategories]);

  const toggleCategory = (cat: string) => {
    setCollapsedCategories(prev => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  return (
    <div className="space-y-4">
      {/* Date range selector */}
      <div className="flex items-center justify-between">
        <h3 className="font-medium flex items-center gap-2">
          <Calendar className="h-4 w-4" />
          Variance Report
        </h3>
        <Select value={dateRange} onValueChange={setDateRange}>
          <SelectTrigger className="w-[140px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="7">Last 7 days</SelectItem>
            <SelectItem value="14">Last 14 days</SelectItem>
            <SelectItem value="30">Last 30 days</SelectItem>
            <SelectItem value="90">Last 90 days</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Summary cards with period comparison */}
      <div className="grid grid-cols-3 gap-3">
        <Card>
          <CardContent className="p-4 text-center">
            <AlertTriangle className="h-5 w-5 mx-auto text-amber-500 mb-1" />
            <p className="text-2xl font-bold">${varianceSummary.totalVarianceCost.toFixed(0)}</p>
            <p className="text-xs text-muted-foreground">Total Variance</p>
            {varianceChangePercent && prevTotalVariance > 0 && (
              <div className={cn(
                "flex items-center justify-center gap-1 mt-1 text-xs font-medium",
                varianceChange > 0 ? "text-destructive" : "text-green-600 dark:text-green-400"
              )}>
                {varianceChange > 0 ? <ArrowUp className="h-3 w-3" /> : varianceChange < 0 ? <ArrowDown className="h-3 w-3" /> : <Minus className="h-3 w-3" />}
                {Math.abs(Number(varianceChangePercent))}% vs prev
              </div>
            )}
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-4 text-center">
            <TrendingDown className="h-5 w-5 mx-auto text-destructive mb-1" />
            <p className="text-2xl font-bold">${varianceSummary.shortageCost.toFixed(0)}</p>
            <p className="text-xs text-muted-foreground">Shortages ({varianceSummary.shortageCount})</p>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-4 text-center">
            <TrendingUp className="h-5 w-5 mx-auto text-green-500 mb-1" />
            <p className="text-2xl font-bold">${varianceSummary.overageCost.toFixed(0)}</p>
            <p className="text-xs text-muted-foreground">Overages ({varianceSummary.overageCount})</p>
          </CardContent>
        </Card>
      </div>

      {/* Variance Trend Chart */}
      {trendData.length > 1 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">Variance Trend</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={trendData} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
                  <XAxis 
                    dataKey="date" 
                    tick={{ fontSize: 11 }} 
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis 
                    tick={{ fontSize: 11 }} 
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v) => `$${Math.abs(v)}`}
                  />
                  <Tooltip 
                    formatter={(value: number, name: string) => [
                      `$${Math.abs(value).toFixed(2)}`,
                      name === "shortage" ? "Shortages" : "Overages"
                    ]}
                    contentStyle={{ 
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                  />
                  <ReferenceLine y={0} stroke="hsl(var(--border))" />
                  <Bar dataKey="shortage" stackId="a" radius={[0, 0, 4, 4]}>
                    {trendData.map((_, i) => (
                      <Cell key={i} fill="hsl(var(--destructive))" fillOpacity={0.8} />
                    ))}
                  </Bar>
                  <Bar dataKey="overage" stackId="a" radius={[4, 4, 0, 0]}>
                    {trendData.map((_, i) => (
                      <Cell key={i} fill="hsl(142 71% 45%)" fillOpacity={0.8} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Theoretical Usage Section — grouped by category */}
      {theoreticalData && theoreticalData.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg flex items-center gap-2">
              <Calculator className="h-5 w-5" />
              Theoretical Usage ({dateRange}d)
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Based on POS sales × usage rates for this period
            </p>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {[...theoreticalByCategory.entries()].map(([category, items]) => {
                const isCollapsed = collapsedCategories.has(category);
                const categoryTotal = items.reduce((sum, t) => sum + t.theoreticalUsage, 0);
                const hasMultipleUnits = new Set(items.map(t => t.unit)).size > 1;
                
                return (
                  <div key={category}>
                    {/* Category header */}
                    <button
                      className="flex items-center justify-between w-full p-2 rounded-lg bg-muted/80 hover:bg-muted transition-colors text-left"
                      onClick={() => toggleCategory(category)}
                    >
                      <div className="flex items-center gap-2">
                        {isCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                        <span className="font-medium text-sm">{category}</span>
                        <Badge variant="secondary" className="text-[10px]">{items.length}</Badge>
                      </div>
                      {!hasMultipleUnits && (
                        <span className="text-xs font-mono text-muted-foreground">
                          {Math.round(categoryTotal * 100) / 100} {items[0]?.unit}
                        </span>
                      )}
                    </button>
                    
                    {/* Items within category */}
                    {!isCollapsed && (
                      <div className="space-y-1 mt-1 ml-6">
                        {items.map((t, idx) => (
                          <div key={`${t.itemId}-${t.productGroupName}-${idx}`} className="flex items-center justify-between p-2 bg-muted/30 rounded-lg">
                            <div>
                              <p className="font-medium text-sm">{t.itemName}</p>
                              <p className="text-xs text-muted-foreground">
                                {t.unitsSold} sold × {Number(t.usageRate.toFixed(6))} rate
                                <span className="ml-1 text-muted-foreground/70">({t.productGroupName})</span>
                              </p>
                            </div>
                            <Badge variant="secondary" className="font-mono">
                              {Number(t.theoreticalUsage.toFixed(2))} {t.unit}
                            </Badge>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Significant variances list — grouped by category */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Top Variances</CardTitle>
        </CardHeader>
        <CardContent>
          {significantVariances.length > 0 ? (
            <div className="space-y-3">
              {significantVariances.map((item: any, idx: number) => {
                const theoretical = theoreticalByItem.get(item.item?.name);
                const category = item.item?.category;
                return (
                  <div key={idx} className="flex items-center justify-between p-3 bg-muted rounded-lg">
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-medium">{item.item?.name || "Unknown Item"}</p>
                        {category && (
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0">{category}</Badge>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {format(new Date(item.count_date), "MMM d")} • 
                        Counted: {item.quantity} {item.item?.unit}
                        {theoretical && (
                          <span className="ml-1">• Expected: {theoretical.theoreticalUsage}</span>
                        )}
                        {!theoretical && item.theoretical_quantity && (
                          <span className="ml-1">• Expected: {item.theoretical_quantity}</span>
                        )}
                      </p>
                    </div>
                    <Badge 
                      variant={item.variance < 0 ? "destructive" : "default"}
                      className={cn(
                        item.variance > 0 && "bg-green-500"
                      )}
                    >
                      {item.variance > 0 ? "+" : ""}{item.variance}
                      {item.variance_cost && (
                        <span className="ml-1">
                          (${Math.abs(item.variance_cost).toFixed(2)})
                        </span>
                      )}
                    </Badge>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              <p>No variance data yet.</p>
              <p className="text-sm mt-1">
                Complete inventory counts to see variance reports.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* QU Integration note */}
      {salesData && salesData.length > 0 && (
        <Card>
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <TrendingDown className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="font-medium">QuBeyond Integration Active</p>
                <p className="text-sm text-muted-foreground">
                  {salesData.length} days of sales data available for theoretical usage calculations.
                  {!theoreticalData?.length && " Link inventory items to product groups and map POS categories to enable automatic theoretical tracking."}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default InventoryVarianceReport;