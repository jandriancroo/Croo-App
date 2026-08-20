import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Eye, ShieldCheck } from "lucide-react";
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
  /** Set when the deposit for this day was audited during Bank Deposit. */
  audit?: {
    countedAmount: number;
    variance: number;
    auditedAt: string;
    auditedByName?: string;
  };
  /** Audited amount becomes the authoritative deposit for reporting. */
  auditedDeposit?: number;
  auditedVariance?: number;
}

interface DrawerCountEntryProps {
  data: DrawerCountData;
  createdAt: string;
  drawerBank?: number;
  createdByName?: string;
}

const formatCurrency = (value: number) => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(value);
};

export function DrawerCountEntry({ data, createdAt, drawerBank = 200, createdByName }: DrawerCountEntryProps) {
  const [open, setOpen] = useState(false);

  const audit = data.audit;
  // Once audited, the counted amount is the number of record.
  const effectiveDeposit = audit ? audit.countedAmount : data.actualDeposit;
  const effectiveVariance = audit
    ? (data.auditedVariance ?? data.variance + (audit.countedAmount - data.actualDeposit))
    : data.variance;

  const varianceColor = effectiveVariance > 0
    ? 'text-green-600'
    : effectiveVariance < 0
      ? 'text-red-600'
      : 'text-muted-foreground';

  const varianceLabel = effectiveVariance > 0
    ? 'OVER'
    : effectiveVariance < 0
      ? 'UNDER'
      : 'EXACT';


  const hasPriorPulls = (data.priorPullsTotal ?? 0) > 0;
  const countTime = format(new Date(createdAt), 'h:mm a');

  return (
    <div className="space-y-3">
      {/* Time label */}
      <div className="text-xs text-muted-foreground">{countTime}</div>
      {audit && (
        <div className="flex items-center gap-1.5 rounded-md border border-destructive/30 bg-destructive/5 px-2 py-1 text-[11px] font-medium text-destructive">
          <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
          <span>
            Audited at deposit · {formatCurrency(audit.countedAmount)}
            {audit.variance !== 0 && ` (${audit.variance > 0 ? '+' : ''}${formatCurrency(audit.variance)})`}
            {audit.auditedByName ? ` · ${audit.auditedByName}` : ''}
          </span>
        </div>
      )}
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
              {audit && (
                <span className="line-through text-muted-foreground mr-1.5">
                  {formatCurrency(hasPriorPulls ? data.actualDeposit + (data.priorPullsTotal || 0) : data.actualDeposit)}
                </span>
              )}
              <span className={audit ? 'text-destructive font-semibold' : ''}>
                {formatCurrency(hasPriorPulls ? effectiveDeposit + (data.priorPullsTotal || 0) : effectiveDeposit)}
              </span>
            </span>
          </div>
          <div className="flex justify-between sm:block">
            <span className="text-muted-foreground">Variance:</span>
            <span className={`font-semibold ml-2 sm:ml-1 ${varianceColor}`}>
              {varianceLabel} {formatCurrency(Math.abs(effectiveVariance))}
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
              
              {(data.priorPullsTotal != null && data.priorPullsTotal > 0) && (() => {
                const pulls = [
                  ...((data.priorPulls && data.priorPulls.length > 0
                    ? data.priorPulls
                    : [{ amount: data.priorPullsTotal, time: "", createdBy: undefined }]) as {
                    amount: number; time: string; createdBy?: string;
                  }[]),
                  { amount: data.actualDeposit, time: createdAt, createdBy: createdByName, isCurrent: true } as any,
                ];
                return (
                  <div className="border-t pt-3">
                    <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                      Cash Handled Today
                    </div>
                    <div className="rounded-lg border bg-muted/40 divide-y">
                      {pulls.map((pull, idx) => (
                        <div key={idx} className="flex items-start justify-between gap-3 px-3 py-2">
                          <div className="min-w-0">
                            <div className="text-sm font-medium">
                              Pull #{idx + 1}
                              {pull.isCurrent && (
                                <span className="ml-1.5 text-[10px] uppercase tracking-wide text-primary">this count</span>
                              )}
                            </div>
                            <div className="text-xs text-muted-foreground truncate">
                              {pull.time ? format(new Date(pull.time), 'h:mm a') : 'Earlier today'}
                              {pull.createdBy ? ` · ${pull.createdBy}` : ''}
                            </div>
                          </div>
                          <span className="text-sm font-semibold tabular-nums shrink-0">
                            {idx > 0 && '+ '}{formatCurrency(pull.amount)}
                          </span>
                        </div>
                      ))}
                      <div className="flex items-center justify-between px-3 py-2.5 bg-muted/70">
                        <span className="text-sm font-semibold">Total Cash Handled</span>
                        <span className="text-base font-bold tabular-nums">
                          {formatCurrency(data.actualDeposit + data.priorPullsTotal)}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })()}



              {audit && (
                <div className="border-t pt-3">
                  <div className="text-xs font-semibold uppercase tracking-wide text-destructive mb-2 flex items-center gap-1.5">
                    <ShieldCheck className="h-3.5 w-3.5" /> Audit Details
                  </div>
                  <div className="rounded-lg border border-destructive/30 bg-destructive/5 divide-y divide-destructive/20 text-sm">
                    <div className="flex justify-between px-3 py-2">
                      <span className="text-muted-foreground">Original count</span>
                      <span className="line-through tabular-nums">{formatCurrency(data.actualDeposit)}</span>
                    </div>
                    <div className="flex justify-between px-3 py-2">
                      <span className="text-muted-foreground">Audited amount</span>
                      <span className="font-semibold text-destructive tabular-nums">{formatCurrency(audit.countedAmount)}</span>
                    </div>
                    <div className="flex justify-between px-3 py-2">
                      <span className="text-muted-foreground">Difference</span>
                      <span className="font-semibold tabular-nums">
                        {audit.variance > 0 ? '+' : ''}{formatCurrency(audit.variance)}
                      </span>
                    </div>
                    <div className="flex justify-between px-3 py-2 text-xs text-muted-foreground">
                      <span>{audit.auditedByName || 'Auditor'}</span>
                      <span>{format(new Date(audit.auditedAt), 'MMM d, h:mm a')}</span>
                    </div>
                  </div>
                </div>
              )}

              <div className="border-t pt-3 space-y-2">
                <div className="flex justify-between">
                  <span className="text-muted-foreground text-sm">Expected (from Qu):</span>
                  <span className="font-medium">{formatCurrency(data.expectedDeposit)}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">Variance{audit ? ' (audited)' : ''}:</span>
                  <span className={`font-bold ${varianceColor}`}>
                    {varianceLabel} {formatCurrency(Math.abs(effectiveVariance))}
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
