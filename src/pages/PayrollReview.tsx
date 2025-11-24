import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { format, addDays, addWeeks } from 'date-fns';
import { useUserRole } from '@/hooks/useUserRole';
import { toast } from 'sonner';
import { ChevronLeft, ChevronRight, AlertTriangle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { QuickPunchDialog } from '@/components/timeclock/QuickPunchDialog';

import { Layout } from '@/components/Layout';

export default function PayrollReview() {
  const { isAdmin, isManager } = useUserRole();
  const [payPeriods, setPayPeriods] = useState<any[]>([]);
  const [selectedPeriod, setSelectedPeriod] = useState<any>(null);
  const [timeCards, setTimeCards] = useState<any[]>([]);
  const [editingPunch, setEditingPunch] = useState<any>(null);
  const [sortBy, setSortBy] = useState<'name' | 'day'>('name');
  const [showQuickEntry, setShowQuickEntry] = useState(false);

  useEffect(() => {
    if (isAdmin || isManager) {
      generatePayPeriods();
    }
  }, [isAdmin, isManager]);

  useEffect(() => {
    if (selectedPeriod) {
      fetchTimeCards();
    }
  }, [selectedPeriod, sortBy]);

  const generatePayPeriods = () => {
    // Base period: Monday Nov 3, 2025 - Sunday Nov 16, 2025
    // Each pay period is exactly 14 days (2 weeks), Monday to Sunday
    const baseStart = new Date(2025, 10, 3); // Month is 0-indexed, so 10 = November
    const periods = [];
    
    // Generate 10 pay periods starting from base date
    for (let i = 0; i <= 9; i++) {
      const periodStart = addWeeks(baseStart, i * 2); // Each period is 2 weeks apart
      const periodEnd = addDays(periodStart, 13); // 14 days total (0-13 = 14 days)
      
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

        // Check for issues
        const issues: string[] = [];
        Object.entries(punchesByDay).forEach(([day, dayPunches]) => {
          const clockIn = dayPunches.find(p => p.punch_type === 'clock_in');
          const clockOut = dayPunches.find(p => p.punch_type === 'clock_out');
          const mealBreak = dayPunches.filter(p => p.notes?.includes('30 minute'));
          
          if (clockIn && !clockOut) {
            issues.push(`${day}: Missing clock out`);
          }
          
          // Check if shift is over 5 hours and no meal break
          if (clockIn && clockOut) {
            const hours = (new Date(clockOut.punch_time).getTime() - new Date(clockIn.punch_time).getTime()) / 3600000;
            if (hours > 5 && mealBreak.length === 0) {
              issues.push(`${day}: Missing required meal break`);
            }
          }
        });

        return {
          profile,
          punches: punches || [],
          punchesByDay,
          issues
        };
      })
    );

    // Sort cards
    const sortedCards = sortBy === 'name' 
      ? cards.sort((a, b) => a.profile.full_name.localeCompare(b.profile.full_name))
      : cards.sort((a, b) => {
          const aDays = Object.keys(a.punchesByDay).sort();
          const bDays = Object.keys(b.punchesByDay).sort();
          return aDays[0]?.localeCompare(bDays[0] || '') || 0;
        });

    setTimeCards(sortedCards);
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

  if (!isAdmin && !isManager) {
    return (
      <div className="container mx-auto p-6">
        <Card>
          <CardContent className="p-6 text-center">
            <p>You do not have permission to view payroll data.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <Layout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold">Payroll Review</h1>
          <p className="text-muted-foreground">Review and manage employee time cards by pay period</p>
        </div>

      {!selectedPeriod ? (
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
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Button variant="ghost" onClick={() => setSelectedPeriod(null)}>
                <ChevronLeft className="mr-2 h-4 w-4" />
                Back to Pay Periods
              </Button>
              <h2 className="text-xl font-semibold">{selectedPeriod.label}</h2>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant={sortBy === 'name' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setSortBy('name')}
              >
                Sort by Name
              </Button>
              <Button
                variant={sortBy === 'day' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setSortBy('day')}
              >
                Sort by Day
              </Button>
              <Button onClick={() => setShowQuickEntry(true)}>
                Quick Entry
              </Button>
            </div>
          </div>

          <QuickPunchDialog
            open={showQuickEntry}
            onOpenChange={setShowQuickEntry}
            onSuccess={fetchTimeCards}
          />

          {timeCards.map((card) => (
            <Card key={card.profile.id}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>{card.profile.full_name}</CardTitle>
                  {card.issues.length > 0 && (
                    <Badge variant="destructive" className="gap-1">
                      <AlertTriangle className="h-3 w-3" />
                      {card.issues.length} Issue{card.issues.length > 1 ? 's' : ''}
                    </Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {card.issues.length > 0 && (
                  <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-3 space-y-1">
                    {card.issues.map((issue: string, i: number) => (
                      <p key={i} className="text-sm text-destructive">⚠️ {issue}</p>
                    ))}
                  </div>
                )}

                <div className="space-y-2">
                  {Object.entries(card.punchesByDay).map(([day, punches]: [string, any]) => (
                    <div key={day} className="border rounded-lg p-3">
                      <p className="font-medium mb-2">{format(new Date(day), 'EEEE, MMM d')}</p>
                      <div className="space-y-1 text-sm">
                        {punches.map((punch: any) => (
                          <div key={punch.id} className="flex items-center justify-between">
                            <span className="capitalize">{punch.punch_type.replace('_', ' ')}</span>
                            <div className="flex items-center gap-2">
                              <span>{format(new Date(punch.punch_time), 'h:mm a')}</span>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setEditingPunch(punch)}
                              >
                                Edit
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

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
