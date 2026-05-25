import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useLocation as useAppLocation } from '@/hooks/useLocation';
import { SUBSCRIPTION_TIERS, PRODUCT_TO_TIER, type TierKey } from '@/config/subscriptionTiers';

export interface PlanRow {
  id: string;
  catalog_id: string;
  key: string;
  display_name: string;
  description: string | null;
  price_cents: number;
  currency: string;
  stripe_price_id: string | null;
  stripe_product_id: string | null;
  badge_label: string | null;
  badge_style: 'primary' | 'founder' | null;
  icon_key: string | null;
  sort_order: number;
  is_visible: boolean;
  tier_rank: number;
  feature_bullets: string[];
  capabilities: string[];
}

interface UsePlansResult {
  plans: PlanRow[];
  loading: boolean;
  source: 'db' | 'fallback';
  /** Resolve a Stripe product_id to the matching plan (or null). */
  resolvePlanByProductId: (productId: string | null | undefined) => PlanRow | null;
}

/** Build a fallback plan list from the hard-coded subscriptionTiers.ts. */
function fallbackPlans(): PlanRow[] {
  const order: TierKey[] = ['core', 'pro', 'ludicrous', 'founder'];
  const capByKey: Record<TierKey, string[]> = {
    core: ['checklists', 'chat', 'schedule_basic'],
    pro: ['checklists', 'chat', 'schedule_basic', 'punch_clock', 'sales_labor', 'logbook', 'availability', 'pos_integration', 'kds'],
    ludicrous: ['checklists', 'chat', 'schedule_basic', 'punch_clock', 'sales_labor', 'logbook', 'availability', 'pos_integration', 'kds', 'inventory', 'hiring', 'pfg', 'produce_alliance'],
    founder: ['checklists', 'chat', 'schedule_basic', 'punch_clock', 'sales_labor', 'logbook', 'availability', 'pos_integration', 'kds', 'inventory', 'hiring', 'pfg', 'produce_alliance'],
  };
  const badgeByKey: Record<TierKey, { label: string | null; style: 'primary' | 'founder' | null }> = {
    core: { label: null, style: null },
    pro: { label: 'Most Popular', style: 'primary' },
    ludicrous: { label: "Industry's Best Value", style: 'primary' },
    founder: { label: 'Exclusive', style: 'founder' },
  };
  const iconByKey: Record<TierKey, string> = { core: 'zap', pro: 'rocket', ludicrous: 'star', founder: 'crown' };
  const rankByKey: Record<TierKey, number> = { core: 1, pro: 2, ludicrous: 3, founder: 3 };

  return order.map((k, i) => {
    const t = SUBSCRIPTION_TIERS[k];
    return {
      id: `fallback-${k}`,
      catalog_id: 'fallback',
      key: k,
      display_name: t.name,
      description: t.description,
      price_cents: t.price * 100,
      currency: 'usd',
      stripe_price_id: t.price_id,
      stripe_product_id: t.product_id,
      badge_label: badgeByKey[k].label,
      badge_style: badgeByKey[k].style,
      icon_key: iconByKey[k],
      sort_order: (i + 1) * 10,
      is_visible: true,
      tier_rank: rankByKey[k],
      feature_bullets: [...t.features],
      capabilities: capByKey[k],
    };
  });
}

/**
 * Loads the plan catalog visible to the current user's brand, with a strict
 * fallback to the hard-coded SUBSCRIPTION_TIERS so paying stores never see
 * an empty Billing page if the DB query fails.
 */
export function usePlans(): UsePlansResult {
  const { organizationId } = useAppLocation();

  // Resolve current brand from the user's active organization
  const { data: brandId } = useQuery({
    queryKey: ['plans', 'brand-id', organizationId],
    queryFn: async () => {
      if (!organizationId) return null;
      const { data, error } = await supabase
        .from('organizations')
        .select('brand_id')
        .eq('id', organizationId)
        .maybeSingle();
      if (error) throw error;
      return (data?.brand_id as string | null) ?? null;
    },
    enabled: !!organizationId,
    staleTime: 5 * 60 * 1000,
  });

  // Fetch the catalog (org > brand > global default) + capability grants
  const { data, isLoading } = useQuery({
    queryKey: ['plans', 'catalog', organizationId ?? 'none', brandId ?? 'global'],
    queryFn: async (): Promise<PlanRow[]> => {
      // 1. Resolve catalog: org > brand > global default (full replacement)
      const orFilters: string[] = ['and(brand_id.is.null,organization_id.is.null)'];
      if (brandId) orFilters.push(`and(brand_id.eq.${brandId},organization_id.is.null)`);
      if (organizationId) orFilters.push(`organization_id.eq.${organizationId}`);

      const { data: catalogs, error: catErr } = await supabase
        .from('plan_catalogs')
        .select('id, brand_id, organization_id, is_active')
        .eq('is_active', true)
        .or(orFilters.join(','));
      if (catErr) throw catErr;
      if (!catalogs || catalogs.length === 0) return [];

      // Priority: org-scoped wins, then brand-scoped, then global default
      const chosen =
        (organizationId ? catalogs.find((c: any) => c.organization_id === organizationId) : undefined) ??
        (brandId ? catalogs.find((c: any) => c.brand_id === brandId && !c.organization_id) : undefined) ??
        catalogs.find((c: any) => c.brand_id === null && !c.organization_id);
      if (!chosen) return [];

      // 2. Fetch plans
      const { data: planRows, error: planErr } = await supabase
        .from('plans')
        .select('*')
        .eq('catalog_id', chosen.id)
        .order('sort_order', { ascending: true });
      if (planErr) throw planErr;
      if (!planRows || planRows.length === 0) return [];

      // 3. Fetch capability grants for these plans
      const planIds = planRows.map((p) => p.id);
      const { data: grants, error: grantErr } = await supabase
        .from('plan_capability_grants')
        .select('plan_id, capability_key')
        .in('plan_id', planIds);
      if (grantErr) throw grantErr;

      const capsByPlan = new Map<string, string[]>();
      for (const g of grants ?? []) {
        const list = capsByPlan.get(g.plan_id) ?? [];
        list.push(g.capability_key);
        capsByPlan.set(g.plan_id, list);
      }

      return planRows.map((p) => ({
        ...(p as any),
        capabilities: capsByPlan.get(p.id) ?? [],
      })) as PlanRow[];
    },
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  const hasDbPlans = !!data && data.length > 0;
  const plans = hasDbPlans ? (data as PlanRow[]) : fallbackPlans();
  const source: 'db' | 'fallback' = hasDbPlans ? 'db' : 'fallback';

  const resolvePlanByProductId = (productId: string | null | undefined): PlanRow | null => {
    if (!productId) return null;
    // Try DB plans first
    const fromDb = plans.find((p) => p.stripe_product_id === productId);
    if (fromDb) return fromDb;
    // Last-resort: hard-coded map (handles legacy product IDs not in DB yet)
    const tier = PRODUCT_TO_TIER[productId];
    if (!tier) return null;
    return fallbackPlans().find((p) => p.key === tier) ?? null;
  };

  return {
    plans,
    loading: isLoading && !hasDbPlans && plans.length === 0,
    source,
    resolvePlanByProductId,
  };
}
