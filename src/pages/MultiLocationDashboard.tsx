import { useState, useMemo, useCallback } from 'react';
import { Layout } from '@/components/Layout';
import { useSearchParams } from 'react-router-dom';
import { useLocation as useAppLocation } from '@/hooks/useLocation';
import { useOrgLocations, useOrgLocationData, useBrandLocations } from '@/hooks/useOrgDashboardData';
import { OrgLocationData } from '@/components/org-dashboard/OrgLocationCube';
import { OrgSearchBar, SearchTag } from '@/components/org-dashboard/OrgSearchBar';
import { OrgCubeStyleB, OrgPeriod } from '@/components/org-dashboard/cube-styles/OrgCubeStyleB';
import { OrgTotalsBar } from '@/components/org-dashboard/OrgTotalsBar';
import { ChevronUp, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { formatInTimeZone } from 'date-fns-tz';

const LA_TZ = 'America/Los_Angeles';

function getLAToday(): string {
  return formatInTimeZone(new Date(), LA_TZ, 'yyyy-MM-dd');
}

/** Returns a date string offset by `days` from `dateStr` (yyyy-MM-dd) */
function offsetDate(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d + days, 12);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

function getMonday(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d, 12);
  const dow = dt.getDay();
  const off = dow === 0 ? 6 : dow - 1;
  dt.setDate(dt.getDate() - off);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

function getSunday(mondayStr: string): string {
  return offsetDate(mondayStr, 6);
}

function getMonthLabel(dateStr: string): string {
  const [y, m] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, 1);
  return dt.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

function getWeekLabel(dateStr: string): string {
  const mon = getMonday(dateStr);
  const sun = getSunday(mon);
  const [, mm, md] = mon.split('-').map(Number);
  const [, sm, sd] = sun.split('-').map(Number);
  const mDate = new Date(2026, mm - 1, md);
  const sDate = new Date(2026, sm - 1, sd);
  return `${mDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${sDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
}

function getDayLabel(dateStr: string, todayStr: string): string {
  if (dateStr === todayStr) return 'Today';
  const yesterday = offsetDate(todayStr, -1);
  if (dateStr === yesterday) return 'Yesterday';
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

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

/** Date navigation arrows + label */
function DateNavigator({ targetDate, period, onDateChange }: {
  targetDate: string;
  period: OrgPeriod;
  onDateChange: (d: string) => void;
}) {
  const todayStr = getLAToday();
  const isToday = targetDate === todayStr;
  const isFuture = targetDate > todayStr;

  const label = period === 'day'
    ? getDayLabel(targetDate, todayStr)
    : period === 'week'
      ? getWeekLabel(targetDate)
      : getMonthLabel(targetDate);

  const handlePrev = () => {
    if (period === 'day') {
      onDateChange(offsetDate(targetDate, -1));
    } else if (period === 'week') {
      onDateChange(offsetDate(targetDate, -7));
    } else {
      const [y, m] = targetDate.split('-').map(Number);
      const prev = new Date(y, m - 2, 1);
      onDateChange(`${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}-01`);
    }
  };

  const handleNext = () => {
    if (period === 'day') {
      const next = offsetDate(targetDate, 1);
      if (next <= todayStr) onDateChange(next);
    } else if (period === 'week') {
      const next = offsetDate(targetDate, 7);
      if (next <= todayStr) onDateChange(next);
    } else {
      const [y, m] = targetDate.split('-').map(Number);
      const next = new Date(y, m, 1);
      const nextStr = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-01`;
      if (nextStr.slice(0, 7) <= todayStr.slice(0, 7)) onDateChange(nextStr);
    }
  };

  const canGoForward = (() => {
    if (period === 'day') return offsetDate(targetDate, 1) <= todayStr;
    if (period === 'week') return offsetDate(targetDate, 7) <= todayStr;
    return targetDate.slice(0, 7) < todayStr.slice(0, 7);
  })();

  return (
    <div className="flex items-center justify-center gap-1">
      <button
        onClick={handlePrev}
        className="w-7 h-7 rounded-full flex items-center justify-center hover:bg-muted transition-colors"
      >
        <ChevronLeft className="h-4 w-4 text-muted-foreground" />
      </button>
      <button
        onClick={() => onDateChange(todayStr)}
        className={`text-xs font-semibold px-2 py-1 rounded-lg transition-colors min-w-[100px] text-center ${
          isToday ? 'text-primary' : 'text-foreground hover:text-primary'
        }`}
      >
        {label}
      </button>
      <button
        onClick={handleNext}
        disabled={!canGoForward}
        className="w-7 h-7 rounded-full flex items-center justify-center hover:bg-muted transition-colors disabled:opacity-30 disabled:pointer-events-none"
      >
        <ChevronRight className="h-4 w-4 text-muted-foreground" />
      </button>
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
  const [targetDate, setTargetDate] = useState<string>(getLAToday());

  // When period changes, snap targetDate appropriately
  const handlePeriodChange = useCallback((p: OrgPeriod) => {
    setPeriod(p);
    // When switching to month, snap to 1st of month
    if (p === 'month') {
      setTargetDate(prev => prev.slice(0, 8) + '01');
    }
  }, []);

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

  const { data: locationData = {}, isLoading: dataLoading } = useOrgLocationData(filteredLocationIds, targetDate, period);

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
          <PeriodSelector period={period} onChange={handlePeriodChange} />
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

        {/* Date navigation */}
        <DateNavigator targetDate={targetDate} period={period} onDateChange={setTargetDate} />

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
