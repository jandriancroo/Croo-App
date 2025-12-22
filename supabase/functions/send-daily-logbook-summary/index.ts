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

  // Croo brand colors from the design system
  const primaryColor = "#0a7a8a"; // teal
  const accentColor = "#f58220"; // orange
  const backgroundColor = "#f0ebe1"; // beige
  const textColor = "#0f1215"; // dark

  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Daily Logbook Summary</title>
    </head>
    <body style="margin: 0; padding: 0; background-color: ${backgroundColor}; font-family: 'Lexend', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;">
      <table role="presentation" style="width: 100%; border-collapse: collapse;">
        <tr>
          <td style="padding: 40px 20px;">
            <table role="presentation" style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 24px rgba(0,0,0,0.08);">
              
              <!-- Header with Brand Gradient -->
              <tr>
                <td style="background: linear-gradient(135deg, ${primaryColor} 0%, #0d5a65 100%); padding: 40px 40px 32px; text-align: center;">
                  <div style="font-size: 40px; margin-bottom: 12px;">📋</div>
                  <h1 style="color: #ffffff; font-size: 28px; font-weight: 700; margin: 0; letter-spacing: -0.5px;">
                    Daily Logbook Summary
                  </h1>
                  <p style="color: rgba(255,255,255,0.95); font-size: 18px; margin: 12px 0 0; font-weight: 500;">
                    ${data.locationName}
                  </p>
                  <p style="color: rgba(255,255,255,0.8); font-size: 14px; margin: 8px 0 0;">
                    ${formatDateForDisplay(data.dateStr)}
                  </p>
                </td>
              </tr>
              
              <!-- Sales Performance -->
              <tr>
                <td style="padding: 32px 40px; border-bottom: 1px solid #e8e5df;">
                  <h2 style="color: ${textColor}; font-size: 16px; font-weight: 600; margin: 0 0 20px; text-transform: uppercase; letter-spacing: 0.5px;">
                    📊 Sales Performance
                  </h2>
                  <div style="background: linear-gradient(135deg, ${backgroundColor} 0%, #e8e3d9 100%); border-radius: 12px; padding: 20px; margin-bottom: 16px;">
                    <table style="width: 100%;">
                      <tr>
                        <td style="padding-bottom: 12px;">
                          <p style="margin: 0; color: #6b7280; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px;">Actual Sales</p>
                          <p style="margin: 4px 0 0; color: ${textColor}; font-size: 32px; font-weight: 700;">${formatCurrency(data.actualSales)}</p>
                        </td>
                        <td style="text-align: right; padding-bottom: 12px;">
                          <p style="margin: 0; color: #6b7280; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px;">Projected</p>
                          <p style="margin: 4px 0 0; color: #6b7280; font-size: 24px; font-weight: 600;">${formatCurrency(data.projectedSales)}</p>
                        </td>
                      </tr>
                    </table>
                  </div>
                  <div style="text-align: center; padding: 14px; background: ${salesVariance >= 0 ? '#ecfdf5' : '#fef2f2'}; border-radius: 10px; border: 1px solid ${salesVariance >= 0 ? '#a7f3d0' : '#fecaca'};">
                    <span style="color: ${salesColor}; font-weight: 700; font-size: 18px;">
                      ${salesVariance >= 0 ? '▲' : '▼'} ${formatCurrency(Math.abs(salesVariance))} (${salesVariancePercent >= 0 ? '+' : ''}${salesVariancePercent.toFixed(1)}%)
                    </span>
                  </div>
                </td>
              </tr>

              <!-- Labor Section -->
              <tr>
                <td style="padding: 32px 40px; border-bottom: 1px solid #e8e5df;">
                  <h2 style="color: ${textColor}; font-size: 16px; font-weight: 600; margin: 0 0 20px; text-transform: uppercase; letter-spacing: 0.5px;">
                    👥 Labor
                  </h2>
                  <div style="background: linear-gradient(135deg, ${backgroundColor} 0%, #e8e3d9 100%); border-radius: 12px; padding: 20px;">
                    ${data.hasLaborData ? `
                      <table style="width: 100%;">
                        <tr>
                          <td style="padding: 8px 0; color: #6b7280;">Labor Cost:</td>
                          <td style="padding: 8px 0; text-align: right; color: ${textColor}; font-weight: 600;">${formatCurrency(data.laborCost)}</td>
                        </tr>
                        <tr>
                          <td style="padding: 8px 0; color: #6b7280;">Labor %:</td>
                          <td style="padding: 8px 0; text-align: right; color: ${data.laborPercent > 30 ? '#ef4444' : '#10b981'}; font-weight: 700; font-size: 18px;">${formatPercent(data.laborPercent)}</td>
                        </tr>
                        <tr>
                          <td style="padding: 8px 0; color: #6b7280;">Hours Worked:</td>
                          <td style="padding: 8px 0; text-align: right; color: ${textColor}; font-weight: 600;">${data.hoursWorked.toFixed(1)} hrs</td>
                        </tr>
                      </table>
                    ` : `
                      <p style="color: #9ca3af; text-align: center; margin: 0; padding: 12px;">No labor data available</p>
                    `}
                  </div>
                </td>
              </tr>

              <!-- Top 5 Items -->
              <tr>
                <td style="padding: 32px 40px; border-bottom: 1px solid #e8e5df;">
                  <h2 style="color: ${textColor}; font-size: 16px; font-weight: 600; margin: 0 0 20px; text-transform: uppercase; letter-spacing: 0.5px;">
                    🏆 Top 5 Sold Items
                  </h2>
                  <table style="width: 100%; border-collapse: collapse; background: #ffffff; border-radius: 10px; overflow: hidden; border: 1px solid #e8e5df;">
                    <thead>
                      <tr style="background: linear-gradient(135deg, ${primaryColor} 0%, #0d5a65 100%);">
                        <th style="padding: 12px 14px; text-align: left; color: #ffffff; font-size: 11px; font-weight: 600; text-transform: uppercase;">#</th>
                        <th style="padding: 12px 14px; text-align: left; color: #ffffff; font-size: 11px; font-weight: 600; text-transform: uppercase;">Item</th>
                        <th style="padding: 12px 14px; text-align: right; color: #ffffff; font-size: 11px; font-weight: 600; text-transform: uppercase;">Qty</th>
                        <th style="padding: 12px 14px; text-align: right; color: #ffffff; font-size: 11px; font-weight: 600; text-transform: uppercase;">Sales</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${topItemsHtml}
                    </tbody>
                  </table>
                </td>
              </tr>

              <!-- Drawer Count / Deposit -->
              <tr>
                <td style="padding: 32px 40px; border-bottom: 1px solid #e8e5df;">
                  <h2 style="color: ${textColor}; font-size: 16px; font-weight: 600; margin: 0 0 20px; text-transform: uppercase; letter-spacing: 0.5px;">
                    💰 Drawer Count / Deposit
                  </h2>
                  ${data.drawerCountData ? `
                    <div style="background: linear-gradient(135deg, ${backgroundColor} 0%, #e8e3d9 100%); border-radius: 12px; padding: 20px;">
                      <table style="width: 100%;">
                        <tr>
                          <td style="padding: 10px 0; color: #6b7280;">Expected:</td>
                          <td style="padding: 10px 0; text-align: right; color: ${textColor}; font-weight: 600;">${formatCurrency(data.drawerCountData.expected)}</td>
                        </tr>
                        <tr>
                          <td style="padding: 10px 0; color: #6b7280;">Actual Count:</td>
                          <td style="padding: 10px 0; text-align: right; color: ${textColor}; font-weight: 600;">${formatCurrency(data.drawerCountData.actual)}</td>
                        </tr>
                        <tr style="border-top: 2px solid #d4cfc4;">
                          <td style="padding: 14px 0 10px; color: ${textColor}; font-weight: 600;">Over/Under:</td>
                          <td style="padding: 14px 0 10px; text-align: right; color: ${data.drawerCountData.variance >= 0 ? '#10b981' : '#ef4444'}; font-weight: 700; font-size: 20px;">
                            ${data.drawerCountData.variance >= 0 ? '+' : ''}${formatCurrency(data.drawerCountData.variance)}
                          </td>
                        </tr>
                        <tr style="border-top: 1px solid #d4cfc4;">
                          <td style="padding: 14px 0 0; color: #6b7280;">Total Deposit:</td>
                          <td style="padding: 14px 0 0; text-align: right; color: ${accentColor}; font-weight: 700; font-size: 18px;">${formatCurrency(data.drawerCountData.totalDeposit)}</td>
                        </tr>
                      </table>
                    </div>
                  ` : `
                    <div style="background: ${backgroundColor}; border-radius: 12px; padding: 24px; text-align: center;">
                      <p style="color: #9ca3af; margin: 0;">No drawer count data available</p>
                    </div>
                  `}
                </td>
              </tr>

              <!-- Guest Remakes -->
              <tr>
                <td style="padding: 32px 40px; border-bottom: 1px solid #e8e5df;">
                  <h2 style="color: ${textColor}; font-size: 16px; font-weight: 600; margin: 0 0 20px; text-transform: uppercase; letter-spacing: 0.5px;">
                    🔄 Guest Remakes (${data.remakes.length})
                  </h2>
                  ${data.remakes.length > 0 
                    ? data.remakes.map(r => `
                        <div style="background: #fef2f2; border-left: 4px solid #ef4444; padding: 14px 16px; margin-bottom: 10px; border-radius: 0 10px 10px 0;">
                          <p style="margin: 0 0 6px 0; font-weight: 600; color: #991b1b;">${r.guestName}</p>
                          <p style="margin: 0; color: #7f1d1d; font-size: 14px;">${r.details}</p>
                        </div>
                      `).join('')
                    : `<div style="background: #ecfdf5; border-radius: 10px; padding: 20px; text-align: center; border: 1px solid #a7f3d0;">
                        <p style="color: #059669; margin: 0; font-weight: 500;">No remakes today 🎉</p>
                      </div>`
                  }
                </td>
              </tr>

              <!-- Refunds -->
              <tr>
                <td style="padding: 32px 40px;">
                  <h2 style="color: ${textColor}; font-size: 16px; font-weight: 600; margin: 0 0 20px; text-transform: uppercase; letter-spacing: 0.5px;">
                    💳 Refunds (${data.refunds.length})
                  </h2>
                  ${data.refunds.length > 0 
                    ? data.refunds.map(r => `
                        <div style="background: #fef3c7; border-left: 4px solid ${accentColor}; padding: 14px 16px; margin-bottom: 10px; border-radius: 0 10px 10px 0;">
                          <p style="margin: 0 0 6px 0; font-weight: 600; color: #92400e;">${r.guestName}</p>
                          <p style="margin: 0; color: #78350f; font-size: 14px;">${r.details}</p>
                        </div>
                      `).join('')
                    : `<div style="background: #ecfdf5; border-radius: 10px; padding: 20px; text-align: center; border: 1px solid #a7f3d0;">
                        <p style="color: #059669; margin: 0; font-weight: 500;">No refunds today 🎉</p>
                      </div>`
                  }
                </td>
              </tr>
              
              <!-- Footer -->
              <tr>
                <td style="background-color: #f8f7f5; padding: 30px 40px; border-top: 1px solid #e8e5df;">
                  <table role="presentation" style="width: 100%;">
                    <tr>
                      <td style="text-align: center;">
                        <img 
                          src="https://croohq.com/assets/croo-logo-eWOfbANR.png" 
                          alt="Powered by Croo" 
                          style="height: 28px; width: auto; margin-bottom: 12px; opacity: 0.7;"
                        />
                        <p style="color: #aaa; font-size: 12px; margin: 0;">
                          Powered by Croo • Team management made simple
                        </p>
                        <p style="color: #c4c4c4; font-size: 11px; margin: 10px 0 0;">
                          Sent when both Safe Count and Deposit were completed
                        </p>
                      </td>
                    </tr>
                  </table>
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
    
    console.log(`Processing daily logbook summary for location ${location_id}, date ${entry_date}, test_mode: ${test_mode}`);

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

    // Only send email if both PM Safe Count AND Drawer Count (Deposit) are completed (unless test_mode)
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

    // Get QuBeyond data (sales, labor, top items)
    let qbData = await fetchQuBeyondData(supabase, location_id, entry_date);

    // Get sales data from sales_cache as fallback or primary source
    const { data: salesCache } = await supabase
      .from('sales_cache')
      .select('net_sales, projected_sales')
      .eq('location_id', location_id)
      .eq('sale_date', entry_date)
      .maybeSingle();

    const projectedSales = salesCache?.projected_sales || 0;
    
    // Use cached data if QuBeyond fetch failed
    if (!qbData && salesCache) {
      console.log('Using sales_cache data as fallback');
      qbData = {
        actualSales: salesCache.net_sales || 0,
        laborPercent: 0,
        laborCost: 0,
        hoursWorked: 0,
        topItems: [],
        hasData: true
      };
    } else if (qbData && salesCache?.net_sales && qbData.actualSales === 0) {
      // If QB returned 0 but cache has data, use cache
      console.log('QuBeyond returned 0 sales, using cached net_sales');
      qbData.actualSales = salesCache.net_sales;
    }

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

    if (!test_mode && (!profiles || profiles.length === 0)) {
      console.log('No managers found for location');
      return new Response(JSON.stringify({ success: false, reason: 'No managers to email' }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Use test_email in test mode, otherwise send to managers
    const recipientEmails = test_mode && test_email ? [test_email] : (profiles || []).map(p => p.email).filter(Boolean);
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
      from: "Croo <hello@croohq.email>",
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
