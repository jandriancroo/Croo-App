import { createContext, useContext, useEffect, useState, ReactNode, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { useQueryClient } from '@tanstack/react-query';

interface Location {
  id: string;
  name: string;
  location_type: string;
}

interface LocationContextType {
  currentLocation: Location | null;
  locations: Location[];
  setCurrentLocation: (location: Location) => void;
  loading: boolean;
  switching: boolean;
  refetchLocations: () => Promise<void>;
  isChecklistOnlyLocation: boolean;
}

const LocationContext = createContext<LocationContextType | undefined>(undefined);

export const LocationProvider = ({ children }: { children: ReactNode }) => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [currentLocation, setCurrentLocationState] = useState<Location | null>(null);
  const [locations, setLocations] = useState<Location[]>([]);
  const [loading, setLoading] = useState(true);
  const [switching, setSwitching] = useState(false);

  const fetchLocations = async () => {
    if (!user) {
      setLocations([]);
      setCurrentLocationState(null);
      setLoading(false);
      return;
    }

    try {
      const { data, error } = await supabase
        .from('user_locations')
        .select('location_id, locations(id, name, location_type)')
        .eq('user_id', user.id);

      if (error) throw error;

      const locs = data
        ?.map((ul: any) => ul.locations)
        .filter(Boolean) as Location[];

      setLocations(locs || []);

      // Set current location from localStorage or default to first
      const savedLocationId = localStorage.getItem('currentLocationId');
      if (savedLocationId && locs?.find(l => l.id === savedLocationId)) {
        setCurrentLocationState(locs.find(l => l.id === savedLocationId)!);
      } else if (locs && locs.length > 0) {
        setCurrentLocationState(locs[0]);
        localStorage.setItem('currentLocationId', locs[0].id);
      }
    } catch (error) {
      console.error('Error fetching locations:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLocations();
  }, [user]);

  const setCurrentLocation = useCallback((location: Location) => {
    setSwitching(true);
    setCurrentLocationState(location);
    localStorage.setItem('currentLocationId', location.id);
    
    // Remove all cached data immediately - queries will refetch on-demand
    queryClient.removeQueries();
    
    // Brief UI feedback then let components refetch naturally
    setTimeout(() => {
      setSwitching(false);
    }, 150);
  }, [queryClient]);

  const isChecklistOnlyLocation = currentLocation?.location_type === 'checklist_only';

  return (
    <LocationContext.Provider
      value={{
        currentLocation,
        locations,
        setCurrentLocation,
        loading,
        switching,
        refetchLocations: fetchLocations,
        isChecklistOnlyLocation,
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
