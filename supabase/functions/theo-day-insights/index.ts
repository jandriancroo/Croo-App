// Theo's one-line daily coaching notes for the Time Tracking "By Day" view.
// POST { location_id, dates: ["yyyy-MM-dd", ...] } -> { insights: { [date]: string[] } }
// Finished days only (before today in the store's timezone). Results are cached in
// theo_day_insights; at most 2 notes per day, ranked by how much they matter.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { DateTime } from "https://esm.sh/luxon@3.4.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

type Fact = { kind: string; score: number; text: string };

const fmtHour = (h: number) => DateTime.fromObject({ hour: h % 24 }).toFormat("h a");
const toMin = (t: string) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  try {
    const { location_id, dates } = await req.json();
    if (!location_id || !Array.isArray(dates)) return json({ error: "location_id and dates required" }, 400);

    const url = Deno.env.get("SUPABASE_URL")!;
    const userClient = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    });
    // Access check: caller must be able to see this store.
    const { data: loc } = await userClient.from("locations").select("id").eq("id", location_id).maybeSingle();
    if (!loc) return json({ error: "forbidden" }, 403);

    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: ls } = await admin.from("location_settings").select("timezone").eq("location_id", location_id).maybeSingle();
    const tz = ls?.timezone || "America/Los_Angeles";
    const today = DateTime.now().setZone(tz).toFormat("yyyy-MM-dd");
    const wanted = [...new Set(dates.filter((d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d) && d < today))].slice(0, 16) as string[];
    if (!wanted.length) return json({ insights: {} });

    const { data: cached } = await admin.from("theo_day_insights").select("business_date, insights")
      .eq("location_id", location_id).in("business_date", wanted);
    const out: Record<string, string[]> = {};
    for (const r of cached ?? []) out[r.business_date] = r.insights as string[];
    const missing = wanted.filter((d) => !out[d]);

    for (const day of missing.slice(0, 7)) {
      const facts = await buildFacts(admin, location_id, day, tz);
      const top = facts.filter((f) => f.score > 0).sort((a, b) => b.score - a.score).slice(0, 2);
      const lines = top.length ? await phrase(top) : [];
      await admin.from("theo_day_insights").upsert({ location_id, business_date: day, insights: lines, generated_at: new Date().toISOString() });
      out[day] = lines;
    }
    return json({ insights: out });
  } catch (e) {
    console.error(e);
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
});

async function buildFacts(db: any, locationId: string, day: string, tz: string): Promise<Fact[]> {
  const start = DateTime.fromFormat(day, "yyyy-MM-dd", { zone: tz }).set({ hour: 4 });
  const end = start.plus({ days: 1 });
  const [{ data: punches }, { data: sales }, { data: sched }, { data: profiles }] = await Promise.all([
    db.from("time_punches").select("user_id, punch_type, punch_time, notes, break_type")
      .eq("location_id", locationId).gte("punch_time", start.toUTC().toISO()).lt("punch_time", end.toUTC().toISO()).order("punch_time"),
    db.from("sales_cache").select("net_sales, yoy_net_sales, hourly_data").eq("location_id", locationId).eq("sale_date", day).maybeSingle(),
    db.from("scheduled_shifts").select("user_id, start_time, end_time, is_time_off, is_phantom, schedules!inner(location_id)")
      .eq("schedules.location_id", locationId).eq("shift_date", day),
    db.from("profiles").select("id, full_name, nickname"),
  ]);
  const name = (id: string) => {
    const p = (profiles ?? []).find((x: any) => x.id === id);
    return (p?.nickname || p?.full_name || "Someone").split(" ")[0];
  };

  // Pair punches into on-clock intervals per person.
  type Iv = { s: DateTime; e: DateTime };
  const byUser = new Map<string, { ivs: Iv[]; meal: boolean; firstIn?: DateTime }>();
  const open = new Map<string, DateTime>();
  for (const p of punches ?? []) {
    const t = DateTime.fromISO(p.punch_time).setZone(tz);
    const u = byUser.get(p.user_id) ?? { ivs: [], meal: false };
    byUser.set(p.user_id, u);
    if (p.punch_type === "clock_in" || p.punch_type === "break_end") { open.set(p.user_id, t); if (p.punch_type === "clock_in" && !u.firstIn) u.firstIn = t; }
    if ((p.punch_type === "clock_out" || p.punch_type === "break_start") && open.has(p.user_id)) {
      u.ivs.push({ s: open.get(p.user_id)!, e: t }); open.delete(p.user_id);
    }
    if (p.punch_type === "break_start" && (p.notes?.includes("30 minute") || p.break_type === "meal")) u.meal = true;
  }
  const hrs = (ivs: Iv[]) => ivs.reduce((a, i) => a + i.e.diff(i.s, "minutes").minutes, 0) / 60;
  const facts: Fact[] = [];

  // Scheduled vs worked, early clock-ins.
  const shifts = (sched ?? []).filter((s: any) => !s.is_time_off && !s.is_phantom && s.start_time && s.end_time);
  let schedTotal = 0, workedTotal = 0; const over: { n: string; h: number }[] = []; const early: string[] = []; let earlyMin = 0;
  for (const s of shifts) { let m = toMin(s.end_time) - toMin(s.start_time); if (m < 0) m += 1440; schedTotal += m / 60; }
  for (const [uid, u] of byUser) {
    const w = hrs(u.ivs); workedTotal += w;
    const s = shifts.find((x: any) => x.user_id === uid);
    if (s) {
      let m = toMin(s.end_time) - toMin(s.start_time); if (m < 0) m += 1440;
      if (w - m / 60 > 0.75) over.push({ n: name(uid), h: w - m / 60 });
      if (u.firstIn) {
        const diff = toMin(s.start_time) - (u.firstIn.hour * 60 + u.firstIn.minute);
        if (diff >= 15 && diff < 240) { early.push(name(uid)); earlyMin += diff; }
      }
    }
    if (w > 5 && !u.meal) facts.push({ kind: "break", score: 0, text: name(uid) });
  }
  const noBreak = facts.splice(0).map((f) => f.text);
  if (noBreak.length) facts.push({ kind: "breaks", score: 15 * noBreak.length,
    text: `${noBreak.length} ${noBreak.length === 1 ? "person" : "people"} (${noBreak.join(", ")}) worked over 5 hours with no meal break. In California that owes each an extra hour of pay.` });
  const overBy = workedTotal - schedTotal;
  if (schedTotal > 0 && overBy > 1.5) {
    over.sort((a, b) => b.h - a.h);
    facts.push({ kind: "over", score: overBy * 6,
      text: `Worked ${overBy.toFixed(1)} hours more than scheduled (${schedTotal.toFixed(1)} scheduled, ${workedTotal.toFixed(1)} worked).${over[0] ? ` Biggest: ${over[0].n}, ${over[0].h.toFixed(1)}h past schedule.` : ""}` });
  }
  if (early.length >= 2) facts.push({ kind: "early", score: earlyMin / 8,
    text: `${early.length} people (${early.join(", ")}) clocked in 15+ minutes early, adding ${(earlyMin / 60).toFixed(1)} hours. Ask them to wait for their start time.` });

  // Slow hours: sales per labor hour by clock hour.
  const hourly: { hour: string; sales: number }[] = Array.isArray(sales?.hourly_data) ? sales.hourly_data : [];
  const net = Number(sales?.net_sales ?? 0);
  if (hourly.length && net > 0 && workedTotal > 0) {
    const rows = hourly.map((h) => {
      const hr = Number(h.hour.split(":")[0]);
      const hs = start.set({ hour: hr }).plus({ days: hr < 4 ? 1 : 0 }); const he = hs.plus({ hours: 1 });
      let people = 0;
      for (const [, u] of byUser) for (const iv of u.ivs) {
        const ov = Math.min(+iv.e, +he) - Math.max(+iv.s, +hs); if (ov > 0) people += ov / 3600000;
      }
      return { hr, sales: Number(h.sales) || 0, people };
    }).filter((r) => r.people > 0);
    // Ignore opening prep and closing clean-up: only hours between the first and last sale.
    // Only judge hours the store is open to customers (location_hours), else first..last sale.
    const dow0 = DateTime.fromFormat(day, "yyyy-MM-dd", { zone: tz }).weekday % 7; // 0 = Sunday
    const { data: lh } = await db.from("location_hours").select("open_time, close_time, is_closed")
      .eq("location_id", locationId).eq("day_of_week", dow0).maybeSingle();
    const sold = rows.filter((r) => r.sales > 0);
    let openMin = sold.length ? sold[0].hr * 60 : 0;
    let closeMin = sold.length ? (sold[sold.length - 1].hr + 1) * 60 : 0;
    if (lh && !lh.is_closed && lh.open_time && lh.close_time) {
      openMin = toMin(lh.open_time); closeMin = toMin(lh.close_time); if (closeMin <= openMin) closeMin += 1440;
    }
    const norm = (hr: number) => (hr < 4 ? hr + 24 : hr) * 60;
    const open_ = (hr: number) => norm(hr) >= openMin && norm(hr) + 60 <= closeMin;
    const daySplh = net / workedTotal;
    let best: { hr: number; sales: number; people: number } | null = null;
    for (let i = 0; i + 1 < rows.length; i++) {
      const a = rows[i], b = rows[i + 1]; if (b.hr !== (a.hr + 1) % 24 || !open_(a.hr) || !open_(b.hr)) continue;
      const people = a.people + b.people, s = a.sales + b.sales;
      if (people / 2 < 2.5) continue;
      const splh = s / people;
      if (splh < daySplh * 0.45 && (!best || splh < best.sales / best.people)) best = { hr: a.hr, sales: s, people };
    }
    if (best) {
      const extra = best.people - Math.max(2 * 2, best.sales / daySplh);
      facts.push({ kind: "slow", score: Math.max(extra, 1) * 9,
        text: `From ${fmtHour(best.hr)} to ${fmtHour(best.hr + 2)} sales were only $${best.sales.toFixed(0)} with about ${(best.people / 2).toFixed(1)} people on the clock. Try cutting one person in that window.` });
    }
  }

  // Overtime risk this week (Mon-start workweek approximation).
  const weekStart = DateTime.fromFormat(day, "yyyy-MM-dd", { zone: tz }).startOf("week").set({ hour: 4 });
  const dow = DateTime.fromFormat(day, "yyyy-MM-dd", { zone: tz }).weekday;
  if (dow < 7) {
    const { data: wk } = await db.from("time_punches").select("user_id, punch_type, punch_time")
      .eq("location_id", locationId).gte("punch_time", weekStart.toUTC().toISO()).lt("punch_time", end.toUTC().toISO()).order("punch_time");
    const tot = new Map<string, number>(); const o = new Map<string, number>();
    for (const p of wk ?? []) {
      const t = +new Date(p.punch_time);
      if (p.punch_type === "clock_in" || p.punch_type === "break_end") o.set(p.user_id, t);
      else if (o.has(p.user_id)) { tot.set(p.user_id, (tot.get(p.user_id) ?? 0) + (t - o.get(p.user_id)!) / 3600000); o.delete(p.user_id); }
    }
    const risk = [...tot.entries()].filter(([, h]) => h >= 34 && h < 40).sort((a, b) => b[1] - a[1]);
    if (risk.length) facts.push({ kind: "ot", score: 12 + risk.length * 2,
      text: `${name(risk[0][0])} is at ${risk[0][1].toFixed(1)} hours this week with ${7 - dow} day${7 - dow === 1 ? "" : "s"} left. Watch for overtime.` });
  }

  // Positive note when nothing else stands out.
  const yoy = Number(sales?.yoy_net_sales ?? 0);
  if (yoy > 0 && net > yoy * 1.1 && workedTotal > 0) facts.push({ kind: "win", score: 3,
    text: `Sales beat the same day last year by ${Math.round((net / yoy - 1) * 100)}% ($${net.toFixed(0)} vs $${yoy.toFixed(0)}) on ${workedTotal.toFixed(1)} labor hours. Nice day.` });
  return facts;
}

async function phrase(facts: Fact[]): Promise<string[]> {
  const key = Deno.env.get("LOVABLE_API_KEY");
  const fallback = facts.map((f) => f.text);
  if (!key) return fallback;
  try {
    const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: "You are Theo, a sharp, friendly restaurant GM coaching a store manager. Rewrite each fact as ONE short sentence (max 30 words), plain words, keep every number and name exactly, end with a concrete action when one fits. Return JSON {\"lines\": string[]} in the same order." },
          { role: "user", content: JSON.stringify(fallback) },
        ],
      }),
    });
    if (!r.ok) return fallback;
    const j = await r.json();
    const lines = JSON.parse(j.choices?.[0]?.message?.content ?? "{}").lines;
    return Array.isArray(lines) && lines.length === fallback.length ? lines.map(String) : fallback;
  } catch { return fallback; }
}
