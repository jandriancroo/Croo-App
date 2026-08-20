import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Eye } from "lucide-react";
import { format } from "date-fns";

interface DrawerCountData {
  counts: Record<string, number>;
  expectedDeposit: number;
  totalDrawer: number;
  actualDeposit: number;
  variance: number;
  removalSuggestions: { denomination: string; count: number; value: number }[];
  priorPullsTotal?: number;
  priorPulls?: { amount: number; time: string; createdBy?: string }[];

}

interface DrawerCountEntryProps {
  data: DrawerCountData;
  createdAt: string;
  drawerBank?: number;
}

const formatCurrency = (value: number) => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(value);
};

export function DrawerCountEntry({ data, createdAt, drawerBank = 200 }: DrawerCountEntryProps) {
  const [open, setOpen] = useState(false);
  
  const varianceColor = data.variance > 0 
    ? 'text-green-600' 
    : data.variance < 0 
      ? 'text-red-600' 
      : 'text-muted-foreground';
  
  const varianceLabel = data.variance > 0 
    ? 'OVER' 
    : data.variance < 0 
      ? 'UNDER' 
      : 'EXACT';

  const hasPriorPulls = (data.priorPullsTotal ?? 0) > 0;
  const countTime = format(new Date(createdAt), 'h:mm a');

  return (
    <div className="space-y-3">
      {/* Time label */}
      <div className="text-xs text-muted-foreground">{countTime}</div>
      {/* Mobile: Stack vertically, Desktop: inline */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-sm flex-1">
          <div className="flex justify-between sm:block">
            <span className="text-muted-foreground">Expected:</span>
            <span className="font-medium ml-2 sm:ml-1">{formatCurrency(data.expectedDeposit)}</span>
          </div>
          <div className="flex justify-between sm:block">
            <span className="text-muted-foreground">{hasPriorPulls ? 'Total Handled:' : 'Actual:'}</span>
            <span className="font-medium ml-2 sm:ml-1">
              {formatCurrency(hasPriorPulls ? data.actualDeposit + (data.priorPullsTotal || 0) : data.actualDeposit)}
            </span>
          </div>
          <div className="flex justify-between sm:block">
            <span className="text-muted-foreground">Variance:</span>
            <span className={`font-semibold ml-2 sm:ml-1 ${varianceColor}`}>
              {varianceLabel} {formatCurrency(Math.abs(data.variance))}
            </span>
          </div>
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
              <DialogTitle>Drawer Count Details</DialogTitle>
            </DialogHeader>
            
            <div className="space-y-4">
              <div className="text-sm text-muted-foreground">
                Entered at {format(new Date(createdAt), 'h:mm a')} on {format(new Date(createdAt), 'MMM d, yyyy')}
              </div>
              
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="font-medium">Denomination</div>
                <div className="font-medium text-right">Count</div>
                {Object.entries(data.counts || {}).map(([denom, count]) => (
                  count > 0 && (
                    <>
                      <div key={`${denom}-label`} className="text-muted-foreground">{denom}</div>
                      <div key={`${denom}-count`} className="text-right">{count}</div>
                    </>
                  )
                ))}
              </div>
              
              <div className="border-t pt-3 space-y-2">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Total Drawer:</span>
                  <span className="font-medium">{formatCurrency(data.totalDrawer)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Drawer Bank:</span>
                  <span className="font-medium">{formatCurrency(drawerBank)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Actual Deposit:</span>
                  <span className="font-medium">{formatCurrency(data.actualDeposit)}</span>
                </div>
              </div>
              
              {data.removalSuggestions && data.removalSuggestions.length > 0 && (
                <div className="border-t pt-3">
                  <div className="font-medium mb-2">Remove from Drawer:</div>
                  <div className="space-y-1 text-sm">
                    {data.removalSuggestions.map((suggestion, idx) => (
                      <div key={idx} className="flex justify-between text-muted-foreground">
                        <span>{suggestion.count}x {suggestion.denomination}</span>
                        <span>{formatCurrency(suggestion.value)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              
              {(data.priorPullsTotal != null && data.priorPullsTotal > 0) && (
                <div className="border-t pt-3 space-y-2">
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Cash Handled Today
                  </div>
                  {(data.priorPulls && data.priorPulls.length > 0
                    ? data.priorPulls
                    : [{ amount: data.priorPullsTotal, time: "" }]
                  ).map((pull, idx) => (
                    <div key={idx} className="flex justify-between text-sm">
                      <span className="text-muted-foreground">
                        {idx === 0 ? "" : "+ "}Pull #{idx + 1}
                        {pull.time ? ` · ${format(new Date(pull.time), 'h:mm a')}` : " · earlier pulls"}
                      </span>
                      <span className="tabular-nums">{formatCurrency(pull.amount)}</span>
                    </div>
                  ))}
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">
                      + Pull #{(data.priorPulls?.length || 1) + 1} · {countTime} (this count)
                    </span>
                    <span className="tabular-nums">{formatCurrency(data.actualDeposit)}</span>
                  </div>
                  <div className="flex justify-between border-t pt-2">
                    <span className="font-medium">= Total Cash Handled</span>
                    <span className="font-bold tabular-nums">{formatCurrency(data.actualDeposit + data.priorPullsTotal)}</span>
                  </div>
                </div>
              )}


              <div className="border-t pt-3 space-y-2">
                <div className="flex justify-between">
                  <span className="text-muted-foreground text-sm">Expected (from Qu):</span>
                  <span className="font-medium">{formatCurrency(data.expectedDeposit)}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">Variance:</span>
                  <span className={`font-bold ${varianceColor}`}>
                    {varianceLabel} {formatCurrency(Math.abs(data.variance))}
                  </span>
                </div>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}

export function parseDrawerCountData(valueText: string): DrawerCountData | null {
  try {
    return JSON.parse(valueText);
  } catch {
    return null;
  }
}
