import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { getDayOfWeekInTimezone } from '@/utils/timezoneUtils';
import { useLocationTimezone } from '@/hooks/useLocationTimezone';
import { getScorePeriodStart, isItemExpectedInPeriod } from '@/utils/checklistArchivePeriod';

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
          .select('id, checklist_id, days_of_week, item_type, order_index')
          .is('deleted_at', null)
          .in('checklist_id', checklistIds),
        dailyChecklistIds.length > 0
          ? supabase
              .from('checklist_responses')
              .select(`
                id,
                item_id,
                created_at,
                checklist_submissions!inner(id, checklist_id, location_id, submitted_at)
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
                checklist_submissions!inner(id, checklist_id, location_id, submitted_at)
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
        const cs = response.checklist_submissions;
        const checklistId = Array.isArray(cs) ? cs[0]?.checklist_id : cs?.checklist_id;
        if (checklistId) {
          const existing = responsesByChecklist.get(checklistId) || [];
          existing.push(response);
          responsesByChecklist.set(checklistId, existing);
        }
      });

      const dataMap: Record<string, CompletionEntry> = {};

      for (const checklist of checklists) {
        const checklistItems = (itemsByChecklist.get(checklist.id) || []) as any[];

        // Compute per-item section anchor (max order_index of preceding section_header)
        const sortedItems = [...checklistItems].sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0));
        let runningAnchor: number | null = null;
        const anchorByItemId = new Map<string, number | null>();
        for (const it of sortedItems) {
          if (it.item_type === 'section_header') {
            runningAnchor = it.order_index ?? null;
          }
          anchorByItemId.set(it.id, it.item_type === 'section_header' ? (it.order_index ?? null) : runningAnchor);
        }

        // Day filter for dynamic checklists (headers always count regardless of day)
        const isDynamic = checklist.template_type === 'dynamic';
        const inScope = (it: any) =>
          it.item_type === 'section_header' ||
          !isDynamic ||
          (it.days_of_week && it.days_of_week.includes(currentDay));

        const scoped = sortedItems.filter(inScope);
        const itemCount = scoped.length;

        const isMonthly = checklist.frequency === 'monthly';
        const periodStart = isMonthly ? monthStart : periodStartBusiness;
        const periodEnd = isMonthly ? monthEnd : periodEndBusiness;

        const responses = (responsesByChecklist.get(checklist.id) || []).filter((r: any) => {
          const createdAt = new Date(r.created_at);
          return createdAt >= periodStart && createdAt <= periodEnd;
        });

        const answeredItemIds = new Set<string>();
        responses.forEach((r: any) => { if (r.item_id) answeredItemIds.add(r.item_id); });

        // Sections complete = any non-header item in that section answered
        const completedSectionAnchors = new Set<number>();
        for (const it of scoped) {
          if (it.item_type !== 'section_header' && answeredItemIds.has(it.id)) {
            const a = anchorByItemId.get(it.id);
            if (a != null) completedSectionAnchors.add(a);
          }
        }

        let completedCount = 0;
        for (const it of scoped) {
          if (it.item_type === 'section_header') {
            if (it.order_index != null && completedSectionAnchors.has(it.order_index)) completedCount++;
          } else if (answeredItemIds.has(it.id)) {
            completedCount++;
          }
        }

        dataMap[checklist.id] = {
          expected: itemCount,
          completed: completedCount
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
