import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

import { Loader2, Building2, DollarSign, CalendarIcon, AlertCircle, CheckCircle2, Camera, ShieldCheck } from "lucide-react";
import { BankVerificationPhoto } from "./BankVerificationPhoto";
import { DepositAuditDialog, type DepositAudit } from "./DepositAuditDialog";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { useLocation as useAppLocation } from "@/hooks/useLocation";
import { format, eachDayOfInterval, isBefore, startOfDay, isAfter, parse, isSameDay, isWithinInterval } from "date-fns";
import { cn } from "@/lib/utils";

export interface BankDepositDayAudit {
  countedAmount: number;
  variance: number;
  auditedAt: string;
  auditedByName?: string;
}

export interface BankDepositData {
  startDate: string;
  endDate: string;
  /**
   * ONE item per drawer-count pull. Every pull's entryId is recorded so all of
   * them count as deposited. Legacy records (pre 2026-09-23) carry one item per
   * DAY and may also carry `slipPath` / `audit` here — readers must fall back to
   * that shape. New records never write slipPath/audit on entries[].
   */
  entries: Array<{
    entryId: string;
    entryDate: string;
    depositAmount: number;
    slipPath?: string;
    audit?: BankDepositDayAudit;
  }>;

  /** Day-level truth: slip photo and audit apply ONCE per day, never per pull. */
  days?: Array<{
    entryDate: string;
    entryIds: string[];
    recordedAmount: number;
    depositAmount: number;
    slipPath?: string;
    audit?: BankDepositDayAudit;
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
  const [audits, setAudits] = useState<Record<string, DepositAudit>>({});
  const [auditTarget, setAuditTarget] = useState<string | null>(null);
  const [auditInfoTarget, setAuditInfoTarget] = useState<string | null>(null);

  const { user } = useAuth();

  const { data: auditorName } = useQuery({
    queryKey: ["bank-deposit-auditor-name", user?.id],
    queryFn: async () => {
      if (!user) return undefined;
      const { data } = await supabase
        .from("profiles")
        .select("full_name")
        .eq("id", user.id)
        .maybeSingle();
      return data?.full_name || undefined;
    },
    enabled: !!user,
  });


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
        .order("created_at", { ascending: true });
      if (error) throw error;

      // NO dedupe. Every drawer count (mid-day pulls included) must be returned
      // and summed — dropping all but the latest count per day is what made
      // mid-day pulls vanish from the deposit.
      return data || [];
    },
    enabled: !!currentLocation && !!drawerCountCategory && shouldFetchEntries,
  });
  
  
  // Calculate summary from drawer entries — grouped by day, ALL pulls summed.
  const summary = useMemo(() => {
    type Pull = {
      entryId: string;
      createdAt: string;
      amountCents: number;
      alreadyDeposited: boolean;
      duplicateOf?: number;
    };

    const byDate = new Map<string, Pull[]>();

    drawerEntries.forEach((entry: any) => {
      try {
        const valueText = entry.logbook_entry_values?.[0]?.value_text;
        if (!valueText) return;
        const data = JSON.parse(valueText);
        // actualDeposit is PER PULL. Never use priorPullsTotal / priorPulls here
        // — those exist only for the drawer form's expected-cash math.
        const amountCents = Math.round((Number(data.actualDeposit) || 0) * 100);
        const list = byDate.get(entry.entry_date) || [];
        list.push({
          entryId: entry.id,
          createdAt: entry.created_at,
          amountCents,
          alreadyDeposited: depositedEntryIds.includes(entry.id),
        });
        byDate.set(entry.entry_date, list);
      } catch (e) {
        console.error("Failed to parse drawer entry:", e);
      }
    });

    const days = Array.from(byDate.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([entryDate, rawPulls]) => {
        const pulls = [...rawPulls].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
        // Same-amount-to-the-cent pulls get a neutral confirm note (never excluded).
        pulls.forEach((p, i) => {
          const firstIdx = pulls.findIndex((o) => o.amountCents === p.amountCents);
          if (firstIdx < i) p.duplicateOf = firstIdx + 1;
        });

        const recordedCents = pulls.reduce((s, p) => s + p.amountCents, 0);
        const audit = audits[entryDate];
        // Audit applies ONCE per day, to the day's total — never per pull.
        const depositCents = audit ? Math.round(audit.countedAmount * 100) : recordedCents;

        return {
          entryDate,
          pulls,
          recordedCents,
          recordedTotal: recordedCents / 100,
          depositCents,
          depositAmount: depositCents / 100,
          alreadyDeposited: pulls.some((p) => p.alreadyDeposited),
        };
      });

    const includableDays = days.filter((d) => !d.alreadyDeposited);

    // Exact split per day: whole dollars in bills, remaining cents as coin.
    let totalDollars = 0;
    let totalChangeCents = 0;
    includableDays.forEach((d) => {
      const dollars = Math.floor(d.depositCents / 100);
      totalDollars += dollars;
      totalChangeCents += d.depositCents - dollars * 100;
    });
    const totalChange = totalChangeCents / 100;

    return {
      days,
      includableDays,
      totalDollars,
      totalChange,
      totalAmount: Math.round((totalDollars * 100 + totalChangeCents)) / 100,
      daysIncluded: includableDays.length,
      auditedDays: includableDays.filter((d) => !!audits[d.entryDate]).length,
    };
  }, [drawerEntries, depositedEntryIds, audits]);
  
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
    if (!startDate || !endDate || summary.includableDays.length === 0) return;

    const data: BankDepositData = {
      startDate: format(startDate, "yyyy-MM-dd"),
      endDate: format(endDate, "yyyy-MM-dd"),
      // One item PER PULL so every drawer count is marked deposited.
      entries: summary.includableDays.flatMap((d) =>
        d.pulls.map((p) => ({
          entryId: p.entryId,
          entryDate: d.entryDate,
          depositAmount: p.amountCents / 100,
        }))
      ),
      // Day-level truth: slip + audit live here, once per day.
      days: summary.includableDays.map((d) => ({
        entryDate: d.entryDate,
        entryIds: d.pulls.map((p) => p.entryId),
        recordedAmount: d.recordedTotal,
        depositAmount: d.depositAmount,
        slipPath: slipPaths[d.entryDate] || undefined,
        audit: audits[d.entryDate] || undefined,
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
    ? summary.includableDays.filter((d) => !slipPaths[d.entryDate]).length
    : 0;
  const missingReceipt = verificationEnabled && !receiptPath;
  const unaudited = summary.includableDays.filter((d) => !audits[d.entryDate]).length;
  const canSubmit =
    canShowPreview && summary.includableDays.length > 0 && missingSlips === 0 && !missingReceipt;
  const auditTargetDay = auditTarget
    ? summary.includableDays.find((d) => d.entryDate === auditTarget)
    : undefined;
  const formatPullTime = (iso: string) => {
    try {
      return new Date(iso).toLocaleTimeString("en-US", {
        timeZone: timezone,
        hour: "numeric",
        minute: "2-digit",
      });
    } catch {
      return "";
    }
  };
  

  
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
            ) : summary.includableDays.length === 0 ? (
              <div className="flex items-center gap-2 p-4 bg-amber-50 dark:bg-amber-950/30 rounded-lg text-amber-700 dark:text-amber-400">
                <AlertCircle className="h-5 w-5 shrink-0" />
                <span className="text-sm">No drawer counts found for this date range, or all have already been deposited.</span>
              </div>
            ) : (
              <>
                {/* Daily breakdown */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <Label className="text-sm font-medium">Daily Breakdown</Label>
                    <div className="flex items-center gap-1.5">
                      {verificationEnabled && (
                        <Badge variant="outline" className="text-[10px] gap-1">
                          <Camera className="h-3 w-3" />
                          = deposit slip
                        </Badge>
                      )}
                      <Badge variant="outline" className="text-[10px] gap-1">
                        <ShieldCheck className="h-3 w-3" />
                        = audit
                      </Badge>
                    </div>
                  </div>
                  <div className="rounded-lg border divide-y max-h-56 overflow-y-auto">
                    {summary.days.map((day) => {
                      const audit = audits[day.entryDate];
                      const dateLabel = format(new Date(day.entryDate + 'T12:00:00'), 'EEE, MMM d');
                      return (
                      <div 
                        key={day.entryDate}
                        className={cn(
                          "p-3",
                          day.alreadyDeposited && "opacity-50 bg-muted"
                        )}
                      >
                        <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium">{dateLabel}</span>
                            {day.pulls.length > 1 && (
                              <Badge variant="outline" className="text-[10px]">
                                {day.pulls.length} pulls
                              </Badge>
                            )}
                            {day.alreadyDeposited && (
                              <Badge variant="secondary" className="text-xs">Already deposited</Badge>
                            )}
                          </div>
                        </div>


                        <div className="flex items-center gap-1.5 shrink-0">
                          {verificationEnabled && !day.alreadyDeposited && currentLocation && (
                            <BankVerificationPhoto
                              locationId={currentLocation.id}
                              slug={`slip-${day.entryDate}`}
                              label={`Deposit slip — ${format(new Date(day.entryDate + 'T12:00:00'), 'MMM d')}`}
                              value={slipPaths[day.entryDate] || null}
                              onChange={(path) =>
                                setSlipPaths((prev) => {
                                  const next = { ...prev };
                                  if (path) next[day.entryDate] = path;
                                  else delete next[day.entryDate];
                                  return next;
                                })
                              }
                            />
                          )}
                          {!day.alreadyDeposited && (
                            <Button
                              type="button"
                              variant={audit ? "outline" : "secondary"}
                              size="icon"
                              className={cn(
                                "h-9 w-9",
                                audit && "border-emerald-500/40 text-emerald-600 dark:text-emerald-400"
                              )}
                              title={audit ? "Audited — tap to re-audit" : "Audit this deposit"}
                              aria-label={`Audit deposit for ${dateLabel}`}
                              onClick={() => setAuditTarget(day.entryDate)}
                            >
                              <ShieldCheck className="h-4 w-4" />
                            </Button>
                          )}
                          {audit ? (
                            <button
                              type="button"
                              onClick={() => setAuditInfoTarget(day.entryDate)}
                              className="w-24 text-right leading-tight"
                              aria-label={`View audit details for ${dateLabel}`}
                            >
                              <span className="block font-mono text-xs text-muted-foreground line-through tabular-nums">
                                {formatCurrency(day.recordedTotal)}
                              </span>
                              <span className="block font-mono text-sm text-destructive underline decoration-dotted tabular-nums" style={{ fontWeight: 800 }}>
                                {formatCurrency(audit.countedAmount)}
                              </span>
                            </button>
                          ) : (
                            <span className={cn(
                              "font-mono text-sm w-20 text-right tabular-nums",
                              day.alreadyDeposited && "line-through"
                            )}
                            style={day.alreadyDeposited ? undefined : { fontWeight: 800 }}>
                              {formatCurrency(day.recordedTotal)}
                            </span>
                          )}
                        </div>
                        </div>

                        {day.pulls.length > 1 && (
                          <div className="mt-1.5 space-y-0.5 pl-0.5">
                            {day.pulls.map((p, i) => (
                              <div key={p.entryId}>
                                <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                                  <span>
                                    Pull #{i + 1} · {formatPullTime(p.createdAt)}
                                  </span>
                                  <span className="font-mono tabular-nums">
                                    {formatCurrency(p.amountCents / 100)}
                                  </span>
                                </div>
                                {p.duplicateOf && (
                                  <p className="text-[10px] text-amber-600 dark:text-amber-400">
                                    Same amount as Pull #{p.duplicateOf} — confirm or audit.
                                  </p>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      );
                    })}
                  </div>
                  {verificationEnabled && missingSlips > 0 && (
                    <p className="text-xs text-amber-600 dark:text-amber-400">
                      {missingSlips} day{missingSlips !== 1 ? 's' : ''} still need a deposit slip photo.
                    </p>
                  )}
                  {unaudited > 0 && (
                    <p className="text-xs text-muted-foreground">
                      {unaudited} day{unaudited !== 1 ? 's' : ''} not audited yet (optional).
                    </p>
                  )}
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
                  <div className="p-4 bg-primary/10 border border-primary/30 rounded-lg space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <DollarSign className="h-5 w-5 text-primary" />
                        <span className="font-medium">Total Deposit</span>
                      </div>
                      <span className="text-2xl font-bold text-primary">
                        {formatCurrency(summary.totalAmount)}
                      </span>
                    </div>
                    {verificationEnabled && currentLocation && (
                      <div className="flex items-center justify-between gap-2 pt-2 border-t border-primary/20">
                        <Badge variant="outline" className="text-[10px] gap-1">
                          <Camera className="h-3 w-3" />
                          = bank receipt {receiptPath ? "(attached)" : "(required)"}
                        </Badge>
                        <BankVerificationPhoto
                          locationId={currentLocation.id}
                          slug="receipt"
                          label="Bank receipt"
                          variant="icon"
                          value={receiptPath}
                          onChange={setReceiptPath}
                        />
                      </div>
                    )}

                    {summary.auditedDays > 0 && (
                      <p className="text-xs text-muted-foreground">
                        Includes audited amounts for {summary.auditedDays} day{summary.auditedDays !== 1 ? 's' : ''}.
                      </p>
                    )}
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

      {auditTargetEntry && (
        <DepositAuditDialog
          open={!!auditTarget}
          onOpenChange={(o) => !o && setAuditTarget(null)}
          expectedAmount={auditTargetEntry.depositAmount}
          dateLabel={format(new Date(auditTargetEntry.entryDate + 'T12:00:00'), 'EEEE, MMM d, yyyy')}
          auditorName={auditorName}
          existing={audits[auditTargetEntry.entryDate] || null}
          onSubmit={(audit) =>
            setAudits((prev) => ({ ...prev, [auditTargetEntry.entryDate]: audit }))
          }
        />
      )}

      <Dialog open={!!auditInfoTarget} onOpenChange={(o) => !o && setAuditInfoTarget(null)}>
        <DialogContent className="max-w-sm">
          {auditInfoTarget && audits[auditInfoTarget] && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 text-base">
                  <ShieldCheck className="h-4 w-4 text-destructive" />
                  Audit — {format(new Date(auditInfoTarget + 'T12:00:00'), 'EEE, MMM d, yyyy')}
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Drawer count</span>
                  <span className="font-mono line-through text-muted-foreground">
                    {formatCurrency(
                      summary.entries.find((e) => e.entryDate === auditInfoTarget)?.depositAmount || 0
                    )}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Audited amount</span>
                  <span className="font-mono font-semibold text-destructive">
                    {formatCurrency(audits[auditInfoTarget].countedAmount)}
                  </span>
                </div>
                <div className="flex items-center justify-between border-t pt-2">
                  <span className="text-muted-foreground">Variance</span>
                  <span className="font-mono font-semibold">
                    {audits[auditInfoTarget].variance > 0 ? '+' : ''}
                    {formatCurrency(audits[auditInfoTarget].variance)}
                  </span>
                </div>
                {audits[auditInfoTarget].auditedByName && (
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Audited by</span>
                    <span className="font-medium">{audits[auditInfoTarget].auditedByName}</span>
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Time</span>
                  <span>{format(new Date(audits[auditInfoTarget].auditedAt), 'MMM d, h:mm a')}</span>
                </div>
              </div>
              <Button
                variant="outline"
                className="w-full"
                onClick={() => {
                  const d = auditInfoTarget;
                  setAuditInfoTarget(null);
                  setAuditTarget(d);
                }}
              >
                Re-audit
              </Button>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>


  );
}
