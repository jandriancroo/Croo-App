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
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(amount);
}

function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`;
}

function formatDateForDisplay(dateStr: string): string {
  // Handle various date formats
  if (!dateStr) return 'Unknown Date';
  
  // If dateStr is already a date string like "2026-01-04", parse it properly
  const parts = dateStr.split('-');
  if (parts.length === 3) {
    const year = parseInt(parts[0]);
    const month = parseInt(parts[1]) - 1; // Months are 0-indexed
    const day = parseInt(parts[2]);
    const date = new Date(year, month, day, 12, 0, 0);
    if (!isNaN(date.getTime())) {
      return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    }
  }
  
  // Fallback: try parsing as-is
  const date = new Date(dateStr);
  if (!isNaN(date.getTime())) {
    return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  }
  
  return dateStr; // Return original if parsing fails
}

// Fetch labor data from time_punches
async function fetchLaborData(supabase: any, locationId: string, dateStr: string) {
  try {
    // Get users at this location
    const { data: locationUsers } = await supabase
      .from('user_locations')
      .select('user_id')
      .eq('location_id', locationId);
    
    if (!locationUsers || locationUsers.length === 0) {
      return { hoursWorked: 0, laborCost: 0, hasData: false };
    }
    
    const userIds = locationUsers.map((u: any) => u.user_id);
    
    // Get time punches for the date
    const startOfDay = `${dateStr}T00:00:00`;
    const endOfDay = `${dateStr}T23:59:59`;
    
    const { data: punches } = await supabase
      .from('time_punches')
      .select('user_id, punch_in, punch_out, meal_break_hours, meal_break_duration')
      .in('user_id', userIds)
      .gte('punch_in', startOfDay)
      .lte('punch_in', endOfDay);
    
    if (!punches || punches.length === 0) {
      return { hoursWorked: 0, laborCost: 0, hasData: false };
    }
    
    // Get user wages
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, hourly_wage')
      .in('id', userIds);
    
    const wageMap = new Map((profiles || []).map((p: any) => [p.id, p.hourly_wage || 15]));
    
    let totalHours = 0;
    let totalCost = 0;
    
    for (const punch of punches) {
      if (!punch.punch_out) continue;
      
      const punchIn = new Date(punch.punch_in);
      const punchOut = new Date(punch.punch_out);
      let hoursWorked = (punchOut.getTime() - punchIn.getTime()) / (1000 * 60 * 60);
      
      // Subtract unpaid break if applicable
      if (punch.meal_break_hours && punch.meal_break_duration) {
        hoursWorked -= punch.meal_break_duration / 60;
      }
      
      if (hoursWorked > 0) {
        totalHours += hoursWorked;
        const wage = Number(wageMap.get(punch.user_id)) || 15;
        totalCost += hoursWorked * wage;
      }
    }
    
    return { hoursWorked: totalHours, laborCost: totalCost, hasData: totalHours > 0 };
  } catch (error) {
    console.error('Error fetching labor data:', error);
    return { hoursWorked: 0, laborCost: 0, hasData: false };
  }
}

// Fetch QuBeyond product mix (top 20 items sorted by sales)
async function fetchProductMix(supabase: any, locationId: string, dateStr: string) {
  try {
    const { data: integration } = await supabase
      .from('location_integrations')
      .select('credentials')
      .eq('location_id', locationId)
      .eq('integration_type', 'qubeyond')
      .eq('is_active', true)
      .maybeSingle();

    if (!integration?.credentials) return [];

    const credentials = integration.credentials as { username: string; password: string; location_id?: string };
    
    const authResponse = await fetch('https://admin.qubeyond.com/api/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        authType: 'classic',
        username: credentials.username,
        password: credentials.password
      }),
    });

    if (!authResponse.ok) return [];

    const authData = await authResponse.json();
    const tokenGw = authData.tokenGw;
    const qbLocationId = credentials.location_id;

    if (!tokenGw || !qbLocationId) return [];

    // Fetch product mix sorted by sales
    const productResponse = await fetch('https://gateway-api.qubeyond.com/api/v4/data/reports/product-mix/sections/main', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': tokenGw,
        'Origin': 'https://admin.qubeyond.com',
      },
      body: JSON.stringify({
        fields: [
          { fieldName: "itemGroup" },
          { fieldName: "itemName" },
          { fieldName: "quantity" },
          { fieldName: "netSales" }
        ],
        filters: {
          date: { from: null, to: null, values: [dateStr], type: "custom" },
          singleLocation: parseInt(qbLocationId)
        },
        params: { sectionId: "main", pageNumber: 1, pageSize: 200, sort: [{ field: "netSales", dir: "desc" }], showTotals: true }
      }),
    });

    const topItems: { name: string; quantity: number; sales: number }[] = [];
    if (productResponse.ok) {
      const productData = await productResponse.json();
      if (productData.items) {
        const allItems: { name: string; quantity: number; sales: number }[] = [];
        
        for (const item of productData.items) {
          if (item.items && Array.isArray(item.items)) {
            for (const child of item.items) {
              const name = child.itemName || '';
              if (name && name !== 'Totals') {
                const quantity = parseFloat(String(child.quantity || '0').replace(/,/g, '')) || 0;
                const sales = parseFloat(String(child.netSales || '0').replace(/[$,]/g, '')) || 0;
                if (sales > 0) allItems.push({ name, quantity, sales });
              }
            }
          } else {
            const name = item.itemName || '';
            if (name && name !== 'Totals') {
              const quantity = parseFloat(String(item.quantity || '0').replace(/,/g, '')) || 0;
              const sales = parseFloat(String(item.netSales || '0').replace(/[$,]/g, '')) || 0;
              if (sales > 0) allItems.push({ name, quantity, sales });
            }
          }
        }
        
        allItems.sort((a, b) => b.sales - a.sales);
        topItems.push(...allItems.slice(0, 20));
      }
    }

    return topItems;
  } catch (error) {
    console.error('Error fetching product mix:', error);
    return [];
  }
}

// Fetch checklist completion data
async function fetchChecklistData(supabase: any, locationId: string, dateStr: string) {
  try {
    // Get all active checklists for this location
    const { data: checklists } = await supabase
      .from('checklists')
      .select('id, title, frequency')
      .eq('location_id', locationId)
      .eq('is_active', true);
    
    if (!checklists || checklists.length === 0) {
      return { completed: 0, total: 0, items: [] };
    }
    
    // Determine which checklists are due today based on frequency
    const targetDate = new Date(dateStr + 'T12:00:00');
    const dayOfWeek = targetDate.getDay();
    
    const dueChecklists = checklists.filter((c: any) => {
      if (c.frequency === 'daily') return true;
      if (c.frequency === 'weekly' && c.assigned_day_of_week === dayOfWeek) return true;
      if (c.frequency === 'monthly') return targetDate.getDate() === 1;
      return c.frequency === 'daily'; // default to daily
    });
    
    // Get submissions for today
    const checklistIds = dueChecklists.map((c: any) => c.id);
    const { data: submissions } = await supabase
      .from('checklist_submissions')
      .select('checklist_id, submitted_by, submitted_at')
      .in('checklist_id', checklistIds)
      .gte('submitted_at', `${dateStr}T00:00:00`)
      .lte('submitted_at', `${dateStr}T23:59:59`);
    
    const submittedIds = new Set((submissions || []).map((s: any) => s.checklist_id));
    
    const items = dueChecklists.map((c: any) => ({
      title: c.title,
      completed: submittedIds.has(c.id)
    }));
    
    return {
      completed: items.filter((i: any) => i.completed).length,
      total: items.length,
      items
    };
  } catch (error) {
    console.error('Error fetching checklist data:', error);
    return { completed: 0, total: 0, items: [] };
  }
}

// Fetch events and completions
async function fetchEventsData(supabase: any, locationId: string, dateStr: string) {
  try {
    // Get schedule events for the day
    const { data: events } = await supabase
      .from('schedule_events')
      .select('id, title, start_time, end_time, color')
      .eq('location_id', locationId)
      .eq('date', dateStr)
      .order('start_time');
    
    // Get event task completions
    const eventIds = (events || []).map((e: any) => e.id);
    const { data: completions } = eventIds.length > 0 ? await supabase
      .from('event_task_completions')
      .select('event_id, completed_by, completed_at')
      .in('event_id', eventIds)
      .eq('completed_date', dateStr) : { data: [] };
    
    // Get user names for completions
    const completedByIds = [...new Set((completions || []).map((c: any) => c.completed_by))];
    const { data: profiles } = completedByIds.length > 0 ? await supabase
      .from('profiles')
      .select('id, full_name')
      .in('id', completedByIds) : { data: [] };
    
    const profileMap = new Map((profiles || []).map((p: any) => [p.id, p.full_name]));
    const completionMap = new Map((completions || []).map((c: any) => [c.event_id, {
      completedBy: profileMap.get(c.completed_by) || 'Unknown',
      completedAt: c.completed_at
    }]));
    
    // Get catering order completions
    const { data: cateringOrders } = await supabase
      .from('catering_orders')
      .select('id, customer_name, pickup_time, status, completed_by, completed_at')
      .eq('location_id', locationId)
      .eq('pickup_date', dateStr);
    
    // Get completer names for catering
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
        completion: completionMap.get(e.id) || null
      })),
      cateringOrders: (cateringOrders || []).map((c: any) => ({
        customerName: c.customer_name,
        pickupTime: c.pickup_time,
        status: c.status,
        completedBy: c.completed_by ? cateringProfileMap.get(c.completed_by) || 'Unknown' : null
      }))
    };
  } catch (error) {
    console.error('Error fetching events data:', error);
    return { scheduleEvents: [], cateringOrders: [] };
  }
}

// Generate the HTML email
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
  checklistData: { completed: number; total: number; items: { title: string; completed: boolean }[] };
  eventsData: { 
    scheduleEvents: { title: string; startTime: string; endTime: string; color: string; completion: { completedBy: string; completedAt: string } | null }[];
    cateringOrders: { customerName: string; pickupTime: string; status: string; completedBy: string | null }[];
  };
}): string {
  const salesVariance = data.actualSales - data.projectedSales;
  const salesVariancePercent = data.projectedSales > 0 ? ((salesVariance / data.projectedSales) * 100) : 0;
  const salesColor = salesVariance >= 0 ? '#10b981' : '#ef4444';

  // Croo brand colors
  const primaryColor = "#0a7a8a";
  const accentColor = "#f58220";
  const backgroundColor = "#f0ebe1";
  const textColor = "#0f1215";
  
  // Generate pie chart SVG for checklist completion
  const completionRate = data.checklistData.total > 0 ? (data.checklistData.completed / data.checklistData.total) * 100 : 0;
  const completedAngle = (completionRate / 100) * 360;
  const largeArcFlag = completedAngle > 180 ? 1 : 0;
  const radians = (completedAngle - 90) * (Math.PI / 180);
  const endX = 50 + 40 * Math.cos(radians);
  const endY = 50 + 40 * Math.sin(radians);
  
  const pieChartSvg = data.checklistData.total > 0 ? `
    <svg width="80" height="80" viewBox="0 0 100 100" style="display: block;">
      <circle cx="50" cy="50" r="40" fill="#e5e7eb"/>
      ${completionRate > 0 ? `<path d="M 50 50 L 50 10 A 40 40 0 ${largeArcFlag} 1 ${endX} ${endY} Z" fill="${completionRate === 100 ? '#10b981' : primaryColor}"/>` : ''}
      <circle cx="50" cy="50" r="25" fill="white"/>
      <text x="50" y="55" text-anchor="middle" font-size="16" font-weight="bold" fill="${textColor}">${Math.round(completionRate)}%</text>
    </svg>
  ` : '';

  // Top items table (show top 5 in email, sorted by sales)
  const topItemsHtml = data.topItems.length > 0 
    ? data.topItems.slice(0, 5).map((item, i) => `
        <tr style="border-bottom: 1px solid #e5e7eb;">
          <td style="padding: 6px 8px; color: #6b7280; font-size: 12px;">${i + 1}</td>
          <td style="padding: 6px 8px; color: #374151; font-size: 12px;">${item.name}</td>
          <td style="padding: 6px 8px; color: #374151; text-align: right; font-size: 12px;">${item.quantity}</td>
          <td style="padding: 6px 8px; color: #374151; text-align: right; font-size: 12px;">${formatCurrency(item.sales)}</td>
        </tr>
      `).join('')
    : '<tr><td colspan="4" style="padding: 12px; text-align: center; color: #9ca3af; font-size: 12px;">No product data available</td></tr>';

  // Checklist items list
  const checklistItemsHtml = data.checklistData.items.length > 0 
    ? data.checklistData.items.map(item => `
        <div style="display: flex; align-items: center; gap: 6px; padding: 4px 0; font-size: 12px;">
          <span style="color: ${item.completed ? '#10b981' : '#ef4444'};">${item.completed ? '✓' : '✗'}</span>
          <span style="color: ${item.completed ? '#374151' : '#9ca3af'};">${item.title}</span>
        </div>
      `).join('')
    : '<p style="color: #9ca3af; font-size: 12px; margin: 0;">No checklists due today</p>';

  // Events summary
  const hasEvents = data.eventsData.scheduleEvents.length > 0 || data.eventsData.cateringOrders.length > 0 || data.safeCountData.length > 0 || data.drawerCountData;
  
  const eventsHtml = hasEvents ? `
    ${data.eventsData.cateringOrders.length > 0 ? `
      <div style="margin-bottom: 12px;">
        <p style="margin: 0 0 6px; font-weight: 600; color: ${textColor}; font-size: 12px;">🥡 Catering Orders</p>
        ${data.eventsData.cateringOrders.map(order => `
          <div style="padding: 4px 0; font-size: 12px; color: #374151;">
            ${order.pickupTime} - ${order.customerName} 
            <span style="color: ${order.status === 'completed' ? '#10b981' : '#f59e0b'};">
              (${order.status}${order.completedBy ? ` by ${order.completedBy}` : ''})
            </span>
          </div>
        `).join('')}
      </div>
    ` : ''}
    ${data.safeCountData.length > 0 ? `
      <div style="margin-bottom: 12px;">
        <p style="margin: 0 0 6px; font-weight: 600; color: ${textColor}; font-size: 12px;">🔐 Safe Counts</p>
        ${data.safeCountData.map(sc => `
          <div style="padding: 4px 0; font-size: 12px; color: #374151;">
            ${sc.shift}: ${formatCurrency(sc.totalCash)} 
            <span style="color: ${sc.variance >= 0 ? '#10b981' : '#ef4444'};">(${sc.variance >= 0 ? '+' : ''}${formatCurrency(sc.variance)})</span>
            ${sc.completedBy ? ` - ${sc.completedBy}` : ''}
          </div>
        `).join('')}
      </div>
    ` : ''}
    ${data.drawerCountData ? `
      <div style="margin-bottom: 12px;">
        <p style="margin: 0 0 6px; font-weight: 600; color: ${textColor}; font-size: 12px;">💰 Deposit</p>
        <div style="padding: 4px 0; font-size: 12px; color: #374151;">
          ${formatCurrency(data.drawerCountData.totalDeposit)} 
          <span style="color: ${data.drawerCountData.variance >= 0 ? '#10b981' : '#ef4444'};">(${data.drawerCountData.variance >= 0 ? '+' : ''}${formatCurrency(data.drawerCountData.variance)})</span>
          ${data.drawerCountData.completedBy ? ` - ${data.drawerCountData.completedBy}` : ''}
        </div>
      </div>
    ` : ''}
    ${data.eventsData.scheduleEvents.length > 0 ? `
      <div>
        <p style="margin: 0 0 6px; font-weight: 600; color: ${textColor}; font-size: 12px;">📅 Other Events</p>
        ${data.eventsData.scheduleEvents.map(event => `
          <div style="padding: 4px 0; font-size: 12px; color: #374151;">
            ${event.startTime}${event.endTime ? `-${event.endTime}` : ''}: ${event.title}
            ${event.completion ? ` <span style="color: #10b981;">(✓ ${event.completion.completedBy})</span>` : ''}
          </div>
        `).join('')}
      </div>
    ` : ''}
  ` : '<p style="color: #9ca3af; font-size: 12px; margin: 0;">No events today</p>';

  const remakesHtml = data.remakes.length > 0
    ? data.remakes.map(r => `
        <div style="background: #fef2f2; border-left: 3px solid #ef4444; padding: 8px 10px; margin-bottom: 6px; border-radius: 0 6px 6px 0;">
          <p style="margin: 0 0 2px 0; font-weight: 600; color: #991b1b; font-size: 12px;">${r.guestName}</p>
          <p style="margin: 0; color: #7f1d1d; font-size: 11px;">${r.details}</p>
        </div>
      `).join('')
    : '<p style="color: #10b981; text-align: center; padding: 10px; background: #f0fdf4; border-radius: 6px; font-size: 12px; margin: 0;">No remakes 🎉</p>';

  const refundsHtml = data.refunds.length > 0
    ? data.refunds.map(r => `
        <div style="background: #fef3c7; border-left: 3px solid #f59e0b; padding: 8px 10px; margin-bottom: 6px; border-radius: 0 6px 6px 0;">
          <p style="margin: 0 0 2px 0; font-weight: 600; color: #92400e; font-size: 12px;">${r.guestName}</p>
          <p style="margin: 0; color: #78350f; font-size: 11px;">${r.details}</p>
        </div>
      `).join('')
    : '<p style="color: #10b981; text-align: center; padding: 10px; background: #f0fdf4; border-radius: 6px; font-size: 12px; margin: 0;">No refunds 🎉</p>';

  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Daily Summary</title>
    </head>
    <body style="margin: 0; padding: 0; background-color: ${backgroundColor}; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
      <table role="presentation" style="width: 100%; border-collapse: collapse;">
        <tr>
          <td style="padding: 20px 12px;">
            <table role="presentation" style="max-width: 520px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 12px rgba(0,0,0,0.08);">
              
              <!-- Header -->
              <tr>
                <td style="background: linear-gradient(135deg, ${primaryColor} 0%, #0d5a65 100%); padding: 20px 24px; text-align: center;">
                  <h1 style="color: #ffffff; font-size: 20px; font-weight: 700; margin: 0;">
                    📋 Daily Summary
                  </h1>
                  <p style="color: rgba(255,255,255,0.9); font-size: 14px; margin: 6px 0 0; font-weight: 500;">
                    ${data.locationName} • ${formatDateForDisplay(data.dateStr)}
                  </p>
                </td>
              </tr>
              
              <!-- Sales & Labor Row -->
              <tr>
                <td style="padding: 16px 20px; border-bottom: 1px solid #e8e5df;">
                  <table style="width: 100%;">
                    <tr>
                      <td style="width: 50%; vertical-align: top; padding-right: 10px;">
                        <p style="margin: 0 0 4px; color: #6b7280; font-size: 11px; text-transform: uppercase;">Sales</p>
                        <p style="margin: 0; color: ${textColor}; font-size: 22px; font-weight: 700;">${formatCurrency(data.actualSales)}</p>
                        <p style="margin: 4px 0 0; font-size: 11px; color: #6b7280;">
                          Target: ${formatCurrency(data.projectedSales)}
                          <span style="color: ${salesColor}; font-weight: 600;"> (${salesVariance >= 0 ? '+' : ''}${formatCurrency(salesVariance)})</span>
                        </p>
                      </td>
                      <td style="width: 50%; vertical-align: top; padding-left: 10px; border-left: 1px solid #e8e5df;">
                        <p style="margin: 0 0 4px; color: #6b7280; font-size: 11px; text-transform: uppercase;">Labor</p>
                        ${data.hasLaborData ? `
                          <p style="margin: 0; color: ${textColor}; font-size: 18px; font-weight: 700;">${formatCurrency(data.laborCost)}</p>
                          <p style="margin: 4px 0 0; font-size: 11px; color: #6b7280;">
                            ${data.hoursWorked.toFixed(1)} hrs
                            ${data.laborPercent > 0 ? ` • <span style="color: ${data.laborPercent > 30 ? '#ef4444' : '#10b981'};">${formatPercent(data.laborPercent)}</span>` : ''}
                          </p>
                        ` : `
                          <p style="margin: 0; color: #9ca3af; font-size: 13px;">No data</p>
                        `}
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>

              <!-- Tasks & Events Row -->
              <tr>
                <td style="padding: 16px 20px; border-bottom: 1px solid #e8e5df;">
                  <table style="width: 100%;">
                    <tr>
                      <td style="width: 50%; vertical-align: top; padding-right: 10px;">
                        <p style="margin: 0 0 8px; color: ${textColor}; font-size: 12px; font-weight: 600; text-transform: uppercase;">✅ Checklists</p>
                        <div style="display: flex; align-items: flex-start; gap: 12px;">
                          ${pieChartSvg}
                          <div style="flex: 1;">
                            ${checklistItemsHtml}
                          </div>
                        </div>
                      </td>
                      <td style="width: 50%; vertical-align: top; padding-left: 10px; border-left: 1px solid #e8e5df;">
                        <p style="margin: 0 0 8px; color: ${textColor}; font-size: 12px; font-weight: 600; text-transform: uppercase;">📌 Events & Tasks</p>
                        ${eventsHtml}
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>

              <!-- Top Items -->
              <tr>
                <td style="padding: 16px 20px; border-bottom: 1px solid #e8e5df;">
                  <p style="margin: 0 0 10px; color: ${textColor}; font-size: 12px; font-weight: 600; text-transform: uppercase;">🏆 Top Items by Sales</p>
                  <table style="width: 100%; border-collapse: collapse; font-size: 12px;">
                    <thead>
                      <tr style="background: ${backgroundColor};">
                        <th style="padding: 6px 8px; text-align: left; color: #6b7280; font-size: 10px; font-weight: 600;">#</th>
                        <th style="padding: 6px 8px; text-align: left; color: #6b7280; font-size: 10px; font-weight: 600;">Item</th>
                        <th style="padding: 6px 8px; text-align: right; color: #6b7280; font-size: 10px; font-weight: 600;">Qty</th>
                        <th style="padding: 6px 8px; text-align: right; color: #6b7280; font-size: 10px; font-weight: 600;">Sales</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${topItemsHtml}
                    </tbody>
                  </table>
                </td>
              </tr>

              <!-- Remakes & Refunds Row -->
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
    const { location_id, entry_date, test_mode, test_email }: DailyLogbookSummaryRequest & { test_mode?: boolean; test_email?: string } = await req.json();
    
    console.log(`Processing daily summary for location ${location_id}, date ${entry_date}, test_mode: ${test_mode}`);

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

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
    
    // Get user profiles for completers
    const getUserName = async (userId: string) => {
      const { data } = await supabase.from('profiles').select('full_name').eq('id', userId).single();
      return data?.full_name || 'Unknown';
    };

    // Check for Safe Counts with completer info
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

    // Check for Drawer Count with completer info
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

    // Only send if both PM Safe Count AND Deposit completed (unless test_mode)
    if (!test_mode && (!hasPmSafeCount || !hasDeposit)) {
      console.log(`Email not sent - PM Safe Count: ${hasPmSafeCount}, Deposit: ${hasDeposit}`);
      return new Response(JSON.stringify({ 
        success: false, 
        reason: 'Both PM Safe Count and Drawer Count must be completed',
        hasPmSafeCount,
        hasDeposit
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch all data in parallel
    const [laborData, topItems, checklistData, eventsData, salesCache] = await Promise.all([
      fetchLaborData(supabase, location_id, entry_date),
      fetchProductMix(supabase, location_id, entry_date),
      fetchChecklistData(supabase, location_id, entry_date),
      fetchEventsData(supabase, location_id, entry_date),
      supabase.from('sales_cache').select('net_sales, projected_sales').eq('location_id', location_id).eq('sale_date', entry_date).maybeSingle()
    ]);

    const actualSales = salesCache.data?.net_sales || 0;
    const projectedSales = salesCache.data?.projected_sales || 0;
    
    // Calculate labor percent if we have sales data
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
