// Admin-only backfill: heals orphan recipe_blueprints (produces_item_id IS NULL)
// by calling the heal_orphan_blueprint RPC for each one.
// Supports dry_run mode (default) for safe inspection before execution.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
};

interface OrphanRow {
  id: string;
  name: string;
  brand_id: string | null;
  location_id: string | null;
  source: string | null;
  category: string | null;
  catalog_section: string | null;
  yield_qty: number | null;
  yield_unit: string | null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing Authorization header' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

    // Validate caller (super admin only)
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) {
      return new Response(JSON.stringify({ error: 'Invalid session' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const admin = createClient(supabaseUrl, serviceKey);
    const { data: roleRow } = await admin
      .from('user_roles')
      .select('role')
      .eq('user_id', userData.user.id)
      .eq('role', 'super_admin')
      .maybeSingle();

    if (!roleRow) {
      return new Response(JSON.stringify({ error: 'Super admin role required' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Parse body
    const body = await req.json().catch(() => ({}));
    const dryRun: boolean = body.dry_run !== false; // default TRUE
    const brandIdFilter: string | undefined = body.brand_id;
    const limit: number = Math.min(Number(body.limit) || 1000, 1000);

    // Pull orphans
    let query = admin
      .from('recipe_blueprints')
      .select('id, name, brand_id, location_id, source, category, catalog_section, yield_qty, yield_unit')
      .is('produces_item_id', null)
      .eq('is_active', true)
      .not('brand_id', 'is', null) // need brand context to heal
      .limit(limit);

    if (brandIdFilter) query = query.eq('brand_id', brandIdFilter);

    const { data: orphans, error: orphanErr } = await query;
    if (orphanErr) throw orphanErr;

    const summary = {
      dry_run: dryRun,
      total_found: orphans?.length || 0,
      by_source: {} as Record<string, number>,
      by_brand: {} as Record<string, number>,
      processed: 0,
      created_templates: 0,
      created_items: 0,
      skipped_brand_level: 0,
      errors: [] as { blueprint_id: string; name: string; error: string }[],
      results: [] as any[],
    };

    for (const o of (orphans || []) as OrphanRow[]) {
      summary.by_source[o.source || 'unknown'] = (summary.by_source[o.source || 'unknown'] || 0) + 1;
      summary.by_brand[o.brand_id || 'unknown'] = (summary.by_brand[o.brand_id || 'unknown'] || 0) + 1;
    }

    if (dryRun) {
      return new Response(
        JSON.stringify({
          ...summary,
          message: `DRY RUN — would heal ${summary.total_found} orphan blueprints. Re-run with {"dry_run": false} to execute.`,
          sample: (orphans || []).slice(0, 10).map((o) => ({
            id: o.id,
            name: o.name,
            source: o.source,
            brand_id: o.brand_id,
            location_id: o.location_id,
          })),
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Execute: call the RPC for each orphan
    for (const o of (orphans || []) as OrphanRow[]) {
      try {
        // Use service role; the RPC will check auth.uid() — but service role bypasses.
        // We need to invoke the RPC AS the calling user so the auth check passes.
        // Easiest: re-create a client with the user's JWT.
        const { data, error } = await userClient.rpc('heal_orphan_blueprint', {
          _blueprint_id: o.id,
          _target_location_id: null,
        });
        if (error) throw error;

        const result = data as Record<string, unknown>;
        summary.processed += 1;
        if (result.created_template) summary.created_templates += 1;
        if (result.created_item) summary.created_items += 1;
        if (result.note) summary.skipped_brand_level += 1;
        summary.results.push({
          blueprint_id: o.id,
          name: o.name,
          ...result,
        });
      } catch (e) {
        summary.errors.push({
          blueprint_id: o.id,
          name: o.name,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    return new Response(
      JSON.stringify({
        ...summary,
        message: `Healed ${summary.processed}/${summary.total_found} orphan blueprints. ${summary.created_templates} templates created, ${summary.created_items} local items created, ${summary.errors.length} errors.`,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : String(e) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
