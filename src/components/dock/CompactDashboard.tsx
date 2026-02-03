import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence, PanInfo } from 'framer-motion';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { format } from 'date-fns';
import { 
  DollarSign, 
  TrendingUp, 
  TrendingDown, 
  Target, 
  Flame,
  ChevronDown
} from 'lucide-react';
import { useLocation as useAppLocation } from '@/hooks/useLocation';
import { useLocationTimezone } from '@/hooks/useLocationTimezone';
import { resolveProjection } from '@/hooks/useResolvedProjection';
import { cn } from '@/lib/utils';

interface CompactDashboardProps {
  isExpanded: boolean;
  onClose: () => void;
  onDragEnd: (info: PanInfo) => void;
}

export const CompactDashboard = ({ isExpanded, onClose, onDragEnd }: CompactDashboardProps) => {
  const { currentLocation } = useAppLocation();
  const { timezone, getTodayInTimezone: getTodayStr } = useLocationTimezone();
  const locationId = currentLocation?.id;
  
  const [currentTime, setCurrentTime] = useState(new Date());
  
  // Update time every second
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const todayStr = useMemo(() => getTodayStr(), [getTodayStr]);
  
  // Format time in location timezone
  const formattedTime = useMemo(() => {
    try {
      return new Intl.DateTimeFormat('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        second: '2-digit',
        hour12: true,
        timeZone: timezone,
      }).format(currentTime);
    } catch {
      return format(currentTime, 'h:mm:ss a');
    }
  }, [currentTime, timezone]);

  // Fetch sales data from sales_cache
  const { data: salesData } = useQuery({
    queryKey: ['compact-dash-sales', locationId, todayStr],
    queryFn: async () => {
      if (!locationId) return null;
      const { data, error } = await supabase
        .from('sales_cache')
        .select('net_sales, hourly_data, projected_sales, initial_projection, living_projection, override_projection')
        .eq('location_id', locationId)
        .eq('sale_date', todayStr)
        .maybeSingle();

      if (error) throw error;
      return data;
    },
    enabled: !!locationId && isExpanded,
    refetchInterval: isExpanded ? 60000 : false,
  });

  // Fetch labor data
  const { data: laborData } = useQuery({
    queryKey: ['compact-dash-labor', locationId, todayStr],
    queryFn: async () => {
      if (!locationId) return null;
      const { data, error } = await supabase
        .from('labor_cache')
        .select('labor_hours, labor_cost')
        .eq('location_id', locationId)
        .eq('labor_date', todayStr)
        .maybeSingle();

      if (error) throw error;
      return data;
    },
    enabled: !!locationId && isExpanded,
    refetchInterval: isExpanded ? 60000 : false,
  });

  // Fetch labor target
  const { data: locationSettings } = useQuery({
    queryKey: ['compact-dash-settings', locationId],
    queryFn: async () => {
      if (!locationId) return null;
      const { data, error } = await supabase
        .from('location_settings')
        .select('labor_percentage_target')
        .eq('location_id', locationId)
        .maybeSingle();

      if (error) throw error;
      return data;
    },
    enabled: !!locationId && isExpanded,
  });

  // Calculate metrics
  const totalSales = salesData?.net_sales || 0;
  const resolvedProjection = resolveProjection(salesData);
  const projectedSales = resolvedProjection.value || 0;
  
  // Calculate pace percentage
  const pacePercentage = projectedSales > 0 ? (totalSales / projectedSales) * 100 : 0;
  
  // Labor calculations
  const laborCost = laborData?.labor_cost || 0;
  const laborTarget = locationSettings?.labor_percentage_target || 25;
  const laborPercentage = totalSales > 0 ? (laborCost / totalSales) * 100 : 0;
  const laborDiff = laborPercentage - laborTarget;
  
  // Determine labor status
  const laborStatus = laborDiff <= 0 ? 'good' : laborDiff <= 3 ? 'warning' : 'bad';
  
  // Calculate target labor cost
  const targetLaborCost = (totalSales * laborTarget) / 100;
  const laborSavings = targetLaborCost - laborCost;

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', { 
      style: 'currency', 
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(value);
  };

  // Get pace status badge
  const getPaceStatus = () => {
    if (totalSales < 100) return null;
    if (pacePercentage >= 110) return { label: 'On Fire', icon: Flame, color: 'text-orange-500' };
    if (pacePercentage >= 105) return { label: 'Ahead', icon: TrendingUp, color: 'text-green-500' };
    if (pacePercentage >= 95) return { label: 'On Track', icon: Target, color: 'text-blue-500' };
    return { label: 'Behind', icon: TrendingDown, color: 'text-red-500' };
  };

  const paceStatus = getPaceStatus();

  return (
    <AnimatePresence>
      {isExpanded && (
        <motion.div
          initial={{ y: '100%' }}
          animate={{ y: 0 }}
          exit={{ y: '100%' }}
          transition={{ type: 'spring', damping: 30, stiffness: 300 }}
          drag="y"
          dragConstraints={{ top: 0, bottom: 0 }}
          dragElastic={{ top: 0, bottom: 0.3 }}
          onDragEnd={(_, info) => onDragEnd(info)}
          className="fixed bottom-0 left-0 right-0 z-[60] bg-accent rounded-t-3xl"
          style={{ height: '60vh', touchAction: 'none' }}
        >
          {/* Drag Handle */}
          <div className="flex justify-center pt-3 pb-2">
            <div className="w-12 h-1.5 bg-accent-foreground/30 rounded-full" />
          </div>
          
          {/* Close hint */}
          <button 
            onClick={onClose}
            className="absolute top-3 right-4 text-accent-foreground/50 hover:text-accent-foreground transition-colors"
          >
            <ChevronDown className="h-6 w-6" />
          </button>

          {/* Content */}
          <div className="px-4 pb-safe overflow-y-auto" style={{ maxHeight: 'calc(60vh - 60px)' }}>
            {/* Large Time Display */}
            <div className="text-center mb-6">
              <h1 className="text-5xl font-bold text-accent-foreground tracking-tight tabular-nums">
                {formattedTime}
              </h1>
              <p className="text-accent-foreground/60 text-sm mt-1">
                {format(currentTime, 'EEEE, MMMM d')}
              </p>
            </div>

            {/* Sales & Pace Cards */}
            <div className="grid grid-cols-2 gap-3 mb-4">
              {/* Total Sales Card */}
              <div className="bg-accent-foreground/10 rounded-2xl p-4">
                <div className="flex items-center gap-2 mb-2">
                  <DollarSign className="h-5 w-5 text-green-500" />
                  <span className="text-accent-foreground/70 text-sm">Sales</span>
                </div>
                <p className="text-2xl font-bold text-accent-foreground">
                  {formatCurrency(totalSales)}
                </p>
                <p className="text-accent-foreground/50 text-xs mt-1">
                  of {formatCurrency(projectedSales)} projected
                </p>
              </div>

              {/* Pace Card */}
              <div className="bg-accent-foreground/10 rounded-2xl p-4">
                <div className="flex items-center gap-2 mb-2">
                  {paceStatus ? (
                    <paceStatus.icon className={cn("h-5 w-5", paceStatus.color)} />
                  ) : (
                    <Target className="h-5 w-5 text-accent-foreground/50" />
                  )}
                  <span className="text-accent-foreground/70 text-sm">Pace</span>
                </div>
                <p className={cn(
                  "text-2xl font-bold",
                  paceStatus?.color || 'text-accent-foreground'
                )}>
                  {pacePercentage.toFixed(0)}%
                </p>
                {paceStatus && (
                  <p className={cn("text-xs mt-1", paceStatus.color)}>
                    {paceStatus.label}
                  </p>
                )}
              </div>
            </div>

            {/* Labor Saver Section */}
            <div className="bg-accent-foreground/10 rounded-2xl p-4">
              <div className="flex items-center justify-between mb-3">
                <span className="text-accent-foreground/70 text-sm font-medium">Labor Saver</span>
                <span className={cn(
                  "text-xs px-2 py-0.5 rounded-full",
                  laborStatus === 'good' ? 'bg-green-500/20 text-green-500' :
                  laborStatus === 'warning' ? 'bg-yellow-500/20 text-yellow-500' :
                  'bg-red-500/20 text-red-500'
                )}>
                  {laborTarget}% target
                </span>
              </div>

              {/* Labor Bars */}
              <div className="space-y-3">
                {/* Actual Labor Bar */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-accent-foreground/50 text-xs">Actual</span>
                    <span className={cn(
                      "text-sm font-bold",
                      laborStatus === 'good' ? 'text-green-500' :
                      laborStatus === 'warning' ? 'text-yellow-500' :
                      'text-red-500'
                    )}>
                      {laborPercentage.toFixed(1)}%
                    </span>
                  </div>
                  <div className="h-3 bg-accent-foreground/20 rounded-full overflow-hidden">
                    <div 
                      className={cn(
                        "h-full rounded-full transition-all",
                        laborStatus === 'good' ? 'bg-green-500' :
                        laborStatus === 'warning' ? 'bg-yellow-500' :
                        'bg-red-500'
                      )}
                      style={{ width: `${Math.min(laborPercentage / 40 * 100, 100)}%` }}
                    />
                  </div>
                </div>

                {/* Target Labor Bar */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-accent-foreground/50 text-xs">Target</span>
                    <span className="text-accent-foreground text-sm font-bold">
                      {laborTarget}%
                    </span>
                  </div>
                  <div className="h-3 bg-accent-foreground/20 rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-accent-foreground/40 rounded-full"
                      style={{ width: `${Math.min(laborTarget / 40 * 100, 100)}%` }}
                    />
                  </div>
                </div>
              </div>

              {/* Status Message */}
              <div className="mt-4 pt-3 border-t border-accent-foreground/10 text-center">
                {laborSavings >= 0 ? (
                  <p className="text-green-500 font-medium">
                    🎯 Saving {formatCurrency(laborSavings)} in labor!
                  </p>
                ) : (
                  <p className="text-red-500 font-medium">
                    🔥 {formatCurrency(Math.abs(laborSavings))} over target
                  </p>
                )}
                <p className="text-accent-foreground/50 text-xs mt-1">
                  Cost: {formatCurrency(laborCost)} • Hours: {(laborData?.labor_hours || 0).toFixed(1)}h
                </p>
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
