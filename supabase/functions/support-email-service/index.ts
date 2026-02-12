import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";
import { Resend } from "https://esm.sh/resend@2.0.0";

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));
const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Queue an email for reliable delivery via email_queue table
async function queueEmail(opts: { from: string; to: string[]; subject: string; html: string; source: string; dedupKey?: string; metadata?: Record<string, any> }) {
  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  const { error } = await supabase.from('email_queue').insert({
    from_address: opts.from,
    to_addresses: opts.to,
    subject: opts.subject,
    html: opts.html,
    source: opts.source,
    dedup_key: opts.dedupKey || null,
    metadata: opts.metadata || {},
  });
  if (error) {
    console.error(`[support-email] Queue insert failed for "${opts.subject}":`, error);
    throw error;
  }
  console.log(`[support-email] Queued: "${opts.subject}" → ${opts.to.join(', ')}`);
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const primaryColor = "#0a7a8a";
const accentColor = "#f58220";
const backgroundColor = "#f0ebe1";
const textColor = "#0f1215";

function wrapEmail(content: string): string {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head><body style="margin:0;padding:0;background-color:${backgroundColor};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;"><table style="width:100%;border-collapse:collapse;"><tr><td style="padding:30px 20px;"><table style="max-width:560px;margin:0 auto;background-color:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.06);">${content}</table></td></tr></table></body></html>`;
}

function getEmailHeader(title: string): string {
  return `<tr><td style="background:linear-gradient(135deg,${primaryColor} 0%,#0d5a65 100%);padding:30px 40px;text-align:center;"><img src="https://croohq.com/assets/croo-logo-eWOfbANR.png" alt="Croo" style="height:50px;margin-bottom:12px;filter:brightness(0) invert(1);"/><h1 style="color:#fff;font-size:22px;font-weight:600;margin:0;">${title}</h1></td></tr>`;
}

function getEmailFooter(): string {
  return `<tr><td style="background-color:#f8f7f5;padding:24px 40px;border-top:1px solid #e8e5df;"><table role="presentation" style="width:100%;"><tr><td style="text-align:center;"><a href="https://croohq.com" style="display:inline-block;background:linear-gradient(135deg,${accentColor} 0%,#e06b10 100%);color:#fff;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:600;font-size:14px;margin-bottom:16px;">Open Croo</a><p style="color:#aaa;font-size:11px;margin:16px 0 0;">© ${new Date().getFullYear()} Croo. All rights reserved.</p></td></tr></table></td></tr>`;
}

function getCTAButton(url: string, text: string): string {
  return `<div style="text-align:center;"><a href="${url}" style="display:inline-block;background:linear-gradient(135deg,${accentColor} 0%,#e06b10 100%);color:#fff;text-decoration:none;padding:14px 32px;border-radius:10px;font-weight:600;">${text}</a></div>`;
}

// ============ SUPPORT TICKET ACTIONS ============

async function notifySupportTicket(payload: any): Promise<Response> {
  const { ticket_id, event_type, message_content, sender_name } = payload;
  
  if (!ticket_id || !event_type) {
    return new Response(JSON.stringify({ error: "ticket_id and event_type required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  const { data: ticket, error: ticketError } = await supabase
    .from("support_tickets")
    .select("*, profiles:user_id (full_name, email)")
    .eq("id", ticket_id)
    .single();

  if (ticketError || !ticket) {
    return new Response(JSON.stringify({ error: "Ticket not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const ticketNumber = `#SUP-${String(ticket.ticket_number).padStart(3, '0')}`;
  const userName = ticket.profiles?.full_name || "Unknown User";
  const categoryLabels: Record<string, string> = {
    ui_glitch: 'UI Glitch', broken_feature: 'Broken Feature', login_issues: 'Login Issues',
    data_sync_issues: 'Data/Sync Issues', notification_issues: 'Notification Issues',
    scheduling_issues: 'Scheduling Issues', other: 'Other',
  };
  const categoryLabel = categoryLabels[ticket.category] || ticket.category;

  let emailSubject = "";
  let emailContent = "";
  let pushTitle = "";
  let pushBody = "";

  switch (event_type) {
    case "new_ticket":
      emailSubject = `New Support Ticket ${ticketNumber} from ${userName}`;
      pushTitle = `New Support Ticket ${ticketNumber}`;
      pushBody = `${userName} reported: ${categoryLabel}`;
      emailContent = `
        <p style="color:${textColor};font-size:15px;margin:0 0 20px;">A new support ticket has been submitted.</p>
        <div style="background:${backgroundColor};border-radius:10px;padding:20px;margin-bottom:24px;">
          <table style="width:100%;">
            <tr><td style="padding:6px 0;"><span style="color:#666;font-size:12px;text-transform:uppercase;">Ticket</span><br/><strong style="color:${primaryColor};font-size:16px;">${ticketNumber}</strong></td></tr>
            <tr><td style="padding:6px 0;"><span style="color:#666;font-size:12px;text-transform:uppercase;">Category</span><br/><strong style="color:${textColor};font-size:14px;">${categoryLabel}</strong></td></tr>
            <tr><td style="padding:6px 0;"><span style="color:#666;font-size:12px;text-transform:uppercase;">From</span><br/><strong style="color:${textColor};font-size:14px;">${userName}</strong></td></tr>
          </table>
        </div>
        <div style="background:#fafafa;border-radius:10px;padding:16px;border-left:4px solid ${primaryColor};">
          <p style="color:#666;font-size:12px;text-transform:uppercase;margin:0 0 8px;">Description</p>
          <p style="color:${textColor};font-size:14px;line-height:1.5;margin:0;">${ticket.description}</p>
        </div>
      `;
      break;
    case "new_message":
      emailSubject = `New message on ${ticketNumber} from ${sender_name || userName}`;
      pushTitle = `Message on ${ticketNumber}`;
      pushBody = message_content?.substring(0, 100) || "New message received";
      emailContent = `
        <p style="color:${textColor};font-size:15px;margin:0 0 8px;">New message on <strong style="color:${primaryColor};">${ticketNumber}</strong></p>
        <p style="color:#666;font-size:13px;margin:0 0 20px;">From: ${sender_name || userName}</p>
        <div style="background:${backgroundColor};border-radius:10px;padding:16px;border-left:4px solid ${primaryColor};">
          <p style="color:${textColor};font-size:14px;line-height:1.5;margin:0;">${message_content || "(no content)"}</p>
        </div>
      `;
      break;
    default:
      return new Response(JSON.stringify({ success: true, message: "No action taken" }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const emailHtml = wrapEmail(`
    ${getEmailHeader("🎫 Support Notification")}
    <tr><td style="padding:30px 40px;">${emailContent}<div style="margin-top:24px;">${getCTAButton("https://croohq.com", "View in Croo")}</div></td></tr>
    ${getEmailFooter()}
  `);

  const SUPPORT_ADMIN_EMAILS = ["jordan@jo-pizza.com"];
  const { data: adminProfiles } = await supabase.from("profiles").select("id, email").in("email", SUPPORT_ADMIN_EMAILS);
  const adminIds = adminProfiles?.map(p => p.id) || [];
  const adminEmails = adminProfiles?.map(p => p.email).filter(Boolean) || [];

  for (const email of adminEmails) {
    try {
      await queueEmail({
        from: "CrooHQ Support <support@croohq.email>",
        to: [email],
        subject: emailSubject,
        html: emailHtml,
        source: 'support_ticket',
        dedupKey: `support_${event_type}_${ticket_id}_${email}`,
      });
    } catch (e) {
      console.error("Error queuing email to", email, e);
    }
  }

  if (adminIds.length > 0) {
    try {
      await supabase.functions.invoke("send-push-notification", {
        body: { user_ids: adminIds, title: pushTitle, body: pushBody, data: { type: "support_ticket", ticketId: ticket.id }, notification_type: "support_tickets" },
      });
    } catch (e) {
      console.error("Error sending push:", e);
    }
  }

  return new Response(JSON.stringify({ success: true }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

async function sendSupportResolution(payload: any): Promise<Response> {
  const { ticketId } = payload;
  if (!ticketId) return new Response(JSON.stringify({ error: "ticketId required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  const { data: ticket } = await supabase.from("support_tickets").select("*, profiles:user_id (full_name, email)").eq("id", ticketId).single();
  if (!ticket) return new Response(JSON.stringify({ error: "Ticket not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  const ticketNumber = `#SUP-${String(ticket.ticket_number).padStart(3, '0')}`;
  const userEmail = ticket.profiles?.email;
  const userName = ticket.profiles?.full_name || "Team Member";
  const firstName = userName.split(' ')[0];

  if (userEmail) {
    await queueEmail({
      from: "CrooHQ Support <support@croohq.email>",
      to: [userEmail],
      subject: `Your support ticket ${ticketNumber} has been resolved`,
      html: wrapEmail(`<tr><td style="background:linear-gradient(135deg,${primaryColor} 0%,#0d5a65 100%);padding:30px 40px;text-align:center;"><img src="https://croohq.com/assets/croo-logo-eWOfbANR.png" alt="Croo" style="height:50px;margin-bottom:12px;filter:brightness(0) invert(1);"/><h1 style="color:#fff;font-size:22px;margin:0;">✅ Ticket Resolved</h1></td></tr><tr><td style="padding:30px 40px;"><p style="color:${textColor};font-size:15px;margin:0 0 16px;">Good news, ${firstName}! 🎉</p><p style="color:${textColor};font-size:15px;margin:0 0 20px;">Your support ticket <strong style="color:${primaryColor};">${ticketNumber}</strong> has been resolved.</p><div style="background:${backgroundColor};border-radius:10px;padding:16px;margin-bottom:24px;border-left:4px solid ${primaryColor};"><p style="color:#666;font-size:12px;margin:0 0 8px;">Original Issue</p><p style="color:${textColor};font-size:14px;margin:0;">${ticket.description}</p></div><div style="text-align:center;"><a href="https://croohq.com" style="display:inline-block;background:linear-gradient(135deg,${accentColor} 0%,#e06b10 100%);color:#fff;text-decoration:none;padding:14px 32px;border-radius:10px;font-weight:600;">Open Croo</a></div></td></tr>`),
      source: 'support_resolution',
      dedupKey: `support_resolution_${ticketId}`,
    });
  }

  // Send push notification to the ticket owner
  try {
    await supabase.functions.invoke("send-push-notification", {
      body: {
        user_ids: [ticket.user_id],
        title: `Ticket ${ticketNumber} Resolved`,
        body: "Your support ticket has been resolved.",
        notification_type: "support_tickets",
        data: { type: "support_resolved", ticketId: ticket.id },
      },
    });
  } catch (pushErr) {
    console.error("Error sending resolution push notification:", pushErr);
  }

  return new Response(JSON.stringify({ success: true }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

// ============ DAILY LOGBOOK SUMMARY ============

async function sendDailyLogbookSummary(payload: any): Promise<Response> {
  const { location_id, entry_date } = payload;
  
  if (!location_id || !entry_date) {
    return new Response(JSON.stringify({ error: "location_id and entry_date required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  // Parse entry_date safely to get same-day-last-week and same-day-last-year
  const [yr, mo, dy] = entry_date.split("-").map(Number);
  const entryLocal = new Date(yr, mo - 1, dy);
  const dayOfWeek = entryLocal.getDay();

  const lastWeekDate = new Date(yr, mo - 1, dy - 7);
  const lwStr = `${lastWeekDate.getFullYear()}-${String(lastWeekDate.getMonth() + 1).padStart(2, "0")}-${String(lastWeekDate.getDate()).padStart(2, "0")}`;

  const lastYearDate = new Date(yr - 1, mo - 1, dy);
  // Find same day-of-week in the previous year (closest match)
  const lyDow = lastYearDate.getDay();
  const diff = dayOfWeek - lyDow;
  lastYearDate.setDate(lastYearDate.getDate() + diff);
  const lyStr = `${lastYearDate.getFullYear()}-${String(lastYearDate.getMonth() + 1).padStart(2, "0")}-${String(lastYearDate.getDate()).padStart(2, "0")}`;

  // Parallel data fetches
  const [
    { data: location },
    { data: salesData },
    { data: compSales },
    { data: laborData },
    { data: locationSettings },
    { data: logbookEntries },
    { data: checklistSubs },
    { data: activeChecklists },
    { data: locationUsers },
  ] = await Promise.all([
    supabase.from("locations").select("id, name, organization_id").eq("id", location_id).single(),
    supabase.from("sales_cache").select("net_sales, guest_count, pizza_count, avg_ticket, projected_sales, override_projection, living_projection, initial_projection, product_mix, yoy_net_sales").eq("location_id", location_id).eq("sale_date", entry_date).maybeSingle(),
    supabase.from("sales_cache").select("sale_date, net_sales").eq("location_id", location_id).in("sale_date", [lwStr, lyStr]),
    supabase.from("labor_cache").select("labor_hours, labor_cost").eq("location_id", location_id).eq("labor_date", entry_date),
    supabase.from("location_settings").select("labor_percentage_target").eq("location_id", location_id).maybeSingle(),
    supabase.from("logbook_entries").select(`id, entry_date, created_at, category:category_id (name), created_by_profile:created_by (full_name)`).eq("location_id", location_id).eq("entry_date", entry_date),
    supabase.from("checklist_submissions").select("id, checklist_id, submitted_at, submitted_by_profile:submitted_by (full_name)").eq("location_id", location_id).gte("submitted_at", entry_date + "T00:00:00").lt("submitted_at", entry_date + "T23:59:59"),
    supabase.from("checklists").select("id, title, frequency").eq("location_id", location_id).eq("is_active", true),
    supabase.from("user_locations").select("user_id").eq("location_id", location_id),
  ]);

  if (!location) {
    return new Response(JSON.stringify({ error: "Location not found", success: false }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  // Get cash handling logbook entry values
  const cashCategories = ["Drawer Count", "Safe Count", "Bank Deposit"];
  const cashEntries = (logbookEntries || []).filter((e: any) => cashCategories.includes(e.category?.name));
  let cashDetails: { category: string; author: string; fields: { name: string; value: string }[] }[] = [];
  
  if (cashEntries.length > 0) {
    const entryIds = cashEntries.map((e: any) => e.id);
    const { data: entryValues } = await supabase
      .from("logbook_entry_values")
      .select("entry_id, value_text, value_number, field:field_id (field_name)")
      .in("entry_id", entryIds);
    
    cashDetails = cashEntries.map((entry: any) => {
      const vals = (entryValues || []).filter((v: any) => v.entry_id === entry.id);
      const fields: { name: string; value: string }[] = [];
      
      for (const v of vals) {
        const fieldName = v.field?.field_name || "";
        if (fieldName.includes("_data") && v.value_text) {
          try {
            const parsed = JSON.parse(v.value_text);
            if (parsed.totalSafe !== undefined) fields.push({ name: "Total Safe", value: `$${Number(parsed.totalSafe).toLocaleString()}` });
            if (parsed.difference !== undefined) fields.push({ name: "Difference", value: `$${Number(parsed.difference).toLocaleString()}` });
            if (parsed.shift) fields.push({ name: "Shift", value: parsed.shift });
            if (parsed.totalDrawer !== undefined) fields.push({ name: "Total Drawer", value: `$${Number(parsed.totalDrawer).toLocaleString()}` });
            if (parsed.actualDeposit !== undefined) fields.push({ name: "Actual Deposit", value: `$${Number(parsed.actualDeposit).toLocaleString()}` });
            if (parsed.expectedDeposit !== undefined) fields.push({ name: "Expected Deposit", value: `$${Number(parsed.expectedDeposit).toLocaleString()}` });
            if (parsed.variance !== undefined) fields.push({ name: "Variance", value: `$${Number(parsed.variance).toLocaleString()}` });
          } catch {}
        } else if (v.value_number !== null && v.value_number !== undefined) {
          fields.push({ name: fieldName, value: `$${Number(v.value_number).toLocaleString()}` });
        } else if (v.value_text) {
          fields.push({ name: fieldName, value: v.value_text });
        }
      }
      return { category: entry.category?.name || "Cash", author: entry.created_by_profile?.full_name || "Unknown", completedAt: entry.created_at, fields };
    });
  }

  // Recipients - managers and above
  const userIds = (locationUsers || []).map((u: any) => u.user_id);
  const managerRoles = ["admin", "org_admin", "super_admin", "manager", "general_manager"];
  let eligibleRecipients: { id: string; email: string; full_name: string }[] = [];

  if (userIds.length > 0) {
    const [{ data: profiles }, { data: roles }] = await Promise.all([
      supabase.from("profiles").select("id, email, full_name").in("id", userIds),
      supabase.from("user_roles").select("user_id, role").in("user_id", userIds),
    ]);
    const roleMap = new Map((roles || []).map((r: any) => [r.user_id, r.role]));
    eligibleRecipients = (profiles || []).filter((p: any) => {
      const role = roleMap.get(p.id);
      return managerRoles.includes(role) && p.email;
    });
  }

  console.log(`[DAILY-SUMMARY] Location ${location?.name}: ${eligibleRecipients.length} eligible recipients`);

  if (eligibleRecipients.length === 0) {
    return new Response(JSON.stringify({ success: true, message: "No eligible recipients", recipientCount: 0 }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  // ---- Calculations ----
  const netSales = salesData?.net_sales || 0;
  const projection = salesData?.override_projection || salesData?.living_projection || salesData?.initial_projection || salesData?.projected_sales || 0;
  const projVariance = projection > 0 ? ((netSales - projection) / projection * 100) : 0;
  const projVarianceStr = projVariance.toFixed(1);
  const projColor = projVariance >= 0 ? "#22c55e" : "#ef4444";
  const projDiff = netSales - projection;

  // Last week & last year comparisons
  const lwSales = (compSales || []).find((s: any) => s.sale_date === lwStr)?.net_sales || 0;
  const lySales = salesData?.yoy_net_sales || (compSales || []).find((s: any) => s.sale_date === lyStr)?.net_sales || 0;
  const lwPct = lwSales > 0 ? ((netSales - lwSales) / lwSales * 100).toFixed(1) : null;
  const lyPct = lySales > 0 ? ((netSales - lySales) / lySales * 100).toFixed(1) : null;

  // Labor
  const totalLaborHours = laborData?.reduce((sum: number, l: any) => sum + (l.labor_hours || 0), 0) || 0;
  const totalLaborCost = laborData?.reduce((sum: number, l: any) => sum + (l.labor_cost || 0), 0) || 0;
  const laborPercent = netSales > 0 ? (totalLaborCost / netSales * 100) : 0;
  const laborGoal = locationSettings?.labor_percentage_target || 25;
  const laborGoalDollars = netSales * (laborGoal / 100);
  const laborOverUnder = totalLaborCost - laborGoalDollars;
  const laborColor = laborPercent <= laborGoal ? "#22c55e" : "#ef4444";

  // Top 5 items from product_mix
  let topItems: { name: string; qty: number; sales: number }[] = [];
  if (salesData?.product_mix && Array.isArray(salesData.product_mix)) {
    topItems = (salesData.product_mix as any[])
      .filter((i: any) => i.sales > 0)
      .sort((a: any, b: any) => (b.sales || 0) - (a.sales || 0))
      .slice(0, 5)
      .map((i: any) => ({ name: i.name || i.itemName || "Item", qty: i.quantity || i.qty || 0, sales: i.sales || 0 }));
  }

  // Checklists: match submissions to active daily + dynamic checklists
  const dailyChecklists = (activeChecklists || []).filter((c: any) => c.frequency === "daily" || c.template_type === "dynamic");
  const checklistMap = new Map((activeChecklists || []).map((c: any) => [c.id, c.title]));
  const completedIds = new Set((checklistSubs || []).map((s: any) => s.checklist_id));
  
  // De-duplicate: dynamic checklists may have multiple submissions
  const seenChecklistIds = new Set<string>();
  const checklistRows: { title: string; completed: boolean; completedBy: string | null }[] = [];
  
  for (const c of dailyChecklists) {
    if (seenChecklistIds.has(c.id)) continue;
    seenChecklistIds.add(c.id);
    const completed = completedIds.has(c.id);
    const sub = (checklistSubs || []).find((s: any) => s.checklist_id === c.id);
    checklistRows.push({ title: c.title, completed, completedBy: sub?.submitted_by_profile?.full_name || null });
  }
  // Add any other checklists that were completed today but not in daily/dynamic list
  for (const sub of (checklistSubs || [])) {
    if (!seenChecklistIds.has(sub.checklist_id)) {
      seenChecklistIds.add(sub.checklist_id);
      checklistRows.push({
        title: checklistMap.get(sub.checklist_id) || "Checklist",
        completed: true,
        completedBy: sub?.submitted_by_profile?.full_name || null,
      });
    }
  }

  // Non-cash logbook entries
  const logEntries = (logbookEntries || []).filter((e: any) => !cashCategories.includes(e.category?.name));

  // Format date - computed below using parsed yr/mo/dy to avoid timezone bugs

  // Helper for comparison badges
  const compBadge = (pct: string | null, label: string) => {
    if (pct === null) return `<span style="color:#999;font-size:12px;">${label}: N/A</span>`;
    const n = parseFloat(pct);
    const c = n >= 0 ? "#22c55e" : "#ef4444";
    const arrow = n >= 0 ? "▲" : "▼";
    return `<span style="color:${c};font-size:13px;font-weight:600;">${arrow} ${n >= 0 ? "+" : ""}${pct}% ${label}</span>`;
  };

  // ---- Build Email HTML ----
  const dayNames = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
  const dayNamesShort = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  const monthNames = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  const monthNamesShort = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const shortDate = `${dayNamesShort[dayOfWeek]}, ${monthNamesShort[mo - 1]} ${dy}`;
  const displayDate = `${dayNames[dayOfWeek]}, ${monthNames[mo - 1]} ${dy}, ${yr}`;
  const completedCount = checklistRows.filter(c => c.completed).length;
  const totalChecklists = checklistRows.length;

  // Wider daily summary email with clean Croo branding
  const emailHtml = `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:${backgroundColor};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table style="width:100%;border-collapse:collapse;"><tr><td style="padding:24px 16px;">
<table style="max-width:680px;margin:0 auto;background-color:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.06);">

  <!-- HEADER -->
  <tr><td style="background:linear-gradient(135deg,${primaryColor} 0%,#0d5a65 100%);padding:24px 32px;text-align:center;">
    <h1 style="color:#fff;font-size:22px;font-weight:700;margin:0;">Daily Summary</h1>
    <p style="color:rgba(255,255,255,0.8);font-size:14px;margin:6px 0 0;">${location.name} &middot; ${shortDate}</p>
  </td></tr>

  <tr><td style="padding:28px 32px;">

    <!-- SALES + LABOR ROW -->
    <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
      <tr>
        <td style="vertical-align:top;width:55%;padding-right:16px;">
          <p style="color:${primaryColor};font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin:0 0 8px;">Sales</p>
          <p style="margin:0;"><strong style="color:${textColor};font-size:28px;">$${netSales.toLocaleString()}</strong></p>
          <p style="color:#888;font-size:13px;margin:4px 0 0;">Target: $${projection.toLocaleString()} (<span style="color:${projColor};font-weight:600;">${projDiff >= 0 ? "+" : ""}$${Math.abs(projDiff).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</span>)</p>
          <table style="margin-top:8px;"><tr>
            <td style="padding-right:16px;">${compBadge(lwPct, "LW")}</td>
            <td>${compBadge(lyPct, "LY")}</td>
          </tr></table>
        </td>
        <td style="vertical-align:top;text-align:right;border-left:1px solid #e8e5df;padding-left:16px;">
          <p style="color:${primaryColor};font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin:0 0 8px;">Labor</p>
          <p style="margin:0;"><strong style="color:${laborColor};font-size:28px;">${laborPercent.toFixed(1)}%</strong></p>
          <p style="color:#888;font-size:13px;margin:4px 0 0;">$${totalLaborCost.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })} &middot; ${totalLaborHours.toFixed(1)}h</p>
          <p style="color:${laborColor};font-size:13px;font-weight:600;margin:4px 0 0;">${laborOverUnder > 0 ? "+" : "-"}$${Math.abs(laborOverUnder).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })} vs ${laborGoal}% goal</p>
        </td>
      </tr>
    </table>

    <div style="border-top:1px solid #e8e5df;margin-bottom:20px;"></div>

    <!-- CHECKLISTS -->
    <p style="color:${primaryColor};font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin:0 0 12px;">Checklists ${completedCount}/${totalChecklists}</p>
    ${checklistRows.length > 0 ? checklistRows.map(c => {
      const barColor = c.completed ? '#22c55e' : '#e8e5df';
      return `<div style="margin-bottom:10px;">
        <p style="margin:0 0 4px;font-size:13px;color:${textColor};font-weight:600;">${c.title}</p>
        <div style="background:#e8e5df;border-radius:4px;height:8px;width:100%;overflow:hidden;margin-bottom:2px;">
          <div style="background:${barColor};height:100%;width:${c.completed ? '100' : '0'}%;border-radius:4px;"></div>
        </div>
        <p style="margin:0;font-size:11px;color:#888;">${c.completed ? `Completed by ${c.completedBy || 'Unknown'}` : '<span style="color:#ef4444;">Not Completed</span>'}</p>
      </div>`;
    }).join("") : `<p style="color:#888;font-size:13px;margin:0;">None scheduled</p>`}

    <div style="border-top:1px solid #e8e5df;margin:20px 0;"></div>

    <!-- CASH HANDLING -->
    <table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
      <tr>
        <td style="vertical-align:top;width:50%;padding-right:16px;">
          <p style="color:${primaryColor};font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin:0 0 10px;">Safe Count</p>
          ${(() => {
            const safeCounts = cashDetails.filter(c => c.category === "Safe Count");
            if (safeCounts.length === 0) return `<p style="color:#ef4444;font-size:13px;font-weight:600;margin:0;">Not Completed</p>`;
            return safeCounts.map(c => {
              const shiftField = c.fields.find(f => f.name === "Shift");
              const completedTime = c.completedAt ? new Date(c.completedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true }) : "";
              return `<p style="margin:0 0 2px;font-size:13px;color:${textColor};"><strong>${shiftField ? shiftField.value : ""}</strong></p>
                <p style="margin:0 0 6px;font-size:13px;"><span style="color:#22c55e;font-weight:600;">Completed</span>${completedTime ? ` at ${completedTime}` : ""} - ${c.author}</p>`;
            }).join("");
          })()}
        </td>
        <td style="vertical-align:top;border-left:1px solid #e8e5df;padding-left:16px;">
          <p style="color:${primaryColor};font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin:0 0 10px;">Drawer Count</p>
          ${(() => {
            const drawerCounts = cashDetails.filter(c => c.category === "Drawer Count");
            if (drawerCounts.length === 0) return `<p style="color:#ef4444;font-size:13px;font-weight:600;margin:0;">Not Completed</p>`;
            return drawerCounts.map(c => {
              const shiftField = c.fields.find(f => f.name === "Shift");
              const depositField = c.fields.find(f => f.name === "Actual Deposit") || c.fields.find(f => f.name.includes("Deposit"));
              const expectedField = c.fields.find(f => f.name === "Expected Deposit") || c.fields.find(f => f.name.includes("Expected"));
              const varianceField = c.fields.find(f => f.name === "Variance") || c.fields.find(f => f.name === "Difference");
              const depositVal = depositField?.value || "$0";
              const expectedVal = expectedField?.value || "$0";
              const varianceNum = varianceField ? parseFloat(varianceField.value.replace(/[^0-9.-]/g, '')) : 0;
              const overUnder = varianceNum > 0 ? `<span style="color:#22c55e;">Over $${Math.abs(varianceNum).toLocaleString()}</span>` : varianceNum < 0 ? `<span style="color:#ef4444;">Under $${Math.abs(varianceNum).toLocaleString()}</span>` : `<span style="color:#22c55e;">Even</span>`;
              const shiftLabel = shiftField?.value || "";
              return `<p style="margin:0 0 2px;font-size:13px;color:${textColor};"><strong>${shiftLabel}</strong></p>
                <p style="margin:0 0 6px;font-size:13px;color:#888;">${depositVal} / ${expectedVal} (${overUnder}) - ${c.author}</p>`;
            }).join("");
          })()}
        </td>
      </tr>
    </table>
    ${(() => {
      const bankDeposits = cashDetails.filter(c => c.category === "Bank Deposit");
      if (bankDeposits.length === 0) return '';
      return `<p style="color:${primaryColor};font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin:0 0 10px;">Bank Deposit</p>` +
        bankDeposits.map(c => {
          const amountField = c.fields.find(f => f.name !== "Shift");
          return `<p style="margin:0 0 6px;font-size:13px;color:#888;">${amountField?.value || ""} - ${c.author}</p>`;
        }).join("");
    })()}
    ${logEntries.length > 0 ? `
      <p style="color:${primaryColor};font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin:12px 0 10px;">Log Entries</p>
      ${logEntries.map((e: any) => 
        `<p style="margin:0 0 4px;font-size:13px;color:${textColor};">${e.category?.name || "Entry"} - <span style="color:#888;">${e.created_by_profile?.full_name || ""}</span></p>`
      ).join("")}
    ` : ""}

    ${topItems.length > 0 ? `
    <div style="border-top:1px solid #e8e5df;margin-bottom:20px;"></div>

    <!-- TOP 5 ITEMS -->
    <p style="color:${primaryColor};font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin:0 0 10px;">Top Items by Sales</p>
    <table style="width:100%;border-collapse:collapse;">
      ${topItems.map((item, i) => `
      <tr style="border-bottom:1px solid #f0ebe1;">
        <td style="padding:6px 0;color:${primaryColor};font-weight:700;font-size:14px;width:24px;">${i + 1}</td>
        <td style="padding:6px 0;color:${textColor};font-size:13px;">${item.name}</td>
        <td style="padding:6px 0;color:#888;font-size:13px;text-align:center;width:50px;">${item.qty}</td>
        <td style="padding:6px 0;color:${textColor};font-size:13px;text-align:right;font-weight:600;width:70px;">$${item.sales.toLocaleString()}</td>
      </tr>`).join("")}
    </table>
    ` : `
    <div style="border-top:1px solid #e8e5df;margin-bottom:20px;"></div>
    <p style="color:${primaryColor};font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin:0 0 10px;">Top Items by Sales</p>
    <p style="color:#888;font-size:13px;margin:0;">No sales data available</p>
    `}

  </td></tr>

  <!-- FOOTER -->
  <tr><td style="padding:24px 32px;text-align:center;border-top:1px solid #e8e5df;">
    <p style="color:${primaryColor};font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:2px;margin:0 0 8px;">POWERED BY CROO</p>
    <img src="https://croohq.com/assets/croo-logo-eWOfbANR.png" alt="Croo" style="height:20px;opacity:0.3;margin-bottom:6px;"/>
    <p style="color:#bbb;font-size:10px;margin:0;">&copy; ${new Date().getFullYear()} Croo. All rights reserved.</p>
  </td></tr>

</table>
</td></tr></table>
</body></html>`;

  // If preview mode, return HTML without sending
  if (payload.preview) {
    return new Response(JSON.stringify({ success: true, html: emailHtml }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  // Send to all eligible recipients
  let sentCount = 0;
  for (const recipient of eligibleRecipients) {
    try {
      await queueEmail({
        from: "CrooHQ <reports@croohq.email>",
        to: [recipient.email],
        subject: `Daily Summary: ${location.name} - ${shortDate}`,
        html: emailHtml,
        source: 'daily_summary',
        dedupKey: `daily_summary_v5_${location_id}_${entry_date}_${recipient.email}`,
      });
      sentCount++;
    } catch (e) {
      console.error("Error queuing daily summary for", (recipient as any).email, e);
    }
  }

  // Log the send
  await supabase
    .from("daily_summary_logs")
    .upsert({
      location_id,
      summary_date: entry_date,
      recipient_count: sentCount,
    }, { onConflict: "location_id,summary_date" });

  return new Response(JSON.stringify({ success: true, recipientCount: sentCount }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

// ============ TEST EMAIL ============

async function sendTestEmail(payload: any): Promise<Response> {
  const { to, subject = "Welcome to Croo!" } = payload;
  if (!to) return new Response(JSON.stringify({ error: "to required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  const emailResponse = await resend.emails.send({
    from: "CrooHQ <hello@croohq.email>",
    to: [to],
    subject,
    html: wrapEmail(`<tr><td style="background:linear-gradient(135deg,${primaryColor} 0%,#0d5a65 100%);padding:40px;text-align:center;"><img src="https://croohq.com/assets/croo-logo-eWOfbANR.png" alt="Croo" style="height:80px;margin-bottom:16px;filter:brightness(0) invert(1);"/><h1 style="color:#fff;font-size:28px;margin:0;">Welcome to Croo!</h1></td></tr><tr><td style="padding:40px;"><p style="color:${textColor};font-size:16px;">Hey there! 👋</p><p style="color:${textColor};font-size:16px;">This is a test email from <strong style="color:${primaryColor};">Croo</strong>.</p></td></tr>`),
  });

  return new Response(JSON.stringify({ success: true, data: emailResponse }), { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } });
}

// ============ BATCH TEST EMAILS ============

async function sendAllTestEmails(payload: any): Promise<Response> {
  const { to } = payload;
  
  if (!to) {
    throw new Error("Email address is required");
  }

  console.log(`Sending all test emails to: ${to}`);

  const testEmails = [
    {
      subject: '💬 New message from Sarah Johnson',
      html: (content: string) => wrapEmail(`
        ${getEmailHeader('New Chat Message', '💬')}
        <tr>
          <td style="padding: 30px 40px;">
            <p style="color: ${textColor}; font-size: 15px; line-height: 1.6; margin: 0 0 16px;">
              <strong style="color: ${primaryColor};">Sarah Johnson</strong> sent you a message in <strong>Hemet Team Chat</strong>:
            </p>
            <div style="background-color: ${backgroundColor}; border-radius: 10px; padding: 16px; margin: 16px 0; border-left: 4px solid ${primaryColor};">
              <p style="color: ${textColor}; font-size: 14px; line-height: 1.5; margin: 0; font-style: italic;">
                "Hey! Can you cover my shift tomorrow? I have a doctor's appointment 🙏"
              </p>
            </div>
            <p style="color: #666; font-size: 13px; margin: 16px 0 0;">
              Tap below to view and reply.
            </p>
          </td>
        </tr>
        ${getEmailFooter()}
      `)
    },
    {
      subject: '📢 New Announcement: Holiday Schedule Update',
      html: (content: string) => wrapEmail(`
        ${getEmailHeader('New Announcement', '📢')}
        <tr>
          <td style="padding: 30px 40px;">
            <h2 style="color: ${textColor}; font-size: 18px; font-weight: 600; margin: 0 0 16px;">
              Holiday Schedule Update
            </h2>
            <div style="background-color: ${backgroundColor}; border-radius: 10px; padding: 20px; margin: 16px 0;">
              <p style="color: ${textColor}; font-size: 14px; line-height: 1.6; margin: 0;">
                Quick reminder: We'll be running special holiday hours next week. Please check your schedule carefully and let me know if you have any conflicts. Thanks team! 🎄
              </p>
            </div>
            <p style="color: #666; font-size: 13px; margin: 16px 0 0;">
              Posted by <strong>Mike Thompson</strong> at Hemet
            </p>
          </td>
        </tr>
        ${getEmailFooter()}
      `)
    },
    {
      subject: '📅 Schedule Update: New shift added',
      html: (content: string) => wrapEmail(`
        ${getEmailHeader('Schedule Update', '📅')}
        <tr>
          <td style="padding: 30px 40px;">
            <p style="color: ${textColor}; font-size: 15px; line-height: 1.6; margin: 0 0 16px;">
              A new shift has been added to your schedule.
            </p>
            <div style="background-color: ${backgroundColor}; border-radius: 10px; padding: 16px; margin: 16px 0;">
              <table role="presentation" style="width: 100%;">
                <tr>
                  <td style="padding: 8px 0;">
                    <span style="color: #666; font-size: 12px; text-transform: uppercase;">Date</span><br/>
                    <strong style="color: ${textColor}; font-size: 15px;">Monday, January 13, 2026</strong>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 8px 0;">
                    <span style="color: #666; font-size: 12px; text-transform: uppercase;">Time</span><br/>
                    <strong style="color: ${textColor}; font-size: 15px;">9:00 AM - 5:00 PM</strong>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 8px 0;">
                    <span style="color: #666; font-size: 12px; text-transform: uppercase;">Position</span><br/>
                    <strong style="color: ${textColor}; font-size: 15px;">Shift Leader</strong>
                  </td>
                </tr>
              </table>
            </div>
            <p style="color: #666; font-size: 13px; margin: 16px 0 0;">
              Check the app to view your full schedule.
            </p>
          </td>
        </tr>
        ${getEmailFooter()}
      `)
    },
  ];

  const results = [];
  
  // Send emails with a small delay between each
  for (let i = 0; i < testEmails.length; i++) {
    const email = testEmails[i];
    
    try {
      const emailResponse = await resend.emails.send({
        from: "CrooHQ <hello@croohq.email>",
        to: [to],
        subject: `[TEST ${i + 1}/${testEmails.length}] ${email.subject}`,
        html: email.html(''),
      });
      
      results.push({ subject: email.subject, success: true, id: emailResponse.data?.id });
      console.log(`Sent email ${i + 1}: ${email.subject}`);
      
      // Small delay to avoid rate limiting
      if (i < testEmails.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    } catch (error: any) {
      results.push({ subject: email.subject, success: false, error: error.message });
      console.error(`Failed to send email ${i + 1}: ${error.message}`);
    }
  }

  return new Response(JSON.stringify({ 
    success: true, 
    total: testEmails.length,
    results 
  }), {
    status: 200,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

// ============ HANDLER ============

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { action, payload } = await req.json();
    
    if (!action) {
      return new Response(JSON.stringify({ error: "action required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    switch (action) {
      case "support_ticket": return await notifySupportTicket(payload);
      case "send_support_resolution": return await sendSupportResolution(payload);
      case "send_daily_logbook_summary": return await sendDailyLogbookSummary(payload);
      case "send_test": return await sendTestEmail(payload);
      case "send_all_test_emails": return await sendAllTestEmails(payload);
      default:
        return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
  } catch (error: any) {
    console.error("Error in support-email-service:", error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
};

serve(handler);
