import { useState, useMemo, useRef, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Plus, Play, Package, ArrowRight, ChevronLeft, ChevronRight,
  DollarSign, CheckCircle2, BarChart3, ArrowLeft,
} from "lucide-react";
import { format } from "date-fns";
import { motion, AnimatePresence } from "framer-motion";
import { useNavigate } from "react-router-dom";

// ——— Mock data ———
const MOCK_COUNTS = [
  { id: "current-week", status: "upcoming", period_type: "weekly", period_end_date: "2026-03-17", count_date: "2026-03-16", _isUpcoming: true, _stats: { totalItems: 202, countedItems: 0, totalCost: 0 } },
  { id: "week-mar-10", status: "in_progress", period_type: "weekly", period_end_date: "2026-03-10", count_date: "2026-03-10", _stats: { totalItems: 202, countedItems: 167, totalCost: 14230 } },
  { id: "week-mar-3", status: "completed", period_type: "weekly", period_end_date: "2026-03-03", count_date: "2026-03-03", _stats: { totalItems: 202, countedItems: 202, totalCost: 13870 } },
  { id: "me-feb", status: "completed", period_type: "monthly", period_end_date: "2026-02-28", count_date: "2026-02-28", _stats: { totalItems: 202, countedItems: 202, totalCost: 15420 } },
  { id: "week-feb-24", status: "completed", period_type: "weekly", period_end_date: "2026-02-24", count_date: "2026-02-24", _stats: { totalItems: 198, countedItems: 198, totalCost: 12980 } },
  { id: "week-feb-17", status: "completed", period_type: "weekly", period_end_date: "2026-02-17", count_date: "2026-02-17", _stats: { totalItems: 198, countedItems: 198, totalCost: 13150 } },
  { id: "week-feb-10", status: "completed", period_type: "weekly", period_end_date: "2026-02-10", count_date: "2026-02-10", _stats: { totalItems: 195, countedItems: 195, totalCost: 12640 } },
  { id: "week-feb-3", status: "completed", period_type: "weekly", period_end_date: "2026-02-03", count_date: "2026-02-03", _stats: { totalItems: 195, countedItems: 195, totalCost: 12200 } },
  { id: "me-jan", status: "completed", period_type: "monthly", period_end_date: "2026-01-31", count_date: "2026-01-31", _stats: { totalItems: 195, countedItems: 195, totalCost: 14800 } },
];

export default function CountTabPreview() {
  const navigate = useNavigate();
  const [activeOption, setActiveOption] = useState(0);

  return (
    <div className="min-h-screen bg-background">
      <div className="bg-primary text-primary-foreground px-4 py-3 flex items-center gap-3">
        <button onClick={() => navigate(-1)} className="w-8 h-8 flex items-center justify-center">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <h1 className="text-lg font-bold">Count Tab — Layout Preview</h1>
      </div>

      {/* Option selector */}
      <div className="flex gap-1 p-3 bg-muted/30 border-b border-border/30 overflow-x-auto">
        {["Option 1: Classic Folder", "Option 2: Raised Tab", "Option 3: Underline Connect", "Option 4: Notch Tab", "Option 5: Pill Stack"].map((label, idx) => (
          <button
            key={idx}
            onClick={() => setActiveOption(idx)}
            className={`px-3 py-2 rounded-lg text-xs font-semibold whitespace-nowrap transition-all ${
              activeOption === idx
                ? "bg-primary text-primary-foreground"
                : "bg-card text-muted-foreground hover:bg-muted"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="p-4 max-w-lg mx-auto">
        {activeOption === 0 && <Option1_ClassicFolder />}
        {activeOption === 1 && <Option2_RaisedTab />}
        {activeOption === 2 && <Option3_UnderlineConnect />}
        {activeOption === 3 && <Option4_NotchTab />}
        {activeOption === 4 && <Option5_PillStack />}
      </div>
    </div>
  );
}

// ——— Shared pieces ———

function useFilteredCounts() {
  const [typeFilter, setTypeFilter] = useState<"all" | "weekly" | "monthly">("all");
  const [selectedIdx, setSelectedIdx] = useState(0);

  const filteredCounts = useMemo(() => {
    if (typeFilter === "all") return MOCK_COUNTS;
    return MOCK_COUNTS.filter((c) => c.period_type === typeFilter);
  }, [typeFilter]);

  const safeIdx = Math.min(selectedIdx, Math.max(filteredCounts.length - 1, 0));
  const selectedCount = filteredCounts[safeIdx] || null;

  useEffect(() => { setSelectedIdx(0); }, [typeFilter]);

  return { typeFilter, setTypeFilter, selectedIdx: safeIdx, setSelectedIdx, filteredCounts, selectedCount };
}

function FilterChips({ typeFilter, setTypeFilter, selectedIdx, total }: any) {
  return (
    <div className="flex items-center gap-2 mb-2">
      {([["all", "All"], ["weekly", "Weekly"], ["monthly", "Monthly"]] as const).map(([v, l]) => (
        <button key={v} onClick={() => setTypeFilter(v)}
          className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${
            typeFilter === v ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"
          }`}>{l}</button>
      ))}
      <div className="flex-1" />
      <span className="text-[11px] text-muted-foreground font-medium tabular-nums">{selectedIdx + 1} of {total}</span>
    </div>
  );
}

function DetailCardContent({ count }: { count: any }) {
  const pct = count._stats.totalItems > 0 ? Math.round((count._stats.countedItems / count._stats.totalItems) * 100) : 0;
  return (
    <>
      <div className="px-4 pt-4 pb-3 border-b border-border/20">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-base font-bold">
              {count.period_type === "weekly"
                ? `Week Ending ${format(new Date(count.period_end_date + "T12:00:00"), "MMM d, yyyy")}`
                : `${format(new Date(count.period_end_date + "T12:00:00"), "MMMM yyyy")} Month End`}
            </h3>
            <div className="flex items-center gap-2 mt-1">
              <StatusBadge status={count.status} isUpcoming={!!count._isUpcoming} />
              {count.status === "in_progress" && <span className="text-xs text-muted-foreground">{pct}%</span>}
            </div>
          </div>
          {count.status === "in_progress" && <Button size="sm">Resume <ArrowRight className="h-4 w-4 ml-1" /></Button>}
          {count._isUpcoming && <Button size="sm" variant="outline">Start <Play className="h-3.5 w-3.5 ml-1" /></Button>}
        </div>
        {count.status === "in_progress" && (
          <div className="mt-3 w-full bg-muted rounded-full h-2">
            <motion.div className="bg-primary rounded-full h-2" initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 0.5 }} />
          </div>
        )}
      </div>
      <div className="p-4">
        <div className="grid grid-cols-3 gap-3">
          <StatCell icon={<CheckCircle2 className="h-4 w-4" />} label="Items" value={`${count._stats.countedItems}/${count._stats.totalItems}`} accent={count._stats.countedItems === count._stats.totalItems && count._stats.totalItems > 0} />
          <StatCell icon={<DollarSign className="h-4 w-4" />} label="Total Value" value={count._stats.totalCost > 0 ? `$${count._stats.totalCost.toLocaleString()}` : "—"} />
          <StatCell icon={<BarChart3 className="h-4 w-4" />} label="Variance" value={count.status === "completed" ? "-2.1%" : "—"} negative={count.status === "completed"} />
        </div>
        {count.status === "completed" && (
          <div className="flex gap-2 mt-4">
            <Button size="sm" variant="outline" className="flex-1 text-xs">View Details</Button>
            <Button size="sm" variant="outline" className="flex-1 text-xs">COGS Report</Button>
          </div>
        )}
      </div>
    </>
  );
}

function TabLabel({ count, isActive }: { count: any; isActive: boolean }) {
  const endDate = new Date(count.period_end_date + "T12:00:00");
  const isInProgress = count.status === "in_progress";
  return (
    <div className="flex flex-col items-center gap-0.5 relative">
      {(count._isUpcoming || isInProgress) && (
        <span className={`absolute -top-1 -right-1 h-2 w-2 rounded-full ${isInProgress ? "bg-amber-400" : "bg-emerald-400"} ${!isActive ? "animate-pulse" : ""}`} />
      )}
      <span className={`text-[9px] uppercase font-bold tracking-widest leading-none ${isActive ? "text-primary-foreground/60" : "text-muted-foreground"}`}>
        {count.period_type === "monthly" ? "Month" : "Week"}
      </span>
      <span className="text-[13px] font-bold leading-tight whitespace-nowrap">
        {count.period_type === "monthly" ? format(endDate, "MMM ''yy") : format(endDate, "MMM d")}
      </span>
      {count._stats.totalCost > 0 && (
        <span className={`text-[10px] tabular-nums leading-none ${isActive ? "text-primary-foreground/70" : "text-muted-foreground"}`}>
          ${(count._stats.totalCost / 1000).toFixed(1)}k
        </span>
      )}
    </div>
  );
}

function PaginationDots({ count: total, activeIdx, onSelect }: { count: number; activeIdx: number; onSelect: (i: number) => void }) {
  if (total <= 1) return null;
  return (
    <div className="flex justify-center gap-1.5 mt-3">
      {Array.from({ length: total }).map((_, idx) => (
        <button key={idx} onClick={() => onSelect(idx)}
          className={`rounded-full transition-all duration-200 ${idx === activeIdx ? "w-5 h-1.5 bg-primary" : "w-1.5 h-1.5 bg-muted-foreground/25 hover:bg-muted-foreground/40"}`} />
      ))}
    </div>
  );
}

function NavArrows({ onPrev, onNext, disablePrev, disableNext }: any) {
  return (
    <>
      <button onClick={onPrev} disabled={disablePrev}
        className="absolute -left-2 top-10 z-20 w-8 h-8 rounded-full bg-card border border-border/50 shadow-sm flex items-center justify-center disabled:opacity-20 transition-opacity">
        <ChevronLeft className="h-4 w-4 text-muted-foreground" />
      </button>
      <button onClick={onNext} disabled={disableNext}
        className="absolute -right-2 top-10 z-20 w-8 h-8 rounded-full bg-card border border-border/50 shadow-sm flex items-center justify-center disabled:opacity-20 transition-opacity">
        <ChevronRight className="h-4 w-4 text-muted-foreground" />
      </button>
    </>
  );
}

// =============================================
// OPTION 1 — Classic Folder Tabs
// Tabs sit directly on the card edge, active tab merges with card via shared bg + no bottom border
// =============================================
function Option1_ClassicFolder() {
  const { typeFilter, setTypeFilter, selectedIdx, setSelectedIdx, filteredCounts, selectedCount } = useFilteredCounts();
  const tabsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!tabsRef.current) return;
    const el = tabsRef.current.querySelector('[data-active="true"]');
    el?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  }, [selectedIdx]);

  return (
    <div className="space-y-3">
      <StartCountCard />
      <FilterChips typeFilter={typeFilter} setTypeFilter={setTypeFilter} selectedIdx={selectedIdx} total={filteredCounts.length} />

      {/* Folder tabs + card */}
      <div>
        {/* Tab strip — aligned to bottom so tabs "sit" on card */}
        <div ref={tabsRef} className="flex gap-0 overflow-x-auto items-end pl-2" style={{ scrollbarWidth: "none" }}>
          {filteredCounts.map((count, idx) => {
            const isActive = idx === selectedIdx;
            return (
              <button
                key={count.id}
                data-active={isActive}
                onClick={() => setSelectedIdx(idx)}
                className={`
                  flex-shrink-0 px-4 py-2.5 min-w-[78px] transition-all duration-150
                  ${isActive
                    ? "bg-card rounded-t-xl border border-border/30 border-b-0 relative z-10 -mb-px shadow-sm"
                    : "bg-muted/50 rounded-t-lg border border-transparent hover:bg-muted/80 mb-0"
                  }
                `}
              >
                <TabLabel count={count} isActive={isActive} />
              </button>
            );
          })}
        </div>

        {/* Card body — seamless with active tab */}
        <div className="relative">
          {filteredCounts.length > 1 && (
            <NavArrows onPrev={() => setSelectedIdx(Math.max(0, selectedIdx - 1))} onNext={() => setSelectedIdx(Math.min(filteredCounts.length - 1, selectedIdx + 1))}
              disablePrev={selectedIdx === 0} disableNext={selectedIdx === filteredCounts.length - 1} />
          )}
          <AnimatePresence mode="wait">
            {selectedCount && (
              <motion.div key={selectedCount.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
                <Card className="rounded-tl-none border-t border-border/30">
                  <DetailCardContent count={selectedCount} />
                </Card>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      <PaginationDots count={filteredCounts.length} activeIdx={selectedIdx} onSelect={setSelectedIdx} />
    </div>
  );
}

// =============================================
// OPTION 2 — Raised Tab
// Active tab is elevated/scaled with a stem connecting to the card
// =============================================
function Option2_RaisedTab() {
  const { typeFilter, setTypeFilter, selectedIdx, setSelectedIdx, filteredCounts, selectedCount } = useFilteredCounts();
  const tabsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!tabsRef.current) return;
    const el = tabsRef.current.querySelector('[data-active="true"]');
    el?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  }, [selectedIdx]);

  return (
    <div className="space-y-3">
      <StartCountCard />
      <FilterChips typeFilter={typeFilter} setTypeFilter={setTypeFilter} selectedIdx={selectedIdx} total={filteredCounts.length} />

      <div>
        <div ref={tabsRef} className="flex gap-1.5 overflow-x-auto px-1 pb-1" style={{ scrollbarWidth: "none" }}>
          {filteredCounts.map((count, idx) => {
            const isActive = idx === selectedIdx;
            return (
              <button
                key={count.id}
                data-active={isActive}
                onClick={() => setSelectedIdx(idx)}
                className={`
                  flex-shrink-0 px-3.5 py-2.5 min-w-[76px] rounded-xl border transition-all duration-200
                  ${isActive
                    ? "bg-primary text-primary-foreground border-primary shadow-lg scale-105 -translate-y-1"
                    : "bg-card text-foreground border-border/40 hover:border-border hover:bg-muted/40"
                  }
                `}
              >
                <TabLabel count={count} isActive={isActive} />
              </button>
            );
          })}
        </div>

        {/* Stem from active tab */}
        <div className="flex justify-center">
          <div className="w-0.5 h-4 bg-primary rounded-full" />
        </div>

        <div className="relative">
          {filteredCounts.length > 1 && (
            <NavArrows onPrev={() => setSelectedIdx(Math.max(0, selectedIdx - 1))} onNext={() => setSelectedIdx(Math.min(filteredCounts.length - 1, selectedIdx + 1))}
              disablePrev={selectedIdx === 0} disableNext={selectedIdx === filteredCounts.length - 1} />
          )}
          <AnimatePresence mode="wait">
            {selectedCount && (
              <motion.div key={selectedCount.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} transition={{ duration: 0.18 }}>
                <Card className="border-t-2 border-t-primary">
                  <DetailCardContent count={selectedCount} />
                </Card>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      <PaginationDots count={filteredCounts.length} activeIdx={selectedIdx} onSelect={setSelectedIdx} />
    </div>
  );
}

// =============================================
// OPTION 3 — Underline Connect
// Minimal tabs with a thick underline that extends into a vertical connector to the card
// =============================================
function Option3_UnderlineConnect() {
  const { typeFilter, setTypeFilter, selectedIdx, setSelectedIdx, filteredCounts, selectedCount } = useFilteredCounts();
  const tabsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!tabsRef.current) return;
    const el = tabsRef.current.querySelector('[data-active="true"]');
    el?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  }, [selectedIdx]);

  return (
    <div className="space-y-3">
      <StartCountCard />
      <FilterChips typeFilter={typeFilter} setTypeFilter={setTypeFilter} selectedIdx={selectedIdx} total={filteredCounts.length} />

      <div>
        <div ref={tabsRef} className="flex gap-0 overflow-x-auto border-b-2 border-border/20" style={{ scrollbarWidth: "none" }}>
          {filteredCounts.map((count, idx) => {
            const isActive = idx === selectedIdx;
            return (
              <button
                key={count.id}
                data-active={isActive}
                onClick={() => setSelectedIdx(idx)}
                className={`
                  flex-shrink-0 px-4 py-3 min-w-[78px] relative transition-all duration-200
                  ${isActive ? "text-primary" : "text-muted-foreground hover:text-foreground"}
                `}
              >
                <TabLabel count={count} isActive={isActive} />
                {/* Active underline */}
                {isActive && (
                  <motion.div layoutId="tab-underline" className="absolute bottom-0 left-1 right-1 h-[3px] bg-primary rounded-t-full" />
                )}
              </button>
            );
          })}
        </div>

        {/* Vertical connector */}
        <div className="flex pl-[calc(50%-1px)]">
          <div className="w-0.5 h-5 bg-primary/40" />
        </div>

        <div className="relative">
          {filteredCounts.length > 1 && (
            <NavArrows onPrev={() => setSelectedIdx(Math.max(0, selectedIdx - 1))} onNext={() => setSelectedIdx(Math.min(filteredCounts.length - 1, selectedIdx + 1))}
              disablePrev={selectedIdx === 0} disableNext={selectedIdx === filteredCounts.length - 1} />
          )}
          <AnimatePresence mode="wait">
            {selectedCount && (
              <motion.div key={selectedCount.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
                <Card>
                  <DetailCardContent count={selectedCount} />
                </Card>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      <PaginationDots count={filteredCounts.length} activeIdx={selectedIdx} onSelect={setSelectedIdx} />
    </div>
  );
}

// =============================================
// OPTION 4 — Notch Tab
// Active tab has an inverted notch / arrow pointing down into the card
// =============================================
function Option4_NotchTab() {
  const { typeFilter, setTypeFilter, selectedIdx, setSelectedIdx, filteredCounts, selectedCount } = useFilteredCounts();
  const tabsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!tabsRef.current) return;
    const el = tabsRef.current.querySelector('[data-active="true"]');
    el?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  }, [selectedIdx]);

  return (
    <div className="space-y-3">
      <StartCountCard />
      <FilterChips typeFilter={typeFilter} setTypeFilter={setTypeFilter} selectedIdx={selectedIdx} total={filteredCounts.length} />

      <div>
        <div ref={tabsRef} className="flex gap-1.5 overflow-x-auto px-1 pb-0" style={{ scrollbarWidth: "none" }}>
          {filteredCounts.map((count, idx) => {
            const isActive = idx === selectedIdx;
            return (
              <div key={count.id} className="flex-shrink-0 flex flex-col items-center">
                <button
                  data-active={isActive}
                  onClick={() => setSelectedIdx(idx)}
                  className={`
                    px-3.5 py-2.5 min-w-[76px] rounded-xl border transition-all duration-200
                    ${isActive
                      ? "bg-primary text-primary-foreground border-primary shadow-md"
                      : "bg-card text-foreground border-border/40 hover:bg-muted/40"
                    }
                  `}
                >
                  <TabLabel count={count} isActive={isActive} />
                </button>
                {/* Notch arrow */}
                {isActive && (
                  <div className="w-0 h-0 border-l-[8px] border-r-[8px] border-t-[8px] border-l-transparent border-r-transparent border-t-primary -mb-px relative z-10" />
                )}
                {!isActive && <div className="h-[8px]" />}
              </div>
            );
          })}
        </div>

        <div className="relative">
          {filteredCounts.length > 1 && (
            <NavArrows onPrev={() => setSelectedIdx(Math.max(0, selectedIdx - 1))} onNext={() => setSelectedIdx(Math.min(filteredCounts.length - 1, selectedIdx + 1))}
              disablePrev={selectedIdx === 0} disableNext={selectedIdx === filteredCounts.length - 1} />
          )}
          <AnimatePresence mode="wait">
            {selectedCount && (
              <motion.div key={selectedCount.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.15 }}>
                <Card>
                  <DetailCardContent count={selectedCount} />
                </Card>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      <PaginationDots count={filteredCounts.length} activeIdx={selectedIdx} onSelect={setSelectedIdx} />
    </div>
  );
}

// =============================================
// OPTION 5 — Pill Stack
// Compact pills in a row, active pill expands and the card slides up flush beneath it
// =============================================
function Option5_PillStack() {
  const { typeFilter, setTypeFilter, selectedIdx, setSelectedIdx, filteredCounts, selectedCount } = useFilteredCounts();
  const tabsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!tabsRef.current) return;
    const el = tabsRef.current.querySelector('[data-active="true"]');
    el?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  }, [selectedIdx]);

  return (
    <div className="space-y-3">
      <StartCountCard />
      <FilterChips typeFilter={typeFilter} setTypeFilter={setTypeFilter} selectedIdx={selectedIdx} total={filteredCounts.length} />

      <div className="bg-card rounded-2xl border border-border/30 overflow-hidden shadow-neumorphic">
        {/* Pills inside the card header */}
        <div ref={tabsRef} className="flex gap-1 overflow-x-auto px-3 pt-3 pb-2" style={{ scrollbarWidth: "none" }}>
          {filteredCounts.map((count, idx) => {
            const isActive = idx === selectedIdx;
            const endDate = new Date(count.period_end_date + "T12:00:00");
            const isInProgress = count.status === "in_progress";
            return (
              <button
                key={count.id}
                data-active={isActive}
                onClick={() => setSelectedIdx(idx)}
                className={`
                  flex-shrink-0 px-3 py-1.5 rounded-full border transition-all duration-200 flex items-center gap-1.5
                  ${isActive
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-muted/40 text-muted-foreground border-transparent hover:bg-muted/70"
                  }
                `}
              >
                {(count._isUpcoming || isInProgress) && (
                  <span className={`h-1.5 w-1.5 rounded-full flex-shrink-0 ${isInProgress ? "bg-amber-400" : "bg-emerald-400"}`} />
                )}
                <span className="text-[11px] font-bold whitespace-nowrap">
                  {count.period_type === "monthly" ? format(endDate, "MMM ''yy") : format(endDate, "MMM d")}
                </span>
                {isActive && count._stats.totalCost > 0 && (
                  <span className="text-[10px] text-primary-foreground/70 tabular-nums">
                    ${(count._stats.totalCost / 1000).toFixed(1)}k
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Divider */}
        <div className="h-px bg-border/30 mx-3" />

        {/* Detail content inline */}
        <div className="relative">
          {filteredCounts.length > 1 && (
            <NavArrows onPrev={() => setSelectedIdx(Math.max(0, selectedIdx - 1))} onNext={() => setSelectedIdx(Math.min(filteredCounts.length - 1, selectedIdx + 1))}
              disablePrev={selectedIdx === 0} disableNext={selectedIdx === filteredCounts.length - 1} />
          )}
          <AnimatePresence mode="wait">
            {selectedCount && (
              <motion.div key={selectedCount.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
                <DetailCardContent count={selectedCount} />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      <PaginationDots count={filteredCounts.length} activeIdx={selectedIdx} onSelect={setSelectedIdx} />
    </div>
  );
}

// ——— Shared small components ———

function StartCountCard() {
  return (
    <Card>
      <CardContent className="p-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
            <Package className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h3 className="font-semibold text-sm">Start Inventory Count</h3>
            <p className="text-muted-foreground text-xs">Select a period and begin counting</p>
          </div>
        </div>
        <Button size="sm"><Plus className="h-4 w-4 mr-1.5" /> New</Button>
      </CardContent>
    </Card>
  );
}

function StatusBadge({ status, isUpcoming }: { status: string; isUpcoming: boolean }) {
  if (isUpcoming) return (
    <Badge variant="outline" className="text-[10px] px-2 py-0 h-5 uppercase border-emerald-500/40 text-emerald-600 bg-emerald-500/5">
      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 mr-1.5 animate-pulse" /> Current
    </Badge>
  );
  if (status === "in_progress") return (
    <Badge variant="outline" className="text-[10px] px-2 py-0 h-5 uppercase border-amber-500/40 text-amber-600 bg-amber-500/5">
      <span className="w-1.5 h-1.5 rounded-full bg-amber-500 mr-1.5" /> In Progress
    </Badge>
  );
  return (
    <Badge variant="outline" className="text-[10px] px-2 py-0 h-5 uppercase border-border text-muted-foreground">
      <CheckCircle2 className="h-3 w-3 mr-1" /> Complete
    </Badge>
  );
}

function StatCell({ icon, label, value, accent, negative }: { icon: React.ReactNode; label: string; value: string; accent?: boolean; negative?: boolean }) {
  return (
    <div className="flex flex-col items-center gap-1.5 p-3 rounded-xl bg-muted/40 border border-border/20">
      <div className={accent ? "text-emerald-500" : negative ? "text-red-500" : "text-muted-foreground"}>{icon}</div>
      <span className={`text-sm font-bold tabular-nums ${accent ? "text-emerald-600" : negative ? "text-red-500" : ""}`}>{value}</span>
      <span className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</span>
    </div>
  );
}
