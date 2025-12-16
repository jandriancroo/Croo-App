import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Eye, Sun, Moon, CheckCircle2 } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

interface SafeCountData {
  shift: 'AM' | 'PM';
  counts: Record<string, number>;
  rolls?: Record<string, number>;
  totalSafe: number;
  difference: number;
  adjustmentSuggestions: { denomination: string; count: number; value: number; action: 'add' | 'remove' }[];
}

interface SafeCountEntryProps {
  data: SafeCountData;
  createdAt: string;
}

const formatCurrency = (value: number) => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(value);
};

export function SafeCountEntry({ data, createdAt }: SafeCountEntryProps) {
  const [open, setOpen] = useState(false);
  
  // Check if $1 bills count is less than 20
  const onesCount = data.counts?.['$1'] || 0;
  const needsBankRun = onesCount < 20;

  return (
    <div className="space-y-3">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-3 flex-wrap">
          <Badge 
            className={cn(
              "text-xs",
              data.shift === 'AM' 
                ? "bg-amber-100 text-amber-900 border-amber-300" 
                : "bg-indigo-900 text-indigo-100 border-indigo-700"
            )}
          >
            {data.shift === 'AM' ? <Sun className="h-3 w-3 mr-1" /> : <Moon className="h-3 w-3 mr-1" />}
            {data.shift}
          </Badge>
          <div className="flex items-center gap-1 text-sm">
            <CheckCircle2 className="h-4 w-4 text-green-600" />
            <span className="font-medium">{formatCurrency(data.totalSafe)}</span>
          </div>
          {needsBankRun && (
            <Badge variant="destructive" className="text-xs">
              Bank Run Needed
            </Badge>
          )}
        </div>
        
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm" className="w-full sm:w-auto">
              <Eye className="h-4 w-4 mr-1" />
              Details
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                Safe Count Details
                <Badge 
                  className={cn(
                    "text-xs",
                    data.shift === 'AM' 
                      ? "bg-amber-100 text-amber-900 border-amber-300" 
                      : "bg-indigo-900 text-indigo-100 border-indigo-700"
                  )}
                >
                  {data.shift === 'AM' ? <Sun className="h-3 w-3 mr-1" /> : <Moon className="h-3 w-3 mr-1" />}
                  {data.shift}
                </Badge>
              </DialogTitle>
            </DialogHeader>
            
            <div className="space-y-4">
              <div className="text-sm text-muted-foreground">
                Entered at {format(new Date(createdAt), 'h:mm a')} on {format(new Date(createdAt), 'MMM d, yyyy')}
              </div>
              
              {/* Loose counts */}
              <div className="space-y-2">
                <div className="font-medium text-sm">Loose Count</div>
                <div className="grid grid-cols-2 gap-1 text-sm">
                  {Object.entries(data.counts || {}).map(([denom, count]) => (
                    count > 0 && (
                      <div key={denom} className="contents">
                        <div className="text-muted-foreground">{denom}</div>
                        <div className="text-right">{count}</div>
                      </div>
                    )
                  ))}
                </div>
              </div>

              {/* Rolls - only show if there are any */}
              {data.rolls && Object.values(data.rolls).some(v => v > 0) && (
                <div className="space-y-2">
                  <div className="font-medium text-sm">Coin Rolls</div>
                  <div className="grid grid-cols-2 gap-1 text-sm">
                    {Object.entries(data.rolls).map(([denom, count]) => (
                      count > 0 && (
                        <div key={`roll-${denom}`} className="contents">
                          <div className="text-muted-foreground">{denom} Rolls</div>
                          <div className="text-right">{count}</div>
                        </div>
                      )
                    ))}
                  </div>
                </div>
              )}
              
              <div className="border-t pt-3 space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">Safe Total:</span>
                  <span className="font-semibold text-green-600 flex items-center gap-1">
                    <CheckCircle2 className="h-4 w-4" />
                    {formatCurrency(data.totalSafe)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Target:</span>
                  <span className="font-medium">{formatCurrency(300)}</span>
                </div>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}

export function parseSafeCountData(valueText: string): SafeCountData | null {
  try {
    const data = JSON.parse(valueText);
    // Check if it's safe count data by looking for the shift field
    if (data && data.shift && (data.shift === 'AM' || data.shift === 'PM')) {
      return data;
    }
    return null;
  } catch {
    return null;
  }
}
