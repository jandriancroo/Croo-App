import { useState, useMemo, useCallback } from 'react';
import { Layout } from '@/components/Layout';
import { useSearchParams } from 'react-router-dom';
import { useLocation as useAppLocation } from '@/hooks/useLocation';
import { useOrgLocations, useOrgLocationData, useBrandLocations } from '@/hooks/useOrgDashboardData';
import { OrgLocationData } from '@/components/org-dashboard/OrgLocationCube';
import { OrgSearchBar, SearchTag } from '@/components/org-dashboard/OrgSearchBar';
import { OrgCubeStyleB, OrgPeriod } from '@/components/org-dashboard/cube-styles/OrgCubeStyleB';
import { OrgTotalsBar } from '@/components/org-dashboard/OrgTotalsBar';
import { ChevronUp, ChevronDown } from 'lucide-react';

/** Compact D/W/M period selector */
function PeriodSelector({ period, onChange }: { period: OrgPeriod; onChange: (p: OrgPeriod) => void }) {
  return (
    <div className="flex bg-muted rounded-full p-[3px] gap-[2px]">
      {(['day', 'week', 'month'] as OrgPeriod[]).map(p => (
        <button
          key={p}
          onClick={(e) => { e.stopPropagation(); onChange(p); }}
          className={`text-xs font-bold px-3 py-1.5 rounded-full transition-all ${
            period === p
              ? 'bg-primary text-primary-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          {p === 'day' ? 'D' : p === 'week' ? 'W' : 'M'}
        </button>
      ))}
    </div>
  );
}

export default function MultiLocationDashboard() {
  const { organizationId: contextOrgId } = useAppLocation();
  const [searchParams] = useSearchParams();
  const urlOrgId = searchParams.get('org');
  const urlBrandId = searchParams.get('brand');
  const isBrandMode = !!urlBrandId;
  const organizationId = urlOrgId || contextOrgId;

  const [period, setPeriod] = useState<OrgPeriod>('day');
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [searchTags, setSearchTags] = useState<SearchTag[]>([]);

  // Use brand hook when brand param present, otherwise org hook
  const { data: orgLocations = [], isLoading: orgLocsLoading } = useOrgLocations(isBrandMode ? null : (organizationId ?? null));
  const { data: brandLocations = [], isLoading: brandLocsLoading } = useBrandLocations(isBrandMode ? urlBrandId : null);
  
  const allLocations = isBrandMode ? brandLocations : orgLocations;
  const locsLoading = isBrandMode ? brandLocsLoading : orgLocsLoading;

  const searchableLocations = useMemo(() =>
    allLocations.map(l => ({
      id: l.id,
      name: l.name,
      storeNumber: l.store_number,
      orgName: l.org_name,
      brandName: l.brand_name,
    })),
    [allLocations]
  );

  // Filter locations based on search tags
  const filteredLocationIds = useMemo(() => {
    if (searchTags.length === 0) return allLocations.map(l => l.id);

    const locIds = new Set<string>();
    for (const tag of searchTags) {
      if (tag.type === 'location') {
        locIds.add(tag.id);
      } else if (tag.type === 'org') {
        for (const loc of allLocations) {
          if (loc.org_name === tag.label) locIds.add(loc.id);
        }
      } else if (tag.type === 'brand') {
        for (const loc of allLocations) {
          if (loc.brand_name === tag.label) locIds.add(loc.id);
        }
      }
    }
    return Array.from(locIds);
  }, [searchTags, allLocations]);

  const { data: locationData = {}, isLoading: dataLoading } = useOrgLocationData(filteredLocationIds);

  const sortedLocationIds = useMemo(() => {
    return [...filteredLocationIds].sort((a, b) => {
      const aSales = locationData[a]?.salesToday ?? 0;
      const bSales = locationData[b]?.salesToday ?? 0;
      return bSales - aSales;
    });
  }, [filteredLocationIds, locationData]);

  const handleToggleExpand = useCallback((locId: string) => {
    setExpandedId(prev => prev === locId ? null : locId);
  }, []);

  const dashTitle = isBrandMode ? 'Brand Dashboard' : 'Org Dashboard';

  return (
    <Layout>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-xl md:text-2xl font-bold">{dashTitle}</h1>
          <span className="text-xs text-muted-foreground">
            {allLocations.length} store{allLocations.length !== 1 ? 's' : ''}
          </span>
        </div>

        {/* Toolbar: search + D/W/M + collapse */}
        <div className="flex items-center gap-2">
          <OrgSearchBar
            locations={searchableLocations}
            tags={searchTags}
            onTagsChange={setSearchTags}
          />
          <PeriodSelector period={period} onChange={setPeriod} />
          <button
            onClick={() => { setIsCollapsed(prev => !prev); setExpandedId(null); }}
            className="shrink-0 w-8 h-8 rounded-full bg-primary flex items-center justify-center hover:bg-primary/90 transition-colors"
            title={isCollapsed ? 'Expand all' : 'Collapse all'}
          >
            {isCollapsed
              ? <ChevronDown className="h-4 w-4 text-primary-foreground" />
              : <ChevronUp className="h-4 w-4 text-primary-foreground" />
            }
          </button>
        </div>

        {locsLoading && (
          <div className={`space-y-${isCollapsed ? '1.5' : '3'}`}>
            {[1, 2, 3].map(i => (
              <OrgCubeStyleB key={i} data={{} as OrgLocationData} isLoading collapsed={isCollapsed} />
            ))}
          </div>
        )}

        {!locsLoading && sortedLocationIds.length > 0 && (
          <div className={`space-y-${isCollapsed ? '1.5' : '3'}`} style={{ gap: isCollapsed ? '6px' : undefined }}>
            {sortedLocationIds.map(locId => {
              const loc = allLocations.find(l => l.id === locId);
              const locData = locationData[locId];
              if (!loc?.name) return null;
              return (
                <OrgCubeStyleB
                  key={locId}
                  data={{
                    locationId: locId, locationName: loc.name, storeNumber: loc.store_number,
                    salesToday: locData?.salesToday ?? 0, paceToday: locData?.paceToday ?? null,
                    goalToday: locData?.goalToday ?? null, last7Days: locData?.last7Days ?? Array(7).fill(0),
                    salesWtd: locData?.salesWtd ?? 0, salesPrevWeek: locData?.salesPrevWeek ?? null,
                    salesMtd: locData?.salesMtd ?? 0, salesPrevMonth: locData?.salesPrevMonth ?? null,
                    salesLastYearDay: locData?.salesLastYearDay ?? null,
                    laborPercent: locData?.laborPercent ?? null, laborCost: locData?.laborCost ?? null,
                    laborCostWtd: locData?.laborCostWtd ?? null, laborCostMtd: locData?.laborCostMtd ?? null,
                    hourlyData: locData?.hourlyData ?? Array(24).fill(0),
                  } as OrgLocationData}
                  period={period}
                  isLoading={dataLoading}
                  collapsed={isCollapsed}
                  expanded={expandedId === locId}
                  onToggleExpand={() => handleToggleExpand(locId)}
                />
              );
            })}
          </div>
        )}

        {!locsLoading && sortedLocationIds.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <p className="text-muted-foreground text-sm">
              {searchTags.length > 0 ? 'No stores match your search.' : 'No locations found.'}
            </p>
          </div>
        )}

        {/* Spacer for floating bar */}
        {sortedLocationIds.length >= 2 && <div className="h-20" />}
      </div>

      <OrgTotalsBar
        locationData={locationData}
        locationIds={sortedLocationIds}
        period={period}
      />
    </Layout>
  );
}
