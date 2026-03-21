import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { Button } from '@/components/ui/button';
import { Building2, MapPin, ChevronRight, Star, ExternalLink, Layers } from 'lucide-react';
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
  store_number?: string | null;
}

interface LocationPickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectLocation: (location: { id: string; name: string; location_type: string; store_number?: string | null }) => void;
  currentLocationId?: string;
}

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
  
  const hasMultiLocationAccess = role === 'super_admin' || role === 'brand_admin' || role === 'org_admin';
  const isSuperAdmin = role === 'super_admin';
  const canSeeAllOrgs = role === 'admin' || role === 'super_admin';
  const isOrgLevel = role === 'manager' || role === 'org_admin';

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
    staleTime: 5 * 60 * 1000, // 5 min cache
  });

  const [defaultLocationId, setDefaultLocationId] = useState<string | null>(null);
  const allLocationsEnabled = profileData?.all_locations_enabled || false;

  // Sync default location from cache
  const effectiveDefaultId = defaultLocationId ?? profileData?.default_location_id ?? null;

  // Cache all location picker data — survives dialog close/open
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
          }))
        );
      }

      return { organizations: orgs, locations: locs, brands: brandsList };
    },
    enabled: !!user?.id && !!role,
    staleTime: 10 * 60 * 1000, // 10 min cache — locations rarely change
    placeholderData: (prev) => prev, // Show previous data instantly
  });

  const organizations = pickerData?.organizations || [];
  const locations = pickerData?.locations || [];
  const brands = pickerData?.brands || [];

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

  // Group locations by organization
  const locationsByOrg = locations.reduce((acc, loc) => {
    const orgId = loc.organization_id || 'unassigned';
    if (!acc[orgId]) acc[orgId] = [];
    acc[orgId].push(loc);
    return acc;
  }, {} as Record<string, Location[]>);

  // Group organizations by brand for super_admin
  const orgsByBrand = useMemo(() => {
    if (!isSuperAdmin || brands.length === 0) return null;
    
    const grouped = new Map<string, Organization[]>();
    const ungrouped: Organization[] = [];
    
    for (const org of organizations) {
      if (org.brand_id) {
        const existing = grouped.get(org.brand_id) || [];
        existing.push(org);
        grouped.set(org.brand_id, existing);
      } else {
        ungrouped.push(org);
      }
    }
    
    if (grouped.size === 0) return null;
    
    return { grouped, ungrouped };
  }, [isSuperAdmin, brands, organizations]);

  const renderLocationItem = (location: Location) => (
    <Button
      key={location.id}
      variant={location.id === currentLocationId ? 'secondary' : 'ghost'}
      className="w-full justify-between h-auto py-2 px-2"
      onClick={() => handleSelectLocation(location)}
    >
      <div className="flex items-center gap-2">
        <button
          onClick={(e) => handleSetDefault(e, location.id)}
          className="p-0.5 hover:scale-110 transition-transform"
          title={effectiveDefaultId === location.id ? 'Remove as default' : 'Set as default'}
        >
          <Star 
            className={`h-3.5 w-3.5 ${
              effectiveDefaultId === location.id 
                ? 'fill-yellow-400 text-yellow-400' 
                : 'text-muted-foreground hover:text-yellow-400'
            }`} 
          />
        </button>
        <div className="text-left">
          <div className="text-sm font-medium">{formatLocationName(location.name, location.store_number)}</div>
          {location.location_type === 'checklist_only' && (
            <div className="text-xs text-muted-foreground">Checklist Only</div>
          )}
        </div>
      </div>
      <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
    </Button>
  );

  const renderOrgSection = (org: Organization, indent = true) => (
    <div key={org.id} className="space-y-1">
      <button
        className={`flex items-center gap-2 text-xs font-medium px-1 w-full text-left group ${
          hasMultiLocationAccess 
            ? 'hover:bg-muted/50 rounded-md py-1 -my-1 cursor-pointer transition-colors' 
            : 'text-muted-foreground cursor-default'
        }`}
        onClick={() => {
          if (hasMultiLocationAccess) {
            onOpenChange(false);
            navigate(`/org-dash?org=${org.id}`);
          }
        }}
        disabled={!hasMultiLocationAccess}
      >
        {org.logo_url ? (
          <img src={org.logo_url} alt="" className="h-4 w-4 object-contain rounded" />
        ) : (
          <Building2 className="h-3 w-3" />
        )}
        {org.brand_name && !orgsByBrand ? (
          <span className="flex-1">
            <span className="text-foreground font-semibold">{org.brand_name}</span>
            <span className="text-muted-foreground"> — {org.name}</span>
          </span>
        ) : (
          <span className="flex-1 text-muted-foreground">{org.name}</span>
        )}
        {hasMultiLocationAccess && (
          <ExternalLink className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
        )}
      </button>
      <div className={`space-y-0.5 ${indent ? 'pl-5' : 'pl-5'}`}>
        {locationsByOrg[org.id]?.map(renderLocationItem)}
      </div>
    </div>
  );

  const content = (
    <>
      {loading && !pickerData ? (
        <div className="space-y-4 p-4">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : (
        <div className="space-y-4 p-4">
          {/* Brand-grouped layout for super_admin */}
          {orgsByBrand ? (
            <>
              {brands
                .filter(brand => orgsByBrand.grouped.has(brand.id))
                .map(brand => {
                  const brandOrgs = orgsByBrand.grouped.get(brand.id) || [];
                  return (
                    <div key={brand.id} className="space-y-2">
                      <button
                        className="flex items-center gap-2 text-xs font-bold px-1 w-full text-left group hover:bg-muted/50 rounded-md py-1.5 -my-1 cursor-pointer transition-colors"
                        onClick={() => {
                          onOpenChange(false);
                          navigate(`/org-dash?brand=${brand.id}`);
                        }}
                      >
                        {brand.logo_url ? (
                          <img src={brand.logo_url} alt="" className="h-5 w-5 object-contain rounded" />
                        ) : (
                          <Layers className="h-4 w-4 text-primary" />
                        )}
                        <span className="flex-1 text-foreground uppercase tracking-wide">{brand.name}</span>
                        <span className="text-[10px] text-muted-foreground font-normal opacity-0 group-hover:opacity-100 transition-opacity">
                          Brand Dash
                        </span>
                        <ExternalLink className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                      </button>
                      <div className="pl-3 space-y-3 border-l-2 border-primary/20 ml-2">
                        {brandOrgs.map(org => renderOrgSection(org))}
                      </div>
                    </div>
                  );
                })}
              {orgsByBrand.ungrouped.map(org => renderOrgSection(org))}
            </>
          ) : organizations.length > 0 ? (
            organizations.map(org => renderOrgSection(org))
          ) : (
            <div className="space-y-0.5">
              {locations.map(renderLocationItem)}
            </div>
          )}

          {locationsByOrg['unassigned']?.length > 0 && organizations.length > 0 && (
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground px-1">
                <MapPin className="h-3 w-3" />
                Other Locations
              </div>
              <div className="space-y-0.5 pl-5">
                {locationsByOrg['unassigned'].map(renderLocationItem)}
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent className="max-h-[85vh]">
          <DrawerHeader className="text-left">
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
      <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
        <DialogHeader>
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
