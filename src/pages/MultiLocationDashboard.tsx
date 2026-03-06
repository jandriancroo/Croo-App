import { useState, useMemo, useCallback, useEffect } from 'react';
import { Layout } from '@/components/Layout';
import { useSearchParams } from 'react-router-dom';
import { useLocation as useAppLocation } from '@/hooks/useLocation';
import { useOrgLocations, useOrgLocationData } from '@/hooks/useOrgDashboardData';
import { OrgLocationData } from '@/components/org-dashboard/OrgLocationCube';
import { OrgFavoritesBar } from '@/components/org-dashboard/OrgFavoritesBar';
import { OrgCubeStyleA } from '@/components/org-dashboard/cube-styles/OrgCubeStyleA';
import { OrgCubeStyleB } from '@/components/org-dashboard/cube-styles/OrgCubeStyleB';
import { OrgCubeStyleC } from '@/components/org-dashboard/cube-styles/OrgCubeStyleC';
import { OrgCubeStyleD } from '@/components/org-dashboard/cube-styles/OrgCubeStyleD';
import { OrgCubeStyleE } from '@/components/org-dashboard/cube-styles/OrgCubeStyleE';

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

// Mock data for preview
const MOCK_DATA: OrgLocationData[] = [
  {
    locationId: 'mock-1', locationName: 'Palm Springs', storeNumber: '1341',
    salesToday: 4823, paceToday: 8950, goalToday: 8200,
    last7Days: [6200, 7100, 5800, 7400, 6900, 8100, 4823],
    salesWtd: 46224, salesPrevWeek: 43100, salesMtd: 128450, salesPrevMonth: 135200,
    salesLastYearDay: 4200, laborPercent: 24.3, laborCost: 1172,
    hourlyData: [0,0,0,0,0,0,0,120,340,580,720,890,1050,650,420,380,0,0,0,0,0,0,0,0],
  },
  {
    locationId: 'mock-2', locationName: 'Palm Desert', storeNumber: '1342',
    salesToday: 3156, paceToday: 5800, goalToday: 6500,
    last7Days: [5100, 4800, 5200, 4900, 5500, 5300, 3156],
    salesWtd: 33956, salesPrevWeek: 35200, salesMtd: 98700, salesPrevMonth: 102300,
    salesLastYearDay: 3800, laborPercent: 31.2, laborCost: 984,
    hourlyData: [0,0,0,0,0,0,0,80,220,410,580,690,820,510,340,290,0,0,0,0,0,0,0,0],
  },
  {
    locationId: 'mock-3', locationName: 'Hemet', storeNumber: '1343',
    salesToday: 5612, paceToday: 10200, goalToday: 9000,
    last7Days: [7800, 8200, 7400, 8600, 9100, 8800, 5612],
    salesWtd: 55512, salesPrevWeek: 51200, salesMtd: 162300, salesPrevMonth: 155800,
    salesLastYearDay: 5100, laborPercent: 22.1, laborCost: 1240,
    hourlyData: [0,0,0,0,0,0,0,200,450,680,920,1100,1280,780,520,460,220,0,0,0,0,0,0,0],
  },
  {
    locationId: 'mock-4', locationName: 'Indio', storeNumber: '1344',
    salesToday: 2890, paceToday: 5100, goalToday: 5800,
    last7Days: [4200, 4500, 3900, 4100, 4800, 4600, 2890],
    salesWtd: 28990, salesPrevWeek: 30100, salesMtd: 84200, salesPrevMonth: 88900,
    salesLastYearDay: 3100, laborPercent: 34.8, laborCost: 1006,
    hourlyData: [0,0,0,0,0,0,0,60,180,320,450,560,680,420,280,240,100,0,0,0,0,0,0,0],
  },
  {
    locationId: 'mock-5', locationName: 'Cathedral City', storeNumber: '1345',
    salesToday: 4100, paceToday: 7500, goalToday: 7200,
    last7Days: [5900, 6300, 5700, 6100, 6800, 6500, 4100],
    salesWtd: 41400, salesPrevWeek: 39800, salesMtd: 118900, salesPrevMonth: 121500,
    salesLastYearDay: 3900, laborPercent: 27.5, laborCost: 1128,
    hourlyData: [0,0,0,0,0,0,0,140,310,520,680,820,960,600,390,340,160,0,0,0,0,0,0,0],
  },
];

const STYLE_LABELS = [
  { id: 'A', name: 'Compact Cards', desc: 'Dense info, status-color accent bar' },
  { id: 'B', name: 'Gradient Panels', desc: 'Bold gradients, large hero numbers' },
  { id: 'C', name: 'Dark Analytics', desc: 'Dashboard-style with inline charts' },
  { id: 'D', name: 'Minimal List', desc: 'Clean rows, sparkline-focused' },
  { id: 'E', name: 'Tile Grid', desc: 'Colorful tiles with heatmap emphasis' },
];

export default function MultiLocationDashboard() {
  const { organizationId: contextOrgId } = useAppLocation();
  const [searchParams] = useSearchParams();
  const urlOrgId = searchParams.get('org');
  const organizationId = urlOrgId || contextOrgId;

  const [previewMode, setPreviewMode] = useState(true);
  const [selectedStyle, setSelectedStyle] = useState<string | null>(null);

  // === Live mode state (for after style selection) ===
  const { data: allLocations = [], isLoading: locsLoading } = useOrgLocations(organizationId ?? null);
  const [favorites, setFavorites] = useState<string[]>([]);
  const [showAll, setShowAll] = useState(false);
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    if (organizationId && allLocations.length > 0 && !initialized) {
      const saved = loadFavorites(organizationId);
      const valid = saved.filter(id => allLocations.some(l => l.id === id));
      setFavorites(valid);
      setInitialized(true);
    }
  }, [organizationId, allLocations, initialized]);

  const handleFavoritesChange = useCallback((ids: string[]) => {
    setFavorites(ids);
    if (organizationId) saveFavorites(organizationId, ids);
  }, [organizationId]);

  const displayLocationIds = useMemo(() => {
    if (showAll) return allLocations.map(l => l.id);
    if (favorites.length > 0) return favorites;
    return allLocations.slice(0, 5).map(l => l.id);
  }, [allLocations, favorites, showAll]);

  const { data: locationData = {}, isLoading: dataLoading } = useOrgLocationData(displayLocationIds);

  const sortedLocationIds = useMemo(() => {
    if (favorites.length > 0 && !showAll) return favorites;
    return [...displayLocationIds].sort((a, b) => {
      const aSales = locationData[a]?.salesToday ?? 0;
      const bSales = locationData[b]?.salesToday ?? 0;
      return bSales - aSales;
    });
  }, [displayLocationIds, locationData, favorites, showAll]);

  // Preview mode: show 5 design options
  if (previewMode) {
    return (
      <Layout>
        <div className="p-4 md:p-6 space-y-8 max-w-5xl mx-auto">
          <div className="text-center space-y-2">
            <h1 className="text-2xl md:text-3xl font-bold">Choose Your Org Dashboard Style</h1>
            <p className="text-sm text-muted-foreground">
              Each style shows the same 5 layers of data — pick the one that feels right. You can always change later.
            </p>
          </div>

          {STYLE_LABELS.map((style, idx) => {
            const CubeComponent = [OrgCubeStyleA, OrgCubeStyleB, OrgCubeStyleC, OrgCubeStyleD, OrgCubeStyleE][idx];
            return (
              <div key={style.id} className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-lg font-bold">Style {style.id}: {style.name}</h2>
                    <p className="text-xs text-muted-foreground">{style.desc}</p>
                  </div>
                  <button
                    onClick={() => { setSelectedStyle(style.id); setPreviewMode(false); }}
                    className="text-xs font-medium px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                  >
                    Use This Style
                  </button>
                </div>
                
                {/* Show 3 cubes per style for preview */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {MOCK_DATA.slice(0, 3).map(mock => (
                    <CubeComponent key={mock.locationId} data={mock} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </Layout>
    );
  }

  // Live mode after style selection
  const ActiveCube = selectedStyle === 'B' ? OrgCubeStyleB
    : selectedStyle === 'C' ? OrgCubeStyleC
    : selectedStyle === 'D' ? OrgCubeStyleD
    : selectedStyle === 'E' ? OrgCubeStyleE
    : OrgCubeStyleA;

  return (
    <Layout>
      <div className="p-4 md:p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-xl md:text-2xl font-bold">Org Dashboard</h1>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">
              {allLocations.length} store{allLocations.length !== 1 ? 's' : ''}
            </span>
            <button
              onClick={() => setPreviewMode(true)}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              Change Style
            </button>
          </div>
        </div>

        {allLocations.length > 0 && (
          <OrgFavoritesBar
            allLocations={allLocations.map(l => ({ id: l.id, name: l.name, storeNumber: l.store_number }))}
            favorites={favorites}
            onFavoritesChange={handleFavoritesChange}
            showAll={showAll}
            onToggleShowAll={() => setShowAll(prev => !prev)}
          />
        )}

        {locsLoading && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3].map(i => (
              <ActiveCube key={i} data={{} as OrgLocationData} isLoading />
            ))}
          </div>
        )}

        {!locsLoading && sortedLocationIds.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {sortedLocationIds.map(locId => {
              const loc = allLocations.find(l => l.id === locId);
              if (!loc) return null;
              const locData = locationData[locId];
              const cubeData: OrgLocationData = {
                locationId: locId, locationName: loc.name, storeNumber: loc.store_number,
                salesToday: locData?.salesToday ?? 0, paceToday: locData?.paceToday ?? null,
                goalToday: locData?.goalToday ?? null, last7Days: locData?.last7Days ?? Array(7).fill(0),
                salesWtd: locData?.salesWtd ?? 0, salesPrevWeek: locData?.salesPrevWeek ?? null,
                salesMtd: locData?.salesMtd ?? 0, salesPrevMonth: locData?.salesPrevMonth ?? null,
                salesLastYearDay: locData?.salesLastYearDay ?? null,
                laborPercent: locData?.laborPercent ?? null, laborCost: locData?.laborCost ?? null,
                hourlyData: locData?.hourlyData ?? Array(24).fill(0),
              };
              return <ActiveCube key={locId} data={cubeData} isLoading={dataLoading} />;
            })}
          </div>
        )}

        {!locsLoading && allLocations.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <p className="text-muted-foreground text-sm">No locations found for this organization.</p>
          </div>
        )}
      </div>
    </Layout>
  );
}
