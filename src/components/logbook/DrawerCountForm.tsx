import { useState, useMemo, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { AlertCircle, CheckCircle2, ArrowDown, DollarSign, Coins, Calculator, Loader2, ChevronDown, FileText, Clock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useLocation as useAppLocation } from "@/hooks/useLocation";

const DEFAULT_DRAWER_BANK = 200; // $200 default starting drawer

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

export interface PriorPull {
  amount: number;
  time: string; // ISO timestamp
  createdBy?: string;
}

interface DrawerCountFormProps {
  onSave: (data: DrawerCountData) => void;
  isSaving?: boolean;
  existingData?: DrawerCountData | null;
  entryCount?: number;
  drawerBank?: number;
  businessDate?: string;
  priorPulls?: PriorPull[];
}

export interface DrawerCountData {
  counts: Record<string, number>;
  expectedDeposit: number;
  totalDrawer: number;
  actualDeposit: number;
  variance: number;
  removalSuggestions: { denomination: string; count: number; value: number }[];
  priorPullsTotal?: number;
  priorPulls?: PriorPull[];
}

export function DrawerCountForm({ onSave, isSaving, existingData, entryCount = 0, drawerBank = DEFAULT_DRAWER_BANK, businessDate, priorPulls = [] }: DrawerCountFormProps) {
  const { currentLocation } = useAppLocation();
  const DRAWER_BANK = drawerBank;
  const [counts, setCounts] = useState<Record<string, number>>(() => {
    if (existingData?.counts) return existingData.counts;
    return DENOMINATIONS.reduce((acc, d) => ({ ...acc, [d.name]: 0 }), {});
  });
  const [expectedDeposit, setExpectedDeposit] = useState<string>(
    existingData?.expectedDeposit?.toString() || ""
  );
  const [isLoadingQuDeposit, setIsLoadingQuDeposit] = useState(false);
  const [quDepositLoaded, setQuDepositLoaded] = useState(false);
  const [showEnvelopeFormat, setShowEnvelopeFormat] = useState(false);
  const [userName, setUserName] = useState<string>("");

  // Fetch current user's name
  useEffect(() => {
    const fetchUserName = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('full_name')
          .eq('id', user.id)
          .single();
        
        if (profile?.full_name) {
          const parts = profile.full_name.trim().split(' ');
          if (parts.length >= 2) {
            const firstName = parts[0];
            const lastInitial = parts[parts.length - 1].charAt(0).toUpperCase();
            setUserName(`${firstName} ${lastInitial}`);
          } else {
            setUserName(parts[0]);
          }
        }
      }
    };
    fetchUserName();
  }, []);

  // Auto-fetch expected deposit from the active POS (Clover or Qu) on load.
  // Uses the businessDate prop to ensure we fetch for the correct business day
  // (e.g., if it's 12:30 AM but the store closed at midnight, we want Saturday's data not Sunday's)
  useEffect(() => {
    const fetchExpectedDeposit = async () => {
      if (!currentLocation?.id || existingData?.expectedDeposit || quDepositLoaded) return;

      setIsLoadingQuDeposit(true);
      try {
        // Try Clover first (Playa Bowls locations). If the location isn't on Clover,
        // this returns a 500 with "No Clover integration..." and we fall back to Qu.
        const cloverBody: { action: string; locationId: string; date?: string } = {
          action: "get_live_expected_cash",
          locationId: currentLocation.id,
        };
        if (businessDate) cloverBody.date = businessDate;
        const cloverRes = await supabase.functions.invoke("clover-sync", { body: cloverBody });
        if (!cloverRes.error && cloverRes.data?.success && typeof cloverRes.data?.expectedCash === "number") {
          setExpectedDeposit(cloverRes.data.expectedCash.toFixed(2));
          setQuDepositLoaded(true);
          return;
        }

        // Fall back to Qu tills.
        const requestBody: { locationId: string; targetDate?: string } = {
          locationId: currentLocation.id,
        };
        if (businessDate) requestBody.targetDate = businessDate;

        const { data, error } = await supabase.functions.invoke("fetch-qubeyond-sales", {
          body: requestBody,
        });

        if (!error && data?.tills?.expectedCash) {
          setExpectedDeposit(data.tills.expectedCash.toFixed(2));
          setQuDepositLoaded(true);
        } else if (!error && data?.daily) {
          setExpectedDeposit(data.daily.toFixed(2));
          setQuDepositLoaded(true);
        }
      } catch (err) {
        console.error("Failed to fetch expected deposit:", err);
      } finally {
        setIsLoadingQuDeposit(false);
      }
    };

    fetchExpectedDeposit();
  }, [currentLocation?.id, existingData?.expectedDeposit, quDepositLoaded, businessDate]);
  const [drawerSet, setDrawerSet] = useState(!!existingData);

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

    // Prior pulls total
    const priorPullsTotal = priorPulls.reduce((sum, p) => sum + p.amount, 0);

    // Variance calculation: (this deposit + prior pulls) vs expected from Qu
    const expectedDep = parseFloat(expectedDeposit) || 0;
    const totalCashHandled = actualDeposit + priorPullsTotal;
    const variance = totalCashHandled - expectedDep;

    return {
      totalDollars,
      actualDeposit,
      removalSuggestions,
      variance,
      isOverBank: totalDollars > bankAmount,
      priorPullsTotal,
      totalCashHandled,
    };
  }, [counts, expectedDeposit, priorPulls]);

  const handleCountChange = (denomination: string, value: string) => {
    const num = parseInt(value) || 0;
    setCounts(prev => ({ ...prev, [denomination]: Math.max(0, num) }));
    // Reset drawer set state when counts change
    if (drawerSet) setDrawerSet(false);
  };

  const handleSetDrawer = () => {
    setDrawerSet(true);
  };

  const handleSubmit = () => {
    const data: DrawerCountData = {
      counts,
      expectedDeposit: parseFloat(expectedDeposit) || 0,
      totalDrawer: calculations.totalDollars,
      actualDeposit: calculations.actualDeposit,
      variance: calculations.variance,
      removalSuggestions: calculations.removalSuggestions,
      priorPullsTotal: calculations.priorPullsTotal,
      priorPulls: priorPulls.map((p) => ({ amount: p.amount, time: p.time, createdBy: p.createdBy })),
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
            <CardContent className="space-y-4">
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

          {/* Running Total */}
          <div className="flex items-center justify-between p-3 bg-muted rounded-lg">
            <span className="font-medium">Total in Drawer</span>
            <span className="text-2xl font-bold">{formatCurrency(calculations.totalDollars)}</span>
          </div>

          {/* Set Drawer Button */}
          {!drawerSet && calculations.totalDollars > 0 && (
            <Button 
              onClick={handleSetDrawer} 
              className="w-full"
              variant="default"
            >
              <Calculator className="h-4 w-4 mr-2" />
              Set Drawer
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Results - Only shown after drawer is set */}
      {drawerSet && (
        <>
          {/* Drawer Summary & Removal Suggestions */}
          <Card className={calculations.isOverBank ? "border-amber-500/50" : ""}>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <DollarSign className="h-5 w-5" />
                Drawer Summary
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Bank Amount */}
              <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                <span className="text-muted-foreground">Drawer Bank (Keep in Drawer)</span>
                <span className="font-semibold">{formatCurrency(DRAWER_BANK)}</span>
              </div>

              {/* Removal Suggestions */}
              {calculations.removalSuggestions.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-amber-600">
                    <ArrowDown className="h-4 w-4" />
                    <span className="text-sm font-medium">Remove from drawer:</span>
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

              {/* Actual Deposit Amount (what you're depositing) */}
              <div className={`flex items-center justify-between p-4 rounded-lg ${
                calculations.actualDeposit > 0 ? "bg-primary/10 border border-primary/30" : "bg-muted/50"
              }`}>
                <span className="font-medium">Actual Deposit</span>
                <span className={`text-2xl font-bold ${calculations.actualDeposit > 0 ? "text-primary" : ""}`}>
                  {formatCurrency(calculations.actualDeposit)}
                </span>
              </div>

              {/* Envelope Format Reference */}
              <Collapsible open={showEnvelopeFormat} onOpenChange={setShowEnvelopeFormat}>
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" size="sm" className="w-full justify-between text-muted-foreground hover:text-foreground">
                    <div className="flex items-center gap-2">
                      <FileText className="h-4 w-4" />
                      <span>Envelope Format</span>
                    </div>
                    <ChevronDown className={`h-4 w-4 transition-transform ${showEnvelopeFormat ? "rotate-180" : ""}`} />
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent className="pt-2">
                  <div className="border-2 border-foreground/20 rounded-lg p-4 bg-background shadow-sm">
                    <div className="flex justify-between items-start mb-6">
                      <span className="font-medium text-sm">{new Date().toLocaleDateString()}</span>
                      <span className="font-medium text-sm">{userName || "Your Name"}</span>
                    </div>
                    <div className="text-center">
                      <span className="text-3xl font-bold">{formatCurrency(calculations.actualDeposit)}</span>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground text-center mt-2">
                    Write this information on your deposit envelope
                  </p>
                </CollapsibleContent>
              </Collapsible>
            </CardContent>
          </Card>

          {/* Earlier Pulls (mid-day counts) */}
          {priorPulls.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Clock className="h-5 w-5" />
                  Earlier Pulls Today ({priorPulls.length})
                </CardTitle>
                <CardDescription>
                  Cash already removed from the drawer earlier today. These are locked and added to your total below.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {priorPulls.map((pull, idx) => (
                  <div key={idx} className="flex items-center justify-between p-2.5 bg-muted/50 rounded-lg">
                    <div className="flex items-center gap-2 text-sm">
                      <Badge variant="outline" className="text-[10px] px-1.5">Pull #{idx + 1}</Badge>
                      <span className="text-muted-foreground">
                        {new Date(pull.time).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                      </span>
                      {pull.createdBy && <span className="text-muted-foreground">· {pull.createdBy}</span>}
                    </div>
                    <span className="font-semibold text-sm tabular-nums">{formatCurrency(pull.amount)}</span>
                  </div>
                ))}
                <div className="flex items-center justify-between p-2.5 border-t pt-3">
                  <span className="text-sm font-medium">Earlier Pulls Subtotal</span>
                  <span className="font-bold tabular-nums">{formatCurrency(calculations.priorPullsTotal)}</span>
                </div>
              </CardContent>
            </Card>
          )}


          {/* Expected Deposit Comparison */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Deposit Verification</CardTitle>
              <CardDescription>Compare your total cash handled to expected from Qu</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label>Expected Deposit from Qu</Label>
                  {isLoadingQuDeposit && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
                  {quDepositLoaded && !isLoadingQuDeposit && (
                    <Badge variant="secondary" className="text-[10px] py-0">Auto-filled</Badge>
                  )}
                </div>
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

              {/* Total Cash Handled ladder (when prior pulls exist) */}
              {priorPulls.length > 0 && (
                <div className="space-y-1.5 p-3 bg-muted/50 rounded-lg text-sm">
                  <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1">
                    Cash Handled Today
                  </div>
                  {priorPulls.map((pull, idx) => (
                    <div key={idx} className="flex justify-between">
                      <span className="text-muted-foreground">
                        {idx === 0 ? "" : "+ "}Pull #{idx + 1} · {new Date(pull.time).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                      </span>
                      <span className="tabular-nums">{formatCurrency(pull.amount)}</span>
                    </div>
                  ))}
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">
                      + Pull #{priorPulls.length + 1} · This count (now)
                    </span>
                    <span className="tabular-nums">{formatCurrency(calculations.actualDeposit)}</span>
                  </div>
                  <div className="flex justify-between font-semibold border-t pt-1.5">
                    <span>= Total Cash Handled</span>
                    <span className="tabular-nums">{formatCurrency(calculations.totalCashHandled)}</span>
                  </div>
                  {parseFloat(expectedDeposit) > 0 && (
                    <div className="flex justify-between text-muted-foreground">
                      <span>− Expected from POS</span>
                      <span className="tabular-nums">{formatCurrency(parseFloat(expectedDeposit))}</span>
                    </div>
                  )}
                </div>
              )}


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
        </>
      )}
    </div>
  );
}
