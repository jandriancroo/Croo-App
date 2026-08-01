import { useState, useMemo, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Search, RefreshCw, PackagePlus, AlertTriangle, CheckCircle2,
  Loader2, Filter, EyeOff, RotateCcw, Link2, ChevronDown, MapPin, X, Check,
} from 'lucide-react';
import { toast } from 'sonner';

interface VendorGapFinderProps {
  brandId: string;
}

interface ReportedLoc { id: string; name: string }

interface OutlierItem {
  id?: string;
  itemNumber: string;
  name: string;
  fullDescription: string;
  brand: string;
  packSize: string;
  categoryName: string;
  price: number | null;
  vendorSource: 'pfg' | 'pa' | 'invoice';
  status?: string;
  reportedByLocations: ReportedLoc[];
}

export default function VendorGapFinder({ brandId }: VendorGapFinderProps) {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedLocationId = searchParams.get('location');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [locationPopoverOpen, setLocationPopoverOpen] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [linkDialogItem, setLinkDialogItem] = useState<OutlierItem | null>(null);
  const [linkSearch, setLinkSearch] = useState('');
  const [collisionConfirm, setCollisionConfirm] = useState<{
    gap: OutlierItem;
    targetTemplateId: string;
    targetName: string;
    existingTemplateId: string;
    existingName: string;
  } | null>(null);
  const [showIgnored, setShowIgnored] = useState(false);
  const [lastScanStats, setLastScanStats] = useState<{
    matchCount: number;
    totalBid: number;
    discrepancies: { itemNumber: string; name: string }[];
  } | null>(null);

  // Load gap alerts (active + ignored/dismissed)
  const { data: allAlerts = [], refetch: refetchOutliers } = useQuery({
    queryKey: ['vendor-gap-alerts', brandId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('vendor_gap_alerts' as any)
        .select('*')
        .eq('brand_id', brandId)
        .in('status', ['new', 'ignored', 'dismissed'])
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data || []).map((d: any) => ({
        id: d.id,
        itemNumber: d.item_number,
        name: d.vendor_description || d.vendor_name || d.item_number,
        fullDescription: d.vendor_description || d.vendor_name || '',
        brand: '',
        packSize: d.pack_size || '',
        categoryName: d.category_name || 'Uncategorized',
        price: null,
        vendorSource: (d.vendor_source === 'produce_alliance' || d.vendor_source === 'pa' ? 'pa'
          : d.vendor_source === 'pfg' ? 'pfg'
          : 'invoice') as 'pfg' | 'pa' | 'invoice',
        status: d.status,
        reportedByLocations: Array.isArray(d.reported_by_locations) ? d.reported_by_locations : [],
      })) as OutlierItem[];
    },
  });

  const activeOutliers = useMemo(() => allAlerts.filter(a => a.status === 'new'), [allAlerts]);
  const ignoredOutliers = useMemo(
    () => allAlerts.filter(a => a.status === 'ignored' || a.status === 'dismissed'),
    [allAlerts],
  );

  const autoResolvedRef = useRef<Set<string>>(new Set());

  // Last nightly scan timestamp (stamped by the vendor-gap-scan edge function)
  const { data: lastScanAt, refetch: refetchLastScanAt } = useQuery({
    queryKey: ['brand-last-vendor-gap-scan-at', brandId],
    queryFn: async () => {
      const { data } = await supabase
        .from('brands')
        .select('last_vendor_gap_scan_at')
        .eq('id', brandId)
        .maybeSingle();
      return (data as any)?.last_vendor_gap_scan_at as string | null;
    },
  });

  // Get locations with PFG integration for this brand
  const { data: pfgLocations = [] } = useQuery({
    queryKey: ['brand-pfg-locations', brandId],
    queryFn: async () => {
      const { data: orgs } = await supabase.from('organizations').select('id').eq('brand_id', brandId);
      if (!orgs?.length) return [];
      const orgIds = orgs.map(o => o.id);
      const { data: locs } = await supabase
        .from('locations').select('id, name').in('organization_id', orgIds);
      if (!locs?.length) return [];
      const locIds = locs.map(l => l.id);
      const { data: integrations } = await supabase
        .from('location_integrations')
        .select('location_id, credentials')
        .eq('integration_type', 'pfg').eq('is_active', true).in('location_id', locIds);
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

  const { data: templates = [] } = useQuery({
    queryKey: ['brand-templates-gap-finder', brandId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('brand_inventory_templates')
        .select('id, item_number, product_name, status, pa_item_id, category')
        .eq('brand_id', brandId);
      if (error) throw error;
      return data || [];
    },
  });

  const { data: vendorMappings = [] } = useQuery({
    queryKey: ['brand-vendor-mappings-gap', brandId],
    queryFn: async () => {
      const templateIds = templates.map(t => t.id);
      if (!templateIds.length) return [];
      const { data, error } = await supabase
        .from('brand_vendor_mappings')
        .select('vendor_item_id, vendor, brand_template_id')
        .in('brand_template_id', templateIds);
      if (error) throw error;
      return data || [];
    },
    enabled: templates.length > 0,
  });

  // Auto-resolve any active gap whose SKU is already mapped to a live/draft template.
  // Handles stale alerts created before the SKU was linked (or when the linker fired
  // an upsert that didn't trigger a rescan).
  useEffect(() => {
    if (!activeOutliers.length) return;

    const liveTemplateIds = new Set(
      templates.filter(t => (t as any).status !== 'archived').map(t => t.id),
    );
    const claimedPfg = new Set<string>();
    const claimedPa = new Set<string>();

    for (const t of templates) {
      if ((t as any).status === 'archived') continue;
      if (t.item_number) claimedPfg.add(String(t.item_number).trim());
      if ((t as any).pa_item_id) claimedPa.add(String((t as any).pa_item_id).trim());
    }
    for (const m of vendorMappings) {
      if (!liveTemplateIds.has(m.brand_template_id)) continue;
      const vid = String(m.vendor_item_id || '').trim();
      if (!vid) continue;
      if (m.vendor === 'pfg') claimedPfg.add(vid);
      else if (m.vendor === 'produce_alliance') claimedPa.add(vid);
    }

    const toResolve: string[] = [];
    for (const o of activeOutliers) {
      if (!o.id || autoResolvedRef.current.has(o.id)) continue;
      const sku = String(o.itemNumber || '').trim();
      if (!sku) continue;
      const claimed =
        (o.vendorSource === 'pfg' && claimedPfg.has(sku)) ||
        (o.vendorSource === 'pa' && claimedPa.has(sku));
      if (claimed) toResolve.push(o.id);
    }

    if (toResolve.length === 0) return;
    toResolve.forEach(id => autoResolvedRef.current.add(id));

    (async () => {
      const { error } = await supabase
        .from('vendor_gap_alerts' as any)
        .update({ status: 'resolved', resolved_at: new Date().toISOString() })
        .in('id', toResolve);
      if (!error) {
        console.log(`[VendorGapFinder] Auto-resolved ${toResolve.length} stale gap alerts`);
        refetchOutliers();
      }
    })();
  }, [activeOutliers, templates, vendorMappings, refetchOutliers]);

  const { data: brandLocationIds = [] } = useQuery({
    queryKey: ['brand-location-ids', brandId],
    queryFn: async () => {
      const { data: orgs } = await supabase.from('organizations').select('id').eq('brand_id', brandId);
      if (!orgs?.length) return [];
      const { data: locs } = await supabase.from('locations').select('id').in('organization_id', orgs.map(o => o.id));
      return (locs || []).map(l => l.id);
    },
  });

  // Live templates for the Link-to-Existing picker
  const liveTemplates = useMemo(
    () => templates.filter((t: any) => t.status === 'live'),
    [templates],
  );

  // Map: brand_template_id -> { pfg: string[], pa: string[] } merged from
  // template-level item_number/pa_item_id and brand_vendor_mappings.
  const templateVendorIds = useMemo(() => {
    const map = new Map<string, { pfg: Set<string>; pa: Set<string> }>();
    const ensure = (id: string) => {
      let v = map.get(id);
      if (!v) { v = { pfg: new Set(), pa: new Set() }; map.set(id, v); }
      return v;
    };
    for (const t of templates as any[]) {
      if (t.item_number) ensure(t.id).pfg.add(String(t.item_number).trim());
      if (t.pa_item_id) ensure(t.id).pa.add(String(t.pa_item_id).trim());
    }
    for (const m of vendorMappings) {
      const vid = String(m.vendor_item_id || '').trim();
      if (!vid) continue;
      const bucket = ensure(m.brand_template_id);
      if (m.vendor === 'pfg') bucket.pfg.add(vid);
      else if (m.vendor === 'produce_alliance') bucket.pa.add(vid);
    }
    return map;
  }, [templates, vendorMappings]);

  const filteredLiveTemplates = useMemo(() => {
    if (!linkSearch.trim()) {
      // Seed initial results with fuzzy word-overlap matches against the gap name.
      // No auto-link — user must still pick. Falls back to alphabetical if no fuzzy hits.
      const gapName = linkDialogItem?.name || linkDialogItem?.fullDescription || '';
      if (!gapName) return liveTemplates.slice(0, 50);
      const words = gapName.toLowerCase().replace(/[^a-z0-9 ]/g, '').split(/\s+/).filter(w => w.length >= 3);
      if (words.length === 0) return liveTemplates.slice(0, 50);
      const scored = liveTemplates
        .map((t: any) => {
          const name = (t.product_name || '').toLowerCase();
          const hits = words.reduce((acc, w) => acc + (name.includes(w) ? 1 : 0), 0);
          return { t, score: hits / words.length };
        })
        .filter(x => x.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 50)
        .map(x => x.t);
      return scored.length > 0 ? scored : liveTemplates.slice(0, 50);
    }
    const q = linkSearch.toLowerCase();
    return liveTemplates
      .filter((t: any) => t.product_name?.toLowerCase().includes(q))
      .slice(0, 50);
  }, [liveTemplates, linkSearch, linkDialogItem]);

  const runScan = async () => {
    setIsScanning(true);
    setLastScanStats(null);

    const existingNumbers = new Set(templates.map(t => t.item_number).filter(Boolean));
    const existingPaIds = new Set(
      templates.map((t: any) => t.pa_item_id).filter(Boolean).map((id: string) => id.trim()),
    );
    const existingVendorIds = new Set(
      vendorMappings.map(m => String(m.vendor_item_id || '').trim()).filter(Boolean),
    );

    let totalVendorItems = 0;
    let totalMatched = 0;
    let discrepancies: { itemNumber: string; name: string }[] = [];

    try {
      // Trigger the centralized scan (PFG + PA, location-tagged)
      const { error: scanErr } = await supabase.functions.invoke('vendor-gap-scan');
      if (scanErr) console.warn('vendor-gap-scan invoke error:', scanErr);

      // Build local stats from one PFG location for the UI summary
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
          totalVendorItems += bidProducts.length;
          const bidNumbers = new Set(bidProducts.map((p: any) => String(p.itemNumber || '').trim()));
          const matched = bidProducts.filter((p: any) => {
            const n = String(p.itemNumber || '').trim();
            return existingNumbers.has(n) || existingVendorIds.has(n);
          });
          totalMatched += matched.length;
          discrepancies = templates
            .filter(t => t.item_number && !bidNumbers.has(t.item_number) && (t as any).status === 'live')
            .filter(t => !vendorMappings.find(m => m.vendor_item_id === t.item_number && m.vendor !== 'pfg'))
            .map(t => ({ itemNumber: t.item_number!, name: t.product_name }));
        } catch {}
      }

      if (brandLocationIds.length > 0) {
        const allPaItems = new Set<string>();
        for (const locId of brandLocationIds) {
          const { data: catalogItems } = await supabase
            .from('pa_catalog_items' as any)
            .select('pa_item_id').eq('location_id', locId);
          for (const it of (catalogItems || []) as any[]) {
            const id = String(it.pa_item_id || '').trim();
            if (id) allPaItems.add(id);
          }
        }
        totalVendorItems += allPaItems.size;
        let paMatched = 0;
        for (const id of allPaItems) {
          if (existingPaIds.has(id) || existingVendorIds.has(id)) paMatched++;
        }
        totalMatched += paMatched;
      }

      await refetchOutliers();
      await refetchLastScanAt();
      setLastScanStats({ matchCount: totalMatched, totalBid: totalVendorItems, discrepancies });
      toast.success('Scan complete');
    } catch (err: any) {
      toast.error('Scan failed: ' + (err.message || 'Unknown error'));
    } finally {
      setIsScanning(false);
    }
  };

  // Promote selected outliers to draft templates
  const promoteMutation = useMutation({
    mutationFn: async (items: OutlierItem[]) => {
      // Step 1: Find any existing templates that match by vendor item_number/pa_item_id
      // or product_name. If they exist (even archived), revive them as draft instead
      // of silently skipping the insert (the old onConflict:ignoreDuplicates lost rows).
      const productNames = items.map(i => i.fullDescription || i.name);
      const itemNumbers = items.map(i => i.itemNumber).filter(Boolean) as string[];

      const { data: existingByName } = await supabase
        .from('brand_inventory_templates')
        .select('id, product_name, item_number, pa_item_id, status, vendor_source')
        .eq('brand_id', brandId)
        .in('product_name', productNames);

      const { data: existingByNumber } = itemNumbers.length > 0 ? await supabase
        .from('brand_inventory_templates')
        .select('id, product_name, item_number, pa_item_id, status, vendor_source')
        .eq('brand_id', brandId)
        .or(`item_number.in.(${itemNumbers.join(',')}),pa_item_id.in.(${itemNumbers.join(',')})`) : { data: [] as any[] };

      const existingMap = new Map<string, any>();
      for (const t of [...(existingByName || []), ...(existingByNumber || [])]) {
        existingMap.set(t.id, t);
      }

      const reviveIds: string[] = [];
      const itemToTemplateId = new Map<string, string>();
      const newInserts: any[] = [];

      for (const item of items) {
        const matched = [...existingMap.values()].find(t => {
          if (item.vendorSource === 'pfg' && t.item_number === item.itemNumber) return true;
          if (item.vendorSource === 'pa' && t.pa_item_id === item.itemNumber) return true;
          if (t.product_name === (item.fullDescription || item.name)) return true;
          return false;
        });
        if (matched) {
          itemToTemplateId.set(item.id || '', matched.id);
          if (matched.status === 'archived') reviveIds.push(matched.id);
        } else {
          newInserts.push({
            brand_id: brandId,
            product_name: item.fullDescription || item.name,
            item_number: item.vendorSource === 'pfg' ? item.itemNumber : null,
            pa_item_id: item.vendorSource === 'pa' ? item.itemNumber : null,
            vendor_source: item.vendorSource === 'pa' ? 'produce_alliance'
              : item.vendorSource === 'pfg' ? 'pfg'
              : `invoice:${item.brand || 'unknown'}`,
            category: item.categoryName,
            status: 'draft',
          });
        }
      }

      if (reviveIds.length > 0) {
        await supabase.from('brand_inventory_templates')
          .update({ status: 'draft' }).in('id', reviveIds);
      }

      let createdTemplates: any[] = [];
      if (newInserts.length > 0) {
        const { data, error } = await supabase
          .from('brand_inventory_templates')
          .insert(newInserts as any)
          .select('id, product_name, item_number, pa_item_id, vendor_source');
        if (error) throw error;
        createdTemplates = data || [];
        for (const item of items) {
          if (itemToTemplateId.has(item.id || '')) continue;
          const t = createdTemplates.find((x: any) => {
            if (item.vendorSource === 'pfg') return x.item_number === item.itemNumber;
            if (item.vendorSource === 'pa') return x.pa_item_id === item.itemNumber;
            return x.product_name === (item.fullDescription || item.name);
          });
          if (t) itemToTemplateId.set(item.id || '', t.id);
        }
      }

      const mappingInserts: any[] = [];
      for (const item of items) {
        const tid = itemToTemplateId.get(item.id || '');
        if (tid && item.itemNumber) {
          mappingInserts.push({
            brand_template_id: tid,
            vendor_item_id: item.itemNumber,
            vendor: item.vendorSource === 'pa' ? 'produce_alliance' : item.vendorSource || 'invoice',
          });
        }
      }
      if (mappingInserts.length > 0) {
        await supabase.from('brand_vendor_mappings')
          .upsert(mappingInserts as any, { onConflict: 'brand_template_id,vendor,vendor_item_id', ignoreDuplicates: true });
      }

      const alertIds = items.map(i => i.id).filter(Boolean);
      if (alertIds.length > 0) {
        await supabase.from('vendor_gap_alerts' as any)
          .update({ status: 'promoted' }).in('id', alertIds);
      }
    },
    onSuccess: (_, items) => {
      toast.success(`${items.length} items added as drafts`);
      setSelectedIds(new Set());
      queryClient.invalidateQueries({ queryKey: ['brand-templates', brandId] });
      refetchOutliers();
    },
    onError: (err: any) => toast.error('Failed to promote: ' + (err.message || 'Unknown')),
  });

  // Ignore selected outliers (reversible)
  const ignoreMutation = useMutation({
    mutationFn: async (items: OutlierItem[]) => {
      const alertIds = items.map(i => i.id).filter(Boolean);
      if (alertIds.length > 0) {
        await supabase.from('vendor_gap_alerts' as any)
          .update({ status: 'ignored' }).in('id', alertIds);
      }
    },
    onSuccess: (_, items) => {
      toast.success(`${items.length} items moved to Ignored`);
      setSelectedIds(new Set());
      refetchOutliers();
    },
    onError: (err: any) => toast.error('Failed to ignore: ' + (err.message || 'Unknown')),
  });

  // Restore from Ignored back to Active
  const restoreMutation = useMutation({
    mutationFn: async (alertId: string) => {
      await supabase.from('vendor_gap_alerts' as any)
        .update({ status: 'new' }).eq('id', alertId);
    },
    onSuccess: () => {
      toast.success('Restored to active gaps');
      refetchOutliers();
    },
    onError: (err: any) => toast.error('Failed to restore: ' + (err.message || 'Unknown')),
  });

  // Link to Existing (with collision guard)
  const linkToExistingMutation = useMutation({
    mutationFn: async (args: { gap: OutlierItem; targetTemplateId: string; targetName: string }) => {
      const { gap, targetTemplateId } = args;
      const vendorKey = gap.vendorSource === 'pa' ? 'produce_alliance' : gap.vendorSource;
      // Insert mapping
      const { error: mapErr } = await supabase
        .from('brand_vendor_mappings')
        .upsert(
          { brand_template_id: targetTemplateId, vendor: vendorKey, vendor_item_id: gap.itemNumber } as any,
          { onConflict: 'brand_template_id,vendor,vendor_item_id', ignoreDuplicates: true },
        );
      if (mapErr) throw mapErr;
      if (gap.id) {
        await supabase.from('vendor_gap_alerts' as any)
          .update({ status: 'resolved' }).eq('id', gap.id);
      }
    },
    onSuccess: (_, args) => {
      toast.success(`Linked "${args.gap.name}" → "${args.targetName}". Will auto-match on next sync.`);
      setLinkDialogItem(null);
      setLinkSearch('');
      setCollisionConfirm(null);
      queryClient.invalidateQueries({ queryKey: ['brand-vendor-mappings-gap', brandId] });
      refetchOutliers();
    },
    onError: (err: any) => toast.error('Link failed: ' + (err.message || 'Unknown')),
  });

  // Pre-link collision check — only flag conflicts against LIVE/DRAFT templates.
  // Archived templates are dead inventory and shouldn't block re-linking the SKU.
  const handleLinkClick = async (gap: OutlierItem, targetTemplateId: string, targetName: string) => {
    const vendorKey = gap.vendorSource === 'pa' ? 'produce_alliance' : gap.vendorSource;
    const collision = vendorMappings.find(m => {
      if (m.vendor_item_id !== gap.itemNumber) return false;
      if (m.vendor !== vendorKey) return false;
      if (m.brand_template_id === targetTemplateId) return false;
      const owner = templates.find(t => t.id === m.brand_template_id);
      // Ignore mappings owned by archived templates
      return owner && (owner as any).status !== 'archived';
    });
    if (collision) {
      const existing = templates.find(t => t.id === collision.brand_template_id);
      setCollisionConfirm({
        gap, targetTemplateId, targetName,
        existingTemplateId: collision.brand_template_id,
        existingName: existing?.product_name || 'Unknown item',
      });
      return;
    }
    linkToExistingMutation.mutate({ gap, targetTemplateId, targetName });
  };

  const categories = useMemo(
    () => [...new Set(activeOutliers.map(o => o.categoryName))].sort(),
    [activeOutliers],
  );

  // Build the list of locations that appear in at least one active gap
  const locationsInGaps = useMemo(() => {
    const map = new Map<string, string>();
    for (const o of activeOutliers) {
      for (const loc of o.reportedByLocations) {
        if (loc.id && !map.has(loc.id)) map.set(loc.id, loc.name || 'Unknown');
      }
    }
    return [...map.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [activeOutliers]);

  const selectedLocationName = useMemo(
    () => selectedLocationId ? locationsInGaps.find(l => l.id === selectedLocationId)?.name : null,
    [selectedLocationId, locationsInGaps],
  );

  const setLocationFilter = (locId: string | null) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      if (locId) next.set('location', locId);
      else next.delete('location');
      return next;
    }, { replace: true });
  };

  const filteredOutliers = useMemo(() => {
    let items = activeOutliers;
    if (categoryFilter !== 'all') items = items.filter(o => o.categoryName === categoryFilter);
    if (selectedLocationId) {
      items = items.filter(o => o.reportedByLocations.some(l => l.id === selectedLocationId));
    }
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      items = items.filter(o =>
        o.name.toLowerCase().includes(q) ||
        o.itemNumber.includes(q) ||
        o.brand?.toLowerCase().includes(q),
      );
    }
    return items;
  }, [activeOutliers, categoryFilter, selectedLocationId, searchQuery]);

  // Auto-clear location filter when its gaps reach zero
  const lastClearedLocationRef = useRef<string | null>(null);
  useEffect(() => {
    if (!selectedLocationId) return;
    if (lastClearedLocationRef.current === selectedLocationId) return;
    const stillHasGaps = activeOutliers.some(o =>
      o.reportedByLocations.some(l => l.id === selectedLocationId),
    );
    if (!stillHasGaps && activeOutliers.length >= 0) {
      const name = selectedLocationName || 'location';
      lastClearedLocationRef.current = selectedLocationId;
      setLocationFilter(null);
      toast.success(`All gaps resolved for ${name}`);
    }
  }, [activeOutliers, selectedLocationId, selectedLocationName]);

  const toggleSelect = (itemNumber: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(itemNumber)) next.delete(itemNumber); else next.add(itemNumber);
      return next;
    });
  };

  const toggleAll = () => {
    if (selectedIds.size === filteredOutliers.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(filteredOutliers.map(o => o.itemNumber)));
  };

  const handlePromote = () => {
    const items = activeOutliers.filter(o => selectedIds.has(o.itemNumber));
    if (items.length === 0) return;
    promoteMutation.mutate(items);
  };

  const handleIgnore = () => {
    const items = activeOutliers.filter(o => selectedIds.has(o.itemNumber));
    if (items.length === 0) return;
    ignoreMutation.mutate(items);
  };

  return (
    <div className="space-y-4">
      {/* Scan Control */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h3 className="font-semibold text-sm flex items-center gap-2">
                <Search className="h-4 w-4 text-primary" />
                Vendor Gap Finder
              </h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Auto-scans nightly. Compares PFG Bid List &amp; PA catalog against your catalog.
              </p>
              <p className="text-[11px] text-muted-foreground mt-1">
                <span className="font-medium">Last updated:</span>{' '}
                {lastScanAt
                  ? new Date(lastScanAt).toLocaleString(undefined, {
                      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
                    })
                  : 'Never — waiting for first nightly run'}
              </p>
            </div>
            <Button size="sm" variant="ghost" onClick={runScan}
              title="Force a manual rescan"
              disabled={isScanning || (pfgLocations.length === 0 && brandLocationIds.length === 0)}>
              {isScanning ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-1.5" />}
              {isScanning ? 'Scanning...' : 'Refresh now'}
            </Button>
          </div>
          {pfgLocations.length === 0 && brandLocationIds.length === 0 && (
            <p className="text-xs text-destructive mt-2">
              No locations have PFG or PA integrations configured.
            </p>
          )}
          {(pfgLocations.length > 0 || brandLocationIds.length > 0) && !isScanning && activeOutliers.length > 0 && (
            <p className="text-xs text-muted-foreground mt-2">
              {activeOutliers.length} unresolved gap{activeOutliers.length === 1 ? '' : 's'} from the last scan.
            </p>
          )}
        </CardContent>
      </Card>


      {/* Stats */}
      {(lastScanStats || activeOutliers.length > 0) && (
        <div className="grid grid-cols-3 gap-2">
          <Card><CardContent className="p-3 text-center">
            <div className="text-2xl font-bold text-primary">{lastScanStats?.totalBid ?? '—'}</div>
            <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Vendor Items</div>
          </CardContent></Card>
          <Card><CardContent className="p-3 text-center">
            <div className="text-2xl font-bold text-emerald-600">{lastScanStats?.matchCount ?? '—'}</div>
            <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Matched</div>
          </CardContent></Card>
          <Card><CardContent className="p-3 text-center">
            <div className="text-2xl font-bold text-amber-600">{activeOutliers.length}</div>
            <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Active Gaps</div>
          </CardContent></Card>
        </div>
      )}

      {/* Active Gaps */}
      {activeOutliers.length > 0 && (
        <Card>
          <CardHeader className="pb-2 pt-3 px-4">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm flex items-center gap-1.5">
                <PackagePlus className="h-4 w-4" />
                Active Gaps — Not in Catalog
              </CardTitle>
              {selectedIds.size > 0 && (
                <div className="flex gap-1.5">
                  <Button size="sm" variant="outline" onClick={handleIgnore}
                    disabled={ignoreMutation.isPending} className="h-7 text-xs">
                    <EyeOff className="h-3 w-3 mr-1" />
                    Ignore
                  </Button>
                  <Button size="sm" onClick={handlePromote}
                    disabled={promoteMutation.isPending} className="h-7 text-xs">
                    {promoteMutation.isPending
                      ? <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                      : <PackagePlus className="h-3 w-3 mr-1" />}
                    Add {selectedIds.size} as Draft
                  </Button>
                </div>
              )}
            </div>
          </CardHeader>
          <CardContent className="px-4 pb-3 space-y-2">
            <div className="flex gap-2 flex-wrap">
              <div className="relative flex-1 min-w-[180px]">
                <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                <Input placeholder="Search gaps..." value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)} className="h-8 pl-8 text-xs" />
              </div>
              <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                <SelectTrigger className="h-8 w-[140px] text-xs">
                  <Filter className="h-3 w-3 mr-1" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Categories</SelectItem>
                  {categories.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
              <Popover open={locationPopoverOpen} onOpenChange={setLocationPopoverOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs justify-between min-w-[160px] max-w-[220px]"
                    disabled={locationsInGaps.length === 0}
                  >
                    <span className="flex items-center gap-1 truncate">
                      <MapPin className="h-3 w-3 shrink-0" />
                      <span className="truncate">{selectedLocationName || 'All Locations'}</span>
                    </span>
                    {selectedLocationId ? (
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={(e) => {
                          e.stopPropagation();
                          setLocationFilter(null);
                          lastClearedLocationRef.current = null;
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            e.stopPropagation();
                            setLocationFilter(null);
                            lastClearedLocationRef.current = null;
                          }
                        }}
                        className="ml-1 inline-flex items-center justify-center rounded-sm hover:bg-muted p-0.5"
                        aria-label="Clear location filter"
                      >
                        <X className="h-3 w-3" />
                      </span>
                    ) : (
                      <ChevronDown className="h-3 w-3 ml-1 opacity-50" />
                    )}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[240px] p-0 bg-popover" align="end">
                  <Command>
                    <CommandInput placeholder="Search locations..." className="h-8 text-xs" autoFocus />
                    <CommandList>
                      <CommandEmpty>No locations found.</CommandEmpty>
                      <CommandGroup>
                        <CommandItem
                          value="__all__"
                          onSelect={() => {
                            setLocationFilter(null);
                            lastClearedLocationRef.current = null;
                            setLocationPopoverOpen(false);
                          }}
                          className="text-xs"
                        >
                          <Check className={`mr-2 h-3.5 w-3.5 ${!selectedLocationId ? 'opacity-100' : 'opacity-0'}`} />
                          All Locations
                        </CommandItem>
                        {locationsInGaps.map(loc => (
                          <CommandItem
                            key={loc.id}
                            value={loc.name}
                            onSelect={() => {
                              setLocationFilter(loc.id);
                              lastClearedLocationRef.current = null;
                              setLocationPopoverOpen(false);
                            }}
                            className="text-xs"
                          >
                            <Check className={`mr-2 h-3.5 w-3.5 ${selectedLocationId === loc.id ? 'opacity-100' : 'opacity-0'}`} />
                            {loc.name}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>

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

            <ScrollArea className="h-[400px]">
              <div className="space-y-1">
                {filteredOutliers.map(item => (
                  <div key={`${item.vendorSource}-${item.itemNumber}`}
                    className={`flex items-start gap-2 p-2 rounded-lg border text-xs transition-colors ${
                      selectedIds.has(item.itemNumber)
                        ? 'bg-primary/5 border-primary/30'
                        : 'bg-card hover:bg-muted/50 border-border'
                    }`}>
                    <Checkbox className="mt-0.5"
                      checked={selectedIds.has(item.itemNumber)}
                      onCheckedChange={() => toggleSelect(item.itemNumber)} />
                    <div className="flex-1 min-w-0 cursor-pointer" onClick={() => toggleSelect(item.itemNumber)}>
                      <div className="font-medium truncate">{item.name}</div>
                      <div className="flex items-center gap-1.5 mt-0.5 text-muted-foreground flex-wrap">
                        <span>#{item.itemNumber}</span>
                        {item.packSize && <span>• {item.packSize}</span>}
                        {item.reportedByLocations.length > 0 && (
                          <span className="flex items-center gap-1 text-foreground/70">
                            <MapPin className="h-2.5 w-2.5" />
                            {item.reportedByLocations.map(l => l.name).join(' · ')}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <Button size="sm" variant="outline"
                        onClick={(e) => { e.stopPropagation(); setLinkDialogItem(item); }}
                        className="h-6 text-[10px] px-2">
                        <Link2 className="h-3 w-3 mr-1" />
                        Link
                      </Button>
                      <Badge variant="outline" className="text-[10px]">
                        {item.vendorSource === 'pa' ? 'PA' : item.vendorSource === 'invoice' ? 'INV' : 'PFG'}
                      </Badge>
                      <Badge variant="outline" className="text-[10px]">{item.categoryName}</Badge>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
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
                <Badge key={d.itemNumber} variant="outline" className="text-[10px]">{d.name}</Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Empty state */}
      {activeOutliers.length === 0 && !isScanning && (
        <Card>
          <CardContent className="p-8 text-center">
            <CheckCircle2 className="h-10 w-10 text-emerald-500 mx-auto mb-2" />
            <p className="font-medium">No active gaps</p>
            <p className="text-xs text-muted-foreground mt-1">
              Run a scan to check for new vendor items not in your catalog.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Ignored Items (collapsible) */}
      {ignoredOutliers.length > 0 && (
        <Card>
          <Collapsible open={showIgnored} onOpenChange={setShowIgnored}>
            <CollapsibleTrigger asChild>
              <button type="button" className="w-full px-4 py-3 flex items-center justify-between hover:bg-muted/50 transition-colors rounded-lg">
                <div className="flex items-center gap-2">
                  <EyeOff className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium">Ignored Items</span>
                  <Badge variant="secondary" className="text-[10px]">{ignoredOutliers.length}</Badge>
                </div>
                <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${showIgnored ? 'rotate-180' : ''}`} />
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="px-4 pb-3">
                <ScrollArea className="h-[280px]">
                  <div className="space-y-1">
                    {ignoredOutliers.map(item => (
                      <div key={`ign-${item.vendorSource}-${item.itemNumber}`}
                        className="flex items-start gap-2 p-2 rounded-lg border text-xs bg-muted/30 border-border opacity-75">
                        <div className="flex-1 min-w-0">
                          <div className="font-medium truncate">{item.name}</div>
                          <div className="flex items-center gap-1.5 mt-0.5 text-muted-foreground flex-wrap">
                            <span>#{item.itemNumber}</span>
                            {item.packSize && <span>• {item.packSize}</span>}
                            {item.reportedByLocations.length > 0 && (
                              <span className="flex items-center gap-1">
                                <MapPin className="h-2.5 w-2.5" />
                                {item.reportedByLocations.map(l => l.name).join(' · ')}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <Button size="sm" variant="outline"
                            onClick={() => item.id && restoreMutation.mutate(item.id)}
                            disabled={restoreMutation.isPending}
                            className="h-6 text-[10px] px-2">
                            <RotateCcw className="h-3 w-3 mr-1" />
                            Restore
                          </Button>
                          <Badge variant="outline" className="text-[10px]">
                            {item.vendorSource === 'pa' ? 'PA' : item.vendorSource === 'invoice' ? 'INV' : 'PFG'}
                          </Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </div>
            </CollapsibleContent>
          </Collapsible>
        </Card>
      )}

      {/* Link to Existing Dialog */}
      <Dialog open={!!linkDialogItem} onOpenChange={(open) => { if (!open) { setLinkDialogItem(null); setLinkSearch(''); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Link2 className="h-4 w-4" />
              Link to Existing Catalog Item
            </DialogTitle>
            <DialogDescription asChild>
              {linkDialogItem ? (
                <div className="space-y-3">
                  <p className="text-xs text-muted-foreground">
                    Pick the catalog item that matches the vendor item below. Future syncs will auto-match.
                  </p>
                  <div className="rounded-md border bg-muted/40 p-3 space-y-1">
                    <div className="text-sm font-medium text-foreground leading-snug">
                      {linkDialogItem.name}
                    </div>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
                      <span className="uppercase font-medium">{linkDialogItem.vendorSource}</span>
                      <span>#{linkDialogItem.itemNumber}</span>
                      {linkDialogItem.packSize && <span>• {linkDialogItem.packSize}</span>}
                      {linkDialogItem.categoryName && <span>• {linkDialogItem.categoryName}</span>}
                    </div>
                  </div>
                </div>
              ) : <span />}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <Input placeholder="Search live catalog items..." value={linkSearch}
                onChange={e => setLinkSearch(e.target.value)} className="h-8 pl-8 text-xs" autoFocus />
            </div>
            <ScrollArea className="h-[340px] border rounded-md">
              <div className="p-1">
                {filteredLiveTemplates.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-8">No matching items.</p>
                ) : (
                  filteredLiveTemplates.map((t: any) => {
                    const ids = templateVendorIds.get(t.id);
                    const pfgIds = ids ? Array.from(ids.pfg) : [];
                    const paIds = ids ? Array.from(ids.pa) : [];
                    const hasIds = pfgIds.length > 0 || paIds.length > 0;
                    return (
                    <button key={t.id} type="button"
                      disabled={linkToExistingMutation.isPending}
                      onClick={() => linkDialogItem && handleLinkClick(linkDialogItem, t.id, t.product_name)}
                      className="w-full flex items-start gap-2 py-2 px-2 text-xs hover:bg-muted/50 rounded-md transition-colors text-left disabled:opacity-50">
                      <CheckCircle2 className="h-3 w-3 text-emerald-500 shrink-0 mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="truncate flex-1 font-medium">{t.product_name}</span>
                          {t.category && (
                            <span className="text-[10px] text-muted-foreground shrink-0">{t.category}</span>
                          )}
                        </div>
                        {hasIds ? (
                          <div className="flex flex-wrap gap-x-2 gap-y-0.5 mt-0.5 text-[10px] text-muted-foreground font-mono">
                            {pfgIds.map(id => <span key={`pfg-${id}`}>PFG #{id}</span>)}
                            {paIds.map(id => <span key={`pa-${id}`}>PA #{id}</span>)}
                          </div>
                        ) : (
                          <div className="mt-0.5 text-[10px] text-muted-foreground/60 italic">No vendor IDs linked</div>
                        )}
                      </div>
                    </button>
                    );
                  })
                )}
              </div>
            </ScrollArea>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setLinkDialogItem(null); setLinkSearch(''); }}>Cancel</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Collision Confirmation */}
      <AlertDialog open={!!collisionConfirm} onOpenChange={(open) => { if (!open) setCollisionConfirm(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              SKU already linked
            </AlertDialogTitle>
            <AlertDialogDescription>
              {collisionConfirm && (
                <>
                  Vendor SKU{' '}
                  <span className="font-mono font-medium">#{collisionConfirm.gap.itemNumber}</span>{' '}
                  is already linked to{' '}
                  <span className="font-medium text-foreground">{collisionConfirm.existingName}</span>.
                  <br /><br />
                  Reassigning it to{' '}
                  <span className="font-medium text-foreground">{collisionConfirm.targetName}</span>{' '}
                  will break costing for the original item. Are you sure?
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => {
              if (collisionConfirm) {
                linkToExistingMutation.mutate({
                  gap: collisionConfirm.gap,
                  targetTemplateId: collisionConfirm.targetTemplateId,
                  targetName: collisionConfirm.targetName,
                });
              }
            }}>Reassign anyway</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
