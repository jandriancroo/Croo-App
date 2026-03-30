import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Search, AlertTriangle, CheckCircle2, Building2, Package } from 'lucide-react';

interface BrandTriageTabProps {
  brandId: string;
  locations: { id: string; name: string; store_number?: string }[];
}

interface UnmappedItem {
  id: string;
  name: string;
  vendor_source: string | null;
  item_number: string | null;
  location_id: string;
  location_name: string;
  brand_item_id: string | null;
}

export default function BrandTriageTab({ brandId, locations }: BrandTriageTabProps) {
  const [search, setSearch] = useState('');

  const locationMap = useMemo(() => {
    const m = new Map<string, string>();
    locations.forEach(l => m.set(l.id, l.name + (l.store_number ? ` #${l.store_number}` : '')));
    return m;
  }, [locations]);

  // Fetch all inventory items across brand locations that have no brand_item_id
  const { data: unmappedItems = [], isLoading } = useQuery({
    queryKey: ['brand-triage-unmapped', brandId, locations.map(l => l.id).join(',')],
    queryFn: async () => {
      const locationIds = locations.map(l => l.id);
      if (locationIds.length === 0) return [];

      const { data, error } = await supabase
        .from('inventory_items')
        .select('id, name, vendor_source, item_number, location_id, brand_item_id, is_active')
        .in('location_id', locationIds)
        .is('brand_item_id', null)
        .eq('is_active', true)
        .order('name');
      if (error) throw error;

      return (data || []).map(item => ({
        ...item,
        location_name: locationMap.get(item.location_id) || 'Unknown',
      })) as UnmappedItem[];
    },
    enabled: locations.length > 0,
  });

  // Group by location
  const grouped = useMemo(() => {
    let items = unmappedItems;
    if (search) {
      const q = search.toLowerCase();
      items = items.filter(i =>
        i.name.toLowerCase().includes(q) ||
        (i.item_number || '').toLowerCase().includes(q) ||
        (i.vendor_source || '').toLowerCase().includes(q)
      );
    }

    const groups: Record<string, UnmappedItem[]> = {};
    items.forEach(item => {
      const key = item.location_id;
      if (!groups[key]) groups[key] = [];
      groups[key].push(item);
    });
    return groups;
  }, [unmappedItems, search]);

  const totalUnmapped = unmappedItems.length;

  return (
    <div className="space-y-4">
      {/* Summary */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-500" />
            Unmapped Local Items
          </CardTitle>
          <CardDescription className="text-xs">
            Items at locations that aren't linked to the brand catalog. These may need to be added to the catalog or mapped to existing brand items.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-3 mb-3">
            <Badge
              variant={totalUnmapped === 0 ? 'default' : 'outline'}
              className={totalUnmapped === 0 ? 'bg-green-500/10 text-green-700 border-green-500/30' : 'text-amber-600 border-amber-500/30'}
            >
              {totalUnmapped === 0 ? (
                <>
                  <CheckCircle2 className="h-3 w-3 mr-1" />
                  All items mapped
                </>
              ) : (
                <>
                  <AlertTriangle className="h-3 w-3 mr-1" />
                  {totalUnmapped} unmapped item{totalUnmapped !== 1 ? 's' : ''} across {Object.keys(grouped).length} location{Object.keys(grouped).length !== 1 ? 's' : ''}
                </>
              )}
            </Badge>
          </div>

          {totalUnmapped > 0 && (
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search unmapped items..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="pl-9 h-9"
              />
            </div>
          )}
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="text-center py-8 text-muted-foreground text-sm">Loading triage data...</div>
      ) : totalUnmapped === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <CheckCircle2 className="h-12 w-12 text-green-500 mb-4 opacity-60" />
            <h3 className="font-medium mb-1">All Clear</h3>
            <p className="text-sm text-muted-foreground text-center max-w-md">
              Every active item at every location is linked to the brand catalog. Nothing to triage.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {Object.entries(grouped)
            .sort(([, a], [, b]) => b.length - a.length)
            .map(([locationId, items]) => (
              <Card key={locationId}>
                <CardHeader className="py-3 px-4">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm font-semibold flex items-center gap-2">
                      <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                      {locationMap.get(locationId) || 'Unknown'}
                    </CardTitle>
                    <Badge variant="outline" className="text-[10px] text-amber-600 border-amber-500/30">
                      {items.length} unmapped
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="px-4 pb-3 pt-0">
                  <div className="divide-y divide-border">
                    {items.map(item => (
                      <div key={item.id} className="flex items-center justify-between py-2 gap-3">
                        <div className="min-w-0 flex-1">
                          <span className="text-sm font-medium truncate block">{item.name}</span>
                          <div className="flex items-center gap-2 mt-0.5">
                            {item.vendor_source && (
                              <span className="text-[10px] text-muted-foreground">{item.vendor_source}</span>
                            )}
                            {item.item_number && (
                              <span className="text-[10px] text-muted-foreground">#{item.item_number}</span>
                            )}
                          </div>
                        </div>
                        <Badge variant="outline" className="text-[9px] shrink-0">
                          <Package className="h-2.5 w-2.5 mr-0.5" />
                          Local only
                        </Badge>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            ))}
        </div>
      )}
    </div>
  );
}
