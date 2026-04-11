import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Activity, AlertTriangle, XCircle, CheckCircle2, MapPin } from 'lucide-react';

interface VendorHealthDashboardProps {
  brandId: string;
}

export default function VendorHealthDashboard({ brandId }: VendorHealthDashboardProps) {
  type SkuHealthRecord = {
    id: string;
    brand_id: string;
    vendor_source: string;
    vendor_sku: string;
    vendor_territory: string;
    status: 'active' | 'stale' | 'discontinued';
    first_seen_at: string;
    last_seen_at: string;
    last_price: number | null;
    last_location_id: string | null;
    product_name: string | null;
  };

  const { data: healthRecords = [], isLoading } = useQuery<SkuHealthRecord[]>({
    queryKey: ['vendor-sku-health', brandId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('vendor_sku_health')
        .select('*')
        .eq('brand_id', brandId)
        .order('last_seen_at', { ascending: true });
      if (error) throw error;
      return (data || []) as unknown as SkuHealthRecord[];
    },
  });

  // Group by territory
  const byTerritory = healthRecords.reduce((acc, r) => {
    const t = r.vendor_territory || 'unknown';
    if (!acc[t]) acc[t] = { active: 0, stale: 0, discontinued: 0, items: [] };
    acc[t][r.status as 'active' | 'stale' | 'discontinued']++;
    acc[t].items.push(r);
    return acc;
  }, {} as Record<string, { active: number; stale: number; discontinued: number; items: any[] }>);

  const totals = healthRecords.reduce(
    (acc, r) => {
      acc[r.status as 'active' | 'stale' | 'discontinued']++;
      return acc;
    },
    { active: 0, stale: 0, discontinued: 0 }
  );

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <p className="text-sm text-muted-foreground">Loading health data...</p>
        </CardContent>
      </Card>
    );
  }

  if (healthRecords.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-12">
          <Activity className="h-10 w-10 text-muted-foreground mb-3 opacity-50" />
          <p className="text-sm text-muted-foreground">No vendor SKU health data yet</p>
          <p className="text-xs text-muted-foreground mt-1">Data populates after the nightly sync runs</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-3">
        <Card>
          <CardContent className="p-3 text-center">
            <CheckCircle2 className="h-5 w-5 text-green-500 mx-auto mb-1" />
            <p className="text-2xl font-bold">{totals.active}</p>
            <p className="text-[10px] text-muted-foreground">Active SKUs</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 text-center">
            <AlertTriangle className="h-5 w-5 text-yellow-500 mx-auto mb-1" />
            <p className="text-2xl font-bold">{totals.stale}</p>
            <p className="text-[10px] text-muted-foreground">Stale (&gt;14d)</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 text-center">
            <XCircle className="h-5 w-5 text-red-500 mx-auto mb-1" />
            <p className="text-2xl font-bold">{totals.discontinued}</p>
            <p className="text-[10px] text-muted-foreground">Discontinued (&gt;30d)</p>
          </CardContent>
        </Card>
      </div>

      {/* By territory */}
      <ScrollArea className="h-[calc(100vh-360px)]">
        <div className="space-y-3">
          {Object.entries(byTerritory)
            .sort(([, a], [, b]) => (b.stale + b.discontinued) - (a.stale + a.discontinued))
            .map(([territory, data]) => (
              <Card key={territory}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <MapPin className="h-3.5 w-3.5" />
                    {territory}
                  </CardTitle>
                  <CardDescription className="text-xs">
                    {data.active} active · {data.stale} stale · {data.discontinued} discontinued
                  </CardDescription>
                </CardHeader>
                {(data.stale > 0 || data.discontinued > 0) && (
                  <CardContent className="pt-0">
                    <div className="space-y-1.5">
                      {data.items
                        .filter(i => i.status !== 'active')
                        .sort((a, b) => {
                          if (a.status === 'discontinued' && b.status !== 'discontinued') return -1;
                          if (b.status === 'discontinued' && a.status !== 'discontinued') return 1;
                          return new Date(a.last_seen_at).getTime() - new Date(b.last_seen_at).getTime();
                        })
                        .map(item => {
                          const daysSince = Math.floor(
                            (Date.now() - new Date(item.last_seen_at).getTime()) / (1000 * 60 * 60 * 24)
                          );
                          return (
                            <div key={item.id} className="flex items-center gap-2 text-xs py-1 border-b border-border/50 last:border-0">
                              <Badge
                                variant={item.status === 'discontinued' ? 'destructive' : 'secondary'}
                                className="text-[9px] px-1.5 shrink-0"
                              >
                                {item.status === 'discontinued' ? 'DISC' : 'STALE'}
                              </Badge>
                              <div className="flex-1 min-w-0">
                                <p className="truncate font-medium">{item.product_name || item.vendor_sku}</p>
                                <p className="text-muted-foreground">
                                  {item.vendor_source.toUpperCase()} · #{item.vendor_sku} · {daysSince}d ago
                                  {item.last_price != null && ` · $${Number(item.last_price).toFixed(2)}`}
                                </p>
                              </div>
                            </div>
                          );
                        })}
                    </div>
                  </CardContent>
                )}
              </Card>
            ))}
        </div>
      </ScrollArea>
    </div>
  );
}
