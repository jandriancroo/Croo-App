import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Sparkles } from 'lucide-react';

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
  const [open, setOpen] = useState(false);
  if (!lines || lines.length === 0) return null;
  return (
    <div className="flex items-start gap-2.5 border-b border-border/60 bg-primary/5 px-4 py-2.5">
      <span className="flex shrink-0 items-center gap-1 pt-2 text-[12px] font-extrabold uppercase tracking-wide text-primary">
        <Sparkles className="h-3.5 w-3.5" /> Theo
      </span>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="relative min-w-0 flex-1 rounded-2xl rounded-tl-sm border border-primary/20 bg-card px-3.5 py-2 text-left shadow-sm"
      >
        <div className={open ? '' : 'line-clamp-2'}>
          {lines.map((l, i) => (
            <p key={i} className={`text-[14px] leading-snug text-foreground ${open ? '' : 'inline'}`}>
              {l}{!open && i < lines.length - 1 ? ' ' : ''}
            </p>
          ))}
        </div>
      </button>
    </div>
  );
}
