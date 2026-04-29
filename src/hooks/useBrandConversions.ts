import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';

export type ConversionSource = 'vendor_auto' | 'manual_override' | 'needs_review' | string;

export interface ActiveConversion {
  id: string;
  brand_template_id: string;
  brand_id: string;
  outer_qty: number;
  outer_unit: string;
  has_inner: boolean;
  inner_qty: number | null;
  inner_unit: string | null;
  canonical_unit: string;
  canonical_qty_per_inner: number;
  source: ConversionSource;
  version: number;
  effective_from: string;
  effective_to: string | null;
  updated_at?: string;
  created_at?: string;
}

/**
 * Fetches all active conversions for a brand (one per brand_template_id where effective_to IS NULL).
 * Returns a Map keyed by brand_template_id for fast lookup.
 */
export function useBrandConversions(brandId: string | null | undefined) {
  const query = useQuery({
    queryKey: ['brand-conversions', brandId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('item_conversions')
        .select(
          'id, brand_template_id, brand_id, outer_qty, outer_unit, has_inner, inner_qty, inner_unit, canonical_unit, canonical_qty_per_inner, source, version, effective_from, effective_to'
        )
        .eq('brand_id', brandId!)
        .is('effective_to', null);
      if (error) throw error;
      return (data || []) as ActiveConversion[];
    },
    enabled: !!brandId,
    staleTime: 30_000,
  });

  const conversionMap = useMemo(() => {
    const m = new Map<string, ActiveConversion>();
    (query.data || []).forEach((c) => m.set(c.brand_template_id, c));
    return m;
  }, [query.data]);

  return {
    conversions: query.data || [],
    conversionMap,
    isLoading: query.isLoading,
    refetch: query.refetch,
  };
}
