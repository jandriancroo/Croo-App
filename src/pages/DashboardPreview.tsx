// Static visual preview of the redesigned manager dashboard ("Obsidian Aurora").
// Showcase only — no live data wiring. View at /dashboard-preview.
import { Scissors, ArrowLeftRight, Sun } from "lucide-react";

export default function DashboardPreview() {
  return (
    <div className="min-h-screen w-full bg-[#050507] flex items-start lg:items-center justify-center p-4 lg:p-10 font-sans text-slate-200 overflow-x-hidden relative">
      {/* Ambient aurora glows */}
      <div className="pointer-events-none absolute top-[-10%] left-[-10%] w-[45%] h-[45%] bg-emerald-500/10 blur-[140px] rounded-full" />
      <div className="pointer-events-none absolute bottom-[-15%] right-[-10%] w-[45%] h-[45%] bg-blue-600/10 blur-[140px] rounded-full" />
      <div className="pointer-events-none absolute top-[40%] left-[40%] w-[25%] h-[25%] bg-cyan-500/5 blur-[100px] rounded-full" />

      <div className="relative w-full max-w-7xl grid grid-cols-12 gap-6">
        {/* LEFT — KPIs + Hourly Sales */}
        <div className="col-span-12 lg:col-span-4 flex flex-col gap-6">
          <div className="grid grid-cols-3 gap-3">
            <KpiPill label="Sales" value="$3,795" tone="emerald" />
            <KpiPill label="Goal" value="$4,234" tone="blue" />
            <KpiPill label="Pace" value="$3,795" tone="rose" pulse />
          </div>

          <div className="flex-1 bg-white/[0.03] backdrop-blur-2xl border border-white/10 rounded-[2.5rem] p-6 lg:p-8 relative overflow-hidden">
            <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-400/30 to-transparent" />
            <div className="flex justify-between items-end mb-6">
              <div>
                <h3 className="text-sm font-medium text-slate-300">Hourly Sales</h3>
                <p className="text-xs text-slate-500 mt-1">Peak performance at 5:00 PM</p>
              </div>
              <div className="flex gap-4">
                <Legend dotClass="bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.6)]" label="Actual" />
                <Legend dotClass="bg-slate-500" label="Projected" muted />
              </div>
            </div>

            <HourlyBars />

            <div className="flex justify-between mt-4 text-[10px] font-bold text-slate-600 uppercase tracking-widest">
              <span>2pm</span><span>4pm</span><span>6pm</span><span>8pm</span><span>10pm</span>
            </div>
          </div>
        </div>

        {/* CENTER — Clock + Labor + Swap */}
        <div className="col-span-12 lg:col-span-4 flex flex-col gap-6">
          <div className="bg-white/[0.04] backdrop-blur-3xl border border-white/10 rounded-[2.5rem] p-10 flex flex-col items-center justify-center text-center shadow-2xl relative overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-b from-white/[0.04] via-transparent to-cyan-500/[0.03] pointer-events-none" />
            <div className="text-[10px] uppercase tracking-[0.3em] text-slate-500 font-semibold mb-3 relative">
              Current Status
            </div>
            <div className="text-7xl lg:text-8xl font-light tracking-tighter text-white flex items-baseline relative">
              10:34
              <span className="text-2xl font-medium ml-2 text-slate-400 tracking-normal">PM</span>
            </div>
            <div className="mt-4 flex items-center gap-2 text-slate-400 font-medium tracking-wide relative">
              Friday, June 5
              <Sun className="w-4 h-4 text-amber-400" />
            </div>
          </div>

          <div className="bg-white/[0.03] border border-white/10 rounded-[2.5rem] p-6 lg:p-8 flex-1 flex flex-col">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-xs font-bold uppercase tracking-widest text-slate-500">Labor Efficiency</h3>
              <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.7)]" />
                <span className="text-emerald-400 text-[10px] font-bold uppercase tracking-wider">On Target</span>
              </span>
            </div>

            <div className="flex items-center justify-center my-2">
              <div className="relative w-40 h-40">
                <svg viewBox="0 0 160 160" className="w-full h-full -rotate-90">
                  <defs>
                    <linearGradient id="laborRing" x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" stopColor="#34d399" />
                      <stop offset="100%" stopColor="#06b6d4" />
                    </linearGradient>
                  </defs>
                  <circle cx="80" cy="80" r="70" stroke="rgba(255,255,255,0.06)" strokeWidth="12" fill="transparent" />
                  <circle
                    cx="80" cy="80" r="70"
                    stroke="url(#laborRing)"
                    strokeWidth="12"
                    fill="transparent"
                    strokeLinecap="round"
                    strokeDasharray="440"
                    strokeDashoffset="339"
                    style={{ filter: "drop-shadow(0 0 8px rgba(52,211,153,0.45))" }}
                  />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-4xl font-bold tracking-tight text-white">22.9%</span>
                  <span className="text-[10px] text-slate-500 uppercase font-bold mt-0.5">of 25% target</span>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 mt-auto">
              <MiniStat label="Labor Cost" value="$870" />
              <MiniStat label="Total Hours" value="40.1" />
            </div>
          </div>

          <div className="flex justify-center">
            <button className="w-14 h-14 bg-cyan-500 text-slate-900 rounded-full flex items-center justify-center shadow-[0_0_30px_rgba(6,182,212,0.45)] hover:scale-110 active:scale-95 transition-transform">
              <ArrowLeftRight className="w-5 h-5" strokeWidth={2.5} />
            </button>
          </div>
        </div>

        {/* RIGHT — Staff + Tasks */}
        <div className="col-span-12 lg:col-span-4 flex flex-col gap-6">
          <div className="bg-white/[0.03] border border-white/10 rounded-[2.5rem] p-6 flex flex-col">
            <div className="flex justify-between items-center mb-5">
              <h3 className="text-xs font-bold uppercase tracking-widest text-slate-500">On The Clock</h3>
              <span className="bg-cyan-500/15 text-cyan-400 text-[10px] px-2.5 py-1 rounded-full font-bold border border-cyan-500/20">
                3 ACTIVE
              </span>
            </div>
            <div className="space-y-2.5">
              <StaffRow name="Janessa" shift="5:00 PM — 11:00 PM" initial="J" gradient="from-indigo-500 to-purple-600" />
              <StaffRow name="Joshua" shift="3:30 PM — 11:00 PM" initial="J" gradient="from-amber-500 to-orange-600" />
              <StaffRow name="Nicole" shift="4:00 PM — 11:00 PM" initial="N" gradient="from-rose-500 to-pink-600" />
            </div>
          </div>

          <div className="bg-white/[0.03] backdrop-blur-md border border-white/10 rounded-[2.5rem] p-6 flex flex-col flex-1">
            <div className="flex justify-between items-center mb-5">
              <h3 className="text-xs font-bold uppercase tracking-widest text-slate-500">Daily Operations</h3>
              <span className="text-slate-600 text-[10px] font-bold">4 TASKS</span>
            </div>

            <div className="space-y-4 flex-1">
              <TaskBar label="AM Line Check" right="16/19" pct={84} tone="amber" />
              <TaskBar label="Shift Change Line Check" right="13/22" pct={59} tone="amber" />
              <TaskBar label="Daily Deep Cleaning" right="Done" pct={100} tone="emerald" done />
              <TaskBar label="Opening Checklist" right="11/15" pct={73} tone="slate" />
            </div>

            <button className="mt-6 w-full bg-white text-slate-900 py-3.5 rounded-2xl font-bold text-xs uppercase tracking-widest hover:bg-slate-200 transition-colors shadow-xl shadow-white/5">
              Manage Team Tasks
            </button>
          </div>
        </div>
      </div>

      {/* Preview ribbon */}
      <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 px-4 py-1.5 rounded-full bg-white/5 backdrop-blur border border-white/10 text-[10px] uppercase tracking-[0.25em] text-slate-400 font-semibold">
        Design Preview — Obsidian Aurora
      </div>
    </div>
  );
}

/* ---------- subcomponents ---------- */

function KpiPill({ label, value, tone, pulse = false }: { label: string; value: string; tone: "emerald" | "blue" | "rose"; pulse?: boolean }) {
  const toneMap = {
    emerald: "text-emerald-400",
    blue: "text-blue-400",
    rose: "text-rose-400",
  } as const;
  return (
    <div className="bg-white/5 backdrop-blur-md border border-white/10 p-4 rounded-3xl flex flex-col items-center justify-center text-center relative overflow-hidden">
      {pulse && (
        <div className="absolute top-2 right-2 w-2 h-2 bg-rose-500 rounded-full shadow-[0_0_8px_rgba(244,63,94,0.7)] animate-pulse" />
      )}
      <span className={`text-[10px] uppercase tracking-widest font-bold mb-1.5 ${toneMap[tone]}`}>{label}</span>
      <span className="text-xl font-bold text-white">{value}</span>
    </div>
  );
}

function Legend({ dotClass, label, muted = false }: { dotClass: string; label: string; muted?: boolean }) {
  return (
    <div className={`flex items-center gap-1.5 text-[10px] uppercase tracking-wider font-semibold ${muted ? "opacity-40" : ""}`}>
      <span className={`w-2 h-2 rounded-full ${dotClass}`} />
      {label}
    </div>
  );
}

function HourlyBars() {
  const bars = [
    { h: 40, intensity: 20 },
    { h: 55, intensity: 30 },
    { h: 65, intensity: 40 },
    { h: 85, intensity: 100, peak: true, label: "5PM: $627" },
    { h: 60, intensity: 40 },
    { h: 50, intensity: 30 },
    { h: 55, intensity: 20 },
  ];
  return (
    <div className="h-56 flex items-end justify-between gap-2">
      {bars.map((b, i) => (
        <div key={i} className="w-full relative group" style={{ height: `${b.h}%` }}>
          <div
            className={`absolute inset-0 rounded-t-lg transition-all ${
              b.peak
                ? "bg-gradient-to-t from-cyan-500 to-cyan-300 shadow-[0_0_22px_rgba(34,211,238,0.35)]"
                : `bg-cyan-500/${b.intensity} group-hover:bg-cyan-400/60`
            }`}
          />
          {b.peak && (
            <div className="absolute -top-9 left-1/2 -translate-x-1/2 bg-white text-slate-900 text-[10px] px-2 py-1 rounded-md font-bold whitespace-nowrap shadow-lg">
              {b.label}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white/5 rounded-2xl p-4 border border-white/5">
      <p className="text-[10px] text-slate-500 uppercase font-bold mb-1 tracking-wider">{label}</p>
      <p className="text-xl font-bold text-white">{value}</p>
    </div>
  );
}

function StaffRow({ name, shift, initial, gradient }: { name: string; shift: string; initial: string; gradient: string }) {
  return (
    <div className="group flex items-center justify-between p-3 rounded-2xl bg-white/[0.04] hover:bg-white/[0.08] transition-colors cursor-pointer border border-transparent hover:border-white/10">
      <div className="flex items-center gap-3">
        <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${gradient} flex items-center justify-center font-bold text-sm text-white ring-2 ring-white/5 shadow-lg`}>
          {initial}
        </div>
        <div>
          <p className="text-sm font-semibold text-white">{name}</p>
          <p className="text-[10px] text-slate-500">{shift}</p>
        </div>
      </div>
      <Scissors className="w-4 h-4 text-slate-600 opacity-0 group-hover:opacity-100 transition-opacity" />
    </div>
  );
}

function TaskBar({ label, right, pct, tone, done = false }: { label: string; right: string; pct: number; tone: "amber" | "emerald" | "slate"; done?: boolean }) {
  const toneStyles = {
    amber: { dot: "bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.6)]", bar: "bg-amber-400 shadow-[0_0_10px_rgba(251,191,36,0.3)]", right: "text-slate-500" },
    emerald: { dot: "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)]", bar: "bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.3)]", right: "text-emerald-400 font-bold uppercase text-[9px]" },
    slate: { dot: "bg-slate-500", bar: "bg-slate-500", right: "text-slate-500" },
  } as const;
  const s = toneStyles[tone];
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between text-[11px] font-medium px-1">
        <span className={`flex items-center gap-2 ${done ? "text-slate-500 line-through" : "text-slate-200"}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
          {label}
        </span>
        <span className={s.right}>{right}</span>
      </div>
      <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden">
        <div className={`h-full ${s.bar} rounded-full transition-all`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
