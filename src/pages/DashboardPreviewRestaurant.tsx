// "Restaurant-first" service mode preview (LOOK 3).
// Static visual showcase — view at /dashboard-preview-restaurant.
// Projected sales render as muted shaded bars behind the actual sales bars.

export default function DashboardPreviewRestaurant() {
  return (
    <div className="min-h-screen w-full bg-[#0a0a0f] text-slate-200 p-4 lg:p-10 font-sans">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-baseline gap-3 mb-4 px-1">
          <span className="text-amber-500 font-bold text-xs tracking-widest uppercase">Look 3</span>
          <h1 className="text-white text-lg lg:text-xl font-medium">Service mode — restaurant-first</h1>
        </div>

        <div className="bg-[#0f1117] border border-white/5 rounded-3xl p-6 lg:p-8 shadow-2xl">
          {/* Header */}
          <div className="pb-5 border-b border-white/5">
            <p className="text-amber-500 font-bold text-[11px] tracking-[0.2em] uppercase">Friday Dinner</p>
            <p className="mt-2 text-white text-xl lg:text-2xl font-medium">
              <span className="text-slate-400">8 hours in · projecting </span>
              <span className="text-white font-semibold">$439 short</span>
              <span className="text-slate-400"> of EOD goal</span>
            </p>
          </div>

          {/* KPIs */}
          <div className="grid grid-cols-3 gap-4 mt-6">
            <KpiCard label="Total Sales" value="$3,795" />
            <KpiCard label="EOD Goal" value="$4,234" />
            <KpiCard label="Pace" value="90%" accent />
          </div>

          {/* Middle row: hourly + labor/line */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-4">
            <div className="lg:col-span-2 bg-[#141822] rounded-2xl p-5 lg:p-6">
              <div className="flex justify-between items-baseline mb-6">
                <h3 className="text-[11px] font-bold tracking-[0.2em] uppercase text-slate-400">Hourly Sales</h3>
                <span className="text-amber-500 text-xs font-medium">peak at 5pm</span>
              </div>
              <HourlyBars />
            </div>

            <div className="flex flex-col gap-4">
              <div className="bg-[#141822] rounded-2xl p-5">
                <h3 className="text-[11px] font-bold tracking-[0.2em] uppercase text-slate-400">Labor</h3>
                <div className="flex items-baseline gap-2 mt-2">
                  <span className="text-emerald-400 text-3xl font-bold">22.9%</span>
                  <span className="text-emerald-400/70 text-xs">on target</span>
                </div>
                <p className="text-slate-500 text-xs mt-1">$870 · 40.1h</p>
              </div>
              <div className="bg-[#141822] rounded-2xl p-5 flex-1">
                <h3 className="text-[11px] font-bold tracking-[0.2em] uppercase text-slate-400">On The Line</h3>
                <div className="flex gap-2 mt-3">
                  <Avatar initial="J" tone="bg-sky-300/80 text-sky-900" />
                  <Avatar initial="J" tone="bg-pink-300/80 text-pink-900" />
                  <Avatar initial="N" tone="bg-emerald-300/80 text-emerald-900" />
                </div>
              </div>
            </div>
          </div>

          {/* Checklists */}
          <div className="bg-[#141822] rounded-2xl p-5 lg:p-6 mt-4">
            <div className="flex justify-between items-center mb-5">
              <h3 className="text-[11px] font-bold tracking-[0.2em] uppercase text-slate-400">Checklists</h3>
              <span className="text-slate-500 text-xs">1 of 4 done</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
              <ChecklistRow label="AM Line" right="16/19" pct={84} tone="amber" />
              <ChecklistRow label="Shift Chg" right="13/22" pct={59} tone="amber" />
              <ChecklistRow label="Deep Clean" right="done" pct={100} tone="emerald" done />
              <ChecklistRow label="Opening" right="11/15" pct={73} tone="amber" />
            </div>
          </div>
        </div>

        <div className="text-center text-slate-600 text-[10px] uppercase tracking-[0.25em] mt-6">
          Design preview · Restaurant-first service mode
        </div>
      </div>
    </div>
  );
}

/* ---------- subcomponents ---------- */

function KpiCard({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={`bg-[#141822] rounded-2xl p-5 ${accent ? "ring-1 ring-amber-500/40" : ""}`}>
      <p className="text-[11px] font-bold tracking-[0.2em] uppercase text-slate-400">{label}</p>
      <p className={`mt-2 text-3xl lg:text-4xl font-bold ${accent ? "text-amber-500" : "text-white"}`}>{value}</p>
    </div>
  );
}

function Avatar({ initial, tone }: { initial: string; tone: string }) {
  return (
    <div className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold ${tone}`}>
      {initial}
    </div>
  );
}

function HourlyBars() {
  // actual (height %) and projected (shaded baseline %) per hour
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
            {/* projected shaded bar (behind) */}
            <div
              className="absolute inset-x-0 bottom-0 rounded-md bg-amber-500/15 border border-amber-500/10"
              style={{ height: `${b.projected}%` }}
              aria-label="projected"
            />
            {/* actual bar (front) */}
            <div
              className={`relative w-full rounded-md ${
                b.peak ? "bg-amber-400" : "bg-amber-600/90"
              }`}
              style={{ height: `${b.actual}%` }}
            />
          </div>
        ))}
      </div>
      <div className="flex justify-between mt-3 text-[11px] text-slate-500 font-medium">
        {bars.map((b) => (
          <span key={b.hr} className="flex-1 text-center">{b.hr}</span>
        ))}
      </div>
      <div className="flex gap-4 mt-4 text-[10px] uppercase tracking-wider font-semibold text-slate-500">
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
  label,
  right,
  pct,
  tone,
  done = false,
}: {
  label: string;
  right: string;
  pct: number;
  tone: "amber" | "emerald";
  done?: boolean;
}) {
  const barClass = tone === "emerald" ? "bg-emerald-400" : "bg-amber-500";
  const rightClass = done ? "text-emerald-400" : "text-amber-500";
  return (
    <div>
      <div className="flex justify-between items-baseline mb-2">
        <span className="text-white text-sm font-medium">{label}</span>
        <span className={`text-xs font-semibold ${rightClass}`}>{right}</span>
      </div>
      <div className="h-1 w-full bg-white/5 rounded-full overflow-hidden">
        <div className={`h-full ${barClass} rounded-full`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
