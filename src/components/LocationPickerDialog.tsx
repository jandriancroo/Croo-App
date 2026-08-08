import { useState, useMemo, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { Building2, MapPin, ChevronRight, ChevronLeft, ChevronDown, Star, Search, BarChart3 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useUserRole } from '@/hooks/useUserRole';
import { useAuth } from '@/lib/auth';
import { Skeleton } from '@/components/ui/skeleton';
import { useIsMobile } from '@/hooks/use-mobile';
import { toast } from 'sonner';
import { formatLocationName } from '@/utils/locationUtils';

import { useQuery, useQueryClient } from '@tanstack/react-query';

interface Organization {
  id: string;
  name: string;
  brand_name: string | null;
  logo_url: string | null;
  brand_id?: string | null;
}

interface BrandInfo {
  id: string;
  name: string;
  logo_url: string | null;
}

interface Location {
  id: string;
  name: string;
  location_type: string;
  organization_id: string | null;
  org_name?: string;
  org_raw_name?: string;
  store_number?: string | null;
  inventory_mode?: string | null;
  inventory_configured?: boolean | null;
}

interface LocationPickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectLocation: (location: { id: string; name: string; location_type: string; store_number?: string | null; organization_id?: string | null }) => void;
  currentLocationId?: string;
}

// Recents removed — search handles discovery

export function LocationPickerDialog({
  open,
  onOpenChange,
  onSelectLocation,
  currentLocationId,
}: LocationPickerDialogProps) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { role } = useUserRole();
  const isMobile = useIsMobile();
  const queryClient = useQueryClient();
  const searchRef = useRef<HTMLInputElement>(null);
  
  const hasMultiLocationAccess = role === 'super_admin' || role === 'brand_admin' || role === 'org_admin';
  const isSuperAdmin = role === 'super_admin';
  // Only super_admin should see every org in the system. A plain `admin` is a
  // location-level admin and must fall through to the standard user_locations
  // branch so they only see the locations they're actually assigned to.
  const canSeeAllOrgs = role === 'super_admin';
  const isOrgLevel = role === 'manager' || role === 'org_admin';

  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState<string>('');
  const [view, setView] = useState<'locations' | 'brands'>('locations');
  const touchStartX = useRef<number | null>(null);
  const LAST_BRAND_KEY = 'location-picker:last-brand-tab';

  // Cache user profile data (default location, all_locations flag)
  const { data: profileData } = useQuery({
    queryKey: ['location-picker-profile', user?.id],
    queryFn: async () => {
      if (!user?.id) return null;
      const { data } = await supabase
        .from('profiles')
        .select('default_location_id, all_locations_enabled')
        .eq('id', user.id)
        .single();
      return data;
    },
    enabled: !!user?.id,
    staleTime: 5 * 60 * 1000,
  });

  const [defaultLocationId, setDefaultLocationId] = useState<string | null>(null);
  const allLocationsEnabled = profileData?.all_locations_enabled || false;
  const effectiveDefaultId = defaultLocationId ?? profileData?.default_location_id ?? null;

  // Cache all location picker data
  // Unified, role-agnostic fetch: build a union of location IDs from every
  // source the user has access to (direct assignments, org membership,
  // brand membership, super_admin). One single SELECT renders them all,
  // grouped naturally by brand → org → location. No more branchy "first org
  // wins" or "admin sees every org in the system" bugs.
  const { data: pickerData, isLoading: loading } = useQuery({
    queryKey: ['location-picker-data', user?.id, role, allLocationsEnabled],
    queryFn: async () => {
      if (!user?.id) return { organizations: [], locations: [], brands: [] };

      // 1. Gather all location IDs the user can see
      const locationIdSet = new Set<string>();
      const orgIdSet = new Set<string>();
      const brandIdSet = new Set<string>();

      // (a) Direct user_locations assignments — applies to everyone
      //     Read brand_id from the location row directly (with org chain fallback)
      const userLocsPromise = supabase
        .from('user_locations')
        .select('location_id, locations(brand_id, organization_id, organizations(brand_id))')
        .eq('user_id', user.id);


      // (b) Organization memberships
      //   - all_locations_enabled OR org-level role → every location in those orgs
      //   - otherwise the membership is informational only (location list stays
      //     restricted to user_locations)
      const orgMemsPromise = supabase
        .from('organization_members')
        .select('organization_id, org_role')
        .eq('user_id', user.id);

      // (c) Brand-level memberships → every location under those brands
      const brandMemsPromise = supabase
        .from('brand_members')
        .select('brand_id')
        .eq('user_id', user.id);

      const [userLocsRes, orgMemsRes, brandMemsRes] = await Promise.all([
        userLocsPromise,
        orgMemsPromise,
        brandMemsPromise,
      ]);

      (userLocsRes.data || []).forEach((ul: any) => {
        if (ul.location_id) locationIdSet.add(ul.location_id);
      });

      const orgMems = orgMemsRes.data || [];
      const orgGrantsAll = (m: any) =>
        allLocationsEnabled || m.org_role === 'admin' || isOrgLevel;
      orgMems.forEach((m: any) => {
        if (orgGrantsAll(m)) orgIdSet.add(m.organization_id);
      });

      (brandMemsRes.data || []).forEach((m: any) => {
        if (m.brand_id) brandIdSet.add(m.brand_id);
      });

      // 2. Expand org access → location IDs
      if (orgIdSet.size > 0) {
        const { data } = await supabase
          .from('locations')
          .select('id')
          .in('organization_id', [...orgIdSet]);
        (data || []).forEach((l: any) => locationIdSet.add(l.id));
      }

      // 3. Expand brand access → org IDs → location IDs
      if (brandIdSet.size > 0) {
        const { data: brandOrgs } = await supabase
          .from('organizations')
          .select('id')
          .in('brand_id', [...brandIdSet]);
        const brandOrgIds = (brandOrgs || []).map((o: any) => o.id);
        if (brandOrgIds.length > 0) {
          brandOrgIds.forEach(id => orgIdSet.add(id));
          const { data } = await supabase
            .from('locations')
            .select('id')
            .in('organization_id', brandOrgIds);
          (data || []).forEach((l: any) => locationIdSet.add(l.id));
        }
      }

      // 4. Super admin: bypass everything, see all locations / orgs / brands
      let brandsList: BrandInfo[] = [];
      if (isSuperAdmin) {
        const [allLocsRes, allBrandsRes] = await Promise.all([
          supabase.from('locations').select('id'),
          supabase.from('brands').select('id, name, logo_url').eq('is_active', true).order('name'),
        ]);
        (allLocsRes.data || []).forEach((l: any) => locationIdSet.add(l.id));
        brandsList = (allBrandsRes.data || []) as BrandInfo[];
      }

      const locationIds = [...locationIdSet];
      if (locationIds.length === 0) {
        return { organizations: [], locations: [], brands: brandsList };
      }

      // 5. One final fetch with full hierarchy for rendering
      //    Select locations.brand_id scalar directly; brand row still hydrated via org chain
      const { data: fullLocs } = await supabase
        .from('locations')
        .select('*, organizations(id, name, brand_name, logo_url, brand_id, brands(id, name, logo_url))')
        .in('id', locationIds)
        .neq('is_active', false)
        .order('name');

      const locs: Location[] = (fullLocs || []).map((loc: any) => ({
        ...loc,
        org_name: loc.organizations?.brand_name || loc.organizations?.brands?.name || loc.organizations?.name,
        org_raw_name: loc.organizations?.name,
      }));

      // 6. Derive orgs + brands from the loaded locations (deduped)
      const orgMap = new Map<string, Organization>();
      const brandMap = new Map<string, BrandInfo>();
      (fullLocs || []).forEach((loc: any) => {
        const o = loc.organizations;
        if (o && !orgMap.has(o.id)) {
          orgMap.set(o.id, {
            id: o.id,
            name: o.name,
            brand_name: o.brand_name || o.brands?.name || null,
            logo_url: o.logo_url || o.brands?.logo_url || null,
            // Prefer locations.brand_id, fall back to org.brand_id
            brand_id: loc.brand_id || o.brand_id || null,
          });
        }
        const b = o?.brands;
        if (b && !brandMap.has(b.id)) {
          brandMap.set(b.id, { id: b.id, name: b.name, logo_url: b.logo_url });
        }
      });



      // Merge super_admin's full brand catalog on top of derived brands
      brandsList.forEach(b => { if (!brandMap.has(b.id)) brandMap.set(b.id, b); });

      return {
        organizations: [...orgMap.values()].sort((a, b) => a.name.localeCompare(b.name)),
        locations: locs,
        brands: [...brandMap.values()].sort((a, b) => a.name.localeCompare(b.name)),
      };
    },
    enabled: !!user?.id && !!role,
    staleTime: 10 * 60 * 1000,
    placeholderData: (prev) => prev,
  });

  const organizations = pickerData?.organizations || [];
  const locations = pickerData?.locations || [];
  const brands = pickerData?.brands || [];

  // Build tabs from available data

  const tabs = useMemo(() => {
    const t: { id: string; label: string; icon?: 'clock' | 'building' }[] = [];

    // If brands exist (super_admin), use brands as tabs
    if (brands.length > 0) {
      brands.forEach(b => t.push({ id: `brand:${b.id}`, label: b.name }));
      // Add "Other" if there are unbranded orgs
      const brandedOrgIds = new Set(organizations.filter(o => o.brand_id).map(o => o.id));
      const unbrandedLocs = locations.filter(l => !l.organization_id || !brandedOrgIds.has(l.organization_id));
      if (unbrandedLocs.length > 0) t.push({ id: '__other__', label: 'Other' });
    } else if (organizations.length > 1) {
      // Multiple orgs, use org tabs
      organizations.forEach(o => t.push({ id: `org:${o.id}`, label: o.brand_name || o.name }));
    }
    // If only 1 org or no orgs, no tabs needed (just show flat list)
    return t;
  }, [brands, organizations, locations]);

  // Brand tabs only (for the brand-header UI)
  const brandTabs = useMemo(() => tabs.filter(t => t.id.startsWith('brand:') || t.id === '__other__'), [tabs]);
  const useBrandHeader = brandTabs.length > 1;

  // Set default active tab when data loads — prefer last-used brand from localStorage
  useEffect(() => {
    if (tabs.length === 0 || activeTab) return;
    let initial = tabs[0].id;
    if (useBrandHeader) {
      try {
        const stored = localStorage.getItem(LAST_BRAND_KEY);
        if (stored && brandTabs.some(t => t.id === stored)) initial = stored;
      } catch { /* ignore */ }
    }
    setActiveTab(initial);
  }, [tabs, brandTabs, useBrandHeader, activeTab]);

  // Reset search + decide initial view when dialog opens
  useEffect(() => {
    if (open) {
      setSearch('');
      // If multi-brand and no remembered brand, show the brand picker first.
      // Otherwise jump straight to locations.
      if (useBrandHeader) {
        try {
          const stored = localStorage.getItem(LAST_BRAND_KEY);
          setView(stored && brandTabs.some(t => t.id === stored) ? 'locations' : 'brands');
        } catch {
          setView('brands');
        }
      } else {
        setView('locations');
      }
      // Focus search on desktop
      if (!isMobile) {
        setTimeout(() => searchRef.current?.focus(), 100);
      }
    }
  }, [open, isMobile, useBrandHeader, brandTabs]);

  const selectBrandTab = (id: string) => {
    setActiveTab(id);
    setSearch('');
    setView('locations');
    try { localStorage.setItem(LAST_BRAND_KEY, id); } catch { /* ignore */ }
  };

  const cycleBrand = (dir: 1 | -1) => {
    if (!useBrandHeader) return;
    const idx = brandTabs.findIndex(t => t.id === activeTab);
    if (idx < 0) return;
    const next = brandTabs[(idx + dir + brandTabs.length) % brandTabs.length];
    selectBrandTab(next.id);
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
  };
  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current === null) return;
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    touchStartX.current = null;
    if (Math.abs(dx) < 50) return;
    cycleBrand(dx < 0 ? 1 : -1);
  };

  // Get the active brand id for Brand Dash link
  const activeBrandId = activeTab.startsWith('brand:') ? activeTab.replace('brand:', '') : null;

  // Filter locations based on active tab + search, grouped by org
  const filteredLocations = useMemo(() => {
    let locs = locations;

    // Tab filtering
    if (activeTab.startsWith('brand:')) {
      const brandId = activeTab.replace('brand:', '');
      const brandOrgIds = new Set(organizations.filter(o => o.brand_id === brandId).map(o => o.id));
      locs = locations.filter(l => l.organization_id && brandOrgIds.has(l.organization_id));
    } else if (activeTab.startsWith('org:')) {
      const orgId = activeTab.replace('org:', '');
      locs = locations.filter(l => l.organization_id === orgId);
    } else if (activeTab === '__other__') {
      const brandedOrgIds = new Set(organizations.filter(o => o.brand_id).map(o => o.id));
      locs = locations.filter(l => !l.organization_id || !brandedOrgIds.has(l.organization_id));
    }

    // Search filtering within tab — matches name, store #, or org name
    if (search.trim()) {
      const q = search.toLowerCase();
      locs = locs.filter(l => 
        l.name.toLowerCase().includes(q) || 
        (l.store_number && l.store_number.toLowerCase().includes(q)) ||
        (l.org_name && l.org_name.toLowerCase().includes(q)) ||
        (l.org_raw_name && l.org_raw_name.toLowerCase().includes(q))
      );
    }

    return locs;
  }, [locations, organizations, activeTab, search]);

  // Group locations by org when inside a brand tab with multiple orgs
  const groupedByOrg = useMemo(() => {
    if (!activeTab.startsWith('brand:') || search.trim()) return null;
    const orgMap = new Map<string, { orgName: string; orgId: string; locs: Location[] }>();
    for (const loc of filteredLocations) {
      const orgId = loc.organization_id || '__none__';
      if (!orgMap.has(orgId)) {
        const org = organizations.find(o => o.id === orgId);
        orgMap.set(orgId, { orgName: org?.name || 'Other', orgId, locs: [] });
      }
      orgMap.get(orgId)!.locs.push(loc);
    }
    if (orgMap.size === 0) return null;
    return Array.from(orgMap.values());
  }, [filteredLocations, organizations, activeTab, search]);

  const handleSelectLocation = (location: Location) => {
    onSelectLocation({
      id: location.id,
      name: location.name,
      location_type: location.location_type,
      store_number: location.store_number,
      organization_id: location.organization_id ?? null,
    });
    onOpenChange(false);
  };


  const handleSetDefault = async (e: React.MouseEvent, locationId: string) => {
    e.stopPropagation();
    if (!user) return;
    
    const newDefault = effectiveDefaultId === locationId ? null : locationId;
    
    const { error } = await supabase
      .from('profiles')
      .update({ default_location_id: newDefault })
      .eq('id', user.id);

    if (error) {
      toast.error('Failed to update default location');
      return;
    }

    setDefaultLocationId(newDefault);
    queryClient.setQueryData(['location-picker-profile', user.id], (old: any) => ({
      ...old,
      default_location_id: newDefault,
    }));
    toast.success(newDefault ? 'Default location set' : 'Default location cleared');
  };

  const hasTabs = tabs.length > 1;

  const renderLocationRow = (loc: Location) => (
    <button
      key={loc.id}
      onClick={() => handleSelectLocation(loc)}
      className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg transition-all text-left ${
        loc.id === currentLocationId
          ? 'bg-primary/10 ring-2 ring-primary'
          : 'hover:bg-muted/50'
      }`}
    >
      <button
        onClick={(e) => handleSetDefault(e, loc.id)}
        className="p-0.5 hover:scale-110 transition-transform"
        title={effectiveDefaultId === loc.id ? 'Remove as default' : 'Set as default'}
      >
        <Star 
          className={`h-3.5 w-3.5 flex-shrink-0 ${
            effectiveDefaultId === loc.id 
              ? 'fill-yellow-400 text-yellow-400' 
              : 'text-muted-foreground hover:text-yellow-400'
          }`} 
        />
      </button>
      <div className="flex-1 min-w-0">
        <div className={`text-sm flex items-center gap-1.5 ${loc.id === currentLocationId ? 'font-semibold text-foreground' : 'text-muted-foreground'}`}>
          <span className="truncate">{formatLocationName(loc.name, loc.store_number)}</span>
          
        </div>
        {loc.location_type === 'checklist_only' && (
          <div className="text-[10px] text-muted-foreground">Checklist Only</div>
        )}
      </div>
      <ChevronRight className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
    </button>
  );

  const content = (
    <>
      {loading && !pickerData ? (
        <div className="space-y-4 p-4">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : view === 'brands' && useBrandHeader ? (
        <div className="p-3 space-y-2">
          <div className="px-1 pb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Choose a brand
          </div>
          {brandTabs.map(tab => {
            const brand = tab.id.startsWith('brand:')
              ? brands.find(b => `brand:${b.id}` === tab.id)
              : null;
            const isActive = tab.id === activeTab;
            return (
              <div
                key={tab.id}
                className={`w-full flex items-center rounded-xl border transition-all ${
                  isActive
                    ? 'border-primary bg-primary/10'
                    : 'border-border hover:bg-muted/50'
                }`}
              >
                <button
                  onClick={() => selectBrandTab(tab.id)}
                  className="flex-1 flex items-center gap-3 px-3 py-3 text-left min-w-0"
                >
                  {brand?.logo_url ? (
                    <img src={brand.logo_url} alt="" className="h-9 w-9 rounded-lg object-contain bg-background" />
                  ) : (
                    <div className="h-9 w-9 rounded-lg bg-muted flex items-center justify-center">
                      <Building2 className="h-4 w-4 text-muted-foreground" />
                    </div>
                  )}
                  <span className="flex-1 text-sm font-medium text-foreground truncate">{tab.label}</span>
                </button>
                {brand && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      navigate(`/org-dash?brand=${brand.id}`);
                      onOpenChange(false);
                    }}
                    className="h-9 w-9 mr-1 flex items-center justify-center rounded-lg text-primary hover:bg-primary/15 transition-colors flex-shrink-0"
                    aria-label={`${brand.name} Dashboard`}
                    title="Brand Dashboard"
                  >
                    <BarChart3 className="h-4 w-4" />
                  </button>
                )}
                <ChevronRight className="h-4 w-4 text-muted-foreground mr-3 flex-shrink-0" />
              </div>
            );
          })}
        </div>
      ) : (
        <div className="p-3 space-y-3">
          {/* Brand header (swipeable) — replaces the cramped tab strip */}
          {useBrandHeader && (() => {
            const brand = activeBrandId ? brands.find(b => b.id === activeBrandId) : null;
            const currentTab = brandTabs.find(t => t.id === activeTab);
            return (
              <div
                className="flex items-center gap-1"
                onTouchStart={handleTouchStart}
                onTouchEnd={handleTouchEnd}
              >
                <button
                  onClick={() => cycleBrand(-1)}
                  className="h-10 w-8 flex items-center justify-center rounded-lg text-muted-foreground hover:bg-muted/50 transition-colors"
                  aria-label="Previous brand"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <button
                  onClick={() => setView('brands')}
                  className="flex-1 flex items-center justify-center gap-2 h-10 rounded-lg bg-primary/10 hover:bg-primary/15 transition-colors px-3"
                >
                  {brand?.logo_url && (
                    <img src={brand.logo_url} alt="" className="h-5 w-5 rounded object-contain" />
                  )}
                  <span className="text-sm font-semibold text-foreground truncate">
                    {currentTab?.label || 'Select brand'}
                  </span>
                  <ChevronDown className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                </button>
                <button
                  onClick={() => cycleBrand(1)}
                  className="h-10 w-8 flex items-center justify-center rounded-lg text-muted-foreground hover:bg-muted/50 transition-colors"
                  aria-label="Next brand"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            );
          })()}

          {/* Org tabs (only when there are no brand tabs but multiple orgs) */}
          {!useBrandHeader && hasTabs && (
            <div className="flex bg-muted/50 rounded-lg p-1 gap-0.5 overflow-x-auto">
              {tabs.map(tab => (
                <button
                  key={tab.id}
                  onClick={() => { setActiveTab(tab.id); setSearch(''); }}
                  className={`flex-1 min-w-0 text-xs font-medium text-center py-1.5 rounded-md transition-all flex items-center justify-center gap-1 whitespace-nowrap px-2 ${
                    activeTab === tab.id
                      ? 'bg-primary text-primary-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <span className="truncate">{tab.label}</span>
                </button>
              ))}
            </div>
          )}

          {/* Search */}
          <div className="flex items-center gap-1.5 px-2 py-1 border-b border-border/60 focus-within:border-primary/40 transition-colors">
            <Search className="h-3.5 w-3.5 text-muted-foreground/60 flex-shrink-0" />
            <input
              ref={searchRef}
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search..."
              className="bg-transparent text-xs text-foreground placeholder:text-muted-foreground/50 outline-none w-full"
            />
          </div>


          {/* Org Dashboard link for org_admins (single org, no brand tabs) */}
          {hasMultiLocationAccess && !isSuperAdmin && organizations.length === 1 && !activeBrandId && (() => {
            const org = organizations[0];
            return (
              <button
                onClick={() => {
                  navigate(`/org-dash?org=${org.id}`);
                  onOpenChange(false);
                }}
                className="w-full flex items-center justify-center gap-2 text-xs font-medium text-primary bg-primary/10 hover:bg-primary/15 rounded-lg py-2 transition-colors"
              >
                {org.logo_url && (
                  <img src={org.logo_url} alt="" className="h-4 w-4 rounded object-contain" />
                )}
                <Building2 className="h-3.5 w-3.5" />
                {org.brand_name || org.name} Dashboard
              </button>
            );
          })()}

          {/* Location list */}
          <div className="space-y-1 max-h-[50vh] overflow-y-auto p-0.5 -m-0.5">
            {filteredLocations.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">
                {activeTab === '__recents__' && !search ? 'No recent locations yet' : 'No locations found'}
              </p>
            ) : groupedByOrg ? (
              // Grouped by org within a brand
              groupedByOrg.map(group => (
                <div key={group.orgId} className="mb-2">
                  <button
                    onClick={() => {
                      navigate(`/org-dash?org=${group.orgId}`);
                      onOpenChange(false);
                    }}
                    className="flex items-center gap-1.5 px-2 py-1.5 rounded-md hover:bg-muted/50 transition-colors group/org"
                  >
                    <Building2 className="h-3 w-3 text-muted-foreground" />
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground group-hover/org:text-primary transition-colors">{group.orgName}</span>
                    <ChevronRight className="h-2.5 w-2.5 text-muted-foreground/0 group-hover/org:text-primary/60 transition-colors" />
                  </button>
                  {group.locs.map(loc => renderLocationRow(loc))}
                </div>
              ))
            ) : (
              filteredLocations.map(loc => renderLocationRow(loc))
            )}
          </div>
        </div>
      )}
    </>
  );

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent className="max-h-[85vh]">
          <DrawerHeader className="text-left pb-0">
            <DrawerTitle className="flex items-center gap-2">
              <MapPin className="h-5 w-5" />
              Select Location
            </DrawerTitle>
          </DrawerHeader>
          <div className="overflow-y-auto pb-8">
            {content}
          </div>
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[80vh] overflow-hidden p-0">
        <DialogHeader className="p-4 pb-0">
          <DialogTitle className="flex items-center gap-2">
            <MapPin className="h-5 w-5" />
            Select Location
          </DialogTitle>
        </DialogHeader>
        {content}
      </DialogContent>
    </Dialog>
  );
}
