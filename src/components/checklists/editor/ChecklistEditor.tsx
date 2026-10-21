import { useEffect, useLayoutEffect, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import { ArrowLeft, ChevronRight, GripVertical, Loader2, Plus } from 'lucide-react';
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, TouchSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PageTitle } from '@/components/PageTitle';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import { blankItem, duplicateItem, moveChecklistItems, type EditorItem } from '@/lib/checklistEditorItems';
import { ChecklistItemInspector, typeMeta } from './ChecklistItemInspector';
import { ChecklistSettingsPanel } from './ChecklistSettingsPanel';
import type { ChecklistEditorSettings, TemplateType } from './types';

export type EditorTab = 'items' | 'settings';

interface Props {
  initialTab: EditorTab;
  /** Shown when the checklist has no title yet. */
  fallbackTitle: string;
  settings: ChecklistEditorSettings;
  onSettingsChange: (patch: Partial<ChecklistEditorSettings>) => void;
  items: EditorItem[];
  setItems: Dispatch<SetStateAction<EditorItem[]>>;
  templateTypeOptions: TemplateType[];
  locationId?: string | null;
  storeToday: string;
  availablePositions: string[];
  uploadReference: (file: File) => Promise<string>;
  /** Create keeps at least one task row. */
  minItems: number;
  singleDayHint: string;
  /** Back arrow (pages confirm unsaved changes there). */
  onCancel: () => void;
  onSave: () => void;
  saving: boolean;
  saveLabel: string;
  saveLabelWide: string;
  savingLabel: string;
  /** Small line under the title (e.g. "Unsaved changes"). */
  notice?: ReactNode;
  /** Extra content under the task list (Create: bulk add). */
  itemsFooter?: ReactNode;
}

const keyOf = (it: EditorItem, i: number) => it._key ?? `idx-${i}`;

/** Width check: inspector sits beside the list when there's room. */
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

function ItemRow({ item, id, selected, inSection, onSelect, showAmPm }: {
  item: EditorItem; id: string; selected: boolean; inSection: boolean; onSelect: () => void; showAmPm: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const isSection = item.item_type === 'section_header';
  const meta = typeMeta(item.item_type);
  const name = item.question.trim();

  const handle = (
    <button
      type="button"
      aria-label="Drag to reorder"
      className="flex w-8 shrink-0 touch-none cursor-grab items-center justify-center text-muted-foreground/50 active:cursor-grabbing"
      {...attributes}
      {...listeners}
    >
      <GripVertical className="h-4 w-4" />
    </button>
  );

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        'relative flex items-stretch border-b border-border last:border-b-0',
        isSection ? 'bg-muted' : selected ? 'bg-accent' : 'bg-card',
        isDragging && 'z-50 opacity-60',
      )}
    >
      <div className={cn('flex min-w-0 flex-1 items-stretch pl-1 pr-3', inSection && 'pl-4')}>
        {handle}
        <button
          type="button"
          onClick={onSelect}
          aria-pressed={selected}
          className={cn('flex min-h-11 min-w-0 flex-1 items-center gap-2.5 text-left', isSection ? 'py-2.5' : 'py-3.5')}
        >
          {isSection ? (
            <span className="min-w-0 flex-1 break-words text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              Section · {name || 'Untitled'}
            </span>
          ) : (
            <>
              <meta.Icon className="h-5 w-5 shrink-0 text-primary" aria-label={meta.label} />
              <span className={cn('min-w-0 flex-1 break-words line-clamp-2 text-[15px] font-semibold leading-snug', !name && 'italic font-normal text-muted-foreground')}>
                {name || 'Untitled task'}
              </span>
              {showAmPm && item.manager_shift && (
                <span className="shrink-0 text-xs font-medium text-muted-foreground">{item.manager_shift.toUpperCase()}</span>
              )}
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
            </>
          )}
        </button>
      </div>
    </div>
  );
}

export function ChecklistEditor(p: Props) {
  const { settings, items, setItems } = p;
  const [tab, setTab] = useState<EditorTab>(p.initialTab);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [focusNameKey, setFocusNameKey] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');
  const addInputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const wide = useIsWide(rootRef);

  const selectedIndex = items.findIndex((it, i) => keyOf(it, i) === selectedKey);
  const selected = selectedIndex >= 0 ? items[selectedIndex] : null;
  const taskCount = items.filter((it) => it.item_type !== 'section_header').length;

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

  /** Bottom bar: add a named task at the end, keep typing focus. */
  const addFromBar = () => {
    const name = draftName.trim();
    if (!name) { addInputRef.current?.focus(); return; }
    const item = { ...blankItem(), question: name };
    setItems((prev) => [...prev, item].map((it, i) => ({ ...it, order_index: i })));
    setDraftName('');
    requestAnimationFrame(() => addInputRef.current?.focus());
  };

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
        selected={wide && k === selectedKey}
        inSection={item.item_type !== 'section_header' && inSection}
        onSelect={() => { setFocusNameKey(null); setSelectedKey(k === selectedKey && wide ? null : k); }}
        showAmPm={settings.enableAmPmDivision}
      />
    );
  });

  const tabs = (
    <SegmentedControl<EditorTab>
      value={tab}
      onValueChange={setTab}
      aria-label="Editor section"
      className={cn('h-11', wide ? 'w-[240px]' : 'w-full')}
      fullWidth
      options={[
        { value: 'items', label: `Items · ${taskCount}` },
        { value: 'settings', label: 'Settings' },
      ]}
    />
  );

  const saveButton = (
    <Button type="button" className="h-11 px-4" onClick={p.onSave} disabled={p.saving}>
      {p.saving ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />{p.savingLabel}</> : (wide ? p.saveLabelWide : p.saveLabel)}
    </Button>
  );

  const addBar = (
    <div className="flex items-center gap-2">
      <Input
        ref={addInputRef}
        value={draftName}
        onChange={(e) => setDraftName(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addFromBar(); } }}
        placeholder="Add an item"
        aria-label="Add an item"
        enterKeyHint="enter"
        className="h-11 flex-1 rounded-xl bg-card text-base"
      />
      <Button type="button" size="icon" className="h-11 w-11 shrink-0 rounded-xl" aria-label="Add item" onClick={addFromBar}>
        <Plus className="h-5 w-5" />
      </Button>
    </div>
  );

  const list = (
    <div className={cn('overflow-hidden rounded-2xl border bg-card', wide && 'flex flex-col')}>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={items.map(keyOf)} strategy={verticalListSortingStrategy}>
          <div>{rows}</div>
        </SortableContext>
      </DndContext>
      {items.length === 0 && <p className="px-3 py-6 text-center text-sm text-muted-foreground">No tasks yet. Type one below.</p>}
      {wide && <div className="sticky bottom-0 border-t bg-card p-3">{addBar}</div>}
    </div>
  );

  return (
    <div ref={rootRef}>
      <PageTitle
        color="teal"
        status={null}
        leading={
          <Button variant="ghost" size="icon" className="h-11 w-11" onClick={p.onCancel} aria-label="Back">
            <ArrowLeft className="h-5 w-5" />
          </Button>
        }
        action={wide ? <>{tabs}{saveButton}</> : saveButton}
        subtitle={p.notice}
      >
        {settings.title.trim() || p.fallbackTitle}
      </PageTitle>
      {!wide && <div className="mb-3">{tabs}</div>}

      {tab === 'settings' ? (
        <ChecklistSettingsPanel
          value={settings}
          onChange={p.onSettingsChange}
          templateTypeOptions={p.templateTypeOptions}
          locationId={p.locationId}
          storeToday={p.storeToday}
          availablePositions={p.availablePositions}
          singleDayHint={p.singleDayHint}
          wide={wide}
        />
      ) : (
        <div className={cn(wide && 'grid grid-cols-[minmax(0,48fr)_minmax(0,52fr)] items-start gap-4')}>
          <div className="space-y-3">
            {list}
            {p.itemsFooter}
          </div>

          {wide && (
            <div className="sticky top-16 max-h-[calc(100vh-6rem)] overflow-y-auto rounded-2xl border bg-card p-4">
              {inspector ?? <p className="py-8 text-center text-sm text-muted-foreground">Tap a task to edit it.</p>}
            </div>
          )}
        </div>
      )}

      {!wide && tab === 'items' && (
        <div className="sticky z-20 mt-3 bg-background py-2" style={{ bottom: 'calc(var(--app-dock-h, 6rem) + 0.25rem)' }}>
          {addBar}
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
