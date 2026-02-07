import { createContext, useContext, useEffect, useState, ReactNode, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
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
  setCurrentLocation: (location: Location) => void;
  loading: boolean;
  refetchLocations: () => Promise<void>;
  isChecklistOnlyLocation: boolean;
  organizationId: string | null;
}

const LocationContext = createContext<LocationContextType | undefined>(undefined);

export const LocationProvider = ({ children }: { children: ReactNode }) => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [currentLocation, setCurrentLocationState] = useState<Location | null>(null);
  const [locations, setLocations] = useState<Location[]>([]);
  const [loading, setLoading] = useState(true);
  const [organizationId, setOrganizationId] = useState<string | null>(null);

  const fetchLocations = useCallback(async () => {
    if (!user) {
      setLocations([]);
      setCurrentLocationState(null);
      setLoading(false);
      return;
    }

    try {
      // First check if user has all_locations_enabled
      const { data: profile } = await supabase
        .from('profiles')
        .select('all_locations_enabled, default_location_id')
        .eq('id', user.id)
        .single();

      let locs: Location[] = [];

      if (profile?.all_locations_enabled) {
        // User has access to all locations - get all locations in the org
        // First get user's organization(s) via their assigned locations
        const { data: userLocs } = await supabase
          .from('user_locations')
          .select('locations(organization_id)')
          .eq('user_id', user.id)
          .limit(1);

        const orgId = userLocs?.[0]?.locations?.organization_id;
        
        if (orgId) {
          setOrganizationId(orgId);
          // Get all locations in this organization
          const { data: orgLocations, error: orgError } = await supabase
            .from('locations')
            .select('id, name, location_type, store_number, organization_id')
            .eq('organization_id', orgId);

          if (orgError) throw orgError;
          locs = (orgLocations || []) as Location[];
        } else {
          // Fallback: get all locations if no org found
          const { data: allLocs, error: allError } = await supabase
            .from('locations')
            .select('id, name, location_type, store_number');
          
          if (allError) throw allError;
          locs = (allLocs || []) as Location[];
        }
      } else {
        // Standard behavior: only assigned locations
        const { data, error } = await supabase
          .from('user_locations')
          .select('location_id, locations(id, name, location_type, store_number, organization_id)')
          .eq('user_id', user.id);

        if (error) throw error;

        locs = data
          ?.map((ul: any) => ul.locations)
          .filter(Boolean) as Location[];
        
        // Set organization ID from first location
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

  const setCurrentLocation = useCallback((location: Location) => {
    // Update location immediately for instant UI feedback
    setCurrentLocationState(location);
    localStorage.setItem('currentLocationId', location.id);
    
    // Only invalidate location-specific queries, NOT the entire app
    // This prevents cascade of refetches across all components
    queryClient.invalidateQueries({ queryKey: ['schedule'] });
    queryClient.invalidateQueries({ queryKey: ['users'] });
    queryClient.invalidateQueries({ queryKey: ['shifts'] });
    queryClient.invalidateQueries({ queryKey: ['sales'] });
    queryClient.invalidateQueries({ queryKey: ['labor'] });
    queryClient.invalidateQueries({ queryKey: ['checklists'] });
    queryClient.invalidateQueries({ queryKey: ['inventory'] });
  }, [queryClient]);

  const isChecklistOnlyLocation = currentLocation?.location_type === 'checklist_only';

  return (
    <LocationContext.Provider
      value={{
        currentLocation,
        locations,
        setCurrentLocation,
        loading,
        refetchLocations: fetchLocations,
        isChecklistOnlyLocation,
        organizationId,
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
