import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Search, X, Plus, Link2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface PrepRow {
  id?: string;
  inventory_item_id?: string | null;
  item_name: string;
  unit?: string | null;
  par?: number | null;
  order_index: number;
}

interface InvItem {
  id: string;
  name: string;
  unit: string | null;
  count_unit: string | null;
  par_level: number | null;
  brand: string | null;
  pack_size: string | null;
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
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<InvItem[]>([]);
  const isLinked = !!row.inventory_item_id;

  useEffect(() => {
    if (!open || !locationId) return;
    const handle = setTimeout(async () => {
      let q = supabase
        .from('inventory_items')
        .select('id, name, unit, count_unit, par_level, brand, pack_size')
        .eq('location_id', locationId)
        .eq('is_active', true)
        .order('name')
        .limit(25);
      if (search.trim()) q = q.ilike('name', `%${search.trim()}%`);
      const { data } = await q;
      setResults((data || []) as InvItem[]);
    }, 200);
    return () => clearTimeout(handle);
  }, [open, search, locationId]);

  const pickItem = (item: InvItem) => {
    onChange({
      inventory_item_id: item.id,
      item_name: item.name,
      unit: item.count_unit || item.unit || '',
      par: item.par_level ?? row.par ?? null,
    });
    setOpen(false);
    setSearch('');
  };

  const unlink = () => {
    onChange({ inventory_item_id: null });
  };

  return (
    <div className="grid grid-cols-[1fr_70px_70px_28px] gap-1 items-center">
      <div className="flex gap-1 items-center min-w-0">
        <Input
          value={row.item_name}
          onChange={(e) => onChange({ item_name: e.target.value, inventory_item_id: null })}
          placeholder="Item name"
          className={cn('h-7 text-xs', isLinked && 'border-primary/50 bg-primary/5')}
        />
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant={isLinked ? 'default' : 'ghost'}
              size="icon"
              className="h-7 w-7 shrink-0"
              title={isLinked ? 'Linked to inventory' : 'Search inventory'}
            >
              {isLinked ? <Link2 className="h-3 w-3" /> : <Search className="h-3 w-3" />}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-72 p-2" align="start">
            <div className="space-y-2">
              {isLinked && (
                <Button type="button" variant="outline" size="sm" onClick={unlink} className="w-full h-7 text-xs">
                  Unlink from inventory
                </Button>
              )}
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search inventory…"
                className="h-7 text-xs"
                autoFocus
              />
              <div className="max-h-60 overflow-y-auto space-y-0.5">
                {results.length === 0 && (
                  <p className="text-[11px] text-muted-foreground px-1 py-2">No matches</p>
                )}
                {results.map((it) => (
                  <button
                    key={it.id}
                    type="button"
                    onClick={() => pickItem(it)}
                    className="w-full text-left px-2 py-1.5 rounded hover:bg-accent text-xs"
                  >
                    <div className="font-medium truncate">{it.name}</div>
                    <div className="text-[10px] text-muted-foreground truncate">
                      {[it.brand, it.pack_size, it.count_unit || it.unit].filter(Boolean).join(' · ')}
                      {it.par_level != null && ` · par ${it.par_level}`}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </PopoverContent>
        </Popover>
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
