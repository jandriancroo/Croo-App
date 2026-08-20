import { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Calculator, ShieldCheck, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";

const DENOMS: { key: string; label: string; value: number }[] = [
  { key: "b100", label: "$100", value: 100 },
  { key: "b50", label: "$50", value: 50 },
  { key: "b20", label: "$20", value: 20 },
  { key: "b10", label: "$10", value: 10 },
  { key: "b5", label: "$5", value: 5 },
  { key: "b2", label: "$2", value: 2 },
  { key: "b1", label: "$1", value: 1 },
  { key: "cDollar", label: "$1 coin", value: 1 },
  { key: "cHalf", label: "50¢", value: 0.5 },
  { key: "cQuarter", label: "25¢", value: 0.25 },
  { key: "cDime", label: "10¢", value: 0.1 },
  { key: "cNickel", label: "5¢", value: 0.05 },
  { key: "cPenny", label: "1¢", value: 0.01 },
];

const fmt = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);

export interface DepositAudit {
  countedAmount: number;
  variance: number;
  auditedAt: string;
  auditedByName?: string;
}

interface DepositAuditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** the recorded deposit amount for this day */
  expectedAmount: number;
  dateLabel: string;
  auditorName?: string;
  existing?: DepositAudit | null;
  onSubmit: (audit: DepositAudit) => void;
}

export function DepositAuditDialog({
  open,
  onOpenChange,
  expectedAmount,
  dateLabel,
  auditorName,
  existing,
  onSubmit,
}: DepositAuditDialogProps) {
  const [amount, setAmount] = useState<string>(existing ? String(existing.countedAmount) : "");
  const [showCalc, setShowCalc] = useState(false);
  const [counts, setCounts] = useState<Record<string, number>>({});

  const calcTotal = useMemo(
    () => DENOMS.reduce((s, d) => s + d.value * (counts[d.key] || 0), 0),
    [counts]
  );

  const counted = parseFloat(amount || "0") || 0;
  const variance = Math.round((counted - expectedAmount) * 100) / 100;
  const canSubmit = amount.trim() !== "" && !Number.isNaN(parseFloat(amount));

  const reset = () => {
    setCounts({});
  };

  const applyCalc = () => {
    setAmount(calcTotal.toFixed(2));
    setShowCalc(false);
  };

  const handleSubmit = () => {
    if (!canSubmit) return;
    onSubmit({
      countedAmount: Math.round(counted * 100) / 100,
      variance,
      auditedAt: new Date().toISOString(),
      auditedByName: auditorName,
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" />
            Audit Deposit
          </DialogTitle>
          <DialogDescription>{dateLabel}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-center justify-between rounded-lg bg-muted/50 p-3 text-sm">
            <span className="text-muted-foreground">Recorded deposit</span>
            <span className="font-mono font-semibold">{fmt(expectedAmount)}</span>
          </div>

          <div className="space-y-2">
            <Label htmlFor="audit-amount">Counted amount</Label>
            <div className="flex items-center gap-2">
              <Input
                id="audit-amount"
                inputMode="decimal"
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="font-mono"
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label="Open counting tool"
                onClick={() => setShowCalc((v) => !v)}
              >
                <Calculator className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {showCalc && (
            <div className="space-y-3 rounded-lg border p-3">
              <div className="flex items-center justify-between">
                <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                  Counting tool
                </Label>
                <Button type="button" variant="ghost" size="sm" onClick={reset}>
                  <RotateCcw className="mr-1 h-3.5 w-3.5" /> Clear
                </Button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {DENOMS.map((d) => (
                  <div key={d.key} className="flex items-center gap-2">
                    <span className="w-16 shrink-0 text-xs font-medium">{d.label}</span>
                    <Input
                      inputMode="numeric"
                      className="h-9 font-mono"
                      value={counts[d.key] ?? ""}
                      onChange={(e) => {
                        const v = parseInt(e.target.value, 10);
                        setCounts((prev) => ({ ...prev, [d.key]: Number.isNaN(v) ? 0 : v }));
                      }}
                    />
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-between border-t pt-2">
                <span className="text-sm text-muted-foreground">Tool total</span>
                <span className="font-mono font-semibold">{fmt(calcTotal)}</span>
              </div>
              <Button type="button" className="w-full" onClick={applyCalc}>
                Use {fmt(calcTotal)}
              </Button>
            </div>
          )}

          {canSubmit && (
            <div
              className={cn(
                "flex items-center justify-between rounded-lg border p-3 text-sm",
                variance === 0
                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                  : "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400"
              )}
            >
              <span className="font-medium">
                {variance === 0 ? "Matches exactly" : variance > 0 ? "Over" : "Short"}
              </span>
              <span className="font-mono font-semibold">
                {variance > 0 ? "+" : ""}
                {fmt(variance)}
              </span>
            </div>
          )}

          <Button className="w-full" disabled={!canSubmit} onClick={handleSubmit}>
            <ShieldCheck className="mr-2 h-4 w-4" />
            Submit Audit
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
