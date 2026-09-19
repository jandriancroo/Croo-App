import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plug, Save } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';

export const POS_OPTIONS = [
  { key: 'none', label: 'None' },
  { key: 'qubeyond', label: 'QuBeyond' },
  { key: 'clover', label: 'Clover' },
  { key: 'aloha', label: 'Aloha' },
] as const;

export const SUPPORTING_INTEGRATIONS = [
  { key: 'pfg', label: 'PFG', description: 'Food ordering' },
  { key: 'produce_alliance', label: 'Produce Alliance', description: 'Produce orders and pricing' },
  { key: 'ovation', label: 'OvationUp', description: 'Guest reviews and feedback' },
] as const;

type PosKey = typeof POS_OPTIONS[number]['key'];
type SupportingKey = typeof SUPPORTING_INTEGRATIONS[number]['key'];

export function BrandIntegrationSettings({ brandId }: { brandId: string }) {
  const queryClient = useQueryClient();
  const [primaryPos, setPrimaryPos] = useState<PosKey>('none');
  const [supporting, setSupporting] = useState<Record<SupportingKey, boolean>>({
    pfg: false,
    produce_alliance: false,
    ovation: false,
  });
  const [isSaving, setIsSaving] = useState(false);

  const { data: policies = [], isLoading } = useQuery({
    queryKey: ['brand-integration-policies', brandId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('brand_integration_policies')
        .select('integration_key, category, is_enabled')
        .eq('brand_id', brandId);
      if (error) throw error;
      return data;
    },
  });

  useEffect(() => {
    const selectedPos = policies.find((policy) => policy.category === 'pos' && policy.is_enabled)?.integration_key;
    setPrimaryPos((selectedPos as PosKey | undefined) ?? 'none');
    setSupporting({
      pfg: policies.some((policy) => policy.integration_key === 'pfg' && policy.is_enabled),
      produce_alliance: policies.some((policy) => policy.integration_key === 'produce_alliance' && policy.is_enabled),
      ovation: policies.some((policy) => policy.integration_key === 'ovation' && policy.is_enabled),
    });
  }, [policies]);

  const save = async () => {
    setIsSaving(true);
    try {
      const rows = [
        ...POS_OPTIONS.filter((option) => option.key !== 'none').map((option) => ({
          brand_id: brandId,
          integration_key: option.key,
          category: 'pos',
          is_enabled: primaryPos === option.key,
        })),
        ...SUPPORTING_INTEGRATIONS.map((option) => ({
          brand_id: brandId,
          integration_key: option.key,
          category: option.key === 'ovation' ? 'guest_feedback' : 'vendor',
          is_enabled: supporting[option.key],
        })),
      ];

      const { error } = await supabase
        .from('brand_integration_policies')
        .upsert(rows, { onConflict: 'brand_id,integration_key' });
      if (error) throw error;

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['brand-integration-policies', brandId] }),
        queryClient.invalidateQueries({ queryKey: ['brands-management'] }),
      ]);
      toast.success('Brand integrations updated');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not update brand integrations');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-4 border-t pt-4">
      <div className="flex items-center gap-2">
        <Plug className="h-4 w-4 text-muted-foreground" />
        <Label className="font-semibold">Integrations</Label>
      </div>

      <div className="space-y-2">
        <Label htmlFor="brand-primary-pos">Primary sales system</Label>
        <Select value={primaryPos} onValueChange={(value) => setPrimaryPos(value as PosKey)} disabled={isLoading}>
          <SelectTrigger id="brand-primary-pos">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {POS_OPTIONS.map((option) => (
              <SelectItem key={option.key} value={option.key}>{option.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">Only this sales system appears in store settings.</p>
      </div>

      <div className="space-y-3">
        {SUPPORTING_INTEGRATIONS.map((option) => (
          <div key={option.key} className="flex items-center justify-between gap-4">
            <div>
              <Label htmlFor={`brand-integration-${option.key}`}>{option.label}</Label>
              <p className="text-xs text-muted-foreground">{option.description}</p>
            </div>
            <Switch
              id={`brand-integration-${option.key}`}
              checked={supporting[option.key]}
              onCheckedChange={(checked) => setSupporting((current) => ({ ...current, [option.key]: checked }))}
              disabled={isLoading}
            />
          </div>
        ))}
      </div>

      <Button type="button" variant="secondary" className="w-full" onClick={save} disabled={isLoading || isSaving}>
        <Save className="h-4 w-4 mr-2" />
        {isSaving ? 'Saving integrations…' : 'Save integrations'}
      </Button>
    </div>
  );
}