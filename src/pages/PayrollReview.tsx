import { useState, useEffect, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { format, addDays, addWeeks, startOfWeek, endOfWeek, isSameWeek } from 'date-fns';
import { useUserRole } from '@/hooks/useUserRole';
import { useLocation as useAppLocation } from '@/hooks/useLocation';
import { toast } from 'sonner';
import { ChevronLeft, AlertTriangle, Edit, Trash2, Clock, CheckCircle2, Lock, AlertCircle, Coffee, Download, FileSpreadsheet, Calendar } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Layout } from '@/components/Layout';
import { QuickPunchDialog } from '@/components/timeclock/QuickPunchDialog';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

export default function PayrollReview() {
  const { isAdmin, isManager } = useUserRole();
  const { currentLocation } = useAppLocation();
  const [payPeriods, setPayPeriods] = useState<any[]>([]);
  const [selectedPeriod, setSelectedPeriod] = useState<any>(null);
  const [timeCards, setTimeCards] = useState<any[]>([]);
  const [editingPunch, setEditingPunch] = useState<any>(null);
  const [showQuickEntry, setShowQuickEntry] = useState(false);
  const [includeApproved, setIncludeApproved] = useState(false);
  const [filterEmployee, setFilterEmployee] = useState<string>('all');
  const [periodStatuses, setPeriodStatuses] = useState<Record<string, any>>({});
  const [approvalWarning, setApprovalWarning] = useState<{ punches: any[], type: 'day' | 'all' } | null>(null);

  useEffect(() => {
    if (isAdmin || isManager) {
      generatePayPeriods();
    }
  }, [isAdmin, isManager]);

  useEffect(() => {
    if (selectedPeriod) {
      fetchTimeCards();
    }
  }, [selectedPeriod]);

  const generatePayPeriods = async () => {
    // Base period: Monday Nov 3, 2025 - Sunday Nov 16, 2025
    const baseStart = new Date(2025, 10, 3);
    const today = new Date();
    today.setHours(0, 0, 0, 0); // Reset time to start of day for comparison
    const periods = [];
    
    for (let i = 0; i <= 9; i++) {
      const periodStart = addWeeks(baseStart, i * 2);
      const periodEnd = addDays(periodStart, 13);
      
      // Only include periods that have already started (not in the future)
      if (periodStart <= today) {
        periods.push({
          start: periodStart,
          end: periodEnd,
          label: `${format(periodStart, 'EEE MMM d')} - ${format(periodEnd, 'EEE MMM d, yyyy')}`
        });
      }
    }
    
    // Reverse to show most recent first
    periods.reverse();
    
    setPayPeriods(periods);
    
    // Fetch period statuses from database
    const { data: statuses } = await supabase
      .from('pay_periods')
      .select('*');
    
    const statusMap: Record<string, any> = {};
    statuses?.forEach(status => {
      const key = `${status.start_date}_${status.end_date}`;
      statusMap[key] = status;
    });
    setPeriodStatuses(statusMap);
  };

  const fetchTimeCards = async () => {
    if (!selectedPeriod || !currentLocation) return;

    // Get users at current location
    const { data: userLocations } = await supabase
      .from('user_locations')
      .select('user_id')
      .eq('location_id', currentLocation.id);

    const userIds = userLocations?.map(ul => ul.user_id) || [];

    const { data: profiles } = await supabase
      .from('profiles')
      .select('*')
      .eq('is_active', true)
      .in('id', userIds)
      .order('full_name');

    if (!profiles) return;

    const cards = await Promise.all(
      profiles.map(async (profile) => {
        const { data: punches } = await supabase
          .from('time_punches')
          .select('*')
          .eq('user_id', profile.id)
          .eq('location_id', currentLocation.id)
          .gte('punch_time', selectedPeriod.start.toISOString())
          .lte('punch_time', selectedPeriod.end.toISOString())
          .order('punch_time');

        // Get current wage for this employee
        const { data: currentWage } = await supabase
          .rpc('get_current_wage', { p_user_id: profile.id });

        // Group punches by day
        const punchesByDay: { [key: string]: any[] } = {};
        punches?.forEach(punch => {
          const day = format(new Date(punch.punch_time), 'yyyy-MM-dd');
          if (!punchesByDay[day]) punchesByDay[day] = [];
          punchesByDay[day].push(punch);
        });

        // Calculate total hours and check for issues
        let totalHours = 0;
        const issues: string[] = [];
        
        Object.entries(punchesByDay).forEach(([day, dayPunches]) => {
          const clockIn = dayPunches.find(p => p.punch_type === 'clock_in');
          const clockOut = dayPunches.find(p => p.punch_type === 'clock_out');
          const mealBreakStart = dayPunches.find(p => p.punch_type === 'break_start' && p.notes?.includes('30 minute'));
          const mealBreakEnd = dayPunches.find(p => p.punch_type === 'break_end' && p.notes?.includes('30 minute'));
          
          if (clockIn && !clockOut) {
            issues.push(`${day}: Missing clock out`);
          }
          
          if (clockIn && clockOut) {
            const hours = (new Date(clockOut.punch_time).getTime() - new Date(clockIn.punch_time).getTime()) / 3600000;
            
            // Subtract meal break if present
            if (mealBreakStart && mealBreakEnd) {
              const breakHours = (new Date(mealBreakEnd.punch_time).getTime() - new Date(mealBreakStart.punch_time).getTime()) / 3600000;
              totalHours += (hours - breakHours);
            } else {
              totalHours += hours;
              
              // Check if shift is over 5 hours and no meal break
              if (hours > 5) {
                issues.push(`${day}: Missing required meal break`);
              }
            }
          }
        });

        return {
          profile: {
            ...profile,
            hourly_wage: currentWage || profile.hourly_wage || 15
          },
          punches: punches || [],
          punchesByDay,
          totalHours,
          issues
        };
      })
    );

    setTimeCards(cards);
  };

  const calculateDayHours = (dayPunches: any[]) => {
    const clockIn = dayPunches.find(p => p.punch_type === 'clock_in');
    const clockOut = dayPunches.find(p => p.punch_type === 'clock_out');
    const mealBreakStart = dayPunches.find(p => p.punch_type === 'break_start' && p.notes?.includes('30 minute'));
    const mealBreakEnd = dayPunches.find(p => p.punch_type === 'break_end' && p.notes?.includes('30 minute'));
    
    if (!clockIn || !clockOut) return 0;
    
    const hours = (new Date(clockOut.punch_time).getTime() - new Date(clockIn.punch_time).getTime()) / 3600000;
    
    if (mealBreakStart && mealBreakEnd) {
      const breakHours = (new Date(mealBreakEnd.punch_time).getTime() - new Date(mealBreakStart.punch_time).getTime()) / 3600000;
      return hours - breakHours;
    }
    
    return hours;
  };

  const hasDayIssues = (dayPunches: any[]) => {
    const clockIn = dayPunches.find(p => p.punch_type === 'clock_in');
    const clockOut = dayPunches.find(p => p.punch_type === 'clock_out');
    const mealBreak = dayPunches.filter(p => p.notes?.includes('30 minute'));
    
    if (clockIn && !clockOut) return true;
    
    if (clockIn && clockOut) {
      const hours = (new Date(clockOut.punch_time).getTime() - new Date(clockIn.punch_time).getTime()) / 3600000;
      if (hours > 5 && mealBreak.length === 0) return true;
    }
    
    return false;
  };

  const handleDeletePunch = async (punchId: string) => {
    const { error } = await supabase
      .from('time_punches')
      .delete()
      .eq('id', punchId);

    if (error) {
      toast.error('Failed to delete punch');
      return;
    }

    toast.success('Punch deleted');
    fetchTimeCards();
  };

  const handleEditPunch = async (punch: any, newTime: string) => {
    const { error } = await supabase
      .from('time_punches')
      .update({ punch_time: newTime })
      .eq('id', punch.id);

    if (error) {
      toast.error('Failed to update punch time');
      return;
    }

    toast.success('Punch time updated');
    setEditingPunch(null);
    fetchTimeCards();
  };

  const handleApprovePunch = async (punchId: string) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { error } = await supabase
      .from('time_punches')
      .update({ 
        approved_by: user.id,
        approved_at: new Date().toISOString()
      })
      .eq('id', punchId);

    if (error) {
      toast.error('Failed to approve punch');
      return;
    }

    toast.success('Punch approved');
    fetchTimeCards();
  };

  const handleApproveDay = async (dayPunches: any[]) => {
    // Check for flagged punches
    const hasFlaggedPunches = dayPunches.some((p: any) => p.is_auto_punched_out || p.has_break_violation);
    if (hasFlaggedPunches) {
      setApprovalWarning({ punches: dayPunches, type: 'day' });
      return;
    }
    await approvePunches(dayPunches.map(p => p.id));
  };

  const handleApproveAll = async () => {
    const allUnapprovedPunches = filteredCards.flatMap(card => 
      card.punches.filter((p: any) => !p.approved_at)
    );

    if (allUnapprovedPunches.length === 0) {
      toast.info('No punches to approve');
      return;
    }

    // Check for flagged punches
    const hasFlaggedPunches = allUnapprovedPunches.some((p: any) => p.is_auto_punched_out || p.has_break_violation);
    if (hasFlaggedPunches) {
      setApprovalWarning({ punches: allUnapprovedPunches, type: 'all' });
      return;
    }
    await approvePunches(allUnapprovedPunches.map((p: any) => p.id));
  };

  const approvePunches = async (punchIds: string[]) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { error } = await supabase
      .from('time_punches')
      .update({ 
        approved_by: user.id,
        approved_at: new Date().toISOString()
      })
      .in('id', punchIds);

    if (error) {
      toast.error('Failed to approve punches');
      return;
    }

    toast.success(`Approved ${punchIds.length} punch${punchIds.length !== 1 ? 'es' : ''}`);
    setApprovalWarning(null);
    fetchTimeCards();
  };

  const filteredCards = filterEmployee === 'all' 
    ? timeCards 
    : timeCards.filter(card => card.profile.id === filterEmployee);

  // Count shifts (unique days) awaiting approval, not individual punch records
  const countShiftsAwaitingApproval = (cards: typeof timeCards) => {
    return cards.reduce((sum, card) => {
      // Count days that have any unapproved punches
      const daysWithUnapproved = Object.values(card.punchesByDay).filter(
        (dayPunches: any[]) => dayPunches.some((p: any) => !p.approved_at)
      );
      return sum + daysWithUnapproved.length;
    }, 0);
  };

  // Total across all employees (for badge)
  const totalPunchesAwaitingApproval = countShiftsAwaitingApproval(timeCards);

  // Total for filtered view (for button)
  const filteredPunchesAwaitingApproval = countShiftsAwaitingApproval(filteredCards);

  const getPeriodStatus = (period: any) => {
    const key = `${format(period.start, 'yyyy-MM-dd')}_${format(period.end, 'yyyy-MM-dd')}`;
    return periodStatuses[key];
  };

  const handleClosePeriod = async () => {
    if (!selectedPeriod) return;
    
    const startDate = format(selectedPeriod.start, 'yyyy-MM-dd');
    const endDate = format(selectedPeriod.end, 'yyyy-MM-dd');
    
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    
    const { error } = await supabase
      .from('pay_periods')
      .upsert({
        start_date: startDate,
        end_date: endDate,
        status: 'closed',
        closed_at: new Date().toISOString(),
        closed_by: user.id
      }, { onConflict: 'start_date,end_date' });
    
    if (error) {
      toast.error('Failed to close pay period');
      return;
    }
    
    toast.success('Pay period closed');
    generatePayPeriods();
  };

  const handleReopenPeriod = async () => {
    if (!selectedPeriod) return;
    
    const startDate = format(selectedPeriod.start, 'yyyy-MM-dd');
    const endDate = format(selectedPeriod.end, 'yyyy-MM-dd');
    
    const { error } = await supabase
      .from('pay_periods')
      .update({
        status: 'open',
        closed_at: null,
        closed_by: null
      })
      .eq('start_date', startDate)
      .eq('end_date', endDate);
    
    if (error) {
      toast.error('Failed to reopen pay period');
      return;
    }
    
    toast.success('Pay period reopened');
    generatePayPeriods();
  };

  const [ptoData, setPtoData] = useState<Record<string, number>>({});

  // Fetch PTO data when period is selected
  useEffect(() => {
    const fetchPtoData = async () => {
      if (!selectedPeriod || !currentLocation) return;
      
      const startDate = format(selectedPeriod.start, 'yyyy-MM-dd');
      const endDate = format(selectedPeriod.end, 'yyyy-MM-dd');
      
      // Fetch approved PTO requests for this period
      const { data: ptoRequests } = await supabase
        .from('availability_requests')
        .select('user_id, hours_requested, request_type')
        .eq('location_id', currentLocation.id)
        .eq('status', 'approved')
        .in('request_type', ['paid', 'vacation', 'sick']) // Paid time off types
        .gte('start_date', startDate)
        .lte('start_date', endDate);
      
      // Group PTO hours by user
      const ptoByUser: Record<string, number> = {};
      ptoRequests?.forEach(req => {
        if (!ptoByUser[req.user_id]) ptoByUser[req.user_id] = 0;
        ptoByUser[req.user_id] += req.hours_requested || 0;
      });
      
      setPtoData(ptoByUser);
    };
    
    fetchPtoData();
  }, [selectedPeriod, currentLocation]);

  const calculatePayrollSummary = () => {
    const summary = timeCards.map(card => {
      const ptoHours = ptoData[card.profile.id] || 0;
      const regularHours = Math.min(card.totalHours, 40);
      const overtimeHours = Math.max(card.totalHours - 40, 0);
      const wage = card.profile.hourly_wage || 15;
      // Include PTO hours in gross wages calculation (paid at regular rate)
      const grossWages = (regularHours * wage) + (overtimeHours * wage * 1.5) + (ptoHours * wage);
      
      return {
        name: card.profile.full_name,
        odId: card.profile.id,
        wage,
        regularHours,
        overtimeHours,
        ptoHours,
        doubleOvertimeHours: 0, // Not calculated yet
        grossWages
      };
    });

    const totals = summary.reduce((acc, emp) => ({
      regularHours: acc.regularHours + emp.regularHours,
      overtimeHours: acc.overtimeHours + emp.overtimeHours,
      doubleOvertimeHours: acc.doubleOvertimeHours + emp.doubleOvertimeHours,
      ptoHours: acc.ptoHours + emp.ptoHours,
      grossWages: acc.grossWages + emp.grossWages
    }), { regularHours: 0, overtimeHours: 0, doubleOvertimeHours: 0, ptoHours: 0, grossWages: 0 });

    return { employees: summary, totals };
  };

  // Group punches by week for display
  const groupPunchesByWeek = (punchesByDay: { [key: string]: any[] }) => {
    const weeks: { [weekKey: string]: { start: Date; end: Date; days: { [day: string]: any[] } } } = {};
    
    Object.entries(punchesByDay).forEach(([day, punches]) => {
      const dayDate = new Date(day);
      const weekStart = startOfWeek(dayDate, { weekStartsOn: 1 }); // Monday start
      const weekEnd = endOfWeek(dayDate, { weekStartsOn: 1 });
      const weekKey = format(weekStart, 'yyyy-MM-dd');
      
      if (!weeks[weekKey]) {
        weeks[weekKey] = { start: weekStart, end: weekEnd, days: {} };
      }
      weeks[weekKey].days[day] = punches;
    });
    
    return Object.entries(weeks).sort(([a], [b]) => a.localeCompare(b));
  };

  // Export functions
  const exportToCSV = () => {
    const summary = calculatePayrollSummary();
    const headers = ['Employee', 'Hourly Wage', 'Regular Hours', 'Overtime Hours', 'PTO Hours', 'Gross Wages'];
    const rows = summary.employees.map(emp => [
      emp.name,
      emp.wage.toFixed(2),
      emp.regularHours.toFixed(2),
      emp.overtimeHours.toFixed(2),
      emp.ptoHours.toFixed(2),
      emp.grossWages.toFixed(2)
    ]);
    rows.push(['TOTALS', '', summary.totals.regularHours.toFixed(2), summary.totals.overtimeHours.toFixed(2), summary.totals.ptoHours.toFixed(2), summary.totals.grossWages.toFixed(2)]);
    
    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `payroll-${format(selectedPeriod.start, 'yyyy-MM-dd')}-to-${format(selectedPeriod.end, 'yyyy-MM-dd')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('CSV exported');
  };

  const exportToPDF = () => {
    // Create a printable version
    const summary = calculatePayrollSummary();
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      toast.error('Please allow popups to export PDF');
      return;
    }
    
    printWindow.document.write(`
      <html>
        <head>
          <title>Payroll Report - ${selectedPeriod.label}</title>
          <style>
            body { font-family: system-ui, sans-serif; padding: 40px; }
            h1 { font-size: 24px; margin-bottom: 8px; }
            h2 { font-size: 14px; color: #666; margin-bottom: 24px; }
            table { width: 100%; border-collapse: collapse; }
            th, td { padding: 12px; text-align: left; border-bottom: 1px solid #ddd; }
            th { background: #f5f5f5; font-weight: 600; }
            .right { text-align: right; }
            .total { font-weight: bold; background: #f0f0f0; }
            .summary { margin-top: 24px; padding: 16px; background: #f9f9f9; border-radius: 8px; }
            .summary-row { display: flex; justify-content: space-between; padding: 4px 0; }
            .summary-total { font-size: 18px; font-weight: bold; border-top: 2px solid #333; margin-top: 8px; padding-top: 8px; }
          </style>
        </head>
        <body>
          <h1>Payroll Report</h1>
          <h2>${selectedPeriod.label}</h2>
          <table>
            <thead>
              <tr>
                <th>Employee</th>
                <th class="right">Hourly Wage</th>
                <th class="right">Regular Hours</th>
                <th class="right">Overtime</th>
                <th class="right">PTO</th>
                <th class="right">Gross Wages</th>
              </tr>
            </thead>
            <tbody>
              ${summary.employees.map(emp => `
                <tr>
                  <td>${emp.name}</td>
                  <td class="right">$${emp.wage.toFixed(2)}</td>
                  <td class="right">${emp.regularHours.toFixed(2)}</td>
                  <td class="right">${emp.overtimeHours.toFixed(2)}</td>
                  <td class="right">${emp.ptoHours.toFixed(2)}</td>
                  <td class="right">$${emp.grossWages.toFixed(2)}</td>
                </tr>
              `).join('')}
              <tr class="total">
                <td>TOTALS</td>
                <td></td>
                <td class="right">${summary.totals.regularHours.toFixed(2)}</td>
                <td class="right">${summary.totals.overtimeHours.toFixed(2)}</td>
                <td class="right">${summary.totals.ptoHours.toFixed(2)}</td>
                <td class="right">$${summary.totals.grossWages.toFixed(2)}</td>
              </tr>
            </tbody>
          </table>
          <div class="summary">
            <div class="summary-row"><span>Total Regular Hours:</span><span>${summary.totals.regularHours.toFixed(2)}</span></div>
            <div class="summary-row"><span>Total Overtime Hours:</span><span>${summary.totals.overtimeHours.toFixed(2)}</span></div>
            <div class="summary-row"><span>Approved PTO Hours:</span><span>${summary.totals.ptoHours.toFixed(2)}</span></div>
            <div class="summary-row summary-total"><span>Total Gross Wages:</span><span>$${summary.totals.grossWages.toFixed(2)}</span></div>
          </div>
        </body>
      </html>
    `);
    printWindow.document.close();
    printWindow.print();
  };

  const currentPeriodStatus = selectedPeriod ? getPeriodStatus(selectedPeriod) : null;
  const isPeriodClosed = currentPeriodStatus?.status === 'closed';

  if (!isAdmin && !isManager) {
    return (
      <Layout>
        <Card>
          <CardContent className="p-6 text-center">
            <p>You do not have permission to view payroll data.</p>
          </CardContent>
        </Card>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="space-y-6">
        {!selectedPeriod ? (
          <>
            <div>
              <h1 className="text-3xl font-bold">Payroll Review</h1>
              <p className="text-muted-foreground">Select a pay period to review time cards</p>
            </div>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {payPeriods.map((period, index) => {
                const status = getPeriodStatus(period);
                const isClosed = status?.status === 'closed';
                
                return (
                  <Card
                    key={index}
                    className="cursor-pointer hover:shadow-lg transition-shadow"
                    onClick={() => setSelectedPeriod(period)}
                  >
                    <CardHeader>
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-lg">{period.label}</CardTitle>
                        {isClosed ? (
                          <Badge variant="outline" className="bg-muted">
                            <Lock className="mr-1 h-3 w-3" />
                            Closed
                          </Badge>
                        ) : (
                          <Badge variant="default">
                            <CheckCircle2 className="mr-1 h-3 w-3" />
                            Open
                          </Badge>
                        )}
                      </div>
                    </CardHeader>
                  </Card>
                );
              })}
            </div>
          </>
        ) : (
          <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <Button variant="ghost" onClick={() => setSelectedPeriod(null)} className="pl-0">
                  <ChevronLeft className="mr-2 h-4 w-4" />
                  Pay Periods
                </Button>
                <div>
                  <h1 className="text-3xl font-bold">Payroll Period</h1>
                  <p className="text-muted-foreground">{selectedPeriod.label}</p>
                </div>
              </div>
              <div className="flex gap-2">
                {isPeriodClosed ? (
                  <Button variant="outline" onClick={handleReopenPeriod}>
                    Re-Open Pay Period
                  </Button>
                ) : (
                  <Button variant="outline" onClick={handleClosePeriod}>
                    Close Pay Period
                  </Button>
                )}
                {!isPeriodClosed && (
                  <Button onClick={() => setShowQuickEntry(true)}>
                    <Calendar className="mr-2 h-4 w-4" />
                    Add punch
                  </Button>
                )}
              </div>
            </div>

            {/* Filters */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
              <Select defaultValue="all">
                <SelectTrigger>
                  <SelectValue placeholder="All locations" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All locations</SelectItem>
                </SelectContent>
              </Select>

              <Select defaultValue="all">
                <SelectTrigger>
                  <SelectValue placeholder="All departments" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All departments</SelectItem>
                </SelectContent>
              </Select>

              <Select defaultValue="all">
                <SelectTrigger>
                  <SelectValue placeholder="All roles" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All roles</SelectItem>
                </SelectContent>
              </Select>

              <Select defaultValue="all">
                <SelectTrigger>
                  <SelectValue placeholder="All days" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All days</SelectItem>
                </SelectContent>
              </Select>

              <Select value={filterEmployee} onValueChange={setFilterEmployee}>
                <SelectTrigger>
                  <SelectValue placeholder="All employees" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All employees</SelectItem>
                  {timeCards.map(card => (
                    <SelectItem key={card.profile.id} value={card.profile.id}>
                      {card.profile.full_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {isPeriodClosed ? (
              /* Payroll Summary */
              <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                  <CardTitle>Payroll Summary</CardTitle>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" size="sm">
                        <Download className="h-4 w-4 mr-2" />
                        Export
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={exportToCSV}>
                        <FileSpreadsheet className="h-4 w-4 mr-2" />
                        Export to CSV
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={exportToPDF}>
                        <Download className="h-4 w-4 mr-2" />
                        Export to PDF
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Employee</TableHead>
                        <TableHead className="text-right">Rate</TableHead>
                        <TableHead className="text-right">Reg</TableHead>
                        <TableHead className="text-right">OT</TableHead>
                        <TableHead className="text-right">PTO</TableHead>
                        <TableHead className="text-right">Gross</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {calculatePayrollSummary().employees.map((emp, index) => (
                        <TableRow key={index}>
                          <TableCell className="font-medium">{emp.name}</TableCell>
                          <TableCell className="text-right text-muted-foreground">${emp.wage.toFixed(2)}</TableCell>
                          <TableCell className="text-right">{emp.regularHours.toFixed(1)}</TableCell>
                          <TableCell className="text-right">{emp.overtimeHours.toFixed(1)}</TableCell>
                          <TableCell className="text-right">{emp.ptoHours.toFixed(1)}</TableCell>
                          <TableCell className="text-right font-semibold">${emp.grossWages.toFixed(2)}</TableCell>
                        </TableRow>
                      ))}
                      <TableRow className="font-bold bg-muted/50">
                        <TableCell>TOTALS</TableCell>
                        <TableCell></TableCell>
                        <TableCell className="text-right">{calculatePayrollSummary().totals.regularHours.toFixed(1)}</TableCell>
                        <TableCell className="text-right">{calculatePayrollSummary().totals.overtimeHours.toFixed(1)}</TableCell>
                        <TableCell className="text-right">{calculatePayrollSummary().totals.ptoHours.toFixed(1)}</TableCell>
                        <TableCell className="text-right text-lg">${calculatePayrollSummary().totals.grossWages.toFixed(2)}</TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            ) : (
              <>
                {/* Punches Awaiting Approval */}
                <Card className="border-primary/20 bg-primary/5">
                  <CardContent className="p-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="h-8 w-8 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center text-sm font-bold">
                          {totalPunchesAwaitingApproval}
                        </div>
                        <span className="font-medium text-sm">Shifts awaiting approval</span>
                        <div className="flex items-center gap-1.5">
                          <Checkbox
                            id="include-approved"
                            checked={includeApproved}
                            onCheckedChange={(checked) => setIncludeApproved(checked as boolean)}
                            className="h-4 w-4"
                          />
                          <label htmlFor="include-approved" className="text-xs text-muted-foreground cursor-pointer">
                            Show approved
                          </label>
                        </div>
                      </div>
                      <Button size="sm" onClick={handleApproveAll} disabled={filteredPunchesAwaitingApproval === 0}>
                        Approve All ({filteredPunchesAwaitingApproval})
                      </Button>
                    </div>
                  </CardContent>
                </Card>

                {/* Employee Punch Cards - Grouped by Week */}
                <div className="space-y-4">
                  {filteredCards.map((card) => {
                    const weekGroups = groupPunchesByWeek(card.punchesByDay);
                    
                    return (
                      <Card key={card.profile.id} className="overflow-hidden">
                        {/* Employee Header */}
                        <div className="flex items-center justify-between px-4 py-3 bg-muted/30 border-b">
                          <div className="flex items-center gap-2">
                            <Avatar className="h-8 w-8">
                              <AvatarImage src={card.profile.profile_photo_url || undefined} />
                              <AvatarFallback className="text-xs">{card.profile.full_name?.[0] || 'U'}</AvatarFallback>
                            </Avatar>
                            <span className="font-semibold">{card.profile.full_name}</span>
                          </div>
                          <div className="text-right">
                            <span className="font-bold text-lg">{card.totalHours.toFixed(1)}</span>
                            <span className="text-muted-foreground text-sm ml-1">hrs</span>
                          </div>
                        </div>

                        <CardContent className="p-0">
                          {weekGroups.map(([weekKey, weekData]) => (
                            <div key={weekKey}>
                              {/* Week Header - only show if multiple weeks */}
                              {weekGroups.length > 1 && (
                                <div className="px-4 py-2 bg-secondary/30 border-b text-xs font-medium text-muted-foreground flex items-center gap-2">
                                  <Calendar className="h-3 w-3" />
                                  Week of {format(weekData.start, 'MMM d')} - {format(weekData.end, 'MMM d')}
                                </div>
                              )}
                              
                              {/* Compact Day Rows */}
                              <div className="divide-y">
                                {Object.entries(weekData.days)
                                  .sort(([a], [b]) => a.localeCompare(b))
                                  .map(([day, dayPunches]: [string, any]) => {
                                    const clockIn = dayPunches.find((p: any) => p.punch_type === 'clock_in');
                                    const clockOut = dayPunches.find((p: any) => p.punch_type === 'clock_out');
                                    const dayDate = new Date(day);
                                    const dayHours = calculateDayHours(dayPunches);
                                    const isApproved = dayPunches.every((p: any) => p.approved_at);
                                    const hasAutoClockOut = dayPunches.some((p: any) => p.is_auto_punched_out);
                                    const hasBreakViolation = dayPunches.some((p: any) => p.has_break_violation);
                                    const hasIssue = hasDayIssues(dayPunches);

                                    // Skip approved if not showing
                                    if (!includeApproved && isApproved) return null;

                                    return (
                                      <div key={day} className={`flex items-center gap-3 px-4 py-2 hover:bg-muted/20 transition-colors ${hasAutoClockOut || hasBreakViolation ? 'bg-amber-50/50' : ''}`}>
                                        {/* Day Badge */}
                                        <div className="w-12 text-center">
                                          <div className="text-xs text-muted-foreground">{format(dayDate, 'EEE')}</div>
                                          <div className="font-semibold text-sm">{format(dayDate, 'd')}</div>
                                        </div>

                                        {/* Time Range */}
                                        <div className="flex-1 flex items-center gap-2">
                                          <div className="flex items-center gap-1.5 text-sm">
                                            <span className="text-green-600 font-medium">
                                              {clockIn ? format(new Date(clockIn.punch_time), 'h:mm a') : '—'}
                                            </span>
                                            <span className="text-muted-foreground">→</span>
                                            <span className="text-red-600 font-medium">
                                              {clockOut ? format(new Date(clockOut.punch_time), 'h:mm a') : '—'}
                                            </span>
                                          </div>

                                          {/* Status Badges */}
                                          <div className="flex items-center gap-1">
                                            {isApproved && (
                                              <CheckCircle2 className="h-4 w-4 text-green-600" />
                                            )}
                                            {hasAutoClockOut && (
                                              <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-5 text-orange-600 border-orange-300">
                                                Auto
                                              </Badge>
                                            )}
                                            {hasBreakViolation && (
                                              <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-5 text-amber-600 border-amber-300">
                                                <Coffee className="h-3 w-3" />
                                              </Badge>
                                            )}
                                            {hasIssue && !hasBreakViolation && !clockOut && (
                                              <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-5 text-destructive border-destructive/30">
                                                Missing
                                              </Badge>
                                            )}
                                          </div>
                                        </div>

                                        {/* Hours */}
                                        <div className="w-16 text-right font-medium text-sm">
                                          {dayHours.toFixed(1)} hrs
                                        </div>

                                        {/* Actions */}
                                        <div className="flex items-center gap-1">
                                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setEditingPunch(clockIn)}>
                                            <Edit className="h-3.5 w-3.5" />
                                          </Button>
                                          <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => clockIn && handleDeletePunch(clockIn.id)}>
                                            <Trash2 className="h-3.5 w-3.5" />
                                          </Button>
                                          {!isApproved && (
                                            <Button size="sm" variant="secondary" className="h-7 text-xs px-2" onClick={() => handleApproveDay(dayPunches)}>
                                              Approve
                                            </Button>
                                          )}
                                        </div>
                                      </div>
                                    );
                                  })}
                              </div>
                            </div>
                          ))}
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        )}

        <QuickPunchDialog
          open={showQuickEntry}
          onOpenChange={setShowQuickEntry}
          onSuccess={fetchTimeCards}
        />

        <Dialog open={!!editingPunch} onOpenChange={() => setEditingPunch(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Edit Punch Time</DialogTitle>
            </DialogHeader>
            {editingPunch && (
              <div className="space-y-4">
                <Input
                  type="datetime-local"
                  defaultValue={format(new Date(editingPunch.punch_time), "yyyy-MM-dd'T'HH:mm")}
                  onChange={(e) => {
                    const newTime = new Date(e.target.value).toISOString();
                    handleEditPunch(editingPunch, newTime);
                  }}
                />
              </div>
            )}
          </DialogContent>
        </Dialog>

        {/* Approval Warning Dialog */}
        <Dialog open={!!approvalWarning} onOpenChange={() => setApprovalWarning(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-amber-600">
                <AlertTriangle className="h-5 w-5" />
                Review Flagged Punches
              </DialogTitle>
              <DialogDescription>
                The following issues were found with these punches. Please review before approving.
              </DialogDescription>
            </DialogHeader>
            {approvalWarning && (
              <div className="space-y-3">
                {approvalWarning.punches.some((p: any) => p.is_auto_punched_out) && (
                  <div className="flex items-center gap-2 p-3 bg-orange-50 rounded-lg border border-orange-200">
                    <AlertCircle className="h-5 w-5 text-orange-600" />
                    <div>
                      <p className="font-medium text-orange-800">Auto Clock-Out Detected</p>
                      <p className="text-sm text-orange-600">
                        {approvalWarning.punches.filter((p: any) => p.is_auto_punched_out).length} punch(es) were automatically generated because employees forgot to clock out.
                      </p>
                    </div>
                  </div>
                )}
                {approvalWarning.punches.some((p: any) => p.has_break_violation) && (
                  <div className="flex items-center gap-2 p-3 bg-amber-50 rounded-lg border border-amber-200">
                    <Coffee className="h-5 w-5 text-amber-600" />
                    <div>
                      <p className="font-medium text-amber-800">Break Violation</p>
                      <p className="text-sm text-amber-600">
                        {approvalWarning.punches.filter((p: any) => p.has_break_violation).length} shift(s) exceeded break threshold without a recorded meal break.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            )}
            <DialogFooter className="flex gap-2">
              <Button variant="outline" onClick={() => setApprovalWarning(null)}>
                Cancel & Edit
              </Button>
              <Button 
                variant="default"
                onClick={() => approvalWarning && approvePunches(approvalWarning.punches.map((p: any) => p.id))}
              >
                Approve Anyway
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </Layout>
  );
}
