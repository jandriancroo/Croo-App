import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { TrendingDown, TrendingUp, AlertTriangle, Calendar, Calculator, ChevronDown, ChevronRight } from "lucide-react";
import { format, startOfYear, endOfYear, startOfMonth, endOfMonth, parseISO } from "date-fns";
import { cn } from "@/lib/utils";
import { calculateTheoreticalUsage, TheoreticalUsageResult } from "@/utils/theoreticalUsage";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, ReferenceLine } from "recharts";

interface InventoryVarianceReportProps {
  locationId: string;
}

interface PeriodOption {
  key: string;
  label: string;
  startDate: string; // yyyy-MM-dd
  endDate: string;   // yyyy-MM-dd
  group: "count" | "month" | "aggregate";
}

const InventoryVarianceReport = ({ locationId }: InventoryVarianceReportProps) => {
  const [selectedPeriod, setSelectedPeriod] = useState<string>("");
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());
  const [collapsedVarianceCategories, setCollapsedVarianceCategories] = useState<Set<string>>(new Set());

  // Fetch all completed counts to build period options
  const { data: completedCounts } = useQuery({
    queryKey: ["inventory-completed-counts", locationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory_counts")
        .select("id, count_date, period_type, period_end_date")
        .eq("location_id", locationId)
        .eq("status", "completed")
        .order("count_date", { ascending: false });
      if (error) throw error;
      return data;
    }
  });

  // Build period options from completed counts
  const periodOptions = useMemo((): PeriodOption[] => {
    if (!completedCounts || completedCounts.length === 0) return [];

    const options: PeriodOption[] = [];
    const now = new Date();
    const currentYear = now.getFullYear();
    const sortedAsc = [...completedCounts].sort(
      (a, b) => new Date(a.count_date).getTime() - new Date(b.count_date).getTime()
    );

    // 1. Individual count-to-count periods
    // Each period spans from one count_date to the next count_date
    for (let i = 0; i < sortedAsc.length - 1; i++) {
      const periodStart = sortedAsc[i].count_date;
      const periodEnd = sortedAsc[i + 1].count_date;
      const startFormatted = format(parseISO(periodStart), "MMM d");
      const endFormatted = format(parseISO(periodEnd), "MMM d, yyyy");
      options.push({
        key: `count_${periodStart}_${periodEnd}`,
        label: `${startFormatted} – ${endFormatted}`,
        startDate: periodStart,
        endDate: periodEnd,
        group: "count",
      });
    }
    // Reverse so most recent period is first
    options.reverse();

    // 2. Monthly rollups — find months that have at least one completed count
    const monthsWithCounts = new Set<string>();
    for (const c of completedCounts) {
      const d = parseISO(c.count_date);
      monthsWithCounts.add(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
    }

    // Also include adjacent months if a count period spans them
    const sortedMonths = [...monthsWithCounts].sort().reverse();
    for (const monthKey of sortedMonths) {
      const [year, month] = monthKey.split("-").map(Number);
      const mStart = startOfMonth(new Date(year, month - 1));
      const mEnd = endOfMonth(new Date(year, month - 1));
      options.push({
        key: `month_${monthKey}`,
        label: format(mStart, "MMMM yyyy"),
        startDate: format(mStart, "yyyy-MM-dd"),
        endDate: format(mEnd, "yyyy-MM-dd"),
        group: "month",
      });
    }

    // 3. Year to Date — from Jan 1 of current year to the last completed count date
    const lastCount = sortedAsc[sortedAsc.length - 1];
    if (lastCount) {
      const ytdStart = startOfYear(new Date(currentYear, 0, 1));
      options.push({
        key: "ytd",
        label: `Year to Date (thru ${format(parseISO(lastCount.count_date), "MMM d")})`,
        startDate: format(ytdStart, "yyyy-MM-dd"),
        endDate: lastCount.count_date,
        group: "aggregate",
      });
    }

    // 4. Full Year — current year Jan 1 to Dec 31
    options.push({
      key: "full_year",
      label: `Full Year ${currentYear}`,
      startDate: format(startOfYear(new Date(currentYear, 0, 1)), "yyyy-MM-dd"),
      endDate: format(endOfYear(new Date(currentYear, 0, 1)), "yyyy-MM-dd"),
      group: "aggregate",
    });

    return options;
  }, [completedCounts]);

  // Auto-select the most recent count period if nothing is selected
  const activePeriod = useMemo(() => {
    if (selectedPeriod) {
      return periodOptions.find(p => p.key === selectedPeriod);
    }
    // Default to most recent count period
    const countPeriods = periodOptions.filter(p => p.group === "count");
    return countPeriods[0] || periodOptions[0] || null;
  }, [selectedPeriod, periodOptions]);

  const startDate = activePeriod?.startDate || "";
  const endDate = activePeriod?.endDate || "";

  // Fetch completed counts with items for the selected period
  const { data: counts } = useQuery({
    queryKey: ["inventory-variance", locationId, startDate, endDate],
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
        .lte("count_date", endDate)
        .order("count_date", { ascending: true });
      if (error) throw error;
      return data;
    },
    enabled: !!startDate && !!endDate,
  });

  // Fetch theoretical usage for the period
  const { data: theoreticalData } = useQuery({
    queryKey: ["theoretical-usage", locationId, startDate, endDate],
    queryFn: () => calculateTheoreticalUsage(locationId, startDate, endDate),
    enabled: !!startDate && !!endDate,
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
    queryKey: ["qubeyond-sales-for-variance", locationId, startDate, endDate],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sales_cache")
        .select("sale_date")
        .eq("location_id", locationId)
        .gte("sale_date", startDate)
        .lte("sale_date", endDate)
        .order("sale_date", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!startDate && !!endDate,
  });

  // Calculate variance summary
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

  // Group variances by category
  const variancesByCategory = useMemo(() => {
    const allVariances = counts?.flatMap(count => 
      (count.inventory_count_items || [])
        .filter((ci: any) => ci.variance && Math.abs(ci.variance) > 0)
        .map((ci: any) => ({
          ...ci,
          count_date: count.count_date
        }))
    ) || [];
    
    const grouped = new Map<string, any[]>();
    for (const item of allVariances) {
      const category = item.item?.category || "Uncategorized";
      const existing = grouped.get(category) || [];
      existing.push(item);
      grouped.set(category, existing);
    }
    
    for (const [, items] of grouped) {
      items.sort((a: any, b: any) => Math.abs(b.variance_cost || 0) - Math.abs(a.variance_cost || 0));
    }
    
    return new Map(
      [...grouped.entries()].sort(([a], [b]) => {
        if (a === "Uncategorized") return 1;
        if (b === "Uncategorized") return -1;
        return a.localeCompare(b);
      })
    );
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

  const toggleVarianceCategory = (cat: string) => {
    setCollapsedVarianceCategories(prev => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  // Group period options for the selector
  const countPeriods = periodOptions.filter(p => p.group === "count");
  const monthPeriods = periodOptions.filter(p => p.group === "month");
  const aggregatePeriods = periodOptions.filter(p => p.group === "aggregate");

  const activeKey = activePeriod?.key || "";

  return (
    <div className="space-y-4">
      {/* Period selector */}
      <div className="flex items-center justify-between">
        <h3 className="font-medium flex items-center gap-2">
          <Calendar className="h-4 w-4" />
          Variance Report
        </h3>
        {periodOptions.length > 0 ? (
          <Select value={activeKey} onValueChange={setSelectedPeriod}>
            <SelectTrigger className="w-[220px]">
              <SelectValue placeholder="Select period" />
            </SelectTrigger>
            <SelectContent>
              {countPeriods.length > 0 && (
                <>
                  <p className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">Count Periods</p>
                  {countPeriods.map(p => (
                    <SelectItem key={p.key} value={p.key}>{p.label}</SelectItem>
                  ))}
                </>
              )}
              {monthPeriods.length > 0 && (
                <>
                  <p className="px-2 py-1.5 text-xs font-semibold text-muted-foreground mt-1">Monthly</p>
                  {monthPeriods.map(p => (
                    <SelectItem key={p.key} value={p.key}>{p.label}</SelectItem>
                  ))}
                </>
              )}
              {aggregatePeriods.length > 0 && (
                <>
                  <p className="px-2 py-1.5 text-xs font-semibold text-muted-foreground mt-1">Aggregate</p>
                  {aggregatePeriods.map(p => (
                    <SelectItem key={p.key} value={p.key}>{p.label}</SelectItem>
                  ))}
                </>
              )}
            </SelectContent>
          </Select>
        ) : (
          <p className="text-sm text-muted-foreground">No completed counts yet</p>
        )}
      </div>

      {!activePeriod && (
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">
            <p>Complete at least two inventory counts to generate variance reports.</p>
          </CardContent>
        </Card>
      )}

      {activePeriod && (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-3 gap-3">
            <Card>
              <CardContent className="p-4 text-center">
                <AlertTriangle className="h-5 w-5 mx-auto text-amber-500 mb-1" />
                <p className="text-2xl font-bold">${varianceSummary.totalVarianceCost.toFixed(0)}</p>
                <p className="text-xs text-muted-foreground">Total Variance</p>
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

          {/* Theoretical Usage Section */}
          {theoreticalData && theoreticalData.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Calculator className="h-5 w-5" />
                  Theoretical Usage
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
                        
                        {!isCollapsed && (
                          <div className="space-y-1 mt-1 ml-6">
                            {items.map((t, idx) => (
                              <div key={`${t.itemId}-${t.productGroupName}-${idx}`} className="flex items-center justify-between p-2 bg-muted/30 rounded-lg">
                                <div>
                                  <p className="font-medium text-sm">{t.itemName}</p>
                                  <p className="text-xs text-muted-foreground">
                                    {t.unitsSold} sold × {Number((t.usageRate * (t.packQuantity || 1)).toFixed(2))} {t.unit}/sold
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

          {/* Variance by Category */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Variance by Category</CardTitle>
            </CardHeader>
            <CardContent>
              {variancesByCategory.size > 0 ? (
                <div className="space-y-3">
                  {[...variancesByCategory.entries()].map(([category, items]) => {
                    const isCollapsed = collapsedVarianceCategories.has(category);
                    const totalShortage = items.reduce((sum: number, i: any) => sum + (i.variance_cost < 0 ? Math.abs(i.variance_cost) : 0), 0);
                    const totalOverage = items.reduce((sum: number, i: any) => sum + (i.variance_cost > 0 ? i.variance_cost : 0), 0);
                    const netVariance = totalOverage - totalShortage;
                    
                    return (
                      <div key={category}>
                        <button
                          className="flex items-center justify-between w-full p-3 rounded-lg bg-muted/80 hover:bg-muted transition-colors text-left"
                          onClick={() => toggleVarianceCategory(category)}
                        >
                          <div className="flex items-center gap-2">
                            {isCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                            <span className="font-medium">{category}</span>
                            <Badge variant="secondary" className="text-[10px]">{items.length}</Badge>
                          </div>
                          <Badge 
                            variant={netVariance < 0 ? "destructive" : "default"}
                            className={cn(netVariance >= 0 && "bg-green-500")}
                          >
                            {netVariance >= 0 ? "+" : "-"}${Math.abs(netVariance).toFixed(2)}
                          </Badge>
                        </button>
                        
                        {!isCollapsed && (
                          <div className="space-y-1 mt-1 ml-6">
                            {items.map((item: any, idx: number) => {
                              const theoretical = theoreticalByItem.get(item.item?.name);
                              return (
                                <div key={idx} className="flex items-center justify-between p-2 bg-muted/30 rounded-lg">
                                  <div>
                                    <p className="font-medium text-sm">{item.item?.name || "Unknown Item"}</p>
                                    <p className="text-xs text-muted-foreground">
                                      {format(new Date(item.count_date), "MMM d")} • 
                                      Counted: {item.quantity} {item.item?.unit}
                                      {theoretical && (
                                        <span className="ml-1">• Expected: {Number(theoretical.theoreticalUsage.toFixed(2))}</span>
                                      )}
                                      {!theoretical && item.theoretical_quantity && (
                                        <span className="ml-1">• Expected: {Number(Number(item.theoretical_quantity).toFixed(2))}</span>
                                      )}
                                    </p>
                                  </div>
                                  <Badge 
                                    variant={item.variance < 0 ? "destructive" : "default"}
                                    className={cn(item.variance > 0 && "bg-green-500")}
                                  >
                                    {item.variance > 0 ? "+" : ""}{Number(Number(item.variance).toFixed(2))}
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
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  <p>No variance data for this period.</p>
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
                      {!theoreticalData?.length && " Set up POS Mapping and Usage Rates to enable automatic theoretical tracking."}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
};

export default InventoryVarianceReport;
