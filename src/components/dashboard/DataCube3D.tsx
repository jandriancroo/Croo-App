import React, { useState, useEffect, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { DollarSign, Users, TrendingUp, TrendingDown, Clock, Percent, Target, Wallet, Calendar, Pizza } from 'lucide-react';
import { MetricType, METRIC_CONFIGS, SalesDataForWidgets } from './DashboardWidget';
import { format, subYears, getWeek } from 'date-fns';
import { ThemeColorKey, migrateAccentColor, getThemeColorClass, getThemeTextClass, isThemeColorKey } from '@/utils/themeColors';

interface CubeFace {
  metrics: MetricType[];
  title?: string;
}

interface DataCube3DProps {
  title?: string; // Legacy single title for all faces
  faces: CubeFace[];
  accentColor?: string;
  autoRotateInterval?: number;
  className?: string;
  salesData?: SalesDataForWidgets | null;
  isLoading?: boolean;
}

function formatValue(value: number | undefined, format: 'currency' | 'percent' | 'number' | 'hours'): string {
  if (value === undefined || value === null) return '--';
  
  switch (format) {
    case 'currency':
      return `$${Math.round(value).toLocaleString()}`;
    case 'percent':
      return `${Math.round(value)}%`;
    case 'hours':
      return `${Math.round(value)}h`;
    case 'number':
    default:
      return Math.round(value).toLocaleString();
  }
}

// Category prefix removed - labels now come directly from METRIC_CONFIGS

// Generate dynamic labels for "last year" metrics with actual date references
// Auto-derives time period prefix from metric category, or uses manual override
function getDynamicLabel(metricType: MetricType, manualPrefix?: string): string {
  const config = METRIC_CONFIGS[metricType];
  if (!config) return '';
  
  const now = new Date();
  const lastYear = subYears(now, 1);
  
  let baseLabel: string;
  switch (metricType) {
    case 'sales_last_year_day':
      baseLabel = format(lastYear, "MMM d ''yy");
      break;
    case 'sales_last_year_week':
      baseLabel = `Wk ${getWeek(lastYear)} '${format(lastYear, 'yy')}`;
      break;
    case 'sales_last_year_month':
      baseLabel = format(lastYear, "MMM ''yy");
      break;
    default:
      baseLabel = config.shortLabel;
  }
  
  // Only use manual prefix if explicitly provided (no auto-prefix from category)
  if (manualPrefix) {
    const prefixLower = manualPrefix.toLowerCase();
    const labelLower = baseLabel.toLowerCase();
    if (!labelLower.includes(prefixLower)) {
      return `${manualPrefix} ${baseLabel}`;
    }
  }
  
  return baseLabel;
}

// Get pacing status indicator for a metric (compares pace to goal)
// Returns: 'up' if pace > goal, 'down' if pace < goal, null if not applicable
function getPacingStatus(metricType: MetricType, salesData?: SalesDataForWidgets | null): 'up' | 'down' | null {
  if (!salesData) return null;
  
  const config = METRIC_CONFIGS[metricType];
  if (!config) return null;
  
  // Only show for sales metrics (not labor, guests, etc.)
  if (!metricType.startsWith('sales_')) return null;
  
  // Get pace and goal based on category
  let pace: number | undefined;
  let goal: number | undefined;
  
  switch (config.category) {
    case 'daily':
      pace = salesData.projections?.todayPaceAdjusted;
      goal = salesData.projections?.todayProjected;
      break;
    case 'weekly':
      pace = salesData.projections?.weekPaceAdjusted ?? salesData.projections?.weekProjected;
      goal = salesData.projections?.weekProjected;
      break;
    case 'monthly':
      pace = salesData.projections?.monthPaceAdjusted ?? salesData.projections?.monthProjected;
      goal = salesData.projections?.monthProjected;
      break;
    default:
      return null;
  }
  
  if (pace === undefined || goal === undefined || goal === 0) return null;
  
  // Only show if there's a meaningful difference (more than 1%)
  const percentDiff = ((pace - goal) / goal) * 100;
  if (Math.abs(percentDiff) < 1) return null;
  
  return pace >= goal ? 'up' : 'down';
}

function getPaymentsForPeriod(
  salesData: SalesDataForWidgets,
  period: 'daily' | 'weekly' | 'monthly'
): Array<{ paymentType: string; amount: number }> | undefined {
  const paymentsAny = (salesData as any).payments;
  if (!paymentsAny) return undefined;
  if (Array.isArray(paymentsAny)) return paymentsAny;
  if (typeof paymentsAny === 'object') return paymentsAny?.[period] ?? undefined;
  return undefined;
}

function getPaymentAmount(
  payments: Array<{ paymentType: string; amount: number }> | undefined,
  typePatterns: string[]
): number | undefined {
  if (!payments || payments.length === 0) return undefined;
  for (const pattern of typePatterns) {
    const found = payments.find((p) => p.paymentType.toLowerCase().includes(pattern.toLowerCase()));
    if (found) return found.amount;
  }
  return undefined;
}

function getPaymentPercent(
  payments: Array<{ paymentType: string; amount: number }> | undefined,
  typePatterns: string[]
): number | undefined {
  if (!payments || payments.length === 0) return undefined;
  const amount = getPaymentAmount(payments, typePatterns);
  if (amount === undefined) return undefined;
  const total = payments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
  if (total === 0) return 0;
  return (amount / total) * 100;
}

function getMetricValue(metricType: MetricType, salesData?: SalesDataForWidgets | null): number | undefined {
  if (!salesData) return undefined;

  switch (metricType) {
    case 'sales_today': return salesData.daily;
    case 'sales_pace': return salesData.projections?.todayPaceAdjusted;
    case 'sales_projected_today': return salesData.projections?.todayProjected;
    case 'sales_last_week':
    case 'sales_last_year': return salesData.comparison?.prevDayFullDay;
    case 'sales_last_year_day': return salesData.lastYear?.sameDay;
    case 'avg_ticket': return salesData.avgTicket;
    case 'guest_count_today': return salesData.guestCount?.daily;
    case 'pizza_count_today': return typeof salesData.pizzaCount === 'number' ? salesData.pizzaCount : salesData.pizzaCount?.daily;
    case 'labor_percent_today':
    case 'labor_percent': return salesData.labor?.laborPercent;
    case 'labor_cost_today':
    case 'labor_cost': return salesData.labor?.laborCost;
    case 'labor_hours_today':
    case 'labor_hours': return salesData.labor?.hoursWorked;
    case 'sales_wtd': return salesData.weekly;
    case 'sales_pace_week': return salesData.projections?.weekPaceAdjusted ?? salesData.projections?.weekProjected;
    case 'sales_projected_week': return salesData.projections?.weekProjected;
    case 'sales_prev_week': return salesData.comparison?.prevWeekFullWeek ?? salesData.comparison?.prevWeek;
    case 'sales_last_year_week': return salesData.lastYear?.sameWeek;
    case 'guest_count_wtd': return salesData.guestCount?.weekly;
    case 'pizza_count_wtd': return typeof salesData.pizzaCount === 'object' ? salesData.pizzaCount?.weekly : undefined;
    case 'labor_percent_wtd': return salesData.weeklyLabor?.laborPercent;
    case 'labor_cost_wtd': return salesData.weeklyLabor?.laborCost;
    case 'labor_hours_wtd': return salesData.weeklyLabor?.hoursWorked;
    case 'sales_mtd': return salesData.monthly;
    case 'sales_pace_month': return salesData.projections?.monthPaceAdjusted ?? salesData.projections?.monthProjected;
    case 'sales_projected_month': return salesData.projections?.monthProjected;
    case 'sales_prev_month': return salesData.comparison?.prevMonthFullMonth ?? salesData.comparison?.prevMonth;
    case 'sales_last_year_month': return salesData.lastYear?.sameMonth;
    case 'guest_count_mtd': return salesData.guestCount?.monthly;
    case 'pizza_count_mtd': return typeof salesData.pizzaCount === 'object' ? salesData.pizzaCount?.monthly : undefined;
    case 'labor_percent_mtd': return salesData.monthlyLabor?.laborPercent;
    case 'labor_cost_mtd': return salesData.monthlyLabor?.laborCost;
    case 'labor_hours_mtd': return salesData.monthlyLabor?.hoursWorked;
    case 'personal_hours_week': return salesData.personalData?.hoursWeek;
    case 'personal_hours_payroll': return salesData.personalData?.hoursPayroll;
    case 'personal_pay_week': return salesData.personalData?.payWeek;
    case 'personal_pay_payroll': return salesData.personalData?.payPayroll;
    // Payment metrics
    case 'payment_cash_today': return getPaymentAmount(getPaymentsForPeriod(salesData, 'daily'), ['cash']);
    case 'payment_credit_card_today': return getPaymentAmount(getPaymentsForPeriod(salesData, 'daily'), ['credit card', 'creditcard']);
    case 'payment_olo_doordash_today': return getPaymentAmount(getPaymentsForPeriod(salesData, 'daily'), ['doordash', 'door dash']);
    case 'payment_olo_ubereats_today': return getPaymentAmount(getPaymentsForPeriod(salesData, 'daily'), ['ubereats', 'uber eats']);
    case 'payment_olo_visa_today': return getPaymentAmount(getPaymentsForPeriod(salesData, 'daily'), ['olo visa']);
    case 'payment_olo_mastercard_today': return getPaymentAmount(getPaymentsForPeriod(salesData, 'daily'), ['olo mastercard', 'olo mc']);
    case 'payment_olo_prepaid_today': return getPaymentAmount(getPaymentsForPeriod(salesData, 'daily'), ['olo prepaid', 'prepaid']);
    case 'payment_olo_giftcard_today': return getPaymentAmount(getPaymentsForPeriod(salesData, 'daily'), ['olo gift card', 'olo giftcard']);
    case 'payment_svs_giftcard_today': return getPaymentAmount(getPaymentsForPeriod(salesData, 'daily'), ['svs gift card', 'svs giftcard']);
    case 'payment_cash_today_pct': return getPaymentPercent(getPaymentsForPeriod(salesData, 'daily'), ['cash']);
    case 'payment_credit_card_today_pct': return getPaymentPercent(getPaymentsForPeriod(salesData, 'daily'), ['credit card', 'creditcard']);
    case 'payment_olo_doordash_today_pct': return getPaymentPercent(getPaymentsForPeriod(salesData, 'daily'), ['doordash', 'door dash']);
    case 'payment_olo_ubereats_today_pct': return getPaymentPercent(getPaymentsForPeriod(salesData, 'daily'), ['ubereats', 'uber eats']);
    case 'payment_olo_visa_today_pct': return getPaymentPercent(getPaymentsForPeriod(salesData, 'daily'), ['olo visa']);
    case 'payment_olo_mastercard_today_pct': return getPaymentPercent(getPaymentsForPeriod(salesData, 'daily'), ['olo mastercard', 'olo mc']);
    case 'payment_olo_prepaid_today_pct': return getPaymentPercent(getPaymentsForPeriod(salesData, 'daily'), ['olo prepaid', 'prepaid']);
    case 'payment_olo_giftcard_today_pct': return getPaymentPercent(getPaymentsForPeriod(salesData, 'daily'), ['olo gift card', 'olo giftcard']);
    case 'payment_svs_giftcard_today_pct': return getPaymentPercent(getPaymentsForPeriod(salesData, 'daily'), ['svs gift card', 'svs giftcard']);
    case 'payment_cash_wtd': return getPaymentAmount(getPaymentsForPeriod(salesData, 'weekly'), ['cash']);
    case 'payment_credit_card_wtd': return getPaymentAmount(getPaymentsForPeriod(salesData, 'weekly'), ['credit card', 'creditcard']);
    case 'payment_olo_doordash_wtd': return getPaymentAmount(getPaymentsForPeriod(salesData, 'weekly'), ['doordash', 'door dash']);
    case 'payment_olo_ubereats_wtd': return getPaymentAmount(getPaymentsForPeriod(salesData, 'weekly'), ['ubereats', 'uber eats']);
    case 'payment_olo_visa_wtd': return getPaymentAmount(getPaymentsForPeriod(salesData, 'weekly'), ['olo visa']);
    case 'payment_olo_mastercard_wtd': return getPaymentAmount(getPaymentsForPeriod(salesData, 'weekly'), ['olo mastercard', 'olo mc']);
    case 'payment_olo_prepaid_wtd': return getPaymentAmount(getPaymentsForPeriod(salesData, 'weekly'), ['olo prepaid', 'prepaid']);
    case 'payment_olo_giftcard_wtd': return getPaymentAmount(getPaymentsForPeriod(salesData, 'weekly'), ['olo gift card', 'olo giftcard']);
    case 'payment_svs_giftcard_wtd': return getPaymentAmount(getPaymentsForPeriod(salesData, 'weekly'), ['svs gift card', 'svs giftcard']);
    case 'payment_cash_wtd_pct': return getPaymentPercent(getPaymentsForPeriod(salesData, 'weekly'), ['cash']);
    case 'payment_credit_card_wtd_pct': return getPaymentPercent(getPaymentsForPeriod(salesData, 'weekly'), ['credit card', 'creditcard']);
    case 'payment_olo_doordash_wtd_pct': return getPaymentPercent(getPaymentsForPeriod(salesData, 'weekly'), ['doordash', 'door dash']);
    case 'payment_olo_ubereats_wtd_pct': return getPaymentPercent(getPaymentsForPeriod(salesData, 'weekly'), ['ubereats', 'uber eats']);
    case 'payment_olo_visa_wtd_pct': return getPaymentPercent(getPaymentsForPeriod(salesData, 'weekly'), ['olo visa']);
    case 'payment_olo_mastercard_wtd_pct': return getPaymentPercent(getPaymentsForPeriod(salesData, 'weekly'), ['olo mastercard', 'olo mc']);
    case 'payment_olo_prepaid_wtd_pct': return getPaymentPercent(getPaymentsForPeriod(salesData, 'weekly'), ['olo prepaid', 'prepaid']);
    case 'payment_olo_giftcard_wtd_pct': return getPaymentPercent(getPaymentsForPeriod(salesData, 'weekly'), ['olo gift card', 'olo giftcard']);
    case 'payment_svs_giftcard_wtd_pct': return getPaymentPercent(getPaymentsForPeriod(salesData, 'weekly'), ['svs gift card', 'svs giftcard']);
    case 'payment_cash_mtd': return getPaymentAmount(getPaymentsForPeriod(salesData, 'monthly'), ['cash']);
    case 'payment_credit_card_mtd': return getPaymentAmount(getPaymentsForPeriod(salesData, 'monthly'), ['credit card', 'creditcard']);
    case 'payment_olo_doordash_mtd': return getPaymentAmount(getPaymentsForPeriod(salesData, 'monthly'), ['doordash', 'door dash']);
    case 'payment_olo_ubereats_mtd': return getPaymentAmount(getPaymentsForPeriod(salesData, 'monthly'), ['ubereats', 'uber eats']);
    case 'payment_olo_visa_mtd': return getPaymentAmount(getPaymentsForPeriod(salesData, 'monthly'), ['olo visa']);
    case 'payment_olo_mastercard_mtd': return getPaymentAmount(getPaymentsForPeriod(salesData, 'monthly'), ['olo mastercard', 'olo mc']);
    case 'payment_olo_prepaid_mtd': return getPaymentAmount(getPaymentsForPeriod(salesData, 'monthly'), ['olo prepaid', 'prepaid']);
    case 'payment_olo_giftcard_mtd': return getPaymentAmount(getPaymentsForPeriod(salesData, 'monthly'), ['olo gift card', 'olo giftcard']);
    case 'payment_svs_giftcard_mtd': return getPaymentAmount(getPaymentsForPeriod(salesData, 'monthly'), ['svs gift card', 'svs giftcard']);
    case 'payment_cash_mtd_pct': return getPaymentPercent(getPaymentsForPeriod(salesData, 'monthly'), ['cash']);
    case 'payment_credit_card_mtd_pct': return getPaymentPercent(getPaymentsForPeriod(salesData, 'monthly'), ['credit card', 'creditcard']);
    case 'payment_olo_doordash_mtd_pct': return getPaymentPercent(getPaymentsForPeriod(salesData, 'monthly'), ['doordash', 'door dash']);
    case 'payment_olo_ubereats_mtd_pct': return getPaymentPercent(getPaymentsForPeriod(salesData, 'monthly'), ['ubereats', 'uber eats']);
    case 'payment_olo_visa_mtd_pct': return getPaymentPercent(getPaymentsForPeriod(salesData, 'monthly'), ['olo visa']);
    case 'payment_olo_mastercard_mtd_pct': return getPaymentPercent(getPaymentsForPeriod(salesData, 'monthly'), ['olo mastercard', 'olo mc']);
    case 'payment_olo_prepaid_mtd_pct': return getPaymentPercent(getPaymentsForPeriod(salesData, 'monthly'), ['olo prepaid', 'prepaid']);
    case 'payment_olo_giftcard_mtd_pct': return getPaymentPercent(getPaymentsForPeriod(salesData, 'monthly'), ['olo gift card', 'olo giftcard']);
    case 'payment_svs_giftcard_mtd_pct': return getPaymentPercent(getPaymentsForPeriod(salesData, 'monthly'), ['svs gift card', 'svs giftcard']);
    default: return undefined;
  }
}

export function DataCube3D({
  title,
  faces,
  accentColor = 'primary',
  autoRotateInterval = 8000,
  className,
  salesData,
  isLoading = false,
}: DataCube3DProps) {
  const [currentFace, setCurrentFace] = useState(0);
  const [isAnimating, setIsAnimating] = useState(false);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const [cubeDepth, setCubeDepth] = useState(60);
  
  const totalFaces = Math.min(faces.length, 4);
  
  // Migrate legacy hex colors to theme color keys
  const themeColorKey: ThemeColorKey = isThemeColorKey(accentColor) 
    ? accentColor 
    : migrateAccentColor(accentColor);
  
  // Calculate cube depth based on container width
  useEffect(() => {
    const updateDepth = () => {
      if (containerRef.current) {
        const width = containerRef.current.offsetWidth;
        setCubeDepth(width / 2);
      }
    };
    
    updateDepth();
    window.addEventListener('resize', updateDepth);
    return () => window.removeEventListener('resize', updateDepth);
  }, []);
  
  const rotateTo = useCallback((faceIndex: number) => {
    if (isAnimating || faceIndex === currentFace) return;
    setIsAnimating(true);
    setCurrentFace(faceIndex);
    setTimeout(() => setIsAnimating(false), 800);
  }, [isAnimating, currentFace]);
  
  const rotateNext = useCallback(() => {
    const nextFace = (currentFace + 1) % totalFaces;
    rotateTo(nextFace);
  }, [currentFace, totalFaces, rotateTo]);
  
  // Auto-rotate
  useEffect(() => {
    if (totalFaces <= 1) return;
    
    const interval = setInterval(() => {
      rotateNext();
    }, autoRotateInterval);
    
    return () => clearInterval(interval);
  }, [rotateNext, autoRotateInterval, totalFaces]);
  
  const handleClick = () => {
    if (totalFaces > 1) {
      rotateNext();
    }
  };

  // Calculate 3D rotation based on current face
  const getRotationY = () => {
    return currentFace * -90;
  };

  return (
    <div className={cn("relative group h-full", className)}>
      {/* 3D Cube Container - fills parent, uses perspective */}
      <div 
        ref={containerRef}
        className="relative w-full h-full cursor-pointer overflow-visible"
        onClick={handleClick}
        style={{
          perspective: `${cubeDepth * 4}px`,
          perspectiveOrigin: 'center center',
        }}
      >
        {/* The actual 3D rotating cube */}
        <div
          className="relative w-full h-full transition-transform duration-700 ease-[cubic-bezier(0.4,0,0.2,1)]"
          style={{
            transformStyle: 'preserve-3d',
            transform: `translateZ(-${cubeDepth}px) rotateY(${getRotationY()}deg)`,
          }}
        >
          {/* Render all 4 faces of the cube */}
          {[0, 1, 2, 3].map((faceIndex) => {
            const face = faces[faceIndex % faces.length];
            const rotateY = faceIndex * 90;
            // Only use per-face titles (no cube-level title fallback)
            const faceTitle = face?.title;
            
            return (
              <CubeFaceComponent
                key={faceIndex}
                face={face}
                themeColorKey={themeColorKey}
                salesData={salesData}
                isLoading={isLoading}
                totalFaces={totalFaces}
                currentFace={currentFace}
                faceIndex={faceIndex}
                onIndicatorClick={rotateTo}
                title={faceTitle}
                rotateY={rotateY}
                cubeDepth={cubeDepth}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

// Pacing indicator component
function PacingIndicator({ status, isLightBg }: { status: 'up' | 'down' | null; isLightBg: boolean }) {
  if (!status) return null;
  
  return status === 'up' ? (
    <TrendingUp className={cn("h-3 w-3 flex-shrink-0", isLightBg ? "text-green-600" : "text-green-400")} />
  ) : (
    <TrendingDown className={cn("h-3 w-3 flex-shrink-0", isLightBg ? "text-red-600" : "text-red-400")} />
  );
}

interface CubeFaceComponentProps {
  face?: CubeFace;
  themeColorKey: ThemeColorKey;
  salesData?: SalesDataForWidgets | null;
  isLoading?: boolean;
  totalFaces: number;
  currentFace: number;
  faceIndex: number;
  onIndicatorClick: (index: number) => void;
  title?: string;
  rotateY: number;
  cubeDepth: number;
}

function CubeFaceComponent({ 
  face, 
  themeColorKey, 
  salesData, 
  isLoading, 
  totalFaces,
  currentFace,
  faceIndex,
  onIndicatorClick,
  title,
  rotateY,
  cubeDepth,
}: CubeFaceComponentProps) {
  // Use theme color classes for solid background with white text
  const bgClass = getThemeColorClass(themeColorKey);
  const textClass = getThemeTextClass(themeColorKey);
  const isLightBg = themeColorKey === 'secondary' || themeColorKey === 'muted';
  
  // Allow up to 4 metrics per face
  const displayMetrics = face?.metrics?.slice(0, 4) || [];
  const metricCount = displayMetrics.length;

  if (!face || displayMetrics.length === 0) {
    return (
      <div
        className={cn(
          "absolute inset-0 rounded-xl shadow-lg flex items-center justify-center backface-hidden",
          bgClass
        )}
        style={{
          transform: `rotateY(${rotateY}deg) translateZ(${cubeDepth}px)`,
          backfaceVisibility: 'hidden',
        }}
      >
        <span className={cn("text-xs", isLightBg ? "text-muted-foreground" : "text-white/75")}>No metrics</span>
      </div>
    );
  }
  
  return (
    <div
      className={cn(
        "absolute inset-0 rounded-2xl overflow-hidden flex flex-col",
        bgClass
      )}
      style={{
        transform: `rotateY(${rotateY}deg) translateZ(${cubeDepth}px)`,
        backfaceVisibility: 'hidden',
        boxShadow: `
          0 3px 8px rgba(0,0,0,0.04),
          0 1px 4px rgba(0,0,0,0.03),
          inset 0 2px 4px rgba(255,255,255,0.4),
          inset 0 -2px 4px rgba(0,0,0,0.08)
        `,
      }}
    >
      {/* Subtle gradient from top-left corner for 3D pillowy look */}
      <div 
        className="absolute inset-0 pointer-events-none rounded-2xl"
        style={{
          background: `
            radial-gradient(ellipse 120% 100% at 15% -10%, 
              rgba(255,255,255,0.25) 0%, 
              rgba(255,255,255,0.12) 25%, 
              transparent 55%
            ),
            linear-gradient(160deg,
              rgba(255,255,255,0.15) 0%,
              transparent 40%
            ),
            linear-gradient(180deg,
              transparent 60%,
              rgba(0,0,0,0.06) 90%,
              rgba(0,0,0,0.09) 100%
            )
          `,
        }}
      />
      
      {/* Soft inner border highlight */}
      <div 
        className="absolute inset-[1px] pointer-events-none rounded-2xl"
        style={{
          border: '1px solid rgba(255,255,255,0.25)',
          borderBottomColor: 'rgba(255,255,255,0.08)',
        }}
      />
      
      {/* Title */}
      {title && (
        <div 
          className={cn(
            "text-sm md:text-base font-bold px-2.5 md:px-3 pt-2 md:pt-2.5 truncate uppercase tracking-wide relative z-10",
            isLightBg ? "text-foreground" : "text-white"
          )}
        >
          {title}
        </div>
      )}
      
      {/* Content - positioned layout for metrics */}
      <div className={cn(
        "flex-1 relative z-10",
        metricCount === 4 ? "p-2 md:p-3" : "px-2.5 md:px-3 py-1"
      )}>
        {metricCount === 4 ? (
          // 4 metrics: 2x2 grid layout with quadrant dividers
          <div className="relative h-full">
            {/* Quadrant glow dividers */}
            <div 
              className="absolute left-1/2 top-2 bottom-2 w-px pointer-events-none"
              style={{
                background: 'linear-gradient(180deg, transparent 0%, rgba(255,255,255,0.2) 20%, rgba(255,255,255,0.2) 80%, transparent 100%)',
                boxShadow: '0 0 8px rgba(255,255,255,0.15)',
              }}
            />
            <div 
              className="absolute top-1/2 left-2 right-2 h-px pointer-events-none"
              style={{
                background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.2) 20%, rgba(255,255,255,0.2) 80%, transparent 100%)',
                boxShadow: '0 0 8px rgba(255,255,255,0.15)',
              }}
            />
            
            <div className="grid grid-cols-2 grid-rows-2 h-full gap-1">
              {displayMetrics.map((metricType, index) => {
                const config = METRIC_CONFIGS[metricType];
                if (!config) return null;
                
                const value = getMetricValue(metricType, salesData);
                const formattedValue = formatValue(value, config.format);
                const pacingStatus = getPacingStatus(metricType, salesData);
                
                // Align: 0=left, 1=right, 2=left, 3=right
                const isRight = index % 2 === 1;
                
                return (
                    <div key={index} className={cn("flex flex-col justify-center min-w-0", isRight && "items-end text-right")}>
                      <div className={cn("flex items-center gap-1", isRight && "flex-row-reverse")}>
                        <div 
                          className={cn(
                            "font-bold leading-none truncate text-lg md:text-xl",
                            isLoading && "animate-pulse bg-white/30 rounded w-12 h-5",
                            isLightBg ? "text-foreground" : "text-white"
                          )}
                        >
                          {!isLoading && formattedValue}
                        </div>
                        {!isLoading && <PacingIndicator status={pacingStatus} isLightBg={isLightBg} />}
                      </div>
                      <div 
                        className={cn(
                          "text-[10px] md:text-xs font-semibold truncate -mt-0.5",
                          isLightBg ? "text-muted-foreground" : "text-white/70"
                        )}
                      >
                        {getDynamicLabel(metricType, title)}
                      </div>
                    </div>
                );
              })}
            </div>
          </div>
        ) : metricCount === 3 ? (
          // 3 metrics: top-left, top-right, bottom row layout with dividers
          <div className="relative h-full">
            {/* Vertical divider for top row */}
            <div 
              className="absolute left-1/2 top-2 h-[45%] w-px pointer-events-none"
              style={{
                background: 'linear-gradient(180deg, transparent 0%, rgba(255,255,255,0.2) 20%, rgba(255,255,255,0.2) 80%, transparent 100%)',
                boxShadow: '0 0 8px rgba(255,255,255,0.15)',
              }}
            />
            {/* Horizontal divider between top and bottom */}
            <div 
              className="absolute top-1/2 left-2 right-2 h-px pointer-events-none"
              style={{
                background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.2) 20%, rgba(255,255,255,0.2) 80%, transparent 100%)',
                boxShadow: '0 0 8px rgba(255,255,255,0.15)',
              }}
            />
            
            <div className="h-full flex flex-col">
              {/* Top row: 2 items */}
              <div className="flex-1 grid grid-cols-2 gap-1">
                {displayMetrics.slice(0, 2).map((metricType, index) => {
                  const config = METRIC_CONFIGS[metricType];
                  if (!config) return null;
                  
                  const value = getMetricValue(metricType, salesData);
                  const formattedValue = formatValue(value, config.format);
                  const pacingStatus = getPacingStatus(metricType, salesData);
                  const isRight = index === 1;
                  
                  return (
                    <div key={index} className={cn("flex flex-col justify-center min-w-0", isRight && "items-end text-right")}>
                      <div className={cn("flex items-center gap-1", isRight && "flex-row-reverse")}>
                        <div 
                          className={cn(
                            "font-bold leading-none truncate text-lg md:text-xl",
                            isLoading && "animate-pulse bg-white/30 rounded w-12 h-5",
                            isLightBg ? "text-foreground" : "text-white"
                          )}
                        >
                          {!isLoading && formattedValue}
                        </div>
                        {!isLoading && <PacingIndicator status={pacingStatus} isLightBg={isLightBg} />}
                      </div>
                      <div 
                        className={cn(
                          "text-[10px] md:text-xs font-semibold truncate -mt-0.5",
                          isLightBg ? "text-muted-foreground" : "text-white/70"
                        )}
                      >
                        {getDynamicLabel(metricType, title)}
                      </div>
                    </div>
                  );
                })}
              </div>
              {/* Bottom row: 1 item centered */}
              <div className="flex-1 flex items-center justify-center">
                {displayMetrics.slice(2, 3).map((metricType, index) => {
                  const config = METRIC_CONFIGS[metricType];
                  if (!config) return null;
                  
                  const value = getMetricValue(metricType, salesData);
                  const formattedValue = formatValue(value, config.format);
                  const pacingStatus = getPacingStatus(metricType, salesData);
                  
                  return (
                    <div key={index} className="flex flex-col items-center text-center min-w-0">
                      <div className="flex items-center gap-1">
                        <div 
                          className={cn(
                            "font-bold leading-none truncate text-lg md:text-xl",
                            isLoading && "animate-pulse bg-white/30 rounded w-12 h-5",
                            isLightBg ? "text-foreground" : "text-white"
                          )}
                        >
                          {!isLoading && formattedValue}
                        </div>
                        {!isLoading && <PacingIndicator status={pacingStatus} isLightBg={isLightBg} />}
                      </div>
                      <div 
                        className={cn(
                          "text-[10px] md:text-xs font-semibold truncate -mt-0.5",
                          isLightBg ? "text-muted-foreground" : "text-white/70"
                        )}
                      >
                        {getDynamicLabel(metricType, title)}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        ) : metricCount === 2 ? (
          // 2 metrics: left/right split with vertical divider
          <div className="relative h-full">
            {/* Vertical divider */}
            <div 
              className="absolute left-1/2 top-2 bottom-2 w-px pointer-events-none"
              style={{
                background: 'linear-gradient(180deg, transparent 0%, rgba(255,255,255,0.2) 20%, rgba(255,255,255,0.2) 80%, transparent 100%)',
                boxShadow: '0 0 8px rgba(255,255,255,0.15)',
              }}
            />
            
            <div className="grid grid-cols-2 h-full gap-1">
              {displayMetrics.map((metricType, index) => {
                const config = METRIC_CONFIGS[metricType];
                if (!config) return null;
                
                const value = getMetricValue(metricType, salesData);
                const formattedValue = formatValue(value, config.format);
                const pacingStatus = getPacingStatus(metricType, salesData);
                const isRight = index === 1;
                
                return (
                  <div key={index} className={cn("flex flex-col justify-center min-w-0", isRight && "items-end text-right")}>
                    <div className={cn("flex items-center gap-1", isRight && "flex-row-reverse")}>
                      <div 
                        className={cn(
                          "font-bold leading-none truncate text-lg md:text-xl",
                          isLoading && "animate-pulse bg-white/30 rounded w-12 h-5",
                          isLightBg ? "text-foreground" : "text-white"
                        )}
                      >
                        {!isLoading && formattedValue}
                      </div>
                      {!isLoading && <PacingIndicator status={pacingStatus} isLightBg={isLightBg} />}
                    </div>
                    <div 
                      className={cn(
                        "text-[10px] md:text-xs font-semibold truncate -mt-0.5",
                        isLightBg ? "text-muted-foreground" : "text-white/70"
                      )}
                    >
                      {getDynamicLabel(metricType, title)}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          // 1 metric: centered
          <div className="h-full flex items-center justify-center">
            {displayMetrics.map((metricType, index) => {
              const config = METRIC_CONFIGS[metricType];
              if (!config) return null;
              
              const value = getMetricValue(metricType, salesData);
              const formattedValue = formatValue(value, config.format);
              const pacingStatus = getPacingStatus(metricType, salesData);
              
              return (
                <div key={index} className="flex flex-col items-center text-center min-w-0">
                  <div className="flex items-center gap-1">
                    <div 
                      className={cn(
                        "font-bold leading-none truncate text-2xl md:text-3xl",
                        isLoading && "animate-pulse bg-white/30 rounded w-16 h-6",
                        isLightBg ? "text-foreground" : "text-white"
                      )}
                    >
                      {!isLoading && formattedValue}
                    </div>
                    {!isLoading && <PacingIndicator status={pacingStatus} isLightBg={isLightBg} />}
                  </div>
                  <div 
                    className={cn(
                      "text-xs md:text-sm font-semibold truncate",
                      isLightBg ? "text-muted-foreground" : "text-white/70"
                    )}
                  >
                    {getDynamicLabel(metricType, title)}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
      
      {/* Face Indicator dots */}
      {totalFaces > 1 && (
        <div className="flex justify-center items-center gap-1 pb-1.5 md:pb-2">
          {Array.from({ length: totalFaces }).map((_, index) => (
            <button
              key={index}
              onClick={(e) => {
                e.stopPropagation();
                onIndicatorClick(index);
              }}
              className={cn(
                "w-1 h-1 md:w-1.5 md:h-1.5 rounded-full transition-all duration-300",
                index === currentFace 
                  ? (isLightBg ? "bg-foreground" : "bg-white") 
                  : (isLightBg ? "bg-foreground/30" : "bg-white/40")
              )}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// Demo component to showcase the 3D cube (can be removed after integration)
export function DataCube3DDemo() {
  // Demo data matching the actual SalesDataForWidgets type
  const demoSalesData: SalesDataForWidgets = {
    daily: 2450,
    weekly: 14200,
    monthly: 52800,
    guestCount: { daily: 127, weekly: 742, monthly: 2850 },
    avgTicket: 19.29,
    labor: { laborPercent: 24.5, laborCost: 600, hoursWorked: 48.5 },
    weeklyLabor: { laborPercent: 23.8, laborCost: 3380, hoursWorked: 312 },
    monthlyLabor: { laborPercent: 24.2, laborCost: 12800, hoursWorked: 1240 },
    projections: {
      todayProjected: 3200,
      weekProjected: 18500,
      monthProjected: 68000,
    },
  };

  const demoFaces: CubeFace[] = [
    { metrics: ['sales_today', 'guest_count_today', 'avg_ticket', 'pizza_count_today'] },
    { metrics: ['sales_wtd', 'guest_count_wtd', 'labor_percent_wtd', 'labor_cost_wtd'] },
    { metrics: ['sales_mtd', 'labor_hours_mtd', 'labor_percent_mtd', 'guest_count_mtd'] },
    { metrics: ['labor_hours_today', 'labor_percent_today', 'labor_cost_today', 'avg_ticket'] },
  ];

  return (
    <div className="p-6 space-y-8">
      <h2 className="text-xl font-bold text-foreground">3D Cube Prototype</h2>
      <p className="text-muted-foreground text-sm">Click the cubes to rotate, or wait 8 seconds for auto-rotation.</p>
      
      <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
        {/* 4-face cube */}
        <div className="space-y-2">
          <div className="text-xs text-muted-foreground text-center">4 Faces</div>
          <DataCube3D
            title="Performance Overview"
            faces={demoFaces}
            accentColor="primary"
            salesData={demoSalesData}
          />
        </div>
        
        {/* 3-face cube */}
        <div className="space-y-2">
          <div className="text-xs text-muted-foreground text-center">3 Faces</div>
          <DataCube3D
            title="Sales Metrics"
            faces={demoFaces.slice(0, 3)}
            accentColor="accent"
            salesData={demoSalesData}
          />
        </div>
        
        {/* 2-face cube */}
        <div className="space-y-2">
          <div className="text-xs text-muted-foreground text-center">2 Faces</div>
          <DataCube3D
            title="Quick Stats"
            faces={demoFaces.slice(0, 2)}
            accentColor="destructive"
            salesData={demoSalesData}
          />
        </div>
        
        {/* 1-face cube (no rotation) */}
        <div className="space-y-2">
          <div className="text-xs text-muted-foreground text-center">1 Face</div>
          <DataCube3D
            title="Daily Summary"
            faces={demoFaces.slice(0, 1)}
            accentColor="secondary"
            salesData={demoSalesData}
          />
        </div>
      </div>
    </div>
  );
}
