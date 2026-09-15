// Recipes missing ingredients — FLAG ONLY, read-only report.
//
// Grouped by the missing product, because one switched-off product commonly
// breaks several dishes. Every affected dish is listed, not just the first.

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight } from 'lucide-react';

interface Props {
  brandId: string;
}

interface AlertRow {
  id: string;
  location_id: string;
  recipe_name: string;
  ingredient_name: string;
  first_seen_at: string;
}

export function useRecipeIntegrityCount(brandId?: string) {
  return useQuery({
    queryKey: ['recipe-integrity-count', brandId],
    enabled: !!brandId,
    staleTime: 60_000,
    queryFn: async () => {
      const { count, error } = await supabase
        .from('recipe_integrity_alerts')
        .select('id', { count: 'exact', head: true })
        .eq('brand_id', brandId!)
        .eq('status', 'open');
      if (error) throw error;
      return count ?? 0;
    },
  });
}

export default function RecipeIntegrityCard({ brandId }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const { data, isLoading } = useQuery({
    queryKey: ['recipe-integrity-alerts', brandId],
    enabled: !!brandId,
    staleTime: 60_000,
    queryFn: async () => {
      const [alertsRes, locsRes] = await Promise.all([
        supabase
          .from('recipe_integrity_alerts')
          .select('id, location_id, recipe_name, ingredient_name, first_seen_at')
          .eq('brand_id', brandId)
          .eq('status', 'open')
          .order('ingredient_name', { ascending: true }),
        supabase.from('locations').select('id, name').eq('brand_id', brandId),
      ]);
      if (alertsRes.error) throw alertsRes.error;
      const names = new Map(((locsRes.data as any[]) || []).map((l) => [l.id, l.name as string]));
      return { rows: (alertsRes.data as AlertRow[]) || [], names };
    },
  });

  const groups = useMemo(() => {
    const rows = data?.rows || [];
    const names = data?.names;
    const map = new Map<string, { ingredient: string; dishes: Set<string>; stores: Set<string> }>();
    for (const r of rows) {
      const key = r.ingredient_name;
      const g = map.get(key) || { ingredient: key, dishes: new Set<string>(), stores: new Set<string>() };
      g.dishes.add(r.recipe_name);
      g.stores.add(names?.get(r.location_id) || 'Unknown store');
      map.set(key, g);
    }
    return [...map.values()]
      .map((g) => ({ ingredient: g.ingredient, dishes: [...g.dishes].sort(), stores: [...g.stores].sort() }))
      .sort((a, b) => b.dishes.length - a.dishes.length || a.ingredient.localeCompare(b.ingredient));
  }, [data]);

  const toggle = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              Recipes missing ingredients
            </CardTitle>
            <CardDescription>
              A dish is switched on while a product it needs is switched off. Flagged only — nothing
              is turned off automatically.
            </CardDescription>
          </div>
          {groups.length > 0 && (
            <Badge variant="destructive" className="shrink-0">
              {groups.length}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {isLoading ? (
          <>
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </>
        ) : groups.length === 0 ? (
          <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
            Every active recipe has all of its ingredients available.
          </div>
        ) : (
          groups.map((g) => {
            const open = expanded.has(g.ingredient);
            return (
              <div key={g.ingredient} className="rounded-lg border">
                <Button
                  variant="ghost"
                  onClick={() => toggle(g.ingredient)}
                  className="h-auto w-full justify-between px-3 py-2.5 text-left"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    {open ? (
                      <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                    )}
                    <span className="truncate font-medium">{g.ingredient}</span>
                  </span>
                  <Badge variant="secondary" className="shrink-0">
                    {g.dishes.length} {g.dishes.length === 1 ? 'dish' : 'dishes'}
                  </Badge>
                </Button>
                {open && (
                  <div className="space-y-2 border-t px-3 py-2.5 text-sm">
                    <div>
                      <p className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">
                        Dishes affected
                      </p>
                      <ul className="space-y-0.5">
                        {g.dishes.map((d) => (
                          <li key={d} className="text-foreground">
                            {d}
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div>
                      <p className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">
                        Stores
                      </p>
                      <p className="text-muted-foreground">{g.stores.join(', ')}</p>
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}
