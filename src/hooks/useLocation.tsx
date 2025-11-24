import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';

interface Location {
  id: string;
  name: string;
}

interface LocationContextType {
  currentLocation: Location | null;
  locations: Location[];
  setCurrentLocation: (location: Location) => void;
  loading: boolean;
  refetchLocations: () => Promise<void>;
}

const LocationContext = createContext<LocationContextType | undefined>(undefined);

export const LocationProvider = ({ children }: { children: ReactNode }) => {
  const { user } = useAuth();
  const [currentLocation, setCurrentLocationState] = useState<Location | null>(null);
  const [locations, setLocations] = useState<Location[]>([]);
  const [loading, setLoading] = useState(true);

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
        .select('location_id, locations(id, name)')
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

  const setCurrentLocation = (location: Location) => {
    setCurrentLocationState(location);
    localStorage.setItem('currentLocationId', location.id);
  };

  return (
    <LocationContext.Provider
      value={{
        currentLocation,
        locations,
        setCurrentLocation,
        loading,
        refetchLocations: fetchLocations,
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
