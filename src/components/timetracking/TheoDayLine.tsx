import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

/** Theo's up-to-2 coaching notes for each finished day, cached server-side. */
export function useTheoDayInsights(locationId: string, dates: string[]) {
  const key = [...dates].sort().join(',');
  return useQuery({
    queryKey: ['theo-day-insights', locationId, key],
    enabled: !!locationId && dates.length > 0,
    staleTime: 30 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke('theo-day-insights', {
        body: { location_id: locationId, dates },
      });
      if (error) throw error;
      return (data?.insights ?? {}) as Record<string, string[]>;
    },
  });
}

export function TheoDayLine({ lines }: { lines?: string[] }) {
  if (!lines || lines.length === 0) return null;
  return (
    <div className="flex items-start gap-2.5 border-b border-border/60 bg-primary/5 px-4 py-2.5">
      <span className="shrink-0 pt-2 text-[12px] font-extrabold uppercase tracking-wide text-primary">Theo</span>
      <div className="relative min-w-0 flex-1 rounded-2xl rounded-tl-sm border border-primary/20 bg-card px-3.5 py-2 shadow-sm">
        {lines.map((l, i) => (
          <p key={i} className="text-[14px] leading-snug text-foreground">{l}</p>
        ))}
      </div>
    </div>
  );
}
