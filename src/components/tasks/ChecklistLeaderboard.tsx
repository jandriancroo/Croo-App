import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Progress } from "@/components/ui/progress";
import { Trophy } from "lucide-react";
import { format, startOfMonth, endOfMonth, eachDayOfInterval, startOfDay, endOfDay } from "date-fns";

interface ManagerStats {
  userId: string;
  fullName: string;
  profilePhoto: string | null;
  completedCount: number;
  totalApplicable: number;
  completionRate: number;
}

export function ChecklistLeaderboard() {
  const { data: leaderboardStats, isLoading } = useQuery({
    queryKey: ['checklist-leaderboard'],
    queryFn: async () => {
      const today = new Date();
      const monthStart = startOfMonth(today);
      const monthEnd = endOfMonth(today);
      
      // Get all days in the current month up to today
      const daysToProcess = eachDayOfInterval({
        start: monthStart,
        end: today
      });
      
      // Get all managers and admins
      const { data: managerRoles } = await supabase
        .from('user_roles')
        .select('user_id, role')
        .in('role', ['admin', 'manager']);
      
      if (!managerRoles || managerRoles.length === 0) return [];
      
      const managerIds = managerRoles.map(r => r.user_id);
      
      // Get all shifts for managers/admins this month
      const { data: shifts } = await supabase
        .from('scheduled_shifts')
        .select('user_id, start_time, end_time, shift_date')
        .in('user_id', managerIds)
        .gte('shift_date', format(monthStart, 'yyyy-MM-dd'))
        .lte('shift_date', format(today, 'yyyy-MM-dd'));
      
      // Get profiles
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, full_name, profile_photo_url')
        .in('id', managerIds);
      
      const profileMap = new Map(profiles?.map(p => [p.id, p]) || []);
      
      // Initialize manager stats
      const managerStatsMap = new Map<string, ManagerStats>();
      managerIds.forEach(id => {
        const profile = profileMap.get(id);
        if (profile) {
          managerStatsMap.set(id, {
            userId: id,
            fullName: profile.full_name || 'Unknown',
            profilePhoto: profile.profile_photo_url,
            completedCount: 0,
            totalApplicable: 0,
            completionRate: 0
          });
        }
      });
      
      // Process each day
      for (const day of daysToProcess) {
        const dayStart = startOfDay(day);
        const dayEnd = endOfDay(day);
        const dayFormatted = format(day, 'yyyy-MM-dd');
        
        // Get all checklists
        const { data: checklists } = await supabase
          .from('checklists')
          .select(`
            id,
            title,
            due_by_time,
            checklist_items(id)
          `)
          .eq('is_active', true);
        
        if (!checklists) continue;
        
        // Get shifts for this day
        const dayShifts = shifts?.filter(s => s.shift_date === dayFormatted) || [];
        
        // For each checklist, check completion and assign credit/debit
        for (const checklist of checklists) {
          const dueTime = checklist.due_by_time;
          if (!dueTime) continue;
          
          const itemCount = checklist.checklist_items?.length || 0;
          if (itemCount === 0) continue;
          
          // Check if checklist was completed on this day
          const { data: submissions } = await supabase
            .from('checklist_submissions')
            .select(`
              id,
              submitted_at
            `)
            .eq('checklist_id', checklist.id)
            .gte('submitted_at', dayStart.toISOString())
            .lte('submitted_at', dayEnd.toISOString());
          
          const submissionIds = submissions?.map(s => s.id) || [];
          let isComplete = false;
          
          if (submissionIds.length > 0) {
            const { data: responses } = await supabase
              .from('checklist_responses')
              .select('id, completed_by')
              .in('submission_id', submissionIds)
              .not('completed_by', 'is', null);
            
            const completedCount = responses?.length || 0;
            isComplete = completedCount >= itemCount;
          }
          
          // Find which managers worked during this checklist's due time
          const applicableManagers = dayShifts.filter(shift => {
            const parseTime = (timeStr: string) => {
              const [hours, minutes] = timeStr.split(':').map(Number);
              return hours * 60 + minutes;
            };
            
            const shiftStartMin = parseTime(shift.start_time);
            const shiftEndMin = parseTime(shift.end_time);
            const dueTimeMin = parseTime(dueTime);
            
            // Handle overnight shifts
            if (shiftEndMin < shiftStartMin) {
              return dueTimeMin >= shiftStartMin || dueTimeMin <= shiftEndMin;
            }
            
            return dueTimeMin >= shiftStartMin && dueTimeMin <= shiftEndMin;
          });
          
          // Award/deduct Croo Cash and update stats
          for (const shift of applicableManagers) {
            const stats = managerStatsMap.get(shift.user_id);
            if (!stats) continue;
            
            stats.totalApplicable++;
            
            if (isComplete) {
              stats.completedCount++;
              
              // Check if transaction already exists
              const { data: existingTransaction } = await supabase
                .from('croo_cash_transactions')
                .select('id')
                .eq('user_id', shift.user_id)
                .eq('shift_date', dayFormatted)
                .eq('transaction_type', 'checklist_completion')
                .eq('notes', `Completed: ${checklist.title}`)
                .maybeSingle();
              
              if (!existingTransaction) {
                // Create transaction
                await supabase
                  .from('croo_cash_transactions')
                  .insert({
                    user_id: shift.user_id,
                    amount: 25, // 0.25 dollars = 25 cents
                    transaction_type: 'checklist_completion',
                    shift_date: dayFormatted,
                    notes: `Completed: ${checklist.title}`,
                    is_weekend: day.getDay() === 0 || day.getDay() === 6
                  });
                
                // Update profile balance
                await supabase.rpc('increment_croo_cash', {
                  user_id: shift.user_id,
                  amount: 25
                });
              }
            } else {
              // Check if transaction already exists
              const { data: existingTransaction } = await supabase
                .from('croo_cash_transactions')
                .select('id')
                .eq('user_id', shift.user_id)
                .eq('shift_date', dayFormatted)
                .eq('transaction_type', 'incomplete_checklist')
                .eq('notes', `Incomplete: ${checklist.title}`)
                .maybeSingle();
              
              if (!existingTransaction) {
                // Create transaction
                await supabase
                  .from('croo_cash_transactions')
                  .insert({
                    user_id: shift.user_id,
                    amount: -25, // -0.25 dollars = -25 cents
                    transaction_type: 'incomplete_checklist',
                    shift_date: dayFormatted,
                    notes: `Incomplete: ${checklist.title}`,
                    is_weekend: day.getDay() === 0 || day.getDay() === 6
                  });
                
                // Update profile balance
                await supabase.rpc('increment_croo_cash', {
                  user_id: shift.user_id,
                  amount: -25
                });
              }
            }
          }
        }
      }
      
      // Calculate completion rates and filter out managers with no applicable checklists
      const finalStats = Array.from(managerStatsMap.values())
        .filter(stat => stat.totalApplicable > 0)
        .map(stat => ({
          ...stat,
          completionRate: (stat.completedCount / stat.totalApplicable) * 100
        }))
        .sort((a, b) => b.completionRate - a.completionRate);
      
      return finalStats;
    },
    refetchInterval: 30000, // Refresh every 30 seconds
  });
  
  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Trophy className="h-5 w-5 text-yellow-500" />
            Manager Leaderboard
          </CardTitle>
        <CardDescription>Monthly checklist completion during shifts</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-center text-muted-foreground py-4">Loading...</div>
        </CardContent>
      </Card>
    );
  }
  
  if (!leaderboardStats || leaderboardStats.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Trophy className="h-5 w-5 text-yellow-500" />
            Manager Leaderboard
          </CardTitle>
        <CardDescription>Monthly checklist completion during shifts</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-center text-muted-foreground py-4">
            No manager shifts scheduled for today
          </div>
        </CardContent>
      </Card>
    );
  }
  
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Trophy className="h-5 w-5 text-yellow-500" />
          Manager Leaderboard
        </CardTitle>
        <CardDescription>Checklist completion during shifts</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {leaderboardStats.map((stat, index) => (
            <div key={stat.userId} className="flex items-center gap-4">
              <div className="flex items-center gap-3 flex-1">
                <div className="text-lg font-bold text-muted-foreground w-6">
                  {index + 1}
                </div>
                <Avatar className="h-10 w-10">
                  <AvatarImage src={stat.profilePhoto || undefined} />
                  <AvatarFallback>
                    {stat.fullName.split(' ').map(n => n[0]).join('')}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{stat.fullName}</div>
                  <div className="text-sm text-muted-foreground">
                    {stat.completedCount} of {stat.totalApplicable} completed
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3 w-32">
                <Progress value={stat.completionRate} className="flex-1" />
                <div className="text-sm font-bold w-12 text-right">
                  {Math.round(stat.completionRate)}%
                </div>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
