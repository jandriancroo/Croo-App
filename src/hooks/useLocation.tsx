import { createContext, useContext, useEffect, useState, ReactNode, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';

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
            .select('id, name, location_type, store_number, organization_id')
            .eq('organization_id', orgId);

          if (orgError) throw orgError;
          locs = (orgLocations || []) as Location[];
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
          .map((ul: any) => ul.locations)
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

  // Only clear location state on an EXPLICIT sign-out event. Transient null-user
  // states from token refresh / sleep-wake should never wipe the cached location.
  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        setLocations([]);
        setCurrentLocationState(null);
        setOrganizationId(null);
        try {
          localStorage.removeItem('currentLocationCache');
          localStorage.removeItem('currentLocationId');
        } catch {}
      }
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const setCurrentLocation = useCallback((location: Location, destination?: string, forceNavigate?: boolean) => {
    const previousId = currentLocation?.id;
    if (previousId === location.id && !forceNavigate) return; // No-op if same location (unless forced)

    // Enrich with organization_id from the locations roster if the caller
    // didn't include it (LocationSelector/LocationPickerDialog often omit it).
    // Without this, the org pill in Settings stays stuck on the previous org.
    const enriched: Location = location.organization_id
      ? location
      : { ...location, organization_id: locations.find(l => l.id === location.id)?.organization_id };

    // Show the overlay immediately
    setSwitchingTo(enriched);
    setIsSwitching(true);

    // Update location state + localStorage
    setCurrentLocationState(enriched);
    if (enriched.organization_id) setOrganizationId(enriched.organization_id);
    localStorage.setItem('currentLocationId', enriched.id);
    try { localStorage.setItem('currentLocationCache', JSON.stringify(enriched)); } catch {}

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
