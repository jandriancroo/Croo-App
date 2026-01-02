import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { TrendingDown, TrendingUp, AlertTriangle, Calendar } from "lucide-react";
import { format, subDays } from "date-fns";
import { cn } from "@/lib/utils";

interface InventoryVarianceReportProps {
  locationId: string;
}

const InventoryVarianceReport = ({ locationId }: InventoryVarianceReportProps) => {
  const [dateRange, setDateRange] = useState("7");

  // Fetch completed counts with items
  const { data: counts } = useQuery({
    queryKey: ["inventory-variance", locationId, dateRange],
    queryFn: async () => {
      const startDate = subDays(new Date(), parseInt(dateRange)).toISOString().split("T")[0];
      
      const { data, error } = await supabase
        .from("inventory_counts")
        .select(`
          *,
          inventory_count_items(
            quantity,
            theoretical_quantity,
            variance,
            variance_cost,
            item:inventory_items(name, unit, cost_per_unit)
          )
        `)
        .eq("location_id", locationId)
        .eq("status", "completed")
        .gte("count_date", startDate)
        .order("count_date", { ascending: false });
      
      if (error) throw error;
      return data;
    }
  });

  // Fetch sales data from QuBeyond for theoretical calculations
  const { data: salesData } = useQuery({
    queryKey: ["qubeyond-sales-for-variance", locationId, dateRange],
    queryFn: async () => {
      const startDate = subDays(new Date(), parseInt(dateRange)).toISOString().split("T")[0];
      
      const { data, error } = await supabase
        .from("sales_cache")
        .select("*")
        .eq("location_id", locationId)
        .gte("sale_date", startDate)
        .order("sale_date", { ascending: false });
      
      if (error) throw error;
      return data;
    }
  });

  // Calculate variance summary
  const varianceSummary = counts?.reduce((acc, count) => {
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
    totalVarianceCost: 0, 
    shortageCount: 0, 
    overageCount: 0,
    shortageCost: 0,
    overageCost: 0
  }) || { totalVarianceCost: 0, shortageCount: 0, overageCount: 0, shortageCost: 0, overageCost: 0 };

  // Get items with significant variances
  const significantVariances = counts?.flatMap(count => 
    (count.inventory_count_items || [])
      .filter((ci: any) => ci.variance && Math.abs(ci.variance) > 0)
      .map((ci: any) => ({
        ...ci,
        count_date: count.count_date
      }))
  ).sort((a: any, b: any) => Math.abs(b.variance_cost || 0) - Math.abs(a.variance_cost || 0))
  .slice(0, 10) || [];

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
            <p className="text-xs text-muted-foreground">Shortages</p>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-4 text-center">
            <TrendingUp className="h-5 w-5 mx-auto text-green-500 mb-1" />
            <p className="text-2xl font-bold">${varianceSummary.overageCost.toFixed(0)}</p>
            <p className="text-xs text-muted-foreground">Overages</p>
          </CardContent>
        </Card>
      </div>

      {/* Significant variances list */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Top Variances</CardTitle>
        </CardHeader>
        <CardContent>
          {significantVariances.length > 0 ? (
            <div className="space-y-3">
              {significantVariances.map((item: any, idx: number) => (
                <div key={idx} className="flex items-center justify-between p-3 bg-muted rounded-lg">
                  <div>
                    <p className="font-medium">{item.item?.name || "Unknown Item"}</p>
                    <p className="text-sm text-muted-foreground">
                      {format(new Date(item.count_date), "MMM d")} • 
                      Counted: {item.quantity} {item.item?.unit}
                      {item.theoretical_quantity && (
                        <span> • Expected: {item.theoretical_quantity}</span>
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
              ))}
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
                  Link inventory items to QuBeyond products to enable automatic variance tracking.
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
