import { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Layout } from '@/components/Layout';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { Progress } from '@/components/ui/progress';
import { Input } from '@/components/ui/input';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { 
  Users, 
  ClipboardCheck, 
  Clock,
  AlertTriangle,
  Building2,
  FileText,
  ChevronRight,
  Search,
  DollarSign
} from 'lucide-react';
import { format, startOfDay, endOfDay, startOfWeek, startOfMonth, endOfMonth, subYears } from 'date-fns';
import { ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, Legend, CartesianGrid } from 'recharts';
import { getCachedLiveSales, setCachedLiveSales } from '@/utils/salesCache';
import { PullToRefresh, setLastSyncTime } from '@/components/PullToRefresh';

interface ChecklistMetric {
  id: string;
  title: string;
  completedCount: number;
  totalCount: number;
  percent: number;
}

interface LocationSalesData {
  daily: { actual: number; projected: number; pacing: number; lastYear: number };
  weekly: { actual: number; projected: number; pacing: number; lastYear: number };
  monthly: { actual: number; projected: number; pacing: number; lastYear: number };
}

interface LaborData {
  laborPercent: number;
  laborCost: number;
  hoursWorked: number;
}

interface AuditSummary {
  id: string;
  audit_date: string;
  visit_score: string | null;
  manager_name: string | null;
}

interface LocationMetrics {
  id: string;
  name: string;
  store_number: string | null;
  organization_name: string | null;
  sales: LocationSalesData | null; // null = loading
  labor: LaborData | null; // null = not available or loading
  hasQuBeyond: boolean;
  hasLaborIntegration: boolean;
  checklists: ChecklistMetric[] | null; // null = loading
  clockedInCount: number | null; // null = loading
  scheduledCount: number | null;
  openShifts: number | null;
  latestAudit: AuditSummary | null;
  openTime: string | null;
  isOpen: boolean;
  hoursSinceOpen: number | null; // null = unknown/closed
}

// Cache key for localStorage
const MULTI_LOC_CACHE_KEY = 'multi_loc_dashboard_cache';
const CACHE_TTL_MS = 2 * 60 * 1000; // 2 minutes

interface CachedDashboard {
  timestamp: number;
  data: LocationMetrics[];
}

function getCachedDashboard(): LocationMetrics[] | null {
  try {
    const cached = localStorage.getItem(MULTI_LOC_CACHE_KEY);
    if (!cached) return null;
    const parsed: CachedDashboard = JSON.parse(cached);
    const age = Date.now() - parsed.timestamp;
    // Return cached data even if stale (stale-while-revalidate)
    if (age < CACHE_TTL_MS * 5) { // Keep for 10 minutes max
      return parsed.data;
    }
    return null;
  } catch {
    return null;
  }
}

function setCachedDashboard(data: LocationMetrics[]): void {
  try {
    const cacheEntry: CachedDashboard = {
      timestamp: Date.now(),
      data
    };
    localStorage.setItem(MULTI_LOC_CACHE_KEY, JSON.stringify(cacheEntry));
  } catch {
    // Ignore
  }
}

export default function MultiLocationDashboard() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [locations, setLocations] = useState<LocationMetrics[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasAccess, setHasAccess] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [defaultLocationId, setDefaultLocationId] = useState<string | null>(null);
  const [displayTimestamp, setDisplayTimestamp] = useState<Date>(new Date());

  // Query key for pull-to-refresh tracking
  const REFRESH_QUERY_KEY = [['multi-location-dashboard']];

  // Show cached data immediately while fetching fresh data
  useEffect(() => {
    const cached = getCachedDashboard();
    if (cached && cached.length > 0) {
      setLocations(cached);
      setHasAccess(true);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    checkAccessAndFetchData();
  }, [user?.id]);

  const checkAccessAndFetchData = async () => {
    if (!user?.id) return;

    try {
      // Parallel fetch for initial access check
      const [profileResult, isSuperAdminResult, orgMembershipsResult, brandMembershipsResult] = await Promise.all([
        supabase.from('profiles').select('default_location_id').eq('id', user.id).single(),
        supabase.rpc('is_super_admin', { _user_id: user.id }),
        supabase.from('organization_members').select('organization_id, org_role').eq('user_id', user.id).eq('org_role', 'admin'),
        supabase.from('brand_members').select('brand_id, brand_role').eq('user_id', user.id).eq('brand_role', 'admin')
      ]);

      const profile = profileResult.data;
      const isSuperAdmin = isSuperAdminResult.data;
      const orgMemberships = orgMembershipsResult.data;
      const brandMemberships = brandMembershipsResult.data;

      if (profile?.default_location_id) {
        setDefaultLocationId(profile.default_location_id);
      }

      const hasMultiAccess = isSuperAdmin || 
        (orgMemberships && orgMemberships.length > 0) || 
        (brandMemberships && brandMemberships.length > 0);

      setHasAccess(hasMultiAccess);

      if (!hasMultiAccess) {
        setLoading(false);
        return;
      }

      // Get org IDs including from brand memberships
      let orgIds = orgMemberships?.map(m => m.organization_id) || [];
      
      if (brandMemberships && brandMemberships.length > 0) {
        const brandIds = brandMemberships.map(b => b.brand_id);
        const { data: brandOrgs } = await supabase
          .from('organizations')
          .select('id')
          .in('brand_id', brandIds);
        
        if (brandOrgs) {
          orgIds.push(...brandOrgs.map(o => o.id));
        }
      }

      // Build locations query
      let locationsQuery = supabase
        .from('locations')
        .select(`
          id,
          name,
          store_number,
          organization_id,
          organizations(name)
        `)
        .neq('location_type', 'checklist_only')
        .order('name');

      if (!isSuperAdmin && orgIds.length > 0) {
        locationsQuery = locationsQuery.in('organization_id', orgIds);
      }

      const { data: locationsData } = await locationsQuery;

      if (!locationsData || locationsData.length === 0) {
        setLoading(false);
        return;
      }

      const locationIds = locationsData.map(l => l.id);
      const today = new Date();
      const todayStr = format(today, 'yyyy-MM-dd');
      const startOfToday = startOfDay(today).toISOString();
      const endOfToday = endOfDay(today).toISOString();
      const dayOfWeek = today.getDay();

      // Batch fetch all static data in parallel
      const [
        integrationsResult,
        clockedInResult,
        clockedOutResult,
        checklistsResult,
        auditsResult,
        hoursResult,
        scheduledResult
      ] = await Promise.all([
        supabase.from('location_integrations').select('location_id, id, credentials').in('location_id', locationIds).eq('integration_type', 'qubeyond').eq('is_active', true),
        supabase.from('time_punches').select('user_id, location_id').in('location_id', locationIds).eq('punch_type', 'clock_in').gte('punch_time', startOfToday).lte('punch_time', endOfToday),
        supabase.from('time_punches').select('user_id, location_id').in('location_id', locationIds).eq('punch_type', 'clock_out').gte('punch_time', startOfToday).lte('punch_time', endOfToday),
        supabase.from('checklists').select('id, title, frequency, location_id').in('location_id', locationIds).eq('is_active', true),
        supabase.from('food_safety_audits').select('id, audit_date, visit_score, manager_name, location_id').in('location_id', locationIds).order('audit_date', { ascending: false }),
        supabase.from('location_hours').select('location_id, open_time, is_closed').in('location_id', locationIds).eq('day_of_week', dayOfWeek),
        (supabase.from('scheduled_shifts' as any).select('id, location_id').in('location_id', locationIds).eq('shift_date', todayStr) as any)
      ]);

      // Get checklist items and submissions for all locations
      const checklistIds = checklistsResult.data?.map(c => c.id) || [];
      const [checklistItemsResult, submissionsResult] = await Promise.all([
        checklistIds.length > 0 
          ? supabase.from('checklist_items').select('id, checklist_id').in('checklist_id', checklistIds)
          : Promise.resolve({ data: [] }),
        supabase.from('checklist_submissions').select('id, checklist_id, location_id, checklist_responses(id)').in('location_id', locationIds).gte('submitted_at', startOfToday).lte('submitted_at', endOfToday)
      ]);

      // Build lookup maps
      const integrationsByLocation = new Map<string, { hasQuBeyond: boolean; hasLabor: boolean }>();
      integrationsResult.data?.forEach(i => {
        const credentials = i.credentials as { pull_labor?: boolean } | null;
        integrationsByLocation.set(i.location_id, {
          hasQuBeyond: true,
          hasLabor: credentials?.pull_labor === true
        });
      });
      
      const clockedOutByLocation = new Map<string, Set<string>>();
      clockedOutResult.data?.forEach(p => {
        if (!clockedOutByLocation.has(p.location_id)) {
          clockedOutByLocation.set(p.location_id, new Set());
        }
        clockedOutByLocation.get(p.location_id)!.add(p.user_id);
      });

      const clockedInByLocation = new Map<string, number>();
      clockedInResult.data?.forEach(p => {
        const outSet = clockedOutByLocation.get(p.location_id);
        if (!outSet?.has(p.user_id)) {
          clockedInByLocation.set(p.location_id, (clockedInByLocation.get(p.location_id) || 0) + 1);
        }
      });

      const scheduledByLocation = new Map<string, number>();
      scheduledResult.data?.forEach(s => {
        scheduledByLocation.set(s.location_id, (scheduledByLocation.get(s.location_id) || 0) + 1);
      });

      const itemCountByChecklist = new Map<string, number>();
      checklistItemsResult.data?.forEach(item => {
        itemCountByChecklist.set(item.checklist_id, (itemCountByChecklist.get(item.checklist_id) || 0) + 1);
      });

      const submissionByLocationChecklist = new Map<string, Map<string, { completed: number; total: number }>>();
      submissionsResult.data?.forEach(sub => {
        if (!submissionByLocationChecklist.has(sub.location_id)) {
          submissionByLocationChecklist.set(sub.location_id, new Map());
        }
        const responseCount = (sub.checklist_responses as any[])?.length || 0;
        const totalItems = itemCountByChecklist.get(sub.checklist_id) || 0;
        submissionByLocationChecklist.get(sub.location_id)!.set(sub.checklist_id, { completed: responseCount, total: totalItems });
      });

      const auditsByLocation = new Map<string, AuditSummary>();
      auditsResult.data?.forEach(audit => {
        if (!auditsByLocation.has(audit.location_id)) {
          auditsByLocation.set(audit.location_id, {
            id: audit.id,
            audit_date: audit.audit_date,
            visit_score: audit.visit_score,
            manager_name: audit.manager_name
          });
        }
      });

      const hoursByLocation = new Map<string, { open_time: string | null; is_closed: boolean }>();
      hoursResult.data?.forEach(h => {
        hoursByLocation.set(h.location_id, { open_time: h.open_time, is_closed: h.is_closed });
      });

      // Build initial location metrics (without sales - those load async)
      const initialMetrics: LocationMetrics[] = locationsData.map(loc => {
        const integration = integrationsByLocation.get(loc.id);
        const hasQuBeyond = integration?.hasQuBeyond || false;
        const hasLaborIntegration = integration?.hasLabor || false;
        const clockedInCount = clockedInByLocation.get(loc.id) || 0;
        const scheduledCount = scheduledByLocation.get(loc.id) || 0;
        
        const locationChecklists = checklistsResult.data?.filter(c => c.location_id === loc.id) || [];
        const locationSubmissions = submissionByLocationChecklist.get(loc.id);
        
        const checklistMetrics: ChecklistMetric[] = locationChecklists.map(cl => {
          const submission = locationSubmissions?.get(cl.id);
          const totalCount = itemCountByChecklist.get(cl.id) || 0;
          const completedCount = submission?.completed || 0;
          const percent = totalCount > 0 ? Math.min(100, (completedCount / totalCount) * 100) : 0;
          
          return { id: cl.id, title: cl.title, completedCount, totalCount, percent };
        });

        const hours = hoursByLocation.get(loc.id);
        let openTime: string | null = null;
        let isOpen = true;
        let hoursSinceOpen: number | null = null;
        
        if (hours && !hours.is_closed && hours.open_time) {
          const [h, m] = hours.open_time.split(':').map(Number);
          const openDateTime = new Date(today);
          openDateTime.setHours(h, m, 0, 0);
          isOpen = today >= openDateTime;
          // Always set openTime so we can display it when store has no sales yet
          openTime = format(openDateTime, 'h:mm a');
          // Calculate hours since open
          if (isOpen) {
            hoursSinceOpen = (today.getTime() - openDateTime.getTime()) / (1000 * 60 * 60);
          }
        }

        return {
          id: loc.id,
          name: loc.name,
          store_number: loc.store_number,
          organization_name: (loc.organizations as any)?.name || null,
          sales: hasQuBeyond ? null : { daily: { actual: 0, projected: 0, pacing: 0, lastYear: 0 }, weekly: { actual: 0, projected: 0, pacing: 0, lastYear: 0 }, monthly: { actual: 0, projected: 0, pacing: 0, lastYear: 0 } },
          labor: hasLaborIntegration ? null : null, // Will be loaded with sales
          hasQuBeyond,
          hasLaborIntegration,
          checklists: checklistMetrics,
          clockedInCount,
          scheduledCount,
          openShifts: Math.max(0, scheduledCount - clockedInCount),
          latestAudit: auditsByLocation.get(loc.id) || null,
          openTime,
          isOpen,
          hoursSinceOpen,
        };
      });

      // Set initial data immediately (fast first paint)
      setLocations(initialMetrics);
      setLoading(false);
      setDisplayTimestamp(new Date());
      // Mark this as the initial sync time for pull-to-refresh throttling
      setLastSyncTime('multi-location-dashboard');

      // Fetch sales data in parallel for locations with QuBeyond
      const locationsWithQuBeyond = initialMetrics.filter(l => l.hasQuBeyond);
      
      if (locationsWithQuBeyond.length > 0) {
        const weekStart = startOfWeek(today, { weekStartsOn: 1 });
        const monthStart = startOfMonth(today);
        
        // Fetch all sales in parallel (batch of 5 at a time to avoid overwhelming)
        const batchSize = 5;
        const batches: LocationMetrics[][] = [];
        for (let i = 0; i < locationsWithQuBeyond.length; i += batchSize) {
          batches.push(locationsWithQuBeyond.slice(i, i + batchSize));
        }

        for (const batch of batches) {
          const salesPromises = batch.map(async (loc) => {
            try {
              // Check cache first
              const cached = getCachedLiveSales(loc.id);
              let salesResponse = cached?.data;
              let lastYearResponse: any = null;

              if (!cached || cached.isStale) {
                // Fetch current and last year in parallel
                const lastYearDate = subYears(today, 1);
                const lastYearStr = format(lastYearDate, 'yyyy-MM-dd');
                
                const [currentResult, lyResult] = await Promise.all([
                  supabase.functions.invoke('fetch-qubeyond-sales', { body: { locationId: loc.id, targetDate: todayStr } }),
                  supabase.functions.invoke('fetch-qubeyond-sales', { body: { locationId: loc.id, targetDate: lastYearStr } })
                ]);

                salesResponse = currentResult.data;
                lastYearResponse = lyResult.data;

                if (salesResponse) {
                  setCachedLiveSales(loc.id, salesResponse);
                }
              }

              if (salesResponse) {
                const salesData: LocationSalesData = {
                  daily: {
                    actual: salesResponse.daily || 0,
                    projected: salesResponse.projections?.todayProjected || 0,
                    pacing: salesResponse.projections?.todayPaceAdjusted || salesResponse.projections?.todayProjected || 0,
                    lastYear: lastYearResponse?.daily || 0
                  },
                  weekly: {
                    actual: salesResponse.weekly || 0,
                    projected: salesResponse.projections?.weekProjected || 0,
                    pacing: calculatePacing(salesResponse.weekly, salesResponse.projections?.weekProjected, weekStart, today),
                    lastYear: lastYearResponse?.weekly || 0
                  },
                  monthly: {
                    actual: salesResponse.monthly || 0,
                    projected: salesResponse.projections?.monthProjected || 0,
                    pacing: calculatePacing(salesResponse.monthly, salesResponse.projections?.monthProjected, monthStart, today),
                    lastYear: lastYearResponse?.monthly || 0
                  }
                };

                // Extract labor data if available
                const laborData: LaborData | null = salesResponse.labor ? {
                  laborPercent: salesResponse.labor.laborPercent || 0,
                  laborCost: salesResponse.labor.laborCost || 0,
                  hoursWorked: salesResponse.labor.hoursWorked || 0
                } : null;

                return { locationId: loc.id, sales: salesData, labor: laborData };
              }
            } catch (error) {
              console.error(`Error fetching sales for ${loc.name}:`, error);
            }
            return { locationId: loc.id, sales: null, labor: null };
          });

          const salesResults = await Promise.all(salesPromises);

          // Update locations with sales data progressively
          setLocations(prev => {
            const updated = prev.map(loc => {
              const salesResult = salesResults.find(r => r.locationId === loc.id);
              if (salesResult?.sales) {
                return { 
                  ...loc, 
                  sales: salesResult.sales,
                  labor: salesResult.labor || loc.labor
                };
              }
              return loc;
            });
            // Cache the updated data
            setCachedDashboard(updated);
            return updated;
          });
        }
      } else {
        setCachedDashboard(initialMetrics);
      }
    } catch (error) {
      console.error('Error fetching multi-location data:', error);
      setLoading(false);
    }
  };

  const calculatePacing = (actual: number, projected: number, periodStart: Date, now: Date) => {
    if (!projected || projected === 0) return actual;
    const periodEnd = endOfMonth(periodStart);
    const totalDays = Math.ceil((periodEnd.getTime() - periodStart.getTime()) / (1000 * 60 * 60 * 24));
    const elapsedDays = Math.ceil((now.getTime() - periodStart.getTime()) / (1000 * 60 * 60 * 24));
    const expectedPercent = elapsedDays / totalDays;
    return (actual / expectedPercent);
  };

  const formatLocationName = (name: string, storeNumber: string | null) => {
    // Just return name, store number is shown in the badge
    return name;
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', { 
      style: 'currency', 
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(amount);
  };

  const formatCurrencyCompact = (amount: number) => {
    if (amount >= 1000000) {
      return `$${(amount / 1000000).toFixed(1)}M`;
    }
    if (amount >= 100000) {
      return `$${Math.round(amount / 1000)}K`;
    }
    if (amount >= 10000) {
      return `$${(amount / 1000).toFixed(1)}K`;
    }
    return formatCurrency(amount);
  };

  const getCompletionColor = (percent: number) => {
    if (percent >= 100) return 'text-green-600';
    if (percent >= 50) return 'text-amber-600';
    return 'text-red-600';
  };

  const formatLastYearComparison = (actual: number, lastYear: number) => {
    if (!lastYear || lastYear === 0) return null;
    const diff = actual - lastYear;
    const percent = ((diff / lastYear) * 100).toFixed(1);
    const isPositive = diff >= 0;
    return { diff, percent, isPositive, lastYear };
  };

  // Unified chart - bars for actuals, line for projections/pace
  const SalesChart = ({ sales, period }: { sales: LocationSalesData; period: 'daily' | 'weekly' | 'monthly' }) => {
    const data = sales[period];
    const lyComparison = formatLastYearComparison(data.actual, data.lastYear);
    
    // Single data point for the current period
    const chartData = [
      { 
        name: period === 'daily' ? 'Today' : period === 'weekly' ? 'This Week' : 'This Month',
        actual: data.actual,
        projected: data.projected,
        pace: data.pacing
      }
    ];

    const maxVal = Math.max(data.actual, data.projected, data.pacing, 1);

    return (
      <div className="w-full">
        <div className="flex items-center gap-4 mb-2">
          {/* Actual */}
          <div className="flex-1">
            <div className="flex items-center gap-1.5 mb-0.5">
              <div className="w-3 h-3 rounded-sm bg-orange-500" />
              <span className="text-[10px] text-muted-foreground uppercase tracking-wide">Actual</span>
            </div>
            <p className="text-lg font-bold">{formatCurrencyCompact(data.actual)}</p>
          </div>
          {/* Projected */}
          <div className="flex-1">
            <div className="flex items-center gap-1.5 mb-0.5">
              <div className="w-3 h-0.5 bg-amber-700 rounded" />
              <span className="text-[10px] text-muted-foreground uppercase tracking-wide">Projected</span>
            </div>
            <p className="text-lg font-semibold text-muted-foreground">{formatCurrencyCompact(data.projected)}</p>
          </div>
          {/* Pace */}
          <div className="flex-1">
            <div className="flex items-center gap-1.5 mb-0.5">
              <div className="w-3 h-3 rounded-sm bg-emerald-500" />
              <span className="text-[10px] text-muted-foreground uppercase tracking-wide">Pace</span>
            </div>
            <p className={`text-lg font-bold ${data.pacing >= data.projected ? 'text-emerald-600' : 'text-amber-600'}`}>
              {formatCurrencyCompact(data.pacing)}
            </p>
          </div>
        </div>
        
        {/* Progress bar visualization */}
        <div className="space-y-1.5">
          {/* Actual bar */}
          <div className="flex items-center gap-2">
            <div className="w-16 text-[10px] text-muted-foreground">Actual</div>
            <div className="flex-1 h-4 bg-muted/30 rounded-full overflow-hidden relative">
              <div 
                className="h-full bg-gradient-to-r from-orange-500 to-orange-400 rounded-full transition-all duration-500"
                style={{ width: `${Math.min(100, (data.actual / maxVal) * 100)}%` }}
              />
              {/* Projected line marker */}
              <div 
                className="absolute top-0 h-full w-0.5 bg-amber-700"
                style={{ left: `${Math.min(100, (data.projected / maxVal) * 100)}%` }}
              />
            </div>
          </div>
          {/* Pace bar */}
          <div className="flex items-center gap-2">
            <div className="w-16 text-[10px] text-muted-foreground">Pace</div>
            <div className="flex-1 h-4 bg-muted/30 rounded-full overflow-hidden relative">
              <div 
                className={`h-full rounded-full transition-all duration-500 ${
                  data.pacing >= data.projected 
                    ? 'bg-gradient-to-r from-emerald-500 to-emerald-400' 
                    : 'bg-gradient-to-r from-amber-500 to-amber-400'
                }`}
                style={{ width: `${Math.min(100, (data.pacing / maxVal) * 100)}%` }}
              />
              {/* Projected line marker */}
              <div 
                className="absolute top-0 h-full w-0.5 bg-amber-700"
                style={{ left: `${Math.min(100, (data.projected / maxVal) * 100)}%` }}
              />
            </div>
          </div>
        </div>

        {lyComparison && (
          <p className={`text-xs mt-2 font-medium ${lyComparison.isPositive ? 'text-green-600' : 'text-red-600'}`}>
            vs LY: {formatCurrencyCompact(lyComparison.lastYear)} ({lyComparison.isPositive ? '+' : ''}{lyComparison.percent}%)
          </p>
        )}
      </div>
    );
  };

  // Backwards compatible wrappers
  const DailySalesChart = ({ sales }: { sales: LocationSalesData }) => <SalesChart sales={sales} period="daily" />;
  const PeriodSalesChart = ({ sales, period }: { sales: LocationSalesData; period: 'weekly' | 'monthly' }) => <SalesChart sales={sales} period={period} />;

  // Loading skeleton for sales section
  const SalesLoadingSkeleton = () => (
    <div className="space-y-2">
      <Skeleton className="h-4 w-24" />
      <Skeleton className="h-[80px] w-full" />
    </div>
  );

  const navigateToChecklist = (locationId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    navigate(`/tasks?location=${locationId}`);
  };

  const navigateToAudit = (locationId: string) => {
    navigate(`/settings?location=${locationId}&tab=audits`);
  };

  const sortedAndFilteredLocations = useMemo(() => {
    // Filter by search
    let filtered = locations;
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = locations.filter(loc => 
        loc.name.toLowerCase().includes(query) ||
        loc.store_number?.toLowerCase().includes(query) ||
        loc.organization_name?.toLowerCase().includes(query)
      );
    }

    // Sort by store number (numeric), with default location at top
    return [...filtered].sort((a, b) => {
      // Default location always first
      if (a.id === defaultLocationId) return -1;
      if (b.id === defaultLocationId) return 1;

      // Then sort by store number numerically
      const aNum = parseInt(a.store_number || '9999', 10);
      const bNum = parseInt(b.store_number || '9999', 10);
      return aNum - bNum;
    });
  }, [locations, searchQuery, defaultLocationId]);

  const totals = locations.reduce(
    (acc, loc) => ({
      clockedIn: acc.clockedIn + (loc.clockedInCount || 0),
      scheduled: acc.scheduled + (loc.scheduledCount || 0),
      checklistsCompleted: acc.checklistsCompleted + (loc.checklists?.filter(c => c.percent >= 100).length || 0),
      totalChecklists: acc.totalChecklists + (loc.checklists?.length || 0),
    }),
    { clockedIn: 0, scheduled: 0, checklistsCompleted: 0, totalChecklists: 0 }
  );

  if (loading && locations.length === 0) {
    return (
      <Layout>
        <div className="space-y-6">
          <Skeleton className="h-10 w-64" />
          <div className="space-y-4">
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-[200px]" />
            ))}
          </div>
        </div>
      </Layout>
    );
  }

  if (!hasAccess) {
    return (
      <Layout>
        <Card>
          <CardContent className="p-6 text-center">
            <Building2 className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h2 className="text-xl font-semibold mb-2">Multi-Location Dashboard</h2>
            <p className="text-muted-foreground">
              This dashboard is only available to organization administrators and brand managers.
            </p>
          </CardContent>
        </Card>
      </Layout>
    );
  }

  // Handle pull-to-refresh callback
  const handleRefresh = useCallback((timestamp: Date, wasActualRefresh: boolean) => {
    setDisplayTimestamp(timestamp);
    if (wasActualRefresh) {
      // Trigger actual data refetch
      checkAccessAndFetchData();
    }
  }, []);

  return (
    <Layout>
      <PullToRefresh
        queryKeys={REFRESH_QUERY_KEY}
        cooldownMs={2 * 60 * 1000}
        onRefresh={handleRefresh}
      >
        <div className="space-y-6 pb-6">
          {/* Header with gradient accent */}
          <div className="relative">
            <div className="absolute -inset-x-4 -top-4 h-32 bg-gradient-to-br from-primary/5 via-primary/10 to-transparent rounded-3xl -z-10" />
            <div className="flex items-end justify-between">
              <div>
                <h1 className="text-3xl font-bold tracking-tight">Overview</h1>
                <p className="text-muted-foreground mt-1 flex items-center gap-2">
                  {format(new Date(), 'EEEE, MMMM d, yyyy')}
                  <span className="text-xs text-muted-foreground/60">
                    • {format(displayTimestamp, 'h:mm a')}
                  </span>
                </p>
              </div>
              <Badge variant="outline" className="text-xs font-medium">
                {locations.length} locations
              </Badge>
            </div>
          </div>

          {/* Search bar - only show when more than 5 locations */}
          {locations.length > 5 && (
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search locations..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>
          )}

          {/* Location Cards */}
          <div className="space-y-3">
          {sortedAndFilteredLocations.map((loc, index) => (
            <Card 
              key={loc.id} 
              className={`cursor-pointer transition-all duration-200 hover:shadow-md hover:border-primary/20 ${
                loc.id === defaultLocationId ? 'ring-2 ring-primary/20 border-primary/30' : ''
              }`}
              onClick={() => navigate(`/location/${loc.id}`)}
            >
              <CardContent className="p-4">
                <div className="flex flex-col lg:flex-row lg:items-start gap-4">
                  {/* Location Header */}
                  <div className="lg:w-48 flex-shrink-0">
                    <div className="flex items-center justify-between lg:flex-col lg:items-start gap-2">
                      <div className="flex items-center gap-2">
                        <div className="hidden lg:flex h-8 w-8 rounded-lg bg-gradient-to-br from-primary/20 to-primary/10 items-center justify-center text-sm font-bold text-primary">
                          {loc.store_number || (index + 1)}
                        </div>
                        <div>
                          <h3 className="font-semibold text-base leading-tight">
                            {formatLocationName(loc.name, loc.store_number)}
                          </h3>
                          {loc.organization_name && (
                            <p className="text-xs text-muted-foreground">{loc.organization_name}</p>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {loc.hasQuBeyond && loc.sales && loc.sales.daily.pacing > 0 && loc.sales.daily.actual >= 100 ? (() => {
                          const inGracePeriod = loc.hoursSinceOpen !== null && loc.hoursSinceOpen < 2;
                          const paceVsProjection = loc.sales.daily.projected > 0 
                            ? (loc.sales.daily.pacing / loc.sales.daily.projected) * 100 
                            : 0;
                          
                          const isAhead = paceVsProjection >= 105;
                          const isOnTrack = paceVsProjection >= 95 && paceVsProjection < 105;
                          const isBehind = paceVsProjection < 95;
                          const showWarmingUp = inGracePeriod && isBehind;
                          
                          return (
                            <Badge 
                              variant="outline" 
                              className={`text-xs font-medium ${
                                isAhead
                                  ? 'border-orange-400/50 text-orange-600 bg-orange-50 dark:bg-orange-950/50'
                                  : isOnTrack 
                                    ? 'border-emerald-400/50 text-emerald-600 bg-emerald-50 dark:bg-emerald-950/50' 
                                    : showWarmingUp
                                      ? 'border-amber-400/50 text-amber-600 bg-amber-50 dark:bg-amber-950/50'
                                      : 'border-sky-400/50 text-sky-600 bg-sky-50 dark:bg-sky-950/50'
                              }`}
                            >
                              {isAhead ? '🔥 On Fire' : isOnTrack ? '✓ On Track' : showWarmingUp ? '☕ Warming Up' : '↓ Behind'}
                            </Badge>
                          );
                        })() : !loc.isOpen && loc.openTime ? (
                          <Badge variant="secondary" className="text-xs font-medium">
                            Opens {loc.openTime}
                          </Badge>
                        ) : null}
                        <div className="flex items-center gap-1.5 text-sm bg-muted/50 px-2 py-0.5 rounded-full">
                          <Users className="h-3 w-3 text-muted-foreground" />
                          <span className="font-medium">{loc.clockedInCount ?? '-'}</span>
                          <span className="text-muted-foreground">/</span>
                          <span className="text-muted-foreground">{loc.scheduledCount ?? '-'}</span>
                        </div>
                      </div>
                    </div>
                    {(loc.openShifts ?? 0) > 0 && (
                      <div className="flex items-center gap-1.5 text-amber-600 text-xs mt-2 bg-amber-50 dark:bg-amber-950/50 px-2 py-1 rounded-md w-fit">
                        <AlertTriangle className="h-3 w-3" />
                        <span className="font-medium">{loc.openShifts} open shift{loc.openShifts !== 1 ? 's' : ''}</span>
                      </div>
                    )}
                  </div>

                  {/* Sales Section */}
                  {loc.hasQuBeyond && (
                    <div className="flex-1 min-w-0" onClick={(e) => e.stopPropagation()}>
                      {loc.sales ? (
                        <div>
                          <div className="flex items-center gap-3 mb-2">
                            <Tabs defaultValue="daily" className="w-full">
                              <div className="flex items-center justify-between">
                                <TabsList className="h-7">
                                  <TabsTrigger value="daily" className="text-xs px-3 h-6">Day</TabsTrigger>
                                  <TabsTrigger value="weekly" className="text-xs px-3 h-6">Week</TabsTrigger>
                                  <TabsTrigger value="monthly" className="text-xs px-3 h-6">Month</TabsTrigger>
                                </TabsList>
                                {/* Labor Indicator */}
                                {loc.hasLaborIntegration && loc.labor && loc.labor.laborPercent > 0 && (
                                  <div className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium ${
                                    loc.labor.laborPercent <= 25 
                                      ? 'bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-400' 
                                      : loc.labor.laborPercent <= 30 
                                        ? 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400'
                                        : 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400'
                                  }`}>
                                    <DollarSign className="h-3 w-3" />
                                    <span>Labor: {loc.labor.laborPercent.toFixed(1)}%</span>
                                  </div>
                                )}
                              </div>
                              <TabsContent value="daily" className="mt-2">
                                <DailySalesChart sales={loc.sales} />
                              </TabsContent>
                              <TabsContent value="weekly" className="mt-2">
                                <PeriodSalesChart sales={loc.sales} period="weekly" />
                              </TabsContent>
                              <TabsContent value="monthly" className="mt-2">
                                <PeriodSalesChart sales={loc.sales} period="monthly" />
                              </TabsContent>
                            </Tabs>
                          </div>
                        </div>
                      ) : (
                        <SalesLoadingSkeleton />
                      )}
                    </div>
                  )}

                  {!loc.hasQuBeyond && (
                    <div className="flex-1 flex items-center justify-center py-6 text-sm text-muted-foreground border border-dashed rounded-xl bg-muted/10">
                      <div className="text-center">
                        <DollarSign className="h-5 w-5 mx-auto mb-1 opacity-40" />
                        <span className="text-xs">No sales data</span>
                      </div>
                    </div>
                  )}

                  {/* Checklists Section */}
                  <div 
                    className="lg:w-64 flex-shrink-0 space-y-2 cursor-pointer hover:bg-muted/40 rounded-xl p-2 -m-2 transition-all"
                    onClick={(e) => navigateToChecklist(loc.id, e)}
                  >
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                        <ClipboardCheck className="h-3.5 w-3.5" />
                        Checklists
                      </p>
                      <ChevronRight className="h-4 w-4 text-muted-foreground/50" />
                    </div>
                    {(loc.checklists?.length || 0) > 0 ? (
                      <div className="space-y-1.5">
                        {loc.checklists?.map((cl) => (
                          <div key={cl.id} className="flex items-center gap-2">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between text-xs mb-0.5">
                                <span className="truncate font-medium">{cl.title}</span>
                                <span className={`font-semibold ml-1 ${getCompletionColor(cl.percent)}`}>
                                  {cl.percent.toFixed(0)}%
                                </span>
                              </div>
                              <Progress value={cl.percent} className="h-1.5" />
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground/60 italic">No checklists</p>
                    )}
                  </div>

                  {/* Audit Section */}
                  <div 
                    className="lg:w-44 flex-shrink-0 cursor-pointer group"
                    onClick={(e) => {
                      e.stopPropagation();
                      navigateToAudit(loc.id);
                    }}
                  >
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5 mb-2">
                      <FileText className="h-3.5 w-3.5" />
                      Latest Audit
                    </p>
                    {loc.latestAudit ? (
                      <div className="bg-gradient-to-br from-muted/40 to-muted/20 rounded-xl p-3 group-hover:from-muted/60 group-hover:to-muted/40 transition-all border border-border/50">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs text-muted-foreground">
                            {format(new Date(loc.latestAudit.audit_date), 'MMM d')}
                          </span>
                          {loc.latestAudit.visit_score && (
                            <Badge className="font-bold text-xs bg-primary/10 text-primary border-0 hover:bg-primary/20">
                              {loc.latestAudit.visit_score}
                            </Badge>
                          )}
                        </div>
                        {loc.latestAudit.manager_name && (
                          <p className="text-xs text-muted-foreground truncate">
                            {loc.latestAudit.manager_name}
                          </p>
                        )}
                      </div>
                    ) : (
                      <div className="bg-muted/20 rounded-xl p-3 border border-dashed border-border/50">
                        <p className="text-xs text-muted-foreground/60 italic">No audits yet</p>
                      </div>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
          </div>
        </div>
      </PullToRefresh>
    </Layout>
  );
}
