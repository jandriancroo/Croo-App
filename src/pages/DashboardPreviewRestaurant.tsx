// "Restaurant-first" service mode preview (LOOK 3).
// Static visual showcase — view at /dashboard-preview-restaurant.
// Projected sales render as muted shaded bars behind the actual sales bars.
// NOTE: The Punch Clock screen here is a PREVIEW MOCKUP only — it is NOT applied
// to the real punch clock. Only the swipe-pager + pagination pattern is shared.

import { Scissors, ChevronLeft, ChevronRight, Fingerprint, Clock, Sun, Moon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

type Theme = "dark" | "light";

export default function DashboardPreviewRestaurant() {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState(0);
  const [theme, setTheme] = useState<Theme>("dark");

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const onScroll = () => {
      const p = Math.round(el.scrollLeft / el.clientWidth);
      setPage(p);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  const goTo = (i: number) => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTo({ left: i * el.clientWidth, behavior: "smooth" });
  };

  const t = useMemo(() => tokens(theme), [theme]);

  return (
    <div
      className={`min-h-screen w-full ${t.appBg} ${t.appText} relative overflow-hidden`}
      style={{ fontFamily: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif' }}
    >
      <div
        ref={scrollerRef}
        className="flex w-full h-screen overflow-x-auto snap-x snap-mandatory scroll-smooth no-scrollbar"
        style={{ scrollbarWidth: "none" }}
      >
        {/* Page 1: Dashboard */}
        <section className="snap-center shrink-0 w-full h-full overflow-y-auto p-4 lg:p-10 pb-24">
          <div className="max-w-6xl mx-auto">
            <div className={`${t.shell} border ${t.border} rounded-3xl p-6 lg:p-8 shadow-2xl`}>
              {/* Header with theme toggle + clock top-right */}
              <div className={`pb-5 border-b ${t.border} flex items-start justify-between gap-6`}>
                <div>
                  <p className="text-amber-500 font-bold text-[11px] tracking-[0.2em] uppercase">Friday Dinner</p>
                  <p className={`mt-2 ${t.text} text-xl lg:text-2xl font-medium`}>
                    <span className={t.subtle}>8 hours in · projecting </span>
                    <span className={`${t.text} font-semibold`}>$439 short</span>
                    <span className={t.subtle}> of EOD goal</span>
                  </p>
                </div>
                <div className="flex items-start gap-4 shrink-0">
                  <ThemePill theme={theme} setTheme={setTheme} t={t} />
                  <div className="text-right">
                    <div className={`${t.text} text-3xl lg:text-4xl font-light tracking-tight tabular-nums`}>
                      10:34<span className={`${t.muted} text-lg ml-1`}>PM</span>
                    </div>
                    <div className={`${t.muted} text-[11px] uppercase tracking-widest mt-1`}>Friday, Jun 5</div>
                  </div>
                </div>
              </div>

              {/* KPIs */}
              <div className="grid grid-cols-3 gap-4 mt-6">
                <KpiCard t={t} label="Total Sales" value="$3,795" />
                <KpiCard t={t} label="EOD Goal" value="$4,234" />
                <KpiCard t={t} label="Pace" value="$3,795" sub="90% of goal" accent />
              </div>

              {/* Middle row: hourly + labor/line */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-4">
                <div className={`lg:col-span-2 ${t.card} rounded-2xl p-5 lg:p-6`}>
                  <div className="flex justify-between items-baseline mb-6">
                    <h3 className={`text-[11px] font-bold tracking-[0.2em] uppercase ${t.subtle}`}>Hourly Sales</h3>
                    <span className="text-amber-500 text-xs font-medium">peak at 5pm</span>
                  </div>
                  <HourlyBars t={t} />
                </div>

                <div className="flex flex-col gap-4">
                  <div className={`${t.card} rounded-2xl p-5`}>
                    <h3 className={`text-[11px] font-bold tracking-[0.2em] uppercase ${t.subtle}`}>Labor</h3>
                    <div className="flex items-baseline gap-2 mt-2">
                      <span className="text-emerald-500 text-3xl font-bold">22.9%</span>
                      <span className="text-emerald-500/70 text-xs">on target</span>
                    </div>
                    <p className={`${t.muted} text-xs mt-1`}>$870 · 40.1h</p>
                  </div>

                  <div className={`${t.card} rounded-2xl p-5 flex-1 flex flex-col min-h-0`}>
                    <div className="flex items-center justify-between mb-3 shrink-0">
                      <h3 className={`text-[11px] font-bold tracking-[0.2em] uppercase ${t.subtle}`}>On The Line</h3>
                      <button className={`w-7 h-7 rounded-full ${t.chip} flex items-center justify-center transition-colors`} title="Cut staff">
                        <Scissors className={`w-3.5 h-3.5 ${t.subtle}`} strokeWidth={2.25} />
                      </button>
                    </div>
                    {/* 2-column, shows up to 6, scrolls beyond */}
                    <div className="flex-1 overflow-y-auto min-h-0 grid grid-cols-2 gap-x-3 gap-y-2.5 pr-1 auto-rows-max">
                      <StaffRow t={t} name="Janessa" tone="bg-sky-300/80 text-sky-900" initial="J" />
                      <StaffRow t={t} name="Joshua" tone="bg-pink-300/80 text-pink-900" initial="J" />
                      <StaffRow t={t} name="Nicole" tone="bg-emerald-300/80 text-emerald-900" initial="N" />
                      <StaffRow t={t} name="Marcus" tone="bg-violet-300/80 text-violet-900" initial="M" />
                      <StaffRow t={t} name="Aaliyah" tone="bg-amber-300/80 text-amber-900" initial="A" />
                      <StaffRow t={t} name="Diego" tone="bg-rose-300/80 text-rose-900" initial="D" />
                      <StaffRow t={t} name="Sofia" tone="bg-teal-300/80 text-teal-900" initial="S" />
                      <StaffRow t={t} name="Tyrell" tone="bg-indigo-300/80 text-indigo-900" initial="T" />
                    </div>
                  </div>
                </div>
              </div>

              {/* Checklists */}
              <div className={`${t.card} rounded-2xl p-5 lg:p-6 mt-4`}>
                <div className="flex justify-between items-center mb-5">
                  <h3 className={`text-[11px] font-bold tracking-[0.2em] uppercase ${t.subtle}`}>Checklists</h3>
                  <span className={`${t.muted} text-xs`}>2 of 7 done</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
                  <ChecklistRow t={t} label="AM Line" right="16/19" pct={84} tone="amber" />
                  <ChecklistRow t={t} label="Shift Chg" right="13/22" pct={59} tone="amber" />
                  <ChecklistRow t={t} label="Deep Clean" right="done" pct={100} tone="emerald" done />
                  <ChecklistRow t={t} label="Opening" right="11/15" pct={73} tone="amber" />
                  <ChecklistRow t={t} label="PM Line" right="8/20" pct={40} tone="amber" />
                  <ChecklistRow t={t} label="Prep List" right="done" pct={100} tone="emerald" done />
                  <ChecklistRow t={t} label="Closing" right="5/18" pct={28} tone="amber" />
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Page 2: Punch Clock (PREVIEW MOCK ONLY — not applied to real punch clock) */}
        <section className="snap-center shrink-0 w-full h-full overflow-y-auto p-4 lg:p-10 pb-24">
          <div className="max-w-xl mx-auto h-full flex items-center justify-center">
            <div className={`w-full ${t.shellGradient} border ${t.border} rounded-3xl p-8 shadow-2xl`}>
              <div className={`flex items-center justify-between pb-5 border-b ${t.border}`}>
                <div>
                  <p className="text-amber-500 font-bold text-[11px] tracking-[0.2em] uppercase">Punch Clock</p>
                  <p className={`${t.text} text-lg font-medium mt-1`}>Tap in to start your shift</p>
                </div>
                <div className="flex items-start gap-4">
                  <ThemePill theme={theme} setTheme={setTheme} t={t} />
                  <div className="text-right">
                    <div className={`${t.text} text-3xl font-light tracking-tight tabular-nums`}>
                      10:34<span className={`${t.muted} text-base ml-1`}>PM</span>
                    </div>
                    <div className={`${t.muted} text-[11px] uppercase tracking-widest mt-1`}>Friday, Jun 5</div>
                  </div>
                </div>
              </div>

              <div className="flex flex-col items-center py-10">
                <button className="w-40 h-40 rounded-full bg-gradient-to-br from-amber-400 to-amber-600 shadow-[0_0_60px_-10px_rgba(245,158,11,0.6)] flex items-center justify-center hover:scale-105 transition-transform">
                  <Fingerprint className="w-16 h-16 text-amber-950" strokeWidth={1.5} />
                </button>
                <p className={`mt-6 ${t.text} text-sm`}>Enter your 4-digit PIN</p>
                <div className="flex gap-3 mt-3">
                  {[1,2,3,4].map(i => (
                    <div key={i} className={`w-3 h-3 rounded-full border ${t.border}`} />
                  ))}
                </div>
              </div>

              <div className={`${t.innerCard} rounded-2xl p-4 mt-2`}>
                <div className={`flex items-center gap-2 text-[11px] font-bold tracking-[0.2em] uppercase ${t.subtle} mb-3`}>
                  <Clock className="w-3.5 h-3.5" /> On the Clock
                </div>
                <div className="space-y-2.5">
                  <StaffRow t={t} name="Janessa · 4h 12m" tone="bg-sky-300/80 text-sky-900" initial="J" />
                  <StaffRow t={t} name="Joshua · 3h 48m" tone="bg-pink-300/80 text-pink-900" initial="J" />
                  <StaffRow t={t} name="Nicole · 2h 21m" tone="bg-emerald-300/80 text-emerald-900" initial="N" />
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>

      {/* Pagination + animated swipe hint */}
      <div className="absolute bottom-0 inset-x-0 pointer-events-none">
        <div className={`${t.fadeGradient} pt-10 pb-5`}>
          <div className="flex flex-col items-center gap-3 pointer-events-auto">
            <div className="flex items-center gap-3">
              <button
                onClick={() => goTo(0)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-semibold tracking-wider uppercase transition-all ${page === 0 ? "bg-amber-500/15 text-amber-500 ring-1 ring-amber-500/40" : `${t.muted} hover:${t.text}`}`}
              >
                <ChevronLeft className="w-3.5 h-3.5" /> Dashboard
              </button>
              <div className="flex items-center gap-2">
                {[0, 1].map((i) => (
                  <button
                    key={i}
                    onClick={() => goTo(i)}
                    className={`h-1.5 rounded-full transition-all ${page === i ? "w-8 bg-amber-500" : `w-1.5 ${t.dot}`}`}
                  />
                ))}
              </div>
              <button
                onClick={() => goTo(1)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-semibold tracking-wider uppercase transition-all ${page === 1 ? "bg-amber-500/15 text-amber-500 ring-1 ring-amber-500/40" : `${t.muted} hover:${t.text}`}`}
              >
                Punch Clock <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className={`text-[10px] uppercase tracking-[0.25em] ${t.muted} flex items-center gap-2 animate-pulse`}>
              {page === 0 ? (
                <>
                  <span>swipe for punch clock</span>
                  <ChevronRight className="w-3 h-3 animate-[slide-hint_1.4s_ease-in-out_infinite]" />
                </>
              ) : (
                <>
                  <ChevronLeft className="w-3 h-3 animate-[slide-hint-left_1.4s_ease-in-out_infinite]" />
                  <span>swipe for dashboard</span>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      <style>{`
        .no-scrollbar::-webkit-scrollbar { display: none; }
        @keyframes slide-hint { 0%,100% { transform: translateX(0); opacity: .5; } 50% { transform: translateX(4px); opacity: 1; } }
        @keyframes slide-hint-left { 0%,100% { transform: translateX(0); opacity: .5; } 50% { transform: translateX(-4px); opacity: 1; } }
      `}</style>
    </div>
  );
}

/* ---------- theme tokens ---------- */
function tokens(theme: Theme) {
  if (theme === "light") {
    return {
      appBg: "bg-[#f4f5f7]",
      appText: "text-slate-800",
      shell: "bg-white",
      shellGradient: "bg-gradient-to-b from-white to-[#f4f5f7]",
      card: "bg-[#f7f8fa]",
      innerCard: "bg-[#eef0f3]/70",
      border: "border-slate-200",
      text: "text-slate-900",
      subtle: "text-slate-500",
      muted: "text-slate-400",
      chip: "bg-slate-100 hover:bg-slate-200",
      dot: "bg-slate-300 hover:bg-slate-400",
      gridLine: "bg-slate-200",
      fadeGradient: "bg-gradient-to-t from-[#f4f5f7] via-[#f4f5f7]/80 to-transparent",
      projectedBar: "bg-amber-500/20 border border-amber-500/20",
    };
  }
  return {
    appBg: "bg-[#0a0a0f]",
    appText: "text-slate-200",
    shell: "bg-[#0f1117]",
    shellGradient: "bg-gradient-to-b from-[#141822] to-[#0f1117]",
    card: "bg-[#141822]",
    innerCard: "bg-[#0a0a0f]/50",
    border: "border-white/5",
    text: "text-white",
    subtle: "text-slate-400",
    muted: "text-slate-500",
    chip: "bg-white/5 hover:bg-white/10",
    dot: "bg-white/20 hover:bg-white/40",
    gridLine: "bg-white/5",
    fadeGradient: "bg-gradient-to-t from-[#0a0a0f] via-[#0a0a0f]/80 to-transparent",
    projectedBar: "bg-amber-500/15 border border-amber-500/10",
  };
}
type Tokens = ReturnType<typeof tokens>;

/* ---------- subcomponents ---------- */

function ThemePill({ theme, setTheme, t }: { theme: Theme; setTheme: (v: Theme) => void; t: Tokens }) {
  return (
    <div className={`inline-flex items-center rounded-full p-0.5 border ${t.border} ${t.chip}`}>
      <button
        onClick={() => setTheme("light")}
        className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-semibold uppercase tracking-wider transition-all ${theme === "light" ? "bg-amber-500 text-amber-950" : t.muted}`}
        aria-pressed={theme === "light"}
      >
        <Sun className="w-3 h-3" /> Light
      </button>
      <button
        onClick={() => setTheme("dark")}
        className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-semibold uppercase tracking-wider transition-all ${theme === "dark" ? "bg-amber-500 text-amber-950" : t.muted}`}
        aria-pressed={theme === "dark"}
      >
        <Moon className="w-3 h-3" /> Dark
      </button>
    </div>
  );
}

function KpiCard({ t, label, value, sub, accent = false }: { t: Tokens; label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div className={`${t.card} rounded-2xl p-5 ${accent ? "ring-1 ring-amber-500/40" : ""}`}>
      <p className={`text-[11px] font-bold tracking-[0.2em] uppercase ${t.subtle}`}>{label}</p>
      <p className={`mt-2 text-3xl lg:text-4xl font-bold ${accent ? "text-amber-500" : t.text}`}>{value}</p>
      {sub && <p className={`mt-1 text-xs ${accent ? "text-amber-500/80" : t.muted}`}>{sub}</p>}
    </div>
  );
}

function StaffRow({ t, name, initial, tone }: { t: Tokens; name: string; initial: string; tone: string }) {
  return (
    <div className="flex items-center gap-2.5 min-w-0">
      <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${tone}`}>
        {initial}
      </div>
      <span className={`${t.text} text-sm font-medium truncate`}>{name}</span>
    </div>
  );
}

function HourlyBars({ t }: { t: Tokens }) {
  const bars = [
    { hr: "2p", actual: 22, projected: 30 },
    { hr: "3p", actual: 38, projected: 42 },
    { hr: "4p", actual: 58, projected: 55 },
    { hr: "5p", actual: 92, projected: 80, peak: true },
    { hr: "6p", actual: 40, projected: 60 },
    { hr: "7p", actual: 36, projected: 52 },
    { hr: "8p", actual: 38, projected: 48 },
    { hr: "9p", actual: 34, projected: 42 },
  ];
  return (
    <div>
      <div className="h-48 flex items-end justify-between gap-3">
        {bars.map((b) => (
          <div key={b.hr} className="flex-1 h-full relative flex items-end">
            <div
              className={`absolute inset-x-0 bottom-0 rounded-md ${t.projectedBar}`}
              style={{ height: `${b.projected}%` }}
              aria-label="projected"
            />
            <div
              className={`relative w-full rounded-md ${b.peak ? "bg-amber-400" : "bg-amber-600/90"}`}
              style={{ height: `${b.actual}%` }}
            />
          </div>
        ))}
      </div>
      <div className={`flex justify-between mt-3 text-[11px] ${t.muted} font-medium`}>
        {bars.map((b) => (
          <span key={b.hr} className="flex-1 text-center">{b.hr}</span>
        ))}
      </div>
      <div className={`flex gap-4 mt-4 text-[10px] uppercase tracking-wider font-semibold ${t.muted}`}>
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-sm bg-amber-500" /> Actual
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-sm bg-amber-500/20 border border-amber-500/30" /> Projected
        </span>
      </div>
    </div>
  );
}

function ChecklistRow({
  t,
  label,
  right,
  pct,
  tone,
  done = false,
}: {
  t: Tokens;
  label: string;
  right: string;
  pct: number;
  tone: "amber" | "emerald";
  done?: boolean;
}) {
  const barClass = tone === "emerald" ? "bg-emerald-400" : "bg-amber-500";
  const rightClass = done ? "text-emerald-500" : "text-amber-500";
  return (
    <div>
      <div className="flex justify-between items-baseline mb-2">
        <span className={`${t.text} text-sm font-medium`}>{label}</span>
        <span className={`text-xs font-semibold ${rightClass}`}>{right}</span>
      </div>
      <div className={`h-1 w-full ${t.gridLine} rounded-full overflow-hidden`}>
        <div className={`h-full ${barClass} rounded-full`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
