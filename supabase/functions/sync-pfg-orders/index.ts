import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// PFG Azure AD B2C Configuration
const PFG_B2C_TENANT = 'pfgcustomerfirst';
const PFG_B2C_POLICY = 'b2c_1a_signup_signin';
const PFG_CLIENT_ID = 'c68e7fae-80a1-42db-bd89-3fb37d1224a2';
const PFG_SCOPE = 'https://pfgcustomerfirst.onmicrosoft.com/api/customer-first-site-api openid profile offline_access';
const PFG_TOKEN_URL = `https://${PFG_B2C_TENANT}.b2clogin.com/${PFG_B2C_TENANT}.onmicrosoft.com/${PFG_B2C_POLICY}/oauth2/v2.0/token`;

const PFG_API_BASES = [
  'https://www.customerfirstsolutions.com/api/v1',
  'https://apps-zz-cusfst-mw-p-eus01.azurewebsites.net/api',
] as const;

function joinUrl(base: string, path: string) {
  const b = base.endsWith('/') ? base.slice(0, -1) : base;
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${b}${p}`;
}

async function fetchPfgJson(path: string, init: RequestInit): Promise<any> {
  for (const base of PFG_API_BASES) {
    const url = joinUrl(base, path);
    console.log('[PFG API] Request →', init.method || 'GET', url);

    const res = await fetch(url, init);

    if (res.ok) {
      const json = await res.json();
      console.log('[PFG API] Success ←', res.status, url);
      return json;
    }

    if (res.status === 404) continue;
    
    const errorText = await res.text().catch(() => '');
    throw new Error(`PFG API error: ${res.status}${errorText ? ` - ${errorText.slice(0, 200)}` : ''}`);
  }
  throw new Error('PFG API: endpoint not found');
}

interface PFGCredentials {
  username?: string;
  refresh_token: string;
  customer_id?: string;
}

async function refreshAccessToken(refreshToken: string): Promise<{ access_token: string; refresh_token: string } | null> {
  try {
    console.log('[PFG Auth] Refreshing access token');

    const params = new URLSearchParams({
      client_id: PFG_CLIENT_ID,
      scope: PFG_SCOPE,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_info: '1',
    });

    const response = await fetch(PFG_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });

    if (!response.ok) {
      console.error('[PFG Auth] Token refresh failed:', response.status);
      return null;
    }

    return await response.json();
  } catch (error) {
    console.error('[PFG Auth] Refresh error:', error);
    return null;
  }
}

async function fetchOrderHistory(accessToken: string): Promise<any> {
  console.log('[PFG API] Fetching order history');

  return fetchPfgJson(
    '/OrderHistory/V1/GetOrderHistory',
    {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json',
      },
    },
  );
}

// Parse date from PFG format (could be various formats)
function parsePfgDate(dateStr: string | null | undefined): string | null {
  if (!dateStr) return null;
  
  try {
    // Try ISO format first
    const date = new Date(dateStr);
    if (!isNaN(date.getTime())) {
      return date.toISOString().split('T')[0];
    }
  } catch {
    // Continue to other formats
  }
  
  // Try MM/DD/YYYY format
  const parts = dateStr.split('/');
  if (parts.length === 3) {
    const [month, day, year] = parts;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }
  
  return null;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get optional locationId from body (for manual trigger) or sync all locations
    let locationIds: string[] = [];
    
    try {
      const body = await req.json();
      if (body.locationId) {
        locationIds = [body.locationId];
      }
    } catch {
      // No body, sync all locations
    }

    // Fetch all active PFG integrations
    let query = supabase
      .from('location_integrations')
      .select('id, location_id, credentials')
      .eq('integration_type', 'pfg')
      .eq('is_active', true);
    
    if (locationIds.length > 0) {
      query = query.in('location_id', locationIds);
    }

    const { data: integrations, error: intError } = await query;

    if (intError) {
      throw new Error(`Failed to fetch integrations: ${intError.message}`);
    }

    if (!integrations || integrations.length === 0) {
      console.log('[Sync PFG Orders] No active PFG integrations found');
      return new Response(JSON.stringify({ 
        success: true, 
        message: 'No active PFG integrations',
        synced: 0 
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`[Sync PFG Orders] Found ${integrations.length} active PFG integrations`);

    const results: { locationId: string; success: boolean; ordersImported: number; error?: string }[] = [];

    for (const integration of integrations) {
      const credentials = integration.credentials as unknown as PFGCredentials;
      
      if (!credentials?.refresh_token) {
        results.push({ 
          locationId: integration.location_id, 
          success: false, 
          ordersImported: 0, 
          error: 'No refresh token' 
        });
        continue;
      }

      try {
        // Refresh token
        const tokenData = await refreshAccessToken(credentials.refresh_token);
        
        if (!tokenData) {
          results.push({ 
            locationId: integration.location_id, 
            success: false, 
            ordersImported: 0, 
            error: 'Token refresh failed' 
          });
          continue;
        }

        // Update stored refresh token
        if (tokenData.refresh_token) {
          await supabase
            .from('location_integrations')
            .update({
              credentials: { ...credentials, refresh_token: tokenData.refresh_token },
            })
            .eq('id', integration.id);
        }

        // Fetch order history
        const orderData = await fetchOrderHistory(tokenData.access_token);
        console.log('[Sync PFG Orders] Raw order response:', JSON.stringify(orderData).substring(0, 1000));

        // Parse orders - adapt based on actual PFG response structure
        const rawOrders = orderData?.ResultObject?.Orders || orderData?.Orders || orderData?.ResultObject || [];
        const orders = Array.isArray(rawOrders) ? rawOrders : [];
        
        console.log(`[Sync PFG Orders] Found ${orders.length} orders for location ${integration.location_id}`);

        let importedCount = 0;

        for (const order of orders) {
          // Extract order ID - try various field names
          const pfgOrderId = order.OrderId || order.OrderNumber || order.Id || order.ConfirmationNumber;
          
          if (!pfgOrderId) {
            console.log('[Sync PFG Orders] Skipping order without ID:', JSON.stringify(order).substring(0, 200));
            continue;
          }

          // Parse dates
          const orderDate = parsePfgDate(order.OrderDate || order.CreatedDate || order.SubmittedDate);
          const deliveryDate = parsePfgDate(order.DeliveryDate || order.RequestedDeliveryDate || order.ScheduledDeliveryDate);

          if (!orderDate) {
            console.log('[Sync PFG Orders] Skipping order without order date:', pfgOrderId);
            continue;
          }

          // Parse items
          const items = (order.Items || order.OrderItems || order.LineItems || []).map((item: any) => ({
            productId: item.ProductKey || item.ProductId || item.ItemNumber,
            itemNumber: item.DisplayProductNumber || item.ProductNumber || item.ItemNumber,
            name: item.ProductDescription || item.Description || item.Name,
            quantity: item.Quantity || item.OrderQuantity || 0,
            unit: item.UnitOfMeasure || item.UOM || 'CS',
            price: item.Price || item.UnitPrice || 0,
            total: item.ExtendedPrice || item.LineTotal || 0,
          }));

          // Upsert order
          const { error: upsertError } = await supabase
            .from('pfg_orders')
            .upsert({
              location_id: integration.location_id,
              pfg_order_id: String(pfgOrderId),
              order_number: order.OrderNumber || order.ConfirmationNumber,
              order_date: orderDate,
              delivery_date: deliveryDate,
              status: order.Status || order.OrderStatus,
              total_amount: order.TotalAmount || order.OrderTotal || order.Total,
              items: items,
              raw_data: order,
              updated_at: new Date().toISOString(),
            }, {
              onConflict: 'location_id,pfg_order_id',
            });

          if (upsertError) {
            console.error('[Sync PFG Orders] Upsert error:', upsertError);
          } else {
            importedCount++;
          }
        }

        results.push({ 
          locationId: integration.location_id, 
          success: true, 
          ordersImported: importedCount 
        });

      } catch (error) {
        console.error(`[Sync PFG Orders] Error for location ${integration.location_id}:`, error);
        results.push({ 
          locationId: integration.location_id, 
          success: false, 
          ordersImported: 0, 
          error: error instanceof Error ? error.message : 'Unknown error' 
        });
      }
    }

    const totalImported = results.reduce((sum, r) => sum + r.ordersImported, 0);
    console.log(`[Sync PFG Orders] Sync complete. Total orders imported: ${totalImported}`);

    return new Response(JSON.stringify({ 
      success: true,
      results,
      totalImported,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('[Sync PFG Orders] Error:', error);
    return new Response(JSON.stringify({ 
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
