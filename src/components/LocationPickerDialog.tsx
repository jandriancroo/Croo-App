import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { Button } from '@/components/ui/button';
import { Building2, MapPin, ChevronRight, Star, ExternalLink } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useUserRole } from '@/hooks/useUserRole';
import { useAuth } from '@/lib/auth';
import { Skeleton } from '@/components/ui/skeleton';
import { useIsMobile } from '@/hooks/use-mobile';
import { toast } from 'sonner';
import { formatLocationName } from '@/utils/locationUtils';

interface Organization {
  id: string;
  name: string;
  brand_name: string | null;
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
  
  // Check if user has multi-location access
  const hasMultiLocationAccess = role === 'super_admin' || role === 'brand_admin' || role === 'org_admin';
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [loading, setLoading] = useState(true);
  const [defaultLocationId, setDefaultLocationId] = useState<string | null>(null);
  const [allLocationsEnabled, setAllLocationsEnabled] = useState(false);

  // Fetch user's default location and all_locations_enabled flag
  useEffect(() => {
    if (user) {
      supabase
        .from('profiles')
        .select('default_location_id, all_locations_enabled')
        .eq('id', user.id)
        .single()
        .then(({ data }) => {
          setDefaultLocationId(data?.default_location_id || null);
          setAllLocationsEnabled(data?.all_locations_enabled || false);
        });
    }
  }, [user]);

  // For now, admins can see all orgs/locations they have access to
  const canSeeAllOrgs = role === 'admin' || role === 'super_admin';
  const isOrgLevel = role === 'manager' || role === 'org_admin';

  useEffect(() => {
    if (open && user) {
      fetchData();
    }
  }, [open, user, role]);

  const fetchData = async () => {
    setLoading(true);
    try {
      if (canSeeAllOrgs) {
        // Super admin: see all orgs and all locations
        const [orgsResult, locsResult] = await Promise.all([
          supabase.from('organizations').select('id, name, brand_name, logo_url, brands(name, logo_url)').eq('is_active', true).order('name'),
          supabase.from('locations').select('*, organizations(name, brand_name, brands(name))').order('name'),
        ]);

        // Map organizations to include brand name/logo fallback
        const orgs = (orgsResult.data || []).map((org: any) => ({
          ...org,
          brand_name: org.brand_name || org.brands?.name || null,
          logo_url: org.logo_url || org.brands?.logo_url || null,
        }));
        setOrganizations(orgs as Organization[]);
        setLocations(
          (locsResult.data || []).map((loc: any) => ({
            ...loc,
            org_name: loc.organizations?.brand_name || loc.organizations?.brands?.name || loc.organizations?.name,
          }))
        );
      } else if (isOrgLevel) {
        // Org admin: see their org's locations
        const { data: orgMemberships } = await supabase
          .from('organization_members')
          .select('organization_id, organizations(id, name, brand_name, logo_url, brands(name, logo_url))')
          .eq('user_id', user!.id)
          .eq('org_role', 'admin');

        const orgIds = orgMemberships?.map((m: any) => m.organization_id) || [];
        const orgs = orgMemberships?.map((m: any) => {
          const org = m.organizations;
          if (org) {
            return { 
              ...org, 
              brand_name: org.brand_name || org.brands?.name || null,
              logo_url: org.logo_url || org.brands?.logo_url || null 
            };
          }
          return null;
        }).filter(Boolean) || [];

        setOrganizations(orgs);

        if (orgIds.length > 0) {
          const { data: locs } = await supabase
            .from('locations')
            .select('*, organizations(name, brand_name, brands(name))')
            .in('organization_id', orgIds)
            .order('name');

          setLocations(
            (locs || []).map((loc: any) => ({
              ...loc,
              org_name: loc.organizations?.brand_name || loc.organizations?.brands?.name || loc.organizations?.name,
            }))
          );
        }
      } else if (allLocationsEnabled) {
        // User has all_locations_enabled - get all locations in their org
        const { data: userLocs } = await supabase
          .from('user_locations')
          .select('locations(organization_id, organizations(id, name, brand_name, logo_url, brands(name, logo_url)))')
          .eq('user_id', user!.id)
          .limit(1);

        const rawOrgData = userLocs?.[0]?.locations?.organizations;
        const orgId = userLocs?.[0]?.locations?.organization_id;

        if (orgId && rawOrgData) {
          const orgData = { 
            ...rawOrgData, 
            brand_name: rawOrgData.brand_name || rawOrgData.brands?.name || null,
            logo_url: rawOrgData.logo_url || rawOrgData.brands?.logo_url || null 
          };
          setOrganizations([orgData as Organization]);
          
          const { data: orgLocs } = await supabase
            .from('locations')
            .select('*, organizations(name, brand_name, brands(name))')
            .eq('organization_id', orgId)
            .order('name');

          setLocations(
            (orgLocs || []).map((loc: any) => ({
              ...loc,
              org_name: loc.organizations?.brand_name || loc.organizations?.brands?.name || loc.organizations?.name,
            }))
          );
        }
      } else {
        // Regular admin/user: see their assigned locations
        const { data: userLocs } = await supabase
          .from('user_locations')
          .select('location_id, locations(*, organizations(name, brand_name, brands(name)))')
          .eq('user_id', user!.id);

        const locs = userLocs?.map((ul: any) => ul.locations).filter(Boolean) || [];
        
        // Group by org
        const orgIds = [...new Set(locs.map((l: any) => l.organization_id).filter(Boolean))];
        
        if (orgIds.length > 0) {
          const { data: orgsData } = await supabase
            .from('organizations')
            .select('id, name, brand_name, logo_url, brands(name, logo_url)')
            .in('id', orgIds);
          const orgs = (orgsData || []).map((org: any) => ({
            ...org,
            brand_name: org.brand_name || org.brands?.name || null,
            logo_url: org.logo_url || org.brands?.logo_url || null,
          }));
          setOrganizations(orgs as Organization[]);
        }

        setLocations(
          locs.map((loc: any) => ({
            ...loc,
            org_name: loc.organizations?.brand_name || loc.organizations?.brands?.name || loc.organizations?.name,
          }))
        );
      }
    } catch (error) {
      console.error('Error fetching locations:', error);
    } finally {
      setLoading(false);
    }
  };

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
    
    const newDefault = defaultLocationId === locationId ? null : locationId;
    
    const { error } = await supabase
      .from('profiles')
      .update({ default_location_id: newDefault })
      .eq('id', user.id);

    if (error) {
      toast.error('Failed to update default location');
      return;
    }

    setDefaultLocationId(newDefault);
    toast.success(newDefault ? 'Default location set' : 'Default location cleared');
  };

  // Group locations by organization
  const locationsByOrg = locations.reduce((acc, loc) => {
    const orgId = loc.organization_id || 'unassigned';
    if (!acc[orgId]) acc[orgId] = [];
    acc[orgId].push(loc);
    return acc;
  }, {} as Record<string, Location[]>);

  const content = (
    <>
      {loading ? (
        <div className="space-y-4 p-4">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : (
        <div className="space-y-4 p-4">
          {organizations.length > 0 ? (
            organizations.map((org) => (
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
                  {org.brand_name ? (
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
                <div className="space-y-0.5 pl-5">
                  {locationsByOrg[org.id]?.map((location) => (
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
                          title={defaultLocationId === location.id ? 'Remove as default' : 'Set as default'}
                        >
                          <Star 
                            className={`h-3.5 w-3.5 ${
                              defaultLocationId === location.id 
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
                  ))}
                </div>
              </div>
            ))
          ) : (
            // No organizations, just show locations flat
            <div className="space-y-0.5">
              {locations.map((location) => (
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
                      title={defaultLocationId === location.id ? 'Remove as default' : 'Set as default'}
                    >
                      <Star 
                        className={`h-3.5 w-3.5 ${
                          defaultLocationId === location.id 
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
              ))}
            </div>
          )}

          {/* Unassigned locations (no org) */}
          {locationsByOrg['unassigned']?.length > 0 && organizations.length > 0 && (
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground px-1">
                <MapPin className="h-3 w-3" />
                Other Locations
              </div>
              <div className="space-y-0.5 pl-5">
                {locationsByOrg['unassigned'].map((location) => (
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
                        title={defaultLocationId === location.id ? 'Remove as default' : 'Set as default'}
                      >
                        <Star 
                          className={`h-3.5 w-3.5 ${
                            defaultLocationId === location.id 
                              ? 'fill-yellow-400 text-yellow-400' 
                              : 'text-muted-foreground hover:text-yellow-400'
                          }`} 
                        />
                      </button>
                      <div className="text-left">
                        <div className="text-sm font-medium">{formatLocationName(location.name, location.store_number)}</div>
                      </div>
                    </div>
                    <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                  </Button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );

  // Use Drawer on mobile for smooth vertical slide transition
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
