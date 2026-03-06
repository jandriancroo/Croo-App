import { useState, useMemo, useCallback, useEffect } from 'react';
import { Layout } from '@/components/Layout';
import { useSearchParams } from 'react-router-dom';
import { useLocation as useAppLocation } from '@/hooks/useLocation';
import { useOrgLocations, useOrgLocationData } from '@/hooks/useOrgDashboardData';
import { OrgLocationData } from '@/components/org-dashboard/OrgLocationCube';
import { OrgSearchBar, SearchTag, SearchableLocation } from '@/components/org-dashboard/OrgSearchBar';
import { OrgCubeStyleB, OrgPeriod } from '@/components/org-dashboard/cube-styles/OrgCubeStyleB';
import { ChevronUp, ChevronDown } from 'lucide-react';

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
    salesLastYearDay: 4200, laborPercent: 24.3, laborCost: 1172, laborCostWtd: 8200, laborCostMtd: 31200,
    hourlyData: [0,0,0,0,0,0,0,120,340,580,720,890,1050,650,420,380,0,0,0,0,0,0,0,0],
  },
  {
    locationId: 'mock-2', locationName: 'Palm Desert', storeNumber: '1342',
    salesToday: 3156, paceToday: 5800, goalToday: 6500,
    last7Days: [5100, 4800, 5200, 4900, 5500, 5300, 3156],
    salesWtd: 33956, salesPrevWeek: 35200, salesMtd: 98700, salesPrevMonth: 102300,
    salesLastYearDay: 3800, laborPercent: 31.2, laborCost: 984, laborCostWtd: 6900, laborCostMtd: 28600,
    hourlyData: [0,0,0,0,0,0,0,80,220,410,580,690,820,510,340,290,0,0,0,0,0,0,0,0],
  },
  {
    locationId: 'mock-3', locationName: 'Hemet', storeNumber: '1343',
    salesToday: 5612, paceToday: 10200, goalToday: 9000,
    last7Days: [7800, 8200, 7400, 8600, 9100, 8800, 5612],
    salesWtd: 55512, salesPrevWeek: 51200, salesMtd: 162300, salesPrevMonth: 155800,
    salesLastYearDay: 5100, laborPercent: 22.1, laborCost: 1240, laborCostWtd: 8700, laborCostMtd: 33500,
    hourlyData: [0,0,0,0,0,0,0,200,450,680,920,1100,1280,780,520,460,220,0,0,0,0,0,0,0],
  },
  {
    locationId: 'mock-4', locationName: 'Indio', storeNumber: '1344',
    salesToday: 2890, paceToday: 5100, goalToday: 5800,
    last7Days: [4200, 4500, 3900, 4100, 4800, 4600, 2890],
    salesWtd: 28990, salesPrevWeek: 30100, salesMtd: 84200, salesPrevMonth: 88900,
    salesLastYearDay: 3100, laborPercent: 34.8, laborCost: 1006, laborCostWtd: 7050, laborCostMtd: 27800,
    hourlyData: [0,0,0,0,0,0,0,60,180,320,450,560,680,420,280,240,100,0,0,0,0,0,0,0],
  },
  {
    locationId: 'mock-5', locationName: 'Cathedral City', storeNumber: '1345',
    salesToday: 4100, paceToday: 7500, goalToday: 7200,
    last7Days: [5900, 6300, 5700, 6100, 6800, 6500, 4100],
    salesWtd: 41400, salesPrevWeek: 39800, salesMtd: 118900, salesPrevMonth: 121500,
    salesLastYearDay: 3900, laborPercent: 27.5, laborCost: 1128, laborCostWtd: 7900, laborCostMtd: 30400,
    hourlyData: [0,0,0,0,0,0,0,140,310,520,680,820,960,600,390,340,160,0,0,0,0,0,0,0],
  },
];

/** Global period selector pill */
function PeriodSelector({ period, onChange }: { period: OrgPeriod; onChange: (p: OrgPeriod) => void }) {
  return (
    <div className="flex bg-muted rounded-full p-[3px] gap-[2px]">
      {(['day', 'week', 'month'] as OrgPeriod[]).map(p => (
        <button
          key={p}
          onClick={() => onChange(p)}
          className={`text-xs font-semibold px-4 py-1.5 rounded-full transition-all ${
            period === p
              ? 'bg-primary text-primary-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          {p === 'day' ? 'Day' : p === 'week' ? 'Week' : 'Month'}
        </button>
      ))}
    </div>
  );
}

export default function MultiLocationDashboard() {
  const { organizationId: contextOrgId } = useAppLocation();
  const [searchParams] = useSearchParams();
  const urlOrgId = searchParams.get('org');
  const organizationId = urlOrgId || contextOrgId;

  const [previewMode, setPreviewMode] = useState(true);
  const [period, setPeriod] = useState<OrgPeriod>('day');
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // === Live mode state ===
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

  const handleToggleExpand = useCallback((locId: string) => {
    setExpandedId(prev => prev === locId ? null : locId);
  }, []);

  // Toolbar: collapse toggle + period selector
  const toolbar = (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <button
          onClick={() => { setIsCollapsed(prev => !prev); setExpandedId(null); }}
          className="p-1.5 rounded-lg bg-muted hover:bg-muted/80 transition-colors"
          title={isCollapsed ? 'Expand all' : 'Collapse all'}
        >
          {isCollapsed ? <LayoutList className="h-4 w-4 text-muted-foreground" /> : <List className="h-4 w-4 text-muted-foreground" />}
        </button>
        <span className="text-xs text-muted-foreground">
          {isCollapsed ? 'Collapsed' : 'Expanded'}
        </span>
      </div>
      <PeriodSelector period={period} onChange={setPeriod} />
    </div>
  );

  // Render card list helper
  const renderCards = (items: { id: string; data: OrgLocationData }[], loading = false) => (
    <div className={`space-y-${isCollapsed ? '1.5' : '3'}`} style={{ gap: isCollapsed ? '6px' : undefined }}>
      {items.map(item => (
        <OrgCubeStyleB
          key={item.id}
          data={item.data}
          period={period}
          isLoading={loading}
          collapsed={isCollapsed}
          expanded={expandedId === item.id}
          onToggleExpand={() => handleToggleExpand(item.id)}
        />
      ))}
    </div>
  );

  // Preview mode
  if (previewMode) {
    return (
      <Layout>
        <div className="space-y-4">
          <div className="text-center space-y-2">
            <h1 className="text-2xl md:text-3xl font-bold">Org Dashboard Preview</h1>
            <p className="text-sm text-muted-foreground">
              Style B: Glass Scoreboard — review with mock data, then go live.
            </p>
          </div>

          {toolbar}

          {renderCards(MOCK_DATA.map(m => ({ id: m.locationId, data: m })))}

          <div className="flex justify-center">
            <button
              onClick={() => { setPreviewMode(false); }}
              className="text-sm font-medium px-6 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              Go Live With This Style
            </button>
          </div>
        </div>
      </Layout>
    );
  }

  // Live mode
  return (
    <Layout>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-xl md:text-2xl font-bold">Org Dashboard</h1>
          <div className="flex items-center gap-3">
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

        {toolbar}

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
          <div className={`space-y-${isCollapsed ? '1.5' : '3'}`}>
            {[1, 2, 3].map(i => (
              <OrgCubeStyleB key={i} data={{} as OrgLocationData} isLoading collapsed={isCollapsed} />
            ))}
          </div>
        )}

        {!locsLoading && sortedLocationIds.length > 0 && renderCards(
          sortedLocationIds.map(locId => {
            const loc = allLocations.find(l => l.id === locId);
            const locData = locationData[locId];
            return {
              id: locId,
              data: {
                locationId: locId, locationName: loc?.name ?? '', storeNumber: loc?.store_number,
                salesToday: locData?.salesToday ?? 0, paceToday: locData?.paceToday ?? null,
                goalToday: locData?.goalToday ?? null, last7Days: locData?.last7Days ?? Array(7).fill(0),
                salesWtd: locData?.salesWtd ?? 0, salesPrevWeek: locData?.salesPrevWeek ?? null,
                salesMtd: locData?.salesMtd ?? 0, salesPrevMonth: locData?.salesPrevMonth ?? null,
                salesLastYearDay: locData?.salesLastYearDay ?? null,
                laborPercent: locData?.laborPercent ?? null, laborCost: locData?.laborCost ?? null,
                laborCostWtd: locData?.laborCostWtd ?? null, laborCostMtd: locData?.laborCostMtd ?? null,
                hourlyData: locData?.hourlyData ?? Array(24).fill(0),
              } as OrgLocationData,
            };
          }).filter(item => item.data.locationName),
          dataLoading,
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
