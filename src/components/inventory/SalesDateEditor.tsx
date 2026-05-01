import { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { format, addDays } from "date-fns";
import { Pencil, X, Check, Loader2 } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";

interface SalesDateEditorProps {
  countId: string;
  locationId: string;
  startStr: string;
  endStr: string;
  salesEndStr: string;
  canEdit: boolean;
  currentEndOverride: string | null;
  currentStartOverride: string | null;
}

export default function SalesDateEditor({
  countId,
  locationId,
  startStr,
  endStr,
  salesEndStr,
  canEdit,
  currentEndOverride,
  currentStartOverride,
}: SalesDateEditorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selectedStart, setSelectedStart] = useState(startStr);
  const [selectedEnd, setSelectedEnd] = useState(salesEndStr);
  const queryClient = useQueryClient();

  // Show 7 days before current start (so user can pull start backward) and 2 days past current end
  const dateRange = useMemo(() => {
    const earliestVisible = format(addDays(new Date(startStr + "T12:00:00"), -7), "yyyy-MM-dd");
    const start = new Date(earliestVisible + "T12:00:00");
    const maxEnd = salesEndStr > endStr ? salesEndStr : endStr;
    const extendedEnd = addDays(new Date(maxEnd + "T12:00:00"), 2);
    const days: string[] = [];
    let current = start;
    while (current <= extendedEnd) {
      days.push(format(current, "yyyy-MM-dd"));
      current = addDays(current, 1);
    }
    return days;
  }, [startStr, endStr, salesEndStr]);

  // Fetch daily sales for displayed range
  const { data: dailySales } = useQuery({
    queryKey: ["daily-sales-editor", locationId, dateRange[0], dateRange[dateRange.length - 1]],
    queryFn: async () => {
      const { data } = await supabase
        .from("sales_cache")
        .select("sale_date, net_sales")
        .eq("location_id", locationId)
        .gte("sale_date", dateRange[0])
        .lte("sale_date", dateRange[dateRange.length - 1])
        .order("sale_date", { ascending: true });
      const map = new Map<string, number>();
      for (const row of data || []) {
        map.set(row.sale_date, Number(row.net_sales) || 0);
      }
      return map;
    },
    enabled: isOpen,
    staleTime: 60 * 1000,
  });

  const handleOpen = () => {
    if (!canEdit) return;
    setSelectedStart(startStr);
    setSelectedEnd(salesEndStr);
    setIsOpen(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      // If selected end matches the period end (no override needed), clear it
      const endOverrideValue = selectedEnd === endStr ? null : selectedEnd;
      // If selected start matches the auto start, clear the start override
      const startOverrideValue = selectedStart === startStr ? null : selectedStart;

      const { error } = await supabase
        .from("inventory_counts")
        .update({
          sales_end_override: endOverrideValue,
          sales_start_override: startOverrideValue,
        } as any)
        .eq("id", countId);

      if (error) throw error;

      queryClient.invalidateQueries({ queryKey: ["inventory-counts"] });
      queryClient.invalidateQueries({ queryKey: ["period-cogs"] });
      queryClient.invalidateQueries({ queryKey: ["prev-count-flex"] });
      toast.success("Sales date range updated");
      setIsOpen(false);
    } catch (err) {
      console.error("Failed to update sales overrides:", err);
      toast.error("Failed to update");
    } finally {
      setSaving(false);
    }
  };

  const isDayIncluded = (day: string) => day >= selectedStart && day <= selectedEnd;

  const toggleDay = (day: string) => {
    if (isDayIncluded(day)) {
      // Excluding — shrink whichever boundary is closer
      const distFromStart = Math.abs(
        (new Date(day + "T12:00:00").getTime() - new Date(selectedStart + "T12:00:00").getTime()) / 86400000
      );
      const distFromEnd = Math.abs(
        (new Date(selectedEnd + "T12:00:00").getTime() - new Date(day + "T12:00:00").getTime()) / 86400000
      );
      if (distFromStart <= distFromEnd) {
        // Shrink start forward to day+1
        const nextDay = format(addDays(new Date(day + "T12:00:00"), 1), "yyyy-MM-dd");
        if (nextDay <= selectedEnd) setSelectedStart(nextDay);
      } else {
        // Shrink end back to day-1
        const prevDay = format(addDays(new Date(day + "T12:00:00"), -1), "yyyy-MM-dd");
        if (prevDay >= selectedStart) setSelectedEnd(prevDay);
      }
    } else {
      // Including — extend whichever boundary is closer
      if (day < selectedStart) {
        setSelectedStart(day);
      } else if (day > selectedEnd) {
        setSelectedEnd(day);
      }
    }
  };

  const totalSelected = dailySales
    ? dateRange.filter((d) => isDayIncluded(d)).reduce((sum, d) => sum + (dailySales.get(d) || 0), 0)
    : null;

  const hasChanges = selectedEnd !== salesEndStr || selectedStart !== startStr;
  const hasAnyOverride = currentEndOverride || currentStartOverride;

  return (
    <>
      {canEdit && (
        <button
          onClick={handleOpen}
          className="inline-flex items-center gap-0.5 text-primary/60 hover:text-primary transition-colors ml-1"
          aria-label="Edit sales date range"
        >
          <Pencil className="h-3 w-3" />
        </button>
      )}

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            <div className="mt-2 p-3 rounded-xl bg-muted/40 border border-border/50 space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
                  Sales Days Included
                </p>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-6 w-6"
                  onClick={() => setIsOpen(false)}
                  disabled={saving}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>

              <p className="text-[10px] text-muted-foreground -mt-1">
                Tap a day to extend the window earlier or later. Closest boundary moves.
              </p>

              <div className="space-y-0.5 max-h-[60vh] overflow-y-auto">
                {dateRange.map((day) => {
                  const included = isDayIncluded(day);
                  const sales = dailySales?.get(day);
                  const isPeriodEnd = day === endStr;
                  const isAutoStart = day === startStr;
                  const isPastEnd = day > endStr;
                  const isBeforeAutoStart = day < startStr;

                  return (
                    <button
                      key={day}
                      onClick={() => toggleDay(day)}
                      className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left transition-colors ${
                        included
                          ? "bg-primary/10 hover:bg-primary/15"
                          : "bg-transparent hover:bg-muted/60 opacity-50"
                      }`}
                    >
                      <Checkbox checked={included} className="pointer-events-none" />
                      <span
                        className={`text-xs font-medium flex-1 ${
                          isPastEnd || isBeforeAutoStart ? "text-amber-600" : ""
                        }`}
                      >
                        {format(new Date(day + "T12:00:00"), "EEE, MMM d")}
                        {isPeriodEnd && (
                          <span className="text-[10px] text-muted-foreground ml-1">(period end)</span>
                        )}
                        {isAutoStart && (
                          <span className="text-[10px] text-muted-foreground ml-1">(auto start)</span>
                        )}
                      </span>
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {sales !== undefined ? `$${Math.round(sales).toLocaleString()}` : "—"}
                      </span>
                    </button>
                  );
                })}
              </div>

              {totalSelected !== null && (
                <div className="flex items-center justify-between pt-1 border-t border-border/30">
                  <span className="text-[11px] text-muted-foreground">Net Sales Total</span>
                  <span className="text-xs font-bold">
                    ${Math.round(totalSelected).toLocaleString()}
                  </span>
                </div>
              )}

              <div className="flex items-center gap-2 pt-1">
                <Button
                  size="sm"
                  className="flex-1 h-8 text-xs"
                  onClick={handleSave}
                  disabled={saving || !hasChanges}
                >
                  {saving ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                  ) : (
                    <Check className="h-3.5 w-3.5 mr-1" />
                  )}
                  Save
                </Button>
                {hasAnyOverride && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 text-xs"
                    onClick={() => {
                      setSelectedStart(startStr);
                      setSelectedEnd(endStr);
                    }}
                  >
                    Reset
                  </Button>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
