import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Loader2, Building2, DollarSign, CalendarIcon, AlertCircle, CheckCircle2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useLocation as useAppLocation } from "@/hooks/useLocation";
import { format, eachDayOfInterval, isBefore, startOfDay, isAfter, parse, isSameDay, isWithinInterval } from "date-fns";
import { cn } from "@/lib/utils";

export interface BankDepositData {
  startDate: string;
  endDate: string;
  entries: Array<{
    entryId: string;
    entryDate: string;
    depositAmount: number;
    slipPath?: string;
  }>;
  totalDollars: number;
  totalChange: number;
  totalAmount: number;
  daysIncluded: number;
  notes?: string;
  receiptPath?: string;
  verificationRequired?: boolean;
}

interface BankDepositFormProps {
  onSave: (data: BankDepositData) => void;
  isSaving?: boolean;
  timezone?: string;
}

export function BankDepositForm({ onSave, isSaving, timezone = "America/Los_Angeles" }: BankDepositFormProps) {
  const { currentLocation } = useAppLocation();
  const [startDate, setStartDate] = useState<Date | undefined>(undefined);
  const [endDate, setEndDate] = useState<Date | undefined>(undefined);
  const [notes, setNotes] = useState("");
  const [startOpen, setStartOpen] = useState(false);
  const [endOpen, setEndOpen] = useState(false);
  const [slipPaths, setSlipPaths] = useState<Record<string, string>>({});
  const [receiptPath, setReceiptPath] = useState<string | null>(null);

  // Bank Verification toggle (per location)
  const { data: verificationEnabled = false } = useQuery({
    queryKey: ["bank-verification-enabled", currentLocation?.id],
    queryFn: async () => {
      if (!currentLocation) return false;
      const { data } = await supabase
        .from("location_settings")
        .select("bank_verification_enabled")
        .eq("location_id", currentLocation.id)
        .maybeSingle();
      return !!data?.bank_verification_enabled;
    },
    enabled: !!currentLocation,
  });

  
  // Fetch bank deposit category to find existing deposits
  const { data: bankDepositCategory } = useQuery({
    queryKey: ["bank-deposit-category", currentLocation?.id],
    queryFn: async () => {
      if (!currentLocation) return null;
      const { data, error } = await supabase
        .from("logbook_categories")
        .select("id")
        .eq("location_id", currentLocation.id)
        .ilike("name", "%bank deposit%")
        .eq("is_active", true)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!currentLocation,
  });
  
  // Fetch all bank deposit logbook entries to find deposited drawer entries
  const { data: bankDepositEntries = [], isLoading: loadingDeposited } = useQuery({
    queryKey: ["deposited-drawer-entries", currentLocation?.id, bankDepositCategory?.id],
    queryFn: async () => {
      if (!currentLocation || !bankDepositCategory) return [];
      const { data, error } = await supabase
        .from("logbook_entries")
        .select(`
          id,
          entry_date,
          logbook_entry_values(value_text)
        `)
        .eq("location_id", currentLocation.id)
        .eq("category_id", bankDepositCategory.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
    enabled: !!currentLocation && !!bankDepositCategory,
  });
  
  // Extract deposited entry IDs and date ranges from bank deposit entries
  const { depositedEntryIds, depositedDateRanges } = useMemo(() => {
    const entryIds: string[] = [];
    const dateRanges = new Set<string>();

    // IMPORTANT (timezone): never use `new Date('yyyy-MM-dd')` (UTC parsing → off-by-one).
    const parseLocalYMD = (ymd: string) => startOfDay(parse(ymd, "yyyy-MM-dd", new Date()));

    bankDepositEntries.forEach((entry: any) => {
      try {
        const valueText = entry.logbook_entry_values?.[0]?.value_text;
        if (!valueText) return;

        const data = JSON.parse(valueText);

        // Add all entry IDs from this deposit
        if (Array.isArray(data.entries)) {
          data.entries.forEach((e: any) => {
            if (e?.entryId) entryIds.push(e.entryId);
          });
        }

        // Add all dates in the deposited range (inclusive)
        if (data.startDate && data.endDate) {
          const start = parseLocalYMD(data.startDate);
          const end = parseLocalYMD(data.endDate);
          const days = eachDayOfInterval({ start, end });
          days.forEach((d) => dateRanges.add(format(d, "yyyy-MM-dd")));
        }
      } catch (e) {
        console.error("Failed to parse bank deposit entry:", e);
      }
    });

    return { depositedEntryIds: entryIds, depositedDateRanges: dateRanges };
  }, [bankDepositEntries]);
  
  // Fetch drawer count category
  const { data: drawerCountCategory } = useQuery({
    queryKey: ["drawer-count-category", currentLocation?.id],
    queryFn: async () => {
      if (!currentLocation) return null;
      const { data, error } = await supabase
        .from("logbook_categories")
        .select("id")
        .eq("location_id", currentLocation.id)
        .ilike("name", "%drawer count%")
        .eq("is_active", true)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!currentLocation,
  });
  
  // Auto-fetch drawer entries when both dates are selected
  const shouldFetchEntries = !!startDate && !!endDate;
  
  // Fetch drawer count entries for selected date range
  const { data: drawerEntries = [], isLoading: loadingEntries } = useQuery({
    queryKey: ["drawer-entries-for-deposit", currentLocation?.id, drawerCountCategory?.id, startDate, endDate],
    queryFn: async () => {
      if (!currentLocation || !drawerCountCategory || !startDate || !endDate) return [];
      const startStr = format(startDate, "yyyy-MM-dd");
      const endStr = format(endDate, "yyyy-MM-dd");
      
      const { data, error } = await supabase
        .from("logbook_entries")
        .select(`
          id,
          entry_date,
          created_at,
          logbook_entry_values(value_text)
        `)
        .eq("location_id", currentLocation.id)
        .eq("category_id", drawerCountCategory.id)
        .gte("entry_date", startStr)
        .lte("entry_date", endStr)
        .order("entry_date", { ascending: true })
        .order("created_at", { ascending: false }); // Most recent first for each date
      if (error) throw error;
      
      // Deduplicate: keep only the most recent entry per date
      const entriesByDate = new Map<string, any>();
      (data || []).forEach((entry: any) => {
        if (!entriesByDate.has(entry.entry_date)) {
          entriesByDate.set(entry.entry_date, entry);
        }
        // Since we ordered by created_at DESC, the first one we see for each date is the most recent
      });
      
      return Array.from(entriesByDate.values());
    },
    enabled: !!currentLocation && !!drawerCountCategory && shouldFetchEntries,
  });
  
  
  // Calculate summary from drawer entries
  const summary = useMemo(() => {
    const availableEntries: Array<{
      entryId: string;
      entryDate: string;
      depositAmount: number;
      alreadyDeposited: boolean;
    }> = [];
    
    let totalDollars = 0;
    let totalChange = 0;
    
    drawerEntries.forEach((entry: any) => {
      const alreadyDeposited = depositedEntryIds.includes(entry.id);
      
      try {
        const valueText = entry.logbook_entry_values?.[0]?.value_text;
        if (valueText) {
          const data = JSON.parse(valueText);
          const depositAmount = data.actualDeposit || 0;
          
          // Calculate dollars vs change from removal suggestions
          let dollars = 0;
          let change = 0;
          
          if (data.removalSuggestions) {
            data.removalSuggestions.forEach((s: any) => {
              if (s.denomination.includes("$")) {
                dollars += s.value;
              } else {
                change += s.value;
              }
            });
          } else {
            dollars = depositAmount;
          }
          
          availableEntries.push({
            entryId: entry.id,
            entryDate: entry.entry_date,
            depositAmount,
            alreadyDeposited,
          });
          
          if (!alreadyDeposited) {
            totalDollars += dollars;
            totalChange += change;
          }
        }
      } catch (e) {
        console.error("Failed to parse drawer entry:", e);
      }
    });
    
    const includableEntries = availableEntries.filter(e => !e.alreadyDeposited);
    
    return {
      entries: availableEntries,
      includableEntries,
      totalDollars,
      totalChange,
      totalAmount: totalDollars + totalChange,
      daysIncluded: includableEntries.length,
    };
  }, [drawerEntries, depositedEntryIds]);
  
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(amount);
  };
  
  const isDateDeposited = (date: Date) => {
    return depositedDateRanges.has(format(date, "yyyy-MM-dd"));
  };
  
  const isStartDateDisabled = (date: Date) => {
    const today = startOfDay(new Date());
    if (isAfter(date, today)) return true;
    if (isDateDeposited(date)) return true;
    return false;
  };
  
  const isEndDateDisabled = (date: Date) => {
    const today = startOfDay(new Date());
    if (isAfter(date, today)) return true;
    if (isDateDeposited(date)) return true;
    if (startDate && isBefore(date, startDate)) return true;
    return false;
  };
  
  const handleStartDateSelect = (date: Date | undefined) => {
    if (date) {
      const dateStr = format(date, "yyyy-MM-dd");
      if (depositedDateRanges.has(dateStr)) return;
      setStartDate(date);
      // If end date is before start date, clear it
      if (endDate && isBefore(endDate, date)) {
        setEndDate(undefined);
      }
      setStartOpen(false);
    }
  };
  
  const handleEndDateSelect = (date: Date | undefined) => {
    if (date && startDate) {
      if (isBefore(date, startDate)) return;
      // Check if any date in range is already deposited
      const days = eachDayOfInterval({ start: startDate, end: date });
      const hasDepositedDay = days.some(d => depositedDateRanges.has(format(d, "yyyy-MM-dd")));
      if (hasDepositedDay) return;
      setEndDate(date);
      setEndOpen(false);
    }
  };
  
  const handleSubmit = () => {
    if (!startDate || !endDate || summary.includableEntries.length === 0) return;
    
    const data: BankDepositData = {
      startDate: format(startDate, "yyyy-MM-dd"),
      endDate: format(endDate, "yyyy-MM-dd"),
      entries: summary.includableEntries.map(e => ({
        entryId: e.entryId,
        entryDate: e.entryDate,
        depositAmount: e.depositAmount,
        slipPath: slipPaths[e.entryDate] || undefined,
      })),
      totalDollars: summary.totalDollars,
      totalChange: summary.totalChange,
      totalAmount: summary.totalAmount,
      daysIncluded: summary.daysIncluded,
      notes: notes || undefined,
      receiptPath: receiptPath || undefined,
      verificationRequired: verificationEnabled || undefined,
    };
    
    onSave(data);
  };
  
  if (loadingDeposited) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  
  const canShowPreview = startDate && endDate && !loadingEntries;
  const missingSlips = verificationEnabled
    ? summary.includableEntries.filter((e) => !slipPaths[e.entryDate]).length
    : 0;
  const missingReceipt = verificationEnabled && !receiptPath;
  const canSubmit =
    canShowPreview && summary.includableEntries.length > 0 && missingSlips === 0 && !missingReceipt;
  

  
  return (
    <div className="space-y-6">
      {/* Date Selection - Side by side fields */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <CalendarIcon className="h-5 w-5" />
            Select Date Range
          </CardTitle>
          <CardDescription>
            Choose the start and end dates for drawer counts to include
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            {/* Start Date */}
            <div className="space-y-2">
              <Label className="text-sm">Start Date</Label>
              <Popover open={startOpen} onOpenChange={setStartOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "w-full justify-start text-left font-normal h-auto py-3",
                      !startDate && "text-muted-foreground"
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4 shrink-0" />
                    <span className="truncate">
                      {startDate ? format(startDate, "MMM d") : "Pick start"}
                    </span>
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={startDate}
                    onSelect={handleStartDateSelect}
                    disabled={isStartDateDisabled}
                    modifiers={{
                      deposited: (date) => isDateDeposited(date),
                      rangeStart: (date) => !!startDate && isSameDay(date, startDate),
                      rangeEnd: (date) => !!endDate && isSameDay(date, endDate),
                      inRange: (date) =>
                        !!startDate &&
                        !!endDate &&
                        isWithinInterval(date, { start: startDate, end: endDate }),
                    }}
                    modifiersStyles={{
                      deposited: {
                        backgroundColor: "hsl(var(--destructive) / 0.2)",
                        color: "hsl(var(--destructive))",
                        fontWeight: "bold",
                      },
                      inRange: {
                        backgroundColor: "hsl(var(--accent) / 0.35)",
                      },
                    }}
                    initialFocus
                    className="pointer-events-auto"
                  />
                  <div className="p-2 border-t">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <div className="w-3 h-3 rounded-sm bg-destructive/20 border border-destructive/50" />
                      <span>Already deposited</span>
                    </div>
                  </div>
                </PopoverContent>
              </Popover>
            </div>
            
            {/* End Date */}
            <div className="space-y-2">
              <Label className="text-sm">End Date</Label>
              <Popover open={endOpen} onOpenChange={setEndOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "w-full justify-start text-left font-normal h-auto py-3",
                      !endDate && "text-muted-foreground"
                    )}
                    disabled={!startDate}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4 shrink-0" />
                    <span className="truncate">
                      {endDate ? format(endDate, "MMM d") : "Pick end"}
                    </span>
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="end">
                  <Calendar
                    mode="single"
                    selected={endDate}
                    onSelect={handleEndDateSelect}
                    disabled={isEndDateDisabled}
                    modifiers={{
                      deposited: (date) => isDateDeposited(date),
                      rangeStart: (date) => !!startDate && isSameDay(date, startDate),
                      rangeEnd: (date) => !!endDate && isSameDay(date, endDate),
                      inRange: (date) =>
                        !!startDate &&
                        !!endDate &&
                        isWithinInterval(date, { start: startDate, end: endDate }),
                    }}
                    modifiersStyles={{
                      deposited: {
                        backgroundColor: "hsl(var(--destructive) / 0.2)",
                        color: "hsl(var(--destructive))",
                        fontWeight: "bold",
                      },
                      inRange: {
                        backgroundColor: "hsl(var(--accent) / 0.35)",
                      },
                    }}
                    initialFocus
                    className="pointer-events-auto"
                  />
                  <div className="p-2 border-t">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <div className="w-3 h-3 rounded-sm bg-destructive/20 border border-destructive/50" />
                      <span>Already deposited</span>
                    </div>
                  </div>
                </PopoverContent>
              </Popover>
            </div>
          </div>
          
          {startDate && endDate && (
            <div className="text-sm text-muted-foreground text-center">
              {format(startDate, 'PP')} — {format(endDate, 'PP')}
            </div>
          )}
        </CardContent>
      </Card>
      
      {/* Preview/Summary */}
      {canShowPreview && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Building2 className="h-5 w-5" />
              Deposit Summary
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {loadingEntries ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
            ) : summary.includableEntries.length === 0 ? (
              <div className="flex items-center gap-2 p-4 bg-amber-50 dark:bg-amber-950/30 rounded-lg text-amber-700 dark:text-amber-400">
                <AlertCircle className="h-5 w-5 shrink-0" />
                <span className="text-sm">No drawer counts found for this date range, or all have already been deposited.</span>
              </div>
            ) : (
              <>
                {/* Daily breakdown */}
                <div className="space-y-2">
                  <Label className="text-sm font-medium">Daily Breakdown</Label>
                  <div className="rounded-lg border divide-y max-h-48 overflow-y-auto">
                    {summary.entries.map((entry) => (
                      <div 
                        key={entry.entryId}
                        className={cn(
                          "flex items-center justify-between p-3",
                          entry.alreadyDeposited && "opacity-50 bg-muted"
                        )}
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">
                            {format(new Date(entry.entryDate + 'T12:00:00'), 'EEE, MMM d')}
                          </span>
                          {entry.alreadyDeposited && (
                            <Badge variant="secondary" className="text-xs">Already deposited</Badge>
                          )}
                        </div>
                        <span className={cn(
                          "font-mono text-sm",
                          entry.alreadyDeposited ? "line-through" : "font-semibold"
                        )}>
                          {formatCurrency(entry.depositAmount)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
                
                {/* Totals */}
                <div className="space-y-2 pt-2">
                  <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                    <span className="text-muted-foreground">Bills (Dollars)</span>
                    <span className="font-semibold">{formatCurrency(summary.totalDollars)}</span>
                  </div>
                  <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                    <span className="text-muted-foreground">Coins (Change)</span>
                    <span className="font-semibold">{formatCurrency(summary.totalChange)}</span>
                  </div>
                  <div className="flex items-center justify-between p-4 bg-primary/10 border border-primary/30 rounded-lg">
                    <div className="flex items-center gap-2">
                      <DollarSign className="h-5 w-5 text-primary" />
                      <span className="font-medium">Total Deposit</span>
                    </div>
                    <span className="text-2xl font-bold text-primary">
                      {formatCurrency(summary.totalAmount)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                    <span className="text-muted-foreground">Days Included</span>
                    <Badge variant="secondary">{summary.daysIncluded} day{summary.daysIncluded !== 1 ? 's' : ''}</Badge>
                  </div>
                </div>
                
                {/* Notes */}
                <div className="space-y-2">
                  <Label htmlFor="deposit-notes">Notes (optional)</Label>
                  <Textarea
                    id="deposit-notes"
                    placeholder="Any notes about this deposit..."
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    rows={2}
                  />
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}
      
      {/* Submit Button */}
      {canShowPreview && (
        <Button 
          onClick={handleSubmit} 
          disabled={isSaving || !canSubmit}
          className="w-full"
          size="lg"
        >
          {isSaving ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Saving...
            </>
          ) : (
            <>
              <CheckCircle2 className="h-4 w-4 mr-2" />
              Submit Bank Deposit
            </>
          )}
        </Button>
      )}
    </div>
  );
}
