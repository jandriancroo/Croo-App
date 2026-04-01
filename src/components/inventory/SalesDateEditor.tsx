import { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { format, addDays, differenceInDays } from "date-fns";
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
  currentOverride: string | null;
}

export default function SalesDateEditor({
  countId,
  locationId,
  startStr,
  endStr,
  salesEndStr,
  canEdit,
  currentOverride,
}: SalesDateEditorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selectedEnd, setSelectedEnd] = useState(salesEndStr);
  const queryClient = useQueryClient();

  // Calculate date range to show — from period start to max(salesEndStr, endStr) + 2 extra days
  const dateRange = useMemo(() => {
    const start = new Date(startStr + "T12:00:00");
    const maxEnd = salesEndStr > endStr ? salesEndStr : endStr;
    const end = new Date(maxEnd + "T12:00:00");
    // Show 2 extra days beyond current end so they can extend
    const extendedEnd = addDays(end, 2);
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
    setSelectedEnd(salesEndStr);
    setIsOpen(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      // If selected end matches the period end (no override needed), clear any existing override
      const overrideValue = selectedEnd === endStr ? null : selectedEnd;
      
      const { error } = await supabase
        .from("inventory_counts")
        .update({ sales_end_override: overrideValue } as any)
        .eq("id", countId);

      if (error) throw error;

      // Invalidate queries to refresh COGS
      queryClient.invalidateQueries({ queryKey: ["inventory-counts"] });
      queryClient.invalidateQueries({ queryKey: ["period-cogs"] });
      toast.success("Sales date range updated");
      setIsOpen(false);
    } catch (err) {
      console.error("Failed to update sales end override:", err);
      toast.error("Failed to update");
    } finally {
      setSaving(false);
    }
  };

  const isDayIncluded = (day: string) => day >= startStr && day <= selectedEnd;

  const toggleDay = (day: string) => {
    if (day < startStr) return; // Can't exclude days before start
    
    if (isDayIncluded(day)) {
      // Exclude this day — set end to previous day (if not before start)
      const prevDay = format(addDays(new Date(day + "T12:00:00"), -1), "yyyy-MM-dd");
      if (prevDay >= startStr) {
        setSelectedEnd(prevDay);
      }
    } else {
      // Include up to this day
      setSelectedEnd(day);
    }
  };

  const totalSelected = dailySales
    ? dateRange.filter(d => isDayIncluded(d)).reduce((sum, d) => sum + (dailySales.get(d) || 0), 0)
    : null;

  return (
    <>
      {/* Pencil trigger */}
      {canEdit && (
        <button
          onClick={handleOpen}
          className="inline-flex items-center gap-0.5 text-primary/60 hover:text-primary transition-colors ml-1"
          aria-label="Edit sales date range"
        >
          <Pencil className="h-3 w-3" />
        </button>
      )}

      {/* Expandable editor */}
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
                <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Sales Days Included</p>
                <div className="flex items-center gap-1">
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
              </div>

              <div className="space-y-0.5">
                {dateRange.map((day) => {
                  const included = isDayIncluded(day);
                  const sales = dailySales?.get(day);
                  const isEndDay = day === endStr;
                  const isPastEnd = day > endStr;

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
                      <span className={`text-xs font-medium flex-1 ${isPastEnd ? "text-amber-600" : ""}`}>
                        {format(new Date(day + "T12:00:00"), "EEE, MMM d")}
                        {isEndDay && <span className="text-[10px] text-muted-foreground ml-1">(period end)</span>}
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
                  <span className="text-xs font-bold">${Math.round(totalSelected).toLocaleString()}</span>
                </div>
              )}

              <div className="flex items-center gap-2 pt-1">
                <Button
                  size="sm"
                  className="flex-1 h-8 text-xs"
                  onClick={handleSave}
                  disabled={saving || selectedEnd === salesEndStr}
                >
                  {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Check className="h-3.5 w-3.5 mr-1" />}
                  Save
                </Button>
                {currentOverride && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 text-xs"
                    onClick={() => {
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
