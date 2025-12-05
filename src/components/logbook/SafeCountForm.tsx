import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AlertCircle, CheckCircle2, ArrowUp, ArrowDown, Sun, Moon } from "lucide-react";
import { cn } from "@/lib/utils";

const SAFE_TARGET = 300; // $300 target for safe

interface Denomination {
  name: string;
  value: number; // in cents
  pluralName: string;
  icon: string;
  rollCount?: number; // coins per roll (only for coins)
  rollValue?: number; // value of one roll in cents
}

const DENOMINATIONS: Denomination[] = [
  { name: "Penny", value: 1, pluralName: "Pennies", icon: "¢", rollCount: 50, rollValue: 50 },
  { name: "Nickel", value: 5, pluralName: "Nickels", icon: "5¢", rollCount: 40, rollValue: 200 },
  { name: "Dime", value: 10, pluralName: "Dimes", icon: "10¢", rollCount: 50, rollValue: 500 },
  { name: "Quarter", value: 25, pluralName: "Quarters", icon: "25¢", rollCount: 40, rollValue: 1000 },
  { name: "$1 Bill", value: 100, pluralName: "$1 Bills", icon: "$1" },
  { name: "$5 Bill", value: 500, pluralName: "$5 Bills", icon: "$5" },
  { name: "$10 Bill", value: 1000, pluralName: "$10 Bills", icon: "$10" },
  { name: "$20 Bill", value: 2000, pluralName: "$20 Bills", icon: "$20" },
  { name: "$50 Bill", value: 5000, pluralName: "$50 Bills", icon: "$50" },
  { name: "$100 Bill", value: 10000, pluralName: "$100 Bills", icon: "$100" },
];

const COINS = DENOMINATIONS.filter(d => d.rollCount);
const BILLS = DENOMINATIONS.filter(d => !d.rollCount);

interface SafeCountFormProps {
  onSave: (data: SafeCountData) => void;
  isSaving?: boolean;
  existingShifts?: ('AM' | 'PM')[];
}

export interface SafeCountData {
  shift: 'AM' | 'PM';
  counts: Record<string, number>;
  rolls: Record<string, number>;
  totalSafe: number;
  difference: number;
  adjustmentSuggestions: { denomination: string; count: number; value: number; action: 'add' | 'remove' }[];
}

const formatCurrency = (value: number) => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(value);
};

export function SafeCountForm({ onSave, isSaving, existingShifts = [] }: SafeCountFormProps) {
  // Default to first available shift
  const defaultShift = existingShifts.includes('AM') ? 'PM' : 'AM';
  const [shift, setShift] = useState<'AM' | 'PM'>(defaultShift);
  const [counts, setCounts] = useState<Record<string, number>>(
    DENOMINATIONS.reduce((acc, d) => ({ ...acc, [d.name]: 0 }), {})
  );
  const [rolls, setRolls] = useState<Record<string, number>>(
    COINS.reduce((acc, d) => ({ ...acc, [d.name]: 0 }), {})
  );

  // Calculate totals
  const calculations = useMemo(() => {
    // Calculate loose coins/bills
    const looseCents = DENOMINATIONS.reduce((sum, d) => {
      return sum + (counts[d.name] || 0) * d.value;
    }, 0);

    // Calculate rolled coins
    const rollCents = COINS.reduce((sum, d) => {
      return sum + (rolls[d.name] || 0) * (d.rollValue || 0);
    }, 0);

    const totalCents = looseCents + rollCents;
    const totalDollars = totalCents / 100;
    const targetCents = SAFE_TARGET * 100;
    const differenceCents = totalCents - targetCents;
    const difference = differenceCents / 100;

    // Calculate adjustments needed
    const adjustmentSuggestions: { denomination: string; count: number; value: number; action: 'add' | 'remove' }[] = [];
    
    if (differenceCents !== 0) {
      let remaining = Math.abs(differenceCents);
      const action: 'add' | 'remove' = differenceCents > 0 ? 'remove' : 'add';
      
      // Go from highest to lowest denomination (bills only for suggestions)
      const sortedDenoms = [...BILLS].reverse();
      
      for (const denom of sortedDenoms) {
        if (remaining <= 0) break;
        
        if (action === 'remove') {
          // Can only remove what's available
          const available = counts[denom.name] || 0;
          const canRemove = Math.min(available, Math.floor(remaining / denom.value));
          if (canRemove > 0) {
            adjustmentSuggestions.push({
              denomination: canRemove === 1 ? denom.name : denom.pluralName,
              count: canRemove,
              value: (canRemove * denom.value) / 100,
              action: 'remove'
            });
            remaining -= canRemove * denom.value;
          }
        } else {
          // Can add any amount
          const needed = Math.floor(remaining / denom.value);
          if (needed > 0) {
            adjustmentSuggestions.push({
              denomination: needed === 1 ? denom.name : denom.pluralName,
              count: needed,
              value: (needed * denom.value) / 100,
              action: 'add'
            });
            remaining -= needed * denom.value;
          }
        }
      }
    }

    const isExact = differenceCents === 0;

    return {
      totalDollars,
      difference,
      adjustmentSuggestions,
      isExact,
      isOver: differenceCents > 0,
      isUnder: differenceCents < 0,
    };
  }, [counts, rolls]);

  const handleCountChange = (denomName: string, value: string) => {
    const numValue = parseInt(value) || 0;
    setCounts(prev => ({ ...prev, [denomName]: Math.max(0, numValue) }));
  };

  const handleRollChange = (denomName: string, value: string) => {
    const numValue = parseInt(value) || 0;
    setRolls(prev => ({ ...prev, [denomName]: Math.max(0, numValue) }));
  };

  const handleSubmit = () => {
    if (!calculations.isExact) return;
    
    onSave({
      shift,
      counts,
      rolls,
      totalSafe: calculations.totalDollars,
      difference: calculations.difference,
      adjustmentSuggestions: calculations.adjustmentSuggestions,
    });
  };

  return (
    <div className="space-y-4">
      {/* Check if both shifts are done */}
      {existingShifts.includes('AM') && existingShifts.includes('PM') ? (
        <Card className="border-green-500 bg-green-50 dark:bg-green-950/20">
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 text-green-700 dark:text-green-400">
              <CheckCircle2 className="h-5 w-5" />
              <span className="font-semibold">Both AM and PM safe counts completed for today</span>
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* AM/PM Selector */}
          <div className="flex gap-2">
            <Button
              type="button"
              variant={shift === 'AM' ? 'default' : 'outline'}
              onClick={() => setShift('AM')}
              disabled={existingShifts.includes('AM')}
              className={cn(
                "flex-1 transition-all",
                existingShifts.includes('AM') && "opacity-50 cursor-not-allowed",
                shift === 'AM' && !existingShifts.includes('AM')
                  ? "bg-amber-100 text-amber-900 hover:bg-amber-200 border-amber-300" 
                  : "hover:bg-amber-50"
              )}
            >
              <Sun className="h-4 w-4 mr-2" />
              AM {existingShifts.includes('AM') && '✓'}
            </Button>
            <Button
              type="button"
              variant={shift === 'PM' ? 'default' : 'outline'}
              onClick={() => setShift('PM')}
              disabled={existingShifts.includes('PM')}
              className={cn(
                "flex-1 transition-all",
                existingShifts.includes('PM') && "opacity-50 cursor-not-allowed",
                shift === 'PM' && !existingShifts.includes('PM')
                  ? "bg-indigo-900 text-indigo-100 hover:bg-indigo-800 border-indigo-700" 
                  : "hover:bg-indigo-50"
              )}
            >
              <Moon className="h-4 w-4 mr-2" />
              PM {existingShifts.includes('PM') && '✓'}
            </Button>
          </div>

      {/* Coins Section with Rolls */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Coins</CardTitle>
          <p className="text-xs text-muted-foreground">Count loose coins and rolls separately</p>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Header row */}
          <div className="grid grid-cols-[48px_1fr_1fr_60px] gap-2 text-xs text-muted-foreground font-medium px-1">
            <div></div>
            <div className="text-center">Loose</div>
            <div className="text-center">Rolls</div>
            <div></div>
          </div>
          
          {COINS.map((denom) => (
            <div key={denom.name} className="grid grid-cols-[48px_1fr_1fr_60px] gap-2 items-center">
              <Badge variant="secondary" className="w-12 justify-center text-xs">
                {denom.icon}
              </Badge>
              <Input
                type="number"
                min="0"
                value={counts[denom.name] || ''}
                onChange={(e) => handleCountChange(denom.name, e.target.value)}
                placeholder="0"
              />
              <Input
                type="number"
                min="0"
                value={rolls[denom.name] || ''}
                onChange={(e) => handleRollChange(denom.name, e.target.value)}
                placeholder="0"
              />
              <Badge className="justify-center text-[10px] bg-amber-100 text-amber-800 border-amber-200 hover:bg-amber-100">
                {formatCurrency((denom.rollValue || 0) / 100)}
              </Badge>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Bills Section */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Bills</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {BILLS.map((denom) => (
            <div key={denom.name} className="grid grid-cols-[48px_1fr] gap-2 items-center">
              <Badge variant="secondary" className="w-12 justify-center text-xs">
                {denom.icon}
              </Badge>
              <Input
                type="number"
                min="0"
                value={counts[denom.name] || ''}
                onChange={(e) => handleCountChange(denom.name, e.target.value)}
                placeholder="0"
              />
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Status & Save Card */}
      <Card className={cn(
        "border-2",
        calculations.totalDollars === 0 ? "border-border" :
        calculations.isExact ? "border-green-500 bg-green-50 dark:bg-green-950/20" : "border-red-500 bg-red-50 dark:bg-red-950/20"
      )}>
        <CardContent className="pt-4 space-y-3">
          <div className="flex justify-between items-center text-lg font-semibold">
            <span>Safe Total:</span>
            <span>{formatCurrency(calculations.totalDollars)}</span>
          </div>
          <div className="text-sm text-muted-foreground text-right">
            Target: {formatCurrency(SAFE_TARGET)}
          </div>

          {calculations.totalDollars > 0 && (
            <>
              {calculations.isExact ? (
                <div className="flex items-center gap-2 text-green-700 dark:text-green-400">
                  <CheckCircle2 className="h-5 w-5" />
                  <span className="font-semibold">Safe is balanced at {formatCurrency(SAFE_TARGET)}</span>
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-2 text-red-700 dark:text-red-400">
                    <AlertCircle className="h-5 w-5" />
                    <span className="font-semibold">
                      Safe is {calculations.isOver ? 'OVER' : 'UNDER'} by {formatCurrency(Math.abs(calculations.difference))}
                    </span>
                  </div>

                  {calculations.adjustmentSuggestions.length > 0 && (
                    <div className="space-y-2">
                      <Label className="text-sm font-medium">
                        {calculations.isOver ? 'Remove from safe:' : 'Add to safe:'}
                      </Label>
                      <div className="space-y-1">
                        {calculations.adjustmentSuggestions.map((suggestion, idx) => (
                          <div key={idx} className="flex items-center justify-between text-sm bg-background/50 rounded px-2 py-1">
                            <span className="flex items-center gap-1">
                              {suggestion.action === 'remove' ? (
                                <ArrowUp className="h-3 w-3 text-red-500" />
                              ) : (
                                <ArrowDown className="h-3 w-3 text-green-500" />
                              )}
                              {suggestion.count}x {suggestion.denomination}
                            </span>
                            <span>{formatCurrency(suggestion.value)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </>
          )}

          <Button 
            onClick={handleSubmit} 
            disabled={!calculations.isExact || isSaving}
            className="w-full"
            size="lg"
          >
            {isSaving ? 'Saving...' : calculations.isExact ? 'Save Safe Count' : 'Must be exactly $300 to save'}
          </Button>
        </CardContent>
      </Card>
        </>
      )}
    </div>
  );
}
