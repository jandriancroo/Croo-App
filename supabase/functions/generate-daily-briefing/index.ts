import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireInternalCaller } from "../_shared/callerAuth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

const AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Cron / service-to-service only.
  {
    const denied = requireInternalCaller(req, corsHeaders);
    if (denied) return denied;
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const lovableApiKey = Deno.env.get("LOVABLE_API_KEY");
    const supabase = createClient(supabaseUrl, supabaseKey);

    if (!lovableApiKey) {
      return new Response(JSON.stringify({ error: "LOVABLE_API_KEY not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get today in PST as a real yyyy-mm-dd (avoid the toLocaleString -> new Date roundtrip
    // which silently shifts the date back into UTC).
    const pstParts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Los_Angeles",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date());
    const y = pstParts.find((p) => p.type === "year")!.value;
    const m = pstParts.find((p) => p.type === "month")!.value;
    const d = pstParts.find((p) => p.type === "day")!.value;
    const today = `${y}-${m}-${d}`;
    // Compute yesterday off the PST calendar date (use UTC math on the date-only value
    // to dodge DST landmines).
    const yest = new Date(`${today}T12:00:00Z`);
    yest.setUTCDate(yest.getUTCDate() - 1);
    const yesterdayStr = yest.toISOString().slice(0, 10);
    // Re-derive a "now in PST" Date for weekday formatting only.
    const nowPST = new Date();
    // Yesterday's day-of-week in PST (0=Sun..6=Sat)
    const yesterdayWeekday = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "America/Los_Angeles" }).format(yest);
    const weekdayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    const yesterdayDow = weekdayMap[yesterdayWeekday] ?? 0;
    // 7 days back for streaks
    const sevenDaysAgo = new Date(`${today}T12:00:00Z`);
    sevenDaysAgo.setUTCDate(sevenDaysAgo.getUTCDate() - 7);
    const sevenDaysAgoStr = sevenDaysAgo.toISOString().slice(0, 10);

    // Optional body: { force?: boolean, locationId?: string }
    let body: any = {};
    try { body = await req.json(); } catch (_) {}
    const force = body?.force === true;
    const locationId = body?.locationId as string | undefined;

    // Get all active locations
    let locQuery = supabase.from("locations").select("id, name").eq("is_active", true);
    if (locationId) locQuery = locQuery.eq("id", locationId);
    const { data: locations, error: locErr } = await locQuery;

    if (locErr || !locations?.length) {
      return new Response(JSON.stringify({ error: "No locations", detail: locErr?.message }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const results: any[] = [];

    for (const loc of locations) {
      try {
        // Skip if briefing already exists for today (unless force)
        if (!force) {
          const { data: existing } = await supabase
            .from("croo_ai_briefings")
            .select("id")
            .eq("location_id", loc.id)
            .eq("briefing_date", today)
            .maybeSingle();

          if (existing) {
            results.push({ location: loc.name, status: "exists" });
            continue;
          }
        } else {
          await supabase
            .from("croo_ai_briefings")
            .delete()
            .eq("location_id", loc.id)
            .eq("briefing_date", today);
        }


        // Resolve schedule(s) covering today for this location so we can pull shifts.
        const { data: locSchedules } = await supabase
          .from("schedules")
          .select("id")
          .eq("location_id", loc.id)
          .lte("week_start_date", today)
          .gte("week_end_date", today);
        const scheduleIds = (locSchedules || []).map((s: any) => s.id);

        // Resolve schedule(s) covering yesterday for variance lookups
        const { data: yestSchedules } = await supabase
          .from("schedules")
          .select("id")
          .eq("location_id", loc.id)
          .lte("week_start_date", yesterdayStr)
          .gte("week_end_date", yesterdayStr);
        const yestScheduleIds = (yestSchedules || []).map((s: any) => s.id);

        // Gather data for the briefing
        const [laborInsight, salesData, todaySchedule, pendingRequests, cateringOrders, businessHours, tempAlerts, weeklySubmissions, yesterdayShifts] = await Promise.all([
          supabase
            .from("labor_insights")
            .select("analysis")
            .eq("location_id", loc.id)
            .eq("insight_date", yesterdayStr)
            .maybeSingle(),
          supabase
            .from("sales_cache")
            .select("net_sales, guest_count")
            .eq("location_id", loc.id)
            .eq("sale_date", yesterdayStr)
            .maybeSingle(),
          scheduleIds.length
            ? supabase
                .from("scheduled_shifts")
                .select("id, start_time, end_time, user_id, shift_date")
                .in("schedule_id", scheduleIds)
                .eq("shift_date", today)
                .eq("is_time_off", false)
                .order("start_time")
            : Promise.resolve({ data: [] as any[] }),
          supabase
            .from("availability_requests")
            .select("id, start_date, request_type, user_id")
            .eq("location_id", loc.id)
            .eq("status", "pending")
            .limit(10),
          supabase
            .from("catering_orders")
            .select("customer_name, pickup_date, pickup_time, total_price, headcount")
            .eq("location_id", loc.id)
            .gte("pickup_date", today)
            .lte("pickup_date", today)
            .eq("status", "pending"),
          supabase
            .from("location_hours")
            .select("open_time, close_time")
            .eq("location_id", loc.id)
            .eq("day_of_week", yesterdayDow)
            .maybeSingle(),
          supabase
            .from("checklist_responses")
            .select("extracted_temperature, temperature_valid, item:checklist_items(question), submission:checklist_submissions!inner(location_id, submitted_at)")
            .eq("submission.location_id", loc.id)
            .gte("submission.submitted_at", `${yesterdayStr}T00:00:00`)
            .lt("submission.submitted_at", `${today}T00:00:00`)
            .not("extracted_temperature", "is", null),
          supabase
            .from("checklist_submissions")
            .select("submitted_by")
            .eq("location_id", loc.id)
            .gte("submitted_at", `${sevenDaysAgoStr}T00:00:00`)
            .lt("submitted_at", `${today}T00:00:00`),
          yestScheduleIds.length
            ? supabase
                .from("scheduled_shifts")
                .select("id, start_time, end_time, user_id, shift_date")
                .in("schedule_id", yestScheduleIds)
                .eq("shift_date", yesterdayStr)
                .eq("is_time_off", false)
            : Promise.resolve({ data: [] as any[] }),
        ]);

        // Compute top line check submitter (last 7 days)
        const submitCounts: Record<string, number> = {};
        for (const sub of (weeklySubmissions.data || [])) {
          if (sub.submitted_by) submitCounts[sub.submitted_by] = (submitCounts[sub.submitted_by] || 0) + 1;
        }
        let topSubmitterId: string | null = null;
        let topSubmitterCount = 0;
        for (const [uid, count] of Object.entries(submitCounts)) {
          if (count > topSubmitterCount) { topSubmitterId = uid; topSubmitterCount = count; }
        }

        // Fetch yesterday's clock_out punches for variance analysis
        const yShiftUserIds = (yesterdayShifts.data || []).map((s: any) => s.user_id).filter(Boolean);
        let yPunches: any[] = [];
        if (yShiftUserIds.length) {
          const { data: pData } = await supabase
            .from("time_punches")
            .select("user_id, shift_id, punch_type, punch_time")
            .eq("location_id", loc.id)
            .in("user_id", yShiftUserIds)
            .eq("punch_type", "clock_out")
            .gte("punch_time", `${yesterdayStr}T00:00:00`)
            .lt("punch_time", `${today}T12:00:00`);
          yPunches = pData || [];
        }

        // Get profile names — combine today's schedule, yesterday's shift users, and top submitter
        const allUserIds = [...new Set([
          ...(todaySchedule.data || []).map((s: any) => s.user_id),
          ...yShiftUserIds,
          ...(topSubmitterId ? [topSubmitterId] : []),
        ].filter(Boolean))];
        let profileMap: Record<string, string> = {};
        if (allUserIds.length > 0) {
          const { data: profiles } = await supabase
            .from("profiles")
            .select("id, full_name")
            .in("id", allUserIds);
          if (profiles) {
            for (const p of profiles) {
              profileMap[p.id] = p.full_name || "Unknown";
            }
          }
        }

        // Build context for AI
        const context: string[] = [];
        context.push(`Location: ${loc.name}`);
        context.push(`Today: ${today} (${new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: "America/Los_Angeles" }).format(nowPST)})`);

        if (salesData.data) {
          const s = salesData.data;
          context.push(`Yesterday's Sales: $${Math.round(s.net_sales || 0).toLocaleString()}, ${s.guest_count || 0} guests`);
        } else {
          context.push(`Yesterday's Sales: DATA UNAVAILABLE`);
        }

        if (laborInsight.data?.analysis) {
          const a = laborInsight.data.analysis as any;
          if (a.summary) {
            context.push(`Labor Grade: ${a.summary.overallGrade} — ${a.summary.headline}`);
            context.push(`Labor %: ${a.summary.laborPercent}%, Savings Opportunity: $${Math.round(a.summary.totalSavingsOpportunity || 0)}`);
          } else {
            context.push(`Labor Grade: DATA UNAVAILABLE`);
          }
          if (a.keyFindings?.length) {
            context.push(`Key Findings: ${a.keyFindings.slice(0, 3).map((f: any) => `[${f.severity}] ${f.title}: ${f.detail}`).join(" | ")}`);
          } else {
            context.push(`Key Findings: DATA UNAVAILABLE`);
          }
          if (a.todaySuggestions?.length) {
            context.push(`AI Suggestions: ${a.todaySuggestions.map((s: any) => s.suggestion).join(" | ")}`);
          } else {
            context.push(`AI Suggestions: DATA UNAVAILABLE`);
          }
        } else {
          context.push(`Labor Grade: DATA UNAVAILABLE`);
          context.push(`Key Findings: DATA UNAVAILABLE`);
          context.push(`AI Suggestions: DATA UNAVAILABLE`);
        }

        if (todaySchedule.data?.length) {
          const names = todaySchedule.data
            .map((s: any) => {
              const name = profileMap[s.user_id] || "Unknown";
              // start_time is a TIME (HH:MM:SS) string, not a timestamp.
              const [hStr, mStr] = String(s.start_time || "00:00").split(":");
              const h = parseInt(hStr, 10);
              const m = parseInt(mStr, 10);
              const period = h >= 12 ? "PM" : "AM";
              const h12 = ((h + 11) % 12) + 1;
              const start = `${h12}:${String(m).padStart(2, "0")} ${period}`;
              return `${name.split(" ")[0]} (${start})`;
            })
            .slice(0, 15);
          context.push(`Today's Schedule (${todaySchedule.data.length} shifts): ${names.join(", ")}`);
        } else {
          context.push(`Today's Schedule: NO SHIFTS POSTED`);
        }

        if (pendingRequests.data?.length) {
          context.push(`Pending Time-Off Requests: ${pendingRequests.data.length}`);
        } else {
          context.push(`Pending Time-Off Requests: 0`);
        }

        if (cateringOrders.data?.length) {
          context.push(`Today's Catering: ${cateringOrders.data.map((c: any) => `${c.customer_name} at ${c.pickup_time} ($${c.total_price || 0})`).join(", ")}`);
        } else {
          context.push(`Today's Catering: NONE SCHEDULED`);
        }

        // Business Hours Yesterday
        const fmtTime = (t: string | null | undefined) => {
          if (!t) return null;
          const [hStr, mStr] = String(t).split(":");
          const h = parseInt(hStr, 10);
          const m = parseInt(mStr, 10);
          const period = h >= 12 ? "PM" : "AM";
          const h12 = ((h + 11) % 12) + 1;
          return `${h12}:${String(m).padStart(2, "0")} ${period}`;
        };
        if (businessHours.data?.open_time && businessHours.data?.close_time) {
          context.push(`Business Hours Yesterday: ${fmtTime(businessHours.data.open_time)} to ${fmtTime(businessHours.data.close_time)}`);
        } else {
          context.push(`Business Hours Yesterday: DATA UNAVAILABLE`);
        }

        // Temperature Alerts — flag temperature_valid=false or out-of-bounds (<33 or >41 cold; >180 if hot probe but conservative)
        const tempIssues: string[] = [];
        for (const r of (tempAlerts.data || []) as any[]) {
          const temp = r.extracted_temperature;
          const valid = r.temperature_valid;
          const question = r.item?.question || "Unknown check";
          if (valid === false) {
            tempIssues.push(`${question}: ${temp}°F (FAILED)`);
          } else if (temp != null && (Number(temp) < 33 || (Number(temp) > 41 && Number(temp) < 135))) {
            tempIssues.push(`${question}: ${temp}°F (out of safe range)`);
          }
        }
        context.push(`Temperature Alerts: ${tempIssues.length ? tempIssues.slice(0, 8).join(" | ") : "NONE"}`);

        // Top Line Check Submitter
        if (topSubmitterId && topSubmitterCount > 0) {
          const name = profileMap[topSubmitterId] || "Unknown";
          context.push(`Top Line Check Submitter (Last 7 Days): ${name} with ${topSubmitterCount} submissions`);
        } else {
          context.push(`Top Line Check Submitter (Last 7 Days): NONE`);
        }

        // Shift Variances — late stayers / early leavers (>45 min)
        const variances: string[] = [];
        for (const shift of (yesterdayShifts.data || []) as any[]) {
          const userPunches = yPunches.filter((p) => p.user_id === shift.user_id && (!p.shift_id || p.shift_id === shift.id));
          if (!userPunches.length) continue;
          // Latest clock_out
          const latest = userPunches.sort((a, b) => new Date(b.punch_time).getTime() - new Date(a.punch_time).getTime())[0];
          const clockOut = new Date(latest.punch_time);
          // Build scheduled end as PST timestamp
          const [eh, em] = String(shift.end_time || "00:00").split(":").map(Number);
          // Assume shift_date in PST; build the wall-clock date in PST then convert
          // Simpler: compare using PST hours via Intl
          const clockOutPST = new Date(clockOut.toLocaleString("en-US", { timeZone: "America/Los_Angeles" }));
          const scheduledEnd = new Date(`${shift.shift_date}T${String(eh).padStart(2, "0")}:${String(em).padStart(2, "0")}:00`);
          const diffMin = (clockOutPST.getTime() - scheduledEnd.getTime()) / 60000;
          const name = (profileMap[shift.user_id] || "Unknown").split(" ")[0];
          if (diffMin > 45) {
            variances.push(`${name} stayed ${Math.round(diffMin)} min past close`);
          } else if (diffMin < -45) {
            variances.push(`${name} left ${Math.round(-diffMin)} min early`);
          }
        }
        context.push(`Shift Variances: ${variances.length ? variances.slice(0, 10).join(" | ") : "No significant variances"}`);

        // Generate the briefing via AI
        const aiResponse = await fetch(AI_URL, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${lovableApiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "google/gemini-2.5-flash",
            messages: [
              {
                role: "system",
                content: `You are Theo, the sharp, data-driven, yet empathetic morning operations director for a restaurant location. Generate a concise, highly readable morning briefing that a manager reads with their coffee.

Blend the operational realities of the restaurant with the data provided. Use markdown formatting extensively (bolding, lists, and clean Markdown Tables for structured data).

CRITICAL CONTEXT RULE: You now know the location's Business Hours. When reviewing Labor Grades, be fair and contextual. If labor was high, but the team was working *after* the closing time, recognize that as essential closing duties, not "wasted slow-period labor." Do not penalize the team aggressively for staying to close the restaurant properly.

Structure:

1. **The Headline**: A snappy 1-line summary of yesterday's performance and vibe.
2. **Yesterday's Scorecard**: Create a nice Markdown table showing Sales, Guests, Labor %, and Labor Grade. Below the table, provide a brief, fair analysis of the labor grade (remember the business hours context!).
3. **Operational Snapshot**: Create a Markdown table or bulleted list for:
   - Temperature Alerts (Flag anything weird. If NONE, praise the clean food safety record).
   - Team Shoutouts: Praise the Top Line Check Submitter by name. Note anyone who stayed late to help close, or left early.
4. **Today's Playbook**: Keep the best of your old habits here. List 2-3 specific, actionable focuses for today based on the AI Suggestions, Today's Schedule (gaps/coverage), Catering Orders, and Pending Time-Off Requests.

If any data says "DATA UNAVAILABLE", say so naturally. NEVER invent numbers, names, or catering orders. Keep it conversational, empathetic, and under 300 words.`
              },
              {
                role: "user",
                content: `Generate the morning briefing for today using this data:\n\n${context.join("\n")}`
              }
            ],
          }),
        });

        if (!aiResponse.ok) {
          const errText = await aiResponse.text();
          console.error(`AI error for ${loc.name}:`, aiResponse.status, errText);
          results.push({ location: loc.name, status: "ai_error", code: aiResponse.status });
          continue;
        }

        const aiData = await aiResponse.json();
        const content = aiData.choices?.[0]?.message?.content;

        if (!content) {
          results.push({ location: loc.name, status: "empty_response" });
          continue;
        }

        // Store the briefing
        const { error: insertErr } = await supabase
          .from("croo_ai_briefings")
          .insert({
            location_id: loc.id,
            briefing_date: today,
            content,
          });

        if (insertErr) {
          console.error(`Insert error for ${loc.name}:`, insertErr);
          results.push({ location: loc.name, status: "insert_error", detail: insertErr.message });
        } else {
          results.push({ location: loc.name, status: "generated" });
        }
      } catch (locErr: any) {
        console.error(`Error for ${loc.name}:`, locErr);
        results.push({ location: loc.name, status: "error", detail: locErr.message });
      }
    }

    return new Response(JSON.stringify({ success: true, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("generate-daily-briefing error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});