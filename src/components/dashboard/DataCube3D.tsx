import React, { useState, useEffect, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { DollarSign, Users, TrendingUp, Clock, Percent, Target, Wallet, Calendar, Pizza } from 'lucide-react';
import { MetricType, METRIC_CONFIGS, SalesDataForWidgets } from './DashboardWidget';

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

function getMetricValue(metricType: MetricType, salesData?: SalesDataForWidgets | null): number | undefined {
  if (!salesData) return undefined;
  
  switch (metricType) {
    // Daily sales
    case 'sales_today': return salesData.daily;
    case 'sales_pace': return salesData.projections?.todayPaceAdjusted;
    case 'sales_projected_today': return salesData.projections?.todayProjected;
    case 'sales_last_week':
    case 'sales_last_year': return salesData.comparison?.prevDayFullDay;
    case 'sales_last_year_day': return salesData.lastYear?.sameDay;
    case 'avg_ticket': return salesData.avgTicket;
    
    // Daily guests/products
    case 'guest_count_today': return salesData.guestCount?.daily;
    case 'pizza_count_today': 
      return typeof salesData.pizzaCount === 'number' ? salesData.pizzaCount : salesData.pizzaCount?.daily;
    
    // Daily labor
    case 'labor_percent_today':
    case 'labor_percent': return salesData.labor?.laborPercent;
    case 'labor_cost_today':
    case 'labor_cost': return salesData.labor?.laborCost;
    case 'labor_hours_today':
    case 'labor_hours': return salesData.labor?.hoursWorked;
    
    // Weekly sales
    case 'sales_wtd': return salesData.weekly;
    case 'sales_pace_week': return salesData.projections?.weekPaceAdjusted ?? salesData.projections?.weekProjected;
    case 'sales_projected_week': return salesData.projections?.weekProjected;
    case 'sales_prev_week': return salesData.comparison?.prevWeekFullWeek ?? salesData.comparison?.prevWeek;
    case 'sales_last_year_week': return salesData.lastYear?.sameWeek;
    
    // Weekly guests/products  
    case 'guest_count_wtd': return salesData.guestCount?.weekly;
    case 'pizza_count_wtd':
      return typeof salesData.pizzaCount === 'object' ? salesData.pizzaCount?.weekly : undefined;
    
    // Weekly labor
    case 'labor_percent_wtd': return salesData.weeklyLabor?.laborPercent;
    case 'labor_cost_wtd': return salesData.weeklyLabor?.laborCost;
    case 'labor_hours_wtd': return salesData.weeklyLabor?.hoursWorked;
    
    // Monthly sales
    case 'sales_mtd': return salesData.monthly;
    case 'sales_pace_month': return salesData.projections?.monthPaceAdjusted ?? salesData.projections?.monthProjected;
    case 'sales_projected_month': return salesData.projections?.monthProjected;
    case 'sales_prev_month': return salesData.comparison?.prevMonthFullMonth ?? salesData.comparison?.prevMonth;
    case 'sales_last_year_month': return salesData.lastYear?.sameMonth;
    
    // Monthly guests/products
    case 'guest_count_mtd': return salesData.guestCount?.monthly;
    case 'pizza_count_mtd':
      return typeof salesData.pizzaCount === 'object' ? salesData.pizzaCount?.monthly : undefined;
    
    // Monthly labor
    case 'labor_percent_mtd': return salesData.monthlyLabor?.laborPercent;
    case 'labor_cost_mtd': return salesData.monthlyLabor?.laborCost;
    case 'labor_hours_mtd': return salesData.monthlyLabor?.hoursWorked;
    
    // Personal metrics
    case 'personal_hours_week': return salesData.personalData?.hoursWeek;
    case 'personal_hours_payroll': return salesData.personalData?.hoursPayroll;
    case 'personal_pay_week': return salesData.personalData?.payWeek;
    case 'personal_pay_payroll': return salesData.personalData?.payPayroll;
    
    default: return undefined;
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
      {/* 3D Cube Container */}
      <div 
        className="relative w-full aspect-square cursor-pointer p-2"
        onClick={handleClick}
        style={{
          minHeight: '140px',
          perspective: '600px',
          perspectiveOrigin: 'center center',
        }}
      >
        {/* Cube */}
        <div
          className="absolute inset-2 transition-transform duration-500 ease-in-out"
          style={{
            transformStyle: 'preserve-3d',
            transform: `translateZ(-70px) rotateY(${getRotation()}deg)`,
          }}
        >
          {/* Front Face (0) */}
          {faces[0] && (
            <CubeFaceComponent
              face={faces[0]}
              accentColor={accentColor}
              salesData={salesData}
              isLoading={isLoading}
              totalFaces={totalFaces}
              currentFace={currentFace}
              faceIndex={0}
              onIndicatorClick={rotateTo}
              title={title}
              style={{
                transform: 'translateZ(70px)',
              }}
            />
          )}
          
          {/* Right Face (1) */}
          {totalFaces > 1 && faces[1] && (
            <CubeFaceComponent
              face={faces[1]}
              accentColor={accentColor}
              salesData={salesData}
              isLoading={isLoading}
              totalFaces={totalFaces}
              currentFace={currentFace}
              faceIndex={1}
              onIndicatorClick={rotateTo}
              title={title}
              style={{
                transform: 'rotateY(90deg) translateZ(70px)',
              }}
            />
          )}
          
          {/* Back Face (2) */}
          {totalFaces > 2 && faces[2] && (
            <CubeFaceComponent
              face={faces[2]}
              accentColor={accentColor}
              salesData={salesData}
              isLoading={isLoading}
              totalFaces={totalFaces}
              currentFace={currentFace}
              faceIndex={2}
              onIndicatorClick={rotateTo}
              title={title}
              style={{
                transform: 'rotateY(180deg) translateZ(70px)',
              }}
            />
          )}
          
          {/* Left Face (3) */}
          {totalFaces > 3 && faces[3] && (
            <CubeFaceComponent
              face={faces[3]}
              accentColor={accentColor}
              salesData={salesData}
              isLoading={isLoading}
              totalFaces={totalFaces}
              currentFace={currentFace}
              faceIndex={3}
              onIndicatorClick={rotateTo}
              title={title}
              style={{
                transform: 'rotateY(270deg) translateZ(70px)',
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}

interface CubeFaceComponentProps {
  face?: CubeFace;
  accentColor: string;
  salesData?: SalesDataForWidgets | null;
  isLoading?: boolean;
  style: React.CSSProperties;
  totalFaces: number;
  currentFace: number;
  faceIndex: number;
  onIndicatorClick: (index: number) => void;
  title?: string;
}

function CubeFaceComponent({ 
  face, 
  accentColor, 
  salesData, 
  isLoading, 
  style,
  totalFaces,
  currentFace,
  faceIndex,
  onIndicatorClick,
  title,
}: CubeFaceComponentProps) {
  // Use lightened version for background, original for icons/labels
  const bgColor = lightenColor(accentColor, 0.55);
  const iconColor = accentColor;
  const valueColor = 'rgba(0,0,0,0.85)';
  const labelColor = accentColor;
  const iconBg = 'rgba(255,255,255,0.6)';

  if (!face || face.metrics.length === 0) {
    return (
      <div
        className="absolute inset-0 rounded-xl shadow-lg flex items-center justify-center p-3"
        style={{
          ...style,
          backfaceVisibility: 'hidden',
          backgroundColor: bgColor,
        }}
      >
        <span style={{ color: labelColor }} className="text-xs">No metrics</span>
      </div>
    );
  }
  
  return (
    <div
      className="absolute inset-0 rounded-xl overflow-hidden flex flex-col"
      style={{
        ...style,
        backfaceVisibility: 'hidden',
        backgroundColor: bgColor,
        boxShadow: '0 8px 30px -8px rgba(0, 0, 0, 0.2)',
      }}
    >
      {/* Glossy overlay - iOS style shine effect */}
      <div 
        className="absolute inset-0 pointer-events-none rounded-xl"
        style={{
          background: 'linear-gradient(180deg, rgba(255,255,255,0.45) 0%, rgba(255,255,255,0.15) 45%, rgba(255,255,255,0) 50%, rgba(0,0,0,0.05) 100%)',
        }}
      />
      
      {/* Inner border glow for depth */}
      <div 
        className="absolute inset-0 pointer-events-none rounded-xl"
        style={{
          boxShadow: 'inset 0 1px 1px rgba(255,255,255,0.6), inset 0 -1px 2px rgba(0,0,0,0.1)',
        }}
      />
      
      {/* Title inside the cube */}
      {title && (
        <div 
          className="text-[9px] font-bold px-2.5 pt-1.5 truncate uppercase tracking-wide relative z-10"
          style={{ color: accentColor }}
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
                    "text-sm font-bold leading-tight",
                    isLoading && "animate-pulse bg-white/30 rounded w-14 h-4"
                  )}
                  style={{ color: valueColor }}
                >
                  {!isLoading && formattedValue}
                </div>
                <div 
                  className="text-[8px] font-semibold"
                  style={{ color: labelColor }}
                >
                  {config.shortLabel}
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
