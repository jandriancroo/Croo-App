import { useState, useMemo, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { AlertCircle, CheckCircle2, ArrowDown, DollarSign, Coins } from "lucide-react";

const DRAWER_BANK = 200; // $200 starting drawer

interface Denomination {
  name: string;
  value: number; // in cents
  pluralName: string;
  icon: string;
}

const DENOMINATIONS: Denomination[] = [
  { name: "Penny", value: 1, pluralName: "Pennies", icon: "¢" },
  { name: "Nickel", value: 5, pluralName: "Nickels", icon: "5¢" },
  { name: "Dime", value: 10, pluralName: "Dimes", icon: "10¢" },
  { name: "Quarter", value: 25, pluralName: "Quarters", icon: "25¢" },
  { name: "$1 Bill", value: 100, pluralName: "$1 Bills", icon: "$1" },
  { name: "$5 Bill", value: 500, pluralName: "$5 Bills", icon: "$5" },
  { name: "$10 Bill", value: 1000, pluralName: "$10 Bills", icon: "$10" },
  { name: "$20 Bill", value: 2000, pluralName: "$20 Bills", icon: "$20" },
  { name: "$50 Bill", value: 5000, pluralName: "$50 Bills", icon: "$50" },
  { name: "$100 Bill", value: 10000, pluralName: "$100 Bills", icon: "$100" },
];

interface DrawerCountFormProps {
  onSave: (data: DrawerCountData) => void;
  isSaving?: boolean;
  existingData?: DrawerCountData | null;
}

export interface DrawerCountData {
  counts: Record<string, number>;
  expectedDeposit: number;
  totalDrawer: number;
  actualDeposit: number;
  variance: number;
  removalSuggestions: { denomination: string; count: number; value: number }[];
}

export function DrawerCountForm({ onSave, isSaving, existingData }: DrawerCountFormProps) {
  const [counts, setCounts] = useState<Record<string, number>>(() => {
    if (existingData?.counts) return existingData.counts;
    return DENOMINATIONS.reduce((acc, d) => ({ ...acc, [d.name]: 0 }), {});
  });
  const [expectedDeposit, setExpectedDeposit] = useState<string>(
    existingData?.expectedDeposit?.toString() || ""
  );

  // Calculate totals
  const calculations = useMemo(() => {
    // Total drawer value in cents
    const totalCents = DENOMINATIONS.reduce((sum, d) => {
      return sum + (counts[d.name] || 0) * d.value;
    }, 0);

    const totalDollars = totalCents / 100;
    const bankAmount = DRAWER_BANK;
    const excessCents = Math.max(0, totalCents - bankAmount * 100);
    const actualDeposit = excessCents / 100;

    // Calculate what to remove to get back to $200
    const removalSuggestions: { denomination: string; count: number; value: number }[] = [];
    
    if (excessCents > 0) {
      let remainingToRemove = excessCents;
      
      // Go from highest to lowest denomination
      const sortedDenoms = [...DENOMINATIONS].reverse();
      
      for (const denom of sortedDenoms) {
        if (remainingToRemove <= 0) break;
        
        const available = counts[denom.name] || 0;
        if (available === 0) continue;
        
        // How many of this denomination can we remove?
        const maxToRemove = Math.floor(remainingToRemove / denom.value);
        const actualRemove = Math.min(maxToRemove, available);
        
        if (actualRemove > 0) {
          removalSuggestions.push({
            denomination: denom.name,
            count: actualRemove,
            value: actualRemove * denom.value / 100,
          });
          remainingToRemove -= actualRemove * denom.value;
        }
      }
    }

    // Variance calculation
    const expectedDep = parseFloat(expectedDeposit) || 0;
    const variance = actualDeposit - expectedDep;

    return {
      totalDollars,
      actualDeposit,
      removalSuggestions,
      variance,
      isOverBank: totalDollars > bankAmount,
    };
  }, [counts, expectedDeposit]);

  const handleCountChange = (denomination: string, value: string) => {
    const num = parseInt(value) || 0;
    setCounts(prev => ({ ...prev, [denomination]: Math.max(0, num) }));
  };

  const handleSubmit = () => {
    const data: DrawerCountData = {
      counts,
      expectedDeposit: parseFloat(expectedDeposit) || 0,
      totalDrawer: calculations.totalDollars,
      actualDeposit: calculations.actualDeposit,
      variance: calculations.variance,
      removalSuggestions: calculations.removalSuggestions,
    };
    onSave(data);
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(amount);
  };

  return (
    <div className="space-y-6">
      {/* Denomination Inputs */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Coins className="h-5 w-5" />
            Count Your Drawer
          </CardTitle>
          <CardDescription>Enter the quantity of each denomination</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
            {DENOMINATIONS.map((denom) => {
              const count = counts[denom.name] || 0;
              const valueCents = count * denom.value;
              const valueDollars = valueCents / 100;
              
              return (
                <div key={denom.name} className="space-y-1">
                  <Label className="text-xs font-medium">{denom.pluralName}</Label>
                  <div className="relative">
                    <Input
                      type="number"
                      min="0"
                      value={count || ''}
                      onChange={(e) => handleCountChange(denom.name, e.target.value)}
                      placeholder="0"
                      className="pr-12"
                    />
                    <Badge 
                      variant="secondary" 
                      className="absolute right-1 top-1/2 -translate-y-1/2 text-[10px] px-1.5"
                    >
                      {denom.icon}
                    </Badge>
                  </div>
                  {count > 0 && (
                    <p className="text-xs text-muted-foreground text-right">
                      = {formatCurrency(valueDollars)}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Totals & Calculations */}
      <Card className={calculations.isOverBank ? "border-amber-500/50" : ""}>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <DollarSign className="h-5 w-5" />
            Drawer Summary
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Total Drawer */}
          <div className="flex items-center justify-between p-3 bg-muted rounded-lg">
            <span className="font-medium">Total in Drawer</span>
            <span className="text-2xl font-bold">{formatCurrency(calculations.totalDollars)}</span>
          </div>

          {/* Bank Amount */}
          <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
            <span className="text-muted-foreground">Drawer Bank (Keep)</span>
            <span className="font-semibold">{formatCurrency(DRAWER_BANK)}</span>
          </div>

          {/* Deposit Amount */}
          <div className={`flex items-center justify-between p-3 rounded-lg ${
            calculations.actualDeposit > 0 ? "bg-primary/10 border border-primary/30" : "bg-muted/50"
          }`}>
            <span className="font-medium">Daily Deposit</span>
            <span className={`text-xl font-bold ${calculations.actualDeposit > 0 ? "text-primary" : ""}`}>
              {formatCurrency(calculations.actualDeposit)}
            </span>
          </div>

          {/* Removal Suggestions */}
          {calculations.removalSuggestions.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-amber-600">
                <ArrowDown className="h-4 w-4" />
                <span className="text-sm font-medium">Remove to reach ${DRAWER_BANK} bank:</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {calculations.removalSuggestions.map((suggestion, idx) => (
                  <div key={idx} className="flex items-center justify-between p-2 bg-amber-50 dark:bg-amber-950/30 rounded border border-amber-200 dark:border-amber-800">
                    <span className="text-sm">{suggestion.count}× {suggestion.denomination}</span>
                    <Badge variant="outline" className="text-xs">{formatCurrency(suggestion.value)}</Badge>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Expected Deposit Comparison */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Deposit Verification</CardTitle>
          <CardDescription>Compare your count to the expected deposit from Qu</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Expected Deposit from Qu</Label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
              <Input
                type="number"
                step="0.01"
                min="0"
                value={expectedDeposit}
                onChange={(e) => setExpectedDeposit(e.target.value)}
                placeholder="0.00"
                className="pl-7"
              />
            </div>
          </div>

          {expectedDeposit && parseFloat(expectedDeposit) > 0 && (
            <div className={`flex items-center justify-between p-4 rounded-lg ${
              calculations.variance === 0 
                ? "bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800"
                : calculations.variance > 0
                ? "bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800"
                : "bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800"
            }`}>
              <div className="flex items-center gap-2">
                {calculations.variance === 0 ? (
                  <CheckCircle2 className="h-5 w-5 text-green-600" />
                ) : (
                  <AlertCircle className={`h-5 w-5 ${calculations.variance > 0 ? "text-blue-600" : "text-red-600"}`} />
                )}
                <span className="font-medium">
                  {calculations.variance === 0 
                    ? "Exact Match!" 
                    : calculations.variance > 0 
                    ? "OVER" 
                    : "UNDER"
                  }
                </span>
              </div>
              <span className={`text-xl font-bold ${
                calculations.variance === 0 
                  ? "text-green-600" 
                  : calculations.variance > 0 
                  ? "text-blue-600" 
                  : "text-red-600"
              }`}>
                {calculations.variance !== 0 && (calculations.variance > 0 ? "+" : "")}
                {formatCurrency(Math.abs(calculations.variance))}
              </span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Save Button */}
      <Button onClick={handleSubmit} disabled={isSaving} className="w-full">
        {isSaving ? "Saving..." : "Save Drawer Count"}
      </Button>
    </div>
  );
}
