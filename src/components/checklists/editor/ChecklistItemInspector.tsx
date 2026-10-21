import { useState } from 'react';
import { Copy, Trash2, Link as LinkIcon, Video, CheckSquare, Type, Hash, Camera, Thermometer, List, ClipboardList, Heading, ShieldCheck } from 'lucide-react';
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
}

export function ChecklistItemInspector({ item, onChange, onEnter, onDuplicate, onRemove, locationId, showAmPm, showPosition, availablePositions, uploadReference, autoFocusName }: Props) {
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

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <Label>{isSection ? 'Section heading' : 'Task name'}</Label>
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
          className="min-h-11 resize-none"
        />
        <p className="text-sm text-muted-foreground">Type @ to link a recipe, log, role or teammate. Enter adds the next task.</p>
      </div>

      <div className="space-y-1">
        <Label>Type</Label>
        <Select
          value={shownType}
          onValueChange={(v) => {
            if (v === shownType) return;
            applyShrinking({ ...item, item_type: v });
          }}
        >
          <SelectTrigger className="min-h-11"><SelectValue /></SelectTrigger>
          <SelectContent>
            {ITEM_TYPES.map(({ value, label, Icon }) => (
              <SelectItem key={value} value={value}><span className="flex items-center gap-2"><Icon className="h-4 w-4" /> {label}</span></SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {!isSection && showPosition && (
        <div className="space-y-1">
          <Label>Assigned to</Label>
          <TaskAssigneePicker
            locationId={locationId}
            value={item}
            availablePositions={availablePositions}
            className="min-h-11 w-full"
            onChange={(next) => set(next as Partial<EditorItem>)}
          />
        </div>
      )}

      {!isSection && showAmPm && (
        <div className="space-y-1">
          <Label>Shift</Label>
          <Select value={item.manager_shift || 'none'} onValueChange={(v) => set({ manager_shift: v === 'none' ? null : (v as 'am' | 'pm') })}>
            <SelectTrigger className="min-h-11"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">All</SelectItem>
              <SelectItem value="am">AM</SelectItem>
              <SelectItem value="pm">PM</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}

      {!isSection && hasPhotoCount(item.item_type) && (
        <div className="space-y-1">
          <Label>Photos required</Label>
          <Select value={String(minPhotos(item))} onValueChange={(v) => applyShrinking({ ...item, options: { minPhotos: parseInt(v) } })}>
            <SelectTrigger className="min-h-11"><SelectValue /></SelectTrigger>
            <SelectContent>
              {[1, 2, 3, 4, 5, 6].map((n) => <SelectItem key={n} value={String(n)}>{n} photo{n > 1 ? 's' : ''}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      )}

      {!isSection && item.item_type === 'temperature' && (
        <label className="flex items-center justify-between gap-3 min-h-11 cursor-pointer">
          <span>
            <span className="block text-sm font-medium">Temp alerts</span>
            <span className="block text-sm text-muted-foreground">Alert managers on unsafe temps.</span>
          </span>
          <Switch checked={item.temperature_alert_enabled || false} onCheckedChange={(c) => set({ temperature_alert_enabled: c })} />
        </label>
      )}

      {!isSection && item.item_type === 'multiple_choice' && (
        <div className="space-y-1">
          <Label>Options</Label>
          <Input
            value={Array.isArray(item.options) ? item.options.join(', ') : ''}
            onChange={(e) => set({ options: e.target.value.split(',').map((o) => o.trim()) })}
            placeholder="Options (comma-separated)"
          />
        </div>
      )}

      {!isSection && item.item_type === 'prep_list' && (
        <div className="space-y-1">
          <Label>Prep list</Label>
          <PrepListEditor rows={item.prep_rows || []} onChange={(rows) => set({ prep_rows: rows })} locationId={locationId} />
        </div>
      )}

      {!isSection && (
        <div className="space-y-1">
          <Label>Reference photos</Label>
          <ReferencePhotoSlots
            urls={photos}
            slots={referenceSlotCount(item)}
            upload={uploadReference}
            onChange={(urls) => onChange(setReferencePhotos(item, urls))}
          />
        </div>
      )}

      {!isSection && (
        <>
          <div className="space-y-1">
            <Label>Notes</Label>
            <NotesTextarea value={item.reference_notes || ''} onChange={(v) => set({ reference_notes: v })} placeholder="Instructions / notes (optional)" rows={2} className="w-full" />
          </div>
          <div className="space-y-1">
            <Label className="flex items-center gap-1"><LinkIcon className="h-3.5 w-3.5" /> Link</Label>
            <Input type="url" value={item.reference_link || ''} onChange={(e) => set({ reference_link: e.target.value })} placeholder="https://..." />
          </div>
          <div className="space-y-1">
            <Label className="flex items-center gap-1"><Video className="h-3.5 w-3.5" /> Video</Label>
            <Input type="url" value={item.reference_video_url || ''} onChange={(e) => set({ reference_video_url: e.target.value })} placeholder="https://youtube.com/..." />
          </div>
        </>
      )}

      <div className="flex gap-2 border-t pt-4">
        <Button type="button" variant="outline" className="h-11 flex-1" onClick={onDuplicate}>
          <Copy className="h-4 w-4 mr-2" /> Duplicate
        </Button>
        {onRemove && (
          <Button type="button" variant="outline" className="h-11 flex-1 text-destructive" onClick={onRemove}>
            <Trash2 className="h-4 w-4 mr-2" /> Remove
          </Button>
        )}
      </div>

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
