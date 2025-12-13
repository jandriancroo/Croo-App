import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { Button } from '@/components/ui/button';
import { Building2, MapPin, ChevronRight } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useUserRole } from '@/hooks/useUserRole';
import { useAuth } from '@/lib/auth';
import { Skeleton } from '@/components/ui/skeleton';
import { useIsMobile } from '@/hooks/use-mobile';

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
}

interface LocationPickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectLocation: (location: { id: string; name: string; location_type: string }) => void;
  currentLocationId?: string;
}

export function LocationPickerDialog({
  open,
  onOpenChange,
  onSelectLocation,
  currentLocationId,
}: LocationPickerDialogProps) {
  const { user } = useAuth();
  const { role } = useUserRole();
  const isMobile = useIsMobile();
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [loading, setLoading] = useState(true);

  // For now, admins can see all orgs/locations they have access to
  const canSeeAllOrgs = role === 'admin' || (role as string) === 'super_admin';
  const isOrgLevel = role === 'general_manager' || (role as string) === 'org_admin';

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
          supabase.from('organizations').select('id, name, brand_name, logo_url').eq('is_active', true).order('name'),
          supabase.from('locations').select('*, organizations(name, brand_name)').order('name'),
        ]);

        setOrganizations((orgsResult.data || []) as Organization[]);
        setLocations(
          (locsResult.data || []).map((loc: any) => ({
            ...loc,
            org_name: loc.organizations?.brand_name || loc.organizations?.name,
          }))
        );
      } else if (isOrgLevel) {
        // Org admin: see their org's locations
        const { data: orgMemberships } = await supabase
          .from('organization_members')
          .select('organization_id, organizations(id, name, brand_name, logo_url)')
          .eq('user_id', user!.id)
          .eq('org_role', 'admin');

        const orgIds = orgMemberships?.map((m: any) => m.organization_id) || [];
        const orgs = orgMemberships?.map((m: any) => m.organizations).filter(Boolean) || [];

        setOrganizations(orgs);

        if (orgIds.length > 0) {
          const { data: locs } = await supabase
            .from('locations')
            .select('*, organizations(name, brand_name)')
            .in('organization_id', orgIds)
            .order('name');

          setLocations(
            (locs || []).map((loc: any) => ({
              ...loc,
              org_name: loc.organizations?.brand_name || loc.organizations?.name,
            }))
          );
        }
      } else {
        // Regular admin/user: see their assigned locations
        const { data: userLocs } = await supabase
          .from('user_locations')
          .select('location_id, locations(*, organizations(name, brand_name))')
          .eq('user_id', user!.id);

        const locs = userLocs?.map((ul: any) => ul.locations).filter(Boolean) || [];
        
        // Group by org
        const orgIds = [...new Set(locs.map((l: any) => l.organization_id).filter(Boolean))];
        
        if (orgIds.length > 0) {
          const { data: orgs } = await supabase
            .from('organizations')
            .select('id, name, brand_name, logo_url')
            .in('id', orgIds);
          setOrganizations((orgs || []) as Organization[]);
        }

        setLocations(
          locs.map((loc: any) => ({
            ...loc,
            org_name: loc.organizations?.brand_name || loc.organizations?.name,
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
    });
    onOpenChange(false);
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
                <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground px-1">
                  {org.logo_url ? (
                    <img src={org.logo_url} alt="" className="h-4 w-4 object-contain rounded" />
                  ) : (
                    <Building2 className="h-3 w-3" />
                  )}
                  {org.brand_name ? (
                    <span>
                      <span className="text-foreground font-semibold">{org.brand_name}</span>
                      <span className="text-muted-foreground"> — {org.name}</span>
                    </span>
                  ) : (
                    org.name
                  )}
                </div>
                <div className="space-y-0.5 pl-5">
                  {locationsByOrg[org.id]?.map((location) => (
                    <Button
                      key={location.id}
                      variant={location.id === currentLocationId ? 'secondary' : 'ghost'}
                      className="w-full justify-between h-auto py-2 px-2"
                      onClick={() => handleSelectLocation(location)}
                    >
                      <div className="flex items-center gap-2">
                        <MapPin className="h-3.5 w-3.5" />
                        <div className="text-left">
                          <div className="text-sm font-medium">{location.name}</div>
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
                    <MapPin className="h-3.5 w-3.5" />
                    <div className="text-left">
                      <div className="text-sm font-medium">{location.name}</div>
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
                      <MapPin className="h-3.5 w-3.5" />
                      <div className="text-left">
                        <div className="text-sm font-medium">{location.name}</div>
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
