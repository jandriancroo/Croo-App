import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { getDayOfWeekInTimezone } from '@/utils/timezoneUtils';
import { useLocationTimezone } from '@/hooks/useLocationTimezone';

interface Checklist {
  id: string;
  frequency: string;
  template_type: string | null;
}

interface CompletionEntry {
  expected: number;
  completed: number;
}

/**
 * Fetches checklist completion data using React Query for caching.
 * Returns getCompletionData(checklistId) helper function.
 */
export function useChecklistCompletion(
  checklists: Checklist[],
  locationId: string | undefined,
) {
  const { timezone, getBusinessDateInTimezone, getBusinessDayRangeInTimezone, loading: timezoneLoading } = useLocationTimezone();

  const { data: completionData = {} } = useQuery({
    queryKey: ['checklist-completion', locationId, checklists.map(c => c.id).join(',')],
    queryFn: async (): Promise<Record<string, CompletionEntry>> => {
      if (!checklists.length || !locationId) return {};

      const businessDateStr = getBusinessDateInTimezone();
      const currentDay = getDayOfWeekInTimezone(timezone);
      const { start: periodStartBusiness, end: periodEndBusiness } = getBusinessDayRangeInTimezone(businessDateStr);

      // Monthly period
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
      const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

      const checklistIds = checklists.map(c => c.id);
      const dailyChecklistIds = checklists.filter(c => c.frequency !== 'monthly').map(c => c.id);
      const monthlyChecklistIds = checklists.filter(c => c.frequency === 'monthly').map(c => c.id);

      // ALL 3 QUERIES IN PARALLEL
      const [
        { data: allChecklistItems },
        { data: dailyResponses },
        { data: monthlyResponses }
      ] = await Promise.all([
        supabase
          .from('checklist_items')
          .select('id, checklist_id, days_of_week')
          .in('checklist_id', checklistIds),
        dailyChecklistIds.length > 0
          ? supabase
              .from('checklist_responses')
              .select(`
                id,
                item_id,
                created_at,
                checklist_submissions!inner(id, checklist_id, location_id)
              `)
              .in('checklist_submissions.checklist_id', dailyChecklistIds)
              .eq('checklist_submissions.location_id', locationId)
              .gte('created_at', periodStartBusiness.toISOString())
              .lte('created_at', periodEndBusiness.toISOString())
          : Promise.resolve({ data: [] as any[] }),
        monthlyChecklistIds.length > 0
          ? supabase
              .from('checklist_responses')
              .select(`
                id,
                item_id,
                created_at,
                checklist_submissions!inner(id, checklist_id, location_id)
              `)
              .in('checklist_submissions.checklist_id', monthlyChecklistIds)
              .eq('checklist_submissions.location_id', locationId)
              .gte('created_at', monthStart.toISOString())
              .lte('created_at', monthEnd.toISOString())
          : Promise.resolve({ data: [] as any[] }),
      ]);

      const allResponses = [...(dailyResponses || []), ...(monthlyResponses || [])];

      // Group items by checklist_id
      const itemsByChecklist = new Map<string, typeof allChecklistItems>();
      allChecklistItems?.forEach(item => {
        const existing = itemsByChecklist.get(item.checklist_id) || [];
        existing.push(item);
        itemsByChecklist.set(item.checklist_id, existing);
      });

      // Group responses by checklist_id
      const responsesByChecklist = new Map<string, typeof allResponses>();
      allResponses?.forEach((response: any) => {
        const checklistId = response.checklist_submissions?.checklist_id;
        if (checklistId) {
          const existing = responsesByChecklist.get(checklistId) || [];
          existing.push(response);
          responsesByChecklist.set(checklistId, existing);
        }
      });

      const dataMap: Record<string, CompletionEntry> = {};

      for (const checklist of checklists) {
        const checklistItems = itemsByChecklist.get(checklist.id) || [];
        let itemCount = checklistItems.length;

        if (checklist.template_type === 'dynamic') {
          itemCount = checklistItems.filter(item => item.days_of_week && item.days_of_week.includes(currentDay)).length;
        }

        const isMonthly = checklist.frequency === 'monthly';
        const periodStart = isMonthly ? monthStart : periodStartBusiness;
        const periodEnd = isMonthly ? monthEnd : periodEndBusiness;

        const responses = (responsesByChecklist.get(checklist.id) || []).filter((r: any) => {
          const createdAt = new Date(r.created_at);
          return createdAt >= periodStart && createdAt <= periodEnd;
        });

        const todayItemIds = checklist.template_type === 'dynamic'
          ? new Set(checklistItems.filter(item => item.days_of_week && item.days_of_week.includes(currentDay)).map(item => item.id))
          : null;

        const uniqueItemIds = new Set();
        responses.forEach((response: any) => {
          if (response.item_id) {
            if (todayItemIds === null || todayItemIds.has(response.item_id)) {
              uniqueItemIds.add(response.item_id);
            }
          }
        });

        dataMap[checklist.id] = {
          expected: itemCount,
          completed: uniqueItemIds.size
        };
      }

      return dataMap;
    },
    enabled: !timezoneLoading && checklists.length > 0 && !!locationId,
    staleTime: 30 * 1000, // 30s cache — completion data changes when user submits
    placeholderData: (prev) => prev,
  });

  const getCompletionData = (checklistId: string): CompletionEntry => {
    return completionData[checklistId] || { expected: 0, completed: 0 };
  };

  return { completionData, getCompletionData };
}
