import React, { useState, useEffect, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { DollarSign, Users, TrendingUp, Clock, Percent, Target, Wallet, Calendar, Pizza } from 'lucide-react';
import { MetricType, METRIC_CONFIGS, SalesDataForWidgets } from './DashboardWidget';
import { format, subYears, getWeek } from 'date-fns';

interface CubeFace {
  metrics: MetricType[];
}

interface DataCube3DProps {
  title: string;
  faces: CubeFace[];
  accentColor?: string;
  autoRotateInterval?: number;
  className?: string;
  salesData?: SalesDataForWidgets | null;
  isLoading?: boolean;
}

// Determine if text should be light or dark based on background color
function getContrastColor(hexColor: string): 'light' | 'dark' {
  const hex = hexColor.replace('#', '');
  const r = parseInt(hex.substr(0, 2), 16);
  const g = parseInt(hex.substr(2, 2), 16);
  const b = parseInt(hex.substr(4, 2), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.5 ? 'dark' : 'light';
}

// Lighten a hex color
function lightenColor(hexColor: string, amount: number = 0.4): string {
  const hex = hexColor.replace('#', '');
  const r = parseInt(hex.substr(0, 2), 16);
  const g = parseInt(hex.substr(2, 2), 16);
  const b = parseInt(hex.substr(4, 2), 16);
  
  const newR = Math.min(255, Math.round(r + (255 - r) * amount));
  const newG = Math.min(255, Math.round(g + (255 - g) * amount));
  const newB = Math.min(255, Math.round(b + (255 - b) * amount));
  
  return `#${newR.toString(16).padStart(2, '0')}${newG.toString(16).padStart(2, '0')}${newB.toString(16).padStart(2, '0')}`;
}

// Icon mapping for metrics
function getIconForMetric(metricType: MetricType): React.ReactNode {
  const key = metricType.toLowerCase();
  if (key.includes('sales') || key.includes('ticket') || key.includes('pay') || key.includes('cost')) 
    return <DollarSign className="w-4 h-4" />;
  if (key.includes('guest') || key.includes('labor_percent')) 
    return <Users className="w-4 h-4" />;
  if (key.includes('pizza')) 
    return <Pizza className="w-4 h-4" />;
  if (key.includes('hours') || key.includes('personal_hours')) 
    return <Clock className="w-4 h-4" />;
  if (key.includes('pace') || key.includes('projected')) 
    return <TrendingUp className="w-4 h-4" />;
  if (key.includes('last') || key.includes('prev')) 
    return <Calendar className="w-4 h-4" />;
  return <Target className="w-4 h-4" />;
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

// Generate dynamic labels for "last year" metrics with actual date references
function getDynamicLabel(metricType: MetricType): string {
  const config = METRIC_CONFIGS[metricType];
  if (!config) return '';
  
  const now = new Date();
  const lastYear = subYears(now, 1);
  
  // Check if this is a "last year" type metric and generate contextual labels
  switch (metricType) {
    case 'sales_last_year_day':
      // Same day last year - show the actual date
      return format(lastYear, "MMM d ''yy");
    case 'sales_last_year_week':
      // Same week last year
      return `Wk ${getWeek(lastYear)} '${format(lastYear, 'yy')}`;
    case 'sales_last_year_month':
      // Same month last year
      return format(lastYear, "MMM ''yy");
    default:
      return config.shortLabel;
  }
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
    // Daily sales
    case 'sales_today':
      return salesData.daily;
    case 'sales_pace':
      return salesData.projections?.todayPaceAdjusted;
    case 'sales_projected_today':
      return salesData.projections?.todayProjected;
    case 'sales_last_week':
    case 'sales_last_year':
      return salesData.comparison?.prevDayFullDay;
    case 'sales_last_year_day':
      return salesData.lastYear?.sameDay;
    case 'avg_ticket':
      return salesData.avgTicket;

    // Daily guests/products
    case 'guest_count_today':
      return salesData.guestCount?.daily;
    case 'pizza_count_today':
      return typeof salesData.pizzaCount === 'number' ? salesData.pizzaCount : salesData.pizzaCount?.daily;

    // Daily labor
    case 'labor_percent_today':
    case 'labor_percent':
      return salesData.labor?.laborPercent;
    case 'labor_cost_today':
    case 'labor_cost':
      return salesData.labor?.laborCost;
    case 'labor_hours_today':
    case 'labor_hours':
      return salesData.labor?.hoursWorked;

    // Weekly sales
    case 'sales_wtd':
      return salesData.weekly;
    case 'sales_pace_week':
      return salesData.projections?.weekPaceAdjusted ?? salesData.projections?.weekProjected;
    case 'sales_projected_week':
      return salesData.projections?.weekProjected;
    case 'sales_prev_week':
      return salesData.comparison?.prevWeekFullWeek ?? salesData.comparison?.prevWeek;
    case 'sales_last_year_week':
      return salesData.lastYear?.sameWeek;

    // Weekly guests/products
    case 'guest_count_wtd':
      return salesData.guestCount?.weekly;
    case 'pizza_count_wtd':
      return typeof salesData.pizzaCount === 'object' ? salesData.pizzaCount?.weekly : undefined;

    // Weekly labor
    case 'labor_percent_wtd':
      return salesData.weeklyLabor?.laborPercent;
    case 'labor_cost_wtd':
      return salesData.weeklyLabor?.laborCost;
    case 'labor_hours_wtd':
      return salesData.weeklyLabor?.hoursWorked;

    // Monthly sales
    case 'sales_mtd':
      return salesData.monthly;
    case 'sales_pace_month':
      return salesData.projections?.monthPaceAdjusted ?? salesData.projections?.monthProjected;
    case 'sales_projected_month':
      return salesData.projections?.monthProjected;
    case 'sales_prev_month':
      return salesData.comparison?.prevMonthFullMonth ?? salesData.comparison?.prevMonth;
    case 'sales_last_year_month':
      return salesData.lastYear?.sameMonth;

    // Monthly guests/products
    case 'guest_count_mtd':
      return salesData.guestCount?.monthly;
    case 'pizza_count_mtd':
      return typeof salesData.pizzaCount === 'object' ? salesData.pizzaCount?.monthly : undefined;

    // Monthly labor
    case 'labor_percent_mtd':
      return salesData.monthlyLabor?.laborPercent;
    case 'labor_cost_mtd':
      return salesData.monthlyLabor?.laborCost;
    case 'labor_hours_mtd':
      return salesData.monthlyLabor?.hoursWorked;

    // Personal metrics
    case 'personal_hours_week':
      return salesData.personalData?.hoursWeek;
    case 'personal_hours_payroll':
      return salesData.personalData?.hoursPayroll;
    case 'personal_pay_week':
      return salesData.personalData?.payWeek;
    case 'personal_pay_payroll':
      return salesData.personalData?.payPayroll;

    // Payment type metrics - Daily (amount)
    case 'payment_cash_today':
      return getPaymentAmount(getPaymentsForPeriod(salesData, 'daily'), ['cash']);
    case 'payment_credit_card_today':
      return getPaymentAmount(getPaymentsForPeriod(salesData, 'daily'), ['credit card', 'creditcard']);
    case 'payment_olo_doordash_today':
      return getPaymentAmount(getPaymentsForPeriod(salesData, 'daily'), ['doordash', 'door dash']);
    case 'payment_olo_ubereats_today':
      return getPaymentAmount(getPaymentsForPeriod(salesData, 'daily'), ['ubereats', 'uber eats']);
    case 'payment_olo_visa_today':
      return getPaymentAmount(getPaymentsForPeriod(salesData, 'daily'), ['olo visa']);
    case 'payment_olo_mastercard_today':
      return getPaymentAmount(getPaymentsForPeriod(salesData, 'daily'), ['olo mastercard', 'olo mc']);
    case 'payment_olo_prepaid_today':
      return getPaymentAmount(getPaymentsForPeriod(salesData, 'daily'), ['olo prepaid', 'prepaid']);
    case 'payment_olo_giftcard_today':
      return getPaymentAmount(getPaymentsForPeriod(salesData, 'daily'), ['olo gift card', 'olo giftcard']);
    case 'payment_svs_giftcard_today':
      return getPaymentAmount(getPaymentsForPeriod(salesData, 'daily'), ['svs gift card', 'svs giftcard']);

    // Payment type metrics - Daily (percent)
    case 'payment_cash_today_pct':
      return getPaymentPercent(getPaymentsForPeriod(salesData, 'daily'), ['cash']);
    case 'payment_credit_card_today_pct':
      return getPaymentPercent(getPaymentsForPeriod(salesData, 'daily'), ['credit card', 'creditcard']);
    case 'payment_olo_doordash_today_pct':
      return getPaymentPercent(getPaymentsForPeriod(salesData, 'daily'), ['doordash', 'door dash']);
    case 'payment_olo_ubereats_today_pct':
      return getPaymentPercent(getPaymentsForPeriod(salesData, 'daily'), ['ubereats', 'uber eats']);
    case 'payment_olo_visa_today_pct':
      return getPaymentPercent(getPaymentsForPeriod(salesData, 'daily'), ['olo visa']);
    case 'payment_olo_mastercard_today_pct':
      return getPaymentPercent(getPaymentsForPeriod(salesData, 'daily'), ['olo mastercard', 'olo mc']);
    case 'payment_olo_prepaid_today_pct':
      return getPaymentPercent(getPaymentsForPeriod(salesData, 'daily'), ['olo prepaid', 'prepaid']);
    case 'payment_olo_giftcard_today_pct':
      return getPaymentPercent(getPaymentsForPeriod(salesData, 'daily'), ['olo gift card', 'olo giftcard']);
    case 'payment_svs_giftcard_today_pct':
      return getPaymentPercent(getPaymentsForPeriod(salesData, 'daily'), ['svs gift card', 'svs giftcard']);

    // Payment type metrics - Weekly (amount)
    case 'payment_cash_wtd':
      return getPaymentAmount(getPaymentsForPeriod(salesData, 'weekly'), ['cash']);
    case 'payment_credit_card_wtd':
      return getPaymentAmount(getPaymentsForPeriod(salesData, 'weekly'), ['credit card', 'creditcard']);
    case 'payment_olo_doordash_wtd':
      return getPaymentAmount(getPaymentsForPeriod(salesData, 'weekly'), ['doordash', 'door dash']);
    case 'payment_olo_ubereats_wtd':
      return getPaymentAmount(getPaymentsForPeriod(salesData, 'weekly'), ['ubereats', 'uber eats']);
    case 'payment_olo_visa_wtd':
      return getPaymentAmount(getPaymentsForPeriod(salesData, 'weekly'), ['olo visa']);
    case 'payment_olo_mastercard_wtd':
      return getPaymentAmount(getPaymentsForPeriod(salesData, 'weekly'), ['olo mastercard', 'olo mc']);
    case 'payment_olo_prepaid_wtd':
      return getPaymentAmount(getPaymentsForPeriod(salesData, 'weekly'), ['olo prepaid', 'prepaid']);
    case 'payment_olo_giftcard_wtd':
      return getPaymentAmount(getPaymentsForPeriod(salesData, 'weekly'), ['olo gift card', 'olo giftcard']);
    case 'payment_svs_giftcard_wtd':
      return getPaymentAmount(getPaymentsForPeriod(salesData, 'weekly'), ['svs gift card', 'svs giftcard']);

    // Payment type metrics - Weekly (percent)
    case 'payment_cash_wtd_pct':
      return getPaymentPercent(getPaymentsForPeriod(salesData, 'weekly'), ['cash']);
    case 'payment_credit_card_wtd_pct':
      return getPaymentPercent(getPaymentsForPeriod(salesData, 'weekly'), ['credit card', 'creditcard']);
    case 'payment_olo_doordash_wtd_pct':
      return getPaymentPercent(getPaymentsForPeriod(salesData, 'weekly'), ['doordash', 'door dash']);
    case 'payment_olo_ubereats_wtd_pct':
      return getPaymentPercent(getPaymentsForPeriod(salesData, 'weekly'), ['ubereats', 'uber eats']);
    case 'payment_olo_visa_wtd_pct':
      return getPaymentPercent(getPaymentsForPeriod(salesData, 'weekly'), ['olo visa']);
    case 'payment_olo_mastercard_wtd_pct':
      return getPaymentPercent(getPaymentsForPeriod(salesData, 'weekly'), ['olo mastercard', 'olo mc']);
    case 'payment_olo_prepaid_wtd_pct':
      return getPaymentPercent(getPaymentsForPeriod(salesData, 'weekly'), ['olo prepaid', 'prepaid']);
    case 'payment_olo_giftcard_wtd_pct':
      return getPaymentPercent(getPaymentsForPeriod(salesData, 'weekly'), ['olo gift card', 'olo giftcard']);
    case 'payment_svs_giftcard_wtd_pct':
      return getPaymentPercent(getPaymentsForPeriod(salesData, 'weekly'), ['svs gift card', 'svs giftcard']);

    // Payment type metrics - Monthly (amount)
    case 'payment_cash_mtd':
      return getPaymentAmount(getPaymentsForPeriod(salesData, 'monthly'), ['cash']);
    case 'payment_credit_card_mtd':
      return getPaymentAmount(getPaymentsForPeriod(salesData, 'monthly'), ['credit card', 'creditcard']);
    case 'payment_olo_doordash_mtd':
      return getPaymentAmount(getPaymentsForPeriod(salesData, 'monthly'), ['doordash', 'door dash']);
    case 'payment_olo_ubereats_mtd':
      return getPaymentAmount(getPaymentsForPeriod(salesData, 'monthly'), ['ubereats', 'uber eats']);
    case 'payment_olo_visa_mtd':
      return getPaymentAmount(getPaymentsForPeriod(salesData, 'monthly'), ['olo visa']);
    case 'payment_olo_mastercard_mtd':
      return getPaymentAmount(getPaymentsForPeriod(salesData, 'monthly'), ['olo mastercard', 'olo mc']);
    case 'payment_olo_prepaid_mtd':
      return getPaymentAmount(getPaymentsForPeriod(salesData, 'monthly'), ['olo prepaid', 'prepaid']);
    case 'payment_olo_giftcard_mtd':
      return getPaymentAmount(getPaymentsForPeriod(salesData, 'monthly'), ['olo gift card', 'olo giftcard']);
    case 'payment_svs_giftcard_mtd':
      return getPaymentAmount(getPaymentsForPeriod(salesData, 'monthly'), ['svs gift card', 'svs giftcard']);

    // Payment type metrics - Monthly (percent)
    case 'payment_cash_mtd_pct':
      return getPaymentPercent(getPaymentsForPeriod(salesData, 'monthly'), ['cash']);
    case 'payment_credit_card_mtd_pct':
      return getPaymentPercent(getPaymentsForPeriod(salesData, 'monthly'), ['credit card', 'creditcard']);
    case 'payment_olo_doordash_mtd_pct':
      return getPaymentPercent(getPaymentsForPeriod(salesData, 'monthly'), ['doordash', 'door dash']);
    case 'payment_olo_ubereats_mtd_pct':
      return getPaymentPercent(getPaymentsForPeriod(salesData, 'monthly'), ['ubereats', 'uber eats']);
    case 'payment_olo_visa_mtd_pct':
      return getPaymentPercent(getPaymentsForPeriod(salesData, 'monthly'), ['olo visa']);
    case 'payment_olo_mastercard_mtd_pct':
      return getPaymentPercent(getPaymentsForPeriod(salesData, 'monthly'), ['olo mastercard', 'olo mc']);
    case 'payment_olo_prepaid_mtd_pct':
      return getPaymentPercent(getPaymentsForPeriod(salesData, 'monthly'), ['olo prepaid', 'prepaid']);
    case 'payment_olo_giftcard_mtd_pct':
      return getPaymentPercent(getPaymentsForPeriod(salesData, 'monthly'), ['olo gift card', 'olo giftcard']);
    case 'payment_svs_giftcard_mtd_pct':
      return getPaymentPercent(getPaymentsForPeriod(salesData, 'monthly'), ['svs gift card', 'svs giftcard']);

    default:
      return undefined;
  }
}

export function DataCube3D({
  title,
  faces,
  accentColor = '#14B8A6',
  autoRotateInterval = 10000,
  className,
  salesData,
  isLoading = false,
}: DataCube3DProps) {
  const [currentFace, setCurrentFace] = useState(0);
  const [isAnimating, setIsAnimating] = useState(false);
  
  const totalFaces = Math.min(faces.length, 4);
  
  const rotateTo = useCallback((faceIndex: number) => {
    if (isAnimating || faceIndex === currentFace) return;
    setIsAnimating(true);
    setCurrentFace(faceIndex);
    setTimeout(() => setIsAnimating(false), 600);
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
  
  // Calculate rotation based on current face
  const getRotation = () => {
    const rotations = [0, -90, -180, -270];
    return rotations[currentFace] || 0;
  };

  return (
    <div className={cn("relative group", className)}>
      {/* Flat Card Container */}
      <div 
        className="relative w-full aspect-square cursor-pointer overflow-hidden rounded-xl"
        onClick={handleClick}
        style={{
          minHeight: '140px',
        }}
      >
        {/* Render only current face with slide animation */}
        {faces.map((face, index) => (
          <CubeFaceComponent
            key={index}
            face={face}
            accentColor={accentColor}
            salesData={salesData}
            isLoading={isLoading}
            totalFaces={totalFaces}
            currentFace={currentFace}
            faceIndex={index}
            onIndicatorClick={rotateTo}
            title={title}
            isVisible={index === currentFace}
          />
        ))}
      </div>
    </div>
  );
}

interface CubeFaceComponentProps {
  face?: CubeFace;
  accentColor: string;
  salesData?: SalesDataForWidgets | null;
  isLoading?: boolean;
  totalFaces: number;
  currentFace: number;
  faceIndex: number;
  onIndicatorClick: (index: number) => void;
  title?: string;
  isVisible: boolean;
}

function CubeFaceComponent({ 
  face, 
  accentColor, 
  salesData, 
  isLoading, 
  totalFaces,
  currentFace,
  faceIndex,
  onIndicatorClick,
  title,
  isVisible,
}: CubeFaceComponentProps) {
  // Use lightened version for background, original for icons/labels
  const bgColor = lightenColor(accentColor, 0.55);
  const contrastMode = getContrastColor(bgColor);
  // Use white text on dark backgrounds, dark text on light backgrounds
  const textColor = contrastMode === 'light' ? 'rgba(255,255,255,0.95)' : 'rgba(0,0,0,0.85)';
  const titleColor = contrastMode === 'light' ? 'rgba(255,255,255,0.9)' : accentColor;
  const labelColor = contrastMode === 'light' ? 'rgba(255,255,255,0.75)' : accentColor;

  if (!face || face.metrics.length === 0) {
    return (
      <div
        className={cn(
          "absolute inset-0 rounded-xl shadow-lg flex items-center justify-center p-3 transition-all duration-500",
          isVisible ? "opacity-100 translate-x-0" : "opacity-0 translate-x-full pointer-events-none"
        )}
        style={{
          backgroundColor: bgColor,
        }}
      >
        <span style={{ color: labelColor }} className="text-xs">No metrics</span>
      </div>
    );
  }
  
  return (
    <div
      className={cn(
        "absolute inset-0 rounded-xl overflow-hidden flex flex-col transition-all duration-500",
        isVisible ? "opacity-100 translate-x-0" : "opacity-0 -translate-x-full pointer-events-none"
      )}
      style={{
        backgroundColor: bgColor,
      }}
    >
      {/* Sharp curved gloss - iOS app icon style with hard edge through middle */}
      <div 
        className="absolute inset-0 pointer-events-none rounded-xl overflow-hidden"
      >
        {/* Top glossy half with curved bottom edge */}
        <div 
          className="absolute inset-x-0 top-0 pointer-events-none"
          style={{
            height: '55%',
            background: 'linear-gradient(180deg, rgba(255,255,255,0.45) 0%, rgba(255,255,255,0.25) 100%)',
            borderRadius: '0 0 50% 50% / 0 0 30% 30%',
          }}
        />
      </div>
      
      {/* Title inside the cube */}
      {title && (
        <div 
          className="text-xs font-bold px-2.5 pt-2 truncate uppercase tracking-wide relative z-10"
          style={{ color: titleColor }}
        >
          {title}
        </div>
      )}
      
      {/* Content */}
      <div className="flex-1 flex flex-col justify-center px-2.5 py-1 space-y-1 relative z-10">
        {face.metrics.map((metricType, index) => {
          const config = METRIC_CONFIGS[metricType];
          if (!config) return null;
          
          const value = getMetricValue(metricType, salesData);
          const formattedValue = formatValue(value, config.format);
          
          return (
            <div key={index} className="flex items-center gap-1.5">
              {/* Value and label - no icon */}
              <div className="flex-1 min-w-0">
                <div 
                  className={cn(
                    "text-xl font-bold leading-tight",
                    isLoading && "animate-pulse bg-white/30 rounded w-16 h-5"
                  )}
                  style={{ color: textColor }}
                >
                  {!isLoading && formattedValue}
                </div>
                <div 
                  className="text-[11px] font-semibold"
                  style={{ color: labelColor }}
                >
                  {getDynamicLabel(metricType)}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      
      {/* Face Indicator - inside the cube at the bottom */}
      {totalFaces > 1 && (
        <div className="flex justify-center items-center gap-1.5 pb-2">
          {Array.from({ length: totalFaces }).map((_, index) => (
            <button
              key={index}
              onClick={(e) => {
                e.stopPropagation();
                onIndicatorClick(index);
              }}
              className="w-1.5 h-1.5 rounded-full transition-all duration-300"
              style={{
                backgroundColor: index === faceIndex ? accentColor : `${accentColor}40`,
              }}
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
    { metrics: ['sales_today', 'guest_count_today', 'avg_ticket'] },
    { metrics: ['sales_wtd', 'guest_count_wtd', 'labor_percent_wtd'] },
    { metrics: ['sales_mtd', 'labor_hours_mtd', 'labor_percent_mtd'] },
    { metrics: ['labor_hours_today', 'labor_percent_today', 'labor_cost_today'] },
  ];

  return (
    <div className="p-6 space-y-8">
      <h2 className="text-xl font-bold text-foreground">3D Cube Prototype</h2>
      <p className="text-muted-foreground text-sm">Click the cubes to rotate, or wait 10 seconds for auto-rotation.</p>
      
      <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
        {/* 4-face cube */}
        <div className="space-y-2">
          <div className="text-xs text-muted-foreground text-center">4 Faces</div>
          <DataCube3D
            title="Performance Overview"
            faces={demoFaces}
            accentColor="#14B8A6"
            salesData={demoSalesData}
          />
        </div>
        
        {/* 3-face cube */}
        <div className="space-y-2">
          <div className="text-xs text-muted-foreground text-center">3 Faces</div>
          <DataCube3D
            title="Sales Metrics"
            faces={demoFaces.slice(0, 3)}
            accentColor="#8B5CF6"
            salesData={demoSalesData}
          />
        </div>
        
        {/* 2-face cube */}
        <div className="space-y-2">
          <div className="text-xs text-muted-foreground text-center">2 Faces</div>
          <DataCube3D
            title="Quick Stats"
            faces={demoFaces.slice(0, 2)}
            accentColor="#F59E0B"
            salesData={demoSalesData}
          />
        </div>
        
        {/* 1-face cube (no rotation) */}
        <div className="space-y-2">
          <div className="text-xs text-muted-foreground text-center">1 Face</div>
          <DataCube3D
            title="Daily Summary"
            faces={demoFaces.slice(0, 1)}
            accentColor="#EC4899"
            salesData={demoSalesData}
          />
        </div>
      </div>
    </div>
  );
}
