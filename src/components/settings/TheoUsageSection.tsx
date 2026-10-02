import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { DateTime } from 'luxon';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';
import { Loader2 } from 'lucide-react';

type Row = {
  user_id: string; user_name: string; location_id: string; location_name: string | null;
  chat_questions: number; voice_sessions: number; voice_seconds: number; voice_questions: number; last_used: string | null;
};

const RANGES = [
  { id: '7', label: '7 days', days: 7 },
  { id: '30', label: '30 days', days: 30 },
  { id: '90', label: '90 days', days: 90 },
];
// Grok live voice is billed per minute ($0.08/min, xAI pricing page, Oct 2026).
const VOICE_PER_MIN = 0.08;

const mins = (s: number) => (s >= 60 ? `${Math.round(s / 60)} min` : s > 0 ? `${s}s` : '—');
const money = (n: number) => `$${n.toFixed(2)}`;

export function TheoUsageSection() {
  const [range, setRange] = useState('30');
  const [view, setView] = useState<'store' | 'person'>('store');
  const days = RANGES.find((r) => r.id === range)!.days;
  const end = DateTime.now().setZone('America/Los_Angeles').toFormat('yyyy-MM-dd');
  const start = DateTime.now().setZone('America/Los_Angeles').minus({ days: days - 1 }).toFormat('yyyy-MM-dd');

  const { data = [], isLoading, error } = useQuery({
    queryKey: ['theo-usage', start, end],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)('get_theo_usage', { _start: start, _end: end });
      if (error) throw error;
      return (data || []) as Row[];
    },
    staleTime: 60_000,
  });

  const stores = useMemo(() => {
    const m = new Map<string, { name: string; people: Set<string>; chat: number; sessions: number; secs: number }>();
    data.forEach((r) => {
      const s = m.get(r.location_id) || { name: r.location_name || 'Unknown', people: new Set(), chat: 0, sessions: 0, secs: 0 };
      s.people.add(r.user_id); s.chat += Number(r.chat_questions); s.sessions += Number(r.voice_sessions); s.secs += Number(r.voice_seconds);
      m.set(r.location_id, s);
    });
    return [...m.values()].sort((a, b) => b.chat + b.sessions - (a.chat + a.sessions));
  }, [data]);

  const people = useMemo(
    () => [...data].sort((a, b) => Number(b.chat_questions) + Number(b.voice_sessions) - (Number(a.chat_questions) + Number(a.voice_sessions))),
    [data],
  );

  const totals = stores.reduce((t, s) => ({ chat: t.chat + s.chat, sessions: t.sessions + s.sessions, secs: t.secs + s.secs }), { chat: 0, sessions: 0, secs: 0 });

  const Pill = ({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) => (
    <button onClick={onClick} className={cn('rounded-full px-3 py-1.5 text-xs font-semibold transition-colors', active ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground')}>
      {children}
    </button>
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {RANGES.map((r) => <Pill key={r.id} active={range === r.id} onClick={() => setRange(r.id)}>{r.label}</Pill>)}
      </div>

      <div className="grid grid-cols-3 gap-2">
        {[
          { l: 'Typed questions', v: totals.chat.toLocaleString() },
          { l: 'Voice talks', v: `${totals.sessions} · ${mins(totals.secs)}` },
          { l: 'Est. voice cost', v: money((totals.secs / 60) * VOICE_PER_MIN) },
        ].map((t) => (
          <div key={t.l} className="rounded-xl bg-muted/50 px-3 py-2.5">
            <div className="text-[11px] font-semibold text-muted-foreground">{t.l}</div>
            <div className="text-base font-bold tabular-nums text-foreground">{t.v}</div>
          </div>
        ))}
      </div>

      <div className="flex gap-1.5">
        <Pill active={view === 'store'} onClick={() => setView('store')}>By store</Pill>
        <Pill active={view === 'person'} onClick={() => setView('person')}>By person</Pill>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
      ) : error ? (
        <p className="text-sm text-destructive">Couldn't load Theo usage.</p>
      ) : data.length === 0 ? (
        <p className="text-sm text-muted-foreground">No one used Theo in this period.</p>
      ) : view === 'store' ? (
        <div className="divide-y divide-border rounded-xl border border-border">
          {stores.map((s) => (
            <div key={s.name} className="flex items-center justify-between gap-2 px-3 py-2.5">
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-foreground">{s.name}</div>
                <div className="text-xs text-muted-foreground">{s.people.size} {s.people.size === 1 ? 'person' : 'people'}</div>
              </div>
              <div className="text-right text-xs tabular-nums text-muted-foreground">
                <div><span className="font-semibold text-foreground">{s.chat}</span> typed · <span className="font-semibold text-foreground">{s.sessions}</span> voice ({mins(s.secs)})</div>
                <div>{money((s.secs / 60) * VOICE_PER_MIN)} voice</div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="divide-y divide-border rounded-xl border border-border">
          {people.map((r) => (
            <div key={r.user_id + r.location_id} className="flex items-center justify-between gap-2 px-3 py-2.5">
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-foreground">{r.user_name}</div>
                <div className="truncate text-xs text-muted-foreground">
                  {r.location_name || 'Unknown'}{r.last_used ? ` · last ${DateTime.fromISO(r.last_used).setZone('America/Los_Angeles').toFormat('MMM d, h:mm a')}` : ''}
                </div>
              </div>
              <div className="text-right text-xs tabular-nums text-muted-foreground">
                <div><span className="font-semibold text-foreground">{r.chat_questions}</span> typed</div>
                <div><span className="font-semibold text-foreground">{r.voice_sessions}</span> voice · {mins(Number(r.voice_seconds))}</div>
              </div>
            </div>
          ))}
        </div>
      )}
      <p className="text-[11px] text-muted-foreground">Voice cost is an estimate at $0.08 per minute. Voice tracking started Oct 1, 2026.</p>
    </div>
  );
}
