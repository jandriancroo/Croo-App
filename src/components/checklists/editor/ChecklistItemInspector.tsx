import { useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Copy, Trash2, Link as LinkIcon, Video, CheckSquare, Type, Hash, Camera, Thermometer, List, ClipboardList, Heading, ShieldCheck, MoreHorizontal, Minus, Plus, Check, ChevronLeft } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { ChecklistMentionInput } from '@/components/tasks/ChecklistMentionInput';
import { TaskAssigneePicker } from '@/components/tasks/TaskAssigneePicker';
import { NotesTextarea } from '@/components/tasks/NotesTextarea';
import { PrepListEditor } from '@/components/checklists/PrepListEditor';
import { getReferencePhotos } from '@/lib/checklistReferencePhotos';
import { displayType, hasPhotoCount, minPhotos, photosDroppedAt, referenceSlotCount, setReferencePhotos, type EditorItem } from '@/lib/checklistEditorItems';
import { ReferencePhotoSlots } from './ReferencePhotoSlots';

export const ITEM_TYPES = [
  { value: 'confirmation', label: 'Check', Icon: CheckSquare },
  { value: 'text', label: 'Text', Icon: Type },
  { value: 'number', label: 'Number', Icon: Hash },
  { value: 'image', label: 'Photo', Icon: Camera },
  { value: 'temperature', label: 'Temp Photo', Icon: Thermometer },
  { value: 'multiple_choice', label: 'Multiple Choice', Icon: List },
  { value: 'prep_list', label: 'Prep List', Icon: ClipboardList },
  { value: 'section_header', label: 'Section Header', Icon: Heading },
  { value: 'manager_approval', label: 'Manager Approval', Icon: ShieldCheck },
] as const;

const PRIMARY_TYPES = ['confirmation', 'image', 'temperature', 'text', 'number'] as const;

export const typeMeta = (t: string) => ITEM_TYPES.find((x) => x.value === displayType(t)) ?? ITEM_TYPES[0];

interface Props {
  item: EditorItem;
  onChange: (next: EditorItem) => void;
  onEnter: () => void;
  onDuplicate: () => void;
  onRemove?: () => void;
  locationId?: string | null;
  showAmPm: boolean;
  showPosition: boolean;
  availablePositions: string[];
  uploadReference: (file: File) => Promise<string>;
  autoFocusName?: boolean;
  /** Task number among tasks (sections not counted). */
  itemNumber?: number | null;
  /** Phone sheet: two pages + Done. */
  compact?: boolean;
  onDone?: () => void;
}

export function ChecklistItemInspector({ item, onChange, onEnter, onDuplicate, onRemove, locationId, showAmPm, showPosition, availablePositions, uploadReference, autoFocusName, itemNumber, compact, onDone }: Props) {
  const [pending, setPending] = useState<{ next: EditorItem; drop: number } | null>(null);
  const isSection = item.item_type === 'section_header';
  const set = (patch: Partial<EditorItem>) => onChange({ ...item, ...patch });

  /** Apply a change that may shrink the reference slots; ask before dropping photos. */
  const applyShrinking = (next: EditorItem) => {
    const slots = next.item_type === 'section_header' ? 0 : referenceSlotCount(next);
    const drop = photosDroppedAt(next, slots);
    if (drop > 0) setPending({ next, drop });
    else onChange(next);
  };

  const confirmDrop = () => {
    if (!pending) return;
    const slots = pending.next.item_type === 'section_header' ? 0 : referenceSlotCount(pending.next);
    onChange(setReferencePhotos(pending.next, getReferencePhotos(pending.next).slice(0, slots)));
    setPending(null);
  };

  const shownType = displayType(item.item_type);
  const photos = getReferencePhotos(item);
  const [moreOpen, setMoreOpen] = useState(() => !PRIMARY_TYPES.includes(shownType as any));
  const [refOpen, setRefOpen] = useState<'photo' | 'link' | 'video' | null>(null);
  const [page, setPage] = useState<'main' | 'notes'>('main');
  const pickType = (v: string) => { if (v !== shownType) applyShrinking({ ...item, item_type: v }); };

  const label = (t: string) => <div className="mb-1.5 text-sm font-semibold">{t}</div>;
  const header = (left?: ReactNode) => (
    <div className="flex min-h-11 items-center justify-between gap-2">
      <div className="flex items-center gap-1">
        {left}
        <span className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
          {isSection ? 'Section' : `Item ${itemNumber ?? ''}`}
        </span>
      </div>
      {compact && onDone && <Button type="button" className="h-11 px-5" onClick={onDone}>Done</Button>}
    </div>
  );

  const typeBtn = (value: string, text: string, Icon: any, selected: boolean, onClick: () => void) => (
    <button
      key={value}
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cn(
        'flex min-h-11 min-w-0 items-center justify-center gap-1.5 rounded-xl border px-2 py-2 text-sm font-medium',
        selected ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-card text-foreground',
      )}
    >
      <Icon className="h-4 w-4 shrink-0" /><span className="min-w-0 break-words">{text}</span>
    </button>
  );

  const moreSelected = !PRIMARY_TYPES.includes(shownType as any);
  const typeGrid = (
    <div>
      {label('Type')}
      <div className={cn('grid gap-2', compact ? 'grid-cols-3' : 'grid-cols-2')}>
        {PRIMARY_TYPES.map((v) => {
          const t = ITEM_TYPES.find((x) => x.value === v)!;
          const text = compact && v === 'temperature' ? 'Temp' : v === 'temperature' ? 'Temp photo' : t.label;
          return typeBtn(v, text, t.Icon, shownType === v, () => pickType(v));
        })}
        {typeBtn('more', compact ? 'More' : 'More types', MoreHorizontal, moreSelected, () => setMoreOpen((o) => !o))}
      </div>
      {moreOpen && (
        <div className={cn('mt-2 grid gap-2', compact ? 'grid-cols-2' : 'grid-cols-2')}>
          {ITEM_TYPES.filter((t) => !PRIMARY_TYPES.includes(t.value as any)).map((t) => typeBtn(t.value, t.label, t.Icon, shownType === t.value, () => pickType(t.value)))}
        </div>
      )}
    </div>
  );

  const stepBtn = 'flex h-11 w-11 items-center justify-center rounded-full border border-border bg-card disabled:opacity-40';
  const photoStepper = !isSection && hasPhotoCount(item.item_type) && (
    <div className="flex min-h-11 items-center justify-between gap-3">
      <span className="text-sm font-semibold">Photos required</span>
      <div className="flex items-center gap-3">
        <button type="button" aria-label="Fewer photos" className={stepBtn} disabled={minPhotos(item) <= 1} onClick={() => applyShrinking({ ...item, options: { minPhotos: minPhotos(item) - 1 } })}><Minus className="h-4 w-4" /></button>
        <span className="w-5 text-center text-base font-bold" aria-live="polite">{minPhotos(item)}</span>
        <button type="button" aria-label="More photos" className={stepBtn} disabled={minPhotos(item) >= 6} onClick={() => applyShrinking({ ...item, options: { minPhotos: minPhotos(item) + 1 } })}><Plus className="h-4 w-4" /></button>
      </div>
    </div>
  );

  const extras = !isSection && (
    <>
      {showPosition && (
        <div className="flex min-h-11 items-center justify-between gap-3">
          <span className="text-sm font-semibold">Assigned to</span>
          <TaskAssigneePicker locationId={locationId} value={item} availablePositions={availablePositions} className="min-h-11 max-w-[60%]" onChange={(next) => set(next as Partial<EditorItem>)} />
        </div>
      )}
      {showAmPm && (
        <div className="flex min-h-11 items-center justify-between gap-3">
          <span className="text-sm font-semibold">Shift</span>
          <Select value={item.manager_shift || 'none'} onValueChange={(v) => set({ manager_shift: v === 'none' ? null : (v as 'am' | 'pm') })}>
            <SelectTrigger className="min-h-11 w-28"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">All</SelectItem>
              <SelectItem value="am">AM</SelectItem>
              <SelectItem value="pm">PM</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}
      {item.item_type === 'temperature' && (
        <label className="flex min-h-11 cursor-pointer items-center justify-between gap-3">
          <span>
            <span className="block text-sm font-semibold">Temp alerts</span>
            <span className="block text-sm text-muted-foreground">Alert managers on unsafe temps.</span>
          </span>
          <Switch checked={item.temperature_alert_enabled || false} onCheckedChange={(c) => set({ temperature_alert_enabled: c })} />
        </label>
      )}
      {item.item_type === 'multiple_choice' && (
        <div>
          {label('Options')}
          <Input value={Array.isArray(item.options) ? item.options.join(', ') : ''} onChange={(e) => set({ options: e.target.value.split(',').map((o) => o.trim()) })} placeholder="Options (comma-separated)" className="h-11" />
        </div>
      )}
      {item.item_type === 'prep_list' && (
        <div>
          {label('Prep list')}
          <PrepListEditor rows={item.prep_rows || []} onChange={(rows) => set({ prep_rows: rows })} locationId={locationId} />
        </div>
      )}
    </>
  );

  const pill = (key: 'photo' | 'link' | 'video', text: string, Icon: any, filled: boolean) => (
    <button
      type="button"
      aria-pressed={refOpen === key}
      onClick={() => setRefOpen((o) => (o === key ? null : key))}
      className={cn(
        'inline-flex min-h-11 items-center gap-1.5 rounded-full border px-4 text-sm font-medium',
        filled ? 'border-primary/40 bg-primary/10 text-primary' : 'border-border bg-card text-foreground',
        refOpen === key && 'ring-2 ring-primary/30',
      )}
    >
      {filled ? <Check className="h-4 w-4" /> : <Icon className="h-4 w-4" />}{text}
    </button>
  );

  const notesAndRef = !isSection && (
    <>
      <div>
        {label('Notes for the crew')}
        <NotesTextarea value={item.reference_notes || ''} onChange={(v) => set({ reference_notes: v })} placeholder="Instructions (optional)" rows={3} className="w-full" />
      </div>
      <div>
        {label('Reference')}
        <div className="flex flex-wrap gap-2">
          {pill('photo', 'Photo', Camera, photos.length > 0)}
          {pill('link', 'Link', LinkIcon, !!item.reference_link?.trim())}
          {pill('video', 'Video', Video, !!item.reference_video_url?.trim())}
        </div>
        {refOpen === 'photo' && (
          <div className="pt-3">
            <ReferencePhotoSlots urls={photos} slots={referenceSlotCount(item)} upload={uploadReference} onChange={(urls) => onChange(setReferencePhotos(item, urls))} />
          </div>
        )}
        {refOpen === 'link' && (
          <Input type="url" aria-label="Reference link" value={item.reference_link || ''} onChange={(e) => set({ reference_link: e.target.value })} placeholder="https://..." className="mt-3 h-11" />
        )}
        {refOpen === 'video' && (
          <Input type="url" aria-label="Reference video" value={item.reference_video_url || ''} onChange={(e) => set({ reference_video_url: e.target.value })} placeholder="https://youtube.com/..." className="mt-3 h-11" />
        )}
      </div>
    </>
  );

  const nameField = (
    <div>
      {label(isSection ? 'Section heading' : 'Task name')}
      <ChecklistMentionInput
        multiline
        rows={2}
        fieldProps={{ 'data-checklist-inspector-name': true, autoFocus: autoFocusName } as any}
        value={item.question}
        onChange={(v) => set({ question: v })}
        refs={item.link_refs || []}
        onRefsChange={(next) => set({ link_refs: next })}
        locationId={locationId}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onEnter(); }
        }}
        placeholder={isSection ? 'Section heading' : 'Task name — type @ to link'}
        className="min-h-11 resize-none text-base"
      />
    </div>
  );

  const duplicateBtn = (
    <Button type="button" variant="outline" className="h-11 flex-1 border border-border bg-card" onClick={onDuplicate}>
      <Copy className="mr-2 h-4 w-4" /> Duplicate
    </Button>
  );
  const deleteBtn = onRemove && (
    <Button type="button" variant="outline" className="h-11 flex-1 border border-destructive/40 bg-card text-destructive hover:text-destructive" onClick={onRemove}>
      <Trash2 className="mr-2 h-4 w-4" /> Delete
    </Button>
  );

  const body = compact ? (
    page === 'notes' ? (
      <div className="space-y-4">
        {header(<Button type="button" variant="ghost" size="icon" className="-ml-2 h-11 w-11" aria-label="Back to task" onClick={() => setPage('main')}><ChevronLeft className="h-5 w-5" /></Button>)}
        {notesAndRef}
        <div className="flex gap-2 border-t pt-4">{duplicateBtn}</div>
      </div>
    ) : (
      <div className="space-y-4">
        {header()}
        {nameField}
        {typeGrid}
        {photoStepper}
        {extras}
        <div className="flex gap-2">
          {!isSection ? (
            <Button type="button" variant="outline" className="h-11 flex-[2] border border-border bg-card" onClick={() => setPage('notes')}>Notes and reference</Button>
          ) : duplicateBtn}
          {deleteBtn}
        </div>
      </div>
    )
  ) : (
    <div className="space-y-4">
      {header()}
      {nameField}
      {typeGrid}
      {photoStepper}
      {extras}
      {notesAndRef}
      <div className="flex gap-2 border-t pt-4">{duplicateBtn}{deleteBtn}</div>
    </div>
  );

  return (
    <div>
      {body}
      <AlertDialog open={!!pending} onOpenChange={(o) => !o && setPending(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {pending?.drop} reference photo{pending && pending.drop > 1 ? 's' : ''}?</AlertDialogTitle>
            <AlertDialogDescription>
              This task will have fewer photo slots, so the last {pending && pending.drop > 1 ? `${pending.drop} reference photos` : 'reference photo'} will be removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDrop}>Remove</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
