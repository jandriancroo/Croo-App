import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { calculateVarianceReport, type VarianceReportData, type VarianceCategoryRow } from "@/utils/varianceReport";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertTriangle, TrendingDown, TrendingUp, DollarSign, Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { addDays, format } from "date-fns";

interface VarianceReportProps {
  countId: string;
  locationId: string;
  periodEndDate: string;
}

const formatCurrency = (v: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 }).format(v);

const formatPct = (v: number) => `${v.toFixed(2)}%`;

const VarianceReport = ({ countId, locationId, periodEndDate }: VarianceReportProps) => {
  // Find previous completed count
  const { data: previousCount } = useQuery({
    queryKey: ["previous-completed-count", locationId, countId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory_counts")
        .select("id, period_end_date")
        .eq("location_id", locationId)
        .eq("status", "completed")
        .neq("id", countId)
        .lt("period_end_date", periodEndDate)
        .order("period_end_date", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const periodStartDate = previousCount?.period_end_date
    ? format(addDays(new Date(previousCount.period_end_date + "T12:00:00"), 1), "yyyy-MM-dd")
    : null;

  const { data: report, isLoading, error } = useQuery({
    queryKey: ["variance-report", countId, previousCount?.id, periodStartDate, periodEndDate],
    queryFn: () =>
      calculateVarianceReport(countId, previousCount!.id, locationId, periodStartDate!, periodEndDate),
    enabled: !!previousCount?.id && !!periodStartDate,
    staleTime: 5 * 60 * 1000,
  });

  if (!previousCount) {
    return (
      <Card>
        <CardContent className="p-6 text-center text-muted-foreground">
          <AlertTriangle className="h-5 w-5 mx-auto mb-2" />
          <p className="text-sm">No previous completed count found. Need at least two counts to calculate variance.</p>
        </CardContent>
      </Card>
    );
  }

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-6 flex items-center justify-center">
          <div className="animate-pulse text-muted-foreground text-sm">Calculating variance report...</div>
        </CardContent>
      </Card>
    );
  }

  if (error || !report) {
    return (
      <Card>
        <CardContent className="p-6 text-center text-destructive">
          <p className="text-sm">Failed to calculate variance report</p>
          {error && <p className="text-xs mt-1 opacity-70">{String(error)}</p>}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <SummaryCard
          label="Net Sales"
          value={formatCurrency(report.netSales)}
          icon={<DollarSign className="h-4 w-4" />}
        />
        <SummaryCard
          label="Actual COGS"
          value={formatCurrency(report.totals.actualUsage)}
          sub={formatPct(report.totals.actualPct)}
          icon={<TrendingDown className="h-4 w-4" />}
        />
        <SummaryCard
          label="Theoretical COGS"
          value={formatCurrency(report.totals.theoreticalValue)}
          sub={formatPct(report.totals.theoreticalPct)}
          icon={<TrendingUp className="h-4 w-4" />}
        />
        <SummaryCard
          label="Variance"
          value={formatCurrency(report.totals.varianceValue)}
          sub={formatPct(report.totals.variancePct)}
          variant={report.totals.varianceValue > 0 ? "destructive" : "success"}
          icon={<AlertTriangle className="h-4 w-4" />}
        />
      </div>

      {/* Mapping coverage */}
      {report.mappingCoverage.total > 0 && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground px-1">
          <Info className="h-3 w-3" />
          <span>
            POS Mappings with sales: {report.mappingCoverage.mapped} of {report.mappingCoverage.total} linked recipes had matching POS data
          </span>
        </div>
      )}

      {/* Variance Table */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center justify-between">
            <span>Actual vs Theoretical by Category</span>
            <Badge variant="outline" className="text-xs font-normal">
              {format(new Date(periodStartDate! + "T12:00:00"), "MMM d")} – {format(new Date(periodEndDate + "T12:00:00"), "MMM d, yyyy")}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="text-xs">
                  <TableHead className="pl-4 min-w-[120px]">Category</TableHead>
                  <TableHead className="text-right">
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger>Actual</TooltipTrigger>
                        <TooltipContent side="top" className="text-xs max-w-[200px]">
                          Beginning inventory + Purchases − Ending inventory
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </TableHead>
                  <TableHead className="text-right">%</TableHead>
                  <TableHead className="text-right">
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger>Theoretical</TooltipTrigger>
                        <TooltipContent side="top" className="text-xs max-w-[200px]">
                          POS sales × recipe ingredient costs
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </TableHead>
                  <TableHead className="text-right">%</TableHead>
                  <TableHead className="text-right">Variance</TableHead>
                  <TableHead className="text-right pr-4">%</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.rows.map((row) => (
                  <VarianceRow key={row.category} row={row} />
                ))}
                {/* Totals row */}
                <TableRow className="border-t-2 font-bold bg-muted/30">
                  <TableCell className="pl-4">Total COGS</TableCell>
                  <TableCell className="text-right">{formatCurrency(report.totals.actualUsage)}</TableCell>
                  <TableCell className="text-right">{formatPct(report.totals.actualPct)}</TableCell>
                  <TableCell className="text-right">{formatCurrency(report.totals.theoreticalValue)}</TableCell>
                  <TableCell className="text-right">{formatPct(report.totals.theoreticalPct)}</TableCell>
                  <TableCell className={`text-right ${report.totals.varianceValue > 0 ? "text-red-600" : "text-green-600"}`}>
                    {formatCurrency(report.totals.varianceValue)}
                  </TableCell>
                  <TableCell className={`text-right pr-4 ${report.totals.variancePct > 0 ? "text-red-600" : "text-green-600"}`}>
                    {formatPct(report.totals.variancePct)}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Breakdown details */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm text-muted-foreground">Period Breakdown</CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-0">
          <div className="grid grid-cols-3 gap-4 text-sm">
            <div>
              <p className="text-muted-foreground text-xs">Beginning Inventory</p>
              <p className="font-medium">{formatCurrency(report.totals.beginningValue)}</p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">+ Purchases</p>
              <p className="font-medium">{formatCurrency(report.totals.purchaseValue)}</p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">− Ending Inventory</p>
              <p className="font-medium">{formatCurrency(report.totals.endingValue)}</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

function VarianceRow({ row }: { row: VarianceCategoryRow }) {
  const isNegativeVariance = row.varianceValue < 0;
  const isHighVariance = Math.abs(row.variancePct) > 1;

  return (
    <TableRow className={isHighVariance ? "bg-red-50/50 dark:bg-red-950/10" : ""}>
      <TableCell className="pl-4 font-medium text-sm">{row.category}</TableCell>
      <TableCell className="text-right text-sm tabular-nums">{formatCurrency(row.actualUsage)}</TableCell>
      <TableCell className="text-right text-sm text-muted-foreground tabular-nums">{formatPct(row.actualPct)}</TableCell>
      <TableCell className="text-right text-sm tabular-nums">{formatCurrency(row.theoreticalValue)}</TableCell>
      <TableCell className="text-right text-sm text-muted-foreground tabular-nums">{formatPct(row.theoreticalPct)}</TableCell>
      <TableCell className={`text-right text-sm tabular-nums font-medium ${row.varianceValue > 0 ? "text-red-600" : isNegativeVariance ? "text-green-600" : ""}`}>
        {formatCurrency(row.varianceValue)}
      </TableCell>
      <TableCell className={`text-right pr-4 text-sm tabular-nums ${row.variancePct > 0 ? "text-red-600" : isNegativeVariance ? "text-green-600" : ""}`}>
        {formatPct(row.variancePct)}
      </TableCell>
    </TableRow>
  );
}

function SummaryCard({
  label, value, sub, icon, variant = "default",
}: {
  label: string;
  value: string;
  sub?: string;
  icon: React.ReactNode;
  variant?: "default" | "destructive" | "success";
}) {
  const colorMap = {
    default: "text-foreground",
    destructive: "text-red-600",
    success: "text-green-600",
  };

  return (
    <Card>
      <CardContent className="p-3">
        <div className="flex items-center gap-1.5 text-muted-foreground text-xs mb-1">
          {icon}
          <span>{label}</span>
        </div>
        <p className={`text-lg font-bold ${colorMap[variant]}`}>{value}</p>
        {sub && <p className={`text-xs ${colorMap[variant]} opacity-80`}>{sub}</p>}
      </CardContent>
    </Card>
  );
}

export default VarianceReport;
