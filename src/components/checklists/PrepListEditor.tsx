import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Search, X, Plus, Link2, Unlink } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ALL_CONTAINERS } from '@/components/inventory/PanSizesSection';

export interface PrepRow {
  id?: string;
  inventory_item_id?: string | null;
  item_name: string;
  unit?: string | null;
  pan_key?: string | null;
  par?: number | null;
  order_index: number;
  // transient: enabled pan keys for the linked inventory item (not persisted as a column)
  _enabled_pan_keys?: string[] | null;
}

interface InvItem {
  id: string;
  name: string;
  unit: string | null;
  count_unit: string | null;
  par_level: number | null;
  brand: string | null;
  pack_size: string | null;
  pan_sizes: any;
}


interface Props {
  rows: PrepRow[];
  onChange: (rows: PrepRow[]) => void;
  locationId: string | null | undefined;
}

export function PrepListEditor({ rows, onChange, locationId }: Props) {
  const updateRow = (idx: number, patch: Partial<PrepRow>) => {
    const next = rows.map((r, i) => (i === idx ? { ...r, ...patch } : r));
    onChange(next);
  };
  const addRow = () => {
    onChange([
      ...rows,
      { item_name: '', unit: '', par: null, inventory_item_id: null, order_index: rows.length },
    ]);
  };
  const removeRow = (idx: number) => {
    onChange(rows.filter((_, i) => i !== idx).map((r, i) => ({ ...r, order_index: i })));
  };

  return (
    <div className="space-y-1.5 rounded-md border border-dashed p-2 bg-muted/20">
      <div className="grid grid-cols-[1fr_70px_70px_28px] gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground px-1">
        <span>Item</span>
        <span>Unit</span>
        <span>Par</span>
        <span />
      </div>
      {rows.length === 0 && (
        <p className="text-[11px] text-muted-foreground px-1 py-2">No items yet. Add prep items below.</p>
      )}
      {rows.map((row, idx) => (
        <PrepRowEditor
          key={idx}
          row={row}
          locationId={locationId}
          onChange={(patch) => updateRow(idx, patch)}
          onRemove={() => removeRow(idx)}
        />
      ))}
      <Button type="button" variant="ghost" size="sm" onClick={addRow} className="h-7 text-xs w-full justify-start">
        <Plus className="h-3 w-3 mr-1" /> Add prep item
      </Button>
    </div>
  );
}

function PrepRowEditor({
  row,
  locationId,
  onChange,
  onRemove,
}: {
  row: PrepRow;
  locationId?: string | null;
  onChange: (patch: Partial<PrepRow>) => void;
  onRemove: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<InvItem[]>([]);
  const [loading, setLoading] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const isLinked = !!row.inventory_item_id;

  // Live search driven by what user types in the item name field
  useEffect(() => {
    if (!open || !locationId) return;
    const term = row.item_name.trim();
    setLoading(true);
    const handle = setTimeout(async () => {
      let q = supabase
        .from('inventory_items')
        .select('id, name, unit, count_unit, par_level, brand, pack_size, pan_sizes')
        .eq('location_id', locationId)
        .eq('is_active', true)
        .order('name')
        .limit(25);
      if (term) q = q.ilike('name', `%${term}%`);
      const { data } = await q;
      setResults((data || []) as InvItem[]);
      setLoading(false);
    }, 180);
    return () => clearTimeout(handle);
  }, [open, row.item_name, locationId]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const pickItem = (item: InvItem) => {
    const panCfg = item.pan_sizes && typeof item.pan_sizes === 'object' ? item.pan_sizes : null;
    const enabledKeys: string[] = panCfg?.enabled
      ? (Array.isArray(panCfg.enabled_keys) ? panCfg.enabled_keys : [])
      : [];
    const baselineKey: string | null = panCfg?.enabled ? (panCfg.baseline_key || null) : null;
    const defaultPan = baselineKey && enabledKeys.includes(baselineKey)
      ? baselineKey
      : (enabledKeys[0] || null);
    onChange({
      inventory_item_id: item.id,
      item_name: item.name,
      unit: item.count_unit || item.unit || '',
      pan_key: defaultPan,
      par: item.par_level ?? row.par ?? null,
      _enabled_pan_keys: enabledKeys.length ? enabledKeys : null,
    });
    setOpen(false);
  };

  const unlink = () => {
    onChange({ inventory_item_id: null, pan_key: null, _enabled_pan_keys: null });
  };

  return (
    <div className="grid grid-cols-[1fr_70px_70px_28px] gap-1 items-center">
      <div ref={wrapperRef} className="relative flex gap-1 items-center min-w-0">
        <div className="relative flex-1">
          <Input
            value={row.item_name}
            onChange={(e) => {
              onChange({ item_name: e.target.value, inventory_item_id: null });
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            placeholder="Search or type item name"
            className={cn('h-7 text-xs pr-7', isLinked && 'border-primary/50 bg-primary/5')}
          />
          <Search className="h-3 w-3 absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
        </div>
        {isLinked && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0"
            onClick={unlink}
            title="Unlink from inventory"
          >
            <Unlink className="h-3 w-3" />
          </Button>
        )}
        {open && (
          <div className="absolute z-50 top-full left-0 mt-1 w-72 max-w-[90vw] rounded-md border bg-popover shadow-md p-1">
            <div className="max-h-60 overflow-y-auto space-y-0.5">
              {loading && results.length === 0 && (
                <p className="text-[11px] text-muted-foreground px-2 py-2">Searching…</p>
              )}
              {!loading && results.length === 0 && (
                <p className="text-[11px] text-muted-foreground px-2 py-2">
                  No matches{row.item_name.trim() ? ' — keep typing to use freehand' : ''}
                </p>
              )}
              {results.map((it) => (
                <button
                  key={it.id}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pickItem(it)}
                  className="w-full text-left px-2 py-1.5 rounded hover:bg-accent text-xs"
                >
                  <div className="font-medium truncate flex items-center gap-1">
                    <Link2 className="h-3 w-3 text-primary shrink-0" />
                    {it.name}
                  </div>
                  <div className="text-[10px] text-muted-foreground truncate pl-4">
                    {[it.brand, it.pack_size, it.count_unit || it.unit].filter(Boolean).join(' · ')}
                    {it.par_level != null && ` · par ${it.par_level}`}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
      <Input
        value={row.unit || ''}
        onChange={(e) => onChange({ unit: e.target.value })}
        placeholder="ea"
        className="h-7 text-xs px-1.5"
        disabled={isLinked}
      />
      <Input
        type="number"
        inputMode="decimal"
        value={row.par ?? ''}
        onChange={(e) => onChange({ par: e.target.value === '' ? null : Number(e.target.value) })}
        placeholder="—"
        className="h-7 text-xs px-1.5"
      />
      <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={onRemove}>
        <X className="h-3 w-3" />
      </Button>
    </div>
  );
}
