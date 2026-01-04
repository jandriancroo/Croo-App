import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Loader2, Building2, DollarSign, CalendarRange, AlertCircle, CheckCircle2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useLocation as useAppLocation } from "@/hooks/useLocation";
import { format, eachDayOfInterval, isSameDay, isAfter, isBefore, startOfDay } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import { cn } from "@/lib/utils";

export interface BankDepositData {
  startDate: string;
  endDate: string;
  entries: Array<{
    entryId: string;
    entryDate: string;
    depositAmount: number;
  }>;
  totalDollars: number;
  totalChange: number;
  totalAmount: number;
  daysIncluded: number;
  notes?: string;
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
  const [step, setStep] = useState<'start' | 'end' | 'review'>('start');
  
  // Fetch already deposited drawer count entries (linked to bank deposits)
  const { data: depositedEntryIds = [], isLoading: loadingDeposited } = useQuery({
    queryKey: ["deposited-drawer-entries", currentLocation?.id],
    queryFn: async () => {
      if (!currentLocation) return [];
      const { data, error } = await supabase
        .from("bank_deposit_entries")
        .select(`
          logbook_entry_id,
          bank_deposits!inner(location_id)
        `)
        .eq("bank_deposits.location_id", currentLocation.id);
      if (error) throw error;
      return data?.map(d => d.logbook_entry_id) || [];
    },
    enabled: !!currentLocation,
  });
  
  // Fetch all past bank deposits to highlight dates
  const { data: pastDeposits = [], isLoading: loadingPastDeposits } = useQuery({
    queryKey: ["past-bank-deposits", currentLocation?.id],
    queryFn: async () => {
      if (!currentLocation) return [];
      const { data, error } = await supabase
        .from("bank_deposits")
        .select("start_date, end_date")
        .eq("location_id", currentLocation.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
    enabled: !!currentLocation,
  });
  
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
          logbook_entry_values(value_text)
        `)
        .eq("location_id", currentLocation.id)
        .eq("category_id", drawerCountCategory.id)
        .gte("entry_date", startStr)
        .lte("entry_date", endStr)
        .order("entry_date", { ascending: true });
      if (error) throw error;
      return data || [];
    },
    enabled: !!currentLocation && !!drawerCountCategory && !!startDate && !!endDate && step === 'review',
  });
  
  // Calculate all deposited date ranges for calendar highlighting
  const depositedDateRanges = useMemo(() => {
    const dates = new Set<string>();
    pastDeposits.forEach(deposit => {
      const start = new Date(deposit.start_date);
      const end = new Date(deposit.end_date);
      const days = eachDayOfInterval({ start, end });
      days.forEach(d => dates.add(format(d, "yyyy-MM-dd")));
    });
    return dates;
  }, [pastDeposits]);
  
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
  
  const handleStartDateSelect = (date: Date | undefined) => {
    if (date) {
      // Check if this date is already deposited
      const dateStr = format(date, "yyyy-MM-dd");
      if (depositedDateRanges.has(dateStr)) {
        return; // Don't allow selecting already deposited dates
      }
      setStartDate(date);
      setEndDate(undefined);
      setStep('end');
    }
  };
  
  const handleEndDateSelect = (date: Date | undefined) => {
    if (date && startDate) {
      // Ensure end date is not before start date
      if (isBefore(date, startDate)) {
        return;
      }
      // Check if any date in range is already deposited
      const days = eachDayOfInterval({ start: startDate, end: date });
      const hasDepositedDay = days.some(d => depositedDateRanges.has(format(d, "yyyy-MM-dd")));
      if (hasDepositedDay) {
        return; // Range includes already deposited dates
      }
      setEndDate(date);
      setStep('review');
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
      })),
      totalDollars: summary.totalDollars,
      totalChange: summary.totalChange,
      totalAmount: summary.totalAmount,
      daysIncluded: summary.daysIncluded,
      notes: notes || undefined,
    };
    
    onSave(data);
  };
  
  const handleBack = () => {
    if (step === 'review') {
      setStep('end');
      setEndDate(undefined);
    } else if (step === 'end') {
      setStep('start');
      setStartDate(undefined);
    }
  };
  
  if (loadingDeposited || loadingPastDeposits) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  
  const isDateDeposited = (date: Date) => {
    return depositedDateRanges.has(format(date, "yyyy-MM-dd"));
  };
  
  const isDateDisabled = (date: Date) => {
    const today = startOfDay(new Date());
    // Can't select future dates
    if (isAfter(date, today)) return true;
    // Can't select already deposited dates
    if (isDateDeposited(date)) return true;
    // In end date selection, can't select before start date
    if (step === 'end' && startDate && isBefore(date, startDate)) return true;
    return false;
  };
  
  return (
    <div className="space-y-6">
      {/* Step indicator */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Badge variant={step === 'start' ? 'default' : 'secondary'}>1. Start Date</Badge>
        <span>→</span>
        <Badge variant={step === 'end' ? 'default' : 'secondary'}>2. End Date</Badge>
        <span>→</span>
        <Badge variant={step === 'review' ? 'default' : 'secondary'}>3. Review</Badge>
      </div>
      
      {/* Date Selection */}
      {(step === 'start' || step === 'end') && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <CalendarRange className="h-5 w-5" />
              {step === 'start' ? 'Select Start Date' : 'Select End Date'}
            </CardTitle>
            <CardDescription>
              {step === 'start' 
                ? 'Choose the first day of drawer counts to include in this bank deposit.' 
                : `Start date: ${startDate ? format(startDate, 'PPP') : 'Not selected'}. Choose the last day to include.`
              }
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col items-center gap-4">
              <Calendar
                mode="single"
                selected={step === 'start' ? startDate : endDate}
                onSelect={step === 'start' ? handleStartDateSelect : handleEndDateSelect}
                disabled={isDateDisabled}
                modifiers={{
                  deposited: (date) => isDateDeposited(date),
                }}
                modifiersStyles={{
                  deposited: {
                    backgroundColor: 'hsl(var(--destructive) / 0.2)',
                    color: 'hsl(var(--destructive))',
                    fontWeight: 'bold',
                  },
                }}
                className="rounded-md border pointer-events-auto"
              />
              
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <div className="flex items-center gap-1">
                  <div className="w-3 h-3 rounded-sm bg-destructive/20 border border-destructive/50" />
                  <span>Already deposited</span>
                </div>
              </div>
              
              {step === 'end' && (
                <Button variant="outline" size="sm" onClick={handleBack}>
                  Back to Start Date
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}
      
      {/* Review & Submit */}
      {step === 'review' && (
        <>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Building2 className="h-5 w-5" />
                Bank Deposit Summary
              </CardTitle>
              <CardDescription>
                {format(startDate!, 'PP')} — {format(endDate!, 'PP')}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {loadingEntries ? (
                <div className="flex items-center justify-center py-4">
                  <Loader2 className="h-5 w-5 animate-spin" />
                </div>
              ) : summary.includableEntries.length === 0 ? (
                <div className="flex items-center gap-2 p-4 bg-amber-50 dark:bg-amber-950/30 rounded-lg text-amber-700 dark:text-amber-400">
                  <AlertCircle className="h-5 w-5" />
                  <span>No drawer counts found for this date range, or all have already been deposited.</span>
                </div>
              ) : (
                <>
                  {/* Daily breakdown */}
                  <div className="space-y-2">
                    <Label className="text-sm font-medium">Daily Breakdown</Label>
                    <div className="rounded-lg border divide-y">
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
          
          <div className="flex gap-2">
            <Button variant="outline" onClick={handleBack} className="flex-1">
              Change Dates
            </Button>
            <Button 
              onClick={handleSubmit} 
              disabled={isSaving || summary.includableEntries.length === 0}
              className="flex-1"
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
          </div>
        </>
      )}
    </div>
  );
}