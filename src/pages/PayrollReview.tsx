import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { format, addDays, addWeeks } from 'date-fns';
import { useUserRole } from '@/hooks/useUserRole';
import { toast } from 'sonner';
import { ChevronLeft, AlertTriangle, Camera, Edit, Trash2, Clock, Calendar } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Layout } from '@/components/Layout';
import { QuickPunchDialog } from '@/components/timeclock/QuickPunchDialog';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export default function PayrollReview() {
  const { isAdmin, isManager } = useUserRole();
  const [payPeriods, setPayPeriods] = useState<any[]>([]);
  const [selectedPeriod, setSelectedPeriod] = useState<any>(null);
  const [timeCards, setTimeCards] = useState<any[]>([]);
  const [editingPunch, setEditingPunch] = useState<any>(null);
  const [showQuickEntry, setShowQuickEntry] = useState(false);
  const [includeApproved, setIncludeApproved] = useState(false);
  const [filterEmployee, setFilterEmployee] = useState<string>('all');

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

  const generatePayPeriods = () => {
    // Base period: Monday Nov 3, 2025 - Sunday Nov 16, 2025
    const baseStart = new Date(2025, 10, 3);
    const periods = [];
    
    for (let i = 0; i <= 9; i++) {
      const periodStart = addWeeks(baseStart, i * 2);
      const periodEnd = addDays(periodStart, 13);
      
      periods.push({
        start: periodStart,
        end: periodEnd,
        label: `${format(periodStart, 'EEE MMM d')} - ${format(periodEnd, 'EEE MMM d, yyyy')}`
      });
    }
    
    setPayPeriods(periods);
  };

  const fetchTimeCards = async () => {
    if (!selectedPeriod) return;

    const { data: profiles } = await supabase
      .from('profiles')
      .select('*')
      .eq('is_active', true)
      .order('full_name');

    if (!profiles) return;

    const cards = await Promise.all(
      profiles.map(async (profile) => {
        const { data: punches } = await supabase
          .from('time_punches')
          .select('*')
          .eq('user_id', profile.id)
          .gte('punch_time', selectedPeriod.start.toISOString())
          .lte('punch_time', selectedPeriod.end.toISOString())
          .order('punch_time');

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
          profile,
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

  const filteredCards = filterEmployee === 'all' 
    ? timeCards 
    : timeCards.filter(card => card.profile.id === filterEmployee);

  const totalPunchesAwaitingApproval = filteredCards.reduce((sum, card) => {
    return sum + Object.keys(card.punchesByDay).length;
  }, 0);

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
              {payPeriods.map((period, index) => (
                <Card
                  key={index}
                  className="cursor-pointer hover:shadow-lg transition-shadow"
                  onClick={() => setSelectedPeriod(period)}
                >
                  <CardHeader>
                    <CardTitle className="text-lg">{period.label}</CardTitle>
                  </CardHeader>
                </Card>
              ))}
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
                <Button variant="outline">Close pay period</Button>
                <Button onClick={() => setShowQuickEntry(true)}>
                  <Calendar className="mr-2 h-4 w-4" />
                  Add punch
                </Button>
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

              <Button variant="outline">
                <Calendar className="mr-2 h-4 w-4" />
                Table View
              </Button>
            </div>

            {/* Punches Awaiting Approval */}
            <Card className="bg-muted/50">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Badge variant="destructive" className="h-8 w-8 rounded-full flex items-center justify-center text-base">
                      {totalPunchesAwaitingApproval}
                    </Badge>
                    <span className="font-semibold">Punches awaiting approval</span>
                    <div className="flex items-center gap-2">
                      <Checkbox
                        id="include-approved"
                        checked={includeApproved}
                        onCheckedChange={(checked) => setIncludeApproved(checked as boolean)}
                      />
                      <label htmlFor="include-approved" className="text-sm text-muted-foreground cursor-pointer">
                        Include approved
                      </label>
                    </div>
                  </div>
                  <Button>
                    Approve All [{totalPunchesAwaitingApproval}]
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Employee Punch Cards */}
            <div className="space-y-6">
              {filteredCards.map((card) => (
                <Card key={card.profile.id}>
                  <CardContent className="p-6">
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-3">
                        <Avatar className="h-12 w-12">
                          <AvatarImage src={card.profile.profile_photo_url || undefined} />
                          <AvatarFallback>{card.profile.full_name?.[0] || 'U'}</AvatarFallback>
                        </Avatar>
                        <span className="font-semibold text-lg">{card.profile.full_name}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-lg font-semibold">{card.totalHours.toFixed(2)} hrs</span>
                        <Button variant="ghost" size="icon">
                          <Clock className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>

                    <div className="space-y-3">
                      {Object.entries(card.punchesByDay).map(([day, dayPunches]: [string, any]) => {
                        const clockIn = dayPunches.find((p: any) => p.punch_type === 'clock_in');
                        const clockOut = dayPunches.find((p: any) => p.punch_type === 'clock_out');
                        const mealBreakStart = dayPunches.find((p: any) => p.punch_type === 'break_start' && p.notes?.includes('30 minute'));
                        const mealBreakEnd = dayPunches.find((p: any) => p.punch_type === 'break_end' && p.notes?.includes('30 minute'));
                        const dayDate = new Date(day);
                        const hasIssues = hasDayIssues(dayPunches);
                        const dayHours = calculateDayHours(dayPunches);

                        return (
                          <div key={day} className="border rounded-lg overflow-hidden">
                            <div className="flex">
                              {/* Day Sidebar */}
                              <div className="bg-destructive text-destructive-foreground w-20 flex flex-col items-center justify-center p-2">
                                <span className="text-xs font-medium">{format(dayDate, 'EEE')}</span>
                                <span className="text-sm font-bold">{format(dayDate, 'MMM d')}</span>
                              </div>

                              {/* Punch Details */}
                              <div className="flex-1 p-4 space-y-3">
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center gap-2">
                                    <Calendar className="h-4 w-4 text-muted-foreground" />
                                    <span className="text-sm">
                                      {clockIn && clockOut ? (
                                        `${format(new Date(clockIn.punch_time), 'h:mm a')} - ${format(new Date(clockOut.punch_time), 'h:mm a')}`
                                      ) : (
                                        'Incomplete'
                                      )}
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <Button variant="ghost" size="icon" onClick={() => setEditingPunch(clockIn)}>
                                      <Edit className="h-4 w-4" />
                                    </Button>
                                    <Button variant="ghost" size="icon" onClick={() => clockIn && handleDeletePunch(clockIn.id)}>
                                      <Trash2 className="h-4 w-4" />
                                    </Button>
                                    <Button size="sm">Approve</Button>
                                  </div>
                                </div>

                                <div className="flex items-center gap-4 text-sm">
                                  {clockIn && (
                                    <div className="flex items-center gap-1">
                                      <Clock className="h-3 w-3 text-green-600" />
                                      <span className="text-green-600">IN</span>
                                      <span className="font-medium">{format(new Date(clockIn.punch_time), 'h:mm a')}</span>
                                    </div>
                                  )}
                                  {clockOut && (
                                    <div className="flex items-center gap-1">
                                      <Clock className="h-3 w-3 text-red-600" />
                                      <span className="text-red-600">OUT</span>
                                      <span className="font-medium">{format(new Date(clockOut.punch_time), 'h:mm a')}</span>
                                    </div>
                                  )}
                                  {!clockOut && clockIn && (
                                    <Badge variant="outline">Late</Badge>
                                  )}
                                </div>

                                {hasIssues && (
                                  <div className="flex items-center gap-2 text-amber-600 text-sm">
                                    <AlertTriangle className="h-4 w-4" />
                                    <span>1 possible exception</span>
                                  </div>
                                )}

                                {mealBreakStart && mealBreakEnd && (
                                  <div className="text-sm text-muted-foreground">
                                    <span className="font-medium">Break:</span> {format(new Date(mealBreakStart.punch_time), 'h:mm a')} - {format(new Date(mealBreakEnd.punch_time), 'h:mm a')} (30 min unpaid)
                                  </div>
                                )}

                                <div className="text-right">
                                  <span className="text-sm font-semibold">{dayHours.toFixed(2)} hrs</span>
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
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
      </div>
    </Layout>
  );
}
