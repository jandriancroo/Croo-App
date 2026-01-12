import { useState, useEffect } from "react";
import { Layout } from "@/components/Layout";
import { PageHeaderDivider } from "@/components/ui/page-header-divider";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { format, parseISO } from "date-fns";
import { Clock, DollarSign, TrendingUp, TrendingDown, Calendar, ChevronLeft, ChevronRight } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import crooCashIcon from "@/assets/croo-cash-icon.png";
import { usePersonalPayData } from "@/hooks/usePersonalPayData";

interface Transaction {
  id: string;
  amount: number;
  transaction_type: string;
  shift_date: string;
  notes: string | null;
  created_at: string;
}

export default function MyWallet() {
  const { user } = useAuth();
  const [periodOffset, setPeriodOffset] = useState(0);
  const [crooCashBalance, setCrooCashBalance] = useState(0);
  const [transactions, setTransactions] = useState<Transaction[]>([]);

  // Use the shared hook for all pay period data
  const { data: payData, isLoading } = usePersonalPayData(periodOffset);

  const isCurrentPeriod = periodOffset === 0;

  // Fetch Croo Cash data separately
  useEffect(() => {
    if (!user) return;

    const fetchCrooCashData = async () => {
      // Fetch user's croo cash balance
      const { data: profile } = await supabase
        .from("profiles")
        .select("croo_cash_balance")
        .eq("id", user.id)
        .single();

      if (profile) {
        setCrooCashBalance(profile.croo_cash_balance || 0);
      }

      // Fetch Croo Cash transactions
      const { data: txns } = await supabase
        .from("croo_cash_transactions")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(10);

      setTransactions(txns || []);
    };

    fetchCrooCashData();
  }, [user]);

  const getBalanceColor = () => {
    if (crooCashBalance > 0) return "text-green-500";
    if (crooCashBalance < 0) return "text-red-500";
    return "text-foreground";
  };

  const getTransactionIcon = (type: string) => {
    const isPositive = type === "take_shift" || type === "checklist_completion";
    return isPositive ? (
      <TrendingUp className="h-4 w-4 text-green-500" />
    ) : (
      <TrendingDown className="h-4 w-4 text-red-500" />
    );
  };

  const getTransactionLabel = (type: string) => {
    switch (type) {
      case "take_shift": return "Picked up shift";
      case "offer_shift": return "Offered shift";
      case "checklist_completion": return "Completed checklist";
      case "incomplete_checklist": return "Incomplete checklist";
      case "denied_claim": return "Claim denied";
      default: return type.replace(/_/g, ' ');
    }
  };

  if (isLoading) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-64">
          <p>Loading wallet...</p>
        </div>
      </Layout>
    );
  }

  const hoursWorked = payData?.hoursPayroll ?? 0;
  const estimatedGross = payData?.payPayroll ?? 0;
  const hourlyWage = payData?.hourlyWage ?? 15;
  const shifts = payData?.shifts ?? [];

  return (
    <Layout>
      <div className="space-y-4">
        <div>
          <h1 className="text-3xl font-bold">My Wallet</h1>
          <div className="flex items-center justify-between">
            <p className="text-muted-foreground">
              {payData && (
                <>Pay Period: {format(parseISO(payData.payPeriodStart), "MMM d")} - {format(parseISO(payData.payPeriodEnd), "MMM d, yyyy")}</>
              )}
            </p>
            <div className="flex items-center gap-1">
              <Button 
                variant="ghost" 
                size="icon" 
                onClick={() => setPeriodOffset(prev => prev - 1)}
                className="h-8 w-8"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button 
                variant="ghost" 
                size="sm"
                onClick={() => setPeriodOffset(0)}
                disabled={isCurrentPeriod}
                className="text-xs"
              >
                {isCurrentPeriod ? "Current" : "Today"}
              </Button>
              <Button 
                variant="ghost" 
                size="icon" 
                onClick={() => setPeriodOffset(prev => prev + 1)}
                disabled={isCurrentPeriod}
                className="h-8 w-8"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <PageHeaderDivider />
        </div>

        {/* Hours & Earnings Summary */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Card className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground text-sm mb-2">
              <Clock className="h-4 w-4" />
              Hours Worked this Pay Period
            </div>
            <p className="text-2xl font-bold">{hoursWorked.toFixed(1)}</p>
          </Card>

          <Card className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground text-sm mb-2">
              <DollarSign className="h-4 w-4" />
              Estimated Gross Pay @ ${hourlyWage.toFixed(0)}/hr
            </div>
            <p className="text-2xl font-bold">${estimatedGross.toFixed(2)}</p>
          </Card>
        </div>

        {/* Shifts Breakdown */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Calendar className="h-5 w-5" />
              Shifts This Pay Period
            </CardTitle>
            <CardDescription>
              {shifts.length} shift{shifts.length !== 1 ? 's' : ''} worked
            </CardDescription>
          </CardHeader>
          <CardContent>
            {shifts.length === 0 ? (
              <p className="text-muted-foreground text-center py-4">No shifts recorded yet</p>
            ) : (
              <div className="space-y-3">
                {shifts.map((shift, idx) => (
                  <div key={idx} className="flex items-center justify-between p-3 border rounded-lg">
                    <div className="flex items-center gap-3">
                      <Clock className="h-4 w-4 text-muted-foreground" />
                      <div>
                        <p className="font-medium">
                          {format(parseISO(shift.date), "EEE, MMM d")}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {format(shift.clockIn, "h:mm a")} - {shift.clockOut ? format(shift.clockOut, "h:mm a") : "In Progress"}
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="font-bold">{shift.hours.toFixed(1)} hrs</p>
                      <p className="text-xs text-muted-foreground">${shift.estimatedPay.toFixed(2)}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Croo Cash Section */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <img src={crooCashIcon} alt="Croo Cash" className="h-5 w-5" />
                  Croo Cash
                </CardTitle>
                <CardDescription>
                  Earn points by picking up shifts, spend them by offering yours
                </CardDescription>
              </div>
              <div className="text-right">
                <p className={`text-2xl font-bold ${getBalanceColor()}`}>
                  ${(crooCashBalance / 100).toFixed(2)}
                </p>
                <p className="text-xs text-muted-foreground">balance</p>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {transactions.length === 0 ? (
              <p className="text-muted-foreground text-center py-4">No transactions yet</p>
            ) : (
              <ScrollArea className="h-[240px]">
                <div className="space-y-3 pr-3">
                  {transactions.map((txn) => (
                    <div key={txn.id} className="flex items-center justify-between p-3 border rounded-lg">
                      <div className="flex items-center gap-3">
                        {getTransactionIcon(txn.transaction_type)}
                        <div>
                          <p className="font-medium">
                            {getTransactionLabel(txn.transaction_type)}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {format(parseISO(txn.shift_date), "MMM d, yyyy")}
                          </p>
                        </div>
                      </div>
                      <span className={`font-bold ${txn.amount > 0 ? "text-green-500" : "text-red-500"}`}>
                        {txn.amount > 0 ? "+" : ""}${(Math.abs(txn.amount) / 100).toFixed(2)}
                      </span>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            )}
          </CardContent>
        </Card>

        {/* Info */}
        <Card className="bg-muted/50">
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">
              <strong>Note:</strong> Estimated gross pay is calculated from your punch clock entries 
              and current hourly rate. Actual pay may differ based on overtime, deductions, and payroll adjustments.
            </p>
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}
