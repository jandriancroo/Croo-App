import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Progress } from "@/components/ui/progress";
import { Trophy } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { format, startOfMonth, endOfMonth, eachDayOfInterval, startOfDay, endOfDay } from "date-fns";
import { useLocation as useAppLocation } from "@/hooks/useLocation";

interface ManagerStats {
  userId: string;
  fullName: string;
  profilePhoto: string | null;
  completedCount: number;
  totalApplicable: number;
  completionRate: number;
}

export function ChecklistLeaderboard() {
  const { currentLocation } = useAppLocation();
  const { data: leaderboardStats, isLoading } = useQuery({
    queryKey: ['checklist-leaderboard', currentLocation?.id],
    queryFn: async () => {
      if (!currentLocation?.id) return [];
      
      const today = new Date();
      const monthStart = startOfMonth(today);
      
      // Get users assigned to this location
      const { data: locationUsers } = await supabase
        .from('user_locations')
        .select('user_id')
        .eq('location_id', currentLocation.id);
      
      if (!locationUsers || locationUsers.length === 0) return [];
      const locationUserIds = locationUsers.map(u => u.user_id);
      
      // Get all managers at this location (not admins)
      const { data: managerRoles } = await supabase
        .from('user_roles')
        .select('user_id, role')
        .in('role', ['manager', 'shift_manager', 'general_manager'])
        .in('user_id', locationUserIds);
      
      if (!managerRoles || managerRoles.length === 0) return [];
      
      const managerIds = managerRoles.map(r => r.user_id);
      
      // Fetch all data in bulk queries
      const [shiftsRes, profilesRes, checklistsRes, submissionsRes, existingTransactionsRes] = await Promise.all([
        // Get all shifts for managers/admins this month
        supabase
          .from('scheduled_shifts')
          .select('user_id, start_time, end_time, shift_date')
          .in('user_id', managerIds)
          .gte('shift_date', format(monthStart, 'yyyy-MM-dd'))
          .lte('shift_date', format(today, 'yyyy-MM-dd')),
        
        // Get profiles
        supabase
          .from('profiles')
          .select('id, full_name, profile_photo_url')
          .in('id', managerIds),
        
        // Get all checklists for this location
        supabase
          .from('checklists')
          .select('id, title, due_by_time, checklist_items(id)')
          .eq('is_active', true)
          .eq('location_id', currentLocation.id),
        
        // Get all submissions for the month at this location
        supabase
          .from('checklist_submissions')
          .select('id, checklist_id, submitted_at')
          .eq('location_id', currentLocation.id)
          .gte('submitted_at', startOfDay(monthStart).toISOString())
          .lte('submitted_at', endOfDay(today).toISOString()),
        
        // Get existing transactions to avoid duplicates
        supabase
          .from('croo_cash_transactions')
          .select('user_id, shift_date, transaction_type, notes')
          .gte('shift_date', format(monthStart, 'yyyy-MM-dd'))
          .lte('shift_date', format(today, 'yyyy-MM-dd'))
          .in('transaction_type', ['checklist_completion', 'incomplete_checklist'])
      ]);
      
      const shifts = shiftsRes.data || [];
      const profiles = profilesRes.data || [];
      const checklists = checklistsRes.data || [];
      const submissions = submissionsRes.data || [];
      const existingTransactions = existingTransactionsRes.data || [];
      
      // Get all submission IDs for responses query
      const submissionIds = submissions.map(s => s.id);
      let responses: any[] = [];
      
      if (submissionIds.length > 0) {
        const { data: responsesData } = await supabase
          .from('checklist_responses')
          .select('id, submission_id, completed_by')
          .in('submission_id', submissionIds)
          .not('completed_by', 'is', null);
        
        responses = responsesData || [];
      }
      
      const profileMap = new Map(profiles.map(p => [p.id, p]));
      
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
      
      // Create lookup maps
      // Use simpler key: user + date + checklist title (extracted from notes)
      const existingTransactionKeys = new Set(
        existingTransactions.map(t => `${t.user_id}-${t.shift_date}-${t.notes?.split(': ')[1] || ''}`)
      );
      
      // Group submissions by date and checklist
      const submissionsByDateAndChecklist = new Map<string, any[]>();
      submissions.forEach(sub => {
        const date = format(new Date(sub.submitted_at), 'yyyy-MM-dd');
        const key = `${date}-${sub.checklist_id}`;
        if (!submissionsByDateAndChecklist.has(key)) {
          submissionsByDateAndChecklist.set(key, []);
        }
        submissionsByDateAndChecklist.get(key)!.push(sub);
      });
      
      // Group responses by submission
      const responsesBySubmission = new Map<string, any[]>();
      responses.forEach(resp => {
        if (!responsesBySubmission.has(resp.submission_id)) {
          responsesBySubmission.set(resp.submission_id, []);
        }
        responsesBySubmission.get(resp.submission_id)!.push(resp);
      });
      
      // Group shifts by date
      const shiftsByDate = new Map<string, any[]>();
      shifts.forEach(shift => {
        if (!shiftsByDate.has(shift.shift_date)) {
          shiftsByDate.set(shift.shift_date, []);
        }
        shiftsByDate.get(shift.shift_date)!.push(shift);
      });
      
      // Batch transactions to create
      const transactionsToCreate: any[] = [];
      
      // Process all days
      const daysToProcess = eachDayOfInterval({ start: monthStart, end: today });
      
      for (const day of daysToProcess) {
        const dayFormatted = format(day, 'yyyy-MM-dd');
        const dayShifts = shiftsByDate.get(dayFormatted) || [];
        // Weekend = Friday (5), Saturday (6), Sunday (0) - but checklist amounts don't change
        const isWeekend = day.getDay() === 0 || day.getDay() === 5 || day.getDay() === 6;
        
        // Process each checklist
        for (const checklist of checklists) {
          const dueTime = checklist.due_by_time;
          if (!dueTime) continue;
          
          const itemCount = checklist.checklist_items?.length || 0;
          if (itemCount === 0) continue;
          
          // Check completion for this day
          const daySubmissions = submissionsByDateAndChecklist.get(`${dayFormatted}-${checklist.id}`) || [];
          
          let completedItemCount = 0;
          for (const sub of daySubmissions) {
            const subResponses = responsesBySubmission.get(sub.id) || [];
            completedItemCount += subResponses.length;
          }
          
          const isComplete = completedItemCount >= itemCount;
          
          // Find managers working during due time
          const parseTime = (timeStr: string) => {
            const [hours, minutes] = timeStr.split(':').map(Number);
            return hours * 60 + minutes;
          };
          
          const dueTimeMin = parseTime(dueTime);
          
          const applicableManagers = dayShifts.filter(shift => {
            const shiftStartMin = parseTime(shift.start_time);
            const shiftEndMin = parseTime(shift.end_time);
            
            if (shiftEndMin < shiftStartMin) {
              return dueTimeMin >= shiftStartMin || dueTimeMin <= shiftEndMin;
            }
            
            return dueTimeMin >= shiftStartMin && dueTimeMin <= shiftEndMin;
          });
          
          // Update stats and queue transactions
          for (const shift of applicableManagers) {
            const stats = managerStatsMap.get(shift.user_id);
            if (!stats) continue;
            
            stats.totalApplicable++;
            
            const transactionType = isComplete ? 'checklist_completion' : 'incomplete_checklist';
            const amount = isComplete ? 25 : -25; // $0.25 for checklists (stored in cents)
            const notes = isComplete ? `Completed: ${checklist.title}` : `Incomplete: ${checklist.title}`;
            // Simple key: user + date + checklist title
            const transactionKey = `${shift.user_id}-${dayFormatted}-${checklist.title}`;
            
            if (isComplete) {
              stats.completedCount++;
            }
            
            // Only create transaction if it doesn't exist
            if (!existingTransactionKeys.has(transactionKey)) {
              transactionsToCreate.push({
                user_id: shift.user_id,
                amount,
                transaction_type: transactionType,
                shift_date: dayFormatted,
                notes,
                is_weekend: isWeekend
              });
            }
          }
        }
      }
      
      // Batch insert all new transactions
      if (transactionsToCreate.length > 0) {
        await supabase.from('croo_cash_transactions').insert(transactionsToCreate);
        
        // Update all balances in one query per user
        const balanceUpdates = new Map<string, number>();
        transactionsToCreate.forEach(t => {
          balanceUpdates.set(t.user_id, (balanceUpdates.get(t.user_id) || 0) + t.amount);
        });
        
        for (const [userId, amount] of balanceUpdates) {
          await supabase.rpc('increment_croo_cash', { user_id: userId, amount });
        }
      }
      
      // Calculate completion rates
      const finalStats = Array.from(managerStatsMap.values())
        .filter(stat => stat.totalApplicable > 0)
        .map(stat => ({
          ...stat,
          completionRate: (stat.completedCount / stat.totalApplicable) * 100
        }))
        .sort((a, b) => b.completionRate - a.completionRate);
      
      return finalStats;
    },
    refetchInterval: 60000,
    enabled: !!currentLocation?.id,
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
        <CardContent className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex items-center gap-3">
              <Skeleton className="h-10 w-10 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-2 w-full" />
              </div>
            </div>
          ))}
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
