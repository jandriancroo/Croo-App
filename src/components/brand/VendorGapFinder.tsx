import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Search, RefreshCw, PackagePlus, AlertTriangle, CheckCircle2,
  Loader2, Filter,
} from 'lucide-react';
import { toast } from 'sonner';

interface VendorGapFinderProps {
  brandId: string;
}

interface OutlierItem {
  itemNumber: string;
  name: string;
  fullDescription: string;
  brand: string;
  packSize: string;
  categoryName: string;
  price: number | null;
  vendorSource: 'pfg' | 'pa';
}

export default function VendorGapFinder({ brandId }: VendorGapFinderProps) {
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [scanResult, setScanResult] = useState<{
    outliers: OutlierItem[];
    matchCount: number;
    totalBid: number;
    discrepancies: { itemNumber: string; name: string }[];
  } | null>(null);
  const [isScanning, setIsScanning] = useState(false);

  // Get locations with PFG integration for this brand
  const { data: pfgLocations = [] } = useQuery({
    queryKey: ['brand-pfg-locations', brandId],
    queryFn: async () => {
      // Get all locations in brand
      const { data: orgs } = await supabase
        .from('organizations')
        .select('id')
        .eq('brand_id', brandId);
      if (!orgs?.length) return [];

      const orgIds = orgs.map(o => o.id);
      const { data: locs } = await supabase
        .from('locations')
        .select('id, name')
        .in('organization_id', orgIds);
      if (!locs?.length) return [];

      const locIds = locs.map(l => l.id);
      const { data: integrations } = await supabase
        .from('location_integrations')
        .select('location_id, credentials')
        .eq('integration_type', 'pfg')
        .eq('is_active', true)
        .in('location_id', locIds);

      return (integrations || [])
        .filter(i => (i.credentials as any)?.bid_guide_header_id)
        .map(i => ({
          locationId: i.location_id,
          name: locs.find(l => l.id === i.location_id)?.name || 'Unknown',
          bidGuideHeaderId: (i.credentials as any).bid_guide_header_id,
          customerId: (i.credentials as any).customer_id,
        }));
    },
  });

  // Existing brand templates
  const { data: templates = [] } = useQuery({
    queryKey: ['brand-templates', brandId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('brand_inventory_templates')
        .select('id, item_number, product_name, status, pa_item_id')
        .eq('brand_id', brandId);
      if (error) throw error;
      return data || [];
    },
  });

  // Get brand location IDs for PA order lookup
  const { data: brandLocationIds = [] } = useQuery({
    queryKey: ['brand-location-ids', brandId],
    queryFn: async () => {
      const { data: orgs } = await supabase
        .from('organizations')
        .select('id')
        .eq('brand_id', brandId);
      if (!orgs?.length) return [];
      const { data: locs } = await supabase
        .from('locations')
        .select('id')
        .in('organization_id', orgs.map(o => o.id));
      return (locs || []).map(l => l.id);
    },
  });

  const runScan = async () => {
    setIsScanning(true);
    setScanResult(null);

    const existingNumbers = new Set(
      templates.map(t => t.item_number).filter(Boolean)
    );
    const existingNames = new Set(
      templates.map(t => t.product_name?.toLowerCase()).filter(Boolean)
    );
    const existingPaIds = new Set(
      templates.map(t => (t as any).pa_item_id).filter(Boolean).map((id: string) => id.trim())
    );

    let allOutliers: OutlierItem[] = [];
    let pfgMatchCount = 0;
    let pfgTotal = 0;
    let discrepancies: { itemNumber: string; name: string }[] = [];

    try {
      // --- PFG Scan ---
      const loc = pfgLocations[0];
      if (loc) {
        const { data, error } = await supabase.functions.invoke('pfg-service', {
          body: {
            locationId: loc.locationId,
            action: 'search_bid_guide',
            bidGuideHeaderId: loc.bidGuideHeaderId,
            customerId: loc.customerId,
            searchQuery: '',
          },
        });
        if (error) throw error;

        const bidProducts: any[] = data?.data?.products || [];
        pfgTotal = bidProducts.length;

        const pfgOutliers: OutlierItem[] = bidProducts
          .filter(p => !existingNumbers.has(p.itemNumber) && !existingNames.has((p.fullDescription || p.name || '').toLowerCase()))
          .map(p => ({
            itemNumber: p.itemNumber,
            name: p.name || p.fullDescription,
            fullDescription: p.fullDescription || p.name,
            brand: p.brand || '',
            packSize: p.packSize || '',
            categoryName: p.categoryName || 'Uncategorized',
            price: p.price,
            vendorSource: 'pfg' as const,
          }));

        pfgMatchCount = pfgTotal - pfgOutliers.length;
        allOutliers.push(...pfgOutliers);

        // Discrepancies (in catalog but not in bid)
        const bidNumbers = new Set(bidProducts.map((p: any) => p.itemNumber));
        discrepancies = templates
          .filter(t => t.item_number && !bidNumbers.has(t.item_number) && t.status === 'live')
          .map(t => ({ itemNumber: t.item_number!, name: t.product_name }));
      }

      // --- PA Scan (from pa_catalog_items populated by nightly GitHub Action) ---
      if (brandLocationIds.length > 0) {
        const seenPaItems = new Map<string, any>();

        // Primary: pa_catalog_items (scraped from restaurantOrderSort.jsp)
        for (const locId of brandLocationIds) {
          const { data: catalogItems } = await supabase
            .from('pa_catalog_items' as any)
            .select('pa_item_id, description, pack_size, category, unit_price')
            .eq('location_id', locId);

          for (const item of (catalogItems || []) as any[]) {
            const paId = String(item.pa_item_id || '').trim();
            if (!paId || existingPaIds.has(paId) || seenPaItems.has(paId)) continue;
            const itemName = (item.description || '').toLowerCase();
            if (itemName && existingNames.has(itemName)) continue;
            seenPaItems.set(paId, item);
          }
        }

        // Fallback: order history if catalog is empty
        if (seenPaItems.size === 0) {
          const { data: paOrders } = await supabase
            .from('produce_alliance_orders' as any)
            .select('items')
            .in('location_id', brandLocationIds)
            .not('items', 'is', null)
            .order('delivery_date', { ascending: false })
            .limit(30);

          for (const order of (paOrders || []) as any[]) {
            const items = order.items as any[];
            if (!Array.isArray(items)) continue;
            for (const item of items) {
              const paId = String(item.itemId || item.item_id || '').trim();
              if (!paId || existingPaIds.has(paId) || seenPaItems.has(paId)) continue;
              const itemName = (item.description || item.name || '').toLowerCase();
              if (itemName && existingNames.has(itemName)) continue;
              seenPaItems.set(paId, item);
            }
          }
        }

        const paOutliers: OutlierItem[] = Array.from(seenPaItems.entries()).map(([paId, item]) => ({
          itemNumber: paId,
          name: item.description || item.name || paId,
          fullDescription: item.description || item.name || paId,
          brand: '',
          packSize: item.pack_size || item.packSize || '',
          categoryName: item.category || 'Produce',
          price: item.unit_price || item.price || item.unitPrice || null,
          vendorSource: 'pa' as const,
        }));

        allOutliers.push(...paOutliers);
      }

      setScanResult({
        outliers: allOutliers,
        matchCount: pfgMatchCount,
        totalBid: pfgTotal,
        discrepancies,
      });

      toast.success(`Scan complete: ${allOutliers.length} new items found`);
    } catch (err: any) {
      toast.error('Scan failed: ' + (err.message || 'Unknown error'));
    } finally {
      setIsScanning(false);
    }
  };

  // Promote selected outliers to draft templates
  const promoteMutation = useMutation({
    mutationFn: async (items: OutlierItem[]) => {
      const inserts = items.map(item => ({
        brand_id: brandId,
        product_name: item.fullDescription || item.name,
        item_number: item.vendorSource === 'pfg' ? item.itemNumber : null,
        pa_item_id: item.vendorSource === 'pa' ? item.itemNumber : null,
        vendor_source: item.vendorSource === 'pa' ? 'produce_alliance' : 'pfg',
        category: item.categoryName,
        status: 'draft',
      }));

      const { error } = await supabase
        .from('brand_inventory_templates')
        .upsert(inserts as any, { onConflict: 'brand_id,product_name', ignoreDuplicates: true });
      if (error) throw error;
    },
    onSuccess: (_, items) => {
      toast.success(`${items.length} items added as drafts`);
      setSelectedIds(new Set());
      queryClient.invalidateQueries({ queryKey: ['brand-templates', brandId] });
      // Remove promoted items from scan result
      if (scanResult) {
        const promotedNumbers = new Set(items.map(i => i.itemNumber));
        setScanResult({
          ...scanResult,
          outliers: scanResult.outliers.filter(o => !promotedNumbers.has(o.itemNumber)),
          matchCount: scanResult.matchCount + items.length,
        });
      }
    },
    onError: (err: any) => {
      toast.error('Failed to promote: ' + (err.message || 'Unknown'));
    },
  });

  const categories = useMemo(() => {
    if (!scanResult) return [];
    return [...new Set(scanResult.outliers.map(o => o.categoryName))].sort();
  }, [scanResult]);

  const filteredOutliers = useMemo(() => {
    if (!scanResult) return [];
    let items = scanResult.outliers;
    if (categoryFilter !== 'all') {
      items = items.filter(o => o.categoryName === categoryFilter);
    }
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      items = items.filter(o =>
        o.name.toLowerCase().includes(q) ||
        o.itemNumber.includes(q) ||
        o.brand?.toLowerCase().includes(q)
      );
    }
    return items;
  }, [scanResult, categoryFilter, searchQuery]);

  const toggleSelect = (itemNumber: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(itemNumber)) next.delete(itemNumber);
      else next.add(itemNumber);
      return next;
    });
  };

  const toggleAll = () => {
    if (selectedIds.size === filteredOutliers.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredOutliers.map(o => o.itemNumber)));
    }
  };

  const handlePromote = () => {
    const items = scanResult?.outliers.filter(o => selectedIds.has(o.itemNumber)) || [];
    if (items.length === 0) return;
    promoteMutation.mutate(items);
  };

  return (
    <div className="space-y-4">
      {/* Scan Control */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="font-semibold text-sm flex items-center gap-2">
                <Search className="h-4 w-4 text-primary" />
                Vendor Gap Finder
              </h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Compare PFG Bid List &amp; PA order history against your catalog
              </p>
            </div>
            <Button
              size="sm"
              onClick={runScan}
              disabled={isScanning || (pfgLocations.length === 0 && brandLocationIds.length === 0)}
            >
              {isScanning ? (
                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4 mr-1.5" />
              )}
              {isScanning ? 'Scanning...' : 'Run Scan'}
            </Button>
          </div>

          {pfgLocations.length === 0 && brandLocationIds.length === 0 && (
            <p className="text-xs text-destructive mt-2">
              No locations have PFG or PA integrations configured.
            </p>
          )}

          {(pfgLocations.length > 0 || brandLocationIds.length > 0) && !scanResult && !isScanning && (
            <p className="text-xs text-muted-foreground mt-2">
              Will scan{pfgLocations.length > 0 ? ` PFG bid list via ${pfgLocations[0].name}` : ''}{pfgLocations.length > 0 && brandLocationIds.length > 0 ? ' + ' : ''}{brandLocationIds.length > 0 ? 'PA order history' : ''}.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Results Summary */}
      {scanResult && (
        <div className="grid grid-cols-3 gap-2">
          <Card>
            <CardContent className="p-3 text-center">
              <div className="text-2xl font-bold text-primary">{scanResult.totalBid}</div>
              <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Bid Items</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3 text-center">
              <div className="text-2xl font-bold text-green-600">{scanResult.matchCount}</div>
              <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Matched</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3 text-center">
              <div className="text-2xl font-bold text-amber-600">{scanResult.outliers.length}</div>
              <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Outliers</div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Discrepancies */}
      {scanResult && scanResult.discrepancies.length > 0 && (
        <Card className="border-amber-200 bg-amber-50/50 dark:border-amber-900 dark:bg-amber-950/20">
          <CardHeader className="pb-2 pt-3 px-4">
            <CardTitle className="text-xs flex items-center gap-1.5 text-amber-700 dark:text-amber-400">
              <AlertTriangle className="h-3.5 w-3.5" />
              {scanResult.discrepancies.length} catalog items not on bid list
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3">
            <div className="flex flex-wrap gap-1">
              {scanResult.discrepancies.map(d => (
                <Badge key={d.itemNumber} variant="outline" className="text-[10px]">
                  {d.name}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Outliers List */}
      {scanResult && scanResult.outliers.length > 0 && (
        <Card>
          <CardHeader className="pb-2 pt-3 px-4">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm flex items-center gap-1.5">
                <PackagePlus className="h-4 w-4" />
                Outliers — Not in Catalog
              </CardTitle>
              {selectedIds.size > 0 && (
                <Button
                  size="sm"
                  onClick={handlePromote}
                  disabled={promoteMutation.isPending}
                  className="h-7 text-xs"
                >
                  {promoteMutation.isPending ? (
                    <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                  ) : (
                    <PackagePlus className="h-3 w-3 mr-1" />
                  )}
                  Add {selectedIds.size} as Draft
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent className="px-4 pb-3 space-y-2">
            {/* Filters */}
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  placeholder="Search outliers..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="h-8 pl-8 text-xs"
                />
              </div>
              <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                <SelectTrigger className="h-8 w-[140px] text-xs">
                  <Filter className="h-3 w-3 mr-1" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Categories</SelectItem>
                  {categories.map(c => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Select all */}
            <div className="flex items-center gap-2 px-1">
              <Checkbox
                checked={filteredOutliers.length > 0 && selectedIds.size === filteredOutliers.length}
                onCheckedChange={toggleAll}
              />
              <span className="text-xs text-muted-foreground">
                {filteredOutliers.length} items
                {selectedIds.size > 0 && ` • ${selectedIds.size} selected`}
              </span>
            </div>

            {/* List */}
            <ScrollArea className="h-[400px]">
              <div className="space-y-1">
                {filteredOutliers.map(item => (
                  <div
                    key={item.itemNumber}
                    className={`flex items-start gap-2 p-2 rounded-lg border text-xs cursor-pointer transition-colors ${
                      selectedIds.has(item.itemNumber)
                        ? 'bg-primary/5 border-primary/30'
                        : 'bg-card hover:bg-muted/50 border-border'
                    }`}
                    onClick={() => toggleSelect(item.itemNumber)}
                  >
                    <Checkbox
                      checked={selectedIds.has(item.itemNumber)}
                      onCheckedChange={() => toggleSelect(item.itemNumber)}
                      className="mt-0.5"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{item.name}</div>
                      <div className="flex items-center gap-1.5 mt-0.5 text-muted-foreground">
                        <span>#{item.itemNumber}</span>
                        {item.packSize && <span>• {item.packSize}</span>}
                        {item.brand && <span>• {item.brand}</span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <Badge variant="outline" className="text-[10px]">
                        {item.vendorSource === 'pa' ? 'PA' : 'PFG'}
                      </Badge>
                      <Badge variant="outline" className="text-[10px]">
                        {item.categoryName}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      )}

      {/* Empty state */}
      {scanResult && scanResult.outliers.length === 0 && (
        <Card>
          <CardContent className="p-8 text-center">
            <CheckCircle2 className="h-10 w-10 text-green-500 mx-auto mb-2" />
            <p className="font-medium">Catalog is fully synced</p>
            <p className="text-xs text-muted-foreground mt-1">
              All {scanResult.totalBid} bid items are accounted for in your catalog.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
