import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useLocation as useAppLocation } from "@/hooks/useLocation";
import { useUserRole } from "@/hooks/useUserRole";
import { useLocationTimezone } from "@/hooks/useLocationTimezone";
import { formatInTimeZone } from "date-fns-tz";
import { 
  Brain, ChevronDown, ChevronUp, TrendingDown, TrendingUp, 
  AlertTriangle, CheckCircle2, Clock, Users, X, Sparkles
} from "lucide-react";
import { cn } from "@/lib/utils";

interface LaborInsightAnalysis {
  summary: {
    headline: string;
    overallGrade: string;
    totalSavingsOpportunity: number;
    laborPercent: number;
  };
  keyFindings: {
    type: string;
    severity: string;
    title: string;
    detail: string;
    hourRange?: string;
    savingsOpportunity?: number;
  }[];
  hourlyAnalysis: {
    hour: string;
    sales: number;
    laborCost: number;
    laborPercent: number;
    staffCount: number;
    staffNames: string[];
    flag?: string;
  }[];
  employeeComparisons: {
    name: string;
    scheduledHours: number;
    actualHours: number;
    varianceHours: number;
    varianceCost?: number;
    note?: string;
  }[];
  todaySuggestions: {
    priority: string;
    suggestion: string;
    estimatedSavings?: number;
    basedOn?: string;
  }[];
}

const GRADE_COLORS: Record<string, string> = {
  A: "text-emerald-600 bg-emerald-50 dark:text-emerald-400 dark:bg-emerald-950/50",
  B: "text-sky-600 bg-sky-50 dark:text-sky-400 dark:bg-sky-950/50",
  C: "text-amber-600 bg-amber-50 dark:text-amber-400 dark:bg-amber-950/50",
  D: "text-orange-600 bg-orange-50 dark:text-orange-400 dark:bg-orange-950/50",
  F: "text-red-600 bg-red-50 dark:text-red-400 dark:bg-red-950/50",
};

export function LaborIntelligenceCard() {
  const { currentLocation } = useAppLocation();
  const { isAdmin, isManager, isShiftManager, isGeneralManager } = useUserRole();
  const { timezone } = useLocationTimezone();
  const [expanded, setExpanded] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  const canView = isShiftManager || isGeneralManager || isManager || isAdmin;

  const today = formatInTimeZone(new Date(), timezone || "America/Los_Angeles", "yyyy-MM-dd");

  // Fetch yesterday's insight
  const { data: insight } = useQuery({
    queryKey: ["labor-insight", currentLocation?.id, today],
    queryFn: async () => {
      if (!currentLocation) return null;
      // Get yesterday's date
      const todayDate = new Date(today + "T12:00:00");
      todayDate.setDate(todayDate.getDate() - 1);
      const yesterday = todayDate.toISOString().slice(0, 10);

      const { data, error } = await supabase
        .from("labor_insights")
        .select("*")
        .eq("location_id", currentLocation.id)
        .eq("insight_date", yesterday)
        .maybeSingle();

      if (error) throw error;
      return data;
    },
    enabled: !!currentLocation && canView && !dismissed,
    staleTime: 10 * 60 * 1000,
  });

  if (!canView || dismissed || !insight) return null;

  const analysis = insight.analysis as unknown as LaborInsightAnalysis;
  if (!analysis?.summary) return null;

  const gradeColor = GRADE_COLORS[analysis.summary.overallGrade] || GRADE_COLORS.C;
  const highFindings = analysis.keyFindings?.filter(f => f.severity === "high") || [];
  const highSuggestions = analysis.todaySuggestions?.filter(s => s.priority === "high") || [];

  return (
    <div className="rounded-xl border border-border/60 bg-card overflow-hidden shadow-sm">
      {/* Header - Always Visible */}
      <div 
        className="p-3 cursor-pointer active:bg-muted/30 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-start gap-2.5">
          <div className="mt-0.5 p-1.5 rounded-lg bg-gradient-to-br from-violet-500/10 to-purple-500/10 dark:from-violet-500/20 dark:to-purple-500/20">
            <Brain className="h-4 w-4 text-violet-600 dark:text-violet-400" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-violet-600 dark:text-violet-400 uppercase tracking-wider">
                Labor Intelligence
              </span>
              <span className={cn("text-xs font-black px-1.5 py-0.5 rounded-md", gradeColor)}>
                {analysis.summary.overallGrade}
              </span>
              {analysis.summary.totalSavingsOpportunity > 0 && (
                <span className="text-xs font-medium text-amber-600 dark:text-amber-400">
                  ${Math.round(analysis.summary.totalSavingsOpportunity)} savings potential
                </span>
              )}
            </div>
            <p className="text-sm text-foreground mt-0.5 leading-snug">
              {analysis.summary.headline}
            </p>

            {/* Collapsed preview: top finding + top suggestion */}
            {!expanded && (highFindings.length > 0 || highSuggestions.length > 0) && (
              <div className="mt-2 space-y-1.5">
                {highFindings.slice(0, 1).map((f, i) => (
                  <div key={i} className="flex items-start gap-1.5 text-xs text-muted-foreground">
                    <AlertTriangle className="h-3 w-3 mt-0.5 text-amber-500 shrink-0" />
                    <span>{f.title}: {f.detail}</span>
                  </div>
                ))}
                {highSuggestions.slice(0, 1).map((s, i) => (
                  <div key={i} className="flex items-start gap-1.5 text-xs text-muted-foreground">
                    <Sparkles className="h-3 w-3 mt-0.5 text-violet-500 shrink-0" />
                    <span>{s.suggestion}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={(e) => { e.stopPropagation(); setDismissed(true); }}
              className="p-1 rounded-md hover:bg-muted/50 text-muted-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
            {expanded ? (
              <ChevronUp className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            )}
          </div>
        </div>
      </div>

      {/* Expanded Content */}
      {expanded && (
        <div className="border-t border-border/40 bg-muted/20">
          {/* Key Findings */}
          {analysis.keyFindings?.length > 0 && (
            <div className="p-3 border-b border-border/30">
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                Key Findings
              </h4>
              <div className="space-y-2">
                {analysis.keyFindings.map((finding, i) => (
                  <FindingRow key={i} finding={finding} />
                ))}
              </div>
            </div>
          )}

          {/* Hourly Breakdown Table */}
          {analysis.hourlyAnalysis?.length > 0 && (
            <div className="p-3 border-b border-border/30">
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                Hour-by-Hour
              </h4>
              <div className="overflow-x-auto -mx-3 px-3">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-muted-foreground">
                      <th className="text-left py-1 pr-2 font-medium">Hour</th>
                      <th className="text-right py-1 px-2 font-medium">Sales</th>
                      <th className="text-right py-1 px-2 font-medium">Labor</th>
                      <th className="text-right py-1 px-2 font-medium">L%</th>
                      <th className="text-left py-1 pl-2 font-medium">Staff</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analysis.hourlyAnalysis.map((h, i) => (
                      <HourlyRow key={i} hour={h} />
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Employee Schedule vs Actual */}
          {analysis.employeeComparisons?.length > 0 && (
            <div className="p-3 border-b border-border/30">
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                Schedule vs Actual
              </h4>
              <div className="space-y-1.5">
                {analysis.employeeComparisons.map((emp, i) => (
                  <EmployeeRow key={i} employee={emp} />
                ))}
              </div>
            </div>
          )}

          {/* Today's Suggestions */}
          {analysis.todaySuggestions?.length > 0 && (
            <div className="p-3">
              <h4 className="text-xs font-semibold text-violet-600 dark:text-violet-400 uppercase tracking-wider mb-2 flex items-center gap-1">
                <Sparkles className="h-3 w-3" />
                Today's Actions
              </h4>
              <div className="space-y-2">
                {analysis.todaySuggestions.map((suggestion, i) => (
                  <SuggestionRow key={i} suggestion={suggestion} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Sub-components ──

function FindingRow({ finding }: { finding: LaborInsightAnalysis["keyFindings"][0] }) {
  const icons: Record<string, typeof AlertTriangle> = {
    overstaffed: Users,
    understaffed: Users,
    schedule_drift: Clock,
    efficiency_win: CheckCircle2,
    pattern: TrendingDown,
  };
  const Icon = icons[finding.type] || AlertTriangle;
  
  const severityColors = {
    high: "text-red-500",
    medium: "text-amber-500",
    low: "text-muted-foreground",
  };

  return (
    <div className="flex items-start gap-2">
      <Icon className={cn("h-3.5 w-3.5 mt-0.5 shrink-0", severityColors[finding.severity as keyof typeof severityColors] || "text-muted-foreground")} />
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-semibold text-foreground">{finding.title}</span>
          {finding.hourRange && (
            <span className="text-[10px] text-muted-foreground bg-muted px-1 py-0.5 rounded">
              {finding.hourRange}
            </span>
          )}
          {finding.savingsOpportunity && finding.savingsOpportunity > 0 && (
            <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-medium">
              ~${Math.round(finding.savingsOpportunity)}
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground leading-snug">{finding.detail}</p>
      </div>
    </div>
  );
}

function HourlyRow({ hour }: { hour: LaborInsightAnalysis["hourlyAnalysis"][0] }) {
  const hourLabel = formatHourLabel(hour.hour);
  const flagColors = {
    efficient: "",
    warning: "bg-amber-50/50 dark:bg-amber-950/20",
    critical: "bg-red-50/50 dark:bg-red-950/20",
  };
  const laborColor = hour.laborPercent > 40 
    ? "text-red-600 dark:text-red-400 font-semibold" 
    : hour.laborPercent > 30 
      ? "text-amber-600 dark:text-amber-400" 
      : "text-foreground";

  return (
    <tr className={cn("border-t border-border/20", flagColors[hour.flag as keyof typeof flagColors] || "")}>
      <td className="py-1 pr-2 font-medium text-foreground">{hourLabel}</td>
      <td className="py-1 px-2 text-right text-foreground">${Math.round(hour.sales)}</td>
      <td className="py-1 px-2 text-right text-muted-foreground">${Math.round(hour.laborCost)}</td>
      <td className={cn("py-1 px-2 text-right", laborColor)}>{Math.round(hour.laborPercent)}%</td>
      <td className="py-1 pl-2 text-muted-foreground truncate max-w-[120px]" title={hour.staffNames?.join(", ")}>
        {hour.staffCount} ({hour.staffNames?.map(n => n.split(" ")[0]).join(", ")})
      </td>
    </tr>
  );
}

function EmployeeRow({ employee }: { employee: LaborInsightAnalysis["employeeComparisons"][0] }) {
  const isOver = employee.varianceHours > 0.25;
  const isUnder = employee.varianceHours < -0.25;

  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="font-medium text-foreground w-28 truncate">{employee.name}</span>
      <span className="text-muted-foreground">
        {employee.scheduledHours.toFixed(1)}h → {employee.actualHours.toFixed(1)}h
      </span>
      {(isOver || isUnder) && (
        <span className={cn(
          "flex items-center gap-0.5 font-medium",
          isOver ? "text-red-500" : "text-emerald-500"
        )}>
          {isOver ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
          {isOver ? "+" : ""}{employee.varianceHours.toFixed(1)}h
          {employee.varianceCost ? ` ($${Math.abs(Math.round(employee.varianceCost))})` : ""}
        </span>
      )}
      {employee.note && (
        <span className="text-muted-foreground italic truncate">{employee.note}</span>
      )}
    </div>
  );
}

function SuggestionRow({ suggestion }: { suggestion: LaborInsightAnalysis["todaySuggestions"][0] }) {
  return (
    <div className="flex items-start gap-2 p-2 rounded-lg bg-violet-50/50 dark:bg-violet-950/20 border border-violet-200/30 dark:border-violet-800/30">
      <div className={cn(
        "mt-0.5 h-1.5 w-1.5 rounded-full shrink-0",
        suggestion.priority === "high" ? "bg-violet-500" : "bg-violet-300"
      )} />
      <div className="min-w-0">
        <p className="text-xs text-foreground leading-snug">{suggestion.suggestion}</p>
        <div className="flex items-center gap-2 mt-0.5">
          {suggestion.estimatedSavings && suggestion.estimatedSavings > 0 && (
            <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-medium">
              ~${Math.round(suggestion.estimatedSavings)} savings
            </span>
          )}
          {suggestion.basedOn && (
            <span className="text-[10px] text-muted-foreground italic">{suggestion.basedOn}</span>
          )}
        </div>
      </div>
    </div>
  );
}

function formatHourLabel(hour: string): string {
  const h = parseInt(hour.split(":")[0]);
  if (h === 0) return "12 AM";
  if (h < 12) return `${h} AM`;
  if (h === 12) return "12 PM";
  return `${h - 12} PM`;
}
