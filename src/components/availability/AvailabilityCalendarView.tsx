import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  addDays,
  addMonths,
  format,
  isSameMonth,
  isBefore,
  startOfDay,
  isSameDay,
} from "date-fns";
import { cn } from "@/lib/utils";
import type { AvailabilityRequest } from "@/hooks/useAvailabilityData";

interface Props {
  requests: AvailabilityRequest[];
  selectedDate?: string | null;
  onSelectDate?: (date: string | null) => void;
  selectedWeek?: string | null;
  onSelectWeek?: (weekStart: string | null) => void;
}




/** Expand a request into a list of yyyy-MM-dd date strings it covers. */
export function expandDates(req: AvailabilityRequest): string[] {
  const start = req.start_date;
  const end = req.time_scope === "multi_day" && req.end_date ? req.end_date : start;
  const [a, b] = start <= end ? [start, end] : [end, start];
  const out: string[] = [];
  // Iterate string-first (yyyy-MM-dd) to avoid TZ issues
  let cursor = a;
  // Safety cap
  for (let i = 0; i < 400 && cursor <= b; i++) {
    out.push(cursor);
    const [y, m, d] = cursor.split("-").map(Number);
    const next = new Date(Date.UTC(y, m - 1, d + 1));
    cursor = next.toISOString().slice(0, 10);
  }
  return out;
}

export function AvailabilityCalendarView({ requests, selectedDate, onSelectDate }: Props) {
  const [cursor, setCursor] = useState(() => startOfMonth(new Date()));

  const monthStart = startOfMonth(cursor);
  const monthEnd = endOfMonth(cursor);
  const gridStart = startOfWeek(monthStart, { weekStartsOn: 1 });
  const gridEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });

  const days = useMemo(() => {
    const arr: Date[] = [];
    let d = gridStart;
    while (d <= gridEnd) {
      arr.push(d);
      d = addDays(d, 1);
    }
    return arr;
  }, [gridStart.getTime(), gridEnd.getTime()]);

  // Build per-day counts { pending, approved }
  const counts = useMemo(() => {
    const map = new Map<string, { pending: number; approved: number }>();
    for (const req of requests) {
      if (req.status !== "pending" && req.status !== "approved") continue;
      for (const ds of expandDates(req)) {
        const entry = map.get(ds) || { pending: 0, approved: 0 };
        if (req.status === "pending") entry.pending += 1;
        else entry.approved += 1;
        map.set(ds, entry);
      }
    }
    return map;
  }, [requests]);

  const today = startOfDay(new Date());

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <Button variant="ghost" size="sm" onClick={() => setCursor(addMonths(cursor, -1))}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <div className="text-lg font-semibold">{format(cursor, "MMMM yyyy")}</div>
        <Button variant="ghost" size="sm" onClick={() => setCursor(addMonths(cursor, 1))}>
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      {/* Weekday header */}
      <div className="grid grid-cols-7 gap-1 mb-1">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
          <div key={d} className="text-[10px] sm:text-xs font-medium text-muted-foreground text-center py-1">
            {d}
          </div>
        ))}
      </div>

      {/* Grid */}
      <div className="grid grid-cols-7 gap-1">
        {days.map((day) => {
          const key = format(day, "yyyy-MM-dd");
          const inMonth = isSameMonth(day, cursor);
          const isPast = isBefore(day, today) && !isSameDay(day, today);
          const isToday = isSameDay(day, today);
          const c = counts.get(key);
          const total = (c?.pending || 0) + (c?.approved || 0);

          const isSelected = selectedDate === key;
          return (
            <button
              type="button"
              key={key}
              onClick={() => onSelectDate?.(isSelected ? null : key)}
              className={cn(
                "aspect-square sm:aspect-auto sm:min-h-[80px] rounded-md border p-1 sm:p-2 flex flex-col text-left transition-colors hover:border-primary/60 hover:bg-accent/40 cursor-pointer",
                !inMonth && "opacity-40",
                isPast && "bg-muted/40 text-muted-foreground",
                !isPast && "bg-card",
                isToday && !isSelected && "ring-2 ring-primary border-primary",
                isSelected && "ring-2 ring-primary bg-accent",
              )}
            >
              <div className="text-[10px] sm:text-xs font-medium">{format(day, "d")}</div>
              {total > 0 && (
                <div className="mt-auto flex flex-col gap-0.5 items-start">
                  {(c?.pending || 0) > 0 && (
                    <span
                      className={cn(
                        "text-[9px] sm:text-[10px] font-medium rounded px-1 sm:px-1.5 py-0.5 leading-none",
                        isPast
                          ? "bg-muted text-muted-foreground"
                          : "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300",
                      )}
                    >
                      {c!.pending}P
                    </span>
                  )}
                  {(c?.approved || 0) > 0 && (
                    <span
                      className={cn(
                        "text-[9px] sm:text-[10px] font-medium rounded px-1 sm:px-1.5 py-0.5 leading-none",
                        isPast
                          ? "bg-muted text-muted-foreground"
                          : "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300",
                      )}
                    >
                      {c!.approved}A
                    </span>
                  )}
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 mt-4 text-xs text-muted-foreground flex-wrap">
        <div className="flex items-center gap-1.5">
          <span className="rounded px-1.5 py-0.5 bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300 text-[10px] font-medium">
            #P
          </span>
          Pending
        </div>
        <div className="flex items-center gap-1.5">
          <span className="rounded px-1.5 py-0.5 bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300 text-[10px] font-medium">
            #A
          </span>
          Approved
        </div>
        <div className="flex items-center gap-1.5">
          <span className="rounded px-1.5 py-0.5 bg-muted text-muted-foreground text-[10px] font-medium">
            past
          </span>
          Greyed out
        </div>
      </div>
    </div>
  );
}
