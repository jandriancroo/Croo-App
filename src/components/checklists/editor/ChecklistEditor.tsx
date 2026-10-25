import { useEffect, useLayoutEffect, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import { ArrowLeft, ChevronRight, GripVertical, Loader2, Plus, Upload } from 'lucide-react';
import { BulkUploadPanel } from './BulkUploadPanel';
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, TouchSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PageTitle } from '@/components/PageTitle';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { useDuo } from '@/hooks/useDuo';
import { cn } from '@/lib/utils';
import { blankItem, duplicateItem, moveChecklistItems, withKey, type EditorItem } from '@/lib/checklistEditorItems';
import { ChecklistItemInspector, typeMeta } from './ChecklistItemInspector';
import { ChecklistSettingsPanel } from './ChecklistSettingsPanel';
import { useAssignmentLabeler } from '@/components/tasks/TaskAssigneePicker';
import { AssignmentBadge } from '@/components/tasks/AssignmentBadge';
import type { AssignmentInfo } from '@/lib/assignmentBadge';
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
  /** Unused: type is fixed at creation (kept so callers compile). */
  templateTypeOptions?: TemplateType[];
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
  /** Offer Bulk Upload (Standard and Training lists). */
  bulkUpload?: boolean;
  /** Create: show the "How do you want to build this list?" cards while empty. */
  emptyStart?: boolean;
  /** Settings: type shown but not changeable. */
  typeLocked?: boolean;
  saveDisabled?: boolean;
  /** Replaces the Items tab (Create with Dynamic Weekly chosen). */
  itemsOverride?: ReactNode;
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

function ItemRow({ item, id, selected, inSection, onSelect, showAmPm, assignText, wide }: {
  item: EditorItem; id: string; selected: boolean; inSection: boolean; onSelect: () => void; showAmPm: boolean;
  /** undefined = assignments off; null = unassigned ("Anyone"). */
  assignText?: AssignmentInfo; wide: boolean;
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
      data-row-key={id}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        'relative flex items-stretch border-b border-border last:border-b-0',
        isSection ? 'bg-muted' : selected ? 'bg-primary/10 shadow-[inset_3px_0_0_hsl(var(--primary))]' : 'bg-card',
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
              <span className="min-w-0 flex-1">
                <span className={cn('block break-words text-[15px] leading-snug', selected ? 'font-bold' : 'font-semibold', !name && 'italic font-normal text-muted-foreground')}>
                  {name || 'Untitled task'}
                </span>
                {!wide && (assignText || (showAmPm && item.manager_shift)) && (
                  <span className="mt-1 flex flex-wrap items-center gap-1.5">
                    {assignText && <AssignmentBadge info={assignText} />}
                    {showAmPm && item.manager_shift && <span className="text-xs font-medium text-muted-foreground">{item.manager_shift.toUpperCase()}</span>}
                  </span>
                )}
              </span>
              {wide && assignText && <AssignmentBadge info={assignText} className="max-w-[40%] shrink-0" />}
              {wide && showAmPm && item.manager_shift && (
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
  const [bulkOpen, setBulkOpen] = useState(false);
  const [startedNew, setStartedNew] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const duo = useDuo();
  // Duo open: always the list + inspector layout (list on the left half, inspector docked on the right half).
  const wide = useIsWide(rootRef) || duo.isOpen;
  const roomy = useIsWide(rootRef, 1100) && !duo.isDuo;
  const labelFor = useAssignmentLabeler(p.locationId);
  const showAssign = settings.positionFilteringEnabled;

  const selectedIndex = items.findIndex((it, i) => keyOf(it, i) === selectedKey);
  const selected = selectedIndex >= 0 ? items[selectedIndex] : null;
  const taskCount = items.filter((it) => it.item_type !== 'section_header').length;

  useEffect(() => { if (selectedKey && selectedIndex < 0) setSelectedKey(null); }, [selectedKey, selectedIndex]);
  // Duo open: the right side is never empty, so the first item opens by itself.
  useEffect(() => {
    if (duo.isOpen && wide && !selectedKey && tab === 'items' && items.length > 0) setSelectedKey(keyOf(items[0], 0));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [duo.isOpen, wide, selectedKey, tab, items.length]);

  const goTo = (i: number) => { if (i < 0 || i >= items.length) return; setFocusNameKey(null); setSelectedKey(keyOf(items[i], i)); };
  const onPrev = selectedIndex > 0 ? () => goTo(selectedIndex - 1) : undefined;
  const onNext = selectedIndex >= 0 && selectedIndex < items.length - 1 ? () => goTo(selectedIndex + 1) : undefined;

  // Keep the selected row visible.
  useEffect(() => {
    if (!selectedKey) return;
    const el = rootRef.current?.querySelector(`[data-row-key="${window.CSS.escape(selectedKey)}"]`);
    (el as HTMLElement | null)?.scrollIntoView({ block: 'nearest' });
  }, [selectedKey]);

  // Wide: Alt+Up / Alt+Down step through rows when not typing.
  useEffect(() => {
    if (!wide || tab !== 'items') return;
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      e.preventDefault();
      if (selectedIndex < 0) { goTo(0); return; }
      goTo(selectedIndex + (e.key === 'ArrowUp' ? -1 : 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

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
  const showStart = !!p.emptyStart && items.length === 0 && !startedNew && !bulkOpen;

  const startNew = () => {
    setBulkOpen(false);
    setStartedNew(true);
    requestAnimationFrame(() => requestAnimationFrame(() => addInputRef.current?.focus()));
  };

  const addBulk = (added: EditorItem[]) => {
    setItems((prev) => [...prev, ...added.map(withKey)].map((it, i) => ({ ...it, order_index: i })));
    setBulkOpen(false);
    setStartedNew(true);
  };

  const startCards = (
    <div className="space-y-3">
      <h2 className="px-1 text-lg font-semibold">How do you want to build this list?</h2>
      <div className={cn('gap-3', wide ? 'grid grid-cols-2' : 'space-y-3')}>
        {[
          { key: 'new', Icon: Plus, title: 'Start New Checklist', sub: 'Build it here. Type a task, add it, type the next.', on: startNew },
          { key: 'bulk', Icon: Upload, title: 'Bulk Upload', sub: 'Bring in a list you already have. Paste the text, or upload a CSV, a PDF or a photo.', on: () => setBulkOpen(true) },
        ].map(({ key, Icon, title, sub, on }) => (
          <button key={key} type="button" onClick={on} className="flex w-full min-h-28 items-start gap-3 rounded-2xl border bg-card p-4 text-left transition-colors hover:border-primary">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><Icon className="h-5 w-5" /></span>
            <span className="min-w-0">
              <span className="block text-base font-semibold">{title}</span>
              <span className="mt-1 block text-sm text-muted-foreground">{sub}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );

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
      itemNumber={selected.item_type === 'section_header' ? null : items.slice(0, selectedIndex + 1).filter((it) => it.item_type !== 'section_header').length}
      compact={!wide}
      onDone={() => setSelectedKey(null)}
      itemTotal={taskCount}
      onPrev={onPrev}
      onNext={onNext}
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
        wide={wide}
        assignText={showAssign && item.item_type !== 'section_header' ? labelFor(item) : undefined}
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
    <Button type="button" className="h-11 px-4" onClick={p.onSave} disabled={p.saving || !!p.saveDisabled}>
      {p.saving ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />{p.savingLabel}</> : (wide ? p.saveLabelWide : p.saveLabel)}
    </Button>
  );

  const showBulkBtn = !!p.bulkUpload && items.length > 0;
  const addBar = (
    <div className="space-y-2">
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
    {showBulkBtn && (
      <button
        type="button"
        onClick={() => setBulkOpen(true)}
        className="flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-border bg-card text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <Upload className="h-4 w-4" />Bulk Upload
      </button>
    )}
    </div>
  );

  const list = (
    <div className={cn('duo-tasks-list overflow-hidden rounded-2xl border bg-card', wide && 'flex flex-col')}>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={items.map(keyOf)} strategy={verticalListSortingStrategy}>
          <div>{rows}</div>
        </SortableContext>
      </DndContext>
      {items.length === 0 && <p className="px-3 py-6 text-center text-sm text-muted-foreground">Type a task below and press Enter</p>}
      {wide && <div className="sticky bottom-0 border-t bg-card p-3">{addBar}</div>}
    </div>
  );

  const typeTag = settings.templateType !== 'dynamic' && (
    <span className="inline-flex items-center rounded-full border border-border bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
      {settings.templateType === 'training' ? 'Training' : 'Standard'}
    </span>
  );
  const subtitle = typeTag || p.notice ? <span className="flex flex-wrap items-center gap-2">{typeTag}{p.notice}</span> : undefined;

  return (
    <div ref={rootRef} className={duo.isDuo ? (duo.isOpen ? 'duo-tasks-page duo-tasks-left duo-editor' : 'duo-tasks-page duo-editor') : undefined}>
      {duo.isDuo && (
        <div className="duo-editor-head">
          <Button variant="ghost" size="icon" className="h-11 w-11 -ml-2" onClick={p.onCancel} aria-label="Back"><ArrowLeft className="h-5 w-5" /></Button>
          <span className="duo-editor-title">{settings.title.trim() || p.fallbackTitle}</span>
          {typeTag}
          <span className="flex-1" />
          {wide && tabs}
          {saveButton}
        </div>
      )}
      {!duo.isDuo && <PageTitle
        color="teal"
        status={null}
        leading={
          <Button variant="ghost" size="icon" className="h-11 w-11" onClick={p.onCancel} aria-label="Back">
            <ArrowLeft className="h-5 w-5" />
          </Button>
        }
        action={wide ? <>{tabs}{saveButton}</> : saveButton}
        subtitle={subtitle}
      >
        {settings.title.trim() || p.fallbackTitle}
      </PageTitle>}
      {!wide && <div className="mb-3 duo-ctl">{tabs}</div>}
      {duo.isDuo && p.notice && <div className="px-1 pb-2 text-sm text-muted-foreground">{p.notice}</div>}

      {tab === 'settings' ? (
        <ChecklistSettingsPanel
          value={settings}
          onChange={p.onSettingsChange}
          locationId={p.locationId}
          storeToday={p.storeToday}
          availablePositions={p.availablePositions}
          singleDayHint={p.singleDayHint}
          wide={wide}
        />
      ) : p.itemsOverride ? (
        p.itemsOverride
      ) : bulkOpen ? (
        <BulkUploadPanel
          wide={wide}
          locationId={p.locationId}
          onStartNewInstead={items.length === 0 ? startNew : undefined}
          onCancel={() => setBulkOpen(false)}
          onAdd={addBulk}
        />
      ) : showStart ? (
        startCards
      ) : (
        <div className={cn(duo.isDuo && wide && 'duo-editor-grid', !wide ? undefined : roomy ? 'grid grid-cols-[minmax(0,1fr)_330px] items-start gap-4' : 'grid grid-cols-[minmax(0,48fr)_minmax(0,52fr)] items-start gap-4')}>
          <div className="space-y-3">
            {list}
            {p.itemsFooter}
          </div>

          {wide && (
            <div className="duo-editor-dock sticky top-16 max-h-[calc(100vh-6rem)] overflow-y-auto rounded-2xl border border-primary bg-card p-4">
              {inspector ?? <p className="py-8 text-center text-sm text-muted-foreground">Tap a task to edit it.</p>}
            </div>
          )}
        </div>
      )}

      {!wide && tab === 'items' && !p.itemsOverride && !bulkOpen && !showStart && (
        <div className="sticky z-20 mt-3 bg-background py-2" style={{ bottom: 'calc(var(--app-dock-h, 6rem) + 0.25rem)' }}>
          {addBar}
        </div>
      )}

      {!wide && (
        <Sheet open={!!selected && tab === 'items'} onOpenChange={(o) => !o && setSelectedKey(null)}>
          <SheetContent side={duo.isDuo ? 'right' : 'bottom'} aria-describedby={undefined} className={cn('max-h-[85vh] overflow-y-auto px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-2', duo.isDuo ? 'duo-slide max-h-none' : 'rounded-t-2xl [&>button.absolute]:hidden')}>
            <SheetTitle className="sr-only">{selected?.item_type === 'section_header' ? 'Edit section' : 'Edit task'}</SheetTitle>
            {inspector}
          </SheetContent>
        </Sheet>
      )}
    </div>
  );
}
