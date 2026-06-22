import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

export type CogsSegment = 'Food' | 'Paper' | 'Beverages' | 'Supplies' | 'Alcohol' | 'Other';
export const SEGMENT_ORDER: CogsSegment[] = ['Food', 'Paper', 'Beverages', 'Supplies', 'Alcohol', 'Other'];

const CACHE_KEY = 'croohq.category_segments.v1';

function readCache(): Record<string, CogsSegment> {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY) || '{}'); } catch { return {}; }
}
function writeCache(map: Record<string, CogsSegment>) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(map)); } catch {}
}

// Heuristic fallback so the UI still renders if the edge function is offline.
function heuristic(cat: string): CogsSegment {
  const c = cat.toLowerCase();
  if (/(beer|wine|liquor|spirit|alcohol)/.test(c)) return 'Alcohol';
  if (/(paper|cup|lid|napkin|to[- ]?go|packag|bag)/.test(c)) return 'Paper';
  if (/(clean|chemical|sanitiz|suppl|smallware|uniform)/.test(c)) return 'Supplies';
  if (/(bev|drink|soda|fountain|juice|coffee|tea|na_?bev)/.test(c)) return 'Beverages';
  if (/(meat|cheese|dairy|veg|produce|dough|sauce|condiment|dessert|prep|food|core|mi$|dry|base|culinary|cost)/.test(c)) return 'Food';
  return 'Other';
}

/**
 * Resolves a stable category -> P&L segment mapping. Uses localStorage cache;
 * any unseen categories are sent to the AI classifier in a single batched call.
 */
export function useCategorySegments(categories: string[]) {
  const [mapping, setMapping] = useState<Record<string, CogsSegment>>(() => readCache());
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const uniq = Array.from(new Set(categories.map(c => (c || '').trim()).filter(Boolean)));
    if (uniq.length === 0) return;
    const cache = readCache();
    const missing = uniq.filter(c => !cache[c]);
    if (missing.length === 0) {
      // Make sure local state has them.
      if (Object.keys(mapping).length !== Object.keys(cache).length) setMapping(cache);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const { data, error } = await supabase.functions.invoke('classify-category-segments', {
          body: { categories: missing },
        });
        if (cancelled) return;
        const aiMap = (data?.mapping ?? {}) as Record<string, string>;
        const next = { ...cache };
        for (const c of missing) {
          const v = aiMap[c];
          next[c] = (SEGMENT_ORDER as string[]).includes(v) ? (v as CogsSegment) : heuristic(c);
        }
        writeCache(next);
        setMapping(next);
        if (error) console.warn('classify-category-segments error (used heuristic fallback)', error);
      } catch (err) {
        console.warn('classify-category-segments failed, using heuristic', err);
        const next = { ...cache };
        for (const c of missing) next[c] = heuristic(c);
        writeCache(next);
        setMapping(next);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categories.join('|')]);

  const resolve = (cat: string): CogsSegment => mapping[cat] || heuristic(cat);
  return { mapping, resolve, loading };
}
