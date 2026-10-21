// Phase E run screen: list first, guided one-by-one on tap.
// Presentation only: every save goes through the handlers the page passes in.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Camera, Check, ChevronLeft, ChevronRight, Eye, FileText, Image as ImageIcon, Link as LinkIcon, BookOpen, Pencil, Video, RotateCcw, PlayCircle } from 'lucide-react';
import { cn, formatTime12Hour } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { DateTime } from 'luxon';
import { PhotoPickerButton } from '@/components/PhotoPickerButton';
import { ChecklistQuestionText } from '@/components/tasks/ChecklistQuestionText';
import { InlineVideoPlayer } from '@/components/ui/inline-video-player';
import { parseLinkRefs, type ChecklistLinkRef } from '@/lib/checklistLinks';
import { getReferencePhotos } from '@/lib/checklistReferencePhotos';

export interface RunItem {
  id: string;
  question: string;
  item_type: string;
  options: any;
  is_required: boolean;
  requires_temperature_validation?: boolean;
  reference_image_url?: string;
  reference_image_urls?: string[];
  reference_link?: string;
  reference_video_url?: string;
  reference_notes?: string;
  manager_shift?: string | null;
  link_refs?: any;
}

export interface RunSection { key: string; label: string; items: RunItem[] }

export interface Completer { userId: string; fullName: string; profilePhoto: string | null; completedAt: string }

export interface RunCtx {
  title: string;
  description?: string | null;
  doneCount: number;
  totalCount: number;
  hideDone: boolean;
  setHideDone: (v: boolean) => void;
  myTasks?: { label: string; on: boolean; set: (v: boolean) => void } | null;
  sections: RunSection[];
  isDone: (it: RunItem) => boolean;
  needsTemp: (it: RunItem) => boolean;
  photos: (it: RunItem) => string[];
  minPhotos: (it: RunItem) => number;
  uploading: (id: string) => boolean;
  value: (id: string) => any;
  savedValue: (id: string) => any;
  setValue: (id: string, v: any) => void;
  check: (id: string) => void;
  choose: (id: string, v: string) => void;
  submit: (id: string, v: string) => void;
  upload: (id: string, file: File, index?: number) => void;
  reading: (id: string) => { temp: number | null | undefined; valid: boolean | null | undefined; editedBy?: string | null; unconfirmed?: boolean };
  tempOpen: (id: string) => boolean;
  setTempOpen: (id: string, open: boolean) => void;
  tempValue: (id: string) => string;
  setTempValue: (id: string, v: string) => void;
  saveTemp: (id: string) => void;
  completer: (id: string) => Completer | undefined;
  canUndo: (id: string) => boolean;
  undo: (id: string) => void;
  preview: (url: string) => void;
  /** Full-size viewer stepped through a set of photos (falls back to preview when absent). */
  previewMany?: (urls: string[], index: number) => void;
  openLink: (ref: ChecklistLinkRef) => void;
  renderPrep: (it: RunItem) => ReactNode;
  renderApproval: (it: RunItem) => ReactNode;
  /** Prep lists report their own completion while mounted; kept mounted off-screen. */
  prepStatus: (it: RunItem, skip: boolean) => ReactNode;
  footer?: ReactNode;
  onBack: () => void;
}

// ---------- type helpers ----------
const isCheck = (t: string) => t === 'confirmation' || t === 'CHECKMARK' || t === 'CHECKBOX';
const isPhotoType = (t: string) => t === 'image' || t === 'PHOTO' || t === 'temperature';
export const isTempTask = (it: RunItem) => it.item_type === 'temperature' || ((it.item_type === 'image' || it.item_type === 'PHOTO') && it.requires_temperature_validation === true);
const walkable = (it: RunItem) => it.item_type !== 'section_header';
const counted = (it: RunItem) => it.item_type !== 'section_header' && it.item_type !== 'manager_approval';

function attachments(it: RunItem) {
  const refs = getReferencePhotos(it as any);
  const links = parseLinkRefs(it.link_refs);
  return {
    refs,
    notes: !!it.reference_notes?.trim(),
    video: !!it.reference_video_url?.trim(),
    link: !!it.reference_link?.trim(),
    recipes: links.filter((l) => l.type === 'recipe'),
    links,
  };
}
const hasAttachments = (it: RunItem) => {
  const a = attachments(it);
  return a.refs.length > 0 || a.notes || a.video || a.link || a.links.length > 0;
};
/** Plain checkmark with nothing attached: completes right in the list. */
const isOneTap = (it: RunItem) => isCheck(it.item_type) && !hasAttachments(it);

function typeLabel(it: RunItem, min: number) {
  if (isTempTask(it)) return 'Temp photo';
  if (isPhotoType(it.item_type)) return min > 1 ? `${min} photos` : 'Photo';
  switch (it.item_type) {
    case 'multiple_choice': return 'Pick one';
    case 'number': return 'Number';
    case 'text': return 'Text';
    case 'prep_list': return 'Prep list';
    case 'manager_approval': return 'Manager approval';
    default: return 'Checkmark';
  }
}

function subText(it: RunItem, ctx: RunCtx) {
  const min = ctx.minPhotos(it);
  if (isTempTask(it)) return 'Temp photo';
  if (isPhotoType(it.item_type)) {
    const n = ctx.photos(it).length;
    return min > 1 ? (n > 0 ? `Photo · ${n} of ${min} taken` : `Photo · ${min} needed`) : 'Photo';
  }
  if (it.item_type === 'manager_approval') return 'Manager sign-off';
  if (it.item_type === 'multiple_choice') return 'Pick one';
  if (it.item_type === 'number') return 'Number';
  if (it.item_type === 'text') return 'Text';
  if (it.item_type === 'prep_list') return 'Prep list';
  if (isCheck(it.item_type)) return isOneTap(it) ? '' : 'Checkmark';
  return typeLabel(it, min);
}

const shortName = (full: string) => {
  const p = full.trim().split(/\s+/);
  return `${p[0] ?? ''}${p[1] ? ` ${p[1][0]}.` : ''}`;
};
const timeOf = (iso: string) => formatTime12Hour(new Date(iso).toTimeString().slice(0, 5));

// ---------- small pieces ----------
function useContentWidth(ref: React.RefObject<HTMLElement>) {
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const apply = () => setW(el.clientWidth);
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return w;
}

function ProgressBar({ done, total }: { done: number; total: number }) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const full = total > 0 && done >= total;
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={done} aria-valuemin={0} aria-valuemax={total} aria-label={`${done} of ${total} done`}>
      <div className={cn('h-full rounded-full transition-[width] duration-300', full ? 'bg-[hsl(var(--success))]' : 'bg-primary')} style={{ width: `${pct}%` }} />
    </div>
  );
}

/** Reading + the same edit button as before (amber "?" when none). */
export function TempReadingChip({ temp, valid, onEdit, canEdit }: { temp: number | null | undefined; valid: boolean | null | undefined; onEdit: () => void; canEdit: boolean }) {
  const has = temp != null;
  const tone = !has ? 'warn' : valid === false ? 'bad' : 'good';
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5">
      <span
        className={cn(
          'inline-flex h-6 items-center rounded-full px-2 text-xs font-semibold tabular-nums',
          tone === 'good' && 'bg-[hsl(var(--success)/0.12)] text-[hsl(var(--success))]',
          tone === 'bad' && 'bg-destructive/10 text-destructive',
          tone === 'warn' && 'bg-[hsl(var(--warning)/0.14)] text-[hsl(var(--warning))]',
        )}
        aria-label={has ? `${Number(temp).toFixed(1)} degrees` : 'No reading'}
      >
        {has ? `${Number(temp).toFixed(1)}°F` : '?°F'}
      </span>
      {canEdit && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onEdit(); }}
          aria-label={has ? 'Edit temperature' : 'Enter temperature'}
          className="-m-2 flex h-11 w-11 items-center justify-center"
        >
          <span className={cn(
            'flex h-7 w-7 items-center justify-center rounded-full',
            tone === 'good' && 'bg-[hsl(var(--success)/0.14)] text-[hsl(var(--success))]',
            tone === 'bad' && 'bg-destructive/10 text-destructive',
            tone === 'warn' && 'bg-[hsl(var(--warning)/0.16)] text-[hsl(var(--warning))]',
          )}><Pencil className="h-3.5 w-3.5" /></span>
        </button>
      )}
    </span>
  );
}

function TempInput({ ctx, id, autoFocus, onCancel }: { ctx: RunCtx; id: string; autoFocus?: boolean; onCancel?: () => void }) {
  return (
    <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
      <div className="relative">
        <Input
          type="number"
          inputMode="decimal"
          aria-label="Temperature in °F"
          autoFocus={autoFocus}
          value={ctx.tempValue(id)}
          onChange={(e) => ctx.setTempValue(id, e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); ctx.saveTemp(id); } }}
          className="h-11 w-28 pr-9 text-base"
        />
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">°F</span>
      </div>
      <Button type="button" className="h-11 px-4" onClick={() => ctx.saveTemp(id)}>Save</Button>
      {onCancel && <Button type="button" variant="ghost" className="h-11 px-3" onClick={onCancel}>Cancel</Button>}
    </div>
  );
}

function CompleterPill({ ctx, id }: { ctx: RunCtx; id: string }) {
  const c = ctx.completer(id);
  const can = ctx.canUndo(id);
  const inner = (
    <>
      {c && (
        <>
          <Avatar className="h-6 w-6 shrink-0">
            <AvatarImage src={c.profilePhoto || undefined} />
            <AvatarFallback className="text-[10px]">{c.fullName.split(' ').map((n) => n[0]).join('')}</AvatarFallback>
          </Avatar>
          <span className="truncate text-sm text-muted-foreground">{shortName(c.fullName)} · {timeOf(c.completedAt)}</span>
        </>
      )}
    </>
  );
  const cls = 'inline-flex min-h-6 max-w-full items-center gap-1.5';
  return (
    <span className="inline-flex min-w-0 items-center gap-2">
      {can ? (
        <button type="button" onClick={(e) => { e.stopPropagation(); ctx.undo(id); }} aria-label={`Undo completion${c ? ` by ${c.fullName}` : ''}`} className={cn(cls, 'active:scale-95 transition-transform')}>{inner}</button>
      ) : (
        <span className={cls}>{inner}</span>
      )}
    </span>
  );
}

function Markers({ it }: { it: RunItem }) {
  const a = attachments(it);
  const m: { Icon: any; text: string }[] = [];
  if (a.refs.length) m.push({ Icon: Eye, text: `${a.refs.length} reference` });
  if (a.notes) m.push({ Icon: FileText, text: 'Notes' });
  if (a.video) m.push({ Icon: Video, text: 'Video' });
  if (a.link) m.push({ Icon: LinkIcon, text: 'Link' });
  if (a.recipes.length) m.push({ Icon: BookOpen, text: a.recipes.length > 1 ? `${a.recipes.length} recipes` : 'Recipe' });
  if (!m.length) return null;
  return (
    <span className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
      {m.map(({ Icon, text }) => (
        <span key={text} className="inline-flex items-center gap-1 text-xs text-muted-foreground"><Icon className="h-3 w-3" />{text}</span>
      ))}
    </span>
  );
}

function ShiftTag({ it }: { it: RunItem }) {
  if (it.manager_shift !== 'am' && it.manager_shift !== 'pm') return null;
  return <span className="inline-flex rounded-full border px-1.5 py-px align-middle text-[10px] font-semibold leading-4 text-muted-foreground">{it.manager_shift === 'am' ? '☀ AM' : '☾ PM'}</span>;
}

function Name({ it, ctx, className }: { it: RunItem; ctx: RunCtx; className?: string }) {
  return (
    <span className={className}>
      <ChecklistQuestionText text={it.question || ''} refs={parseLinkRefs(it.link_refs)} onOpen={ctx.openLink} />
    </span>
  );
}

const initialsOf = (full: string) => full.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase();
/** "6:21 AM · Mon Oct 19" — time first, then the day. */
const completedWhen = (iso: string) => {
  const d = DateTime.fromISO(iso);
  return d.isValid ? `${timeOf(iso)} · ${d.toFormat('ccc LLL d')}` : timeOf(iso);
};

function PhotoIcon({ ctx, it }: { ctx: RunCtx; it: RunItem }) {
  const ph = ctx.photos(it);
  if (!ph.length) return null;
  return (
    <button type="button" aria-label={ph.length > 1 ? `See ${ph.length} photos` : 'See photo'} className="relative -m-2 flex h-11 w-11 shrink-0 items-center justify-center"
      onClick={(e) => { e.stopPropagation(); ctx.previewMany ? ctx.previewMany(ph, 0) : ctx.preview(ph[0]); }}>
      <span className="flex h-[22px] w-[22px] items-center justify-center rounded-full border border-border bg-card text-muted-foreground"><ImageIcon className="h-3 w-3" /></span>
      {ph.length > 1 && <span className="absolute right-0.5 top-0.5 min-w-4 rounded-full bg-primary px-1 text-center text-[10px] font-bold leading-4 text-primary-foreground">{ph.length}</span>}
    </button>
  );
}

// ---------- list rows ----------
function Row({ it, ctx, wide, onOpen, flash }: { it: RunItem; ctx: RunCtx; wide: boolean; onOpen: () => void; flash: boolean }) {
  const done = ctx.isDone(it);
  const amber = ctx.needsTemp(it);
  const oneTap = isOneTap(it);
  const temp = isTempTask(it);
  const photo = isPhotoType(it.item_type) || temp;
  const pressTimer = useRef<number | null>(null);

  const tap = () => {
    if (done) { onOpen(); return; }
    if (oneTap) ctx.check(it.id); else onOpen();
  };
  const longPressStart = () => {
    if (pressTimer.current) window.clearTimeout(pressTimer.current);
    pressTimer.current = window.setTimeout(() => { pressTimer.current = null; onOpen(); }, 550);
  };
  const longPressEnd = () => { if (pressTimer.current) { window.clearTimeout(pressTimer.current); pressTimer.current = null; } };

  const badTemp = done && temp && !amber && ctx.reading(it.id).valid === false;
  const doneDot = <span className={cn('flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-primary-foreground', badTemp ? 'bg-destructive' : 'bg-[hsl(var(--success))]', flash && 'animate-in zoom-in-50 duration-300')} aria-hidden><Check className="h-3.5 w-3.5" strokeWidth={3} /></span>;
  let circle: ReactNode;
  if (amber) circle = <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[hsl(var(--warning))] text-sm font-bold text-primary-foreground" aria-hidden>!</span>;
  else if (done) circle = ctx.canUndo(it.id)
    ? <button type="button" onClick={(e) => { e.stopPropagation(); ctx.undo(it.id); }} aria-label={`Undo ${it.question}`} className="-m-2.5 flex h-11 w-11 items-center justify-center">{doneDot}</button>
    : doneDot;
  else circle = <span className="h-7 w-7 shrink-0 rounded-full border-2 border-muted-foreground/40" aria-hidden />;

  const photos = done && photo && !temp ? ctx.photos(it) : [];
  const r = temp ? ctx.reading(it.id) : null;
  const savedNum = done && it.item_type === 'number' ? String(ctx.savedValue(it.id) ?? ctx.value(it.id) ?? '') : '';
  const who = done && !amber ? ctx.completer(it.id) : undefined;

  // Right side when not done.
  let right: ReactNode = null;
  if (!done && !amber) {
    if (oneTap) right = <span className="shrink-0 text-sm text-muted-foreground">Tap to complete</span>;
    else if (wide && photo) right = (
      <span className="flex shrink-0 items-center gap-2" onClick={(e) => e.stopPropagation()}>
        {temp && !ctx.tempOpen(it.id) && (
          <button type="button" className="min-h-11 px-2 text-sm text-muted-foreground underline-offset-2 hover:underline" onClick={() => ctx.setTempOpen(it.id, true)}>Type it instead</button>
        )}
        {ctx.uploading(it.id) ? (
          <span className="text-sm text-primary">Uploading…</span>
        ) : (
          <PhotoPickerButton direct="camera" onFileSelected={(f) => ctx.upload(it.id, f)}>
            <span className="inline-flex h-11 items-center gap-1.5 rounded-xl border border-border bg-card px-3 text-sm font-medium"><Camera className="h-4 w-4" />Take photo</span>
          </PhotoPickerButton>
        )}
      </span>
    );
    else right = <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />;
  }

  // Done row: one line — check, title, reading (temp/number), time, avatar, chevron.
  if (done && !amber) {
    const readingText = temp ? (r && r.temp != null ? `${Number(r.temp).toFixed(1)}°F` : '?°F') : savedNum;
    return (
      <div className={cn('border-b border-border last:border-b-0', badTemp ? 'bg-destructive/[0.06]' : 'bg-card')}>
        <div
          role="button"
          tabIndex={0}
          aria-label={`${it.question}, done`}
          onClick={tap}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); tap(); } }}
          className="flex w-full cursor-pointer items-center gap-1.5 py-3 pl-3 pr-[10px] text-left"
        >
          <span className="flex shrink-0">{circle}</span>
          <span className="min-w-0 flex-1">
            <Name it={it} ctx={ctx} className="block break-words text-base font-bold leading-snug" />
            {photos.length > 0 && (
              <span className="mt-[5px] flex flex-wrap gap-1">
                {photos.map((u, i) => (
                  <button key={i} type="button" onClick={(e) => { e.stopPropagation(); ctx.previewMany ? ctx.previewMany(photos, i) : ctx.preview(u); }} aria-label={`See photo ${i + 1}`} className="h-[34px] w-[34px] overflow-hidden rounded-md border">
                    <img src={u} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
                  </button>
                ))}
              </span>
            )}
          </span>
          {readingText && (
            <span className={cn('shrink-0 text-right text-base font-bold tabular-nums', badTemp ? 'text-destructive' : temp && r && r.temp == null && 'text-[hsl(var(--warning))]')}>{readingText}</span>
          )}
          {who && <span className="w-[52px] shrink-0 whitespace-nowrap text-right text-[11.5px] text-muted-foreground">{timeOf(who.completedAt)}</span>}
          {who && (
            <Avatar className="h-10 w-10 shrink-0">
              <AvatarImage src={who.profilePhoto || undefined} />
              <AvatarFallback className="bg-secondary text-xs font-semibold text-secondary-foreground">{initialsOf(who.fullName)}</AvatarFallback>
            </Avatar>
          )}
          <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn('border-b border-border last:border-b-0', amber ? 'bg-[hsl(var(--warning)/0.08)]' : 'bg-card')}
    >
      <div
        role="button"
        tabIndex={0}
        aria-label={it.question}
        onClick={tap}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); tap(); } }}
        onPointerDown={!oneTap ? longPressStart : undefined}
        onPointerUp={longPressEnd}
        onPointerLeave={longPressEnd}
        className="flex w-full cursor-pointer flex-wrap items-start gap-x-3 px-3 py-2.5 text-left"
      >
        <span className="flex shrink-0">{circle}</span>
        <span className="min-w-0 flex-1 pt-[3px]">
          <Name it={it} ctx={ctx} className="block break-words text-[15px] font-semibold leading-snug" />
          {amber ? (
            <span className="mt-0.5 block text-sm text-[hsl(var(--warning))]">Photo saved. Type the temperature.</span>
          ) : (
            <>
              {(subText(it, ctx) || it.manager_shift === 'am' || it.manager_shift === 'pm') && (
                <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">{subText(it, ctx) && <span>{subText(it, ctx)}</span>}<ShiftTag it={it} /></span>
              )}
              <Markers it={it} />
            </>
          )}
          {ctx.tempOpen(it.id) && temp && !amber && (
            <span className="mt-2 block"><TempInput ctx={ctx} id={it.id} autoFocus onCancel={() => ctx.setTempOpen(it.id, false)} /></span>
          )}
          {amber && <span className="mt-2 flex items-center gap-3"><TempInput ctx={ctx} id={it.id} /><PhotoIcon ctx={ctx} it={it} /></span>}
        </span>
        {right && <span className="flex min-h-7 items-center self-center">{right}</span>}
      </div>
    </div>
  );
}

// ---------- guided card ----------
function PhotoSlot({ url, label, onTake, uploading, onPreview, active, onRetake }: { url?: string; label: string; onTake: (f: File) => void; uploading?: boolean; onPreview?: () => void; active?: boolean; onRetake?: (f: File) => void }) {
  if (url) {
    return (
      <div className="relative aspect-square max-h-[30vh] w-full overflow-hidden rounded-xl border">
        <button type="button" className="block h-full w-full" onClick={onPreview} aria-label="See photo full size">
          <img src={url} alt="" className="h-full w-full object-cover" loading="lazy" decoding="async" />
        </button>
        <span className="absolute left-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-[hsl(var(--success))] text-primary-foreground"><Check className="h-3.5 w-3.5" strokeWidth={3} /></span>
        {onRetake && (
          <PhotoPickerButton direct="camera" onFileSelected={onRetake} className="!absolute bottom-1.5 right-1.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-background/90 shadow" aria-label="Retake photo"><RotateCcw className="h-4 w-4" /></span>
          </PhotoPickerButton>
        )}
      </div>
    );
  }
  if (uploading && active) {
    return (
      <div className="flex aspect-square max-h-[30vh] w-full flex-col items-center justify-center rounded-xl border-2 border-dashed border-primary/50 bg-primary/5">
        <div className="mb-1 h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        <span className="text-xs text-primary">Uploading…</span>
      </div>
    );
  }
  const body = (
    <div className={cn('flex aspect-square max-h-[30vh] min-h-24 w-full flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed', active ? 'border-primary/50 text-primary' : 'border-muted-foreground/30 text-muted-foreground')}>
      <Camera className="h-6 w-6" />
      <span className="text-sm font-medium">{label}</span>
    </div>
  );
  return active ? <PhotoPickerButton direct="camera" onFileSelected={onTake} className="block w-full">{body}</PhotoPickerButton> : body;
}

function TakeButtons({ ctx, it, label, withLibrary = true }: { ctx: RunCtx; it: RunItem; label: string; withLibrary?: boolean }) {
  const busy = ctx.uploading(it.id);
  if (busy) return <div className="flex h-12 items-center justify-center gap-2 rounded-xl border-2 border-dashed border-primary/40 text-sm text-primary"><span className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />Uploading…</div>;
  return (
    <div className="space-y-2">
      <PhotoPickerButton direct="camera" onFileSelected={(f) => ctx.upload(it.id, f)} className="block w-full">
        <span className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary text-base font-semibold text-primary-foreground"><Camera className="h-5 w-5" />{label}</span>
      </PhotoPickerButton>
      {withLibrary && (
        <PhotoPickerButton direct="library" onFileSelected={(f) => ctx.upload(it.id, f)} className="block w-full">
          <span className="flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-border bg-card text-base font-medium"><ImageIcon className="h-5 w-5" />From library</span>
        </PhotoPickerButton>
      )}
    </div>
  );
}

const capLabel = 'text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground';

function NotesPanel({ it }: { it: RunItem }) {
  if (!it.reference_notes?.trim()) return null;
  return <div className="whitespace-pre-wrap rounded-xl bg-muted p-3 text-[15px] leading-relaxed">{it.reference_notes}</div>;
}

function ReferenceRows({ it, ctx, showPhotos }: { it: RunItem; ctx: RunCtx; showPhotos: boolean }) {
  const a = attachments(it);
  const [videoOpen, setVideoOpen] = useState(false);
  const rows: { key: string; Icon: any; title: string; sub: string; on: () => void }[] = [];
  if (a.video) rows.push({ key: 'video', Icon: PlayCircle, title: 'Watch the video', sub: 'Video', on: () => setVideoOpen((o) => !o) });
  if (a.link) rows.push({ key: 'link', Icon: LinkIcon, title: 'Open the SOP', sub: 'Link', on: () => window.open(it.reference_link!, '_blank', 'noopener,noreferrer') });
  for (const r of a.links) rows.push({ key: `${r.type}:${r.id}`, Icon: r.type === 'recipe' ? BookOpen : LinkIcon, title: r.type === 'recipe' ? `Recipe: ${r.label}` : r.label, sub: 'Opens over the checklist', on: () => ctx.openLink(r) });
  if (showPhotos) a.refs.forEach((u, i) => rows.push({ key: `ref${i}`, Icon: Eye, title: a.refs.length > 1 ? `Reference photo ${i + 1}` : 'Reference photo', sub: 'Tap to see full size', on: () => ctx.preview(u) }));
  if (!rows.length) return null;
  return (
    <div>
      <div className={cn(capLabel, 'mb-1.5')}>{a.video ? 'Training' : 'Reference'}</div>
      <div className="overflow-hidden rounded-xl border">
        {rows.map((r) => (
          <div key={r.key} className="border-b last:border-b-0">
            <button type="button" onClick={r.on} className="flex min-h-14 w-full items-center gap-3 px-3 py-2 text-left">
              <r.Icon className="h-5 w-5 shrink-0 text-primary" />
              <span className="min-w-0 flex-1">
                <span className="block break-words text-[15px] font-medium">{r.title}</span>
                <span className="block text-sm text-muted-foreground">{r.sub}</span>
              </span>
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
            </button>
            {r.key === 'video' && videoOpen && <div className="px-3 pb-3"><InlineVideoPlayer url={it.reference_video_url!} title={it.question} lazy={false} /></div>}
          </div>
        ))}
      </div>
    </div>
  );
}

function DoneBanner({ ctx, it }: { ctx: RunCtx; it: RunItem }) {
  if (!ctx.isDone(it)) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl bg-[hsl(var(--success)/0.08)] p-2.5">
      <span className="text-sm font-semibold text-[hsl(var(--success))]">Done</span>
      <CompleterPill ctx={ctx} id={it.id} />
    </div>
  );
}

function GuidedBody({ it, ctx }: { it: RunItem; ctx: RunCtx }) {
  const done = ctx.isDone(it);
  const min = ctx.minPhotos(it);
  const photos = ctx.photos(it);
  const refs = getReferencePhotos(it as any);
  const temp = isTempTask(it);
  const [notesOpen, setNotesOpen] = useState(false);
  const [draft, setDraft] = useState<string>(() => String(ctx.value(it.id) ?? ''));

  if (it.item_type === 'prep_list') return <>{ctx.renderPrep(it)}</>;
  if (it.item_type === 'manager_approval') return <>{ctx.renderApproval(it)}</>;

  if (temp) {
    const r = ctx.reading(it.id);
    const has = r.temp != null;
    const shot = photos[0];
    const tone = !has ? 'warn' : r.valid === false ? 'bad' : 'good';
    const editOpen = ctx.tempOpen(it.id);
    const openEdit = () => { ctx.setTempValue(it.id, has ? String(r.temp) : ''); ctx.setTempOpen(it.id, true); };
    return (
      <div className="space-y-3">
        <NotesPanel it={it} />
        {shot ? (
          <button type="button" onClick={() => ctx.preview(shot)} className="block w-full overflow-hidden rounded-xl border" aria-label="See photo full size">
            <img src={shot} alt="Your temperature photo" className="max-h-72 w-full object-cover" />
          </button>
        ) : (
          <div className="[&_.aspect-square]:aspect-[4/3] [&_.aspect-square]:max-h-[22vh]"><PhotoSlot label="Take photo" active uploading={ctx.uploading(it.id)} onTake={(f) => ctx.upload(it.id, f)} /></div>
        )}
        {(shot || has) && (
          <div className={cn('flex items-center justify-between gap-3 rounded-xl p-3',
            tone === 'good' && 'bg-[hsl(var(--success)/0.1)]', tone === 'bad' && 'bg-destructive/10', tone === 'warn' && 'bg-[hsl(var(--warning)/0.12)]')}>
            <div className="min-w-0">
              <div className="text-sm text-muted-foreground">{has ? 'We read' : 'No reading yet'}</div>
              <div className={cn('text-3xl font-bold tabular-nums', tone === 'good' && 'text-[hsl(var(--success))]', tone === 'bad' && 'text-destructive', tone === 'warn' && 'text-[hsl(var(--warning))]')}>
                {has ? `${Number(r.temp).toFixed(1)}°F` : '?'}
              </div>
              {r.editedBy && <div className="text-xs text-muted-foreground">Edited by {r.editedBy}</div>}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <span className={cn('rounded-full px-2.5 py-1 text-xs font-semibold',
                tone === 'good' && 'bg-[hsl(var(--success))] text-primary-foreground', tone === 'bad' && 'bg-destructive text-destructive-foreground', tone === 'warn' && 'bg-[hsl(var(--warning))] text-primary-foreground')}>
                {tone === 'good' ? 'Safe' : tone === 'bad' ? 'Out of range' : '?'}
              </span>
              <button type="button" onClick={openEdit} aria-label={has ? 'Edit temperature' : 'Enter temperature'}
                className={cn('flex h-11 w-11 items-center justify-center rounded-full',
                  tone === 'good' && 'bg-[hsl(var(--success))] text-primary-foreground', tone === 'bad' && 'bg-destructive text-destructive-foreground', tone === 'warn' && 'bg-[hsl(var(--warning))] text-primary-foreground')}>
                <Pencil className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
        {editOpen && <TempInput ctx={ctx} id={it.id} autoFocus onCancel={() => ctx.setTempOpen(it.id, false)} />}
        {shot ? (
          <div className="grid grid-cols-2 gap-2">
            <Button type="button" variant="outline" className="h-12 border border-border bg-card" onClick={openEdit}>Fix the number</Button>
            {ctx.uploading(it.id) ? (
              <span className="flex h-12 items-center justify-center text-sm text-primary">Uploading…</span>
            ) : (
              <PhotoPickerButton direct="camera" onFileSelected={(f) => ctx.upload(it.id, f)} className="block w-full">
                <span className="flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-border bg-card text-sm font-medium"><RotateCcw className="h-4 w-4" />Retake photo</span>
              </PhotoPickerButton>
            )}
          </div>
        ) : (
          <>
            <TakeButtons ctx={ctx} it={it} label="Take photo" />
            {it.item_type === 'temperature' && !editOpen && (
              <button type="button" className="min-h-11 w-full text-sm text-muted-foreground" onClick={openEdit}>Type it instead</button>
            )}
          </>
        )}
        <DoneBanner ctx={ctx} it={it} />
      </div>
    );
  }

  if (isPhotoType(it.item_type)) {
    const taken = photos.length;
    const next = Math.min(taken + 1, min);
    const complete = taken >= min;
    const retake = (i: number) => (f: File) => ctx.upload(it.id, f, i);
    if (min <= 1) {
      return (
        <div className="space-y-3">
          {refs[0] ? (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className={cn(capLabel, 'mb-1.5')}>Reference</div>
                <button type="button" onClick={() => ctx.preview(refs[0])} className="block aspect-square w-full overflow-hidden rounded-xl border" aria-label="See reference full size">
                  <img src={refs[0]} alt="Reference" className="h-full w-full object-cover" />
                </button>
              </div>
              <div>
                <div className={cn(capLabel, 'mb-1.5')}>Your photo</div>
                <PhotoSlot url={photos[0]} label="Take photo" active uploading={ctx.uploading(it.id)} onTake={(f) => ctx.upload(it.id, f)} onPreview={() => ctx.preview(photos[0])} onRetake={retake(0)} />
              </div>
            </div>
          ) : (
            <PhotoSlot url={photos[0]} label="Take photo" active uploading={ctx.uploading(it.id)} onTake={(f) => ctx.upload(it.id, f)} onPreview={() => ctx.preview(photos[0])} onRetake={retake(0)} />
          )}
          {it.reference_notes && <p className="whitespace-pre-wrap text-sm text-muted-foreground">{it.reference_notes}</p>}
          <ReferenceRows it={it} ctx={ctx} showPhotos={false} />
          {!complete && <TakeButtons ctx={ctx} it={it} label="Take photo" />}
          <DoneBanner ctx={ctx} it={it} />
        </div>
      );
    }
    const pill = <span className="inline-flex rounded-full bg-primary/10 px-2.5 py-1 text-sm font-semibold text-primary">{taken} of {min} taken</span>;
    if (refs.length > 0) {
      return (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            {pill}
            {it.reference_notes && <button type="button" className="min-h-11 px-1 text-sm font-medium text-primary" onClick={() => setNotesOpen((o) => !o)}>Notes</button>}
          </div>
          {notesOpen && <NotesPanel it={it} />}
          {Array.from({ length: min }).map((_, i) => (
            <div key={i} className="grid grid-cols-2 gap-3">
              <div>
                <div className={cn(capLabel, 'mb-1.5')}>Ref {i + 1}</div>
                {refs[i] ? (
                  <button type="button" onClick={() => ctx.preview(refs[i])} className="block aspect-square w-full overflow-hidden rounded-xl border" aria-label={`See reference ${i + 1} full size`}>
                    <img src={refs[i]} alt={`Reference ${i + 1}`} className="h-full w-full object-cover" />
                  </button>
                ) : (
                  <div className="flex aspect-square items-center justify-center rounded-xl bg-muted text-sm text-muted-foreground">No reference</div>
                )}
              </div>
              <div>
                <div className={cn(capLabel, 'mb-1.5 flex justify-between')}><span>Yours {i + 1}</span>{photos[i] && <span className="text-[hsl(var(--success))]">Done</span>}</div>
                <PhotoSlot url={photos[i]} label={`Take photo ${i + 1}`} active={i === taken} uploading={ctx.uploading(it.id)} onTake={(f) => ctx.upload(it.id, f)} onPreview={() => ctx.preview(photos[i])} onRetake={retake(i)} />
              </div>
            </div>
          ))}
          {!complete && <TakeButtons ctx={ctx} it={it} label={`Take photo ${next}`} withLibrary />}
          <DoneBanner ctx={ctx} it={it} />
        </div>
      );
    }
    return (
      <div className="space-y-3">
        <div>{pill}</div>
        <NotesPanel it={it} />
        <div className="grid grid-cols-2 gap-3">
          {Array.from({ length: min }).map((_, i) => (
            <PhotoSlot key={i} url={photos[i]} label={i === taken ? `Take photo ${i + 1}` : `Photo ${i + 1}`} active={i === taken} uploading={ctx.uploading(it.id)} onTake={(f) => ctx.upload(it.id, f)} onPreview={() => ctx.preview(photos[i])} onRetake={retake(i)} />
          ))}
        </div>
        <p className="text-sm text-muted-foreground">Tap a photo to see it full size or retake it. No reference set for this task.</p>
        {!complete && <TakeButtons ctx={ctx} it={it} label={`Take photo ${next}`} />}
        <DoneBanner ctx={ctx} it={it} />
      </div>
    );
  }

  if (it.item_type === 'multiple_choice') {
    const opts: string[] = Array.isArray(it.options) ? it.options : [];
    const cur = ctx.value(it.id);
    return (
      <div className="space-y-3">
        {refs[0] && (
          <button type="button" onClick={() => ctx.preview(refs[0])} className="flex w-full items-center gap-3 rounded-xl border p-2 text-left">
            <img src={refs[0]} alt="" className="h-14 w-14 rounded-lg object-cover" />
            <span><span className="block text-sm font-medium">Reference</span><span className="block text-sm text-muted-foreground">Tap to see full size</span></span>
          </button>
        )}
        <NotesPanel it={it} />
        <div className="space-y-2" role="radiogroup">
          {opts.map((o) => {
            const sel = cur === o;
            return (
              <button key={o} type="button" role="radio" aria-checked={sel} onClick={() => ctx.choose(it.id, o)}
                className={cn('flex min-h-12 w-full items-center gap-3 rounded-xl border px-3 py-2 text-left text-[15px]', sel ? 'border-primary bg-primary/10 font-semibold' : 'border-border bg-card')}>
                <span className={cn('flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2', sel ? 'border-primary' : 'border-muted-foreground/40')}>{sel && <span className="h-2.5 w-2.5 rounded-full bg-primary" />}</span>
                <span className="min-w-0 break-words">{o}</span>
              </button>
            );
          })}
        </div>
        <p className="text-sm text-muted-foreground">Saves the moment you pick one.</p>
        <DoneBanner ctx={ctx} it={it} />
      </div>
    );
  }

  if (it.item_type === 'number' || it.item_type === 'text') {
    const isNum = it.item_type === 'number';
    const empty = draft.trim() === '';
    const send = () => { if (!empty) { ctx.setValue(it.id, draft); ctx.submit(it.id, draft.trim()); } };
    return (
      <div className="space-y-3">
        <NotesPanel it={it} />
        {isNum ? (
          <div className="flex gap-2">
            <Input type="number" inputMode="decimal" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Enter a number" aria-label="Number" className="h-14 flex-1 text-xl"
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); send(); } }} />
            <Button type="button" className="h-14 px-5 text-base" disabled={empty} onClick={send}>Submit</Button>
          </div>
        ) : (
          <>
            <Textarea value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Type your answer" aria-label="Answer" rows={4} className="text-base" />
            <Button type="button" className="h-12 w-full text-base" disabled={empty} onClick={send}>Submit</Button>
          </>
        )}
        <ReferenceRows it={it} ctx={ctx} showPhotos />
        <DoneBanner ctx={ctx} it={it} />
      </div>
    );
  }

  // Checkmark
  return (
    <div className="space-y-3">
      <NotesPanel it={it} />
      <ReferenceRows it={it} ctx={ctx} showPhotos />
      {done ? (
        <DoneBanner ctx={ctx} it={it} />
      ) : (
        <Button type="button" className="h-12 w-full text-base" onClick={() => ctx.check(it.id)}><Check className="mr-2 h-5 w-5" strokeWidth={3} />Mark done</Button>
      )}
    </div>
  );
}

// ---------- read-only completed card ----------
function CompletedBody({ it, ctx }: { it: RunItem; ctx: RunCtx }) {
  const c = ctx.completer(it.id);
  const temp = isTempTask(it);
  const photos = ctx.photos(it);
  const r = temp ? ctx.reading(it.id) : null;
  const saved = ctx.savedValue(it.id) ?? ctx.value(it.id);
  const can = ctx.canUndo(it.id);
  const openPhoto = (i: number) => { if (ctx.previewMany) ctx.previewMany(photos, i); else ctx.preview(photos[i]); };
  const tone = !r ? null : r.temp == null ? 'warn' : r.valid === false ? 'bad' : 'good';
  const isNum = it.item_type === 'number';
  const hasReading = (temp && r != null) || (isNum && saved != null && saved !== '');
  return (
    <div className="space-y-2.5">
      {c && (
        <div className="flex items-center gap-3 rounded-xl border bg-card p-3">
          <Avatar className="h-11 w-11 shrink-0">
            <AvatarImage src={c.profilePhoto || undefined} />
            <AvatarFallback className="bg-secondary text-sm font-semibold text-secondary-foreground">{initialsOf(c.fullName)}</AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <div className="break-words text-[15px] font-bold leading-tight">{c.fullName}</div>
            <div className="text-[12.5px] text-muted-foreground">Completed {completedWhen(c.completedAt)}</div>
          </div>
        </div>
      )}
      {hasReading && (
        <div className={cn('rounded-xl border bg-card p-3', temp && (tone === 'good' ? 'bg-[hsl(var(--success)/0.1)]' : tone === 'bad' ? 'bg-destructive/10' : 'bg-[hsl(var(--warning)/0.12)]'))}>
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className={capLabel}>Reading</div>
              <div className={cn('text-3xl font-bold tabular-nums', temp && tone === 'bad' && 'text-destructive', temp && tone === 'warn' && 'text-[hsl(var(--warning))]')}>
                {temp ? (r!.temp != null ? `${Number(r!.temp).toFixed(1)}°F` : '?°F') : String(saved)}
              </div>
              {temp && r!.editedBy && <div className="text-xs text-muted-foreground">Edited by {r!.editedBy}</div>}
            </div>
            {temp && can && (
              <Button type="button" variant="outline" className="h-11 shrink-0 border-border bg-card"
                onClick={() => { ctx.setTempValue(it.id, r!.temp != null ? String(r!.temp) : ''); ctx.setTempOpen(it.id, true); }}>
                <Pencil className="mr-1.5 h-4 w-4" />Edit reading
              </Button>
            )}
          </div>
          {temp && ctx.tempOpen(it.id) && <div className="mt-2"><TempInput ctx={ctx} id={it.id} autoFocus onCancel={() => ctx.setTempOpen(it.id, false)} /></div>}
          {temp && photos[0] && (
            <button type="button" onClick={() => openPhoto(0)} className="mt-3 flex items-center gap-3 text-left" aria-label="See temp photo full size">
              <img src={photos[0]} alt="Temp photo" className="h-24 w-24 rounded-xl border object-cover" loading="lazy" decoding="async" />
              <span><span className="block text-sm font-medium">Temp photo</span><span className="block text-sm text-muted-foreground">Tap to enlarge</span></span>
            </button>
          )}
        </div>
      )}
      {!temp && photos.length > 0 && (
        <div className="grid grid-cols-4 gap-2">
          {photos.map((u, i) => (
            <button key={i} type="button" onClick={() => openPhoto(i)} className="block overflow-hidden rounded-lg border" aria-label={`See photo ${i + 1} full size`}>
              <img src={u} alt="" className="aspect-square w-full object-cover" loading="lazy" decoding="async" />
            </button>
          ))}
        </div>
      )}
      {it.item_type === 'text' && !!saved && <div className="whitespace-pre-wrap break-words rounded-xl bg-muted p-3 text-[15px] leading-relaxed">{String(saved)}</div>}
      {it.item_type === 'multiple_choice' && (
        <div className="space-y-2">
          {(Array.isArray(it.options) ? it.options : []).map((o: string) => {
            const sel = o === saved;
            return (
              <div key={o} className={cn('flex min-h-12 items-center gap-3 rounded-xl border px-3 py-2 text-[15px]', sel ? 'border-primary bg-primary/10 font-semibold' : 'border-border bg-card text-muted-foreground')}>
                <span className={cn('flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2', sel ? 'border-primary' : 'border-muted-foreground/40')}>{sel && <span className="h-2.5 w-2.5 rounded-full bg-primary" />}</span>
                <span className="min-w-0 break-words">{o}</span>
              </div>
            );
          })}
        </div>
      )}
      <NotesPanel it={it} />
      <ReferenceRows it={it} ctx={ctx} showPhotos />
      {can && (
        <div className="space-y-2">
          {temp && (
            ctx.uploading(it.id) ? (
              <span className="flex h-12 items-center justify-center text-sm text-primary">Uploading…</span>
            ) : (
              <PhotoPickerButton direct="camera" onFileSelected={(f) => ctx.upload(it.id, f)} className="block w-full">
                <span className="flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-border bg-card text-base font-medium"><RotateCcw className="h-4 w-4" />Retake temp photo</span>
              </PhotoPickerButton>
            )
          )}
          <Button type="button" variant="outline" className="h-12 w-full border-destructive text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={() => ctx.undo(it.id)}>
            Undo this item
          </Button>
          <p className="text-center text-xs text-muted-foreground">Only {c ? c.fullName.split(' ')[0] : 'the person who did this'} or a Shift Manager and above can undo or edit.</p>
        </div>
      )}
    </div>
  );
}

// ---------- main view ----------
export function ChecklistRunView({ ctx }: { ctx: RunCtx }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const width = useContentWidth(rootRef);
  const wideList = width >= 640;
  const twoPane = width >= 900;
  const [guidedId, setGuidedId] = useState<string | null>(null);
  const [reviewId, setReviewId] = useState<string | null>(null);
  const [atEnd, setAtEnd] = useState(false);
  const [flashId, setFlashId] = useState<string | null>(null);
  // The header arrow always lands on the Dash, whatever brought you here.
  const navigate = useNavigate();
  const goDash = () => navigate('/');

  const sectionOf = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of ctx.sections) for (const it of s.items) m.set(it.id, s.label);
    return m;
  }, [ctx.sections]);
  const walk = useMemo(() => ctx.sections.flatMap((s) => s.items).filter(walkable), [ctx.sections]);
  const todo = (it: RunItem) => counted(it) && (!ctx.isDone(it) || ctx.needsTemp(it));
  const left = walk.filter(todo).length;
  const firstTodo = walk.find(todo);

  const idx = guidedId ? walk.findIndex((w) => w.id === guidedId) : -1;
  const current = idx >= 0 ? walk[idx] : null;
  const nextTodo = idx >= 0 ? walk.slice(idx + 1).find(todo) : undefined;

  // Completed tasks in list order, for the read-only review card.
  const doneWalk = useMemo(() => walk.filter((it) => counted(it) && ctx.isDone(it) && !ctx.needsTemp(it)), [walk, ctx]);
  // "Worked on by" — everyone who completed at least one item, most items first.
  const workedOnBy = useMemo(() => {
    const counts = new Map<string, { name: string; n: number }>();
    for (const it of doneWalk) {
      const c = ctx.completer(it.id);
      if (!c) continue;
      const cur = counts.get(c.userId);
      if (cur) cur.n += 1; else counts.set(c.userId, { name: shortName(c.fullName), n: 1 });
    }
    return [...counts.values()].sort((a, b) => b.n - a.n).map((x) => x.name);
  }, [doneWalk, ctx]);
  const rIdx = reviewId ? doneWalk.findIndex((w) => w.id === reviewId) : -1;
  const reviewCurrent = rIdx >= 0 ? doneWalk[rIdx] : null;

  useEffect(() => { window.scrollTo({ top: 0 }); }, [guidedId, reviewId, atEnd]);
  // If the reviewed item gets undone (or data reloads), fall back to the list.
  useEffect(() => { if (reviewId && rIdx < 0) setReviewId(null); }, [reviewId, rIdx]);

  const open = (id: string) => { setAtEnd(false); setReviewId(null); setGuidedId(id); };
  const openReview = (id: string) => { setAtEnd(false); setGuidedId(null); setReviewId(id); };
  const goNext = () => { if (nextTodo) open(nextTodo.id); else setAtEnd(true); };
  const goPrev = () => { if (idx > 0) open(walk[idx - 1].id); };
  const backToList = () => { setGuidedId(null); setReviewId(null); setAtEnd(false); };

  /** Done rows open the read-only card; prep/approval keep their own screens. */
  const openRow = (it: RunItem) => {
    if (ctx.isDone(it) && !ctx.needsTemp(it) && it.item_type !== 'prep_list' && it.item_type !== 'manager_approval') openReview(it.id);
    else open(it.id);
  };

  const ctxWithFlash: RunCtx = {
    ...ctx,
    check: (id) => {
      ctx.check(id);
      setFlashId(id);
      window.setTimeout(() => setFlashId((f) => (f === id ? null : f)), 600);
      if (guidedId === id) window.setTimeout(goNext, 450);
    },
  };

  const hiddenCount = ctx.hideDone ? walk.filter((it) => counted(it) && ctx.isDone(it) && !ctx.needsTemp(it)).length : 0;
  const visible = (it: RunItem) => !ctx.hideDone || !ctx.isDone(it) || ctx.needsTemp(it) || it.id === flashId || !counted(it);
  const tempsNeeded = walk.filter((it) => ctx.needsTemp(it)).length;

  const switches = (
    <div className={cn('my-1 flex flex-wrap items-center gap-x-5 gap-y-1', wideList && 'justify-end')}>
      <label className="flex h-8 cursor-pointer items-center gap-2 text-sm font-medium">
        <Switch small checked={ctx.hideDone} onCheckedChange={ctx.setHideDone} aria-label="Hide done" />Hide done
      </label>
      {ctx.myTasks && (
        <label className="flex h-8 cursor-pointer items-center gap-2 text-sm font-medium">
          <Switch small checked={ctx.myTasks.on} onCheckedChange={ctx.myTasks.set} aria-label="My tasks" />My tasks ({ctx.myTasks.label})
        </label>
      )}
    </div>
  );
  const hiddenLine = hiddenCount > 0 && (
    <div className="flex items-center justify-between px-1">
      <span className="text-sm text-muted-foreground">{hiddenCount} done {hiddenCount === 1 ? 'task' : 'tasks'} hidden</span>
      <button type="button" className="min-h-11 px-1 text-sm font-semibold text-primary" onClick={() => ctx.setHideDone(false)}>Show</button>
    </div>
  );
  const prepHidden = walk.filter((it) => it.item_type === 'prep_list').map((it) => (
    <div key={it.id} className="hidden" aria-hidden>{ctx.prepStatus(it, it.id === guidedId)}</div>
  ));

  // ----- list -----
  const groups = ctx.sections.map((s) => {
    const rows = s.items.filter((it) => walkable(it) && visible(it));
    if (!rows.length) return null;
    const leftHere = s.items.filter(todo).length;
    return (
      <section key={s.key} className="space-y-1.5">
        {(s.label || ctx.sections.length > 1) && (
          <div className="flex items-baseline justify-between px-1">
            <span className={capLabel}>{s.label || 'Tasks'}</span>
            <span className={capLabel}>{leftHere > 0 ? `${leftHere} left` : `${s.items.filter((x) => walkable(x) && !todo(x)).length} of ${s.items.filter(walkable).length}`}</span>
          </div>
        )}
        <div className="overflow-hidden rounded-2xl border bg-card">
          {rows.map((it) => <Row key={it.id} it={it} ctx={ctxWithFlash} wide={wideList} onOpen={() => openRow(it)} flash={flashId === it.id} />)}
        </div>
      </section>
    );
  });

  const listView = (
    <div className="space-y-3 pb-24">
      {wideList ? (
        <div>
          <div className="flex flex-wrap items-center gap-3 pt-3">
            <Button variant="ghost" size="icon" className="-ml-2 h-9 w-9 shrink-0" onClick={goDash} aria-label="Back to dashboard"><ArrowLeft className="h-5 w-5" /></Button>
            <h1 className="min-w-0 flex-1 break-words text-2xl font-bold">{ctx.title}</h1>
            {tempsNeeded > 0 && <span className="rounded-full bg-[hsl(var(--warning)/0.14)] px-3 py-1 text-sm font-semibold text-[hsl(var(--warning))]">{tempsNeeded} {tempsNeeded === 1 ? 'needs' : 'need'} a temp</span>}
            {switches}
          </div>
          {ctx.description && <p className="px-1 text-sm text-muted-foreground">{ctx.description}</p>}
          <div className="my-2 flex items-center gap-3"><div className="flex-1"><ProgressBar done={ctx.doneCount} total={ctx.totalCount} /></div><span className="shrink-0 text-sm font-bold">{ctx.doneCount} of {ctx.totalCount}</span></div>
        </div>
      ) : (
        <div>
          <div className="flex items-center gap-1 px-1 pt-3">
            <Button variant="ghost" size="icon" className="-ml-2 h-9 w-9 shrink-0" onClick={goDash} aria-label="Back to dashboard"><ArrowLeft className="h-5 w-5" /></Button>
            <div className="flex min-w-0 flex-1 items-baseline justify-between gap-3">
              <h1 className="min-w-0 break-words text-xl font-bold">{ctx.title}</h1>
              <span className="shrink-0 text-base font-bold">{ctx.doneCount} of {ctx.totalCount}</span>
            </div>
          </div>
          {ctx.description && <p className="px-1 text-sm text-muted-foreground">{ctx.description}</p>}
          <div className="mb-2 mt-1.5"><ProgressBar done={ctx.doneCount} total={ctx.totalCount} /></div>
          {switches}
        </div>
      )}
      {hiddenLine}
      {groups}
      {workedOnBy.length > 0 && (
        <p className="px-1 text-[12.5px] text-muted-foreground"><span className="font-bold text-foreground">Worked on by</span> {workedOnBy.join(', ')}</p>
      )}
      {ctx.footer}
      {firstTodo && (
        <div className="fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+88px)] z-30 px-3 md:bottom-4 md:px-6">
          <Button type="button" className="mx-auto flex h-12 w-full max-w-[1176px] bg-primary text-base font-semibold text-primary-foreground hover:bg-primary/90" onClick={() => open(firstTodo.id)}>
            Go one by one · {left} left<ChevronRight className="ml-1 h-5 w-5" />
          </Button>
        </div>
      )}
    </div>
  );

  // ----- guided -----
  const topBar = twoPane ? (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <Button variant="outline" className="h-11 border border-border bg-card" onClick={backToList}><ChevronLeft className="mr-1 h-4 w-4" />List</Button>
        <h1 className="min-w-0 flex-1 break-words text-xl font-bold">{ctx.title}</h1>
        <span className="shrink-0 text-sm font-bold">{left} left</span>
      </div>
      <ProgressBar done={ctx.doneCount} total={ctx.totalCount} />
    </div>
  ) : (
    <div className="space-y-2">
      <div className="grid grid-cols-[auto_1fr_auto] items-center gap-2">
        <button type="button" className="flex min-h-11 items-center pr-2 text-base font-semibold text-primary" onClick={backToList}><ChevronLeft className="h-5 w-5" />List</button>
        <span className="min-w-0 break-words text-center text-base font-semibold">{ctx.title}</span>
        <span className="shrink-0 text-sm font-bold">{left} left</span>
      </div>
      <ProgressBar done={ctx.doneCount} total={ctx.totalCount} />
    </div>
  );

  const card = atEnd || !current ? (
    <div className="space-y-3 rounded-2xl border bg-card p-5 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[hsl(var(--success))] text-primary-foreground"><Check className="h-6 w-6" strokeWidth={3} /></div>
      <p className="text-lg font-bold">You're done with the rest</p>
      {left > 0 && <p className="text-sm text-muted-foreground">{left} skipped {left === 1 ? 'task is' : 'tasks are'} still on your list.</p>}
      <Button type="button" className="h-12 w-full text-base" onClick={backToList}>Back to the list</Button>
    </div>
  ) : (
    <div key={current.id} className="space-y-3 rounded-2xl border bg-card p-4">
      <div className={capLabel}>{(sectionOf.get(current.id) || 'Tasks')} · {typeLabel(current, ctx.minPhotos(current))}</div>
      <Name it={current} ctx={ctx} className="block break-words text-2xl font-bold leading-tight" />
      <ShiftTag it={current} />
      <GuidedBody it={current} ctx={ctxWithFlash} />
    </div>
  );

  const navRow = !atEnd && current && (
    <div className="flex items-center gap-3">
      <button type="button" aria-label="Previous task" disabled={idx <= 0} onClick={goPrev} className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-border bg-card disabled:opacity-40"><ChevronLeft className="h-5 w-5" /></button>
      <div className="min-w-0 flex-1">
        <div className="text-xs text-muted-foreground">{nextTodo ? 'Next not done' : 'No more after this'}</div>
        <div className="break-words text-sm font-bold">{nextTodo?.question ?? 'Back to the list after this'}</div>
      </div>
      <Button type="button" variant="outline" className="h-12 shrink-0 border border-border bg-card px-4" onClick={goNext}>Skip<ChevronRight className="ml-1 h-4 w-4" /></Button>
    </div>
  );

  const sideList = (
    <div className="rounded-2xl border bg-card">
      <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
        <span className="text-sm font-bold">To do · {left}</span>
        <label className="flex min-h-11 cursor-pointer items-center gap-2 text-xs font-medium"><Switch checked={ctx.hideDone} onCheckedChange={ctx.setHideDone} aria-label="Hide done" />Hide done</label>
      </div>
      {walk.filter(visible).map((it) => {
        const sel = it.id === current?.id && !atEnd;
        const done = ctx.isDone(it) && !ctx.needsTemp(it);
        return (
          <button key={it.id} type="button" onClick={() => open(it.id)}
            className={cn('flex min-h-11 w-full items-center gap-2.5 border-b px-3 py-2 text-left last:border-b-0', sel && 'bg-primary/10 shadow-[inset_3px_0_0_hsl(var(--primary))]')}>
            {done ? (
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[hsl(var(--success))] text-primary-foreground"><Check className="h-3 w-3" strokeWidth={3} /></span>
            ) : ctx.needsTemp(it) ? (
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[hsl(var(--warning))] text-[10px] font-bold text-primary-foreground">!</span>
            ) : (
              <span className="h-5 w-5 shrink-0 rounded-full border-2 border-muted-foreground/40" />
            )}
            <span className={cn('min-w-0 break-words text-sm', sel ? 'font-bold' : 'font-medium', done && 'text-muted-foreground')}>{it.question}</span>
          </button>
        );
      })}
      {hiddenCount > 0 && (
        <div className="flex items-center justify-between border-t px-3">
          <span className="text-xs text-muted-foreground">{hiddenCount} done {hiddenCount === 1 ? 'task' : 'tasks'} hidden</span>
          <button type="button" className="min-h-11 px-1 text-sm font-semibold text-primary" onClick={() => ctx.setHideDone(false)}>Show</button>
        </div>
      )}
    </div>
  );

  const guidedView = (
    <div className="space-y-3 pb-6">
      {topBar}
      {twoPane ? (
        <div className="grid grid-cols-[270px_minmax(0,1fr)] items-start gap-4">
          <div className="sticky top-16 max-h-[calc(100vh-6rem)] overflow-y-auto">{sideList}</div>
          <div className="space-y-3">
            {card}
            {navRow}
            <p className="text-center text-sm text-muted-foreground">Tap any task on the left to jump to it. Skipped tasks stay on your list.</p>
          </div>
        </div>
      ) : (
        <>
          {card}
          <div className="sticky bottom-[calc(env(safe-area-inset-bottom)+88px)] z-20 -mx-1 rounded-2xl border bg-background/95 p-2 backdrop-blur">{navRow}</div>
          <p className="pb-24 text-center text-sm text-muted-foreground">Skipped tasks stay on your list.</p>
        </>
      )}
    </div>
  );

  // ----- read-only completed card -----
  const reviewNav = reviewCurrent && (
    <div className="flex items-center gap-3">
      <button type="button" aria-label="Previous completed task" disabled={rIdx <= 0} onClick={() => openReview(doneWalk[rIdx - 1].id)} className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-border bg-card disabled:opacity-40"><ChevronLeft className="h-5 w-5" /></button>
      <div className="min-w-0 flex-1">
        <div className="text-xs text-muted-foreground">{rIdx + 1} of {doneWalk.length} done</div>
        <div className="break-words text-sm font-bold">{doneWalk[rIdx + 1]?.question ?? 'Back to the list after this'}</div>
      </div>
      {rIdx < doneWalk.length - 1 ? (
        <Button type="button" variant="outline" className="h-12 shrink-0 border border-border bg-card px-4" onClick={() => openReview(doneWalk[rIdx + 1].id)}>Next<ChevronRight className="ml-1 h-4 w-4" /></Button>
      ) : (
        <Button type="button" variant="outline" className="h-12 shrink-0 border border-border bg-card px-4" onClick={backToList}>List</Button>
      )}
    </div>
  );

  const reviewBad = !!reviewCurrent && isTempTask(reviewCurrent) && ctx.reading(reviewCurrent.id).valid === false;
  const reviewView = reviewCurrent && (
    <div className="space-y-2.5 pb-6">
      <div className="flex items-center gap-2 py-2">
        <Button variant="ghost" size="icon" className="-ml-2 h-9 w-9 shrink-0" onClick={backToList} aria-label="Back to list"><ArrowLeft className="h-5 w-5" /></Button>
        <div className="min-w-0 flex-1">
          <Name it={reviewCurrent} ctx={ctx} className="block break-words text-base font-bold leading-tight" />
          <div className="text-xs text-muted-foreground">{sectionOf.get(reviewCurrent.id) || 'Tasks'} · {ctx.title}</div>
        </div>
        {reviewBad && <span className="shrink-0 rounded-full bg-destructive px-2.5 py-1 text-xs font-semibold text-destructive-foreground">Out of range</span>}
      </div>
      <CompletedBody key={reviewCurrent.id} it={reviewCurrent} ctx={ctx} />
      {twoPane ? reviewNav : (
        <div className="sticky bottom-[calc(env(safe-area-inset-bottom)+88px)] z-20 -mx-1 rounded-2xl border bg-background/95 p-2 backdrop-blur">{reviewNav}</div>
      )}
    </div>
  );

  return (
    <div ref={rootRef}>
      {guidedId ? guidedView : reviewId && reviewView ? reviewView : listView}
      {prepHidden}
    </div>
  );
}
