import { useEffect, useLayoutEffect, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import { GripVertical, Plus, Loader2, Save, StickyNote, BellRing, UserRound, Camera } from 'lucide-react';
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, TouchSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import { getReferencePhotos } from '@/lib/checklistReferencePhotos';
import { blankItem, duplicateItem, moveChecklistItems, referenceSlotCount, type EditorItem } from '@/lib/checklistEditorItems';
import { ChecklistItemInspector, typeMeta } from './ChecklistItemInspector';
import { ChecklistSettingsPanel } from './ChecklistSettingsPanel';
import type { ChecklistEditorSettings, TemplateType } from './types';

export type EditorTab = 'items' | 'settings';

interface Props {
  initialTab: EditorTab;
  settings: ChecklistEditorSettings;
  onSettingsChange: (patch: Partial<ChecklistEditorSettings>) => void;
  items: EditorItem[];
  setItems: Dispatch<SetStateAction<EditorItem[]>>;
  templateTypeOptions: TemplateType[];
  locationId?: string | null;
  storeToday: string;
  availablePositions: string[];
  uploadReference: (file: File) => Promise<string>;
  /** Where the + button adds a task (kept per screen as before). */
  addPosition: 'top' | 'end';
  /** Create keeps at least one task row. */
  minItems: number;
  singleDayHint: string;
  onCancel: () => void;
  onSave: () => void;
  saving: boolean;
  saveLabel: string;
  savingLabel: string;
  /** Shown above the tabs (e.g. "Unsaved changes"). */
  notice?: ReactNode;
  /** Extra content under the task list (Create: bulk add). */
  itemsFooter?: ReactNode;
}

const keyOf = (it: EditorItem, i: number) => it._key ?? `idx-${i}`;

/** Container-width check: inspector sits beside the list when there's room. */
function useIsWide(ref: React.RefObject<HTMLElement>, min = 720) {
  const [wide, setWide] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const apply = () => setWide(el.clientWidth >= min);
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, min]);
  return wide;
}

function Marker({ children, label }: { children: ReactNode; label: string }) {
  return (
    <span title={label} aria-label={label} className="inline-flex items-center gap-0.5 rounded bg-muted px-1 py-0.5 text-xs text-muted-foreground">
      {children}
    </span>
  );
}

function ItemRow({ item, id, selected, inSection, onSelect, showAmPm, showPosition }: {
  item: EditorItem; id: string; selected: boolean; inSection: boolean; onSelect: () => void; showAmPm: boolean; showPosition: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const isSection = item.item_type === 'section_header';
  const meta = typeMeta(item.item_type);
  const refs = getReferencePhotos(item).length;
  const slots = referenceSlotCount(item);
  const assigned = showPosition && (item.position || item.station_id || item.assigned_role || item.assigned_user_id);

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        'flex items-stretch rounded-lg border transition-colors',
        isSection ? 'mt-3 border-primary/30 bg-primary/5' : inSection ? 'ml-5 border-l-2 border-l-primary/40 bg-background' : 'bg-background',
        selected && 'border-primary ring-1 ring-primary/30',
        isDragging && 'z-50 opacity-50',
      )}
    >
      <button
        type="button"
        aria-label="Drag to reorder"
        className="flex w-10 shrink-0 touch-none cursor-grab items-center justify-center text-muted-foreground active:cursor-grabbing"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <button type="button" onClick={onSelect} aria-pressed={selected} className="flex min-h-11 min-w-0 flex-1 items-center gap-2 py-2 pr-2 text-left">
        <span className={cn('min-w-0 flex-1 break-words line-clamp-2 text-sm', isSection && 'font-semibold', !item.question.trim() && 'italic text-muted-foreground')}>
          {item.question.trim() || (isSection ? 'Untitled section' : 'Untitled task')}
        </span>
        {!isSection && (
          <span className="flex shrink-0 flex-wrap items-center justify-end gap-1">
            <Marker label={meta.label}><meta.Icon className="h-3.5 w-3.5" /></Marker>
            {item.reference_notes?.trim() && <Marker label="Has notes"><StickyNote className="h-3.5 w-3.5" /></Marker>}
            {refs > 0 && <Marker label={`Reference photos ${refs} of ${slots}`}><Camera className="h-3 w-3" />Ref {refs}/{slots}</Marker>}
            {item.item_type === 'temperature' && item.temperature_alert_enabled && <Marker label="Temp alerts on"><BellRing className="h-3.5 w-3.5" /></Marker>}
            {assigned && <Marker label="Assigned"><UserRound className="h-3.5 w-3.5" /></Marker>}
            {showAmPm && item.manager_shift && <Marker label={`${item.manager_shift.toUpperCase()} shift`}>{item.manager_shift.toUpperCase()}</Marker>}
          </span>
        )}
      </button>
    </div>
  );
}

export function ChecklistEditor(p: Props) {
  const { settings, items, setItems } = p;
  const [tab, setTab] = useState<EditorTab>(p.initialTab);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [focusNameKey, setFocusNameKey] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const wide = useIsWide(rootRef);

  const selectedIndex = items.findIndex((it, i) => keyOf(it, i) === selectedKey);
  const selected = selectedIndex >= 0 ? items[selectedIndex] : null;

  useEffect(() => { if (selectedKey && selectedIndex < 0) setSelectedKey(null); }, [selectedKey, selectedIndex]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    setItems((prev) => {
      const from = prev.findIndex((it, i) => keyOf(it, i) === active.id);
      const to = prev.findIndex((it, i) => keyOf(it, i) === over.id);
      return moveChecklistItems(prev, from, to).map((it, i) => ({ ...it, order_index: i }));
    });
  };

  const insertAt = (at: number, item: EditorItem) => {
    setItems((prev) => {
      const next = [...prev];
      next.splice(Math.max(0, Math.min(at, next.length)), 0, item);
      return next.map((it, i) => ({ ...it, order_index: i }));
    });
    setSelectedKey(item._key!);
    setFocusNameKey(item._key!);
  };

  const addFromPlus = () => insertAt(p.addPosition === 'top' ? 0 : items.length, blankItem());

  const updateSelected = (next: EditorItem) => {
    setItems((prev) => prev.map((it, i) => (keyOf(it, i) === selectedKey ? next : it)));
  };

  const removeSelected = () => {
    setItems((prev) => prev.filter((it, i) => keyOf(it, i) !== selectedKey).map((it, i) => ({ ...it, order_index: i })));
    setSelectedKey(null);
  };

  const canRemove = items.length > p.minItems;

  const inspector = selected && (
    <ChecklistItemInspector
      key={selectedKey!}
      item={selected}
      onChange={updateSelected}
      onEnter={() => insertAt(selectedIndex + 1, blankItem())}
      onDuplicate={() => insertAt(selectedIndex + 1, duplicateItem(selected))}
      onRemove={canRemove ? removeSelected : undefined}
      locationId={p.locationId}
      showAmPm={settings.enableAmPmDivision}
      showPosition={settings.positionFilteringEnabled}
      availablePositions={p.availablePositions}
      uploadReference={p.uploadReference}
      autoFocusName={focusNameKey === selectedKey}
    />
  );

  let inSection = false;
  const rows = items.map((item, i) => {
    if (item.item_type === 'section_header') inSection = true;
    const k = keyOf(item, i);
    return (
      <ItemRow
        key={k}
        id={k}
        item={item}
        selected={k === selectedKey}
        inSection={item.item_type !== 'section_header' && inSection}
        onSelect={() => { setFocusNameKey(null); setSelectedKey(k === selectedKey && wide ? null : k); }}
        showAmPm={settings.enableAmPmDivision}
        showPosition={settings.positionFilteringEnabled}
      />
    );
  });

  return (
    <div ref={rootRef} className="space-y-4">
      {p.notice}
      <div className="sticky top-0 z-20 -mx-1 flex flex-wrap items-center gap-2 bg-background/95 px-1 py-2 backdrop-blur">
        <SegmentedControl<EditorTab>
          value={tab}
          onValueChange={setTab}
          aria-label="Editor section"
          variant="primary"
          className="min-w-[180px] flex-1 h-11"
          fullWidth
          options={[
            { value: 'items', label: `Items (${items.length})` },
            { value: 'settings', label: 'Settings' },
          ]}
        />
        <div className="flex gap-2">
          <Button type="button" variant="outline" className="h-11" onClick={p.onCancel}>Cancel</Button>
          <Button type="button" className="h-11" onClick={p.onSave} disabled={p.saving}>
            {p.saving ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />{p.savingLabel}</> : <><Save className="mr-2 h-4 w-4" />{p.saveLabel}</>}
          </Button>
        </div>
      </div>

      {tab === 'settings' ? (
        <ChecklistSettingsPanel
          value={settings}
          onChange={p.onSettingsChange}
          templateTypeOptions={p.templateTypeOptions}
          locationId={p.locationId}
          storeToday={p.storeToday}
          availablePositions={p.availablePositions}
          singleDayHint={p.singleDayHint}
        />
      ) : (
        <div className={cn(wide && 'grid grid-cols-[minmax(0,1fr)_minmax(320px,400px)] items-start gap-4')}>
          <Card>
            <CardContent className="space-y-2 px-3 pt-4">
              <div className="flex items-center justify-between gap-2 pb-1">
                <div>
                  <h3 className="text-base font-semibold">Tasks</h3>
                  <p className="text-sm text-muted-foreground">Tap a task to edit it · drag to reorder</p>
                </div>
                <Button type="button" variant="outline" size="icon" className="h-11 w-11 shrink-0" aria-label="Add task" onClick={addFromPlus}>
                  <Plus className="h-5 w-5" />
                </Button>
              </div>
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
                <SortableContext items={items.map(keyOf)} strategy={verticalListSortingStrategy}>
                  <div className="space-y-2">{rows}</div>
                </SortableContext>
              </DndContext>
              {items.length === 0 && <p className="py-4 text-center text-sm text-muted-foreground">No tasks yet. Tap + to add one.</p>}
              {p.itemsFooter}
            </CardContent>
          </Card>

          {wide && (
            <Card className="sticky top-16">
              <CardContent className="max-h-[calc(100vh-6rem)] overflow-y-auto pt-4">
                {inspector ?? <p className="py-8 text-center text-sm text-muted-foreground">Tap a task to edit it.</p>}
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {!wide && (
        <Sheet open={!!selected && tab === 'items'} onOpenChange={(o) => !o && setSelectedKey(null)}>
          <SheetContent side="bottom" className="max-h-[88vh] overflow-y-auto rounded-t-2xl">
            <SheetHeader className="pb-2 text-left">
              <SheetTitle>{selected?.item_type === 'section_header' ? 'Edit section' : 'Edit task'}</SheetTitle>
            </SheetHeader>
            {inspector}
          </SheetContent>
        </Sheet>
      )}
    </div>
  );
}
