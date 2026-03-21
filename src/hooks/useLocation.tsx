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
  const [currentLocation, setCurrentLocationState] = useState<Location | null>(null);
  const [locations, setLocations] = useState<Location[]>([]);
  const [loading, setLoading] = useState(true);
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [isSwitching, setIsSwitching] = useState(false);
  const [switchingTo, setSwitchingTo] = useState<Location | null>(null);

  const fetchLocations = useCallback(async () => {
    if (!user) {
      setLocations([]);
      setCurrentLocationState(null);
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
          .select('user_id, location_id, locations(id, name, location_type, store_number, organization_id)')
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
      if (savedLocationId && locs?.find(l => l.id === savedLocationId)) {
        setCurrentLocationState(locs.find(l => l.id === savedLocationId)!);
      } else {
        const defaultLoc = profile?.default_location_id 
          ? locs?.find(l => l.id === profile.default_location_id)
          : null;
        
        if (defaultLoc) {
          setCurrentLocationState(defaultLoc);
          localStorage.setItem('currentLocationId', defaultLoc.id);
        } else if (locs && locs.length > 0) {
          setCurrentLocationState(locs[0]);
          localStorage.setItem('currentLocationId', locs[0].id);
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

  const setCurrentLocation = useCallback((location: Location, destination?: string, forceNavigate?: boolean) => {
    const previousId = currentLocation?.id;
    if (previousId === location.id && !forceNavigate) return; // No-op if same location (unless forced)

    // Show the overlay immediately
    setSwitchingTo(location);
    setIsSwitching(true);

    // Update location state + localStorage
    setCurrentLocationState(location);
    localStorage.setItem('currentLocationId', location.id);

    const locationScopedKeys = [
      'schedule', 'schedule-stable', 'users', 'shifts', 'sales', 'labor',
      'checklists', 'inventory', 'user-data-cubes', 'sales-cache-today',
      'sales-cache-wtd', 'location-hours-today', 'org-logo', 'time-tracking',
      'time-punches', 'payroll', 'temporary-tasks', 'logbook', 'catering',
      'certifications', 'holidays', 'events', 'availability', 'user-checklists',
      'checklist-submissions', 'labor-cache', 'shift-templates', 'hiring',
      'completion-history', 'submission-stats', 'completed-temp-tasks',
      'location-timezone',
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
  }, [queryClient, navigate, currentLocation?.id]);

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
        refetchLocations: fetchLocations,
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
