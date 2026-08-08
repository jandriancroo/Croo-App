import { createContext, useContext, useEffect, useState, ReactNode, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { getPairing } from '@/lib/punchDevicePairing';

interface Location {
  id: string;
  name: string;
  location_type: string;
  store_number?: string | null;
  organization_id?: string;
  brand_name?: string | null;
}

interface LocationContextType {
  currentLocation: Location | null;
  locations: Location[];
  setCurrentLocation: (location: Location, destination?: string, forceNavigate?: boolean) => void;
  loading: boolean;
  refetchLocations: () => Promise<void>;
  isChecklistOnlyLocation: boolean;
  organizationId: string | null;
  isSwitching: boolean;
  switchingTo: Location | null;
}

const LocationContext = createContext<LocationContextType | undefined>(undefined);

export const LocationProvider = ({ children }: { children: ReactNode }) => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  // Hydrate immediately from localStorage so the location never flickers null
  // during auth refresh / hard reloads (eliminates the ~80ms blink window
  // where a punch could be written with location_id = NULL).
  const [currentLocation, setCurrentLocationState] = useState<Location | null>(() => {
    try {
      const cached = localStorage.getItem('currentLocationCache');
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed?.id) return parsed as Location;
      }
    } catch {}
    return null;
  });
  const [locations, setLocations] = useState<Location[]>([]);
  const [loading, setLoading] = useState(true);
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [isSwitching, setIsSwitching] = useState(false);
  const [switchingTo, setSwitchingTo] = useState<Location | null>(null);

  const fetchLocations = useCallback(async () => {
    if (!user) {
      // Transient null user (token refresh blip, iPad sleep/wake, brief network
      // hiccup) — do NOT wipe currentLocation or the localStorage cache. Doing
      // so causes the punch-clock to flash "Location not loaded" + false
      // "Not scheduled today" toasts for anyone who PINs during that window.
      // An explicit sign-out is handled by the SIGNED_OUT listener below.
      setLoading(false);
      return;
    }

    // ---- Paired punch device short-circuit ----
    // Device sessions have no profile and no user_locations row. Use the
    // location baked into the pairing credential instead.
    const pairing = getPairing();
    if (pairing && pairing.location) {
      const deviceLoc: Location = {
        id: pairing.location.id,
        name: pairing.location.name,
        location_type: 'restaurant',
        store_number: pairing.location.store_number ?? null,
        organization_id: pairing.location.organization_id,
      };
      // Verify this session is actually the device (metadata flag set at pairing time)
      const isDeviceSession = (user.user_metadata as any)?.is_punch_device === true;
      if (isDeviceSession) {
        setLocations([deviceLoc]);
        setCurrentLocationState(deviceLoc);
        if (deviceLoc.organization_id) setOrganizationId(deviceLoc.organization_id);
        try {
          localStorage.setItem('currentLocationId', deviceLoc.id);
          localStorage.setItem('currentLocationCache', JSON.stringify(deviceLoc));
        } catch {}
        setLoading(false);
        return;
      }
    }


    try {
      // Parallel fetch: profile + user_locations at the same time (both only need user.id)
      const [profileResult, userLocsResult] = await Promise.all([
        supabase
          .from('profiles')
          .select('all_locations_enabled, default_location_id')
          .eq('id', user.id)
          .single(),
        supabase
          .from('user_locations')
          .select('user_id, location_id, locations(id, name, location_type, store_number, organization_id, organizations(brand_name, brands(name)))')
          .eq('user_id', user.id),
      ]);

      const profile = profileResult.data;
      const userLocData = userLocsResult.data;
      if (userLocsResult.error) throw userLocsResult.error;

      let locs: Location[] = [];

      if (profile?.all_locations_enabled) {
        // User has access to all locations - get all locations in the org
        const orgId = userLocData?.[0]?.locations?.organization_id;
        
        if (orgId) {
          setOrganizationId(orgId);
          const { data: orgLocations, error: orgError } = await supabase
            .from('locations')
            .select('id, name, location_type, store_number, organization_id, organizations(brand_name, brands(name))')
            .eq('organization_id', orgId);

          if (orgError) throw orgError;
          locs = (orgLocations || []).map((l: any) => ({
            ...l,
            brand_name: l.organizations?.brand_name || l.organizations?.brands?.name || null,
          })) as Location[];
        } else {
          const { data: allLocs, error: allError } = await supabase
            .from('locations')
            .select('id, name, location_type, store_number');
          
          if (allError) throw allError;
          locs = (allLocs || []) as Location[];
        }
      } else {
        // Standard behavior: use already-fetched user_locations
        locs = (userLocData || [])
          .map((ul: any) => {
            const l = ul.locations;
            if (!l) return null;
            return {
              ...l,
              brand_name: l.organizations?.brand_name || l.organizations?.brands?.name || null,
            };
          })
          .filter(Boolean) as Location[];
        
        if (locs.length > 0 && locs[0].organization_id) {
          setOrganizationId(locs[0].organization_id);
        }
      }

      setLocations(locs || []);

      // Set current location: priority is localStorage > default_location_id > first location
      const savedLocationId = localStorage.getItem('currentLocationId');
      const persistLocation = (loc: Location) => {
        setCurrentLocationState(loc);
        localStorage.setItem('currentLocationId', loc.id);
        try { localStorage.setItem('currentLocationCache', JSON.stringify(loc)); } catch {}
      };
      if (savedLocationId && locs?.find(l => l.id === savedLocationId)) {
        persistLocation(locs.find(l => l.id === savedLocationId)!);
      } else {
        const defaultLoc = profile?.default_location_id 
          ? locs?.find(l => l.id === profile.default_location_id)
          : null;
        
        if (defaultLoc) {
          persistLocation(defaultLoc);
        } else if (locs && locs.length > 0) {
          persistLocation(locs[0]);
        }
      }
    } catch (error) {
      console.error('[useLocation] Error fetching locations:', error);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    fetchLocations();
  }, [user]);

  // NOTE: We intentionally do NOT clear currentLocation / localStorage on
  // Supabase's SIGNED_OUT event. That event also fires on spurious refresh-token
  // failures after a PWA has been idle (e.g. a 30-minute break on the punch
  // clock kiosk). Wiping the cached location in that case left the punch clock
  // stuck showing "Location not loaded yet" and "not scheduled today" until the
  // manager fully logged out and back in.
  //
  // An explicit sign-out is handled by AuthProvider.signOut(), which navigates
  // to /auth. On the next successful SIGNED_IN, `user` changes and
  // fetchLocations() re-populates state — and if a different user signs in,
  // savedLocationId is filtered against their user_locations, so no stale
  // location leaks through.
  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange(() => {});
    return () => sub.subscription.unsubscribe();
  }, []);


  const setCurrentLocation = useCallback((location: Location, destination?: string, forceNavigate?: boolean) => {
    const previousId = currentLocation?.id;
    if (previousId === location.id && !forceNavigate) return; // No-op if same location (unless forced)

    // Enrich with organization_id from the locations roster if the caller
    // didn't include it (LocationSelector/LocationPickerDialog often omit it).
    // Without this, the org pill in Settings stays stuck on the previous org.
    // Enrich with organization_id + brand_name from roster when caller omits them
    const rosterMatch = locations.find(l => l.id === location.id);
    const enriched: Location = {
      ...location,
      organization_id: location.organization_id ?? rosterMatch?.organization_id,
      brand_name: location.brand_name ?? rosterMatch?.brand_name ?? null,
    };

    // Show the overlay immediately
    setSwitchingTo(enriched);
    setIsSwitching(true);

    // Update location state + localStorage
    setCurrentLocationState(enriched);
    if (enriched.organization_id) setOrganizationId(enriched.organization_id);
    localStorage.setItem('currentLocationId', enriched.id);
    try { localStorage.setItem('currentLocationCache', JSON.stringify(enriched)); } catch {}

    // If neither the caller nor the roster knew the org (e.g. multi-brand admins
    // switching into a location outside their primary org), resolve it from the
    // database so org-scoped panels (Settings, members, roles) don't keep
    // showing the previous organization.
    if (!enriched.organization_id) {
      (async () => {
        const { data } = await supabase
          .from('locations')
          .select('organization_id, organizations(brand_name, brands(name))')
          .eq('id', enriched.id)
          .maybeSingle();
        if (!data?.organization_id) return;
        const resolved: Location = {
          ...enriched,
          organization_id: data.organization_id,
          brand_name:
            enriched.brand_name ??
            (data as any).organizations?.brand_name ??
            (data as any).organizations?.brands?.name ??
            null,
        };
        setCurrentLocationState(prev => (prev?.id === resolved.id ? resolved : prev));
        setOrganizationId(data.organization_id);
        try { localStorage.setItem('currentLocationCache', JSON.stringify(resolved)); } catch {}
      })();
    }


    const locationScopedKeys = [
      'schedule', 'schedule-stable', 'users', 'shifts', 'sales', 'labor',
      'checklists', 'inventory', 'user-data-cubes', 'sales-cache-today',
      'sales-cache-wtd', 'location-hours-today', 'org-logo', 'time-tracking',
      'time-punches', 'payroll', 'temporary-tasks', 'logbook', 'catering',
      'certifications', 'holidays', 'events', 'availability', 'user-checklists',
      'checklist-submissions', 'labor-cache', 'shift-templates', 'hiring',
      'completion-history', 'submission-stats', 'completed-temp-tasks',
      'location-timezone', 'ovation-reviews',
    ];

    const locationPredicate = (query: { queryKey: readonly unknown[] }) => {
      const key = query.queryKey;
      if (previousId && key.some(k => k === previousId)) return true;
      return locationScopedKeys.some(prefix => key[0] === prefix);
    };

    // Step 1: Cancel any in-flight requests for the old location
    queryClient.cancelQueries({ predicate: locationPredicate });

    // Step 2: Remove all old location data from cache
    queryClient.removeQueries({ predicate: locationPredicate });

    // Navigate to destination (default: dashboard as "front door")
    navigate(destination || '/dashboard');

    // Dismiss overlay after iOS-style fade — 1.8s is snappy but readable
    setTimeout(() => {
      setIsSwitching(false);
      setSwitchingTo(null);
    }, 1800);
  }, [queryClient, navigate, currentLocation?.id, locations]);

  const isChecklistOnlyLocation = currentLocation?.location_type === 'checklist_only';

  // Derive organizationId from current location so it updates on switch
  const effectiveOrganizationId = currentLocation?.organization_id ?? organizationId;

  return (
    <LocationContext.Provider
      value={{
        currentLocation,
        locations,
        setCurrentLocation,
        loading,
      refetchLocations: async () => {
        await fetchLocations();
        // Also invalidate the location picker cache so new locations appear immediately
        queryClient.invalidateQueries({ queryKey: ['location-picker-data'] });
        queryClient.invalidateQueries({ queryKey: ['location-picker-profile'] });
      },
        isChecklistOnlyLocation,
        organizationId: effectiveOrganizationId,
        isSwitching,
        switchingTo,
      }}
    >
      {children}
    </LocationContext.Provider>
  );
};

export const useLocation = () => {
  const context = useContext(LocationContext);
  if (context === undefined) {
    throw new Error('useLocation must be used within a LocationProvider');
  }
  return context;
};
