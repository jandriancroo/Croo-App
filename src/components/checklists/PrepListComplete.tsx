import { useEffect, useState, useMemo, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Loader2, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ALL_CONTAINERS } from '@/components/inventory/PanSizesSection';

interface RowMeta {
  by_id: string | null;
  by_name: string | null;
  at: string | null;
}


export interface PrepRowDef {
  id: string;
  inventory_item_id: string | null;
  item_name: string;
  unit: string | null;
  pan_key: string | null;
  par: number | null;
  order_index: number;
}

export interface PrepCompletion {
  prep_row_id: string;
  on_hand: number | null;
  prep_amount: number | null; // when par is null we store free-text in prep_note
  prep_note: string | null;
}

interface Props {
  itemId: string;
  submissionId: string | null;
  locationId: string | null;
  businessDate: string | null;
  userId: string | null;
  onAllFilledChange: (filled: boolean) => void;
}

const debouncers: Record<string, ReturnType<typeof setTimeout>> = {};

export function PrepListComplete({
  itemId,
  submissionId,
  locationId,
  businessDate,
  userId,
  onAllFilledChange,
}: Props) {
  const [rows, setRows] = useState<PrepRowDef[]>([]);
  const [loading, setLoading] = useState(true);
  const [values, setValues] = useState<Record<string, { on_hand: string; note: string }>>({});

  // Load row config
  useEffect(() => {
    let cancel = false;
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from('checklist_prep_rows')
        .select('*')
        .eq('checklist_item_id', itemId)
        .order('order_index');
      if (cancel) return;
      setRows((data || []) as PrepRowDef[]);
      setLoading(false);
    })();
    return () => {
      cancel = true;
    };
  }, [itemId]);

  // Load existing completions
  useEffect(() => {
    if (!submissionId) return;
    let cancel = false;
    (async () => {
      const { data } = await supabase
        .from('checklist_prep_completions')
        .select('prep_row_id, on_hand, prep_amount')
        .eq('submission_id', submissionId)
        .eq('checklist_item_id', itemId);
      if (cancel) return;
      const next: Record<string, { on_hand: string; note: string }> = {};
      (data || []).forEach((c: any) => {
        next[c.prep_row_id] = {
          on_hand: c.on_hand != null ? String(c.on_hand) : '',
          note: c.prep_amount == null && c.on_hand != null ? '' : '',
        };
      });
      setValues(next);
    })();
    return () => {
      cancel = true;
    };
  }, [submissionId, itemId]);

  const allFilled = useMemo(() => {
    if (rows.length === 0) return false;
    return rows.every((r) => {
      const v = values[r.id];
      return v && v.on_hand !== '' && !Number.isNaN(Number(v.on_hand));
    });
  }, [rows, values]);

  useEffect(() => {
    onAllFilledChange(allFilled);
  }, [allFilled, onAllFilledChange]);

  const persist = useCallback(
    async (row: PrepRowDef, onHandStr: string) => {
      if (!submissionId || !userId) return;
      const onHand = onHandStr === '' ? null : Number(onHandStr);
      if (onHand !== null && !Number.isFinite(onHand)) return;
      const prep =
        onHand != null && row.par != null ? Math.max(0, Number(row.par) - onHand) : null;

      // Upsert by (submission_id, checklist_item_id, prep_row_id)
      const { data: existing } = await supabase
        .from('checklist_prep_completions')
        .select('id')
        .eq('submission_id', submissionId)
        .eq('checklist_item_id', itemId)
        .eq('prep_row_id', row.id)
        .maybeSingle();

      const payload = {
        submission_id: submissionId,
        checklist_item_id: itemId,
        prep_row_id: row.id,
        inventory_item_id: row.inventory_item_id,
        location_id: locationId,
        item_name: row.item_name,
        unit: row.unit,
        pan_key: row.pan_key,
        par_at_time: row.par,
        on_hand: onHand,
        prep_amount: prep,
        completed_by: userId,
        business_date: businessDate,
      };

      if (existing?.id) {
        await supabase.from('checklist_prep_completions').update(payload).eq('id', existing.id);
      } else {
        await supabase.from('checklist_prep_completions').insert(payload);
      }
    },
    [submissionId, itemId, locationId, businessDate, userId],
  );

  // Also mirror "filled" state into checklist_responses so the master completion calc treats it as answered
  useEffect(() => {
    if (!submissionId || !userId) return;
    const sentinel = allFilled ? 'prep_list_complete' : '';
    const handle = setTimeout(async () => {
      const { data: existing } = await supabase
        .from('checklist_responses')
        .select('id')
        .eq('submission_id', submissionId)
        .eq('item_id', itemId)
        .maybeSingle();
      if (allFilled) {
        if (existing?.id) {
          await supabase
            .from('checklist_responses')
            .update({ response_text: sentinel, completed_by: userId })
            .eq('id', existing.id);
        } else {
          await supabase.from('checklist_responses').insert({
            submission_id: submissionId,
            item_id: itemId,
            response_text: sentinel,
            completed_by: userId,
          });
        }
      } else if (existing?.id) {
        await supabase.from('checklist_responses').delete().eq('id', existing.id);
      }
    }, 400);
    return () => clearTimeout(handle);
  }, [allFilled, submissionId, itemId, userId]);

  const handleOnHand = (row: PrepRowDef, raw: string) => {
    setValues((prev) => ({ ...prev, [row.id]: { on_hand: raw, note: prev[row.id]?.note || '' } }));
    const key = `${itemId}_${row.id}`;
    if (debouncers[key]) clearTimeout(debouncers[key]);
    debouncers[key] = setTimeout(() => persist(row, raw), 600);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-3">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <p className="text-xs text-muted-foreground py-2 px-1">
        No prep items configured. Add items in the editor.
      </p>
    );
  }

  return (
    <div className="space-y-1">
      {/* Header row */}
      <div className="grid grid-cols-[1fr_72px_56px_72px] gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground px-1 pb-1">
        <span>Item</span>
        <span className="text-center">On Hand</span>
        <span className="text-center">Par</span>
        <span className="text-center">Prep</span>
      </div>
      {rows.map((row) => {
        const v = values[row.id] || { on_hand: '', note: '' };
        const onHandNum = v.on_hand === '' ? null : Number(v.on_hand);
        const prep =
          onHandNum != null && row.par != null && Number.isFinite(onHandNum)
            ? Math.max(0, Number(row.par) - onHandNum)
            : null;
        const overPar = onHandNum != null && row.par != null && onHandNum > Number(row.par);
        const filled = v.on_hand !== '' && Number.isFinite(onHandNum);
        return (
          <div
            key={row.id}
            className={cn(
              'grid grid-cols-[1fr_72px_56px_72px] gap-1.5 items-center py-1 px-1 rounded',
              filled && 'bg-primary/5',
            )}
          >
            <div className="min-w-0">
              <div className="text-xs font-medium truncate">{row.item_name}</div>
              {(() => {
                const panLabel = row.pan_key
                  ? (ALL_CONTAINERS.find((c) => c.key === row.pan_key)?.label || row.pan_key)
                  : null;
                const label = panLabel || row.unit;
                return label ? (
                  <div className="text-[10px] text-muted-foreground truncate">{label}</div>
                ) : null;
              })()}
            </div>
            <Input
              type="number"
              inputMode="decimal"
              value={v.on_hand}
              onChange={(e) => handleOnHand(row, e.target.value)}
              placeholder="0"
              className="h-8 text-sm text-center px-1"
            />
            <div className="text-center text-xs text-muted-foreground">
              {row.par != null ? row.par : '—'}
            </div>
            <div className="text-center">
              {row.par == null ? (
                <span className="text-[10px] text-muted-foreground">as needed</span>
              ) : prep == null ? (
                <span className="text-xs text-muted-foreground">—</span>
              ) : prep === 0 ? (
                <Badge variant="secondary" className="text-[10px] h-5">
                  {overPar ? 'over' : '✓'}
                </Badge>
              ) : (
                <span className="text-sm font-bold text-primary">{prep}</span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
