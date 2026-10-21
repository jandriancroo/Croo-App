import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { DateTime } from 'luxon';
import { DndContext, closestCenter, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Camera, GripVertical, Loader2, Plus, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { ImageCropDialog } from '@/components/ImageCropDialog';
import { supabase } from '@/integrations/supabase/client';
import { useLocation as useAppLocation } from '@/hooks/useLocation';
import { useLocationTimezone } from '@/hooks/useLocationTimezone';
import { cn } from '@/lib/utils';
import {
  buildPromoSlides, campaignDay, endPromoTracker, fetchManageablePromoTrackers, pruneItemImages,
  savePromoTracker, type PromoOwnerType, type PromoTracker, type PromoTrackerConfig,
} from '@/lib/promoTrackers';
import { TrackerPosItemPicker } from '../TrackerPosItemPicker';
import { PromoHeroView } from './PromoHeroView';

/** Crop shape for every promo photo (hero card is ~5:3 on phones). One upload serves hero + dot. */
export const PROMO_PHOTO_ASPECT = 5 / 3;

type RankMetric = 'units' | 'sales' | 'pmix';

interface FormState {
  id: string | null;
  owner_type: PromoOwnerType;
  title: string;
  starts_on: string;
  ends_on: string;
  config: PromoTrackerConfig;
  location_ids: string[]; // org contest subset; empty = all of the org's stores
}

const emptyForm = (owner: PromoOwnerType): FormState => ({
  id: null, owner_type: owner, title: '', starts_on: '', ends_on: '', location_ids: [],
  config: {
    tracker_display_mode: 'expandable', tracker_item_refs: [], tracker_promo_image_url: null,
    tracker_rank_metrics: ['units', 'sales', 'pmix'], tracker_item_images: {},
    tracker_start_on_campaign: false, tracker_autoplay: true,
    tracker_border: null, tracker_border_winner: false, tracker_border_closing: false,
  },
});

const fromPromo = (p: PromoTracker): FormState => ({
  id: p.id, owner_type: p.owner_type, title: p.title, starts_on: p.starts_on, ends_on: p.ends_on,
  location_ids: p.location_ids || [], config: { ...emptyForm(p.owner_type).config, ...p.config },
});

const fmt = (d: string) => DateTime.fromFormat(d, 'yyyy-MM-dd').toFormat('LLL d');

function SortableItemRow({ id, image, onAddPhoto, onRemovePhoto, onRemoveItem, uploading }: {
  id: string; image?: string; uploading: boolean;
  onAddPhoto: () => void; onRemovePhoto: () => void; onRemoveItem: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn('flex items-center gap-2 rounded-xl border bg-card p-2', isDragging && 'opacity-60')}>
      <button type="button" {...attributes} {...listeners} aria-label={`Drag ${id}`}
        className="relative flex h-8 w-6 shrink-0 cursor-grab touch-none items-center justify-center text-muted-foreground after:absolute after:-inset-x-2 after:-inset-y-1.5 active:cursor-grabbing">
        <GripVertical className="h-4 w-4" />
      </button>
      <button type="button" onClick={onAddPhoto} aria-label={`${image ? 'Replace' : 'Add'} photo for ${id}`}
        className="relative h-[52px] w-[52px] shrink-0 overflow-hidden rounded-lg bg-muted">
        {image ? <img src={image} alt="" className="h-full w-full object-cover" /> : null}
        {uploading ? (
          <span className="absolute inset-0 grid place-items-center bg-card/70"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></span>
        ) : image ? (
          <span className="absolute bottom-0 right-0 grid h-5 w-5 place-items-center rounded-tl-lg bg-foreground/55 text-card"><Camera className="h-3 w-3" /></span>
        ) : (
          <span className="absolute inset-0 grid place-items-center text-muted-foreground"><Camera className="h-5 w-5" /></span>
        )}
      </button>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">{id}</p>
        <p className="truncate text-xs text-muted-foreground">{image ? 'Photo added' : 'No photo · uses campaign hero'}</p>
      </div>
      {image && (
        <Button type="button" variant="ghost" size="icon-sm" aria-label="Remove photo" onClick={onRemovePhoto}><X className="h-4 w-4" /></Button>
      )}
      <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove ${id}`} onClick={onRemoveItem}>
        <Trash2 className="h-4 w-4" />
      </Button>
    </div>
  );
}

export function PromoTrackerEditor({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { currentLocation } = useAppLocation();
  const { timezone } = useLocationTimezone();
  const queryClient = useQueryClient();
  const locId = currentLocation?.id;
  const orgId = currentLocation?.organization_id ?? null;

  const { data: brandId = null } = useQuery({
    queryKey: ['promo-location-brand', locId],
    enabled: open && !!locId,
    queryFn: async () => {
      const { data } = await supabase.from('locations').select('brand_id, organizations(brand_id)').eq('id', locId!).maybeSingle();
      return ((data as any)?.brand_id ?? (data as any)?.organizations?.brand_id ?? null) as string | null;
    },
  });

  const { data: perms = { brand: false, org: false } } = useQuery({
    queryKey: ['promo-perms', locId, brandId, orgId],
    enabled: open && !!locId,
    queryFn: async () => {
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth.user?.id;
      if (!uid) return { brand: false, org: false };
      const check = (owner: PromoOwnerType) => supabase.rpc('_can_manage_promo' as any, {
        _uid: uid, _owner_type: owner, _brand_id: brandId, _org_id: orgId,
      });
      const [b, o] = await Promise.all([brandId ? check('brand') : Promise.resolve({ data: false }), orgId ? check('org') : Promise.resolve({ data: false })]);
      return { brand: !!(b as any).data, org: !!(o as any).data };
    },
  });

  const { data: promos = [], refetch } = useQuery({
    queryKey: ['promo-trackers-manage', locId],
    enabled: open && !!locId,
    queryFn: () => fetchManageablePromoTrackers(locId!),
  });

  const { data: orgLocations = [] } = useQuery({
    queryKey: ['promo-org-locations', orgId],
    enabled: open && !!orgId,
    queryFn: async () => {
      const { data } = await supabase.from('locations').select('id, name').eq('organization_id', orgId!).eq('is_active', true).order('name');
      return (data || []) as { id: string; name: string }[];
    },
  });

  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [cropSrc, setCropSrc] = useState('');
  const [cropTarget, setCropTarget] = useState<string | null>(null); // item ref, or '__campaign__'
  const [uploadingRef, setUploadingRef] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (!open) { setForm(null); setConfirmEnd(false); } }, [open]);

  const setCfg = (patch: Partial<PromoTrackerConfig>) => setForm(f => f && ({ ...f, config: { ...f.config, ...patch } }));
  const refs = form?.config.tracker_item_refs ?? [];

  const pickPhoto = (target: string) => { setCropTarget(target); fileRef.current?.click(); };
  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setCropSrc(URL.createObjectURL(file));
  };
  const onCropped = async (blob: Blob) => {
    const target = cropTarget;
    if (!target) return;
    setUploadingRef(target);
    try {
      const isCampaign = target === '__campaign__';
      const slug = target.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40);
      const path = isCampaign ? `promo-trackers/promo-${Date.now()}.png` : `promo-trackers/items/${form?.id ?? 'new'}-${slug}-${Date.now()}.png`;
      const { error } = await supabase.storage.from('brand-assets').upload(path, blob, { upsert: true, contentType: 'image/png' });
      if (error) throw error;
      const url = supabase.storage.from('brand-assets').getPublicUrl(path).data.publicUrl;
      if (isCampaign) setCfg({ tracker_promo_image_url: url });
      else setForm(f => f && ({ ...f, config: { ...f.config, tracker_item_images: { ...(f.config.tracker_item_images || {}), [target]: url } } }));
    } catch (err: any) {
      toast.error(err?.message || 'Photo upload failed');
    } finally {
      setUploadingRef(null);
      if (cropSrc.startsWith('blob:')) URL.revokeObjectURL(cropSrc);
      setCropSrc('');
    }
  };

  const setRefs = (next: string[]) => setCfg({ tracker_item_refs: next, tracker_item_images: pruneItemImages(form?.config.tracker_item_images, next) });
  const onPickerChange = (picked: string[]) => {
    const kept = refs.filter(r => picked.includes(r));
    const added = picked.filter(r => !refs.includes(r));
    setRefs([...kept, ...added]);
  };
  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    setRefs(arrayMove(refs, refs.indexOf(String(e.active.id)), refs.indexOf(String(e.over.id))));
  };

  const save = async () => {
    if (!form) return;
    setSaving(true);
    try {
      await savePromoTracker({
        id: form.id, owner_type: form.owner_type,
        brand_id: form.owner_type === 'brand' ? brandId : null,
        organization_id: form.owner_type === 'org' ? orgId : null,
        title: form.title, starts_on: form.starts_on, ends_on: form.ends_on,
        config: { ...form.config, tracker_item_images: pruneItemImages(form.config.tracker_item_images, refs) },
        location_ids: form.owner_type === 'org' ? form.location_ids : null,
      });
      toast.success('Promo saved');
      queryClient.invalidateQueries({ queryKey: ['active-promo-tracker'] });
      await refetch();
      setForm(null);
    } catch (err: any) {
      toast.error(err?.message || 'Could not save the promo');
    } finally { setSaving(false); }
  };

  const endNow = async () => {
    if (!form?.id) return;
    try {
      await endPromoTracker(form.id);
      toast.success('Promo ended for everyone');
      queryClient.invalidateQueries({ queryKey: ['active-promo-tracker'] });
      await refetch();
      setForm(null);
    } catch (err: any) { toast.error(err?.message || 'Could not end the promo'); }
    finally { setConfirmEnd(false); }
  };

  const previewSlides = useMemo(() => form ? buildPromoSlides(form.config) : [], [form]);
  const previewDay = form ? campaignDay(form.starts_on, form.ends_on, timezone || 'America/Los_Angeles') : null;
  const canCreate = perms.brand || perms.org;
  const contestAll = form?.location_ids.length === 0;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="flex max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] max-w-md flex-col overflow-hidden p-0">
          <DialogHeader className="shrink-0 border-b px-4 py-3">
            <DialogTitle>{form ? (form.id ? 'Edit Promo Tracker' : 'New Promo Tracker') : 'Promo Tracker'}</DialogTitle>
          </DialogHeader>
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onFile} />

          {!form && (
            <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden">
              <div className="space-y-3 p-4">
                {promos.length === 0 && <p className="py-4 text-center text-sm text-muted-foreground">No promo running or scheduled.</p>}
                {promos.map(p => (
                  <button key={p.id} type="button" onClick={() => setForm(fromPromo(p))}
                    className="flex w-full items-center gap-3 rounded-xl border p-3 text-left transition-colors hover:bg-accent/50">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{p.title}</p>
                      <p className="text-xs text-muted-foreground">{p.owner_type === 'brand' ? 'Brand promo' : 'Org contest'} · {fmt(p.starts_on)} to {fmt(p.ends_on)}</p>
                    </div>
                    <span className="text-xs font-medium text-primary">Edit</span>
                  </button>
                ))}
                {perms.brand && <Button className="w-full" onClick={() => setForm(emptyForm('brand'))}><Plus className="mr-1 h-4 w-4" />New brand promo</Button>}
                {perms.org && <Button variant={perms.brand ? 'outline' : 'default'} className="w-full" onClick={() => setForm(emptyForm('org'))}><Plus className="mr-1 h-4 w-4" />New org contest</Button>}
                {!canCreate && <p className="text-center text-xs text-muted-foreground">Only brand admins and org admins can create promos.</p>}
              </div>
            </div>
          )}

          {form && (
            <>
              <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden">
                <div className="min-w-0 space-y-5 p-4">
                  <PromoHeroView
                    title={form.title || 'Campaign name'} slides={previewSlides} activeRef={previewSlides[0]?.ref ?? ''}
                    subtitle={previewSlides[0] ? `${previewSlides[0].label} · 0\u00A0sold` : ''}
                    dayLabel={previewDay ? `DAY ${previewDay.day}/${previewDay.total}` : null}
                    rankLabel="#1 of 1" canExpand={form.config.tracker_display_mode === 'expandable'} expanded={false}
                    paused={false} reducedMotion period="day" campaignImageUrl={form.config.tracker_promo_image_url ?? null}
                    onPeriodChange={() => {}} interactive={false}
                  />

                  <p className="text-xs font-medium text-muted-foreground">{form.owner_type === 'brand' ? 'Brand promo · every store in the brand sees it' : 'Org contest · only the stores you pick'}</p>

                  <div className="space-y-1.5">
                    <Label htmlFor="promo-name">Campaign name</Label>
                    <Input id="promo-name" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="e.g. Spellbound Spread" />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="promo-start">Starts</Label>
                      <Input id="promo-start" type="date" value={form.starts_on} onChange={e => setForm({ ...form, starts_on: e.target.value })} />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="promo-end">Ends</Label>
                      <Input id="promo-end" type="date" value={form.ends_on} onChange={e => setForm({ ...form, ends_on: e.target.value })} />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label>Campaign hero (optional)</Label>
                    {form.config.tracker_promo_image_url ? (
                      <div className="flex items-center gap-2">
                        <img src={form.config.tracker_promo_image_url} alt="" className="h-[52px] w-[87px] rounded-lg object-cover" />
                        <Button type="button" variant="outline" size="xs" onClick={() => pickPhoto('__campaign__')}><Camera className="mr-1 h-3.5 w-3.5" />Replace</Button>
                        <Button type="button" variant="ghost" size="icon-sm" aria-label="Remove campaign hero" onClick={() => setCfg({ tracker_promo_image_url: null })}><X className="h-4 w-4" /></Button>
                      </div>
                    ) : (
                      <Button type="button" variant="outline" size="sm" disabled={uploadingRef === '__campaign__'} onClick={() => pickPhoto('__campaign__')}>
                        {uploadingRef === '__campaign__' ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Camera className="mr-1 h-4 w-4" />}Upload photo
                      </Button>
                    )}
                    <label className="flex items-center justify-between gap-3 rounded-xl border p-3">
                      <span><span className="block text-sm font-medium">Start on campaign hero</span><span className="block text-xs text-muted-foreground">First slide shows all items combined</span></span>
                      <Switch checked={!!form.config.tracker_start_on_campaign} onCheckedChange={v => setCfg({ tracker_start_on_campaign: v })} />
                    </label>
                  </div>

                  <div className="space-y-2">
                    <Label>Tracked items · {refs.length}</Label>
                    <DndContext collisionDetection={closestCenter} onDragEnd={onDragEnd}>
                      <SortableContext items={refs} strategy={verticalListSortingStrategy}>
                        <div className="space-y-2">
                          {refs.map(ref => (
                            <SortableItemRow key={ref} id={ref} image={form.config.tracker_item_images?.[ref]}
                              uploading={uploadingRef === ref}
                              onAddPhoto={() => pickPhoto(ref)}
                              onRemovePhoto={() => setCfg({ tracker_item_images: pruneItemImages(form.config.tracker_item_images, refs.filter(r => r !== ref)) })}
                              onRemoveItem={() => setRefs(refs.filter(r => r !== ref))} />
                          ))}
                        </div>
                      </SortableContext>
                    </DndContext>
                    {refs.length > 1 && <p className="text-xs text-muted-foreground">Drag to set the order the hero plays in.</p>}
                    <TrackerPosItemPicker value={refs} onChange={onPickerChange} label="Add items" />
                  </div>

                  <label className="flex items-center justify-between gap-3 rounded-xl border p-3">
                    <span><span className="block text-sm font-medium">Cycle through items</span><span className="block text-xs text-muted-foreground">Every 8 seconds · long-press to pause</span></span>
                    <Switch checked={form.config.tracker_autoplay !== false} onCheckedChange={v => setCfg({ tracker_autoplay: v })} />
                  </label>

                  <label className="flex items-center justify-between gap-3 rounded-xl border p-3 opacity-60">
                    <span><span className="block text-sm font-medium">Border</span><span className="block text-xs text-muted-foreground">Decorative borders are coming soon</span></span>
                    <Switch checked={false} disabled />
                  </label>

                  <div className="space-y-2">
                    <Label>Ranking view</Label>
                    <SegmentedControl fullWidth value={form.config.tracker_display_mode === 'expandable' ? 'expandable' : 'summary'}
                      onValueChange={v => setCfg({ tracker_display_mode: v as any })}
                      options={[{ value: 'expandable', label: 'Expandable' }, { value: 'summary', label: 'My rank only' }]} />
                    <div className="flex gap-4 pt-1">
                      {(['units', 'sales', 'pmix'] as RankMetric[]).map(m => {
                        const list = (form.config.tracker_rank_metrics || []) as RankMetric[];
                        return (
                          <label key={m} className="flex items-center gap-2 text-sm">
                            <Checkbox checked={list.includes(m)} onCheckedChange={(c) => setCfg({ tracker_rank_metrics: (c ? [...list, m] : list.filter(x => x !== m)) as any })} />
                            {m === 'pmix' ? 'PMIX' : m[0].toUpperCase() + m.slice(1)}
                          </label>
                        );
                      })}
                    </div>
                  </div>

                  {form.owner_type === 'org' && (
                    <div className="space-y-2">
                      <Label>Stores in this contest</Label>
                      <label className="flex items-center gap-2 text-sm">
                        <Checkbox checked={contestAll} onCheckedChange={(c) => setForm({ ...form, location_ids: c ? [] : orgLocations.map(l => l.id) })} />
                        All stores in the org
                      </label>
                      {!contestAll && orgLocations.map(l => (
                        <label key={l.id} className="flex items-center gap-2 pl-6 text-sm">
                          <Checkbox checked={form.location_ids.includes(l.id)}
                            onCheckedChange={(c) => setForm({ ...form, location_ids: c ? [...form.location_ids, l.id] : form.location_ids.filter(x => x !== l.id) })} />
                          {l.name}
                        </label>
                      ))}
                      <p className="text-xs text-muted-foreground">If a brand promo is running at a store, the brand promo shows there instead.</p>
                    </div>
                  )}

                  {form.id && (
                    <Button type="button" variant="outline" className="w-full text-destructive" onClick={() => setConfirmEnd(true)}>End promo now</Button>
                  )}
                </div>
              </div>
              <div className="flex shrink-0 gap-2 border-t px-4 py-3">
                <Button variant="outline" className="flex-1" onClick={() => setForm(null)}>Back</Button>
                <Button className="flex-1" disabled={saving || !form.title.trim() || !form.starts_on || !form.ends_on || refs.length === 0} onClick={save}>
                  {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}Save tracker
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmEnd} onOpenChange={setConfirmEnd}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>End this promo?</AlertDialogTitle>
            <AlertDialogDescription>It disappears from every store's Dash right away.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={endNow}>End promo</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ImageCropDialog
        open={!!cropSrc}
        onOpenChange={(o) => { if (!o) { if (cropSrc.startsWith('blob:')) URL.revokeObjectURL(cropSrc); setCropSrc(''); } }}
        imageSrc={cropSrc}
        onCropComplete={onCropped}
        cropShape="rect"
        aspect={PROMO_PHOTO_ASPECT}
        cropAreaClassName="!h-auto aspect-[5/3] w-full"
        overlay={cropTarget === '__campaign__' ? undefined : (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="h-1/2 aspect-square rounded-full border-2 border-dashed border-[hsl(var(--promo-ink))] shadow-[0_0_0_9999px_hsl(var(--promo-shade)/0.15)]" />
            <span className="absolute bottom-2 left-2 rounded-full bg-card/90 px-2 py-0.5 text-[11px] font-semibold text-foreground">The round dot uses the center</span>
          </div>
        )}
      />
    </>
  );
}
