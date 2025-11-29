import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Progress } from "@/components/ui/progress";
import { Trophy } from "lucide-react";
import { format, startOfDay, endOfDay } from "date-fns";

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
      const todayStart = startOfDay(today);
      const todayEnd = endOfDay(today);
      
      // Get all managers and admins
      const { data: managerRoles } = await supabase
        .from('user_roles')
        .select('user_id, role')
        .in('role', ['admin', 'manager']);
      
      if (!managerRoles || managerRoles.length === 0) return [];
      
      const managerIds = managerRoles.map(r => r.user_id);
      
      // Get shifts for managers/admins today
      const { data: shifts } = await supabase
        .from('scheduled_shifts')
        .select('user_id, start_time, end_time, shift_date')
        .in('user_id', managerIds)
        .eq('shift_date', format(today, 'yyyy-MM-dd'));
      
      // Get all checklists with their completion status
      const { data: checklists } = await supabase
        .from('checklists')
        .select(`
          id,
          title,
          due_by_time,
          checklist_items(id),
          checklist_submissions!inner(
            id,
            submitted_at
          )
        `)
        .eq('is_active', true)
        .gte('checklist_submissions.submitted_at', todayStart.toISOString())
        .lte('checklist_submissions.submitted_at', todayEnd.toISOString());
      
      // Get checklist responses to calculate completion
      const checklistIds = checklists?.map(c => c.id) || [];
      const { data: allResponses } = await supabase
        .from('checklist_responses')
        .select('item_id, submission_id, completed_by')
        .in('submission_id', checklists?.flatMap(c => c.checklist_submissions.map(s => s.id)) || [])
        .not('completed_by', 'is', null);
      
      // Build completion map
      const checklistCompletionMap = new Map<string, { completed: number; total: number }>();
      checklists?.forEach(checklist => {
        const itemCount = checklist.checklist_items?.length || 0;
        const submissionIds = checklist.checklist_submissions.map(s => s.id);
        const completedCount = allResponses?.filter(r => submissionIds.includes(r.submission_id)).length || 0;
        
        checklistCompletionMap.set(checklist.id, {
          completed: Math.min(completedCount, itemCount),
          total: itemCount
        });
      });
      
      // Get profiles
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, full_name, profile_photo_url')
        .in('id', managerIds);
      
      const profileMap = new Map(profiles?.map(p => [p.id, p]) || []);
      
      // Calculate stats for each manager
      const managerStats: ManagerStats[] = [];
      
      for (const managerId of managerIds) {
        const profile = profileMap.get(managerId);
        if (!profile) continue;
        
        const managerShifts = shifts?.filter(s => s.user_id === managerId) || [];
        
        let totalApplicable = 0;
        let completedCount = 0;
        
        // Check each checklist
        checklists?.forEach(checklist => {
          const dueTime = checklist.due_by_time;
          if (!dueTime) return;
          
          // Determine if this checklist applies to any of the manager's shifts
          const applies = managerShifts.some(shift => {
            const shiftStart = shift.start_time;
            const shiftEnd = shift.end_time;
            
            // Parse times (assuming HH:MM:SS format)
            const parseTime = (timeStr: string) => {
              const [hours, minutes] = timeStr.split(':').map(Number);
              return hours * 60 + minutes;
            };
            
            const shiftStartMin = parseTime(shiftStart);
            const shiftEndMin = parseTime(shiftEnd);
            const dueTimeMin = parseTime(dueTime);
            
            // Handle overnight shifts
            if (shiftEndMin < shiftStartMin) {
              // Shift crosses midnight
              return dueTimeMin >= shiftStartMin || dueTimeMin <= shiftEndMin;
            }
            
            // Normal shift - check if due time falls within shift
            return dueTimeMin >= shiftStartMin && dueTimeMin <= shiftEndMin;
          });
          
          if (applies) {
            totalApplicable++;
            const completion = checklistCompletionMap.get(checklist.id);
            if (completion && completion.completed === completion.total && completion.total > 0) {
              completedCount++;
            }
          }
        });
        
        if (totalApplicable > 0) {
          managerStats.push({
            userId: managerId,
            fullName: profile.full_name || 'Unknown',
            profilePhoto: profile.profile_photo_url,
            completedCount,
            totalApplicable,
            completionRate: (completedCount / totalApplicable) * 100
          });
        }
      }
      
      // Sort by completion rate descending
      return managerStats.sort((a, b) => b.completionRate - a.completionRate);
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
          <CardDescription>Checklist completion during shifts</CardDescription>
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
          <CardDescription>Checklist completion during shifts</CardDescription>
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
