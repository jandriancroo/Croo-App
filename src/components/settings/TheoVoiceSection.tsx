import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

const VOICES = [
  { id: 'eve', name: 'Eve', desc: 'Default' },
  { id: 'ara', name: 'Ara', desc: '' },
  { id: 'leo', name: 'Leo', desc: '' },
  { id: 'rex', name: 'Rex', desc: '' },
  { id: 'sal', name: 'Sal', desc: '' },
];

export function TheoVoiceSection() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const { data: voice = 'eve' } = useQuery({
    queryKey: ['theo-voice-pref', user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data } = await (supabase.from as any)('theo_voice_prefs').select('voice').eq('user_id', user!.id).maybeSingle();
      return (data?.voice as string) || 'eve';
    },
  });
  const save = useMutation({
    mutationFn: async (v: string) => {
      const { error } = await (supabase.from as any)('theo_voice_prefs')
        .upsert({ user_id: user!.id, voice: v, updated_at: new Date().toISOString() });
      if (error) throw error;
    },
    onMutate: (v) => qc.setQueryData(['theo-voice-pref', user?.id], v),
    onSuccess: () => toast.success('Theo’s voice updated'),
    onError: () => { qc.invalidateQueries({ queryKey: ['theo-voice-pref', user?.id] }); toast.error('Couldn’t save the voice'); },
  });

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">Pick how Theo sounds when he talks to you. Takes effect the next time you open the voice screen.</p>
      <div className="divide-y divide-border rounded-xl border border-border">
        {VOICES.map((v) => (
          <button key={v.id} onClick={() => save.mutate(v.id)}
            className="flex w-full items-center justify-between px-3 py-3 text-left">
            <div>
              <div className="text-sm font-semibold text-foreground">{v.name}</div>
              {v.desc && <div className="text-xs text-muted-foreground">{v.desc}</div>}
            </div>
            <span className={cn('flex h-6 w-6 items-center justify-center rounded-full border',
              voice === v.id ? 'border-primary bg-primary text-primary-foreground' : 'border-border')}>
              {voice === v.id && <Check className="h-3.5 w-3.5" />}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
