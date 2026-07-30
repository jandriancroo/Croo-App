// @ts-nocheck
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireInternalCaller } from "../_shared/callerAuth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

// ============================================================================
// LABOR INTELLIGENCE SERVICE
// Analyzes yesterday's hourly sales vs staffing and generates actionable insights
// using today's published schedule for forward-looking suggestions.
// ============================================================================

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Internal-only endpoint (cron / service invokes).
  const denied = requireInternalCaller(req, corsHeaders);
  if (denied) return denied;

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const lovableApiKey = Deno.env.get("LOVABLE_API_KEY");
    const supabase: any = createClient(supabaseUrl, supabaseKey);

    if (!lovableApiKey) {
      return new Response(
        JSON.stringify({ error: "LOVABLE_API_KEY not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let body: any = {};
    try { body = await req.json(); } catch {}
    
    const url = new URL(req.url);
    const action = url.searchParams.get("action") || body.action || "analyze";
    const locationId = body.locationId || body.location_id;

    if (action === "analyze-all") {
      return await analyzeAllLocations(supabase, supabaseUrl, supabaseKey, lovableApiKey);
    }

    if (action === "analyze" && locationId) {
      return await analyzeLocation(supabase, locationId, lovableApiKey);
    }

    return new Response(
      JSON.stringify({ error: "Provide locationId or use action=analyze-all" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[LABOR-INTEL] Error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

// ============================================================================
// ANALYZE ALL ACTIVE LOCATIONS
// ============================================================================
async function analyzeAllLocations(
  supabase: ReturnType<typeof createClient>,
  supabaseUrl: string,
  supabaseKey: string,
  lovableApiKey: string
) {
  const yesterday = getYesterdayInLA();
  const { data: locations } = await supabase
    .from("locations")
    .select("id, name")
    .eq("is_active", true);

  if (!locations?.length) {
    return new Response(
      JSON.stringify({ success: true, analyzed: 0, reason: "no active locations" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  let analyzed = 0;
  let skipped = 0;
  let errors = 0;

  for (const loc of locations) {
    try {
      // Skip if already analyzed for yesterday
      const { data: existing } = await supabase
        .from("labor_insights")
        .select("id")
        .eq("location_id", loc.id)
        .eq("insight_date", yesterday)
        .maybeSingle();

      if (existing) {
        skipped++;
        continue;
      }

      // Check if there's sales data for yesterday
      const { data: salesData } = await supabase
        .from("sales_cache")
        .select("net_sales")
        .eq("location_id", loc.id)
        .eq("sale_date", yesterday)
        .maybeSingle();

      if (!salesData || (salesData.net_sales || 0) < 100) {
        skipped++;
        continue;
      }

      const result = await generateInsight(supabase, loc.id, loc.name, yesterday, lovableApiKey);
      if (result) {
        analyzed++;
      } else {
        skipped++;
      }
    } catch (e) {
      console.error(`[LABOR-INTEL] Error analyzing ${loc.name}:`, e);
      errors++;
    }
  }

  console.log(`[LABOR-INTEL] Done: ${analyzed} analyzed, ${skipped} skipped, ${errors} errors`);
  return new Response(
    JSON.stringify({ success: true, analyzed, skipped, errors }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

// ============================================================================
// ANALYZE SINGLE LOCATION
// ============================================================================
async function analyzeLocation(
  supabase: ReturnType<typeof createClient>,
  locationId: string,
  lovableApiKey: string
) {
  const yesterday = getYesterdayInLA();

  const { data: loc } = await supabase
    .from("locations")
    .select("id, name")
    .eq("id", locationId)
    .single();

  if (!loc) {
    return new Response(
      JSON.stringify({ error: "Location not found" }),
      { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const result = await generateInsight(supabase, loc.id, loc.name, yesterday, lovableApiKey);

  return new Response(
    JSON.stringify({ success: true, result }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

// ============================================================================
// CORE INSIGHT GENERATION
// ============================================================================
async function generateInsight(
  supabase: ReturnType<typeof createClient>,
  locationId: string,
  locationName: string,
  yesterday: string,
  lovableApiKey: string
): Promise<boolean> {
  console.log(`[LABOR-INTEL] Generating insight for ${locationName} (${yesterday})`);

  // 1. Get yesterday's hourly sales
  const { data: salesData } = await supabase
    .from("sales_cache")
    .select("net_sales, hourly_data, projected_sales, override_projection, initial_projection")
    .eq("location_id", locationId)
    .eq("sale_date", yesterday)
    .maybeSingle();

  if (!salesData || !salesData.hourly_data) {
    console.log(`[LABOR-INTEL] No hourly data for ${locationName} on ${yesterday}`);
    return false;
  }

  // 2. Get yesterday's labor cache
  const { data: laborData } = await supabase
    .from("labor_cache")
    .select("labor_cost, labor_hours, employee_breakdown")
    .eq("location_id", locationId)
    .eq("labor_date", yesterday)
    .order("source", { ascending: true }) // punch_clock first
    .limit(1)
    .maybeSingle();

  // 3. Get yesterday's time punches with break tracking
  // Use a wider window to catch overnight shifts
  const today = getTodayInLA();
  const { data: rawPunches } = await supabase
    .from("time_punches")
    .select("user_id, punch_time, punch_type, notes")
    .eq("location_id", locationId)
    .gte("punch_time", `${yesterday}T07:00:00Z`) // ~midnight PDT
    .lt("punch_time", `${today}T10:00:00Z`) // catch late night shifts (3 AM PDT)
    .order("punch_time");

  // Get profile info for punched users
  const punchUserIds = [...new Set((rawPunches || []).map((p: any) => p.user_id))];
  let profileMap: Record<string, { full_name: string; hourly_wage: number }> = {};
  if (punchUserIds.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, full_name, hourly_wage")
      .in("id", punchUserIds);
    for (const p of profiles || []) {
      profileMap[p.id] = { full_name: p.full_name || "Unknown", hourly_wage: p.hourly_wage || 0 };
    }
  }

  // Merge profiles into punches
  const punches = (rawPunches || []).map((p: any) => ({
    ...p,
    profiles: profileMap[p.user_id] || { full_name: "Unknown", hourly_wage: 0 },
  }));

  // 4. Get yesterday's scheduled shifts
  const { data: scheduledShifts } = await supabase
    .from("scheduled_shifts")
    .select(`
      user_id, shift_date, start_time, end_time, is_time_off,
      schedules!inner(location_id)
    `)
    .eq("schedules.location_id", locationId)
    .eq("shift_date", yesterday)
    .eq("is_time_off", false);

  // Get profile info for scheduled users
  const schedUserIds = [...new Set((scheduledShifts || []).map((s: any) => s.user_id))];
  const allUserIds = [...new Set([...punchUserIds, ...schedUserIds])];
  // Enrich profileMap with any missing users
  const missingIds = allUserIds.filter(id => !profileMap[id]);
  if (missingIds.length > 0) {
    const { data: moreProfiles } = await supabase
      .from("profiles")
      .select("id, full_name, hourly_wage")
      .in("id", missingIds);
    for (const p of moreProfiles || []) {
      profileMap[p.id] = { full_name: p.full_name || "Unknown", hourly_wage: p.hourly_wage || 0 };
    }
  }

  // Merge profiles into scheduled shifts
  const enrichedScheduledShifts = (scheduledShifts || []).map((s: any) => ({
    ...s,
    profiles: profileMap[s.user_id] || { full_name: "Unknown", hourly_wage: 0 },
  }));

  // 5. Get today's scheduled shifts (for forward-looking suggestions)
  const { data: rawTodayShifts } = await supabase
    .from("scheduled_shifts")
    .select(`
      user_id, shift_date, start_time, end_time, is_time_off,
      schedules!inner(location_id)
    `)
    .eq("schedules.location_id", locationId)
    .eq("shift_date", today)
    .eq("is_time_off", false);

  // Enrich today's shifts with profiles
  const todayUserIds = [...new Set((rawTodayShifts || []).map((s: any) => s.user_id))];
  const todayMissing = todayUserIds.filter(id => !profileMap[id]);
  if (todayMissing.length > 0) {
    const { data: todayProfiles } = await supabase
      .from("profiles")
      .select("id, full_name, hourly_wage")
      .in("id", todayMissing);
    for (const p of todayProfiles || []) {
      profileMap[p.id] = { full_name: p.full_name || "Unknown", hourly_wage: p.hourly_wage || 0 };
    }
  }
  const todayShifts = (rawTodayShifts || []).map((s: any) => ({
    ...s,
    profiles: profileMap[s.user_id] || { full_name: "Unknown", hourly_wage: 0 },
  }));

  // 6. Get location hours
  const dayOfWeek = getDayOfWeekInLA(yesterday);
  const { data: locationHours } = await supabase
    .from("location_hours")
    .select("open_time, close_time, is_closed")
    .eq("location_id", locationId)
    .eq("day_of_week", dayOfWeek)
    .maybeSingle();

  // 7. Build the punch timeline (who was actually working each hour)
  const punchTimeline = buildPunchTimeline(punches || [], yesterday);

  // 8. Build structured data for AI
  const hourlyData = (salesData.hourly_data as any[]) || [];
  const goal = salesData.override_projection || salesData.initial_projection || salesData.projected_sales || 0;

  const analysisData = {
    location: locationName,
    date: yesterday,
    dayOfWeek: getDayNameInLA(yesterday),
    today: today,
    todayDayOfWeek: getDayNameInLA(today),
    summary: {
      netSales: salesData.net_sales,
      goal,
      totalLaborCost: laborData?.labor_cost || 0,
      totalLaborHours: laborData?.labor_hours || 0,
      laborPercent: salesData.net_sales > 0 
        ? Math.round(((laborData?.labor_cost || 0) / salesData.net_sales) * 1000) / 10 
        : 0,
    },
    hourlyBreakdown: hourlyData.map((h: any) => {
      const hourNum = parseInt(String(h.hour).split(":")[0]);
      const staffWorking = punchTimeline[hourNum] || [];
      return {
        hour: h.hour,
        sales: h.sales || 0,
        projected: h.projected || 0,
        laborCost: h.laborCost || 0,
        laborPercent: h.laborPercent || 0,
        activeStaff: staffWorking.map((s: any) => s.name),
        staffCount: staffWorking.length,
      };
    }),
    scheduleVsActual: buildScheduleVsActual(enrichedScheduledShifts, punches, yesterday)
      .filter((e: any) => Math.abs(e.varianceHours) >= 0.25), // Only employees with 15+ min variance
    todaySchedule: (todayShifts || []).map((s: any) => ({
      name: s.profiles?.full_name || "Unknown",
      startTime: s.start_time,
      endTime: s.end_time,
      hourlyWage: s.profiles?.hourly_wage || 0,
    })),
    locationHours: locationHours || null,
  };

  // 9. Call AI for analysis
  const aiResponse = await callAI(analysisData, lovableApiKey);
  if (!aiResponse) return false;

  // 10. Store the insight
  const { error: insertError } = await supabase
    .from("labor_insights")
    .upsert({
      location_id: locationId,
      insight_date: yesterday,
      analysis: aiResponse,
    }, { onConflict: "location_id,insight_date" });

  if (insertError) {
    console.error(`[LABOR-INTEL] Failed to store insight for ${locationName}:`, insertError);
    return false;
  }

  console.log(`[LABOR-INTEL] ✓ Insight stored for ${locationName}`);
  return true;
}

// ============================================================================
// BUILD PUNCH TIMELINE: who was actively working each hour (not on break)
// ============================================================================
function buildPunchTimeline(
  punches: any[],
  dateStr: string
): Record<number, { name: string; wage: number }[]> {
  // Group punches by user
  const byUser: Record<string, { name: string; wage: number; events: { time: Date; type: string }[] }> = {};

  for (const p of punches) {
    const userId = p.user_id;
    if (!byUser[userId]) {
      byUser[userId] = {
        name: p.profiles?.full_name || "Unknown",
        wage: p.profiles?.hourly_wage || 0,
        events: [],
      };
    }
    byUser[userId].events.push({
      time: new Date(p.punch_time),
      type: p.punch_type,
    });
  }

  // For each hour, determine who was actively working (clocked in, not on break)
  const timeline: Record<number, { name: string; wage: number }[]> = {};

  for (let hour = 6; hour <= 23; hour++) {
    const staffThisHour: { name: string; wage: number }[] = [];

    for (const [, user] of Object.entries(byUser)) {
      const midpoint = new Date(`${dateStr}T${String(hour).padStart(2, "0")}:30:00-07:00`);
      
      let isWorking = false;
      let isOnBreak = false;

      for (const event of user.events) {
        if (event.time <= midpoint) {
          if (event.type === "clock_in") { isWorking = true; isOnBreak = false; }
          else if (event.type === "clock_out") { isWorking = false; isOnBreak = false; }
          else if (event.type === "break_start") { isOnBreak = true; }
          else if (event.type === "break_end") { isOnBreak = false; }
        }
      }

      if (isWorking && !isOnBreak) {
        staffThisHour.push({ name: user.name, wage: user.wage });
      }
    }

    if (staffThisHour.length > 0) {
      timeline[hour] = staffThisHour;
    }
  }

  return timeline;
}

// ============================================================================
// BUILD SCHEDULE VS ACTUAL COMPARISON
// ============================================================================
function buildScheduleVsActual(
  scheduledShifts: any[],
  punches: any[],
  dateStr: string
): any[] {
  // Group punches by user
  const punchByUser: Record<string, { clockIn?: Date; clockOut?: Date; breakMinutes: number }> = {};

  for (const p of punches) {
    const userId = p.user_id;
    if (!punchByUser[userId]) {
      punchByUser[userId] = { breakMinutes: 0 };
    }
    const time = new Date(p.punch_time);
    if (p.punch_type === "clock_in" && !punchByUser[userId].clockIn) {
      punchByUser[userId].clockIn = time;
    }
    if (p.punch_type === "clock_out") {
      punchByUser[userId].clockOut = time;
    }
    if (p.punch_type === "break_start") {
      // Track break start for calculating duration
      (punchByUser[userId] as any)._breakStart = time;
    }
    if (p.punch_type === "break_end" && (punchByUser[userId] as any)._breakStart) {
      const breakMs = time.getTime() - (punchByUser[userId] as any)._breakStart.getTime();
      punchByUser[userId].breakMinutes += breakMs / 60000;
      delete (punchByUser[userId] as any)._breakStart;
    }
  }

  return scheduledShifts.map((shift: any) => {
    const actual = punchByUser[shift.user_id];
    const scheduledHours = calculateScheduledHours(shift.start_time, shift.end_time);

    let actualHours = 0;
    let clockInTime = "";
    let clockOutTime = "";

    if (actual?.clockIn && actual?.clockOut) {
      const totalMs = actual.clockOut.getTime() - actual.clockIn.getTime();
      actualHours = Math.round(((totalMs / 3600000) - (actual.breakMinutes / 60)) * 100) / 100;
      clockInTime = actual.clockIn.toLocaleTimeString("en-US", { timeZone: "America/Los_Angeles", hour: "numeric", minute: "2-digit" });
      clockOutTime = actual.clockOut.toLocaleTimeString("en-US", { timeZone: "America/Los_Angeles", hour: "numeric", minute: "2-digit" });
    }

    return {
      name: shift.profiles?.full_name || "Unknown",
      scheduledStart: shift.start_time,
      scheduledEnd: shift.end_time,
      scheduledHours,
      actualClockIn: clockInTime,
      actualClockOut: clockOutTime,
      actualHours,
      breakMinutes: actual?.breakMinutes ? Math.round(actual.breakMinutes) : 0,
      varianceHours: Math.round((actualHours - scheduledHours) * 100) / 100,
      hourlyWage: shift.profiles?.hourly_wage || 0,
      varianceCost: Math.round((actualHours - scheduledHours) * (shift.profiles?.hourly_wage || 0) * 100) / 100,
    };
  });
}

function calculateScheduledHours(startTime: string, endTime: string): number {
  const [sH, sM] = startTime.split(":").map(Number);
  const [eH, eM] = endTime.split(":").map(Number);
  let hours = eH - sH + (eM - sM) / 60;
  if (hours < 0) hours += 24;
  // Deduct 30 min break if shift > 5 hours
  if (hours > 5) hours -= 0.5;
  return Math.round(hours * 100) / 100;
}

// ============================================================================
// CALL AI FOR ANALYSIS
// ============================================================================
async function callAI(data: any, apiKey: string): Promise<any | null> {
  const systemPrompt = `You are a concise restaurant labor analyst. Analyze yesterday's data and generate brief, actionable insights.

CRITICAL RULES:
- Only state facts supported by the data. Never fabricate staffing counts.
- "activeStaff" arrays show EXACTLY who was clocked in (not on break). Trust this completely.
- Labor % = laborCost / sales * 100. Flag hours over 35% as concerning.
- CONTEXT MATTERS: Before flagging an hour as overstaffed, consider the surrounding hours. If sending someone home at that hour would leave the next 2-3 hours short-staffed, it's NOT actionable — don't flag it as a savings opportunity. Only flag overstaffing when there's a realistic window to cut (e.g., end of a shift, multiple consecutive slow hours, or someone's shift ends soon after).
- Consider whether a pattern repeats on this specific day of week vs being a one-off. Note this in findings.
- employeeComparisons data is PRE-FILTERED to only employees with meaningful variance (>15 min). Only include these in your output.
- Keep it tight: max 3 key findings, max 3 today suggestions. Quality over quantity.
- For today's suggestions, reference specific employees and times from today's schedule.

Return JSON:
{
  "summary": {
    "headline": "One concise sentence on yesterday's labor efficiency",
    "overallGrade": "A"|"B"|"C"|"D"|"F",
    "totalSavingsOpportunity": <realistic dollar amount considering schedule context>,
    "laborPercent": <number>
  },
  "keyFindings": [
    {
      "type": "overstaffed"|"understaffed"|"schedule_drift"|"efficiency_win"|"pattern",
      "severity": "high"|"medium"|"low",
      "title": "Short title",
      "detail": "Brief detail with numbers",
      "hourRange": "e.g. 3-5 PM",
      "savingsOpportunity": <number or null>
    }
  ],
  "hourlyAnalysis": [
    {
      "hour": "11:00",
      "sales": <number>,
      "laborCost": <number>,
      "laborPercent": <number>,
      "staffCount": <number>,
      "staffNames": ["name1"],
      "flag": "efficient"|"warning"|"critical"|null
    }
  ],
  "employeeComparisons": [
    {
      "name": "Name",
      "scheduledHours": <number>,
      "actualHours": <number>,
      "varianceHours": <number>,
      "varianceCost": <number>,
      "note": "Brief note"
    }
  ],
  "todaySuggestions": [
    {
      "priority": "high"|"medium",
      "suggestion": "Specific suggestion with employee name and time",
      "estimatedSavings": <number or null>,
      "basedOn": "Brief basis"
    }
  ]
}`;
  const userPrompt = `Analyze this restaurant labor data and provide insights:

${JSON.stringify(data, null, 2)}

Remember: activeStaff arrays show exactly who was working each hour. Use these as ground truth.`;

  try {
    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "store_labor_analysis",
              description: "Store the structured labor analysis results",
              parameters: {
                type: "object",
                properties: {
                  summary: {
                    type: "object",
                    properties: {
                      headline: { type: "string" },
                      overallGrade: { type: "string", enum: ["A", "B", "C", "D", "F"] },
                      totalSavingsOpportunity: { type: "number" },
                      laborPercent: { type: "number" },
                    },
                    required: ["headline", "overallGrade", "totalSavingsOpportunity", "laborPercent"],
                  },
                  keyFindings: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        type: { type: "string", enum: ["overstaffed", "understaffed", "schedule_drift", "efficiency_win", "pattern"] },
                        severity: { type: "string", enum: ["high", "medium", "low"] },
                        title: { type: "string" },
                        detail: { type: "string" },
                        hourRange: { type: "string" },
                        savingsOpportunity: { type: "number" },
                      },
                      required: ["type", "severity", "title", "detail"],
                    },
                  },
                  hourlyAnalysis: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        hour: { type: "string" },
                        sales: { type: "number" },
                        laborCost: { type: "number" },
                        laborPercent: { type: "number" },
                        staffCount: { type: "number" },
                        staffNames: { type: "array", items: { type: "string" } },
                        flag: { type: "string", enum: ["efficient", "warning", "critical"] },
                      },
                      required: ["hour", "sales", "laborCost", "laborPercent", "staffCount", "staffNames"],
                    },
                  },
                  employeeComparisons: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        name: { type: "string" },
                        scheduledHours: { type: "number" },
                        actualHours: { type: "number" },
                        varianceHours: { type: "number" },
                        varianceCost: { type: "number" },
                        note: { type: "string" },
                      },
                      required: ["name", "scheduledHours", "actualHours", "varianceHours"],
                    },
                  },
                  todaySuggestions: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        priority: { type: "string", enum: ["high", "medium"] },
                        suggestion: { type: "string" },
                        estimatedSavings: { type: "number" },
                        basedOn: { type: "string" },
                      },
                      required: ["priority", "suggestion"],
                    },
                  },
                },
                required: ["summary", "keyFindings", "hourlyAnalysis", "employeeComparisons", "todaySuggestions"],
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "store_labor_analysis" } },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[LABOR-INTEL] AI gateway error ${response.status}:`, errorText);
      return null;
    }

    const result = await response.json();
    const toolCall = result.choices?.[0]?.message?.tool_calls?.[0];
    
    if (!toolCall?.function?.arguments) {
      console.error("[LABOR-INTEL] No tool call in AI response");
      return null;
    }

    const analysis = JSON.parse(toolCall.function.arguments);
    console.log(`[LABOR-INTEL] AI analysis complete: grade=${analysis.summary?.overallGrade}, findings=${analysis.keyFindings?.length}`);
    return analysis;
  } catch (e) {
    console.error("[LABOR-INTEL] AI call failed:", e);
    return null;
  }
}

// ============================================================================
// DATE HELPERS (LA timezone)
// ============================================================================
function getYesterdayInLA(): string {
  const now = new Date();
  const laTime = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const [year, month, day] = laTime.split("-").map(Number);
  const laDate = new Date(year, month - 1, day);
  laDate.setDate(laDate.getDate() - 1);
  return laDate.toISOString().slice(0, 10);
}

function getTodayInLA(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function getDayOfWeekInLA(dateStr: string): number {
  const d = new Date(dateStr + "T12:00:00-07:00");
  return d.getDay();
}

function getDayNameInLA(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00-07:00");
  return d.toLocaleDateString("en-US", { weekday: "long" });
}
