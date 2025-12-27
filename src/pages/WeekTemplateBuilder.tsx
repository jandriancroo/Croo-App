import { useState, useEffect, useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Layout } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { useUserRole } from "@/hooks/useUserRole";
import { useLocation as useAppLocation } from "@/hooks/useLocation";
import { toast } from "sonner";
import { ArrowLeft, Save, GripVertical, ChevronLeft, ChevronRight, Clock, Percent, DollarSign, RefreshCw, Users } from "lucide-react";
import { DndContext, DragEndEvent, DragStartEvent, DragOverlay, useSensor, useSensors, PointerSensor, TouchSensor, closestCenter } from "@dnd-kit/core";
import { useDroppable, useDraggable } from "@dnd-kit/core";
import { formatTime12Hour } from "@/lib/utils";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { HourlyCoverageDialog } from "@/components/schedule/HourlyCoverageDialog";

export interface ShiftTemplate {
  id: string;
  template_name: string;
  start_time: string;
  end_time: string;
  role: string;
  color: string;
  position: string | null;
}

export interface Assignment {
  id?: string;
  shift_template_id: string;
  day_of_week: number;
  shift_template?: ShiftTemplate;
}

interface DaySettings {
  laborPercent: string;
  projectedSales: string;
}

function calculateShiftHours(startTime: string, endTime: string): number {
  const [startHour, startMin] = startTime.split(':').map(Number);
  const [endHour, endMin] = endTime.split(':').map(Number);
  
  let hours = endHour - startHour;
  let minutes = endMin - startMin;
  
  if (minutes < 0) {
    hours -= 1;
    minutes += 60;
  }
  
  // Handle overnight shifts
  if (hours < 0) {
    hours += 24;
  }
  
  let totalHours = hours + minutes / 60;
  
  // Deduct 30 minutes for shifts over 5 hours
  if (totalHours > 5) {
    totalHours -= 0.5;
  }
  
  return Math.max(0, totalHours);
}

function DraggableShiftTemplate({ template }: { template: ShiftTemplate }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `template-${template.id}`,
    data: { template, isFromList: true },
  });

  const style = transform
    ? {
        transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
        opacity: isDragging ? 0.5 : 1,
      }
    : undefined;

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      className="p-3 bg-card border rounded-lg cursor-grab active:cursor-grabbing hover:border-primary/50 transition-colors"
    >
      <div className="flex items-center gap-2">
        <div
          className="w-3 h-3 rounded-full flex-shrink-0"
          style={{ backgroundColor: template.color }}
        />
        <div className="flex-1 min-w-0">
          <p className="font-medium text-sm truncate">{template.position || template.template_name}</p>
          <p className="text-xs text-muted-foreground">
            {formatTime12Hour(template.start_time)} - {formatTime12Hour(template.end_time)}
          </p>
        </div>
        <GripVertical className="h-4 w-4 text-muted-foreground flex-shrink-0" />
      </div>
    </div>
  );
}

function AssignedShiftCard({ assignment, onRemove }: { assignment: Assignment; onRemove: () => void }) {
  const template = assignment.shift_template;
  if (!template) return null;

  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `assigned-${assignment.shift_template_id}-${assignment.day_of_week}-${Math.random()}`,
    data: { assignment, isFromList: false },
  });

  const style = transform
    ? {
        transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
        opacity: isDragging ? 0.5 : 1,
      }
    : undefined;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="p-2 bg-card border rounded flex items-center gap-2 group"
    >
      <div {...listeners} {...attributes} className="cursor-grab active:cursor-grabbing">
        <GripVertical className="h-3 w-3 text-muted-foreground" />
      </div>
      <div
        className="w-2 h-2 rounded-full flex-shrink-0"
        style={{ backgroundColor: template.color }}
      />
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium truncate">{template.position}</p>
        <p className="text-[10px] text-muted-foreground">
          {formatTime12Hour(template.start_time)} - {formatTime12Hour(template.end_time)}
        </p>
      </div>
      <button
        onClick={onRemove}
        className="text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity text-xs"
      >
        ×
      </button>
    </div>
  );
}

function DroppableDay({ 
  dayIndex, 
  dayName, 
  assignments,
  onRemoveAssignment,
  onCopyToPrevious,
  onCopyToNext,
  daySettings,
  onDaySettingsChange,
  onSyncSales,
  totalHours,
  isFirst,
  isLast,
  onDayNameClick,
  hasCoverageSet,
}: { 
  dayIndex: number; 
  dayName: string; 
  assignments: Assignment[];
  onRemoveAssignment: (index: number) => void;
  onCopyToPrevious: () => void;
  onCopyToNext: () => void;
  daySettings: DaySettings;
  onDaySettingsChange: (field: 'laborPercent' | 'projectedSales', value: string) => void;
  onSyncSales: () => void;
  totalHours: number;
  isFirst: boolean;
  isLast: boolean;
  onDayNameClick: () => void;
  hasCoverageSet: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `day-${dayIndex}`,
    data: { dayIndex },
  });

  // Calculate target labor cost based on projected sales and labor %
  const projectedSales = parseFloat(daySettings.projectedSales) || 0;
  const laborPercent = parseFloat(daySettings.laborPercent) || 0;
  const targetLaborCost = projectedSales * (laborPercent / 100);

  return (
    <div
      ref={setNodeRef}
      className={`p-3 border-2 rounded-lg min-h-[320px] flex flex-col ${
        isOver ? "border-primary bg-accent/50" : "border-border"
      }`}
    >
      {/* Header with copy buttons */}
      <div className="flex items-center justify-between mb-2">
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={onCopyToPrevious}
          disabled={isFirst}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <button
          onClick={onDayNameClick}
          className="font-semibold text-sm text-center hover:text-primary hover:underline transition-colors flex items-center gap-1"
        >
          {dayName}
          {hasCoverageSet && (
            <Users className="h-3 w-3 text-primary" />
          )}
        </button>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={onCopyToNext}
          disabled={isLast}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      {/* Labor Settings */}
      <div className="space-y-2 mb-3 pb-3 border-b border-border">
        {/* Labor Percentage */}
        <div className="flex items-center gap-1">
          <Percent className="h-3 w-3 text-muted-foreground" />
          <Input
            type="number"
            value={daySettings.laborPercent}
            onChange={(e) => onDaySettingsChange('laborPercent', e.target.value)}
            className="h-7 text-xs flex-1"
            placeholder="Labor %"
            min="0"
            max="100"
            step="0.5"
          />
        </div>
        
        {/* Projected Sales */}
        <div className="flex items-center gap-1">
          <DollarSign className="h-3 w-3 text-muted-foreground" />
          <Input
            type="number"
            value={daySettings.projectedSales}
            onChange={(e) => onDaySettingsChange('projectedSales', e.target.value)}
            className="h-7 text-xs flex-1"
            placeholder="Sales"
            min="0"
            step="100"
          />
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={onSyncSales}
            title="Sync from sales data"
          >
            <RefreshCw className="h-3 w-3" />
          </Button>
        </div>

        {/* Target labor display */}
        {laborPercent > 0 && projectedSales > 0 && (
          <div className="text-[10px] text-muted-foreground text-center">
            Target: ${targetLaborCost.toFixed(0)}
          </div>
        )}
      </div>

      {/* Assignments */}
      <div className="flex-1 space-y-2">
        {assignments.map((assignment, index) => (
          <AssignedShiftCard
            key={`${assignment.shift_template_id}-${index}`}
            assignment={assignment}
            onRemove={() => onRemoveAssignment(index)}
          />
        ))}
        {assignments.length === 0 && (
          <p className="text-xs text-muted-foreground text-center mt-4">
            Drop shifts here
          </p>
        )}
      </div>

      {/* Footer: Labor Hours */}
      <div className="mt-3 pt-3 border-t border-border">
        <div className="flex items-center justify-center gap-1 text-xs">
          <Clock className="h-3 w-3 text-muted-foreground" />
          <span className="font-medium">{totalHours.toFixed(1)}h</span>
        </div>
      </div>
    </div>
  );
}

export default function WeekTemplateBuilder() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { isAdmin, isManager, loading: roleLoading } = useUserRole();
  const { currentLocation } = useAppLocation();
  
  const [templateName, setTemplateName] = useState("");
  const [description, setDescription] = useState("");
  const [templateLocationId, setTemplateLocationId] = useState<string | null>(null);
  const [shiftTemplates, setShiftTemplates] = useState<ShiftTemplate[]>([]);
  const [assignmentsByDay, setAssignmentsByDay] = useState<Map<number, Assignment[]>>(new Map());
  const [daySettingsMap, setDaySettingsMap] = useState<Map<number, DaySettings>>(new Map());
  const [hourlyCoverageByDay, setHourlyCoverageByDay] = useState<Map<number, boolean>>(new Map());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeTemplate, setActiveTemplate] = useState<ShiftTemplate | null>(null);
  
  // Copy dialog state
  const [copyDialogOpen, setCopyDialogOpen] = useState(false);
  const [copyDirection, setCopyDirection] = useState<'prev' | 'next'>('next');
  const [copyFromDay, setCopyFromDay] = useState(0);
  
  // Hourly coverage dialog state
  const [coverageDialogOpen, setCoverageDialogOpen] = useState(false);
  const [selectedDayForCoverage, setSelectedDayForCoverage] = useState(0);

  const dayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const isNew = id === 'new';

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 200, tolerance: 8 },
    })
  );

  // Calculate daily labor hours
  const dailyHours = useMemo(() => {
    const hours = new Map<number, number>();
    assignmentsByDay.forEach((assignments, dayIndex) => {
      let total = 0;
      assignments.forEach(a => {
        if (a.shift_template) {
          total += calculateShiftHours(a.shift_template.start_time, a.shift_template.end_time);
        }
      });
      hours.set(dayIndex, total);
    });
    return hours;
  }, [assignmentsByDay]);

  // Calculate weekly total hours
  const weeklyTotalHours = useMemo(() => {
    let total = 0;
    dailyHours.forEach(hours => {
      total += hours;
    });
    return total;
  }, [dailyHours]);

  useEffect(() => {
    if (!roleLoading && !isAdmin && !isManager) {
      navigate('/schedule-templates');
      toast.error('Access denied');
    }
  }, [isAdmin, isManager, roleLoading, navigate]);

  useEffect(() => {
    if ((isAdmin || isManager) && currentLocation?.id) {
      fetchData();
    }
  }, [isAdmin, isManager, currentLocation?.id, id]);

  const fetchData = async () => {
    if (!currentLocation?.id) return;
    
    try {
      setLoading(true);

      // Fetch shift templates
      const { data: shiftData, error: shiftError } = await supabase
        .from("shift_templates")
        .select("*")
        .eq("location_id", currentLocation.id)
        .order("start_time", { ascending: true });

      if (shiftError) throw shiftError;
      setShiftTemplates(shiftData || []);

      // If editing existing template, fetch it
      if (!isNew && id) {
        const { data: weekTemplate, error: weekError } = await supabase
          .from("week_templates")
          .select("*")
          .eq("id", id)
          .single();

        if (weekError) throw weekError;
        
        setTemplateName(weekTemplate.template_name);
        setDescription(weekTemplate.description || "");
        setTemplateLocationId(weekTemplate.location_id);

        // Fetch assignments
        const { data: assignments, error: assignError } = await supabase
          .from("week_template_assignments")
          .select("*, shift_templates(*)")
          .eq("week_template_id", id);

        if (assignError) throw assignError;

        // Fetch day settings
        const { data: daySettingsData, error: daySettingsError } = await supabase
          .from("week_template_day_settings")
          .select("*")
          .eq("week_template_id", id);

        if (daySettingsError) throw daySettingsError;

        // Fetch hourly coverage to know which days have coverage set
        const { data: coverageData, error: coverageError } = await supabase
          .from("week_template_hourly_coverage")
          .select("day_of_week")
          .eq("week_template_id", id);

        if (coverageError) throw coverageError;

        // Track which days have coverage
        const coverageByDay = new Map<number, boolean>();
        (coverageData || []).forEach((c: any) => {
          coverageByDay.set(c.day_of_week, true);
        });
        setHourlyCoverageByDay(coverageByDay);

        // Group assignments by day
        const byDay = new Map<number, Assignment[]>();
        (assignments || []).forEach((a: any) => {
          const dayAssignments = byDay.get(a.day_of_week) || [];
          dayAssignments.push({
            id: a.id,
            shift_template_id: a.shift_template_id,
            day_of_week: a.day_of_week,
            shift_template: a.shift_templates,
          });
          byDay.set(a.day_of_week, dayAssignments);
        });
        setAssignmentsByDay(byDay);

        // Map day settings
        const settingsMap = new Map<number, DaySettings>();
        (daySettingsData || []).forEach((ds: any) => {
          settingsMap.set(ds.day_of_week, {
            laborPercent: ds.labor_percentage_target?.toString() || '',
            projectedSales: ds.projected_sales?.toString() || '',
          });
        });
        setDaySettingsMap(settingsMap);
      }
    } catch (error) {
      console.error('Error fetching data:', error);
      toast.error('Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  const handleDragStart = (event: DragStartEvent) => {
    const data = event.active.data.current;
    if (data?.template) {
      setActiveTemplate(data.template);
    } else if (data?.assignment?.shift_template) {
      setActiveTemplate(data.assignment.shift_template);
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveTemplate(null);

    if (!over) return;

    const overId = over.id as string;
    if (!overId.startsWith('day-')) return;

    const dayIndex = parseInt(overId.replace('day-', ''));
    const data = active.data.current;

    if (data?.isFromList && data?.template) {
      // Adding from shift templates list
      const newAssignment: Assignment = {
        shift_template_id: data.template.id,
        day_of_week: dayIndex,
        shift_template: data.template,
      };

      setAssignmentsByDay(prev => {
        const newMap = new Map(prev);
        const dayAssignments = [...(newMap.get(dayIndex) || []), newAssignment];
        newMap.set(dayIndex, dayAssignments);
        return newMap;
      });
    }
  };

  const handleRemoveAssignment = (dayIndex: number, assignmentIndex: number) => {
    setAssignmentsByDay(prev => {
      const newMap = new Map(prev);
      const dayAssignments = [...(newMap.get(dayIndex) || [])];
      dayAssignments.splice(assignmentIndex, 1);
      newMap.set(dayIndex, dayAssignments);
      return newMap;
    });
  };

  const handleDaySettingsChange = (dayIndex: number, field: 'laborPercent' | 'projectedSales', value: string) => {
    setDaySettingsMap(prev => {
      const newMap = new Map(prev);
      const settings = newMap.get(dayIndex) || { laborPercent: '', projectedSales: '' };
      newMap.set(dayIndex, { ...settings, [field]: value });
      return newMap;
    });
  };

  const handleSyncSales = async (dayIndex: number) => {
    // Use template's location_id if available (for existing templates), otherwise current location
    const locationId = templateLocationId || currentLocation?.id;
    if (!locationId) {
      toast.error("No location available for sync");
      return;
    }

    try {
      // Convert our day_of_week (0=Monday) to JS day (0=Sunday)
      const jsDayOfWeek = dayIndex === 6 ? 0 : dayIndex + 1;
      
      // Calculate date ranges needed for projection formula:
      // (4-week average + last year same day) / 2
      const today = new Date();
      
      // Last 4 same-day-of-weeks
      const fourWeekDates: string[] = [];
      for (let i = 1; i <= 4; i++) {
        const d = new Date(today);
        // Find the next occurrence of the target day of week going back
        const currentDow = d.getDay();
        const daysBack = ((currentDow - jsDayOfWeek + 7) % 7) + (i * 7);
        d.setDate(d.getDate() - daysBack);
        fourWeekDates.push(d.toISOString().split('T')[0]);
      }
      
      // Last year same day of week (same week of year)
      const lastYearDate = new Date(today);
      lastYearDate.setFullYear(lastYearDate.getFullYear() - 1);
      // Adjust to same day of week
      const lyDow = lastYearDate.getDay();
      const dayDiff = jsDayOfWeek - lyDow;
      lastYearDate.setDate(lastYearDate.getDate() + dayDiff);
      const lastYearDateStr = lastYearDate.toISOString().split('T')[0];
      
      // Fetch all needed dates
      const allDates = [...fourWeekDates, lastYearDateStr];
      
      const { data: salesData, error } = await supabase
        .from("sales_cache")
        .select("sale_date, net_sales, hourly_data")
        .eq("location_id", locationId)
        .in("sale_date", allDates);

      if (error) throw error;

      if (!salesData || salesData.length === 0) {
        toast.info("No historical sales data available");
        return;
      }

      // Create lookup map
      const salesMap = new Map<string, { net_sales: number; hourly_data: any }>();
      salesData.forEach((row: any) => {
        salesMap.set(row.sale_date, { 
          net_sales: Number(row.net_sales) || 0, 
          hourly_data: row.hourly_data 
        });
      });

      // Calculate 4-week average, filtering out anomalously low days (likely incomplete data)
      const allFourWeekSales = fourWeekDates
        .map(d => ({ date: d, sales: salesMap.get(d)?.net_sales || 0 }))
        .filter(d => d.sales > 0);
      
      // Calculate median to identify outliers
      const sortedSales = [...allFourWeekSales].sort((a, b) => a.sales - b.sales);
      const median = sortedSales.length > 0 ? sortedSales[Math.floor(sortedSales.length / 2)].sales : 0;
      
      // Filter out days with less than 70% of median (likely incomplete/partial days)
      const validDays = allFourWeekSales.filter(d => d.sales >= median * 0.7);
      const validDayDates = new Set(validDays.map(d => d.date));
      
      const fourWeekSales = validDays.map(d => d.sales);
      const fourWeekAvg = fourWeekSales.length > 0 
        ? fourWeekSales.reduce((sum, s) => sum + s, 0) / fourWeekSales.length 
        : 0;
      
      // Get last year same day
      const lastYearSales = salesMap.get(lastYearDateStr)?.net_sales || 0;
      
      // Calculate projection: (4-week avg + last year) / 2
      let projectedSales = 0;
      if (fourWeekAvg > 0 && lastYearSales > 0) {
        projectedSales = Math.round((fourWeekAvg + lastYearSales) / 2);
      } else if (fourWeekAvg > 0) {
        projectedSales = Math.round(fourWeekAvg);
      } else if (lastYearSales > 0) {
        projectedSales = Math.round(lastYearSales);
      }

      if (projectedSales === 0) {
        toast.info(`No ${dayNames[dayIndex]} sales data found`);
        return;
      }

      // Update the day settings with synced sales
      setDaySettingsMap(prev => {
        const newMap = new Map(prev);
        const settings = newMap.get(dayIndex) || { laborPercent: '', projectedSales: '' };
        newMap.set(dayIndex, { ...settings, projectedSales: projectedSales.toString() });
        return newMap;
      });

      // Also sync hourly projections using same formula
      // Calculate hourly averages from 4-week data (only using valid days)
      const hourlyTotals = new Map<number, { total: number; count: number }>();
      fourWeekDates.forEach(dateStr => {
        // Only use valid days (not filtered out as incomplete)
        if (!validDayDates.has(dateStr)) return;
        
        const cached = salesMap.get(dateStr);
        if (cached?.hourly_data && cached.net_sales > 0) {
          const hourlyArray = cached.hourly_data as Array<{ hour: string | number; sales: number }>;
          hourlyArray.forEach((h) => {
            const hourNum = typeof h.hour === 'string' ? parseInt(h.hour.split(':')[0]) : h.hour;
            // Skip hours with 0 sales (likely incomplete data)
            if ((h.sales || 0) > 0) {
              const existing = hourlyTotals.get(hourNum) || { total: 0, count: 0 };
              hourlyTotals.set(hourNum, {
                total: existing.total + (h.sales || 0),
                count: existing.count + 1,
              });
            }
          });
        }
      });

      // Get last year hourly pattern
      const lastYearHourly = salesMap.get(lastYearDateStr)?.hourly_data as Array<{ hour: string | number; sales: number }> | undefined;
      const lastYearHourlyMap = new Map<number, number>();
      if (lastYearHourly && lastYearSales > 0) {
        lastYearHourly.forEach((h) => {
          const hourNum = typeof h.hour === 'string' ? parseInt(h.hour.split(':')[0]) : h.hour;
          lastYearHourlyMap.set(hourNum, h.sales || 0);
        });
      }

      // Build hourly projections and save to database
      if ((hourlyTotals.size > 0 || lastYearHourlyMap.size > 0) && id) {
        // Get all hours from both sources
        const allHours = new Set([...hourlyTotals.keys(), ...lastYearHourlyMap.keys()]);
        
        // First fetch existing min_staff values
        const { data: existingCoverage } = await supabase
          .from("week_template_hourly_coverage")
          .select("hour, min_staff")
          .eq("week_template_id", id)
          .eq("day_of_week", dayIndex);
        
        const existingStaffMap = new Map<number, number>();
        existingCoverage?.forEach((row: any) => {
          existingStaffMap.set(row.hour, row.min_staff || 0);
        });

        // Calculate raw hourly projections first
        const rawHourlyProjections = new Map<number, number>();
        let rawTotal = 0;
        
        allHours.forEach((hour) => {
          const fourWeekData = hourlyTotals.get(hour);
          const fourWeekHourlyAvg = fourWeekData ? fourWeekData.total / fourWeekData.count : 0;
          const lastYearHourlySales = lastYearHourlyMap.get(hour) || 0;
          
          let hourlyProjection = 0;
          if (fourWeekHourlyAvg > 0 && lastYearHourlySales > 0) {
            hourlyProjection = (fourWeekHourlyAvg + lastYearHourlySales) / 2;
          } else if (fourWeekHourlyAvg > 0) {
            hourlyProjection = fourWeekHourlyAvg;
          } else if (lastYearHourlySales > 0) {
            hourlyProjection = lastYearHourlySales;
          }
          
          if (hourlyProjection > 0) {
            rawHourlyProjections.set(hour, hourlyProjection);
            rawTotal += hourlyProjection;
          }
        });

        // Scale hourly projections so they sum to the daily projection
        const scaleFactor = rawTotal > 0 && projectedSales > 0 ? projectedSales / rawTotal : 1;
        
        const hourlyCoverageRows: { 
          week_template_id: string; 
          day_of_week: number; 
          hour: number; 
          projected_sales: number;
          min_staff: number;
        }[] = [];
        
        rawHourlyProjections.forEach((rawValue, hour) => {
          hourlyCoverageRows.push({
            week_template_id: id!,
            day_of_week: dayIndex,
            hour,
            projected_sales: Math.round(rawValue * scaleFactor),
            min_staff: existingStaffMap.get(hour) || 0,
          });
        });

        if (hourlyCoverageRows.length > 0) {
          // Delete existing and insert new
          await supabase
            .from("week_template_hourly_coverage")
            .delete()
            .eq("week_template_id", id)
            .eq("day_of_week", dayIndex);
          
          await supabase
            .from("week_template_hourly_coverage")
            .insert(hourlyCoverageRows);
        }
      }

      const sources = [];
      if (fourWeekSales.length > 0) sources.push(`${fourWeekSales.length}wk avg`);
      if (lastYearSales > 0) sources.push('YoY');
      
      toast.success(`Synced ${dayNames[dayIndex]}: $${projectedSales.toLocaleString()} (${sources.join(' + ')})`);
    } catch (error) {
      console.error("Error syncing sales:", error);
      toast.error("Failed to sync sales data");
    }
  };

  const handleCopyClick = (fromDay: number, direction: 'prev' | 'next') => {
    setCopyFromDay(fromDay);
    setCopyDirection(direction);
    setCopyDialogOpen(true);
  };

  const handleCopyConfirm = () => {
    const targetDay = copyDirection === 'prev' ? copyFromDay - 1 : copyFromDay + 1;
    const sourceAssignments = assignmentsByDay.get(copyFromDay) || [];
    const sourceSettings = daySettingsMap.get(copyFromDay) || { laborPercent: '', projectedSales: '' };
    
    // Copy assignments
    setAssignmentsByDay(prev => {
      const newMap = new Map(prev);
      const copiedAssignments = sourceAssignments.map(a => ({
        ...a,
        id: undefined,
        day_of_week: targetDay,
      }));
      newMap.set(targetDay, copiedAssignments);
      return newMap;
    });

    // Copy day settings
    setDaySettingsMap(prev => {
      const newMap = new Map(prev);
      newMap.set(targetDay, { ...sourceSettings });
      return newMap;
    });

    setCopyDialogOpen(false);
    toast.success(`Copied ${dayNames[copyFromDay]} to ${dayNames[targetDay]}`);
  };

  const handleDayNameClick = (dayIndex: number) => {
    if (isNew) {
      toast.info("Save the template first to set hourly coverage");
      return;
    }
    setSelectedDayForCoverage(dayIndex);
    setCoverageDialogOpen(true);
  };

  const handleSave = async () => {
    if (!templateName.trim()) {
      toast.error('Please enter a template name');
      return;
    }

    if (!currentLocation?.id) {
      toast.error('No location selected');
      return;
    }

    try {
      setSaving(true);

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      let weekTemplateId = id;

      if (isNew) {
        // Create new week template
        const { data: newTemplate, error: createError } = await supabase
          .from("week_templates")
          .insert({
            template_name: templateName.trim(),
            description: description.trim() || null,
            location_id: currentLocation.id,
            created_by: user.id,
            target_weekly_hours: weeklyTotalHours,
          })
          .select()
          .single();

        if (createError) throw createError;
        weekTemplateId = newTemplate.id;
      } else {
        // Update existing
        const { error: updateError } = await supabase
          .from("week_templates")
          .update({
            template_name: templateName.trim(),
            description: description.trim() || null,
            target_weekly_hours: weeklyTotalHours,
          })
          .eq("id", id);

        if (updateError) throw updateError;

        // Delete existing assignments
        const { error: deleteError } = await supabase
          .from("week_template_assignments")
          .delete()
          .eq("week_template_id", id);

        if (deleteError) throw deleteError;

        // Delete existing day settings
        await supabase
          .from("week_template_day_settings")
          .delete()
          .eq("week_template_id", id);
      }

      // Insert all assignments
      const allAssignments: { 
        week_template_id: string; 
        shift_template_id: string; 
        day_of_week: number;
      }[] = [];
      
      assignmentsByDay.forEach((assignments, dayIndex) => {
        assignments.forEach(a => {
          allAssignments.push({
            week_template_id: weekTemplateId!,
            shift_template_id: a.shift_template_id,
            day_of_week: dayIndex,
          });
        });
      });

      if (allAssignments.length > 0) {
        const { error: insertError } = await supabase
          .from("week_template_assignments")
          .insert(allAssignments);

        if (insertError) throw insertError;
      }

      // Insert day settings
      const daySettingsRows: {
        week_template_id: string;
        day_of_week: number;
        labor_percentage_target: number | null;
        projected_sales: number | null;
      }[] = [];

      daySettingsMap.forEach((settings, dayIndex) => {
        if (settings.laborPercent || settings.projectedSales) {
          daySettingsRows.push({
            week_template_id: weekTemplateId!,
            day_of_week: dayIndex,
            labor_percentage_target: settings.laborPercent ? parseFloat(settings.laborPercent) : null,
            projected_sales: settings.projectedSales ? parseFloat(settings.projectedSales) : null,
          });
        }
      });

      if (daySettingsRows.length > 0) {
        const { error: settingsError } = await supabase
          .from("week_template_day_settings")
          .insert(daySettingsRows);

        if (settingsError) throw settingsError;
      }

      toast.success(isNew ? 'Week template created!' : 'Week template updated!');
      navigate('/schedule-templates?tab=weeks');
    } catch (error) {
      console.error('Error saving template:', error);
      toast.error('Failed to save template');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-64">
          <p>Loading...</p>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-4">
            <Button variant="outline" onClick={() => navigate('/schedule-templates?tab=weeks')}>
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back
            </Button>
            <h1 className="text-2xl font-bold">
              {isNew ? 'Create Week Template' : 'Edit Week Template'}
            </h1>
          </div>
          <div className="flex items-center gap-4">
            {/* Weekly Total Hours */}
            <div className="flex items-center gap-2 bg-muted px-4 py-2 rounded-lg">
              <Clock className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">Weekly Hours:</span>
              <span className="text-lg font-bold">{weeklyTotalHours.toFixed(1)}h</span>
            </div>
            <Button onClick={handleSave} disabled={saving}>
              <Save className="h-4 w-4 mr-2" />
              {saving ? 'Saving...' : 'Save Template'}
            </Button>
          </div>
        </div>

        {/* Template Info */}
        <Card className="p-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <Label htmlFor="name">Template Name</Label>
              <Input
                id="name"
                value={templateName}
                onChange={(e) => setTemplateName(e.target.value)}
                placeholder="e.g., Standard Week, Holiday Week"
              />
            </div>
            <div>
              <Label htmlFor="description">Description (optional)</Label>
              <Textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Notes about this template..."
                rows={1}
              />
            </div>
          </div>
        </Card>

        <DndContext
          sensors={sensors}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          collisionDetection={closestCenter}
        >
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
            {/* Shift Templates List */}
            <Card className="p-4 lg:col-span-1 h-fit lg:sticky lg:top-4">
              <h2 className="font-semibold mb-3">Shift Templates</h2>
              <p className="text-xs text-muted-foreground mb-4">
                Drag shifts to days on the right
              </p>
              
              {shiftTemplates.length > 0 ? (
                <div className="space-y-2">
                  {shiftTemplates.map((template) => (
                    <DraggableShiftTemplate key={template.id} template={template} />
                  ))}
                </div>
              ) : (
                <div className="text-center py-4">
                  <p className="text-sm text-muted-foreground mb-2">No shift templates</p>
                  <Button variant="outline" size="sm" onClick={() => navigate('/shift-templates')}>
                    Create Shift Templates
                  </Button>
                </div>
              )}
            </Card>

            {/* Days Grid - Two Rows */}
            <div className="lg:col-span-3 space-y-4">
              {/* Row 1: Mon-Thu */}
              <div className="grid grid-cols-4 gap-3">
                {dayNames.slice(0, 4).map((dayName, index) => (
                  <DroppableDay
                    key={index}
                    dayIndex={index}
                    dayName={dayName}
                    assignments={assignmentsByDay.get(index) || []}
                    onRemoveAssignment={(assignmentIndex) => handleRemoveAssignment(index, assignmentIndex)}
                    onCopyToPrevious={() => handleCopyClick(index, 'prev')}
                    onCopyToNext={() => handleCopyClick(index, 'next')}
                    daySettings={daySettingsMap.get(index) || { laborPercent: '', projectedSales: '' }}
                    onDaySettingsChange={(field, value) => handleDaySettingsChange(index, field, value)}
                    onSyncSales={() => handleSyncSales(index)}
                    totalHours={dailyHours.get(index) || 0}
                    isFirst={index === 0}
                    isLast={index === 6}
                    onDayNameClick={() => handleDayNameClick(index)}
                    hasCoverageSet={hourlyCoverageByDay.get(index) || false}
                  />
                ))}
              </div>
              {/* Row 2: Fri-Sun */}
              <div className="grid grid-cols-3 gap-3">
                {dayNames.slice(4).map((dayName, sliceIndex) => {
                  const index = sliceIndex + 4;
                  return (
                    <DroppableDay
                      key={index}
                      dayIndex={index}
                      dayName={dayName}
                      assignments={assignmentsByDay.get(index) || []}
                      onRemoveAssignment={(assignmentIndex) => handleRemoveAssignment(index, assignmentIndex)}
                      onCopyToPrevious={() => handleCopyClick(index, 'prev')}
                      onCopyToNext={() => handleCopyClick(index, 'next')}
                      daySettings={daySettingsMap.get(index) || { laborPercent: '', projectedSales: '' }}
                      onDaySettingsChange={(field, value) => handleDaySettingsChange(index, field, value)}
                      onSyncSales={() => handleSyncSales(index)}
                      totalHours={dailyHours.get(index) || 0}
                      isFirst={index === 0}
                      isLast={index === 6}
                      onDayNameClick={() => handleDayNameClick(index)}
                      hasCoverageSet={hourlyCoverageByDay.get(index) || false}
                    />
                  );
                })}
              </div>
            </div>
          </div>

          <DragOverlay>
            {activeTemplate && (
              <div className="p-3 bg-card border rounded-lg shadow-lg opacity-90">
                <div className="flex items-center gap-2">
                  <div
                    className="w-3 h-3 rounded-full"
                    style={{ backgroundColor: activeTemplate.color }}
                  />
                  <div>
                    <p className="font-medium text-sm">{activeTemplate.position}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatTime12Hour(activeTemplate.start_time)} - {formatTime12Hour(activeTemplate.end_time)}
                    </p>
                  </div>
                </div>
              </div>
            )}
          </DragOverlay>
        </DndContext>
      </div>

      {/* Copy Day Dialog */}
      <AlertDialog open={copyDialogOpen} onOpenChange={setCopyDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Copy Day</AlertDialogTitle>
            <AlertDialogDescription>
              Copy all shifts and settings from {dayNames[copyFromDay]} to {dayNames[copyDirection === 'prev' ? copyFromDay - 1 : copyFromDay + 1]}?
              This will replace any existing shifts on {dayNames[copyDirection === 'prev' ? copyFromDay - 1 : copyFromDay + 1]}.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleCopyConfirm}>Copy</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Hourly Coverage Dialog */}
      {!isNew && id && (
        <HourlyCoverageDialog
          open={coverageDialogOpen}
          onOpenChange={(open) => {
            setCoverageDialogOpen(open);
            if (!open) {
              // Refresh coverage data when dialog closes
              fetchData();
            }
          }}
          weekTemplateId={id}
          dayOfWeek={selectedDayForCoverage}
          dayName={dayNames[selectedDayForCoverage]}
        />
      )}
    </Layout>
  );
}
