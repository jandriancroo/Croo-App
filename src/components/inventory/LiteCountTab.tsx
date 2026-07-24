import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Check, ChevronLeft, ChevronRight, ArrowRight, Loader2, Plus, Eye } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { DateTime } from "luxon";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import NewLiteCountDialog from "@/components/inventory/NewLiteCountDialog";
import LiteCogsPanel from "@/components/inventory/LiteCogsPanel";
import LiteCountSession from "@/components/inventory/LiteCountSession";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

interface Props {
  locationId: string;
  timezone: string;
  locationName?: string;
}

interface Count {
  id: string;
  period_start: string;
  period_end: string;
  status: string;
  submitted_at: string | null;
  created_at: string;
  is_backfill?: boolean | null;
}

/**
 * Lite Count tab — mirrors Brand InventoryCountTab visually so operators who
 * run both brand and lite locations don't have to learn two systems.
 *
 * Layout:
 *  - Teal hero for the current week (Start count / Resume).
 *  - Past submitted/in-progress counts as a divider list on the left.
 *  - Selected past count's COGS panel on the right (desktop) or inline
 *    expansion (mobile).
 */
export default function LiteCountTab({ locationId, timezone, locationName }: Props) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [showPicker, setShowPicker] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [previewCount, setPreviewCount] = useState<Count | null>(null);
  const [pageIndex, setPageIndex] = useState(0);
  const PAGE_SIZE = 6;

  // Current week range in the location's timezone (Sun–Sat), matching
  // NewLiteCountDialog so the hero and the picker agree.
  const week = useMemo(() => {
    const now = DateTime.now().setZone(timezone || "America/Los_Angeles");
    const dow = now.weekday % 7; // Luxon: 1=Mon..7=Sun; convert so Sun=0
    const sunday = now.minus({ days: dow }).startOf("day");
    const saturday = sunday.plus({ days: 6 });
    return {
      start: sunday.toFormat("yyyy-MM-dd"),
      end: saturday.toFormat("yyyy-MM-dd"),
      label: `Week of ${sunday.toFormat("LLL d")} – ${saturday.toFormat("LLL d")}`,
      range: `${sunday.toFormat("LLL d")} – ${saturday.toFormat("LLL d, yyyy")}`,
    };
  }, [timezone]);

  const { data: counts, isLoading } = useQuery({
    queryKey: ["lite-counts", locationId],
    enabled: !!locationId,
    queryFn: async (): Promise<Count[]> => {
      const { data, error } = await supabase
        .from("lite_inventory_counts" as any)
        .select("id, period_start, period_end, status, submitted_at, created_at, is_backfill")
        .eq("location_id", locationId)
        .order("period_end", { ascending: false })
        .limit(20);
      if (error) throw error;
      return (data as any) || [];
    },
  });

  // Current-week draft if one exists (matches by period_end).
  const currentDraft = useMemo(
    () => (counts || []).find((c) => c.period_end === week.end && c.status !== "submitted") || null,
    [counts, week.end],
  );

  // Past counts (submitted OR any prior draft not belonging to this week).
  const pastCounts = useMemo(
    () => (counts || []).filter((c) => c.id !== currentDraft?.id),
    [counts, currentDraft],
  );

  const pastMaxPage = Math.max(0, Math.ceil(pastCounts.length / PAGE_SIZE) - 1);
  const pagedPast = pastCounts.slice(pageIndex * PAGE_SIZE, pageIndex * PAGE_SIZE + PAGE_SIZE);

  // Auto-select first submitted count on desktop so the COGS panel isn't blank.
  const firstSubmitted = pastCounts.find((c) => c.status === "submitted") || null;
  const desktopSelectedId = selectedId ?? firstSubmitted?.id ?? null;
  const desktopSelected = pastCounts.find((c) => c.id === desktopSelectedId) || null;

  const fmt = (d: string) => DateTime.fromFormat(d, "yyyy-MM-dd").toFormat("LLL d");

  // Start / resume the current week's count directly from the hero.
  const startCurrentWeek = useMutation({
    mutationFn: async () => {
      if (currentDraft) return currentDraft.id;
      const { data: userData } = await supabase.auth.getUser();
      const { data, error } = await supabase
        .from("lite_inventory_counts" as any)
        .insert({
          location_id: locationId,
          period_start: week.start,
          period_end: week.end,
          status: "draft",
          created_by: userData.user?.id ?? null,
        })
        .select("id")
        .maybeSingle();
      if (error) throw error;
      return (data as any).id as string;
    },
    onSuccess: (id) => {
      qc.invalidateQueries({ queryKey: ["lite-counts", locationId] });
      navigate(`/inventory/${locationId}/count/${id}`);
    },
    onError: (err: any) => {
      toast.error("Couldn't start count", { description: err?.message });
    },
  });

  const renderHero = () => (
    <div className="rounded-xl px-4 py-3 bg-primary text-primary-foreground shadow-sm flex items-center justify-between gap-3">
      <div className="min-w-0">
        <div className="text-[9px] font-bold uppercase tracking-widest text-primary-foreground/70">
          Current period
        </div>
        <div className="text-sm font-bold leading-tight truncate">
          {week.label}
          {currentDraft && (
            <span className="ml-2 text-[10px] font-semibold uppercase tracking-wider text-primary-foreground/80">
              · In progress
            </span>
          )}
        </div>
        <div className="text-[11px] text-primary-foreground/75 truncate">{week.range}</div>
      </div>
      <Button
        size="sm"
        variant="secondary"
        onClick={() => startCurrentWeek.mutate()}
        disabled={startCurrentWeek.isPending}
        className="font-semibold shadow flex-shrink-0 h-8"
      >
        {startCurrentWeek.isPending ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : currentDraft ? (
          <>Resume <ArrowRight className="h-4 w-4 ml-1" /></>
        ) : (
          "Start count"
        )}
      </Button>
    </div>
  );

  const renderPastList = ({ desktop }: { desktop: boolean }) => {
    if (pastCounts.length === 0) {
      return (
        <div className="rounded-2xl border border-dashed border-border bg-muted/20 p-6 text-center text-xs text-muted-foreground">
          No past counts yet.
        </div>
      );
    }
    return (
      <div className="rounded-2xl border border-border bg-card overflow-hidden">
        {pagedPast.map((count) => {
          const isActive = desktop
            ? count.id === desktopSelectedId
            : count.id === selectedId;
          const submitted = count.status === "submitted";
          const label = `Week · ${fmt(count.period_start)} – ${fmt(count.period_end)}`;
          const statusLabel = submitted
            ? count.submitted_at
              ? `Submitted ${DateTime.fromISO(count.submitted_at).toRelative()}`
              : "Submitted"
            : "In progress";

          return (
            <div key={count.id} className="border-b border-border last:border-b-0">
              <div
                role="button"
                tabIndex={0}
                onClick={() =>
                  setSelectedId(desktop ? count.id : (isActive ? null : count.id))
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setSelectedId(desktop ? count.id : (isActive ? null : count.id));
                  }
                }}
                className={`w-full flex items-center justify-between gap-3 px-4 py-3 text-left transition-colors cursor-pointer ${
                  isActive
                    ? desktop
                      ? "bg-primary/10 border-l-2 border-primary pl-[14px]"
                      : "bg-muted/40"
                    : "hover:bg-muted/30"
                }`}
              >
                <div className="min-w-0">
                  <div className="text-sm font-bold flex items-center gap-1.5">
                    {label}
                    {submitted && (
                      <Check className="h-3.5 w-3.5 text-emerald-500" strokeWidth={3} />
                    )}
                    {count.is_backfill && (
                      <Badge variant="outline" className="text-[9px] font-normal px-1.5 py-0">
                        Historical
                      </Badge>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground">{statusLabel}</div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {submitted && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={(e) => {
                        e.stopPropagation();
                        setPreviewCount(count);
                      }}
                      aria-label="Preview count"
                      title="Preview count"
                    >
                      <Eye className="h-4 w-4" />
                    </Button>
                  )}
                  <Badge
                    variant={submitted ? "default" : "secondary"}
                    className="text-[10px]"
                  >
                    {submitted ? "Submitted" : "Draft"}
                  </Badge>
                </div>
              </div>


              {/* Mobile inline expansion — resume for drafts, COGS for submitted */}
              {!desktop && (
                <AnimatePresence initial={false}>
                  {isActive && (
                    <motion.div
                      key="panel"
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2, ease: "easeOut" }}
                      className="overflow-hidden"
                    >
                      <div className="px-3 pb-3 pt-1">
                        {submitted ? (
                          <LiteCogsPanel
                            countId={count.id}
                            locationId={locationId}
                            periodStart={count.period_start}
                            periodEnd={count.period_end}
                            locationName={locationName || "Location"}
                          />
                        ) : (
                          <div className="flex items-center justify-between px-3 py-3 rounded-xl bg-muted/40">
                            <span className="text-xs text-muted-foreground">
                              Draft count in progress.
                            </span>
                            <Button
                              size="sm"
                              onClick={() =>
                                navigate(`/inventory/${locationId}/count/${count.id}`)
                              }
                            >
                              Open <ArrowRight className="h-4 w-4 ml-1" />
                            </Button>
                          </div>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              )}
            </div>
          );
        })}

        {pastCounts.length > PAGE_SIZE && (
          <div className="flex items-center justify-between px-3 py-2 bg-muted/20 border-t border-border">
            <button
              onClick={() => setPageIndex((p) => Math.max(0, p - 1))}
              disabled={pageIndex === 0}
              className="w-8 h-8 rounded-lg bg-background hover:bg-muted flex items-center justify-center disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="text-[11px] text-muted-foreground font-medium tabular-nums">
              {pageIndex + 1} / {pastMaxPage + 1}
            </span>
            <button
              onClick={() => setPageIndex((p) => Math.min(pastMaxPage, p + 1))}
              disabled={pageIndex >= pastMaxPage}
              className="w-8 h-8 rounded-lg bg-background hover:bg-muted flex items-center justify-center disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>
    );
  };

  const renderHistoricalRow = () => (
    <button
      onClick={() => setShowPicker(true)}
      className="w-full flex items-center justify-between gap-2 rounded-xl border border-dashed border-border bg-background hover:bg-muted/30 px-4 py-2.5 text-left transition-colors"
    >
      <div className="flex items-center gap-2 min-w-0">
        <Plus className="h-4 w-4 text-muted-foreground" />
        <span className="text-xs font-semibold text-muted-foreground">
          Enter a historical count
        </span>
      </div>
      <ChevronRight className="h-4 w-4 text-muted-foreground" />
    </button>
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-10 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  return (
    <>
      <div className="space-y-3">
        {/* Mobile */}
        <div className="md:hidden space-y-3">
          {renderHero()}
          {renderPastList({ desktop: false })}
          {renderHistoricalRow()}
        </div>

        {/* Desktop master-detail */}
        <div className="hidden md:grid md:grid-cols-12 md:gap-4">
          <div className="md:col-span-5 space-y-3">
            {renderHero()}
            {renderPastList({ desktop: true })}
            {renderHistoricalRow()}
          </div>
          <div className="md:col-span-7">
            {desktopSelected ? (
              desktopSelected.status === "submitted" ? (
                <div className="space-y-3">
                  <div className="flex justify-end">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPreviewCount(desktopSelected)}
                      className="gap-1.5"
                    >
                      <Eye className="h-4 w-4" />
                      Preview count
                    </Button>
                  </div>
                  <LiteCogsPanel
                    countId={desktopSelected.id}
                    locationId={locationId}
                    periodStart={desktopSelected.period_start}
                    periodEnd={desktopSelected.period_end}
                    locationName={locationName || "Location"}
                  />
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed border-border bg-muted/20 p-8 text-center space-y-3">
                  <div className="text-sm text-muted-foreground">
                    Draft count in progress. Open it to keep counting.
                  </div>
                  <Button
                    onClick={() =>
                      navigate(`/inventory/${locationId}/count/${desktopSelected.id}`)
                    }
                  >
                    Open draft <ArrowRight className="h-4 w-4 ml-1" />
                  </Button>
                </div>
              )
            ) : (
              <div className="rounded-2xl border border-dashed border-border bg-muted/20 p-8 text-center text-sm text-muted-foreground">
                Select a submitted count to see its COGS breakdown.
              </div>
            )}
          </div>

        </div>
      </div>

      <NewLiteCountDialog
        open={showPicker}
        onOpenChange={setShowPicker}
        locationId={locationId}
        timezone={timezone}
      />
    </>
  );
}
