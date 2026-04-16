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
  Loader2, Filter, Trash2,
} from 'lucide-react';
import { toast } from 'sonner';

interface VendorGapFinderProps {
  brandId: string;
}

interface OutlierItem {
  id?: string; // DB id from vendor_gap_alerts
  itemNumber: string;
  name: string;
  fullDescription: string;
  brand: string;
  packSize: string;
  categoryName: string;
  price: number | null;
  vendorSource: 'pfg' | 'pa' | 'invoice';
  status?: string;
}

export default function VendorGapFinder({ brandId }: VendorGapFinderProps) {
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [isScanning, setIsScanning] = useState(false);
  const [lastScanStats, setLastScanStats] = useState<{
    matchCount: number;
    totalBid: number;
    discrepancies: { itemNumber: string; name: string }[];
  } | null>(null);

  // Load persisted outliers from vendor_gap_alerts
  const { data: persistedOutliers = [], refetch: refetchOutliers } = useQuery({
    queryKey: ['vendor-gap-alerts', brandId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('vendor_gap_alerts' as any)
        .select('*')
        .eq('brand_id', brandId)
        .eq('status', 'new')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data || []).map((d: any) => ({
        id: d.id,
        itemNumber: d.item_number,
        name: d.vendor_name || d.item_number,
        fullDescription: d.vendor_description || d.vendor_name || '',
        brand: '',
        packSize: d.pack_size || '',
        categoryName: d.category_name || 'Uncategorized',
        price: null,
        vendorSource: d.vendor_source as 'pfg' | 'pa' | 'invoice',
        status: d.status,
      })) as OutlierItem[];
    },
  });

  // Get locations with PFG integration for this brand
  const { data: pfgLocations = [] } = useQuery({
    queryKey: ['brand-pfg-locations', brandId],
    queryFn: async () => {
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

  // Existing brand templates — use distinct query key to avoid overwriting
  // the full-select cache used by the parent catalog view
  const { data: templates = [] } = useQuery({
    queryKey: ['brand-templates-gap-finder', brandId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('brand_inventory_templates')
        .select('id, item_number, product_name, status, pa_item_id')
        .eq('brand_id', brandId);
      if (error) throw error;
      return data || [];
    },
  });

  // Get ALL vendor mappings for this brand (the key fix!)
  const { data: vendorMappings = [] } = useQuery({
    queryKey: ['brand-vendor-mappings-gap', brandId],
    queryFn: async () => {
      const templateIds = templates.map(t => t.id);
      if (!templateIds.length) return [];
      const { data, error } = await supabase
        .from('brand_vendor_mappings')
        .select('vendor_item_id, vendor')
        .in('brand_template_id', templateIds);
      if (error) throw error;
      return data || [];
    },
    enabled: templates.length > 0,
  });

  // Get brand location IDs for PA catalog lookup
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
    setLastScanStats(null);

    // Build comprehensive exclusion sets
    const existingNumbers = new Set(
      templates.map(t => t.item_number).filter(Boolean)
    );
    const existingNames = new Set(
      templates.map(t => t.product_name?.toLowerCase()).filter(Boolean)
    );
    const existingPaIds = new Set(
      templates.map(t => (t as any).pa_item_id).filter(Boolean).map((id: string) => id.trim())
    );
    // FIX #2: Also exclude all vendor_item_ids from brand_vendor_mappings
    const existingVendorIds = new Set(
      vendorMappings.map(m => String(m.vendor_item_id || '').trim()).filter(Boolean)
    );

    let newOutliers: OutlierItem[] = [];
    let totalVendorItems = 0;
    let totalMatched = 0;
    let discrepancies: { itemNumber: string; name: string }[] = [];

    try {
      // --- PFG Scan (Bid Guide) — scan ALL locations, not just the first ---
      for (const loc of pfgLocations) {
        try {
          const { data, error } = await supabase.functions.invoke('pfg-service', {
            body: {
              locationId: loc.locationId,
              action: 'search_bid_guide',
              bidGuideHeaderId: loc.bidGuideHeaderId,
              customerId: loc.customerId,
              searchQuery: '',
            },
          });
          if (error) {
            console.warn(`PFG scan failed for ${loc.name}:`, error);
            continue;
          }

          const bidProducts: any[] = data?.data?.products || [];
          totalVendorItems += bidProducts.length;

          const pfgOutliers: OutlierItem[] = bidProducts
            .filter(p => {
              const itemNum = String(p.itemNumber || '').trim();
              const itemName = (p.fullDescription || p.name || '').toLowerCase();
              // Check templates AND vendor mappings
              return !existingNumbers.has(itemNum) &&
                     !existingVendorIds.has(itemNum) &&
                     !existingNames.has(itemName);
            })
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

          totalMatched += bidProducts.length - pfgOutliers.length;
          newOutliers.push(...pfgOutliers);
        } catch (err) {
          console.warn(`PFG scan error for ${loc.name}:`, err);
        }
      }

      // Discrepancies — only check against first location's bid guide for now
      if (pfgLocations[0]) {
        try {
          const { data } = await supabase.functions.invoke('pfg-service', {
            body: {
              locationId: pfgLocations[0].locationId,
              action: 'search_bid_guide',
              bidGuideHeaderId: pfgLocations[0].bidGuideHeaderId,
              customerId: pfgLocations[0].customerId,
              searchQuery: '',
            },
          });
          const bidProducts: any[] = data?.data?.products || [];
          const bidNumbers = new Set(bidProducts.map((p: any) => String(p.itemNumber || '').trim()));
          discrepancies = templates
            .filter(t => t.item_number && !bidNumbers.has(t.item_number) && t.status === 'live')
            .filter(t => {
              const mapping = vendorMappings.find(m => 
                m.vendor_item_id === t.item_number && m.vendor !== 'pfg'
              );
              return !mapping;
            })
            .map(t => ({ itemNumber: t.item_number!, name: t.product_name }));
        } catch {}
      }

      // Deduplicate outliers by itemNumber (across multiple location scans)
      const seenItemNumbers = new Set<string>();
      newOutliers = newOutliers.filter(o => {
        if (seenItemNumbers.has(o.itemNumber)) return false;
        seenItemNumbers.add(o.itemNumber);
        return true;
      });

      // --- PA Scan (Catalog only — no order history fallback) ---
      if (brandLocationIds.length > 0) {
        const allPaItems = new Map<string, any>();
        const seenPaItems = new Map<string, any>();

        for (const locId of brandLocationIds) {
          const { data: catalogItems } = await supabase
            .from('pa_catalog_items' as any)
            .select('pa_item_id, description, pack_size, category, unit_price')
            .eq('location_id', locId);

          for (const item of (catalogItems || []) as any[]) {
            const paId = String(item.pa_item_id || '').trim();
            if (!paId || allPaItems.has(paId)) continue;
            allPaItems.set(paId, item);
            
            if (existingPaIds.has(paId) || existingVendorIds.has(paId)) continue;
            const itemName = (item.description || '').toLowerCase();
            if (itemName && existingNames.has(itemName)) continue;
            if (seenPaItems.has(paId)) continue;
            seenPaItems.set(paId, item);
          }
        }

        totalVendorItems += allPaItems.size;
        totalMatched += allPaItems.size - seenPaItems.size;

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

        newOutliers.push(...paOutliers);
      }

      // FIX #3: Persist outliers to vendor_gap_alerts
      if (newOutliers.length > 0) {
        const upserts = newOutliers.map(item => ({
          brand_id: brandId,
          vendor_source: item.vendorSource,
          item_number: item.itemNumber,
          vendor_name: item.name,
          vendor_description: item.fullDescription || '',
          pack_size: item.packSize || '',
          category_name: item.categoryName || '',
          status: 'new',
        }));

        // Batch upsert in chunks of 50
        for (let i = 0; i < upserts.length; i += 50) {
          await supabase
            .from('vendor_gap_alerts' as any)
            .upsert(upserts.slice(i, i + 50), { onConflict: 'brand_id,vendor_source,item_number' });
        }
      }

      // Clean up alerts that are now matched (no longer outliers)
      const currentOutlierKeys = new Set(newOutliers.map(o => `${o.vendorSource}:${o.itemNumber}`));
      const staleAlerts = persistedOutliers.filter(
        p => !currentOutlierKeys.has(`${p.vendorSource}:${p.itemNumber}`)
      );
      if (staleAlerts.length > 0) {
        const staleIds = staleAlerts.map(a => a.id).filter(Boolean);
        if (staleIds.length > 0) {
          await supabase
            .from('vendor_gap_alerts' as any)
            .update({ status: 'resolved' })
            .in('id', staleIds);
        }
      }

      // Refresh from DB
      await refetchOutliers();

      setLastScanStats({ matchCount: totalMatched, totalBid: totalVendorItems, discrepancies });
      toast.success(`Scan complete: ${newOutliers.length} outliers found`);
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
        vendor_source: item.vendorSource === 'pa' ? 'produce_alliance' 
          : item.vendorSource === 'pfg' ? 'pfg' 
          : `invoice:${item.brand || 'unknown'}`,
        category: item.categoryName,
        status: 'draft',
      }));

      const { data: createdTemplates, error } = await supabase
        .from('brand_inventory_templates')
        .upsert(inserts as any, { onConflict: 'brand_id,product_name', ignoreDuplicates: true })
        .select('id, item_number, pa_item_id, vendor_source');
      if (error) throw error;

      // Also create brand_vendor_mappings for each promoted item
      // so the vendor SKU is formally linked for future auto-matching
      const mappingInserts: any[] = [];
      for (const item of items) {
        // Find the template that was just created/matched
        const template = (createdTemplates || []).find((t: any) => {
          if (item.vendorSource === 'pfg') return t.item_number === item.itemNumber;
          if (item.vendorSource === 'pa') return t.pa_item_id === item.itemNumber;
          // For invoice items, match by product_name since they use generated item numbers
          return t.vendor_source?.startsWith('invoice');
        });
        if (template && item.itemNumber) {
          mappingInserts.push({
            brand_template_id: template.id,
            vendor_item_id: item.itemNumber,
            vendor: item.vendorSource === 'pa' ? 'produce_alliance' : item.vendorSource || 'invoice',
          });
        }
      }
      if (mappingInserts.length > 0) {
        await supabase
          .from('brand_vendor_mappings')
          .upsert(mappingInserts as any, { onConflict: 'brand_template_id,vendor_item_id', ignoreDuplicates: true });
      }

      // Mark alerts as promoted
      const alertIds = items.map(i => i.id).filter(Boolean);
      if (alertIds.length > 0) {
        await supabase
          .from('vendor_gap_alerts' as any)
          .update({ status: 'promoted' })
          .in('id', alertIds);
      }
    },
    onSuccess: (_, items) => {
      toast.success(`${items.length} items added as drafts`);
      setSelectedIds(new Set());
      queryClient.invalidateQueries({ queryKey: ['brand-templates', brandId] });
      refetchOutliers();
    },
    onError: (err: any) => {
      toast.error('Failed to promote: ' + (err.message || 'Unknown'));
    },
  });

  // Dismiss selected outliers
  const dismissMutation = useMutation({
    mutationFn: async (items: OutlierItem[]) => {
      const alertIds = items.map(i => i.id).filter(Boolean);
      if (alertIds.length > 0) {
        await supabase
          .from('vendor_gap_alerts' as any)
          .update({ status: 'dismissed' })
          .in('id', alertIds);
      }
    },
    onSuccess: (_, items) => {
      toast.success(`${items.length} items dismissed`);
      setSelectedIds(new Set());
      refetchOutliers();
    },
    onError: (err: any) => {
      toast.error('Failed to dismiss: ' + (err.message || 'Unknown'));
    },
  });

  // Use persisted outliers as the display source
  const outliers = persistedOutliers;

  const categories = useMemo(() => {
    return [...new Set(outliers.map(o => o.categoryName))].sort();
  }, [outliers]);

  const filteredOutliers = useMemo(() => {
    let items = outliers;
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
  }, [outliers, categoryFilter, searchQuery]);

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
    const items = outliers.filter(o => selectedIds.has(o.itemNumber));
    if (items.length === 0) return;
    promoteMutation.mutate(items);
  };

  const handleDismiss = () => {
    const items = outliers.filter(o => selectedIds.has(o.itemNumber));
    if (items.length === 0) return;
    dismissMutation.mutate(items);
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
                Compare PFG Bid List &amp; PA catalog against your catalog
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

          {(pfgLocations.length > 0 || brandLocationIds.length > 0) && !isScanning && (
            <p className="text-xs text-muted-foreground mt-2">
              {outliers.length > 0
                ? `${outliers.length} unresolved outliers. Run scan to refresh.`
                : 'Click Run Scan to check for new vendor items.'}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Results Summary (shown after scan or when outliers exist) */}
      {(lastScanStats || outliers.length > 0) && (
        <div className="grid grid-cols-3 gap-2">
          <Card>
            <CardContent className="p-3 text-center">
              <div className="text-2xl font-bold text-primary">{lastScanStats?.totalBid ?? '—'}</div>
              <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Vendor Items</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3 text-center">
              <div className="text-2xl font-bold text-green-600">{lastScanStats?.matchCount ?? '—'}</div>
              <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Matched</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3 text-center">
              <div className="text-2xl font-bold text-amber-600">{outliers.length}</div>
              <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Outliers</div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Discrepancies */}
      {lastScanStats && lastScanStats.discrepancies.length > 0 && (
        <Card className="border-amber-200 bg-amber-50/50 dark:border-amber-900 dark:bg-amber-950/20">
          <CardHeader className="pb-2 pt-3 px-4">
            <CardTitle className="text-xs flex items-center gap-1.5 text-amber-700 dark:text-amber-400">
              <AlertTriangle className="h-3.5 w-3.5" />
              {lastScanStats.discrepancies.length} catalog items not on bid list
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3">
            <div className="flex flex-wrap gap-1">
              {lastScanStats.discrepancies.map(d => (
                <Badge key={d.itemNumber} variant="outline" className="text-[10px]">
                  {d.name}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Outliers List */}
      {outliers.length > 0 && (
        <Card>
          <CardHeader className="pb-2 pt-3 px-4">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm flex items-center gap-1.5">
                <PackagePlus className="h-4 w-4" />
                Outliers — Not in Catalog
              </CardTitle>
              {selectedIds.size > 0 && (
                <div className="flex gap-1.5">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleDismiss}
                    disabled={dismissMutation.isPending}
                    className="h-7 text-xs"
                  >
                    <Trash2 className="h-3 w-3 mr-1" />
                    Dismiss
                  </Button>
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
                </div>
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
                    key={`${item.vendorSource}-${item.itemNumber}`}
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
                        {item.vendorSource === 'pa' ? 'PA' : item.vendorSource === 'invoice' ? 'INV' : 'PFG'}
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
      {outliers.length === 0 && !isScanning && (
        <Card>
          <CardContent className="p-8 text-center">
            <CheckCircle2 className="h-10 w-10 text-green-500 mx-auto mb-2" />
            <p className="font-medium">No unresolved outliers</p>
            <p className="text-xs text-muted-foreground mt-1">
              Run a scan to check for new vendor items not in your catalog.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
