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
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
}

function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`;
}

// Get date string in location timezone
function getDateStringForTimezone(date: Date, timezone: string): string {
  const tzDate = new Date(date.toLocaleString('en-US', { timeZone: timezone }));
  const year = tzDate.getFullYear();
  const month = String(tzDate.getMonth() + 1).padStart(2, '0');
  const day = String(tzDate.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatDateForDisplay(dateStr: string): string {
  const date = new Date(dateStr + 'T12:00:00');
  return date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}

// Fetch QuBeyond sales data
async function fetchQuBeyondData(supabase: any, locationId: string, dateStr: string) {
  try {
    // Get location integration credentials
    const { data: integration } = await supabase
      .from('location_integrations')
      .select('credentials')
      .eq('location_id', locationId)
      .eq('integration_type', 'qubeyond')
      .eq('is_active', true)
      .maybeSingle();

    if (!integration?.credentials) {
      console.log('No QuBeyond integration found for location');
      return null;
    }

    const credentials = integration.credentials as { username: string; password: string; location_id?: string };
    
    // Authenticate with QuBeyond
    const authResponse = await fetch('https://admin.qubeyond.com/api/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        authType: 'classic',
        username: credentials.username,
        password: credentials.password
      }),
    });

    if (!authResponse.ok) {
      console.error('QuBeyond auth failed');
      return null;
    }

    const authData = await authResponse.json();
    const tokenGw = authData.tokenGw;
    const qbLocationId = credentials.location_id;

    if (!tokenGw || !qbLocationId) {
      console.error('Missing QuBeyond token or location ID');
      return null;
    }

    // Fetch sales data
    const salesResponse = await fetch('https://gateway-api.qubeyond.com/api/v4/data/reports/summary/sections/sales', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': tokenGw,
        'Origin': 'https://admin.qubeyond.com',
      },
      body: JSON.stringify({
        fields: [{ fieldName: "metric" }, { fieldName: "total" }],
        filters: {
          date: { from: null, to: null, values: [dateStr], type: "custom" },
          location: { operationalUnits: [parseInt(qbLocationId)] }
        },
        params: { sectionId: "overview", pageNumber: 1, pageSize: 25, showTotals: true }
      }),
    });

    let actualSales = 0;
    if (salesResponse.ok) {
      const salesData = await salesResponse.json();
      if (salesData.items) {
        for (const item of salesData.items) {
          if (item.metricTypeId === 1 || item.metric === 'Net Sales') {
            actualSales = parseFloat(String(item.total || '0').replace(/,/g, '')) || 0;
          }
        }
      }
    }

    // Fetch labor data
    const laborResponse = await fetch('https://gateway-api.qubeyond.com/api/v4/data/reports/real-time-summary/sections/overview', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': tokenGw,
        'Origin': 'https://admin.qubeyond.com',
      },
      body: JSON.stringify({
        fields: [{ fieldName: "metric" }, { fieldName: "total" }],
        filters: {
          date: { from: null, to: null, values: [dateStr], type: "today" },
          singleLocation: parseInt(qbLocationId),
          clockInRequired: true
        },
        params: { sectionId: "overview", pageNumber: 1, pageSize: 25, showTotals: true }
      }),
    });

    let laborPercent = 0;
    let laborCost = 0;
    let hoursWorked = 0;
    if (laborResponse.ok) {
      const laborData = await laborResponse.json();
      if (laborData.items) {
        for (const item of laborData.items) {
          const metric = item.metric?.toLowerCase() || '';
          const total = parseFloat(String(item.total || '0').replace(/[$,%]/g, '')) || 0;
          if (metric.includes('total labor %')) laborPercent = total;
          else if (metric.includes('labor cost')) laborCost = total;
          else if (metric === 'hours worked') hoursWorked = total;
        }
      }
    }

    // Fetch product mix (top 5 items)
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
        params: { sectionId: "main", pageNumber: 1, pageSize: 200, sort: [{ field: "quantity", dir: "desc" }], showTotals: true }
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
                if (quantity > 0) allItems.push({ name, quantity, sales });
              }
            }
          } else {
            const name = item.itemName || '';
            if (name && name !== 'Totals') {
              const quantity = parseFloat(String(item.quantity || '0').replace(/,/g, '')) || 0;
              const sales = parseFloat(String(item.netSales || '0').replace(/[$,]/g, '')) || 0;
              if (quantity > 0) allItems.push({ name, quantity, sales });
            }
          }
        }
        
        allItems.sort((a, b) => b.quantity - a.quantity);
        topItems.push(...allItems.slice(0, 5));
      }
    }

    return {
      actualSales,
      laborPercent,
      laborCost,
      hoursWorked,
      topItems,
      hasData: true
    };
  } catch (error) {
    console.error('Error fetching QuBeyond data:', error);
    return null;
  }
}

// Generate the HTML email
function generateEmailHtml(data: {
  locationName: string;
  dateStr: string;
  actualSales: number;
  projectedSales: number;
  laborPercent: number;
  laborCost: number;
  hoursWorked: number;
  hasLaborData: boolean;
  topItems: { name: string; quantity: number; sales: number }[];
  remakes: { guestName: string; details: string }[];
  refunds: { guestName: string; details: string }[];
  safeCountData: { shift: string; totalCash: number; variance: number }[];
  drawerCountData: { expected: number; actual: number; variance: number; totalDeposit: number } | null;
}): string {
  const salesVariance = data.actualSales - data.projectedSales;
  const salesVariancePercent = data.projectedSales > 0 ? ((salesVariance / data.projectedSales) * 100) : 0;
  const salesColor = salesVariance >= 0 ? '#10b981' : '#ef4444';

  const topItemsHtml = data.topItems.length > 0 
    ? data.topItems.map((item, i) => `
        <tr style="border-bottom: 1px solid #e5e7eb;">
          <td style="padding: 10px 12px; color: #6b7280;">${i + 1}</td>
          <td style="padding: 10px 12px; color: #374151; font-weight: 500;">${item.name}</td>
          <td style="padding: 10px 12px; color: #374151; text-align: right;">${item.quantity}</td>
          <td style="padding: 10px 12px; color: #374151; text-align: right;">${formatCurrency(item.sales)}</td>
        </tr>
      `).join('')
    : '<tr><td colspan="4" style="padding: 16px; text-align: center; color: #9ca3af;">No product data available</td></tr>';

  const laborHtml = data.hasLaborData 
    ? `
        <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
          <span style="color: #6b7280;">Labor Cost:</span>
          <span style="color: #374151; font-weight: 600;">${formatCurrency(data.laborCost)}</span>
        </div>
        <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
          <span style="color: #6b7280;">Labor %:</span>
          <span style="color: ${data.laborPercent > 30 ? '#ef4444' : '#10b981'}; font-weight: 600;">${formatPercent(data.laborPercent)}</span>
        </div>
        <div style="display: flex; justify-content: space-between;">
          <span style="color: #6b7280;">Hours Worked:</span>
          <span style="color: #374151; font-weight: 600;">${data.hoursWorked.toFixed(1)} hrs</span>
        </div>
      `
    : '<p style="color: #9ca3af; text-align: center; margin: 16px 0;">No labor data available</p>';

  const remakesHtml = data.remakes.length > 0
    ? data.remakes.map(r => `
        <div style="background: #fef2f2; border-left: 3px solid #ef4444; padding: 12px; margin-bottom: 8px; border-radius: 0 8px 8px 0;">
          <p style="margin: 0 0 4px 0; font-weight: 600; color: #991b1b;">${r.guestName}</p>
          <p style="margin: 0; color: #7f1d1d; font-size: 14px;">${r.details}</p>
        </div>
      `).join('')
    : '<p style="color: #10b981; text-align: center; padding: 16px; background: #f0fdf4; border-radius: 8px;">No remakes today 🎉</p>';

  const refundsHtml = data.refunds.length > 0
    ? data.refunds.map(r => `
        <div style="background: #fef3c7; border-left: 3px solid #f59e0b; padding: 12px; margin-bottom: 8px; border-radius: 0 8px 8px 0;">
          <p style="margin: 0 0 4px 0; font-weight: 600; color: #92400e;">${r.guestName}</p>
          <p style="margin: 0; color: #78350f; font-size: 14px;">${r.details}</p>
        </div>
      `).join('')
    : '<p style="color: #10b981; text-align: center; padding: 16px; background: #f0fdf4; border-radius: 8px;">No refunds today 🎉</p>';

  const safeCountHtml = data.safeCountData.length > 0
    ? data.safeCountData.map(sc => `
        <div style="display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #e5e7eb;">
          <span style="color: #6b7280;">${sc.shift} Safe Count:</span>
          <span style="color: #374151; font-weight: 600;">${formatCurrency(sc.totalCash)}</span>
          <span style="color: ${sc.variance >= 0 ? '#10b981' : '#ef4444'}; font-weight: 500;">${sc.variance >= 0 ? '+' : ''}${formatCurrency(sc.variance)}</span>
        </div>
      `).join('')
    : '';

  const drawerCountHtml = data.drawerCountData
    ? `
        <div style="background: #f9fafb; padding: 16px; border-radius: 12px;">
          <div style="display: flex; justify-content: space-between; margin-bottom: 12px;">
            <span style="color: #6b7280;">Expected:</span>
            <span style="color: #374151; font-weight: 600;">${formatCurrency(data.drawerCountData.expected)}</span>
          </div>
          <div style="display: flex; justify-content: space-between; margin-bottom: 12px;">
            <span style="color: #6b7280;">Actual Count:</span>
            <span style="color: #374151; font-weight: 600;">${formatCurrency(data.drawerCountData.actual)}</span>
          </div>
          <div style="display: flex; justify-content: space-between; margin-bottom: 12px; padding-top: 12px; border-top: 1px solid #e5e7eb;">
            <span style="color: #6b7280; font-weight: 600;">Over/Under:</span>
            <span style="color: ${data.drawerCountData.variance >= 0 ? '#10b981' : '#ef4444'}; font-weight: 700; font-size: 18px;">
              ${data.drawerCountData.variance >= 0 ? '+' : ''}${formatCurrency(data.drawerCountData.variance)}
            </span>
          </div>
          <div style="display: flex; justify-content: space-between; padding-top: 12px; border-top: 1px solid #e5e7eb;">
            <span style="color: #6b7280;">Total Deposit:</span>
            <span style="color: #1d4ed8; font-weight: 700;">${formatCurrency(data.drawerCountData.totalDeposit)}</span>
          </div>
        </div>
      `
    : '<p style="color: #9ca3af; text-align: center;">No drawer count data available</p>';

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Daily Logbook Summary</title>
    </head>
    <body style="margin: 0; padding: 0; background-color: #f3f4f6; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">
      <div style="max-width: 600px; margin: 0 auto; padding: 24px;">
        
        <!-- Header -->
        <div style="background: linear-gradient(135deg, #3b82f6, #1d4ed8); border-radius: 16px 16px 0 0; padding: 32px 24px; text-align: center;">
          <h1 style="margin: 0 0 8px 0; color: #ffffff; font-size: 24px; font-weight: 700;">Daily Logbook Summary</h1>
          <p style="margin: 0; color: rgba(255,255,255,0.9); font-size: 16px;">${data.locationName}</p>
          <p style="margin: 8px 0 0 0; color: rgba(255,255,255,0.75); font-size: 14px;">${formatDateForDisplay(data.dateStr)}</p>
        </div>

        <!-- Main Content -->
        <div style="background: #ffffff; padding: 0; border-radius: 0 0 16px 16px; overflow: hidden;">
          
          <!-- Sales Section -->
          <div style="padding: 24px; border-bottom: 1px solid #e5e7eb;">
            <h2 style="margin: 0 0 16px 0; color: #1f2937; font-size: 18px; display: flex; align-items: center;">
              <span style="margin-right: 8px;">📊</span> Sales Performance
            </h2>
            <div style="display: flex; justify-content: space-between; align-items: center; background: #f9fafb; padding: 16px; border-radius: 12px; margin-bottom: 12px;">
              <div>
                <p style="margin: 0 0 4px 0; color: #6b7280; font-size: 12px; text-transform: uppercase;">Actual Sales</p>
                <p style="margin: 0; color: #1f2937; font-size: 28px; font-weight: 700;">${formatCurrency(data.actualSales)}</p>
              </div>
              <div style="text-align: right;">
                <p style="margin: 0 0 4px 0; color: #6b7280; font-size: 12px; text-transform: uppercase;">Projected</p>
                <p style="margin: 0; color: #6b7280; font-size: 20px; font-weight: 600;">${formatCurrency(data.projectedSales)}</p>
              </div>
            </div>
            <div style="text-align: center; padding: 12px; background: ${salesVariance >= 0 ? '#f0fdf4' : '#fef2f2'}; border-radius: 8px;">
              <span style="color: ${salesColor}; font-weight: 600; font-size: 16px;">
                ${salesVariance >= 0 ? '↑' : '↓'} ${formatCurrency(Math.abs(salesVariance))} (${salesVariancePercent >= 0 ? '+' : ''}${salesVariancePercent.toFixed(1)}%)
              </span>
            </div>
          </div>

          <!-- Labor Section -->
          <div style="padding: 24px; border-bottom: 1px solid #e5e7eb;">
            <h2 style="margin: 0 0 16px 0; color: #1f2937; font-size: 18px; display: flex; align-items: center;">
              <span style="margin-right: 8px;">👥</span> Labor
            </h2>
            ${laborHtml}
          </div>

          <!-- Top 5 Items -->
          <div style="padding: 24px; border-bottom: 1px solid #e5e7eb;">
            <h2 style="margin: 0 0 16px 0; color: #1f2937; font-size: 18px; display: flex; align-items: center;">
              <span style="margin-right: 8px;">🏆</span> Top 5 Sold Items
            </h2>
            <table style="width: 100%; border-collapse: collapse;">
              <thead>
                <tr style="background: #f9fafb;">
                  <th style="padding: 10px 12px; text-align: left; color: #6b7280; font-size: 12px; font-weight: 600;">#</th>
                  <th style="padding: 10px 12px; text-align: left; color: #6b7280; font-size: 12px; font-weight: 600;">Item</th>
                  <th style="padding: 10px 12px; text-align: right; color: #6b7280; font-size: 12px; font-weight: 600;">Qty</th>
                  <th style="padding: 10px 12px; text-align: right; color: #6b7280; font-size: 12px; font-weight: 600;">Sales</th>
                </tr>
              </thead>
              <tbody>
                ${topItemsHtml}
              </tbody>
            </table>
          </div>

          <!-- Cash Handling Section -->
          <div style="padding: 24px; border-bottom: 1px solid #e5e7eb;">
            <h2 style="margin: 0 0 16px 0; color: #1f2937; font-size: 18px; display: flex; align-items: center;">
              <span style="margin-right: 8px;">💰</span> Drawer Count / Deposit
            </h2>
            ${drawerCountHtml}
          </div>

          <!-- Remakes Section -->
          <div style="padding: 24px; border-bottom: 1px solid #e5e7eb;">
            <h2 style="margin: 0 0 16px 0; color: #1f2937; font-size: 18px; display: flex; align-items: center;">
              <span style="margin-right: 8px;">🔄</span> Guest Remakes (${data.remakes.length})
            </h2>
            ${remakesHtml}
          </div>

          <!-- Refunds Section -->
          <div style="padding: 24px;">
            <h2 style="margin: 0 0 16px 0; color: #1f2937; font-size: 18px; display: flex; align-items: center;">
              <span style="margin-right: 8px;">💳</span> Refunds (${data.refunds.length})
            </h2>
            ${refundsHtml}
          </div>

        </div>

        <!-- Footer -->
        <div style="text-align: center; padding: 24px; color: #9ca3af; font-size: 12px;">
          <p style="margin: 0;">This summary was generated automatically by Croo</p>
          <p style="margin: 8px 0 0 0;">Sent when both Safe Count and Deposit were completed</p>
        </div>
        
      </div>
    </body>
    </html>
  `;
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { location_id, entry_date }: DailyLogbookSummaryRequest = await req.json();
    
    console.log(`Processing daily logbook summary for location ${location_id}, date ${entry_date}`);

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

    // Get location settings for timezone
    const { data: locationSettings } = await supabase
      .from('location_settings')
      .select('timezone')
      .eq('location_id', location_id)
      .maybeSingle();

    const timezone = locationSettings?.timezone || 'America/Los_Angeles';

    // Check if both Safe Count (PM) and Deposit have been submitted today
    const { data: categories } = await supabase
      .from('logbook_categories')
      .select('id, name')
      .eq('location_id', location_id)
      .eq('is_active', true);

    const safeCountCategoryId = categories?.find(c => c.name?.toLowerCase() === 'safe count')?.id;
    const drawerCountCategoryId = categories?.find(c => c.name?.toLowerCase() === 'drawer count')?.id;
    
    // Check for PM Safe Count
    const { data: safeCountEntries } = await supabase
      .from('logbook_entries')
      .select('*, logbook_entry_values(*)')
      .eq('category_id', safeCountCategoryId)
      .eq('entry_date', entry_date)
      .eq('location_id', location_id);

    const safeCountData: { shift: string; totalCash: number; variance: number }[] = [];
    let hasPmSafeCount = false;

    for (const entry of safeCountEntries || []) {
      try {
        const valueText = entry.logbook_entry_values?.[0]?.value_text;
        if (valueText) {
          const data = JSON.parse(valueText);
          safeCountData.push({
            shift: data.shift || 'Unknown',
            totalCash: data.totalSafe || 0,
            variance: data.difference || 0
          });
          if (data.shift === 'PM') {
            hasPmSafeCount = true;
          }
        }
      } catch (e) {
        console.error('Error parsing safe count data:', e);
      }
    }

    // Check for Drawer Count (deposit) and parse data
    const { data: drawerCountEntries } = await supabase
      .from('logbook_entries')
      .select('*, logbook_entry_values(*)')
      .eq('category_id', drawerCountCategoryId)
      .eq('entry_date', entry_date)
      .eq('location_id', location_id);

    const hasDeposit = (drawerCountEntries?.length || 0) > 0;
    
    // Parse drawer count data
    let drawerCountData: { expected: number; actual: number; variance: number; totalDeposit: number } | null = null;
    if (hasDeposit && drawerCountEntries && drawerCountEntries.length > 0) {
      try {
        const valueText = drawerCountEntries[0].logbook_entry_values?.[0]?.value_text;
        if (valueText) {
          const parsed = JSON.parse(valueText);
          drawerCountData = {
            expected: parsed.expectedDeposit || 0,
            actual: parsed.actualDeposit || 0,
            variance: (parsed.actualDeposit || 0) - (parsed.expectedDeposit || 0),
            totalDeposit: parsed.totalDeposit || 0
          };
        }
      } catch (e) {
        console.error('Error parsing drawer count data:', e);
      }
    }

    // Only send email if both PM Safe Count AND Drawer Count (Deposit) are completed
    if (!hasPmSafeCount || !hasDeposit) {
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

    // Get QuBeyond data (sales, labor, top items)
    const qbData = await fetchQuBeyondData(supabase, location_id, entry_date);

    // Get projected sales from sales_cache if available
    const { data: salesCache } = await supabase
      .from('sales_cache')
      .select('projected_sales')
      .eq('location_id', location_id)
      .eq('sale_date', entry_date)
      .maybeSingle();

    const projectedSales = salesCache?.projected_sales || 0;

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
          if (fieldName.includes('guest') || fieldName.includes('name')) {
            guestName = val.value_text || '';
          } else if (fieldName.includes('details') || fieldName.includes('notes') || fieldName.includes('reason')) {
            details = val.value_text || '';
          }
        }
        if (guestName || details) {
          remakes.push({ guestName: guestName || 'Guest', details: details || 'No details provided' });
        }
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
          if (fieldName.includes('guest') || fieldName.includes('name')) {
            guestName = val.value_text || '';
          } else if (fieldName.includes('details') || fieldName.includes('notes') || fieldName.includes('reason')) {
            details = val.value_text || '';
          }
        }
        if (guestName || details) {
          refunds.push({ guestName: guestName || 'Guest', details: details || 'No details provided' });
        }
      }
    }

    // Get manager emails for this location
    const { data: profiles } = await supabase
      .from('profiles')
      .select('email, full_name, role, location_id')
      .eq('location_id', location_id)
      .in('role', ['admin', 'manager', 'general_manager', 'shift_manager'])
      .eq('is_active', true);

    if (!profiles || profiles.length === 0) {
      console.log('No managers found for location');
      return new Response(JSON.stringify({ success: false, reason: 'No managers to email' }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const recipientEmails = profiles.map(p => p.email).filter(Boolean);
    console.log(`Sending email to ${recipientEmails.length} recipients:`, recipientEmails);

    // Generate email HTML
    const emailHtml = generateEmailHtml({
      locationName: location.name,
      dateStr: entry_date,
      actualSales: qbData?.actualSales || 0,
      projectedSales,
      laborPercent: qbData?.laborPercent || 0,
      laborCost: qbData?.laborCost || 0,
      hoursWorked: qbData?.hoursWorked || 0,
      hasLaborData: !!(qbData?.hasData && qbData.laborCost > 0),
      topItems: qbData?.topItems || [],
      remakes,
      refunds,
      safeCountData,
      drawerCountData
    });

    // Send email
    const emailResponse = await resend.emails.send({
      from: "Croo <logbook@croo.app>",
      to: recipientEmails,
      subject: `📋 Daily Summary - ${location.name} - ${formatDateForDisplay(entry_date)}`,
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
