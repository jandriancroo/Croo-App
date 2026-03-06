import { useState, useMemo, useCallback, useEffect } from 'react';
import { Layout } from '@/components/Layout';
import { useSearchParams } from 'react-router-dom';
import { useLocation as useAppLocation } from '@/hooks/useLocation';
import { useOrgLocations, useOrgLocationData } from '@/hooks/useOrgDashboardData';
import { OrgLocationCube, OrgLocationData } from '@/components/org-dashboard/OrgLocationCube';
import { OrgFavoritesBar } from '@/components/org-dashboard/OrgFavoritesBar';
import { useAuth } from '@/lib/auth';

const FAVORITES_KEY = 'org-dash-favorites';

function loadFavorites(orgId: string): string[] {
  try {
    const stored = localStorage.getItem(`${FAVORITES_KEY}-${orgId}`);
    return stored ? JSON.parse(stored) : [];
  } catch { return []; }
}

function saveFavorites(orgId: string, ids: string[]) {
  localStorage.setItem(`${FAVORITES_KEY}-${orgId}`, JSON.stringify(ids));
}

export default function MultiLocationDashboard() {
  const { organizationId: contextOrgId } = useAppLocation();
  const [searchParams] = useSearchParams();
  const urlOrgId = searchParams.get('org');
  const organizationId = urlOrgId || contextOrgId;

  const { data: allLocations = [], isLoading: locsLoading } = useOrgLocations(organizationId ?? null);
  
  const [favorites, setFavorites] = useState<string[]>([]);
  const [showAll, setShowAll] = useState(false);
  const [initialized, setInitialized] = useState(false);

  // Load favorites from localStorage on mount
  useEffect(() => {
    if (organizationId && allLocations.length > 0 && !initialized) {
      const saved = loadFavorites(organizationId);
      // Validate saved favorites still exist
      const valid = saved.filter(id => allLocations.some(l => l.id === id));
      setFavorites(valid);
      setInitialized(true);
    }
  }, [organizationId, allLocations, initialized]);

  const handleFavoritesChange = useCallback((ids: string[]) => {
    setFavorites(ids);
    if (organizationId) saveFavorites(organizationId, ids);
  }, [organizationId]);

  // Determine which locations to show cubes for
  const displayLocationIds = useMemo(() => {
    if (showAll) return allLocations.map(l => l.id);
    if (favorites.length > 0) return favorites;
    // Default: top 5 by sales (we'll sort after data loads, for now show first 5)
    return allLocations.slice(0, 5).map(l => l.id);
  }, [allLocations, favorites, showAll]);

  const { data: locationData = {}, isLoading: dataLoading } = useOrgLocationData(displayLocationIds);

  // Sort by today's sales descending when showing "all" or default
  const sortedLocationIds = useMemo(() => {
    if (favorites.length > 0 && !showAll) return favorites; // Keep favorite order
    return [...displayLocationIds].sort((a, b) => {
      const aSales = locationData[a]?.salesToday ?? 0;
      const bSales = locationData[b]?.salesToday ?? 0;
      return bSales - aSales;
    });
  }, [displayLocationIds, locationData, favorites, showAll]);

  return (
    <Layout>
      <div className="p-4 md:p-6 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h1 className="text-xl md:text-2xl font-bold">Org Dashboard</h1>
          <span className="text-xs text-muted-foreground">
            {allLocations.length} store{allLocations.length !== 1 ? 's' : ''}
          </span>
        </div>

        {/* Favorites Bar */}
        {allLocations.length > 0 && (
          <OrgFavoritesBar
            allLocations={allLocations.map(l => ({ id: l.id, name: l.name, storeNumber: l.store_number }))}
            favorites={favorites}
            onFavoritesChange={handleFavoritesChange}
            showAll={showAll}
            onToggleShowAll={() => setShowAll(prev => !prev)}
          />
        )}

        {/* Loading state */}
        {locsLoading && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3].map(i => (
              <OrgLocationCube key={i} data={{} as OrgLocationData} isLoading />
            ))}
          </div>
        )}

        {/* Cube Grid */}
        {!locsLoading && sortedLocationIds.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {sortedLocationIds.map(locId => {
              const loc = allLocations.find(l => l.id === locId);
              if (!loc) return null;
              
              const locData = locationData[locId];
              const cubeData: OrgLocationData = {
                locationId: locId,
                locationName: loc.name,
                storeNumber: loc.store_number,
                salesToday: locData?.salesToday ?? 0,
                paceToday: locData?.paceToday ?? null,
                goalToday: locData?.goalToday ?? null,
                last7Days: locData?.last7Days ?? Array(7).fill(0),
                salesWtd: locData?.salesWtd ?? 0,
                salesPrevWeek: locData?.salesPrevWeek ?? null,
                salesMtd: locData?.salesMtd ?? 0,
                salesPrevMonth: locData?.salesPrevMonth ?? null,
                salesLastYearDay: locData?.salesLastYearDay ?? null,
                laborPercent: locData?.laborPercent ?? null,
                laborCost: locData?.laborCost ?? null,
                hourlyData: locData?.hourlyData ?? Array(24).fill(0),
              };

              return (
                <OrgLocationCube
                  key={locId}
                  data={cubeData}
                  isLoading={dataLoading}
                />
              );
            })}
          </div>
        )}

        {/* Empty state */}
        {!locsLoading && allLocations.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <p className="text-muted-foreground text-sm">No locations found for this organization.</p>
          </div>
        )}
      </div>
    </Layout>
  );
}
