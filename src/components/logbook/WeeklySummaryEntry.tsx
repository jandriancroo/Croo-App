import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Eye, TrendingUp, TrendingDown, CheckCircle2, Sparkles } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import crooLogo from "@/assets/croo-logo.webp";

interface WeeklySummaryData {
  type: 'weekly_summary';
  week_start: string;
  week_end: string;
  total_sales: number;
  daily_sales: { date: string; sales: number }[];
  total_over_short: number;
  daily_over_short: { date: string; amount: number }[];
  task_completion_rate: number;
  tasks_completed: number;
  tasks_expected: number;
  ai_summary: string;
  generated_at: string;
}

interface WeeklySummaryEntryProps {
  data: WeeklySummaryData;
  createdAt: string;
}

const formatCurrency = (value: number) => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(value);
};

export function WeeklySummaryEntry({ data, createdAt }: WeeklySummaryEntryProps) {
  const [open, setOpen] = useState(false);

  const isOverShortPositive = data.total_over_short >= 0;
  const maxSales = Math.max(...(data.daily_sales?.map(d => d.sales) || [1]));

  return (
    <div className="space-y-2 sm:space-y-3">
      <div className="flex flex-col gap-2 sm:gap-3">
        {/* AI Summary Card */}
        <div className="bg-gradient-to-r from-primary/10 to-primary/5 rounded-lg p-2 sm:p-3 border border-primary/20">
          <div className="flex items-start gap-2">
            <Sparkles className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" />
            <p className="text-xs sm:text-sm italic text-foreground">{data.ai_summary}</p>
          </div>
        </div>

        {/* Quick Stats - more compact on mobile */}
        <div className="grid grid-cols-3 gap-1.5 text-center">
          <div className="bg-muted/50 rounded-lg p-1.5 sm:p-2">
            <div className="text-[10px] sm:text-xs text-muted-foreground whitespace-nowrap">Total Sales</div>
            <div className="font-semibold text-xs sm:text-sm">{formatCurrency(data.total_sales)}</div>
          </div>
          <div className={cn(
            "rounded-lg p-1.5 sm:p-2",
            isOverShortPositive ? "bg-green-500/10" : "bg-destructive/10"
          )}>
            <div className="text-[10px] sm:text-xs text-muted-foreground whitespace-nowrap">Over/Short</div>
            <div className={cn(
              "font-semibold text-xs sm:text-sm flex items-center justify-center gap-0.5",
              isOverShortPositive ? "text-green-600" : "text-destructive"
            )}>
              {isOverShortPositive ? <TrendingUp className="h-3 w-3 flex-shrink-0" /> : <TrendingDown className="h-3 w-3 flex-shrink-0" />}
              <span className="whitespace-nowrap">{formatCurrency(Math.abs(data.total_over_short))}</span>
            </div>
          </div>
          <div className="bg-muted/50 rounded-lg p-1.5 sm:p-2">
            <div className="text-[10px] sm:text-xs text-muted-foreground">Tasks</div>
            <div className="font-semibold text-xs sm:text-sm flex items-center justify-center gap-0.5">
              <CheckCircle2 className="h-3 w-3 text-green-600 flex-shrink-0" />
              {data.task_completion_rate}%
            </div>
          </div>
        </div>

        {/* Mini Bar Chart */}
        {data.daily_sales && data.daily_sales.length > 0 && (
          <div className="flex items-end gap-1 h-10 sm:h-12">
            {data.daily_sales.map((day, idx) => {
              const height = maxSales > 0 ? (day.sales / maxSales) * 100 : 0;
              const dayName = format(new Date(day.date + 'T12:00:00'), 'EEE')[0];
              return (
                <div key={idx} className="flex-1 flex flex-col items-center gap-0.5">
                  <div 
                    className="w-full bg-primary/60 rounded-t transition-all"
                    style={{ height: `${Math.max(height, 4)}%` }}
                  />
                  <span className="text-[9px] sm:text-[10px] text-muted-foreground">{dayName}</span>
                </div>
              );
            })}
          </div>
        )}

        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm" className="w-full">
              <Eye className="h-4 w-4 mr-1" />
              Full Details
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <img src={crooLogo} alt="Croo" className="h-5 w-5" />
                Weekly Summary
              </DialogTitle>
            </DialogHeader>
            
            <div className="space-y-4">
              <div className="text-sm text-muted-foreground">
                Week of {format(new Date(data.week_start + 'T12:00:00'), 'MMM d')} - {format(new Date(data.week_end + 'T12:00:00'), 'MMM d, yyyy')}
              </div>

              {/* AI Summary */}
              <div className="bg-gradient-to-r from-primary/10 to-primary/5 rounded-lg p-3 border border-primary/20">
                <div className="flex items-start gap-2">
                  <Sparkles className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" />
                  <p className="text-sm">{data.ai_summary}</p>
                </div>
              </div>
              
              {/* Sales Breakdown */}
              <div className="space-y-2">
                <div className="font-medium text-sm">Daily Sales</div>
                <div className="space-y-1">
                  {data.daily_sales?.map((day, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground w-16">
                        {format(new Date(day.date + 'T12:00:00'), 'EEE')}
                      </span>
                      <div className="flex-1 bg-muted rounded-full h-4 overflow-hidden">
                        <div 
                          className="h-full bg-primary/60 rounded-full transition-all"
                          style={{ width: `${maxSales > 0 ? (day.sales / maxSales) * 100 : 0}%` }}
                        />
                      </div>
                      <span className="text-xs font-medium w-16 text-right">
                        {formatCurrency(day.sales)}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="flex justify-between items-center pt-2 border-t">
                  <span className="font-medium">Total Sales</span>
                  <span className="font-semibold">{formatCurrency(data.total_sales)}</span>
                </div>
              </div>

              {/* Cash Over/Short */}
              <div className="space-y-2">
                <div className="font-medium text-sm">Cash Variance</div>
                {data.daily_over_short?.length > 0 ? (
                  <div className="grid grid-cols-2 gap-1 text-sm">
                    {data.daily_over_short.map((day, idx) => (
                      <div key={idx} className="contents">
                        <div className="text-muted-foreground">
                          {format(new Date(day.date + 'T12:00:00'), 'EEE')}
                        </div>
                        <div className={cn(
                          "text-right",
                          day.amount >= 0 ? "text-green-600" : "text-destructive"
                        )}>
                          {day.amount >= 0 ? '+' : ''}{formatCurrency(day.amount)}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No drawer counts recorded</p>
                )}
                <div className={cn(
                  "flex justify-between items-center pt-2 border-t",
                  isOverShortPositive ? "text-green-600" : "text-destructive"
                )}>
                  <span className="font-medium">Weekly Total</span>
                  <span className="font-semibold flex items-center gap-1">
                    {isOverShortPositive ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
                    {isOverShortPositive ? '+' : ''}{formatCurrency(data.total_over_short)}
                  </span>
                </div>
              </div>

              {/* Task Completion */}
              <div className="space-y-2">
                <div className="font-medium text-sm">Task Completion</div>
                <div className="flex items-center gap-3">
                  <div className="flex-1 bg-muted rounded-full h-4 overflow-hidden">
                    <div 
                      className={cn(
                        "h-full rounded-full transition-all",
                        data.task_completion_rate >= 90 ? "bg-green-500" :
                        data.task_completion_rate >= 70 ? "bg-amber-500" : "bg-destructive"
                      )}
                      style={{ width: `${data.task_completion_rate}%` }}
                    />
                  </div>
                  <span className="font-semibold">{data.task_completion_rate}%</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {data.tasks_completed} of {data.tasks_expected} tasks completed
                </p>
              </div>

              <div className="text-xs text-muted-foreground text-center pt-2 border-t">
                Generated {format(new Date(data.generated_at), 'MMM d, h:mm a')}
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}

export function parseWeeklySummaryData(valueText: string): WeeklySummaryData | null {
  try {
    const data = JSON.parse(valueText);
    if (data && data.type === 'weekly_summary') {
      return data;
    }
    return null;
  } catch {
    return null;
  }
}
