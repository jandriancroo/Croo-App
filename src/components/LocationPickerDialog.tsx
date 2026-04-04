import { useState, useMemo, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { Building2, MapPin, ChevronRight, Star, Search } from 'lucide-react';
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
}

interface LocationPickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectLocation: (location: { id: string; name: string; location_type: string; store_number?: string | null }) => void;
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
  const canSeeAllOrgs = role === 'admin' || role === 'super_admin';
  const isOrgLevel = role === 'manager' || role === 'org_admin';

  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState<string>('');

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
  const { data: pickerData, isLoading: loading } = useQuery({
    queryKey: ['location-picker-data', user?.id, role, allLocationsEnabled],
    queryFn: async () => {
      const orgs: Organization[] = [];
      const locs: Location[] = [];
      let brandsList: BrandInfo[] = [];

      if (canSeeAllOrgs) {
        const [orgsResult, locsResult, brandsResult] = await Promise.all([
          supabase.from('organizations').select('id, name, brand_name, logo_url, brand_id, brands(name, logo_url)').eq('is_active', true).order('name'),
          supabase.from('locations').select('*, organizations(name, brand_name, brands(name))').order('name'),
          isSuperAdmin 
            ? supabase.from('brands').select('id, name, logo_url').eq('is_active', true).order('name')
            : Promise.resolve({ data: [] }),
        ]);

        const mappedOrgs = (orgsResult.data || []).map((org: any) => {
          const brand = org.brands;
          return {
            ...org,
            brand_name: org.brand_name || brand?.name || null,
            logo_url: org.logo_url || brand?.logo_url || null,
            brand_id: org.brand_id || null,
          };
        });
        orgs.push(...mappedOrgs);
        brandsList = (brandsResult.data || []) as BrandInfo[];
        locs.push(
          ...(locsResult.data || []).map((loc: any) => ({
            ...loc,
            org_name: loc.organizations?.brand_name || loc.organizations?.brands?.name || loc.organizations?.name,
            org_raw_name: loc.organizations?.name,
          }))
        );
      } else if (isOrgLevel) {
        const { data: orgMemberships } = await supabase
          .from('organization_members')
          .select('organization_id, organizations(id, name, brand_name, logo_url, brand_id, brands(name, logo_url))')
          .eq('user_id', user!.id)
          .eq('org_role', 'admin');

        const orgIds = orgMemberships?.map((m: any) => m.organization_id) || [];
        const mappedOrgs = orgMemberships?.map((m: any) => {
          const org = m.organizations;
          if (org) {
            return { 
              ...org, 
              brand_name: org.brand_name || org.brands?.name || null,
              logo_url: org.logo_url || org.brands?.logo_url || null,
              brand_id: org.brand_id || null,
            };
          }
          return null;
        }).filter(Boolean) || [];
        orgs.push(...mappedOrgs);

        if (orgIds.length > 0) {
          const { data: orgLocs } = await supabase
            .from('locations')
            .select('*, organizations(name, brand_name, brands(name))')
            .in('organization_id', orgIds)
            .order('name');
          locs.push(
            ...(orgLocs || []).map((loc: any) => ({
              ...loc,
              org_name: loc.organizations?.brand_name || loc.organizations?.brands?.name || loc.organizations?.name,
              org_raw_name: loc.organizations?.name,
            }))
          );
        }
      } else if (allLocationsEnabled) {
        const { data: userLocs } = await supabase
          .from('user_locations')
          .select('locations(organization_id, organizations(id, name, brand_name, logo_url, brand_id, brands(name, logo_url)))')
          .eq('user_id', user!.id)
          .limit(1);

        const rawOrgData = userLocs?.[0]?.locations?.organizations;
        const orgId = userLocs?.[0]?.locations?.organization_id;

        if (orgId && rawOrgData) {
          const orgData = { 
            ...rawOrgData, 
            brand_name: rawOrgData.brand_name || rawOrgData.brands?.name || null,
            logo_url: rawOrgData.logo_url || rawOrgData.brands?.logo_url || null,
            brand_id: (rawOrgData as any).brand_id || null,
          };
          orgs.push(orgData as Organization);
          
          const { data: orgLocs } = await supabase
            .from('locations')
            .select('*, organizations(name, brand_name, brands(name))')
            .eq('organization_id', orgId)
            .order('name');
          locs.push(
            ...(orgLocs || []).map((loc: any) => ({
              ...loc,
              org_name: loc.organizations?.brand_name || loc.organizations?.brands?.name || loc.organizations?.name,
              org_raw_name: loc.organizations?.name,
            }))
          );
        }
      } else {
        const { data: userLocs } = await supabase
          .from('user_locations')
          .select('location_id, locations(*, organizations(name, brand_name, brands(name)))')
          .eq('user_id', user!.id);

        const mappedLocs = userLocs?.map((ul: any) => ul.locations).filter(Boolean) || [];
        const orgIds = [...new Set(mappedLocs.map((l: any) => l.organization_id).filter(Boolean))];
        
        if (orgIds.length > 0) {
          const { data: orgsData } = await supabase
            .from('organizations')
            .select('id, name, brand_name, logo_url, brand_id, brands(name, logo_url)')
            .in('id', orgIds);
          const mappedOrgs = (orgsData || []).map((org: any) => ({
            ...org,
            brand_name: org.brand_name || org.brands?.name || null,
            logo_url: org.logo_url || org.brands?.logo_url || null,
            brand_id: org.brand_id || null,
          }));
          orgs.push(...mappedOrgs);
        }

        locs.push(
          ...mappedLocs.map((loc: any) => ({
            ...loc,
            org_name: loc.organizations?.brand_name || loc.organizations?.brands?.name || loc.organizations?.name,
            org_raw_name: loc.organizations?.name,
          }))
        );
      }

      return { organizations: orgs, locations: locs, brands: brandsList };
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

  // Set default active tab when data loads
  useEffect(() => {
    if (tabs.length > 0 && !activeTab) {
      setActiveTab(tabs[0].id);
    }
  }, [tabs]);

  // Reset search when dialog opens
  useEffect(() => {
    if (open) {
      setSearch('');
      // Focus search on desktop
      if (!isMobile) {
        setTimeout(() => searchRef.current?.focus(), 100);
      }
    }
  }, [open, isMobile]);

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
        <div className={`text-sm ${loc.id === currentLocationId ? 'font-semibold text-foreground' : 'text-muted-foreground'}`}>
          {formatLocationName(loc.name, loc.store_number)}
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
      ) : (
        <div className="p-3 space-y-3">
          {/* Brand / Org tabs */}
          {hasTabs && (
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
          <div className="flex items-center gap-2 bg-muted/50 rounded-lg px-3 py-2 focus-within:ring-2 focus-within:ring-primary/30 transition-all">
            <Search className="h-4 w-4 text-muted-foreground flex-shrink-0" />
            <input
              ref={searchRef}
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search by name, store #, or org..."
              className="bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none w-full"
            />
          </div>

          {/* Brand Dash link for super admins */}
          {isSuperAdmin && activeBrandId && (() => {
            const brand = brands.find(b => b.id === activeBrandId);
            return (
              <button
                onClick={() => {
                  navigate(`/org-dash?brand=${activeBrandId}`);
                  onOpenChange(false);
                }}
                className="w-full flex items-center justify-center gap-2 text-xs font-medium text-primary bg-primary/10 hover:bg-primary/15 rounded-lg py-2 transition-colors"
              >
                {brand?.logo_url && (
                  <img src={brand.logo_url} alt="" className="h-4 w-4 rounded object-contain" />
                )}
                {brand?.name ? `${brand.name} Dashboard` : 'Dashboard'}
              </button>
            );
          })()}

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
