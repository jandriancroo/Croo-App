import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

function getTzOffset(tz: string): string {
  // Get current UTC offset for the timezone dynamically (handles DST)
  const now = new Date();
  const formatter = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "shortOffset" });
  const parts = formatter.formatToParts(now);
  const tzPart = parts.find(p => p.type === "timeZoneName");
  // e.g. "GMT-7" or "GMT-8"
  if (tzPart?.value) {
    const match = tzPart.value.match(/GMT([+-]\d+)/);
    if (match) {
      const hours = parseInt(match[1], 10);
      const sign = hours >= 0 ? "+" : "-";
      return `${sign}${String(Math.abs(hours)).padStart(2, "0")}:00`;
    }
  }
  return "-08:00"; // fallback PST
}

// Tool definitions for the AI model
const tools = [
  {
    type: "function",
    function: {
      name: "query_sales",
      description: "Query sales data including net sales, guest count, pizza count, avg ticket, projections, and product mix (menu items sold with quantities). Use for questions about revenue, sales performance, items sold, product mix, and comparisons between dates.",
      parameters: {
        type: "object",
        properties: {
          location_id: { type: "string", description: "UUID of the location" },
          start_date: { type: "string", description: "Start date YYYY-MM-DD" },
          end_date: { type: "string", description: "End date YYYY-MM-DD (defaults to start_date if omitted)" },
          include_product_mix: { type: "boolean", description: "Include item-level sales breakdown (product mix)" },
          include_hourly: { type: "boolean", description: "Include hourly sales breakdown" },
        },
        required: ["location_id", "start_date"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "query_labor",
      description: "Query labor data: labor cost, hours, overtime, employee breakdown. Also queries individual time punches (clock in/out times) for specific employees or all staff on a date. Use for questions about who clocked in/out, late arrivals, hours worked.",
      parameters: {
        type: "object",
        properties: {
          location_id: { type: "string", description: "UUID of the location" },
          start_date: { type: "string", description: "Start date YYYY-MM-DD" },
          end_date: { type: "string", description: "End date YYYY-MM-DD" },
          employee_name: { type: "string", description: "Filter by employee name (partial match)" },
          include_punches: { type: "boolean", description: "Include individual clock in/out punch records" },
        },
        required: ["location_id", "start_date"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "query_schedule",
      description: "Query scheduled shifts for a location on specific dates. Shows who is scheduled, shift times, positions, and coverage. Use for 'who was the opener', 'who is working today', shift coverage questions.",
      parameters: {
        type: "object",
        properties: {
          location_id: { type: "string", description: "UUID of the location" },
          start_date: { type: "string", description: "Start date YYYY-MM-DD" },
          end_date: { type: "string", description: "End date YYYY-MM-DD" },
          employee_name: { type: "string", description: "Filter by employee name (partial match)" },
        },
        required: ["location_id", "start_date"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "query_checklists",
      description: "Query checklist completion data. ALWAYS returns full item-level responses (questions, answers, temperatures, who completed each item). Use for ANY checklist question: 'who temped the tomatoes', 'what time did they flip the line', 'was the shift change checklist done', 'what was the walk-in temp'. Use checklist_title to find the right checklist and item_keyword to find specific items within it.",
      parameters: {
        type: "object",
        properties: {
          location_id: { type: "string", description: "UUID of the location" },
          date: { type: "string", description: "Date YYYY-MM-DD" },
          checklist_title: { type: "string", description: "Filter by checklist title (partial match, e.g. 'AM Line', 'shift change', 'opening', 'closing'). ALWAYS set this when the user mentions a checklist name." },
          item_keyword: { type: "string", description: "Filter items by keyword in the question text (e.g. 'tomato', 'walk-in', 'flip', 'temp'). Set this when asking about a specific item." },
        },
        required: ["location_id", "date"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "query_tasks",
      description: "Query tasks (quick tasks, recurring tasks, alarm tasks) and their subtasks/completions. Use for questions about task status, what's incomplete, who completed what, task details.",
      parameters: {
        type: "object",
        properties: {
          location_id: { type: "string", description: "UUID of the location" },
          task_title: { type: "string", description: "Filter by task title (partial match)" },
          include_subtasks: { type: "boolean", description: "Include subtask details and completion status. Default true." },
          active_only: { type: "boolean", description: "Only show active tasks. Default true." },
          date: { type: "string", description: "Date for checking completions YYYY-MM-DD (defaults to today)" },
        },
        required: ["location_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "query_logbook",
      description: "Query logbook entries (Safe Count, Drawer Count, Pass Down, Incident Report, Maintenance Request, and any custom categories). Returns full details including JSON data for financial entries (denomination counts, totals, variance, deposit amounts). Use for questions about drawer counts, safe counts, deposits, pass downs, incidents, maintenance, or any logbook category.",
      parameters: {
        type: "object",
        properties: {
          location_id: { type: "string", description: "UUID of the location" },
          date: { type: "string", description: "Date YYYY-MM-DD" },
          category_name: { type: "string", description: "Filter by category name (partial match, e.g. 'safe', 'drawer', 'pass down', 'incident', 'maintenance')" },
          entry_keyword: { type: "string", description: "Filter entries by keyword in title or value text" },
        },
        required: ["location_id", "date"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "query_labor_intelligence",
      description: "Query AI-generated labor intelligence reports with grades (A-F), findings, and staffing suggestions. Use for questions about labor efficiency, labor grade, overstaffing, understaffing, or scheduling optimization insights.",
      parameters: {
        type: "object",
        properties: {
          location_id: { type: "string", description: "UUID of the location" },
          date: { type: "string", description: "Date YYYY-MM-DD (defaults to most recent report)" },
        },
        required: ["location_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "query_inventory",
      description: "Query inventory count data including period type, status, item quantities, costs, COGS, and variance. Use for questions about food cost, inventory levels, what items were counted, COGS percentage, stock on hand, and period comparisons.",
      parameters: {
        type: "object",
        properties: {
          location_id: { type: "string", description: "UUID of the location" },
          period_end_date: { type: "string", description: "Period end date YYYY-MM-DD to find a specific count period" },
          status: { type: "string", description: "Filter by status: 'completed', 'in_progress', 'upcoming'" },
          item_keyword: { type: "string", description: "Filter items by name keyword (e.g. 'chicken', 'cheese', 'lettuce')" },
          include_items: { type: "boolean", description: "Include item-level detail (quantities, costs, variance). Default false for summary, true when asking about specific items." },
        },
        required: ["location_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "query_catering",
      description: "Query catering orders with customer name, pickup date/time, items, headcount, status, total price, notes. Use for questions about catering orders, upcoming pickups, order details, or catering revenue.",
      parameters: {
        type: "object",
        properties: {
          location_id: { type: "string", description: "UUID of the location" },
          start_date: { type: "string", description: "Start of date range YYYY-MM-DD" },
          end_date: { type: "string", description: "End of date range YYYY-MM-DD" },
          status: { type: "string", description: "Filter by status: 'pending', 'completed', 'cancelled'" },
          customer_name: { type: "string", description: "Filter by customer name (partial match)" },
        },
        required: ["location_id", "start_date"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "query_availability",
      description: "Query time-off and availability requests. Shows who requested off, dates, status (pending/approved/denied), type (time_off/availability_change), and reviewer info. Use for questions about who has time off, pending requests, coverage gaps, or upcoming absences.",
      parameters: {
        type: "object",
        properties: {
          location_id: { type: "string", description: "UUID of the location" },
          start_date: { type: "string", description: "Start of date range YYYY-MM-DD" },
          end_date: { type: "string", description: "End of date range YYYY-MM-DD" },
          status: { type: "string", description: "Filter by status: 'pending', 'approved', 'denied'" },
          employee_name: { type: "string", description: "Filter by employee name (partial match)" },
        },
        required: ["location_id"],
      },
    },
  },
];

// Execute tool calls against the database
async function executeTool(supabase: any, toolName: string, args: any, timezone: string): Promise<string> {
  const offset = getTzOffset(timezone);
  try {
    switch (toolName) {
      case "query_sales": {
        const endDate = args.end_date || args.start_date;
        const { data, error } = await supabase
          .from("sales_cache")
          .select("sale_date, net_sales, guest_count, pizza_count, avg_ticket, projected_sales, living_projection, override_projection, initial_projection, hourly_data, product_mix")
          .eq("location_id", args.location_id)
          .gte("sale_date", args.start_date)
          .lte("sale_date", endDate)
          .order("sale_date");
        if (error) {
          console.error("query_sales error:", error);
          return JSON.stringify({ error: error.message });
        }

        const results = (data || []).map((row: any) => {
          const r: any = {
            date: row.sale_date,
            net_sales: row.net_sales,
            guest_count: row.guest_count,
            pizza_count: row.pizza_count,
            avg_ticket: row.avg_ticket,
            projection: row.override_projection || row.living_projection || row.initial_projection || row.projected_sales,
          };
          if (args.include_hourly && row.hourly_data) r.hourly = row.hourly_data;
          if (args.include_product_mix && row.product_mix) r.product_mix = row.product_mix;
          return r;
        });
        return JSON.stringify(results.length ? results : { message: "No sales data found for this date range." });
      }

      case "query_labor": {
        const endDate = args.end_date || args.start_date;
        const { data: laborData, error: laborError } = await supabase
          .from("labor_cache")
          .select("labor_date, source, labor_cost, labor_hours, regular_hours, overtime_hours, employee_breakdown")
          .eq("location_id", args.location_id)
          .gte("labor_date", args.start_date)
          .lte("labor_date", endDate)
          .order("labor_date");
        if (laborError) {
          console.error("query_labor cache error:", laborError);
          return JSON.stringify({ error: laborError.message });
        }

        const result: any = { labor_summary: laborData || [] };

        if (args.include_punches) {
          const startTs = `${args.start_date}T00:00:00${offset}`;
          const endTs = `${endDate}T23:59:59${offset}`;
          const { data: punches, error: punchError } = await supabase
            .from("time_punches")
            .select("user_id, punch_type, punch_time, notes, profiles(full_name)")
            .eq("location_id", args.location_id)
            .gte("punch_time", startTs)
            .lte("punch_time", endTs)
            .order("punch_time");

          if (punchError) {
            console.error("query_labor punches error:", punchError);
            result.punches_error = punchError.message;
          } else {
            let punchResults = (punches || []).map((p: any) => ({
              name: p.profiles?.full_name,
              type: p.punch_type,
              time: p.punch_time,
              notes: p.notes,
            }));
            if (args.employee_name) {
              const q = args.employee_name.toLowerCase();
              punchResults = punchResults.filter((p: any) => p.name?.toLowerCase().includes(q));
            }
            result.punches = punchResults;
          }
        }

        return JSON.stringify(result);
      }

      case "query_schedule": {
        const endDate = args.end_date || args.start_date;
        // Query shifts with schedule join for location filtering
        const { data, error } = await supabase
          .from("scheduled_shifts")
          .select("shift_date, start_time, end_time, position, is_time_off, user_id, schedule_id, schedules!inner(location_id, week_start_date, week_end_date)")
          .eq("schedules.location_id", args.location_id)
          .gte("shift_date", args.start_date)
          .lte("shift_date", endDate)
          .not("user_id", "is", null)
          .order("shift_date")
          .order("start_time");
        
        if (error) {
          console.error("query_schedule error:", error);
          return JSON.stringify({ error: error.message });
        }

        const userIds = Array.from(new Set((data || []).map((s: any) => s.user_id).filter(Boolean)));
        let profileMap: Record<string, string> = {};

        if (userIds.length > 0) {
          const { data: profiles, error: profilesError } = await supabase
            .from("profiles")
            .select("id, full_name")
            .in("id", userIds);

          if (profilesError) {
            console.error("query_schedule profiles error:", profilesError);
          } else {
            profileMap = (profiles || []).reduce((acc: Record<string, string>, p: any) => {
              acc[p.id] = p.full_name;
              return acc;
            }, {});
          }
        }

        let results = (data || []).map((s: any) => ({
          date: s.shift_date,
          name: profileMap[s.user_id] || "Unknown",
          start: s.start_time,
          end: s.end_time,
          position: s.position,
          time_off: s.is_time_off,
        }));

        if (args.employee_name) {
          const q = args.employee_name.toLowerCase();
          results = results.filter((s: any) => s.name?.toLowerCase().includes(q));
        }
        return JSON.stringify(results.length ? results : { message: "No scheduled shifts found for this date range." });
      }

      case "query_checklists": {
        const startTs = `${args.date}T00:00:00${offset}`;
        const endTs = `${args.date}T23:59:59${offset}`;
        const includeResponses = true; // Always include item-level responses

        const { data, error } = await supabase
          .from("checklist_submissions")
          .select(`
            submitted_at, submitted_by, 
            profiles(full_name), 
            checklists(title),
            checklist_responses(
              item_id, response_text, response_image_url, created_at,
              extracted_temperature, temperature_valid, completed_by,
              checklist_items(question, item_type, requires_temperature_validation)
            )
          `)
          .eq("location_id", args.location_id)
          .gte("submitted_at", startTs)
          .lte("submitted_at", endTs);

        if (error) {
          console.error("query_checklists error:", error);
          return JSON.stringify({ error: error.message });
        }

        // Get profiles for completed_by IDs
        const completedByIds = new Set<string>();
        (data || []).forEach((s: any) => {
          s.checklist_responses?.forEach((r: any) => {
            if (r.completed_by) completedByIds.add(r.completed_by);
          });
        });
        
        let profileMap: Record<string, string> = {};
        if (completedByIds.size > 0) {
          const { data: profiles } = await supabase
            .from("profiles")
            .select("id, full_name")
            .in("id", Array.from(completedByIds));
          (profiles || []).forEach((p: any) => { profileMap[p.id] = p.full_name; });
        }

        let results = (data || []).map((s: any) => {
          const base: any = {
            checklist: s.checklists?.title,
            submitted_by: s.profiles?.full_name,
            submitted_at: s.submitted_at,
            responses_count: s.checklist_responses?.length || 0,
          };

          if (includeResponses && s.checklist_responses) {
            let responses = s.checklist_responses.map((r: any) => ({
              question: r.checklist_items?.question,
              item_type: r.checklist_items?.item_type,
              answer: r.response_text,
              temperature: r.extracted_temperature,
              temp_valid: r.temperature_valid,
              completed_by: r.completed_by ? profileMap[r.completed_by] || r.completed_by : s.profiles?.full_name,
              completed_at: r.created_at || s.submitted_at,
              has_photo: !!r.response_image_url,
            }));

            if (args.item_keyword) {
              const rawKeyword = String(args.item_keyword).toLowerCase().trim();
              const stopWords = new Set(["the", "a", "an", "to", "for", "of", "on", "in", "at", "did", "does", "do", "is", "are", "was", "were", "who", "what", "when", "where", "how", "today", "yesterday"]);
              const keywordTokens = Array.from(new Set(
                rawKeyword
                  .replace(/[^a-z0-9\s-]/g, " ")
                  .split(/\s+/)
                  .filter((t) => t.length >= 3 && !stopWords.has(t))
              ));

              responses = responses.filter((r: any) => {
                const haystack = `${r.question || ""} ${r.answer || ""}`.toLowerCase();
                if (!haystack) return false;

                // First try exact phrase
                if (rawKeyword && haystack.includes(rawKeyword)) return true;

                // Fallback: phrase-to-token matching (e.g. "flip the line" -> "flip")
                if (keywordTokens.length === 0) return false;
                return keywordTokens.some((token) => haystack.includes(token));
              });
            }
            base.responses = responses;
          }
          return base;
        });

        if (args.checklist_title) {
          const q = args.checklist_title.toLowerCase();
          results = results.filter((r: any) => r.checklist?.toLowerCase().includes(q));
        }
        return JSON.stringify(results.length ? results : { message: "No checklist submissions found for this date." });
      }

      case "query_logbook": {
        // Fetch logbook entries with their values and category info
        let catFilter: string[] = [];
        if (args.category_name) {
          const { data: cats } = await supabase
            .from("logbook_categories")
            .select("id, name")
            .eq("location_id", args.location_id)
            .eq("is_active", true)
            .ilike("name", `%${args.category_name}%`);
          catFilter = (cats || []).map((c: any) => c.id);
          if (catFilter.length === 0) {
            return JSON.stringify({ message: `No logbook category matching "${args.category_name}" found.` });
          }
        }

        let query = supabase
          .from("logbook_entries")
          .select(`
            id, entry_date, created_at, category_id,
            logbook_categories(name),
            profiles(full_name),
            logbook_entry_values(field_id, value_text, value_number, logbook_fields(field_name, field_type))
          `)
          .eq("location_id", args.location_id)
          .eq("entry_date", args.date)
          .order("created_at", { ascending: false });

        if (catFilter.length > 0) {
          query = query.in("category_id", catFilter);
        }

        const { data: entries, error: logError } = await query.limit(50);
        if (logError) {
          console.error("query_logbook error:", logError);
          return JSON.stringify({ error: logError.message });
        }

        const results = (entries || []).map((e: any) => {
          const entry: any = {
            category: e.logbook_categories?.name,
            submitted_by: e.profiles?.full_name,
            submitted_at: e.created_at,
          };

          // Process values - parse JSON for structured entries (safe/drawer counts)
          const values: any[] = [];
          (e.logbook_entry_values || []).forEach((v: any) => {
            const fieldName = v.logbook_fields?.field_name || "value";
            const fieldType = v.logbook_fields?.field_type;
            
            if (v.value_text) {
              try {
                const parsed = JSON.parse(v.value_text);
                // Structured data (safe count, drawer count)
                values.push({ field: fieldName, type: fieldType, data: parsed });
              } catch {
                values.push({ field: fieldName, type: fieldType, text: v.value_text });
              }
            } else if (v.value_number !== null && v.value_number !== undefined) {
              values.push({ field: fieldName, type: fieldType, number: v.value_number });
            }
          });

          if (values.length > 0) entry.details = values;

          // Filter by keyword if provided
          if (args.entry_keyword) {
            const kw = args.entry_keyword.toLowerCase();
            const searchText = JSON.stringify(entry).toLowerCase();
            if (!searchText.includes(kw)) return null;
          }

          return entry;
        }).filter(Boolean);

        return JSON.stringify(results.length ? results : { message: "No logbook entries found for this date." });
      }

      case "query_tasks": {
        const activeOnly = args.active_only !== false;
        let query = supabase
          .from("temporary_tasks")
          .select("id, title, description, icon_name, accent_color, created_at, expires_at, completed_at, completed_by, is_active, is_recurring, frequency_type, task_style, show_on_dashboard, alarm_start_time, alarm_end_time, profiles!temporary_tasks_created_by_fkey(full_name)")
          .eq("location_id", args.location_id);

        if (activeOnly) query = query.eq("is_active", true);

        if (args.task_title) {
          query = query.ilike("title", `%${args.task_title}%`);
        }

        const { data: tasks, error: taskError } = await query.order("created_at", { ascending: false }).limit(50);
        if (taskError) {
          console.error("query_tasks error:", taskError);
          return JSON.stringify({ error: taskError.message });
        }

        const includeSubtasks = args.include_subtasks !== false;
        const taskIds = (tasks || []).map((t: any) => t.id);

        let subtaskMap: Record<string, any[]> = {};
        let completionMap: Record<string, any[]> = {};

        if (includeSubtasks && taskIds.length > 0) {
          // Get subtasks
          const { data: subtasks } = await supabase
            .from("temporary_task_subtasks")
            .select("id, task_id, title, order_index, completed_at, completed_by, item_type, days_of_week")
            .in("task_id", taskIds)
            .order("order_index");

          (subtasks || []).forEach((st: any) => {
            if (!subtaskMap[st.task_id]) subtaskMap[st.task_id] = [];
            subtaskMap[st.task_id].push(st);
          });

          // Get today's completions for recurring subtasks
          const targetDate = args.date || new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
          const { data: completions } = await supabase
            .from("task_subtask_completions")
            .select("subtask_id, task_id, completed_by, completed_date, completed_at")
            .in("task_id", taskIds)
            .eq("completed_date", targetDate);
          
          (completions || []).forEach((c: any) => {
            if (!completionMap[c.task_id]) completionMap[c.task_id] = [];
            completionMap[c.task_id].push(c);
          });

          // Also get alarm completions
          const { data: alarmCompletions } = await supabase
            .from("alarm_task_completions")
            .select("task_id, completed_by, completed_at, interval_key, profiles!alarm_task_completions_completed_by_fkey(full_name)")
            .in("task_id", taskIds)
            .gte("completed_at", `${targetDate}T00:00:00${offset}`)
            .lte("completed_at", `${targetDate}T23:59:59${offset}`);

          (alarmCompletions || []).forEach((c: any) => {
            if (!completionMap[c.task_id]) completionMap[c.task_id] = [];
            completionMap[c.task_id].push({ ...c, type: "alarm", completed_by_name: c.profiles?.full_name });
          });
        }

        // Get profile names for completed_by IDs
        const allCompletedByIds = new Set<string>();
        Object.values(subtaskMap).flat().forEach((st: any) => { if (st.completed_by) allCompletedByIds.add(st.completed_by); });
        Object.values(completionMap).flat().forEach((c: any) => { if (c.completed_by) allCompletedByIds.add(c.completed_by); });
        (tasks || []).forEach((t: any) => { if (t.completed_by) allCompletedByIds.add(t.completed_by); });

        let profileMap: Record<string, string> = {};
        if (allCompletedByIds.size > 0) {
          const { data: profiles } = await supabase
            .from("profiles")
            .select("id, full_name")
            .in("id", Array.from(allCompletedByIds));
          (profiles || []).forEach((p: any) => { profileMap[p.id] = p.full_name; });
        }

        const results = (tasks || []).map((t: any) => {
          const task: any = {
            title: t.title,
            description: t.description,
            style: t.task_style,
            is_recurring: t.is_recurring,
            frequency: t.frequency_type,
            created_by: t.profiles?.full_name,
            completed: !!t.completed_at,
            completed_by: t.completed_by ? profileMap[t.completed_by] : null,
          };

          if (t.alarm_start_time) {
            task.alarm_window = `${t.alarm_start_time} - ${t.alarm_end_time}`;
          }

          if (includeSubtasks && subtaskMap[t.id]) {
            const todayCompletions = completionMap[t.id] || [];
            task.subtasks = subtaskMap[t.id].map((st: any) => {
              const todayDone = todayCompletions.find((c: any) => c.subtask_id === st.id);
              return {
                title: st.title,
                type: st.item_type,
                completed: !!st.completed_at || !!todayDone,
                completed_by: todayDone?.completed_by_name || (todayDone?.completed_by ? profileMap[todayDone.completed_by] : null) || (st.completed_by ? profileMap[st.completed_by] : null),
              };
            });
            task.total_subtasks = task.subtasks.length;
            task.completed_subtasks = task.subtasks.filter((s: any) => s.completed).length;
          }

          if (completionMap[t.id]?.some((c: any) => c.type === "alarm")) {
            task.alarm_completions = completionMap[t.id]
              .filter((c: any) => c.type === "alarm")
              .map((c: any) => ({
                interval: c.interval_key,
                completed_by: c.completed_by_name || profileMap[c.completed_by],
                completed_at: c.completed_at,
              }));
          }

          return task;
        });

        return JSON.stringify(results.length ? results : { message: "No tasks found." });
      }

      case "query_labor_intelligence": {
        let query = supabase
          .from("labor_insights")
          .select("insight_date, analysis, created_at")
          .eq("location_id", args.location_id)
          .order("insight_date", { ascending: false })
          .limit(5);

        if (args.date) {
          query = supabase
            .from("labor_insights")
            .select("insight_date, analysis, created_at")
            .eq("location_id", args.location_id)
            .eq("insight_date", args.date)
            .limit(1);
        }

        const { data, error } = await query;
        if (error) {
          console.error("query_labor_intelligence error:", error);
          return JSON.stringify({ error: error.message });
        }

        const results = (data || []).map((r: any) => ({
          date: r.insight_date,
          ...r.analysis,
          generated_at: r.created_at,
        }));
        return JSON.stringify(results.length ? results : { message: "No labor intelligence reports found." });
      }

      case "query_inventory": {
        // First get count periods
        let countQuery = supabase
          .from("inventory_counts")
          .select("id, period_type, period_end_date, status, count_date, counted_at, completed_at, is_late_close, duration_seconds, notes, profiles!inventory_counts_counted_by_fkey(full_name)")
          .eq("location_id", args.location_id)
          .order("period_end_date", { ascending: false })
          .limit(10);

        if (args.period_end_date) {
          countQuery = countQuery.eq("period_end_date", args.period_end_date);
        }
        if (args.status) {
          countQuery = countQuery.eq("status", args.status);
        }

        const { data: counts, error: countError } = await countQuery;
        if (countError) {
          console.error("query_inventory error:", countError);
          return JSON.stringify({ error: countError.message });
        }

        const results = [];
        for (const count of (counts || [])) {
          const period: any = {
            period_type: count.period_type,
            period_end_date: count.period_end_date,
            status: count.status,
            counted_by: count.profiles?.full_name,
            counted_at: count.counted_at,
            is_late_close: count.is_late_close,
            duration_minutes: count.duration_seconds ? Math.round(count.duration_seconds / 60) : null,
          };

          if (args.include_items) {
            const { data: items } = await supabase
              .from("inventory_count_items")
              .select("quantity, entered_cases, entered_units, theoretical_quantity, variance, variance_cost, inventory_items(product_name, common_name, category, cost_per_case, cost_per_unit, pack_quantity)")
              .eq("count_id", count.id);

            let itemResults = (items || []).map((i: any) => {
              const item: any = {
                name: i.inventory_items?.common_name || i.inventory_items?.product_name,
                category: i.inventory_items?.category,
                quantity: i.quantity,
                cases: i.entered_cases,
                units: i.entered_units,
                cost_per_case: i.inventory_items?.cost_per_case,
                total_cost: i.quantity && i.inventory_items?.cost_per_unit ? Number((i.quantity * i.inventory_items.cost_per_unit).toFixed(2)) : null,
                variance: i.variance,
                variance_cost: i.variance_cost,
              };
              return item;
            });

            if (args.item_keyword) {
              const kw = args.item_keyword.toLowerCase();
              itemResults = itemResults.filter((i: any) => 
                (i.name || "").toLowerCase().includes(kw) || (i.category || "").toLowerCase().includes(kw)
              );
            }

            period.items = itemResults;
            period.total_items = itemResults.length;
            period.total_value = Number(itemResults.reduce((sum: number, i: any) => sum + (i.total_cost || 0), 0).toFixed(2));
          }

          results.push(period);
        }

        return JSON.stringify(results.length ? results : { message: "No inventory counts found." });
      }

      case "query_catering": {
        const endDate = args.end_date || args.start_date;
        let query = supabase
          .from("catering_orders")
          .select("customer_name, pickup_date, pickup_time, status, items, headcount, total_price, notes, order_number, vendor, contact_phone, source_url, completed_at, profiles!catering_orders_created_by_fkey(full_name)")
          .eq("location_id", args.location_id)
          .gte("pickup_date", args.start_date)
          .lte("pickup_date", endDate)
          .order("pickup_date")
          .order("pickup_time");

        if (args.status) query = query.eq("status", args.status);

        const { data, error } = await query;
        if (error) {
          console.error("query_catering error:", error);
          return JSON.stringify({ error: error.message });
        }

        let results = (data || []).map((o: any) => {
          const order: any = {
            customer: o.customer_name,
            pickup_date: o.pickup_date,
            pickup_time: o.pickup_time,
            status: o.status,
            headcount: o.headcount,
            total_price: o.total_price,
            items: o.items,
            notes: o.notes,
            order_number: o.order_number,
            vendor: o.vendor,
            contact_phone: o.contact_phone,
            created_by: o.profiles?.full_name,
          };
          return order;
        });

        if (args.customer_name) {
          const q = args.customer_name.toLowerCase();
          results = results.filter((o: any) => o.customer?.toLowerCase().includes(q));
        }

        return JSON.stringify(results.length ? results : { message: "No catering orders found for this date range." });
      }

      case "query_availability": {
        let query = supabase
          .from("availability_requests")
          .select("request_type, time_scope, start_date, end_date, start_time, end_time, hours_requested, status, notes, denial_reason, created_at, reviewed_at, profiles!availability_requests_user_id_fkey(full_name), reviewer:profiles!availability_requests_reviewed_by_fkey(full_name)")
          .eq("location_id", args.location_id)
          .order("start_date", { ascending: true });

        if (args.start_date) query = query.gte("start_date", args.start_date);
        if (args.end_date) query = query.lte("start_date", args.end_date);
        if (args.status) query = query.eq("status", args.status);

        const { data, error } = await query.limit(50);
        if (error) {
          console.error("query_availability error:", error);
          return JSON.stringify({ error: error.message });
        }

        let results = (data || []).map((r: any) => ({
          employee: r.profiles?.full_name,
          type: r.request_type,
          scope: r.time_scope,
          start_date: r.start_date,
          end_date: r.end_date,
          start_time: r.start_time,
          end_time: r.end_time,
          hours: r.hours_requested,
          status: r.status,
          notes: r.notes,
          denial_reason: r.denial_reason,
          requested_at: r.created_at,
          reviewed_by: r.reviewer?.full_name,
          reviewed_at: r.reviewed_at,
        }));

        if (args.employee_name) {
          const q = args.employee_name.toLowerCase();
          results = results.filter((r: any) => r.employee?.toLowerCase().includes(q));
        }

        return JSON.stringify(results.length ? results : { message: "No availability/time-off requests found." });
      }

      default:
        return JSON.stringify({ error: `Unknown tool: ${toolName}` });
    }
  } catch (e) {
    console.error(`Tool ${toolName} exception:`, e);
    return JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" });
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const authHeader = req.headers.get("authorization");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    
    const supabaseAdmin = createClient(supabaseUrl, supabaseKey);
    const supabaseUser = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader || "" } },
    });

    const { data: { user }, error: authError } = await supabaseUser.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: roleData } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .single();
    
    const managerRoles = ["shift_manager", "manager", "general_manager", "admin", "org_admin", "fbc", "brand_admin", "super_admin"];
    if (!roleData || !managerRoles.includes(roleData.role)) {
      return new Response(JSON.stringify({ error: "Insufficient permissions" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { messages, location_id, location_name } = await req.json();
    const timezone = "America/Los_Angeles";
    const today = new Date().toLocaleDateString("en-CA", { timeZone: timezone });
    const yesterday = new Date(Date.now() - 86400000).toLocaleDateString("en-CA", { timeZone: timezone });

    const nowLA = new Date(new Date().toLocaleString("en-US", { timeZone: timezone }));
    const dayOfWeek = nowLA.getDay(); // 0=Sun
    const mondayOffset = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    const monday = new Date(nowLA);
    monday.setDate(monday.getDate() - mondayOffset);
    const weekStart = monday.toLocaleDateString("en-CA");

    const systemPrompt = `You are CrooAI, an intelligent ops assistant for restaurant managers at ${location_name || "this location"}.

Current date: ${today} (timezone: ${timezone})
Yesterday: ${yesterday}
This week started (Monday): ${weekStart}
Location ID: ${location_id}

You have access to tools to query real-time data. ALWAYS use tools to get data before answering - never guess or say you can't access data.

CRITICAL RULES:
- NEVER expose internal tool names, parameter names, or technical details to the user. No references to "item_keyword", "include_responses", "start_date", "tool calls", etc. Speak naturally.
- When the user says "this week", use start_date=${weekStart} and end_date=${today}. When they say "last week", calculate the prior Monday-Sunday. When they say "this month", use the 1st of the current month to today. ALWAYS infer date ranges — never ask the user for dates unless truly ambiguous.
- Format currency with $ and commas. Format times in 12-hour AM/PM.
- Keep answers concise but complete.
- When comparing dates, query both dates.
- For product mix questions (e.g. "how many Detroit style pizzas"), use query_sales with include_product_mix=true.
- For employee punch questions (clock in/out, late arrivals), use query_labor with include_punches=true. To find late arrivals, also use query_schedule to compare scheduled start times with actual clock-in times.
- For ANY checklist question, use query_checklists. ALWAYS set checklist_title when the user mentions a checklist name. Set item_keyword when asking about a specific item.
- DOMAIN KNOWLEDGE: "Flip the line" or "flipping the line" means the Shift Change Line Check was completed. The submission time IS when the line was flipped. Answer with the submitter name and submitted_at time. Each response also has a completed_at timestamp and completed_by name — use these for item-level detail.
- For task questions (e.g. "what's incomplete on CrooHQ ideas"), use query_tasks with the task title.
- For logbook questions (drawer count, safe count, pass down, incident, maintenance, deposit), use query_logbook. Drawer counts contain denomination-level detail (coins, bills) and variance. Safe counts contain denomination counts per shift (AM/PM). Always show the specific details the user asks about — e.g. if they ask "how many quarters in the safe count", look in the counts object for quarters.
- For labor efficiency questions (labor grade, staffing suggestions, overstaffing), use query_labor_intelligence. It returns AI-generated grades (A-F), findings, and recommendations.
- For inventory/food cost questions (COGS, how much chicken, stock levels, count status), use query_inventory. Set include_items=true when asking about specific items. Use item_keyword to filter.
- For catering order questions (upcoming orders, customer details, catering revenue), use query_catering with the date range.
- For time-off/availability questions (who has off, pending requests, coverage), use query_availability. If no date range specified, default to the next 14 days for upcoming requests.
- "Today" = ${today}, "yesterday" = ${yesterday}.
- If a tool returns empty results, tell the user no data was found — don't say you encountered an error.
- Use markdown for formatting when it improves readability.`;

    const aiMessages = [
      { role: "system", content: systemPrompt },
      ...messages,
    ];

    let finalResponse: any = null;
    let loopCount = 0;
    const MAX_LOOPS = 5;
    let currentMessages = [...aiMessages];

    while (loopCount < MAX_LOOPS) {
      loopCount++;
      const aiResp = await fetch(AI_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: currentMessages,
          tools,
          tool_choice: "auto",
        }),
      });

      if (!aiResp.ok) {
        const status = aiResp.status;
        const errText = await aiResp.text();
        console.error("AI error:", status, errText);
        
        if (status === 429) {
          return new Response(JSON.stringify({ error: "Rate limited, please try again in a moment." }), {
            status: 429,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        if (status === 402) {
          return new Response(JSON.stringify({ error: "AI credits exhausted. Please add funds." }), {
            status: 402,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        throw new Error(`AI error: ${status}`);
      }

      const aiData = await aiResp.json();
      const choice = aiData.choices?.[0];
      
      if (!choice) throw new Error("No AI response");

      if (!choice.message.tool_calls || choice.message.tool_calls.length === 0) {
        finalResponse = choice.message.content;
        break;
      }

      currentMessages.push(choice.message);
      
      for (const tc of choice.message.tool_calls) {
        const args = typeof tc.function.arguments === "string" 
          ? JSON.parse(tc.function.arguments) 
          : tc.function.arguments;
        
        console.log(`Tool: ${tc.function.name}`, JSON.stringify(args));
        const result = await executeTool(supabaseAdmin, tc.function.name, args, timezone);
        console.log(`Tool result (${tc.function.name}): ${result.substring(0, 200)}...`);
        
        currentMessages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: result,
        });
      }
    }

    if (!finalResponse) {
      finalResponse = "I wasn't able to fully process your request. Please try rephrasing.";
    }

    return new Response(JSON.stringify({ content: finalResponse }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("Assistant error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
