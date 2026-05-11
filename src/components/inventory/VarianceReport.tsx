import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { calculateVarianceReport, type VarianceCategoryRow, type VarianceItemRow } from "@/utils/varianceReport";
import { fetchRecipeDataQuality } from "@/utils/recipeDataQuality";
import { fetchBrandUnpricedIngredients } from "@/utils/brandUnpricedIngredients";
import { resolveBrandId } from "@/utils/resolveBrandId";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertTriangle, TrendingDown, TrendingUp, DollarSign, Info, ChevronDown, ChevronRight, CheckCircle2, Archive, HelpCircle, PackageX, ArrowRight } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { addDays, format } from "date-fns";

interface ProvenCogs {
  beginningValue: number;
  purchaseValue: number;
  endingValue: number;
  cogsTotal: number;
  netSales: number;
}

interface VarianceReportProps {
  countId: string;
  locationId: string;
  periodEndDate: string;
  provenCogs?: ProvenCogs;
}

const formatCurrency = (v: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 }).format(v);

const formatPct = (v: number) => `${v.toFixed(2)}%`;

const VarianceReport = ({ countId, locationId, periodEndDate, provenCogs }: VarianceReportProps) => {
  const navigate = useNavigate();
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  const [showUnmatchedDetail, setShowUnmatchedDetail] = useState(false);
  const [showDataQualityDetail, setShowDataQualityDetail] = useState(false);

  // A2: brand-level unpriced ingredients summary (links to standalone page)
  const { data: brandId } = useQuery({
    queryKey: ["resolve-brand-id", locationId],
    queryFn: () => resolveBrandId(locationId),
    staleTime: 5 * 60_000,
  });
  const { data: unpriced } = useQuery({
    queryKey: ["brand-unpriced-ingredients", brandId],
    queryFn: () => fetchBrandUnpricedIngredients(brandId!),
    enabled: !!brandId,
    staleTime: 60_000,
  });
  const unpricedRecipeCount = (() => {
    if (!unpriced) return 0;
    const set = new Set<string>();
    for (const i of unpriced) for (const r of i.recipes) set.add(r.blueprintId);
    return set.size;
  })();

  // A1: surface archived/unpriced/missing recipe ingredients separately so they
  // don't get silently buried as variance noise.
  const { data: dataQuality } = useQuery({
    queryKey: ["recipe-data-quality", locationId],
    queryFn: () => fetchRecipeDataQuality(locationId),
    staleTime: 60_000,
  });

  // Get the current count's period_type so we can match previous counts of the same type.
  // Without this, a Monthly count would pick up the most recent Weekly count as its
  // "previous" — collapsing the sales window to just the last few days of the month.
  const { data: currentCount } = useQuery({
    queryKey: ["current-count-period-type", countId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory_counts")
        .select("period_type")
        .eq("id", countId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  // Find previous completed count of the SAME period_type.
  // Monthly → previous Monthly (full month sales window)
  // Weekly  → previous Weekly  (full week sales window)
  // Falls back to any completed count when period_type is unknown.
  const { data: previousCount } = useQuery({
    queryKey: ["previous-completed-count", locationId, countId, currentCount?.period_type],
    enabled: !!currentCount,
    queryFn: async () => {
      let query = supabase
        .from("inventory_counts")
        .select("id, period_end_date")
        .eq("location_id", locationId)
        .eq("status", "completed")
        .neq("id", countId)
        .lt("period_end_date", periodEndDate)
        .order("period_end_date", { ascending: false })
        .limit(1);

      if (currentCount?.period_type) {
        query = query.eq("period_type", currentCount.period_type);
      }

      const { data, error } = await query.maybeSingle();
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

  const toggleCategory = (cat: string) => {
    setExpandedCategories(prev => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

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

  // ─── Single Source of Truth ───
  // Use proven COGS from the period panel (Beginning + Purchases - Ending)
  // The per-item breakdown is only for category attribution
  const actualCogs = provenCogs?.cogsTotal ?? report.totals.actualUsage;
  const netSales = provenCogs?.netSales ?? report.netSales;
  const actualPct = netSales > 0 ? (actualCogs / netSales) * 100 : 0;

  // Sum of matched categories from per-item detail
  const matchedCategoryTotal = report.rows.reduce((sum, r) => sum + r.actualUsage, 0);

  // Unmatched = proven COGS - sum(matched categories)
  const unmatchedAmount = Math.round((actualCogs - matchedCategoryTotal) * 100) / 100;
  const unmatchedPct = netSales > 0 ? (unmatchedAmount / netSales) * 100 : 0;
  const unmatchedIsLarge = Math.abs(unmatchedAmount) > actualCogs * 0.05;

  // Theoretical stays from the engine
  const theoreticalTotal = report.totals.theoreticalValue;
  const theoreticalPct = netSales > 0 ? (theoreticalTotal / netSales) * 100 : 0;

  // Variance = proven actual - theoretical
  const varianceTotal = Math.round((actualCogs - theoreticalTotal) * 100) / 100;
  const variancePct = netSales > 0 ? (varianceTotal / netSales) * 100 : 0;

  // Reconciliation status
  const isReconciled = Math.abs(unmatchedAmount) <= 1;

  return (
    <div className="space-y-4">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <SummaryCard
          label="Net Sales"
          value={formatCurrency(netSales)}
          icon={<DollarSign className="h-4 w-4" />}
        />
        <SummaryCard
          label="Actual COGS"
          value={formatCurrency(actualCogs)}
          sub={formatPct(actualPct)}
          icon={<TrendingDown className="h-4 w-4" />}
        />
        <SummaryCard
          label="Theoretical COGS"
          value={formatCurrency(theoreticalTotal)}
          sub={formatPct(theoreticalPct)}
          icon={<TrendingUp className="h-4 w-4" />}
        />
        <SummaryCard
          label="Variance"
          value={formatCurrency(varianceTotal)}
          sub={formatPct(variancePct)}
          variant={varianceTotal > 0 ? "destructive" : "success"}
          icon={<AlertTriangle className="h-4 w-4" />}
        />
      </div>

      {/* Reconciliation indicator */}
      <div className={`flex items-center gap-2 text-xs px-1 ${isReconciled ? "text-green-600" : "text-amber-600"}`}>
        {isReconciled ? (
          <>
            <CheckCircle2 className="h-3.5 w-3.5" />
            <span>Totals reconciled ✓</span>
          </>
        ) : (
          <>
            <AlertTriangle className="h-3.5 w-3.5" />
            <span>Unmatched amount: {formatCurrency(Math.abs(unmatchedAmount))} (see Unmatched row below)</span>
          </>
        )}
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

      {/* A1: Recipe Data Quality — separates "real" variance from data gaps */}
      {dataQuality && dataQuality.totalAffectedRecipes > 0 && (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <button
            type="button"
            onClick={() => setShowDataQualityDetail(!showDataQualityDetail)}
            className="w-full flex items-center justify-between p-3 hover:bg-amber-500/10 transition-colors"
          >
            <div className="flex items-center gap-2 text-sm">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              <span className="font-medium">Recipe Data Quality</span>
              <Badge variant="outline" className="text-[10px] border-amber-500/40">
                {dataQuality.totalAffectedRecipes} recipe{dataQuality.totalAffectedRecipes > 1 ? "s" : ""} affected
              </Badge>
            </div>
            <div className="flex items-center gap-3 text-xs">
              {dataQuality.archivedRecipeCount > 0 && (
                <span className="flex items-center gap-1 text-amber-700 dark:text-amber-400">
                  <Archive className="h-3 w-3" />
                  {dataQuality.archivedRecipeCount} archived
                </span>
              )}
              {dataQuality.unpricedRecipeCount > 0 && (
                <span className="flex items-center gap-1 text-orange-700 dark:text-orange-400">
                  <HelpCircle className="h-3 w-3" />
                  {dataQuality.unpricedRecipeCount} unpriced
                </span>
              )}
              {dataQuality.missingRecipeCount > 0 && (
                <span className="flex items-center gap-1 text-red-700 dark:text-red-400">
                  <PackageX className="h-3 w-3" />
                  {dataQuality.missingRecipeCount} missing
                </span>
              )}
              {showDataQualityDetail ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </div>
          </button>
          {showDataQualityDetail && (
            <div className="px-3 pb-3 pt-0 space-y-2">
              <p className="text-xs text-muted-foreground">
                These recipes have ingredients that are <strong>archived</strong> (brand discontinued the SKU),
                <strong> unpriced</strong> (no vendor cost on file), or <strong>missing</strong> (template not deployed here).
                Until they're fixed, theoretical COGS for these items understates true cost — variance below may be data-gap noise, not real loss.
              </p>
              <div className="max-h-64 overflow-y-auto rounded-md border border-amber-500/20 bg-background/50 divide-y divide-border/50">
                {dataQuality.issues.slice(0, 50).map(issue => (
                  <div key={issue.blueprintId} className="p-2 text-xs">
                    <div className="font-medium mb-1">{issue.recipeName}</div>
                    <div className="space-y-0.5 text-muted-foreground">
                      {issue.archivedNames.length > 0 && (
                        <div className="flex items-start gap-1">
                          <Archive className="h-3 w-3 mt-0.5 text-amber-600 flex-shrink-0" />
                          <span><span className="text-amber-700 dark:text-amber-400 font-medium">Archived:</span> {issue.archivedNames.join(", ")}</span>
                        </div>
                      )}
                      {issue.unpricedNames.length > 0 && (
                        <div className="flex items-start gap-1">
                          <HelpCircle className="h-3 w-3 mt-0.5 text-orange-600 flex-shrink-0" />
                          <span><span className="text-orange-700 dark:text-orange-400 font-medium">Unpriced:</span> {issue.unpricedNames.join(", ")}</span>
                        </div>
                      )}
                      {issue.missingNames.length > 0 && (
                        <div className="flex items-start gap-1">
                          <PackageX className="h-3 w-3 mt-0.5 text-red-600 flex-shrink-0" />
                          <span><span className="text-red-700 dark:text-red-400 font-medium">Missing:</span> {issue.missingNames.join(", ")}</span>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
                {dataQuality.issues.length > 50 && (
                  <div className="p-2 text-xs text-muted-foreground italic">
                    ... and {dataQuality.issues.length - 50} more
                  </div>
                )}
              </div>
            </div>
          )}
        </Card>
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
                  <TableHead className="pl-4 min-w-[140px]">Category</TableHead>
                  <TableHead className="text-right">
                    <Tooltip>
                      <TooltipTrigger>Actual</TooltipTrigger>
                      <TooltipContent side="top">
                        Beginning inventory + Purchases − Ending inventory
                      </TooltipContent>
                    </Tooltip>
                  </TableHead>
                  <TableHead className="text-right">%</TableHead>
                  <TableHead className="text-right">
                    <Tooltip>
                      <TooltipTrigger>Theoretical</TooltipTrigger>
                      <TooltipContent side="top">
                        POS sales × recipe ingredient costs
                      </TooltipContent>
                    </Tooltip>
                  </TableHead>
                  <TableHead className="text-right">%</TableHead>
                  <TableHead className="text-right">Variance</TableHead>
                  <TableHead className="text-right pr-4">%</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.rows.map((row) => (
                  <CategoryRowWithDrillDown
                    key={row.category}
                    row={row}
                    expanded={expandedCategories.has(row.category)}
                    onToggle={() => toggleCategory(row.category)}
                    netSales={netSales}
                  />
                ))}

                {/* Unmatched row — show if $ gap or unmapped POS items */}
                {(Math.abs(unmatchedAmount) > 0.01 || report.unmappedPosItems.length > 0) && (
                  <TableRow
                    className={`cursor-pointer ${
                      unmatchedIsLarge
                        ? "bg-red-50 dark:bg-red-950/20 hover:bg-red-100 dark:hover:bg-red-950/30"
                        : "bg-amber-50/50 dark:bg-amber-950/10 hover:bg-amber-100/50 dark:hover:bg-amber-950/20"
                    }`}
                    onClick={() => setShowUnmatchedDetail(!showUnmatchedDetail)}
                  >
                    <TableCell className="pl-4 font-medium text-sm">
                      <div className="flex items-center gap-1.5">
                        {showUnmatchedDetail
                          ? <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                          : <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                        }
                        <span>Unmatched / Adjustments</span>
                        {report.unmappedPosItems.length > 0 && (
                          <Badge variant="outline" className="text-[10px] px-1 py-0 font-normal ml-1 text-amber-600 border-amber-300">
                            {report.unmappedPosItems.length} unmapped
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-right text-sm tabular-nums">{formatCurrency(unmatchedAmount)}</TableCell>
                    <TableCell className="text-right text-sm text-muted-foreground tabular-nums">{formatPct(unmatchedPct)}</TableCell>
                    <TableCell className="text-right text-sm tabular-nums">—</TableCell>
                    <TableCell className="text-right text-sm text-muted-foreground tabular-nums">—</TableCell>
                    <TableCell className="text-right text-sm tabular-nums">{formatCurrency(unmatchedAmount)}</TableCell>
                    <TableCell className="text-right pr-4 text-sm tabular-nums">{formatPct(unmatchedPct)}</TableCell>
                  </TableRow>
                )}

                {/* Unmatched detail expansion */}
                {showUnmatchedDetail && (Math.abs(unmatchedAmount) > 0.01 || report.unmappedPosItems.length > 0) && (
                  <TableRow className="bg-muted/20">
                    <TableCell colSpan={7} className="px-4 py-3">
                      <div className="space-y-3 text-xs">
                        {/* Unmapped POS Items */}
                        {report.unmappedPosItems.length > 0 && (
                          <div>
                            <p className="font-medium text-foreground mb-2">
                              Unmapped POS Items ({report.unmappedPosItems.length} items with no recipe)
                            </p>
                            <div className="rounded-lg border border-border/50 overflow-hidden">
                              <table className="w-full text-xs">
                                <thead>
                                  <tr className="bg-muted/50 text-muted-foreground">
                                    <th className="text-left px-3 py-1.5 font-medium">POS Item</th>
                                    <th className="text-left px-3 py-1.5 font-medium">Category</th>
                                    <th className="text-right px-3 py-1.5 font-medium">Units Sold</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {report.unmappedPosItems.slice(0, 20).map((item, idx) => (
                                    <tr key={idx} className="border-t border-border/30">
                                      <td className="px-3 py-1.5 text-foreground">{item.itemName}</td>
                                      <td className="px-3 py-1.5 text-muted-foreground">{item.category}</td>
                                      <td className="px-3 py-1.5 text-right tabular-nums">{item.unitsSold}</td>
                                    </tr>
                                  ))}
                                  {report.unmappedPosItems.length > 20 && (
                                    <tr className="border-t border-border/30">
                                      <td colSpan={3} className="px-3 py-1.5 text-muted-foreground text-center">
                                        ...and {report.unmappedPosItems.length - 20} more
                                      </td>
                                    </tr>
                                  )}
                                </tbody>
                              </table>
                            </div>
                            <p className="text-muted-foreground mt-2">
                              → Map these in <span className="font-medium">Build tab</span> to close the theoretical gap.
                            </p>
                          </div>
                        )}

                        {/* Price/count mismatch explanation */}
                        {Math.abs(unmatchedAmount) > 0.01 && (
                          <div>
                            <p className="font-medium text-foreground mb-1">
                              Actual COGS gap: {formatCurrency(Math.abs(unmatchedAmount))}
                            </p>
                            <p className="text-muted-foreground">
                              Difference between proven top-line COGS and sum of per-item breakdowns. Typically caused by
                              price differences between count valuation and vendor pricing, or unlinked vendor item numbers.
                            </p>
                          </div>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                )}

                {/* Totals row — uses proven COGS */}
                <TableRow className="border-t-2 font-bold bg-muted/30">
                  <TableCell className="pl-4">Total COGS</TableCell>
                  <TableCell className="text-right">{formatCurrency(actualCogs)}</TableCell>
                  <TableCell className="text-right">{formatPct(actualPct)}</TableCell>
                  <TableCell className="text-right">{formatCurrency(theoreticalTotal)}</TableCell>
                  <TableCell className="text-right">{formatPct(theoreticalPct)}</TableCell>
                  <TableCell className={`text-right ${varianceTotal > 0 ? "text-red-600" : "text-green-600"}`}>
                    {formatCurrency(varianceTotal)}
                  </TableCell>
                  <TableCell className={`text-right pr-4 ${variancePct > 0 ? "text-red-600" : "text-green-600"}`}>
                    {formatPct(variancePct)}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

function CategoryRowWithDrillDown({
  row, expanded, onToggle, netSales,
}: {
  row: VarianceCategoryRow;
  expanded: boolean;
  onToggle: () => void;
  netSales: number;
}) {
  const isHighVariance = Math.abs(row.variancePct) > 1;
  const hasItems = row.items.length > 0;

  return (
    <>
      <TableRow
        className={`${isHighVariance ? "bg-red-50/50 dark:bg-red-950/10" : ""} ${hasItems ? "cursor-pointer hover:bg-muted/50" : ""}`}
        onClick={hasItems ? onToggle : undefined}
      >
        <TableCell className="pl-4 font-medium text-sm">
          <div className="flex items-center gap-1.5">
            {hasItems && (
              expanded
                ? <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                : <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
            )}
            <span>{row.category}</span>
            <Badge variant="outline" className="text-[10px] px-1 py-0 font-normal ml-1">
              {row.items.length}
            </Badge>
          </div>
        </TableCell>
        <TableCell className="text-right text-sm tabular-nums">{formatCurrency(row.actualUsage)}</TableCell>
        <TableCell className="text-right text-sm text-muted-foreground tabular-nums">{formatPct(row.actualPct)}</TableCell>
        <TableCell className="text-right text-sm tabular-nums">{formatCurrency(row.theoreticalValue)}</TableCell>
        <TableCell className="text-right text-sm text-muted-foreground tabular-nums">{formatPct(row.theoreticalPct)}</TableCell>
        <TableCell className={`text-right text-sm tabular-nums font-medium ${row.varianceValue > 0 ? "text-red-600" : row.varianceValue < 0 ? "text-green-600" : ""}`}>
          {formatCurrency(row.varianceValue)}
        </TableCell>
        <TableCell className={`text-right pr-4 text-sm tabular-nums ${row.variancePct > 0 ? "text-red-600" : row.variancePct < 0 ? "text-green-600" : ""}`}>
          {formatPct(row.variancePct)}
        </TableCell>
      </TableRow>

      {expanded && row.items.map((item) => (
        <ItemRow key={item.itemId} item={item} netSales={netSales} />
      ))}
    </>
  );
}

function ItemRow({ item, netSales }: { item: VarianceItemRow; netSales: number }) {
  const variancePct = netSales > 0 ? (item.varianceValue / netSales) * 100 : 0;
  const isHighVariance = Math.abs(item.varianceValue) > 50;

  return (
    <TableRow className={`bg-muted/20 ${isHighVariance && item.varianceValue > 0 ? "bg-red-50/30 dark:bg-red-950/5" : ""}`}>
      <TableCell className="pl-8 text-xs text-muted-foreground">
        <div>
          <span className="text-foreground font-medium">{item.itemName}</span>
          <div className="text-[10px] text-muted-foreground mt-0.5">
            Begin: {item.beginningQty} → End: {item.endingQty}
            {item.purchaseValue > 0 && ` · +${formatCurrency(item.purchaseValue)} purchased`}
          </div>
        </div>
      </TableCell>
      <TableCell className="text-right text-xs tabular-nums">{formatCurrency(item.actualUsage)}</TableCell>
      <TableCell className="text-right text-xs tabular-nums text-muted-foreground">
        {netSales > 0 ? formatPct((item.actualUsage / netSales) * 100) : "—"}
      </TableCell>
      <TableCell className="text-right text-xs tabular-nums">{formatCurrency(item.theoreticalValue)}</TableCell>
      <TableCell className="text-right text-xs tabular-nums text-muted-foreground">
        {netSales > 0 ? formatPct((item.theoreticalValue / netSales) * 100) : "—"}
      </TableCell>
      <TableCell className={`text-right text-xs tabular-nums font-medium ${item.varianceValue > 0 ? "text-red-600" : item.varianceValue < 0 ? "text-green-600" : ""}`}>
        {formatCurrency(item.varianceValue)}
      </TableCell>
      <TableCell className={`text-right pr-4 text-xs tabular-nums ${variancePct > 0 ? "text-red-600" : variancePct < 0 ? "text-green-600" : ""}`}>
        {formatPct(variancePct)}
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