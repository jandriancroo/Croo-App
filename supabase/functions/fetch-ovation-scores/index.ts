import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface OvationFilters {
  companyIds: string[];
  locationIds: string[];
  createdAtRange: string[];
}

interface SurveyScore {
  locationId: string;
  locationName: string;
  averageScore: number;
  totalResponses: number;
  nps?: number;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { brandId, locationIds, dateRange } = await req.json();
    console.log(`Fetching OvationUp scores for brand: ${brandId}`);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get OvationUp integration settings for this brand
    const { data: integration, error: integrationError } = await supabase
      .from('ovation_integrations')
      .select('*')
      .eq('brand_id', brandId)
      .eq('is_active', true)
      .single();

    if (integrationError || !integration) {
      console.log('No OvationUp integration found for brand:', brandId);
      return new Response(
        JSON.stringify({ error: 'OvationUp integration not configured', scores: [] }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      );
    }

    if (!integration.auth_token) {
      console.log('No auth token configured for OvationUp integration');
      return new Response(
        JSON.stringify({ error: 'OvationUp auth token not configured', scores: [] }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      );
    }

    // Get location mappings for OvationUp
    let ovationLocationIds: string[] = [];
    let locationMappings: Record<string, string> = {};

    if (locationIds && locationIds.length > 0) {
      const { data: mappings } = await supabase
        .from('ovation_location_mappings')
        .select('location_id, ovation_location_id')
        .in('location_id', locationIds);

      if (mappings) {
        ovationLocationIds = mappings.map(m => m.ovation_location_id);
        mappings.forEach(m => {
          locationMappings[m.ovation_location_id] = m.location_id;
        });
      }
    }

    // If no specific locations, use all mapped locations for this brand
    if (ovationLocationIds.length === 0) {
      // Get all locations for this brand and their mappings
      const { data: brandLocations } = await supabase
        .from('locations')
        .select(`
          id,
          organization:organizations!inner(brand_id)
        `)
        .eq('organizations.brand_id', brandId);

      if (brandLocations && brandLocations.length > 0) {
        const locIds = brandLocations.map(l => l.id);
        const { data: mappings } = await supabase
          .from('ovation_location_mappings')
          .select('location_id, ovation_location_id')
          .in('location_id', locIds);

        if (mappings) {
          ovationLocationIds = mappings.map(m => m.ovation_location_id);
          mappings.forEach(m => {
            locationMappings[m.ovation_location_id] = m.location_id;
          });
        }
      }
    }

    console.log(`Found ${ovationLocationIds.length} OvationUp location mappings`);

    // Build date range (default to last 30 days)
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const createdAtRange = dateRange || [
      thirtyDaysAgo.toISOString(),
      now.toISOString()
    ];

    // Build request payload
    const payload: { filters: OvationFilters } = {
      filters: {
        companyIds: [integration.company_id],
        locationIds: ovationLocationIds,
        createdAtRange
      }
    };

    console.log('OvationUp request payload:', JSON.stringify(payload));

    // Call OvationUp API
    const response = await fetch('https://api.ovationup.com/app-services/v2/survey/survey-scores', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/plain, */*',
        'Authorization': integration.auth_token,
        'Accept-Language': 'en-US,en;q=0.9',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('OvationUp API error:', response.status, errorText);
      
      if (response.status === 401) {
        return new Response(
          JSON.stringify({ error: 'OvationUp token expired. Please update the auth token.', scores: [] }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
        );
      }
      
      return new Response(
        JSON.stringify({ error: `OvationUp API error: ${response.status}`, scores: [] }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      );
    }

    const data = await response.json();
    console.log('OvationUp response:', JSON.stringify(data).substring(0, 500));

    // Process and return scores
    const scores: SurveyScore[] = [];
    
    // The response format varies - adapt based on actual response structure
    if (data && Array.isArray(data)) {
      for (const item of data) {
        scores.push({
          locationId: locationMappings[item.locationId] || item.locationId,
          locationName: item.locationName || 'Unknown',
          averageScore: parseFloat(item.averageScore || item.score || '0') || 0,
          totalResponses: parseInt(item.totalResponses || item.responses || '0') || 0,
          nps: item.nps !== undefined ? parseFloat(item.nps) : undefined,
        });
      }
    } else if (data && data.scores) {
      for (const item of data.scores) {
        scores.push({
          locationId: locationMappings[item.locationId] || item.locationId,
          locationName: item.locationName || 'Unknown',
          averageScore: parseFloat(item.averageScore || item.score || '0') || 0,
          totalResponses: parseInt(item.totalResponses || item.responses || '0') || 0,
          nps: item.nps !== undefined ? parseFloat(item.nps) : undefined,
        });
      }
    }

    // Sort by score descending for leaderboard
    scores.sort((a, b) => b.averageScore - a.averageScore);

    return new Response(
      JSON.stringify({ scores, raw: data }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error fetching OvationUp scores:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: errorMessage, scores: [] }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});
