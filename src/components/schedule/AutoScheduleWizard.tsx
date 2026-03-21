import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { format, startOfWeek, subWeeks, addDays } from "date-fns";
import { parseDateStringInTimezone, formatDateTimeInTimezone } from "@/utils/timezoneUtils";
import {
  Sparkles,
  Calendar,
  Clock,
  Check,
  X,
  ChevronRight,
  ChevronLeft,
  AlertTriangle,
  Loader2,
  Copy,
  Users,
  DollarSign,
  Scissors,
  TrendingDown,
} from "lucide-react";
import { Switch } from "@/components/ui/switch";

interface AutoScheduleWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentWeekStart: Date;
  locationId: string;
  scheduleId: string | null;
  onScheduleGenerated: () => void;
}

interface WeekTemplate {
  id: string;
  template_name: string;
  description: string | null;
}

interface AvailabilityRequest {
  id: string;
  user_id: string;
  request_type: string;
  time_scope: string;
  start_date: string;
  end_date: string | null;
  start_time: string | null;
  end_time: string | null;
  hours_requested: number;
  status: string;
  notes: string | null;
  profiles: {
    full_name: string;
    profile_photo_url: string | null;
  };
}

interface UnfilledShift {
  dayOfWeek: number;
  templateName: string;
  startTime: string;
  endTime: string;
  reason: string;
}

interface GeneratedShift {
  user_id: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  shift_date: string;
  template_id?: string;
  template_name?: string;
  original_end_time?: string; // Set if shift was trimmed
  was_trimmed?: boolean;
}

interface LaborSummary {
  dayOfWeek: number;
  dayName: string;
  totalHours: number;
  totalLaborCost: number;
  projectedSales: number;
  laborPercentage: number;
  targetPercentage: number;
  overBudget: boolean;
  amountOverBudget: number;
}

interface TrimSuggestion {
  shiftIndex: number;
  user_id: string;
  userName: string;
  day_of_week: number;
  original_start: string;
  original_end: string;
  suggested_start: string;
  suggested_end: string;
  minutesTrimmed: number;
  laborSaved: number;
  trimType: 'start' | 'end';
}

export function AutoScheduleWizard({
  open,
  onOpenChange,
  currentWeekStart,
  locationId,
  scheduleId,
  onScheduleGenerated,
}: AutoScheduleWizardProps) {
  const [step, setStep] = useState(1);
  const [sourceType, setSourceType] = useState<"template" | "last_week">("template");
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [templates, setTemplates] = useState<WeekTemplate[]>([]);
  const [pendingRequests, setPendingRequests] = useState<AvailabilityRequest[]>([]);
  const [approvedRequests, setApprovedRequests] = useState<AvailabilityRequest[]>([]);
  const [unfilledShifts, setUnfilledShifts] = useState<UnfilledShift[]>([]);
  const [generatedShifts, setGeneratedShifts] = useState<GeneratedShift[]>([]);
  const [loading, setLoading] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [employeeCount, setEmployeeCount] = useState(0);
  
  // Labor optimization state
  const [laborSummary, setLaborSummary] = useState<LaborSummary[]>([]);
  const [optimizedLaborSummary, setOptimizedLaborSummary] = useState<LaborSummary[]>([]);
  const [trimSuggestions, setTrimSuggestions] = useState<TrimSuggestion[]>([]);
  const [totalSavings, setTotalSavings] = useState(0);
  // laborTarget removed - now uses per-day targets from week_template_day_settings
  const [enableLaborOptimization, setEnableLaborOptimization] = useState(true);
  const [optimizedShifts, setOptimizedShifts] = useState<GeneratedShift[]>([]);
  const [useOptimizedShifts, setUseOptimizedShifts] = useState(true);

  useEffect(() => {
    if (open) {
      setStep(1);
      setSourceType("template");
      setSelectedTemplateId(null);
      setTrimSuggestions([]);
      setLaborSummary([]);
      setOptimizedLaborSummary([]);
      setTotalSavings(0);
      setOptimizedShifts([]);
      setUseOptimizedShifts(true);
      fetchTemplates();
    }
  }, [open, locationId]);

  useEffect(() => {
    if (open && step === 2) {
      fetchAvailabilityRequests();
    }
  }, [open, step, currentWeekStart, locationId]);

  // fetchLaborTarget removed - now uses per-day targets from week_template_day_settings

  const fetchTemplates = async () => {
    try {
      const { data, error } = await supabase
        .from("week_templates")
        .select("id, template_name, description")
        .eq("location_id", locationId)
        .order("template_name");

      if (error) throw error;
      setTemplates(data || []);
      if (data && data.length > 0) {
        setSelectedTemplateId(data[0].id);
      }
    } catch (error) {
      console.error("Error fetching templates:", error);
      toast.error("Failed to load templates");
    }
  };

  const fetchAvailabilityRequests = async () => {
    setLoading(true);
    try {
      const weekEnd = addDays(currentWeekStart, 6);
      const weekStartStr = format(currentWeekStart, "yyyy-MM-dd");
      const weekEndStr = format(weekEnd, "yyyy-MM-dd");

      // Fetch pending and approved requests that overlap with the target week
      const { data, error } = await supabase
        .from("availability_requests")
        .select(`
          *,
          profiles!availability_requests_user_id_fkey(full_name, nickname, profile_photo_url)
        `)
        .eq("location_id", locationId)
        .in("status", ["pending", "approved"])
        .or(`start_date.gte.${weekStartStr},end_date.gte.${weekStartStr}`)
        .lte("start_date", weekEndStr)
        .order("start_date");

      if (error) throw error;

      const pending = (data || []).filter(r => r.status === "pending");
      const approved = (data || []).filter(r => r.status === "approved");
      
      setPendingRequests(pending);
      setApprovedRequests(approved);
    } catch (error) {
      console.error("Error fetching availability:", error);
      toast.error("Failed to load availability requests");
    } finally {
      setLoading(false);
    }
  };

  const handleApproveRequest = async (requestId: string) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { error } = await supabase
        .from("availability_requests")
        .update({
          status: "approved",
          reviewed_by: user.id,
          reviewed_at: new Date().toISOString(),
        })
        .eq("id", requestId);

      if (error) throw error;

      // Move from pending to approved locally
      const request = pendingRequests.find(r => r.id === requestId);
      if (request) {
        setPendingRequests(prev => prev.filter(r => r.id !== requestId));
        setApprovedRequests(prev => [...prev, { ...request, status: "approved" }]);
      }
      toast.success("Request approved");
    } catch (error) {
      console.error("Error approving request:", error);
      toast.error("Failed to approve request");
    }
  };

  const handleDenyRequest = async (requestId: string) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { error } = await supabase
        .from("availability_requests")
        .update({
          status: "denied",
          reviewed_by: user.id,
          reviewed_at: new Date().toISOString(),
        })
        .eq("id", requestId);

      if (error) throw error;

      setPendingRequests(prev => prev.filter(r => r.id !== requestId));
      toast.success("Request denied");
    } catch (error) {
      console.error("Error denying request:", error);
      toast.error("Failed to deny request");
    }
  };

  const generateSchedule = async () => {
    setProcessing(true);
    try {
      const response = await supabase.functions.invoke("schedule-service?action=auto-schedule", {
        body: {
          location_id: locationId,
          schedule_id: scheduleId,
          week_start: format(currentWeekStart, "yyyy-MM-dd"),
          source_type: sourceType,
          template_id: sourceType === "template" ? selectedTemplateId : null,
        },
      });

      if (response.error) throw response.error;

      const result = response.data;
      setGeneratedShifts(result.shifts || []);
      setUnfilledShifts(result.unfilled || []);
      setEmployeeCount(result.employeeCount || 0);
      setStep(3);
    } catch (error: any) {
      console.error("Error generating schedule:", error);
      toast.error(error.message || "Failed to generate schedule");
    } finally {
      setProcessing(false);
    }
  };

  const optimizeLabor = async () => {
    if (!enableLaborOptimization) {
      // Skip optimization, go straight to apply
      setStep(4);
      return;
    }

    setProcessing(true);
    try {
      const response = await supabase.functions.invoke("schedule-service?action=optimize-labor", {
        body: {
          location_id: locationId,
          week_start: format(currentWeekStart, "yyyy-MM-dd"),
          template_id: sourceType === "template" ? selectedTemplateId : null,
          generated_shifts: generatedShifts,
          action: 'optimize',
        },
      });

      if (response.error) throw response.error;

      const result = response.data;
      setLaborSummary(result.originalLaborSummary || []);
      setOptimizedLaborSummary(result.optimizedLaborSummary || []);
      setOptimizedShifts(result.optimizedShifts || []);
      setTrimSuggestions(result.trimSuggestions || []);
      setTotalSavings(result.totalSavings || 0);
      setStep(4);
    } catch (error: any) {
      console.error("Error optimizing labor:", error);
      toast.error(error.message || "Failed to optimize labor");
    } finally {
      setProcessing(false);
    }
  };

  const applySchedule = async () => {
    if (!scheduleId) {
      toast.error("No schedule found for this week");
      return;
    }

    setProcessing(true);
    try {
      // Use optimized shifts if labor optimization was applied, otherwise use generated shifts
      const shiftsToApply = useOptimizedShifts && optimizedShifts.length > 0 
        ? optimizedShifts 
        : generatedShifts;

      // Create a map of trimmed shifts from suggestions
      const trimmedShiftMap = new Map<string, TrimSuggestion>();
      if (useOptimizedShifts) {
        trimSuggestions.forEach(trim => {
          // Key by user_id + day_of_week to match with shifts
          const key = `${trim.user_id}-${trim.day_of_week}`;
          trimmedShiftMap.set(key, trim);
        });
      }

      if (shiftsToApply.length > 0) {
        const shiftsToInsert = shiftsToApply.map(shift => {
          // Check if this shift was trimmed
          const trimKey = `${shift.user_id}-${shift.day_of_week}`;
          const trimInfo = trimmedShiftMap.get(trimKey);
          
          return {
            schedule_id: scheduleId,
            user_id: shift.user_id,
            day_of_week: shift.day_of_week,
            start_time: shift.start_time,
            end_time: shift.end_time,
            shift_date: shift.shift_date,
            is_time_off: false,
            template_id: shift.template_id || null,
            was_trimmed: !!trimInfo,
            original_end_time: trimInfo ? trimInfo.original_end : null,
          };
        });

        const { error } = await supabase
          .from("scheduled_shifts")
          .insert(shiftsToInsert);

        if (error) throw error;
      }

      toast.success(`${shiftsToApply.length} shifts added to schedule`);
      onScheduleGenerated();
      onOpenChange(false);
    } catch (error: any) {
      console.error("Error applying schedule:", error);
      toast.error("Failed to apply schedule");
    } finally {
      setProcessing(false);
    }
  };

  const formatTimeScope = (request: AvailabilityRequest) => {
    if (request.time_scope === "partial_day") {
      const dateStr = format(parseDateStringInTimezone(request.start_date, 'America/Los_Angeles'), "MMM d");
      return `${dateStr} (${request.start_time?.slice(0, 5)} - ${request.end_time?.slice(0, 5)})`;
    } else if (request.time_scope === "multi_day" && request.end_date) {
      return `${format(parseDateStringInTimezone(request.start_date, 'America/Los_Angeles'), "MMM d")} - ${format(parseDateStringInTimezone(request.end_date, 'America/Los_Angeles'), "MMM d")}`;
    }
    return format(parseDateStringInTimezone(request.start_date, 'America/Los_Angeles'), "MMM d, yyyy");
  };

  const getInitials = (name: string) => {
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  };

  const getDayName = (dayOfWeek: number) => {
    const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    return days[dayOfWeek];
  };

  const formatHour = (hour: number) => {
    if (hour === 0) return "12am";
    if (hour === 12) return "12pm";
    return hour < 12 ? `${hour}am` : `${hour - 12}pm`;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            Croo AI Auto Schedule
            <Badge variant="secondary" className="ml-2">
              Step {step} of 4
            </Badge>
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-hidden">
          {/* Step 1: Choose Source */}
          {step === 1 && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Choose how to build your schedule:
              </p>

              <RadioGroup
                value={sourceType}
                onValueChange={(v) => setSourceType(v as "template" | "last_week")}
                className="space-y-3"
              >
                <Card
                  className={`p-4 cursor-pointer transition-all ${
                    sourceType === "template" ? "border-primary ring-1 ring-primary" : ""
                  }`}
                  onClick={() => setSourceType("template")}
                >
                  <div className="flex items-start gap-3">
                    <RadioGroupItem value="template" id="template" className="mt-1" />
                    <div className="flex-1">
                      <Label htmlFor="template" className="text-base font-medium cursor-pointer flex items-center gap-2">
                        <Calendar className="h-4 w-4" />
                        Use a Week Template
                      </Label>
                      <p className="text-sm text-muted-foreground mt-1">
                        Generate shifts based on hourly coverage requirements
                      </p>

                      {sourceType === "template" && templates.length > 0 && (
                        <div className="mt-3 space-y-2">
                          {templates.map((t) => (
                            <div
                              key={t.id}
                              className={`p-2 rounded-md border cursor-pointer transition-colors ${
                                selectedTemplateId === t.id
                                  ? "bg-primary/10 border-primary"
                                  : "hover:bg-muted"
                              }`}
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedTemplateId(t.id);
                              }}
                            >
                              <div className="font-medium text-sm">{t.template_name}</div>
                              {t.description && (
                                <div className="text-xs text-muted-foreground">{t.description}</div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}

                      {sourceType === "template" && templates.length === 0 && (
                        <p className="text-sm text-amber-600 mt-2">
                          No templates found. Create one first.
                        </p>
                      )}
                    </div>
                  </div>
                </Card>

                <Card
                  className={`p-4 cursor-pointer transition-all ${
                    sourceType === "last_week" ? "border-primary ring-1 ring-primary" : ""
                  }`}
                  onClick={() => setSourceType("last_week")}
                >
                  <div className="flex items-start gap-3">
                    <RadioGroupItem value="last_week" id="last_week" className="mt-1" />
                    <div className="flex-1">
                      <Label htmlFor="last_week" className="text-base font-medium cursor-pointer flex items-center gap-2">
                        <Copy className="h-4 w-4" />
                        Copy Last Week's Schedule
                      </Label>
                      <p className="text-sm text-muted-foreground mt-1">
                        Duplicate shifts from {format(subWeeks(currentWeekStart, 1), "MMM d")} - {format(addDays(subWeeks(currentWeekStart, 1), 6), "MMM d")}
                      </p>
                    </div>
                  </div>
                </Card>
              </RadioGroup>
            </div>
          )}

          {/* Step 2: Review Availability */}
          {step === 2 && (
            <div className="space-y-4">
              {loading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <>
                  {/* Pending Requests */}
                  <div>
                    <h3 className="text-sm font-medium mb-2 flex items-center gap-2">
                      <Clock className="h-4 w-4 text-amber-500" />
                      Pending Requests ({pendingRequests.length})
                    </h3>
                    <ScrollArea className="h-[150px]">
                      {pendingRequests.length === 0 ? (
                        <p className="text-sm text-muted-foreground py-4 text-center">
                          No pending requests
                        </p>
                      ) : (
                        <div className="space-y-2 pr-3">
                          {pendingRequests.map((request) => (
                            <Card key={request.id} className="p-3">
                              <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-2 min-w-0">
                                  <Avatar className="h-7 w-7">
                                    <AvatarImage src={request.profiles.profile_photo_url || undefined} />
                                    <AvatarFallback className="text-xs">
                                      {getInitials(getDisplayName(request.profiles.full_name, (request.profiles as any).nickname))}
                                    </AvatarFallback>
                                  </Avatar>
                                  <div className="min-w-0">
                                    <div className="text-sm font-medium truncate">
                                      {getDisplayName(request.profiles.full_name, (request.profiles as any).nickname)}
                                    </div>
                                    <div className="text-xs text-muted-foreground">
                                      {formatTimeScope(request)} • {request.hours_requested}h
                                    </div>
                                  </div>
                                </div>
                                <div className="flex gap-1 flex-shrink-0">
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    className="h-7 w-7 text-green-600 hover:text-green-700 hover:bg-green-100"
                                    onClick={() => handleApproveRequest(request.id)}
                                  >
                                    <Check className="h-4 w-4" />
                                  </Button>
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    className="h-7 w-7 text-destructive hover:text-destructive hover:bg-destructive/10"
                                    onClick={() => handleDenyRequest(request.id)}
                                  >
                                    <X className="h-4 w-4" />
                                  </Button>
                                </div>
                              </div>
                            </Card>
                          ))}
                        </div>
                      )}
                    </ScrollArea>
                  </div>

                  {/* Approved Requests */}
                  <div>
                    <h3 className="text-sm font-medium mb-2 flex items-center gap-2">
                      <Check className="h-4 w-4 text-green-600" />
                      Approved Time Off ({approvedRequests.length})
                    </h3>
                    <ScrollArea className="h-[120px]">
                      {approvedRequests.length === 0 ? (
                        <p className="text-sm text-muted-foreground py-4 text-center">
                          No approved time off this week
                        </p>
                      ) : (
                        <div className="space-y-2 pr-3">
                          {approvedRequests.map((request) => (
                            <div
                              key={request.id}
                              className="flex items-center gap-2 p-2 rounded-md bg-muted/50 text-sm"
                            >
                              <Avatar className="h-6 w-6">
                                <AvatarImage src={request.profiles.profile_photo_url || undefined} />
                                <AvatarFallback className="text-xs">
                                  {getInitials(getDisplayName(request.profiles.full_name, (request.profiles as any).nickname))}
                                </AvatarFallback>
                              </Avatar>
                              <span className="font-medium truncate">{getDisplayName(request.profiles.full_name, (request.profiles as any).nickname)}</span>
                              <span className="text-muted-foreground text-xs">
                                {formatTimeScope(request)}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </ScrollArea>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Step 3: Review & Apply */}
          {step === 3 && (
            <div className="space-y-4">
              {/* Summary */}
              <Card className="p-4 bg-primary/5 border-primary/20">
                <div className="flex items-center gap-4">
                  <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                    <Users className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Draft Generated</p>
                    <p className="text-xl font-bold">
                      {generatedShifts.length} shifts for {employeeCount} employees
                    </p>
                  </div>
                </div>
              </Card>

              {/* Unfilled Shifts Warning */}
              {unfilledShifts.length > 0 && (
                <div>
                  <h3 className="text-sm font-medium mb-2 flex items-center gap-2 text-amber-600">
                    <AlertTriangle className="h-4 w-4" />
                    Unfilled Coverage Gaps ({unfilledShifts.length})
                  </h3>
                  <ScrollArea className="h-[150px]">
                    <div className="space-y-1 pr-3">
                      {unfilledShifts.map((gap, i) => (
                        <div
                          key={i}
                          className="flex items-center justify-between p-2 rounded-md bg-amber-50 dark:bg-amber-900/20 text-sm gap-2"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="font-medium truncate">{gap.templateName}</div>
                            <div className="text-xs text-muted-foreground">
                              {getDayName(gap.dayOfWeek)} • {gap.startTime?.slice(0, 5)} - {gap.endTime?.slice(0, 5)}
                            </div>
                          </div>
                          <Badge variant="outline" className="text-amber-600 flex-shrink-0 text-xs">
                            {gap.reason}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                  <p className="text-xs text-muted-foreground mt-2">
                    You can manually fill these after applying the draft.
                  </p>
                </div>
              )}

              {unfilledShifts.length === 0 && (
                <Card className="p-4 bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800">
                  <div className="flex items-center gap-2 text-green-700 dark:text-green-400">
                    <Check className="h-5 w-5" />
                    <span className="font-medium">All coverage requirements met!</span>
                  </div>
                </Card>
              )}
            </div>
          )}

          {/* Step 4: Labor Optimization */}
          {step === 4 && (
            <div className="space-y-4">
              {/* CrooAI Savings Summary */}
              {totalSavings > 0 ? (
                <Card className="p-4 bg-gradient-to-r from-green-50 to-emerald-50 dark:from-green-900/30 dark:to-emerald-900/30 border-green-200 dark:border-green-800">
                  <div className="flex items-center gap-4">
                    <div className="h-12 w-12 rounded-full bg-gradient-to-br from-green-500 to-emerald-600 flex items-center justify-center shadow-lg">
                      <Sparkles className="h-6 w-6 text-white" />
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold text-green-700 dark:text-green-300">
                          CrooAI Optimization
                        </p>
                        <Badge className="bg-green-600 text-white text-[10px] px-1.5 py-0">
                          SAVINGS
                        </Badge>
                      </div>
                      <p className="text-2xl font-bold text-green-600 dark:text-green-400">
                        ${totalSavings.toFixed(2)} <span className="text-base font-normal text-muted-foreground">saved this week</span>
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Projected annual savings: <span className="font-semibold text-green-600">${(totalSavings * 52).toFixed(0)}</span>
                      </p>
                    </div>
                  </div>
                </Card>
              ) : (
                <Card className="p-4 bg-muted/50">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                      <Check className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <p className="font-medium">Labor is within target</p>
                      <p className="text-sm text-muted-foreground">No adjustments needed - schedule is already optimized!</p>
                    </div>
                  </div>
                </Card>
              )}

              {/* Per-Day Labor Status */}
              {optimizedLaborSummary.length > 0 && (
                <div>
                  <h3 className="text-sm font-medium mb-2 flex items-center gap-2">
                    <DollarSign className="h-4 w-4" />
                    Daily Labor Status
                  </h3>
                  <div className="grid grid-cols-7 gap-1">
                    {optimizedLaborSummary.map((day) => (
                      <div
                        key={day.dayOfWeek}
                        className={`p-2 rounded-md text-center text-xs ${
                          day.projectedSales === 0
                            ? 'bg-muted/30 text-muted-foreground'
                            : day.overBudget
                            ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400'
                            : 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                        }`}
                      >
                        <div className="font-medium">{day.dayName.slice(0, 3)}</div>
                        {day.projectedSales > 0 ? (
                          <>
                            <div className="text-[10px] mt-0.5">
                              {day.laborPercentage.toFixed(1)}%
                            </div>
                            <div className="text-[10px] opacity-70">
                              /{day.targetPercentage}%
                            </div>
                          </>
                        ) : (
                          <div className="text-[10px] mt-0.5">--</div>
                        )}
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">
                    {optimizedLaborSummary.filter(d => d.overBudget && d.projectedSales > 0).length === 0
                      ? '✓ All days within labor target'
                      : `${optimizedLaborSummary.filter(d => d.overBudget && d.projectedSales > 0).length} day(s) still over target (max 30min/person limit)`}
                  </p>
                </div>
              )}

              {/* Trim suggestions */}
              {trimSuggestions.length > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-sm font-medium flex items-center gap-2">
                      <Scissors className="h-4 w-4" />
                      Shift Adjustments ({trimSuggestions.length})
                    </h3>
                    <div className="flex items-center gap-2">
                      <Label htmlFor="use-optimized" className="text-xs text-muted-foreground">
                        Apply trimmed shifts
                      </Label>
                      <Switch
                        id="use-optimized"
                        checked={useOptimizedShifts}
                        onCheckedChange={setUseOptimizedShifts}
                      />
                    </div>
                  </div>
                  <ScrollArea className="h-[140px]">
                    <div className="space-y-1 pr-3">
                      {trimSuggestions.map((trim, i) => (
                        <div
                          key={i}
                          className="flex items-center justify-between p-2 rounded-md bg-muted/50 text-sm gap-2"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="font-medium truncate">{trim.userName}</div>
                            <div className="text-xs text-muted-foreground">
                              {getDayName(trim.day_of_week)} • {trim.trimType === 'end' ? 'End' : 'Start'} -{trim.minutesTrimmed}min
                            </div>
                          </div>
                          <Badge variant="outline" className="text-green-600 flex-shrink-0 text-xs">
                            -${trim.laborSaved.toFixed(2)}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="flex-shrink-0 gap-2">
          {step > 1 && (
            <Button
              variant="outline"
              onClick={() => setStep(step - 1)}
              disabled={processing}
            >
              <ChevronLeft className="h-4 w-4 mr-1" />
              Back
            </Button>
          )}

          {step === 1 && (
            <Button
              onClick={() => setStep(2)}
              disabled={sourceType === "template" && !selectedTemplateId}
            >
              Next
              <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          )}

          {step === 2 && (
            <Button onClick={generateSchedule} disabled={processing}>
              {processing ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4 mr-2" />
                  Generate Schedule
                </>
              )}
            </Button>
          )}

          {step === 3 && (
            <Button onClick={optimizeLabor} disabled={processing || generatedShifts.length === 0}>
              {processing ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Optimizing...
                </>
              ) : (
                <>
                  <DollarSign className="h-4 w-4 mr-2" />
                  Optimize Labor
                </>
              )}
            </Button>
          )}

          {step === 4 && (
            <Button onClick={applySchedule} disabled={processing}>
              {processing ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Applying...
                </>
              ) : (
                <>
                  <Check className="h-4 w-4 mr-2" />
                  Apply to Schedule
                </>
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
