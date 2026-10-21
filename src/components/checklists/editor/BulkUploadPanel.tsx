import { useMemo, useRef, useState } from 'react';
import { Loader2, Upload, X } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { itemsFromExtracted, parseBulkText, parseCsvTasks } from '@/lib/checklistBulkParse';
import type { EditorItem } from '@/lib/checklistEditorItems';
import { ITEM_TYPES, typeMeta } from './ChecklistItemInspector';
import { displayType } from '@/lib/checklistEditorItems';

const MAX_BYTES = 10 * 1024 * 1024;
const AI_TYPES = ['image/jpeg', 'image/png', 'image/heic', 'image/heif', 'application/pdf'];

interface Props {
  wide: boolean;
  locationId?: string | null;
  /** Shown only while the list is empty. */
  onStartNewInstead?: () => void;
  onCancel: () => void;
  onAdd: (items: EditorItem[]) => void;
}

const fileKind = (f: File) => {
  const n = f.name.toLowerCase();
  if (f.type === 'text/csv' || n.endsWith('.csv')) return 'csv';
  if (f.type === 'application/pdf' || n.endsWith('.pdf')) return 'pdf';
  if (f.type.startsWith('image/') || /\.(jpe?g|png|heic|heif)$/.test(n)) return 'photo';
  return null;
};

const mimeOf = (f: File) => {
  if (f.type && AI_TYPES.includes(f.type)) return f.type;
  const n = f.name.toLowerCase();
  if (n.endsWith('.pdf')) return 'application/pdf';
  if (n.endsWith('.png')) return 'image/png';
  if (n.endsWith('.heic') || n.endsWith('.heif')) return 'image/heic';
  return 'image/jpeg';
};

const toBase64 = (f: File) => new Promise<string>((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
  r.onerror = () => reject(r.error);
  r.readAsDataURL(f);
});

/** Rough page count from the PDF's page objects. */
async function pdfPages(f: File) {
  const t = await f.text();
  return (t.match(/\/Type\s*\/Page(?!s)/g) ?? []).length;
}

export function BulkUploadPanel({ wide, locationId, onStartNewInstead, onCancel, onAdd }: Props) {
  const [paste, setPaste] = useState('');
  const [fileItems, setFileItems] = useState<EditorItem[]>([]);
  const [edits, setEdits] = useState<Record<string, Partial<EditorItem>>>({});
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [file, setFile] = useState<File | null>(null);
  const [reading, setReading] = useState(false);
  const [fileNote, setFileNote] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Paste parse keeps stable keys per line so inline edits survive typing elsewhere.
  const pasteItems = useMemo(() => {
    const parsed = parseBulkText(paste);
    return parsed.map((it, i) => ({ ...it, _key: `paste-${i}-${it.question}` }));
  }, [paste]);

  const preview = [...fileItems, ...pasteItems]
    .filter((it) => !removed.has(it._key!))
    .map((it) => ({ ...it, ...edits[it._key!] }));
  const taskCount = preview.filter((it) => it.item_type !== 'section_header').length;

  const handleFile = async (f: File) => {
    setFile(f); setFileNote(null); setFileItems([]);
    const kind = fileKind(f);
    if (!kind) { setFileNote('That file type is not supported. Use a CSV, PDF, JPG, PNG or HEIC.'); return; }
    if (f.size > MAX_BYTES) { setFileNote('That file is over 10 MB. Try a smaller file, or paste the list instead.'); return; }
    if (kind === 'csv') {
      const { items, truncated } = parseCsvTasks(await f.text());
      setFileItems(items);
      if (!items.length) setFileNote('No tasks found in that CSV. Put one task per row in the first column.');
      else if (truncated) setFileNote('Only the first 500 rows were read.');
      return;
    }
    if (kind === 'pdf' && (await pdfPages(f)) > 10) { setFileNote('That PDF has more than 10 pages. Split it, or paste the list instead.'); return; }
    setReading(true);
    try {
      const { data, error } = await supabase.functions.invoke('ai-extraction-service?action=extract-checklist-tasks', {
        body: { fileBase64: await toBase64(f), mimeType: mimeOf(f), kind, locationId: locationId ?? null },
      });
      if (error) {
        let msg = 'Could not read that file. You can paste the list instead.';
        try { const b = await (error as any).context?.json?.(); if (b?.error) msg = b.error; } catch { /* keep default */ }
        setFileNote(msg);
        return;
      }
      const items = itemsFromExtracted(data?.tasks ?? []);
      setFileItems(items);
      if (!items.length) setFileNote("Couldn't find any tasks in that file. You can paste the list instead.");
    } catch {
      setFileNote('Could not read that file. You can paste the list instead.');
    } finally {
      setReading(false);
    }
  };

  const setEdit = (key: string, patch: Partial<EditorItem>) => setEdits((e) => ({ ...e, [key]: { ...e[key], ...patch } }));

  const add = () => {
    const out = preview
      .filter((it) => it.question.trim())
      .map((it) => {
        const { _key, ...rest } = it;
        const next: EditorItem = { ...rest, question: it.question.trim() };
        if (next.item_type === 'multiple_choice' && !Array.isArray(next.options)) next.options = ['Yes', 'No', 'N/A'];
        if (next.item_type !== 'multiple_choice' && Array.isArray(next.options)) next.options = undefined;
        return next;
      });
    onAdd(out);
  };

  const left = (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold">Upload a file</h3>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files?.[0]; if (f) void handleFile(f); }}
        className={cn('flex min-h-32 w-full flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed p-4 text-center', dragOver ? 'border-primary bg-primary/5' : 'border-border')}
      >
        {reading ? <Loader2 className="h-6 w-6 animate-spin text-primary" /> : <Upload className="h-6 w-6 text-primary" />}
        <span className="font-semibold">{reading ? 'Reading your list...' : file ? file.name : 'Choose a file'}</span>
        <span className="text-sm text-muted-foreground">{file && !reading ? 'Tap to choose a different file' : 'CSV, PDF or a photo of a printed list'}</span>
      </button>
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        accept=".csv,text/csv,application/pdf,.pdf,image/jpeg,image/png,image/heic,image/heif,.heic,.heif"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleFile(f); e.target.value = ''; }}
      />
      {fileNote && <p role="status" className="text-sm text-destructive">{fileNote}</p>}
      <div className="space-y-1">
        <label htmlFor="bulk-paste" className="text-sm font-semibold">Or paste your list, one task per line</label>
        <Textarea id="bulk-paste" value={paste} onChange={(e) => setPaste(e.target.value)} rows={wide ? 10 : 6} className="text-base" placeholder={'Photo: Prep station\nTemp: Walk-in cooler\nWipe tables'} />
        <p className="text-sm text-muted-foreground">Start a line with Photo:, Temp:, Text: or Choice: to set its type. Any other line becomes a checkmark task.</p>
      </div>
    </div>
  );

  const right = (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold">What will be added · {taskCount} task{taskCount === 1 ? '' : 's'}</h3>
      <div className="overflow-hidden rounded-2xl border bg-card">
        {preview.length === 0 && <p className="px-3 py-6 text-center text-sm text-muted-foreground">Nothing yet. Choose a file or paste a list.</p>}
        {preview.map((it) => {
          const k = it._key!;
          const isSection = it.item_type === 'section_header';
          const meta = typeMeta(it.item_type);
          return (
            <div key={k} className={cn('flex min-h-11 items-center gap-2 border-b px-3 py-2 last:border-b-0', isSection && 'bg-muted')}>
              {!isSection && <meta.Icon className="h-5 w-5 shrink-0 text-primary" aria-hidden />}
              {editingKey === k ? (
                <Input
                  autoFocus
                  defaultValue={it.question}
                  aria-label="Task name"
                  className="h-10 flex-1"
                  onBlur={(e) => { setEdit(k, { question: e.target.value }); setEditingKey(null); }}
                  onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                />
              ) : (
                <button type="button" onClick={() => setEditingKey(k)} className={cn('min-h-10 min-w-0 flex-1 break-words text-left', isSection ? 'text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground' : 'text-[15px] font-semibold')}>
                  {isSection ? `Section · ${it.question}` : it.question}
                </button>
              )}
              <Select value={displayType(it.item_type)} onValueChange={(v: any) => setEdit(k, { item_type: v, is_required: v !== 'section_header' })}>
                <SelectTrigger aria-label="Task type" className="h-10 w-auto shrink-0 border-0 bg-transparent px-1 text-sm text-muted-foreground shadow-none">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ITEM_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                </SelectContent>
              </Select>
              <Button type="button" variant="ghost" size="icon" className="h-11 w-11 shrink-0" aria-label={`Remove ${it.question}`} onClick={() => setRemoved((s) => new Set(s).add(k))}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          );
        })}
      </div>
      <p className="text-sm text-muted-foreground">Check the list before adding. You can change any task's type afterwards.</p>
    </div>
  );

  return (
    <div className="rounded-2xl border bg-card p-3 md:p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">Bulk Upload</h2>
        {onStartNewInstead && (
          <Button type="button" variant="ghost" className="h-11 px-2 text-primary" onClick={onStartNewInstead}>Start New Checklist instead</Button>
        )}
      </div>
      <div className={cn('gap-4', wide ? 'grid grid-cols-2 items-start' : 'space-y-5')}>
        {left}
        {right}
      </div>
      <div className="mt-4 flex gap-2 border-t pt-3">
        <Button type="button" variant="outline" className="h-11 flex-1 border border-border bg-card" onClick={onCancel}>Cancel</Button>
        <Button type="button" className="h-11 flex-1" disabled={taskCount === 0 || reading} onClick={add}>
          Add {taskCount} task{taskCount === 1 ? '' : 's'}
        </Button>
      </div>
    </div>
  );
}
