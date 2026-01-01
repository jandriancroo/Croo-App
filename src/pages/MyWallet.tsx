import { useState, useEffect } from "react";
import { Layout } from "@/components/Layout";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { format, parseISO } from "date-fns";
import { Clock, DollarSign, TrendingUp, TrendingDown, Calendar } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import crooCashIcon from "@/assets/croo-cash-icon.png";

interface Transaction {
  id: string;
  amount: number;
  transaction_type: string;
  shift_date: string;
  notes: string | null;
  created_at: string;
}

interface PayPeriod {
  start_date: string;
  end_date: string;
}

interface ShiftEntry {
  date: string;
  clockIn: Date;
  clockOut: Date | null;
  hours: number;
  estimatedPay: number;
}

export default function MyWallet() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [hoursWorked, setHoursWorked] = useState(0);
  const [estimatedGross, setEstimatedGross] = useState(0);
  const [crooCashBalance, setCrooCashBalance] = useState(0);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [currentPayPeriod, setCurrentPayPeriod] = useState<PayPeriod | null>(null);
  const [hourlyWage, setHourlyWage] = useState(15);
  const [shifts, setShifts] = useState<ShiftEntry[]>([]);

  useEffect(() => {
    if (user) {
      fetchWalletData();
    }
  }, [user]);

  const getCurrentPayPeriod = (): PayPeriod => {
    // Baseline: Nov 3, 2025 (Monday)
    const baseline = new Date(2025, 10, 3); // Month is 0-indexed
    const today = new Date();
    
    // Calculate days since baseline
    const daysSinceBaseline = Math.floor((today.getTime() - baseline.getTime()) / (1000 * 60 * 60 * 24));
    
    // Each pay period is 14 days
    const periodsElapsed = Math.floor(daysSinceBaseline / 14);
    
    // Calculate current period start
    const periodStart = new Date(baseline);
    periodStart.setDate(baseline.getDate() + (periodsElapsed * 14));
    
    // If today is before baseline, use baseline as start
    if (today < baseline) {
      return {
        start_date: format(baseline, 'yyyy-MM-dd'),
        end_date: format(new Date(baseline.getTime() + 13 * 24 * 60 * 60 * 1000), 'yyyy-MM-dd')
      };
    }
    
    const periodEnd = new Date(periodStart);
    periodEnd.setDate(periodStart.getDate() + 13);
    
    return {
      start_date: format(periodStart, 'yyyy-MM-dd'),
      end_date: format(periodEnd, 'yyyy-MM-dd')
    };
  };

  const fetchWalletData = async () => {
    if (!user) return;

    try {
      setLoading(true);
      const payPeriod = getCurrentPayPeriod();
      setCurrentPayPeriod(payPeriod);

      // Fetch user profile for wage and croo cash
      const { data: profile } = await supabase
        .from("profiles")
        .select("hourly_wage, croo_cash_balance")
        .eq("id", user.id)
        .single();

      const wage = profile?.hourly_wage || 15;
      if (profile) {
        setHourlyWage(wage);
        setCrooCashBalance(profile.croo_cash_balance || 0);
      }

      // Fetch time punches for current pay period
      const { data: punches } = await supabase
        .from("time_punches")
        .select("*")
        .eq("user_id", user.id)
        .gte("punch_time", `${payPeriod.start_date}T00:00:00`)
        .lte("punch_time", `${payPeriod.end_date}T23:59:59`)
        .order("punch_time", { ascending: true });

      // Calculate hours worked from punches and build shift entries
      let totalMinutes = 0;
      const shiftEntries: ShiftEntry[] = [];
      
      if (punches && punches.length > 0) {
        let clockInTime: Date | null = null;
        let clockInPunch: any = null;
        
        for (const punch of punches) {
          if (punch.punch_type === "clock_in") {
            clockInTime = new Date(punch.punch_time);
            clockInPunch = punch;
          } else if (punch.punch_type === "clock_out" && clockInTime) {
            const clockOutTime = new Date(punch.punch_time);
            const diffMinutes = (clockOutTime.getTime() - clockInTime.getTime()) / (1000 * 60);
            totalMinutes += diffMinutes;
            
            const shiftHours = diffMinutes / 60;
            shiftEntries.push({
              date: format(clockInTime, 'yyyy-MM-dd'),
              clockIn: clockInTime,
              clockOut: clockOutTime,
              hours: shiftHours,
              estimatedPay: shiftHours * wage
            });
            
            clockInTime = null;
            clockInPunch = null;
          }
        }
        
        // Handle open shift (clocked in but not out yet)
        if (clockInTime && clockInPunch) {
          const now = new Date();
          const diffMinutes = (now.getTime() - clockInTime.getTime()) / (1000 * 60);
          totalMinutes += diffMinutes;
          
          const shiftHours = diffMinutes / 60;
          shiftEntries.push({
            date: format(clockInTime, 'yyyy-MM-dd'),
            clockIn: clockInTime,
            clockOut: null,
            hours: shiftHours,
            estimatedPay: shiftHours * wage
          });
        }
      }

      // Sort shifts by date descending (most recent first)
      shiftEntries.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      setShifts(shiftEntries);

      const hours = totalMinutes / 60;
      setHoursWorked(hours);
      setEstimatedGross(hours * wage);

      // Fetch Croo Cash transactions
      const { data: txns } = await supabase
        .from("croo_cash_transactions")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(10);

      setTransactions(txns || []);
    } catch (error) {
      console.error("Error fetching wallet data:", error);
    } finally {
      setLoading(false);
    }
  };

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

  if (loading) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-64">
          <p>Loading wallet...</p>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold">My Wallet</h1>
          <p className="text-muted-foreground">
            {currentPayPeriod && (
              <>Pay Period: {format(parseISO(currentPayPeriod.start_date), "MMM d")} - {format(parseISO(currentPayPeriod.end_date), "MMM d, yyyy")}</>
            )}
          </p>
        </div>

        {/* Hours & Earnings Summary */}
        <div className="grid grid-cols-2 gap-3">
          <Card className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
              <Clock className="h-4 w-4" />
              Hours Worked
            </div>
            <p className="text-2xl font-bold">{hoursWorked.toFixed(1)}</p>
            <p className="text-xs text-muted-foreground">this pay period</p>
          </Card>

          <Card className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
              <DollarSign className="h-4 w-4" />
              Estimated Gross Pay
            </div>
            <p className="text-2xl font-bold">${estimatedGross.toFixed(2)}</p>
            <p className="text-xs text-muted-foreground">@ ${hourlyWage.toFixed(2)}/hr</p>
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
                <p className={`text-3xl font-bold ${getBalanceColor()}`}>
                  ${(crooCashBalance / 100).toFixed(2)}
                </p>
                <p className="text-sm text-muted-foreground">balance</p>
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
