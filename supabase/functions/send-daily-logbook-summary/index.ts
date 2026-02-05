import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.4';
import { Resend } from "https://esm.sh/resend@2.0.0";

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface DailyLogbookSummaryRequest {
  location_id: string;
  entry_date: string;
  test_mode?: boolean;
  test_email?: string;
  preview_only?: boolean; // New: return data preview without sending email
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(amount);
}

function formatDateForDisplay(dateStr: string): string {
  if (!dateStr) return 'Unknown Date';
  const parts = dateStr.split('-');
  if (parts.length === 3) {
    const year = parseInt(parts[0]);
    const month = parseInt(parts[1]) - 1;
    const day = parseInt(parts[2]);
    const date = new Date(year, month, day, 12, 0, 0);
    if (!isNaN(date.getTime())) {
      return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    }
  }
  return dateStr;
}

// Helpers for timezone-safe date handling
function getLocalDateString(iso: string, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(iso));
  } catch {
    return iso.slice(0, 10);
  }
}

// Fetch labor data from labor_cache - same source as Dashboard
// Prioritizes punch_clock data over qubeyond data (matches Dashboard behavior)
async function fetchLaborData(supabase: any, locationId: string, dateStr: string) {
  try {
    console.log(`[labor] Fetching from labor_cache for ${dateStr}`);
    
    // Query labor_cache - prioritize punch_clock source over qubeyond
    const { data: laborEntries, error: laborError } = await supabase
      .from('labor_cache')
      .select('labor_cost, labor_hours, regular_hours, overtime_hours, double_time_hours, source')
      .eq('location_id', locationId)
      .eq('labor_date', dateStr);

    if (laborError) {
      console.error('[labor] labor_cache query error:', laborError);
      return { hoursWorked: 0, laborCost: 0, hasData: false };
    }

    if (!laborEntries || laborEntries.length === 0) {
      console.log('[labor] No labor_cache entry found for this date');
      return { hoursWorked: 0, laborCost: 0, hasData: false };
    }

    // Prioritize punch_clock over qubeyond (same logic as Dashboard/fetch-qubeyond-sales)
    let selectedEntry = laborEntries[0];
    for (const entry of laborEntries) {
      if (entry.source === 'punch_clock') {
        selectedEntry = entry;
        break;
      }
    }

    const laborCost = selectedEntry.labor_cost || 0;
    const hoursWorked = selectedEntry.labor_hours || 0;
    
    console.log(`[labor] Found labor_cache entry (source: ${selectedEntry.source}): ${hoursWorked.toFixed(2)} hours, $${laborCost.toFixed(2)} cost`);
    
    return { 
      hoursWorked, 
      laborCost, 
      hasData: hoursWorked > 0 || laborCost > 0 
    };
  } catch (error) {
    console.error('Error fetching labor data:', error);
    return { hoursWorked: 0, laborCost: 0, hasData: false };
  }
}

// Fetch product mix from sales_cache (no more edge function call needed)
async function fetchProductMixFromCache(supabase: any, locationId: string, dateStr: string): Promise<{ name: string; quantity: number; sales: number }[]> {
  try {
    console.log(`[productMix] Fetching from sales_cache for ${dateStr}`);
    
    const { data, error } = await supabase
      .from('sales_cache')
      .select('product_mix')
      .eq('location_id', locationId)
      .eq('sale_date', dateStr)
      .maybeSingle();

    if (error) {
      console.error('[productMix] sales_cache query error:', error);
      return [];
    }

    if (!data?.product_mix || !Array.isArray(data.product_mix)) {
      console.log('[productMix] No product_mix in sales_cache');
      return [];
    }

    // Return top 5 items sorted by sales
    const topItems = data.product_mix
      .sort((a: any, b: any) => (b.sales || 0) - (a.sales || 0))
      .slice(0, 5)
      .map((item: any) => ({
        name: item.name || 'Unknown',
        quantity: item.quantity || 0,
        sales: item.sales || 0,
      }));

    console.log(`[productMix] Got ${topItems.length} top items from cache`);
    return topItems;
  } catch (error) {
    console.error('Error fetching product mix from cache:', error);
    return [];
  }
}

// Fetch checklist completion data - MATCHING Dashboard logic exactly
async function fetchChecklistData(supabase: any, locationId: string, dateStr: string) {
  try {
    const { data: locationSettings } = await supabase
      .from('location_settings')
      .select('timezone')
      .eq('location_id', locationId)
      .maybeSingle();

    const timeZone = locationSettings?.timezone || 'America/Los_Angeles';
    
    // Get target date info for day-of-week filtering
    const targetDate = new Date(dateStr + 'T12:00:00');
    const dayOfWeek = targetDate.getDay(); // 0=Sun, 1=Mon, etc
    // Convert to our system: Mon=0, Tue=1, ... Sun=6
    const currentDay = dayOfWeek === 0 ? 6 : dayOfWeek - 1;

    console.log(`[checklists] Fetching for date ${dateStr}, dayOfWeek=${currentDay}`);

    // Get all active checklists for this location (matching Dashboard query)
    const { data: checklists, error: checklistsError } = await supabase
      .from('checklists')
      .select(`
        id,
        title,
        frequency,
        template_type,
        due_by_time,
        checklist_items(id, days_of_week)
      `)
      .eq('location_id', locationId)
      .eq('is_active', true);

    if (checklistsError) {
      console.error('[checklists] checklists query error:', checklistsError);
      return { completed: 0, total: 0, items: [] };
    }

    if (!checklists || checklists.length === 0) {
      console.log('[checklists] No active checklists found');
      return { completed: 0, total: 0, items: [] };
    }

    console.log(`[checklists] Found ${checklists.length} active checklists`);

    // Filter to only checklists relevant for today (matching Dashboard logic)
    const relevantChecklists = checklists.filter((checklist: any) => {
      if (checklist.template_type === 'dynamic') {
        // For dynamic, check if any items are assigned to today
        const todayItems = checklist.checklist_items?.filter((item: any) => 
          item.days_of_week && item.days_of_week.includes(currentDay)
        );
        return todayItems && todayItems.length > 0;
      }
      // For standard checklists, only include daily frequency
      return checklist.frequency === 'daily';
    });

    console.log(`[checklists] ${relevantChecklists.length} checklists are relevant for today`);

    if (relevantChecklists.length === 0) {
      return { completed: 0, total: 0, items: [] };
    }

    // Get submissions for today (use wide window for timezone safety)
    const startOfDay = new Date(dateStr + 'T00:00:00Z');
    startOfDay.setHours(startOfDay.getHours() - 12);
    const endOfDay = new Date(dateStr + 'T23:59:59Z');
    endOfDay.setHours(endOfDay.getHours() + 12);

    const { data: submissions, error: submissionsError } = await supabase
      .from('checklist_submissions')
      .select(`
        id,
        checklist_id,
        submitted_at,
        checklist_responses(id, item_id)
      `)
      .eq('location_id', locationId)
      .gte('submitted_at', startOfDay.toISOString())
      .lte('submitted_at', endOfDay.toISOString());

    if (submissionsError) {
      console.error('[checklists] submissions query error:', submissionsError);
    }

    // Filter submissions to the exact target date
    const submissionsForDay = (submissions || []).filter((s: any) =>
      s?.submitted_at && getLocalDateString(s.submitted_at, timeZone) === dateStr
    );

    console.log(`[checklists] Found ${submissionsForDay.length} submissions for ${dateStr}`);

    // Calculate completion for each relevant checklist
    const items = relevantChecklists.map((checklist: any) => {
      const checklistSubmissions = submissionsForDay.filter((s: any) => s.checklist_id === checklist.id);
      
      let totalItems = checklist.checklist_items?.length || 0;
      if (checklist.template_type === 'dynamic') {
        // Only count items assigned to today
        totalItems = checklist.checklist_items?.filter((item: any) => 
          item.days_of_week && item.days_of_week.includes(currentDay)
        ).length || 0;
      }

      // Count unique completed items across all submissions
      const uniqueItemIds = new Set<string>();
      checklistSubmissions.forEach((sub: any) => {
        sub.checklist_responses?.forEach((response: any) => {
          if (response.item_id) {
            uniqueItemIds.add(response.item_id);
          }
        });
      });
      const answeredItems = uniqueItemIds.size;

      const percent = totalItems > 0 ? Math.round((answeredItems / totalItems) * 100) : 0;
      const completed = percent >= 100;

      console.log(`[checklists] "${checklist.title}": ${answeredItems}/${totalItems} = ${percent}%`);

      return {
        title: checklist.title,
        completed,
        percent,
      };
    });

    const completedCount = items.filter((i: any) => i.completed).length;
    
    return {
      completed: completedCount,
      total: items.length,
      items,
    };
  } catch (error) {
    console.error('Error fetching checklist data:', error);
    return { completed: 0, total: 0, items: [] };
  }
}

// Fetch events and completions
async function fetchEventsData(supabase: any, locationId: string, dateStr: string) {
  try {
    const { data: events } = await supabase
      .from('schedule_events')
      .select('id, title, start_time, end_time, color')
      .eq('location_id', locationId)
      .eq('date', dateStr)
      .order('start_time');
    
    const eventIds = (events || []).map((e: any) => e.id);
    const { data: completions } = eventIds.length > 0 ? await supabase
      .from('event_task_completions')
      .select('event_id, completed_by, completed_at')
      .in('event_id', eventIds)
      .eq('completed_date', dateStr) : { data: [] };
    
    const completedByIds = [...new Set((completions || []).map((c: any) => c.completed_by))];
    const { data: profiles } = completedByIds.length > 0 ? await supabase
      .from('profiles')
      .select('id, full_name')
      .in('id', completedByIds) : { data: [] };
    
    const profileMap = new Map<string, string>((profiles || []).map((p: any) => [p.id, p.full_name]));
    const completionMap = new Map<string, { completedBy: string; completedAt: string }>();
    for (const c of (completions || []) as any[]) {
      completionMap.set(c.event_id, {
        completedBy: (profileMap.get(c.completed_by) || 'Unknown') as string,
        completedAt: c.completed_at
      });
    }
    
    const { data: cateringOrders } = await supabase
      .from('catering_orders')
      .select('id, customer_name, pickup_time, status, completed_by, completed_at')
      .eq('location_id', locationId)
      .eq('pickup_date', dateStr);
    const cateringCompleterIds = (cateringOrders || []).filter((c: any) => c.completed_by).map((c: any) => c.completed_by);
    const { data: cateringProfiles } = cateringCompleterIds.length > 0 ? await supabase
      .from('profiles')
      .select('id, full_name')
      .in('id', cateringCompleterIds) : { data: [] };
    
    const cateringProfileMap = new Map((cateringProfiles || []).map((p: any) => [p.id, p.full_name]));
    
    return {
      scheduleEvents: (events || []).map((e: any) => ({
        title: e.title,
        startTime: e.start_time,
        endTime: e.end_time,
        color: e.color,
        completed: completionMap.has(e.id),
        completedBy: completionMap.get(e.id)?.completedBy
      })),
      cateringOrders: (cateringOrders || []).map((o: any) => ({
        customerName: o.customer_name,
        pickupTime: o.pickup_time,
        status: o.status,
        completedBy: o.completed_by ? cateringProfileMap.get(o.completed_by) : undefined
      }))
    };
  } catch (error) {
    console.error('Error fetching events data:', error);
    return { scheduleEvents: [], cateringOrders: [] };
  }
}

// Generate email HTML
function generateEmailHtml(data: {
  locationName: string;
  dateStr: string;
  actualSales: number;
  projectedSales: number;
  laborCost: number;
  hoursWorked: number;
  laborPercent: number;
  hasLaborData: boolean;
  topItems: { name: string; quantity: number; sales: number }[];
  remakes: { guestName: string; details: string }[];
  refunds: { guestName: string; details: string }[];
  safeCountData: { shift: string; totalCash: number; variance: number; completedBy?: string }[];
  drawerCountData: { expected: number; actual: number; variance: number; totalDeposit: number; completedBy?: string } | null;
  checklistData: { completed: number; total: number; items: { title: string; completed: boolean; percent?: number }[] };
  eventsData: { scheduleEvents: any[]; cateringOrders: any[] };
}) {
  const bgColor = '#f8f7f5';
  const cardBg = '#ffffff';
  const headerBg = '#5d6d5e';
  const textColor = '#333333';
  const mutedColor = '#666666';
  const accentColor = '#4CAF50';
  const warningColor = '#FF9800';
  const dangerColor = '#f44336';

  const salesVariance = data.actualSales - data.projectedSales;
  const salesVarianceColor = salesVariance >= 0 ? accentColor : dangerColor;
  const salesVarianceSign = salesVariance >= 0 ? '+' : '';

  // Checklist items HTML with percentages
  const checklistItemsHtml = data.checklistData.items.length > 0 
    ? data.checklistData.items.map(item => {
        const icon = item.completed ? '✓' : '○';
        const color = item.completed ? accentColor : warningColor;
        const percent = item.percent !== undefined ? ` ${item.percent}%` : '';
        return `<p style="margin: 4px 0; font-size: 13px;"><span style="color: ${color};">${icon}</span> ${item.title}<span style="color: ${mutedColor};">${percent}</span></p>`;
      }).join('')
    : '<p style="margin: 4px 0; font-size: 13px; color: #666;">No checklists due today</p>';

  // Calculate overall checklist completion
  const overallPercent = data.checklistData.items.length > 0
    ? Math.round(data.checklistData.items.reduce((sum, i) => sum + (i.percent || 0), 0) / data.checklistData.items.length)
    : 0;

  // Safe counts HTML
  const safeCountsHtml = data.safeCountData.length > 0 
    ? data.safeCountData.map(sc => {
        const varianceColor = sc.variance >= 0 ? accentColor : dangerColor;
        const varianceSign = sc.variance >= 0 ? '+' : '';
        return `<p style="margin: 4px 0; font-size: 13px;">${sc.shift}: ${formatCurrency(sc.totalCash)} (<span style="color: ${varianceColor};">${varianceSign}${formatCurrency(sc.variance)}</span>)${sc.completedBy ? ` - ${sc.completedBy}` : ''}</p>`;
      }).join('')
    : '<p style="margin: 4px 0; font-size: 13px; color: #666;">No safe counts</p>';

  // Deposit HTML
  const depositHtml = data.drawerCountData 
    ? `<p style="margin: 4px 0; font-size: 13px;">${formatCurrency(data.drawerCountData.totalDeposit)} (<span style="color: ${data.drawerCountData.variance >= 0 ? accentColor : dangerColor};">${data.drawerCountData.variance >= 0 ? '+' : ''}${formatCurrency(data.drawerCountData.variance)}</span>)${data.drawerCountData.completedBy ? ` - ${data.drawerCountData.completedBy}` : ''}</p>`
    : '<p style="margin: 4px 0; font-size: 13px; color: #666;">No deposit</p>';

  // Top items HTML
  const topItemsHtml = data.topItems.length > 0
    ? `<table style="width: 100%; font-size: 12px; border-collapse: collapse;">
        <tr style="border-bottom: 1px solid #e8e5df;">
          <th style="text-align: left; padding: 4px 0; color: ${mutedColor};">#</th>
          <th style="text-align: left; padding: 4px 0; color: ${mutedColor};">Item</th>
          <th style="text-align: center; padding: 4px 0; color: ${mutedColor};">Qty</th>
          <th style="text-align: right; padding: 4px 0; color: ${mutedColor};">Sales</th>
        </tr>
        ${data.topItems.map((item, idx) => `
          <tr>
            <td style="padding: 4px 0; color: ${mutedColor};">${idx + 1}</td>
            <td style="padding: 4px 0;">${item.name}</td>
            <td style="text-align: center; padding: 4px 0; color: ${mutedColor};">${item.quantity}</td>
            <td style="text-align: right; padding: 4px 0; font-weight: 500;">${formatCurrency(item.sales)}</td>
          </tr>
        `).join('')}
      </table>`
    : '<p style="font-size: 13px; color: #666;">No sales data available</p>';

  // Remakes HTML
  const remakesHtml = data.remakes.length > 0
    ? data.remakes.map(r => `<p style="margin: 4px 0; font-size: 12px;"><strong>${r.guestName}</strong>: ${r.details}</p>`).join('')
    : '<p style="margin: 4px 0; font-size: 12px; color: #666;">None</p>';

  // Refunds HTML  
  const refundsHtml = data.refunds.length > 0
    ? data.refunds.map(r => `<p style="margin: 4px 0; font-size: 12px;"><strong>${r.guestName}</strong>: ${r.details}</p>`).join('')
    : '<p style="margin: 4px 0; font-size: 12px; color: #666;">None</p>';

  // Labor section
  const laborHtml = data.hasLaborData
    ? `<p style="margin: 0; font-size: 24px; font-weight: 700; color: ${textColor};">${data.laborPercent.toFixed(1)}%</p>
       <p style="margin: 4px 0 0; font-size: 12px; color: ${mutedColor};">${formatCurrency(data.laborCost)} • ${data.hoursWorked.toFixed(1)}h</p>`
    : `<p style="margin: 0; font-size: 16px; color: ${mutedColor};">No data</p>`;

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
    </head>
    <body style="margin: 0; padding: 0; background-color: ${bgColor}; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
      <table width="100%" cellpadding="0" cellspacing="0" style="background-color: ${bgColor};">
        <tr>
          <td align="center" style="padding: 20px;">
            <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 480px; background-color: ${cardBg}; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.08);">
              
              <!-- Header -->
              <tr>
                <td style="background-color: ${headerBg}; padding: 20px; text-align: center;">
                  <p style="margin: 0; font-size: 20px; font-weight: 700; color: white;">📋 Daily Summary</p>
                  <p style="margin: 4px 0 0; font-size: 14px; color: rgba(255,255,255,0.85);">${data.locationName} • ${formatDateForDisplay(data.dateStr)}</p>
                </td>
              </tr>

              <!-- Sales & Labor -->
              <tr>
                <td style="padding: 16px 20px;">
                  <table style="width: 100%;">
                    <tr>
                      <td style="width: 50%; vertical-align: top;">
                        <p style="margin: 0 0 4px; font-size: 11px; text-transform: uppercase; color: ${mutedColor}; font-weight: 600;">Sales</p>
                        <p style="margin: 0; font-size: 28px; font-weight: 700; color: ${textColor};">${formatCurrency(data.actualSales)}</p>
                        <p style="margin: 4px 0 0; font-size: 12px;">Target: ${formatCurrency(data.projectedSales)} (<span style="color: ${salesVarianceColor};">${salesVarianceSign}${formatCurrency(salesVariance)}</span>)</p>
                      </td>
                      <td style="width: 50%; vertical-align: top; text-align: right;">
                        <p style="margin: 0 0 4px; font-size: 11px; text-transform: uppercase; color: ${mutedColor}; font-weight: 600;">Labor</p>
                        ${laborHtml}
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>

              <!-- Divider -->
              <tr><td style="padding: 0 20px;"><hr style="border: none; border-top: 1px solid #e8e5df; margin: 0;"></td></tr>

              <!-- Checklists & Events -->
              <tr>
                <td style="padding: 16px 20px;">
                  <table style="width: 100%;">
                    <tr>
                      <td style="width: 50%; vertical-align: top; padding-right: 10px;">
                        <p style="margin: 0 0 8px; font-size: 12px; font-weight: 600; text-transform: uppercase; color: ${textColor};">✅ Checklists <span style="color: ${overallPercent >= 100 ? accentColor : warningColor};">${overallPercent}%</span></p>
                        ${checklistItemsHtml}
                      </td>
                      <td style="width: 50%; vertical-align: top; padding-left: 10px; border-left: 1px solid #e8e5df;">
                        <p style="margin: 0 0 8px; font-size: 12px; font-weight: 600; text-transform: uppercase; color: ${textColor};">🎯 Events & Tasks</p>
                        <p style="margin: 0 0 6px; font-size: 11px; font-weight: 600; color: ${mutedColor};">💰 Safe Counts</p>
                        ${safeCountsHtml}
                        <p style="margin: 10px 0 6px; font-size: 11px; font-weight: 600; color: ${mutedColor};">💵 Deposit</p>
                        ${depositHtml}
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>

              <!-- Divider -->
              <tr><td style="padding: 0 20px;"><hr style="border: none; border-top: 1px solid #e8e5df; margin: 0;"></td></tr>

              <!-- Top Items -->
              <tr>
                <td style="padding: 16px 20px;">
                  <p style="margin: 0 0 12px; font-size: 12px; font-weight: 600; text-transform: uppercase; color: ${textColor};">🏆 Top Items by Sales</p>
                  ${topItemsHtml}
                </td>
              </tr>

              <!-- Divider -->
              <tr><td style="padding: 0 20px;"><hr style="border: none; border-top: 1px solid #e8e5df; margin: 0;"></td></tr>

              <!-- Remakes & Refunds -->
              <tr>
                <td style="padding: 16px 20px;">
                  <table style="width: 100%;">
                    <tr>
                      <td style="width: 50%; vertical-align: top; padding-right: 10px;">
                        <p style="margin: 0 0 8px; color: ${textColor}; font-size: 12px; font-weight: 600; text-transform: uppercase;">🔄 Remakes (${data.remakes.length})</p>
                        ${remakesHtml}
                      </td>
                      <td style="width: 50%; vertical-align: top; padding-left: 10px; border-left: 1px solid #e8e5df;">
                        <p style="margin: 0 0 8px; color: ${textColor}; font-size: 12px; font-weight: 600; text-transform: uppercase;">💳 Refunds (${data.refunds.length})</p>
                        ${refundsHtml}
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
              
              <!-- Footer -->
              <tr>
                <td style="background-color: #f8f7f5; padding: 16px 20px; border-top: 1px solid #e8e5df; text-align: center;">
                  <img src="https://croohq.com/assets/croo-logo-eWOfbANR.png" alt="Croo" style="height: 20px; width: auto; opacity: 0.6;" />
                  <p style="color: #aaa; font-size: 10px; margin: 6px 0 0;">Team management made simple</p>
                </td>
              </tr>
              
            </table>
          </td>
        </tr>
      </table>
    </body>
    </html>
  `;
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { location_id, entry_date, test_mode, test_email, preview_only }: DailyLogbookSummaryRequest = await req.json();
    
    console.log(`Processing daily summary for location ${location_id}, date ${entry_date}, test_mode: ${test_mode}, preview_only: ${preview_only}`);

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get location info
    const { data: location } = await supabase
      .from('locations')
      .select('id, name, organization_id')
      .eq('id', location_id)
      .single();

    if (!location) {
      throw new Error('Location not found');
    }

    // Get logbook categories
    const { data: categories } = await supabase
      .from('logbook_categories')
      .select('id, name')
      .eq('location_id', location_id)
      .eq('is_active', true);

    const safeCountCategoryId = categories?.find(c => c.name?.toLowerCase() === 'safe count')?.id;
    const drawerCountCategoryId = categories?.find(c => c.name?.toLowerCase() === 'drawer count')?.id;
    
    const getUserName = async (userId: string) => {
      const { data } = await supabase.from('profiles').select('full_name').eq('id', userId).single();
      return data?.full_name || 'Unknown';
    };

    // Check for Safe Counts
    const { data: safeCountEntries } = await supabase
      .from('logbook_entries')
      .select('*, logbook_entry_values(*), created_by')
      .eq('category_id', safeCountCategoryId)
      .eq('entry_date', entry_date)
      .eq('location_id', location_id);

    const safeCountData: { shift: string; totalCash: number; variance: number; completedBy?: string }[] = [];
    let hasPmSafeCount = false;

    for (const entry of safeCountEntries || []) {
      try {
        const valueText = entry.logbook_entry_values?.[0]?.value_text;
        if (valueText) {
          const data = JSON.parse(valueText);
          const completedBy = entry.created_by ? await getUserName(entry.created_by) : undefined;
          safeCountData.push({
            shift: data.shift || 'Unknown',
            totalCash: data.totalSafe || 0,
            variance: data.difference || 0,
            completedBy
          });
          if (data.shift === 'PM') hasPmSafeCount = true;
        }
      } catch (e) {
        console.error('Error parsing safe count data:', e);
      }
    }

    // Check for Drawer Count
    const { data: drawerCountEntries } = await supabase
      .from('logbook_entries')
      .select('*, logbook_entry_values(*), created_by')
      .eq('category_id', drawerCountCategoryId)
      .eq('entry_date', entry_date)
      .eq('location_id', location_id);

    const hasDeposit = (drawerCountEntries?.length || 0) > 0;
    
    let drawerCountData: { expected: number; actual: number; variance: number; totalDeposit: number; completedBy?: string } | null = null;
    if (hasDeposit && drawerCountEntries && drawerCountEntries.length > 0) {
      try {
        const entry = drawerCountEntries[0];
        const valueText = entry.logbook_entry_values?.[0]?.value_text;
        if (valueText) {
          const parsed = JSON.parse(valueText);
          const completedBy = entry.created_by ? await getUserName(entry.created_by) : undefined;
          drawerCountData = {
            expected: parsed.expectedDeposit || 0,
            actual: parsed.actualDeposit || 0,
            variance: (parsed.actualDeposit || 0) - (parsed.expectedDeposit || 0),
            totalDeposit: parsed.totalDeposit || 0,
            completedBy
          };
        }
      } catch (e) {
        console.error('Error parsing drawer count data:', e);
      }
    }

    // NOTE: No longer require PM Safe Count and Deposit - send summary regardless
    // This ensures managers get daily updates even if staff forgot to complete counts
    console.log(`Proceeding with email - PM Safe Count: ${hasPmSafeCount}, Deposit: ${hasDeposit}`);

    // Fetch all data in parallel - now reading product_mix from sales_cache directly
    const [laborData, checklistData, eventsData, salesCache] = await Promise.all([
      fetchLaborData(supabase, location_id, entry_date),
      fetchChecklistData(supabase, location_id, entry_date),
      fetchEventsData(supabase, location_id, entry_date),
      supabase.from('sales_cache').select('net_sales, projected_sales, product_mix').eq('location_id', location_id).eq('sale_date', entry_date).maybeSingle()
    ]);

    // Get top items from cached product_mix
    const cachedProductMix = salesCache.data?.product_mix || [];
    const topItems = Array.isArray(cachedProductMix) 
      ? cachedProductMix
          .sort((a: any, b: any) => (b.sales || 0) - (a.sales || 0))
          .slice(0, 5)
          .map((item: any) => ({
            name: item.name || 'Unknown',
            quantity: item.quantity || 0,
            sales: item.sales || 0,
          }))
      : [];
    console.log(`[productMix] Got ${topItems.length} top items from sales_cache`);
    
    const actualSales = salesCache.data?.net_sales || 0;
    
    // For past dates, use cached projection; projections are already in sales_cache
    const projectedSales = salesCache.data?.projected_sales || 0;
    console.log(`[sales] Using cached projectedSales: ${projectedSales}`);
    
    
    const laborPercent = actualSales > 0 && laborData.laborCost > 0 
      ? (laborData.laborCost / actualSales) * 100 
      : 0;

    // Fetch Guest Remakes
    const remakesCategoryId = categories?.find(c => c.name?.toLowerCase() === 'guest remakes')?.id;
    const remakes: { guestName: string; details: string }[] = [];
    
    if (remakesCategoryId) {
      const { data: remakeEntries } = await supabase
        .from('logbook_entries')
        .select('*, logbook_entry_values(*, logbook_fields(field_name))')
        .eq('category_id', remakesCategoryId)
        .eq('entry_date', entry_date)
        .eq('location_id', location_id);

      for (const entry of remakeEntries || []) {
        let guestName = '';
        let details = '';
        for (const val of entry.logbook_entry_values || []) {
          const fieldName = val.logbook_fields?.field_name?.toLowerCase() || '';
          if (fieldName.includes('guest') || fieldName.includes('name')) guestName = val.value_text || '';
          else if (fieldName.includes('details') || fieldName.includes('notes') || fieldName.includes('reason')) details = val.value_text || '';
        }
        if (guestName || details) remakes.push({ guestName: guestName || 'Guest', details: details || 'No details' });
      }
    }

    // Fetch Online Refunds
    const refundsCategoryId = categories?.find(c => c.name?.toLowerCase() === 'online refunds')?.id;
    const refunds: { guestName: string; details: string }[] = [];
    
    if (refundsCategoryId) {
      const { data: refundEntries } = await supabase
        .from('logbook_entries')
        .select('*, logbook_entry_values(*, logbook_fields(field_name))')
        .eq('category_id', refundsCategoryId)
        .eq('entry_date', entry_date)
        .eq('location_id', location_id);

      for (const entry of refundEntries || []) {
        let guestName = '';
        let details = '';
        for (const val of entry.logbook_entry_values || []) {
          const fieldName = val.logbook_fields?.field_name?.toLowerCase() || '';
          if (fieldName.includes('guest') || fieldName.includes('name')) guestName = val.value_text || '';
          else if (fieldName.includes('details') || fieldName.includes('notes') || fieldName.includes('reason')) details = val.value_text || '';
        }
        if (guestName || details) refunds.push({ guestName: guestName || 'Guest', details: details || 'No details' });
      }
    }

    // If preview_only, return the data without sending email
    if (preview_only) {
      const previewData = {
        location: location.name,
        date: entry_date,
        sales: {
          actual: actualSales,
          projected: projectedSales,
          variance: actualSales - projectedSales,
          source: 'sales_cache table'
        },
        labor: {
          hoursWorked: laborData.hoursWorked,
          laborCost: laborData.laborCost,
          laborPercent,
          hasData: laborData.hasData,
          source: 'time_punches table (punch_time/punch_type columns)'
        },
        checklists: {
          completed: checklistData.completed,
          total: checklistData.total,
          items: checklistData.items,
          source: 'checklists + checklist_submissions + checklist_responses (matching Dashboard logic)'
        },
        topItems: {
          items: topItems,
          source: 'sales_cache.product_mix column'
        },
        safeCounts: safeCountData,
        drawerCount: drawerCountData,
        remakes,
        refunds,
        events: eventsData
      };

      console.log('Preview data:', JSON.stringify(previewData, null, 2));

      return new Response(JSON.stringify({ 
        success: true,
        preview: true,
        data: previewData
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get managers for email recipients
    const { data: locationUsers } = await supabase.from('user_locations').select('user_id').eq('location_id', location_id);
    const userIds = (locationUsers || []).map(u => u.user_id);
    
    const { data: userRolesData } = await supabase
      .from('user_roles')
      .select('user_id, role')
      .in('user_id', userIds)
      .in('role', ['admin', 'manager', 'general_manager', 'shift_manager', 'super_admin']);
    
    const managerUserIds = [...new Set((userRolesData || []).map(r => r.user_id))];
    
    const { data: managerProfilesData } = await supabase
      .from('profiles')
      .select('id, email, full_name, is_active')
      .in('id', managerUserIds)
      .eq('is_active', true);
    
    const profiles = (managerProfilesData || []).filter(p => p.email);

    if (!test_mode && profiles.length === 0) {
      console.log('No managers found for location');
      return new Response(JSON.stringify({ success: false, reason: 'No managers to email' }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const recipientEmails = test_mode && test_email ? [test_email] : profiles.map(p => p.email).filter(Boolean);
    console.log(`Sending email to ${recipientEmails.length} recipients`);

    // Generate email HTML
    const emailHtml = generateEmailHtml({
      locationName: location.name,
      dateStr: entry_date,
      actualSales,
      projectedSales,
      laborCost: laborData.laborCost,
      hoursWorked: laborData.hoursWorked,
      laborPercent,
      hasLaborData: laborData.hasData,
      topItems,
      remakes,
      refunds,
      safeCountData,
      drawerCountData,
      checklistData,
      eventsData
    });

    // Send email
    const emailResponse = await resend.emails.send({
      from: "Croo <hello@croohq.email>",
      to: recipientEmails,
      subject: `📋 ${location.name} - ${formatDateForDisplay(entry_date)}`,
      html: emailHtml,
    });

    console.log("Email sent successfully:", emailResponse);

    return new Response(JSON.stringify({ 
      success: true, 
      emailId: emailResponse.data?.id,
      recipients: recipientEmails.length
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error: any) {
    console.error("Error in send-daily-logbook-summary:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
};

serve(handler);
