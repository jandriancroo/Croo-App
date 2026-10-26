import { getPrimaryReferencePhoto } from '@/lib/checklistReferencePhotos';
import { defaultScheduleForm, scheduleFormError, scheduleFormFromRow, scheduleFormToRow } from '@/lib/checklistScheduleForm';
import { useLocationTimezone } from '@/hooks/useLocationTimezone';
import { getTodayInTimezone } from '@/utils/timezoneUtils';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Layout } from '@/components/Layout';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { Loader2 } from 'lucide-react';
import { type PrepRow } from '@/components/checklists/PrepListEditor';
import { useUserRole } from '@/hooks/useUserRole';
import { compressImage } from '@/utils/imageCompression';
import { parseLinkRefs } from '@/lib/checklistLinks';
import { archivePeriodCopy } from '@/utils/checklistVersions';
import { toItemRow, newItemKey, type EditorItem } from '@/lib/checklistEditorItems';
import { ChecklistEditor } from '@/components/checklists/editor/ChecklistEditor';
import type { ChecklistEditorSettings } from '@/components/checklists/editor/types';

import { DuoPage } from '@/components/duo/DuoPage';
type ChecklistItem = EditorItem;

/** Only the keys whose values differ (deep compare via JSON). */
function changedFields(before: Record<string, unknown>, after: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(after)) {
    if (JSON.stringify(before[k] ?? null) !== JSON.stringify(v ?? null)) out[k] = v;
  }
  return out;
}

export default function EditChecklist() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { isAdmin, loading: roleLoading } = useUserRole();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState<ChecklistEditorSettings>(() => ({
    title: '', description: '', templateType: 'standard', frequency: 'daily', scheduledDate: '',
    visibleDaysBeforeMonthEnd: 7, schedule: defaultScheduleForm(), dueByTime: '', lockUntilTime: '',
    lockTimeEnabled: false, selectedRoles: [], selectedUserIds: [], enableAmPmDivision: false,
    positionFilteringEnabled: false,
  }));
  const patchSettings = (patch: Partial<ChecklistEditorSettings>) => setSettings((prev) => ({ ...prev, ...patch }));
  const {
    title, description, frequency, scheduledDate, schedule, dueByTime, lockUntilTime, lockTimeEnabled,
    templateType, selectedRoles, selectedUserIds, visibleDaysBeforeMonthEnd, enableAmPmDivision,
    positionFilteringEnabled,
  } = settings;
  const { timezone: storeTimezone } = useLocationTimezone();
  const storeToday = getTodayInTimezone(storeTimezone);
  const [availablePositions, setAvailablePositions] = useState<string[]>([]);
  const [checklistLocationId, setChecklistLocationId] = useState<string | null>(null);
  const [items, setItems] = useState<ChecklistItem[]>([]);

  // Unsaved-changes tracking + stale-save snapshot (all hooks before any return).
  const itemSnapshotRef = useRef<Map<string, Record<string, unknown>>>(new Map());
  const captureBaselineRef = useRef(false);
  const [baselineKey, setBaselineKey] = useState<string | null>(null);
  const formKey = useMemo(() => JSON.stringify({
    title, description, frequency, scheduledDate, schedule, dueByTime, lockUntilTime, lockTimeEnabled,
    templateType, selectedRoles, selectedUserIds, visibleDaysBeforeMonthEnd, enableAmPmDivision,
    positionFilteringEnabled, items,
  }), [title, description, frequency, scheduledDate, schedule, dueByTime, lockUntilTime, lockTimeEnabled,
    templateType, selectedRoles, selectedUserIds, visibleDaysBeforeMonthEnd, enableAmPmDivision,
    positionFilteringEnabled, items]);
  const isDirty = baselineKey !== null && formKey !== baselineKey;

  useEffect(() => {
    if (loading || !captureBaselineRef.current) return;
    captureBaselineRef.current = false;
    const snap = new Map<string, Record<string, unknown>>();
    for (const it of items) {
      if (it.id) snap.set(it.id, { checklist_id: id, ...toItemRow(it, it.order_index, enableAmPmDivision, positionFilteringEnabled) });
    }
    itemSnapshotRef.current = snap;
    setBaselineKey(formKey);
  }, [loading, formKey, items, id, enableAmPmDivision, positionFilteringEnabled]);

  useEffect(() => {
    if (!isDirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [isDirty]);

  const leaveEditor = () => {
    if (isDirty && !window.confirm('You have unsaved changes. Leave without saving?')) return;
    navigate('/tasks');
  };

  useEffect(() => {
    if (!roleLoading && !isAdmin) {
      navigate('/tasks');
      toast({
        title: 'Access Denied',
        description: 'Only admins can edit checklist templates.',
        variant: 'destructive',
      });
    }
  }, [isAdmin, roleLoading, navigate, toast]);

  useEffect(() => {
    if (isAdmin && id) {
      fetchChecklist();
    }
  }, [isAdmin, id]);

  const normalizeTimeForInput = (value: string | null | undefined) => {
    if (!value) return '';
    return value.slice(0, 5);
  };

  const normalizeTimeForDb = (value: string | null | undefined) => {
    if (!value) return null;
    if (/^\d{2}:\d{2}$/.test(value)) return `${value}:00`;
    return value;
  };

  const fetchChecklist = async () => {
    try {
      setLoading(true);

      const { data: checklist, error: checklistError } = await supabase
        .from('checklists')
        .select('*')
        .eq('id', id)
        .maybeSingle();

      if (checklistError) throw checklistError;
      if (!checklist) {
        toast({
          title: 'Not found',
          description: 'Checklist was not found (or you do not have access).',
          variant: 'destructive',
        });
        navigate('/tasks');
        return;
      }

      const { data: checklistItems, error: itemsError } = await supabase
        .from('checklist_items')
        .select('*')
        .eq('checklist_id', id)
        .is('deleted_at', null)
        .order('order_index');


      if (itemsError) throw itemsError;

      const { data: roleTags, error: roleTagsError } = await supabase
        .from('checklist_role_tags')
        .select('role')
        .eq('checklist_id', id);

      if (roleTagsError) throw roleTagsError;

      const { data: userTags, error: userTagsError } = await supabase
        .from('checklist_user_tags')
        .select('user_id')
        .eq('checklist_id', id);

      if (userTagsError) throw userTagsError;

      const savedLockTime = normalizeTimeForInput(checklist.lock_until_time);
      setSettings({
        title: checklist.title,
        description: checklist.description || '',
        frequency: checklist.frequency as ChecklistEditorSettings['frequency'],
        scheduledDate: (checklist as any).scheduled_date || '',
        schedule: scheduleFormFromRow(checklist as any),
        dueByTime: normalizeTimeForInput(checklist.due_by_time),
        lockUntilTime: savedLockTime,
        lockTimeEnabled: !!savedLockTime,
        templateType: (checklist.template_type || 'standard') as ChecklistEditorSettings['templateType'],
        visibleDaysBeforeMonthEnd: checklist.visible_days_before_month_end || 7,
        enableAmPmDivision: (checklist as any).enable_am_pm_division || false,
        positionFilteringEnabled: (checklist as any).position_filtering_enabled || false,
        selectedRoles: roleTags?.map(rt => rt.role) || [],
        selectedUserIds: userTags?.map(ut => ut.user_id) || [],
      });
      setChecklistLocationId(checklist.location_id || null);

      // Fetch available positions
      if (checklist.location_id) {
        const { data: locData } = await supabase
          .from('locations')
          .select('organization_id')
          .eq('id', checklist.location_id)
          .single();
        
        if (locData?.organization_id) {
          const { data: orgLocs } = await supabase
            .from('locations')
            .select('id')
            .eq('organization_id', locData.organization_id);
          
          const locIds = orgLocs?.map(l => l.id) || [checklist.location_id];
          const { data: templates } = await supabase
            .from('shift_templates')
            .select('position')
            .in('location_id', locIds);
          
          const uniquePositions = [...new Set((templates || []).map(t => t.position).filter(Boolean))] as string[];
          setAvailablePositions(uniquePositions.sort());
        }
      }

      // Load prep_rows for any prep_list items
      const prepItemIds = (checklistItems || [])
        .filter((it: any) => it.item_type === 'prep_list')
        .map((it: any) => it.id);
      let prepRowsByItem: Record<string, PrepRow[]> = {};
      if (prepItemIds.length > 0) {
        const { data: prepRows } = await supabase
          .from('checklist_prep_rows')
          .select('*')
          .in('checklist_item_id', prepItemIds)
          .order('order_index');

        // Hydrate _enabled_pan_keys for any linked inventory items so the UI can show the pan select
        const linkedInvIds = Array.from(
          new Set((prepRows || []).map((r: any) => r.inventory_item_id).filter(Boolean))
        );
        const panMap: Record<string, string[]> = {};
        if (linkedInvIds.length > 0) {
          const { data: invItems } = await supabase
            .from('inventory_items')
            .select('id, pan_sizes')
            .in('id', linkedInvIds);
          (invItems || []).forEach((it: any) => {
            const ps = it.pan_sizes;
            if (ps && ps.enabled && Array.isArray(ps.enabled_keys) && ps.enabled_keys.length > 0) {
              panMap[it.id] = ps.enabled_keys;
            }
          });
        }

        (prepRows || []).forEach((r: any) => {
          const list = prepRowsByItem[r.checklist_item_id] || [];
          list.push({
            id: r.id,
            inventory_item_id: r.inventory_item_id,
            item_name: r.item_name,
            unit: r.unit,
            pan_key: (r as any).pan_key ?? null,
            par: r.par != null ? Number(r.par) : null,
            order_index: r.order_index,
            _enabled_pan_keys: r.inventory_item_id ? (panMap[r.inventory_item_id] || null) : null,
          });
          prepRowsByItem[r.checklist_item_id] = list;
        });
      }

      setItems((checklistItems || []).map(item => {
        // temperature is now a first-class type — also migrate old image+requires_temp items
        let itemType = item.item_type as string;
        if (itemType === 'image' && item.requires_temperature_validation) {
          itemType = 'temperature';
        }

        return {
          _key: newItemKey(),
          id: item.id,
          question: item.question,
          item_type: itemType as ChecklistItem['item_type'],
          is_required: item.is_required,
          temperature_alert_enabled: (item as any).temperature_alert_enabled || false,
          options: item.options as string[] | undefined,
          reference_image_url: getPrimaryReferencePhoto(item as any) || undefined,
          reference_image_urls: ((item as any).reference_image_urls as string[] | null) ?? [],
          reference_link: item.reference_link || undefined,
          reference_video_url: item.reference_video_url || undefined,
          reference_notes: item.reference_notes || undefined,
          order_index: item.order_index,
          manager_shift: (item as any).manager_shift || null,
          position: (item as any).position || null,
          station_id: (item as any).station_id || null,
          assigned_role: (item as any).assigned_role || null,
          assigned_user_id: (item as any).assigned_user_id || null,
          prep_rows: itemType === 'prep_list' ? (prepRowsByItem[item.id] || []) : undefined,
          link_refs: parseLinkRefs((item as any).link_refs),
        };
      }));
      // Capture the "as loaded" snapshot once state settles.
      captureBaselineRef.current = true;
    } catch (error: any) {
      console.error('Error fetching checklist:', error);
      toast({
        title: 'Error',
        description: error?.message || 'Failed to load checklist',
        variant: 'destructive',
      });
      navigate('/tasks');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!title.trim() || items.length === 0) {
      toast({
        title: 'Validation Error',
        description: 'Please provide a title and at least one checklist item.',
        variant: 'destructive',
      });
      return;
    }

    if (templateType === 'standard') {
      const scheduleError = scheduleFormError(schedule);
      if (scheduleError) {
        toast({ title: 'Check the frequency', description: scheduleError, variant: 'destructive' });
        return;
      }
    }

    try {
      setSaving(true);

      const lockDb = lockTimeEnabled ? normalizeTimeForDb(lockUntilTime) : null;
      const dueDb = normalizeTimeForDb(dueByTime);

      const checklistUpdate = {
        title,
        description,
        ...(templateType === 'standard'
          ? scheduleFormToRow(schedule, storeToday)
          : {
              frequency,
              scheduled_date: frequency === 'single_day' ? (scheduledDate || null) : null,
              visible_days_before_month_end: frequency === 'monthly' ? visibleDaysBeforeMonthEnd : null,
            }),
        due_by_time: dueDb,
        lock_until_time: lockDb,
        template_type: templateType,
        enable_am_pm_division: enableAmPmDivision,
        position_filtering_enabled: positionFilteringEnabled,
        updated_at: new Date().toISOString(),
      };

      const { error: checklistError } = await supabase
        .from('checklists')
        .update(checklistUpdate)
        .eq('id', id);

      if (checklistError) throw checklistError;

      // Archive removed items — never hard-delete. Crew stop seeing them right away,
      // this period's score keeps the hole, next period they aren't expected.
      const currentIds = new Set(items.filter(i => i.id).map(i => i.id as string));
      const { data: dbItems, error: dbItemsError } = await supabase
        .from('checklist_items')
        .select('id')
        .eq('checklist_id', id)
        .is('deleted_at', null);

      if (dbItemsError) throw dbItemsError;

      const removedIds = (dbItems || [])
        .map(r => r.id)
        .filter((dbId) => !currentIds.has(dbId));

      if (removedIds.length > 0) {
        const { error: archiveError } = await supabase
          .from('checklist_items')
          .update({ deleted_at: new Date().toISOString() })
          .in('id', removedIds);
        if (archiveError) throw archiveError;
      }


      const validItems = items.filter(item => item.question.trim() !== '');
      const savedIds: (string | undefined)[] = [];

      for (let index = 0; index < validItems.length; index++) {
        const item = validItems[index];
        const itemData = { checklist_id: id, ...toItemRow(item, index, enableAmPmDivision, positionFilteringEnabled) };

        let savedItemId = item.id;
        if (item.id) {
          // Stale-save protection: only send fields this editor actually changed
          // since load, so an old screen can't wipe someone else's edits.
          const before = itemSnapshotRef.current.get(item.id);
          const patch = before ? changedFields(before, itemData) : itemData;
          if (Object.keys(patch).length > 0) {
            const { error: updateError } = await supabase
              .from('checklist_items')
              .update(patch as any)
              .eq('id', item.id);
            if (updateError) throw updateError;
          }
        } else {
          const { data: inserted, error: insertError } = await supabase
            .from('checklist_items')
            .insert(itemData)
            .select('id')
            .single();
          if (insertError) throw insertError;
          savedItemId = inserted?.id;
        }
        savedIds.push(savedItemId);

        // Sync prep_rows for prep_list items.
        // IMPORTANT: do NOT delete-then-insert blindly — the FK on
        // checklist_prep_completions.prep_row_id is ON DELETE SET NULL,
        // which would nuke the linkage on every historical completion and
        // make past days look empty in the UI. Instead, diff: update rows
        // that still exist, insert new ones, and only delete rows the user
        // actually removed.
        if (item.item_type === 'prep_list' && savedItemId) {
          const incoming = (item.prep_rows || []).filter(
            (r: any) => r.item_name && r.item_name.trim() !== ''
          );
          const keptIds = incoming
            .map((r: any) => r.id)
            .filter((x: any) => typeof x === 'string' && x.length > 0);

          // Delete only rows the user removed from the editor.
          const delQuery = supabase
            .from('checklist_prep_rows')
            .delete()
            .eq('checklist_item_id', savedItemId);
          const { error: delErr } =
            keptIds.length > 0
              ? await delQuery.not('id', 'in', `(${keptIds.join(',')})`)
              : await delQuery;
          if (delErr) throw delErr;

          // Upsert remaining rows in order.


          for (let i = 0; i < incoming.length; i++) {
            const r = incoming[i];
            const payload = {
              checklist_item_id: savedItemId,
              inventory_item_id: r.inventory_item_id || null,
              item_name: r.item_name.trim(),
              unit: r.unit || null,
              pan_key: r.pan_key || null,
              par: r.par,
              order_index: i,
            };
            if (r.id) {
              const { error: updErr } = await supabase
                .from('checklist_prep_rows')
                .update(payload)
                .eq('id', r.id);
              if (updErr) throw updErr;
            } else {
              const { error: insErr } = await supabase
                .from('checklist_prep_rows')
                .insert(payload);
              if (insErr) throw insErr;
            }
          }
        }
      }

      // Role tags
      const { error: deleteRoleTagsError } = await supabase
        .from('checklist_role_tags')
        .delete()
        .eq('checklist_id', id);
      if (deleteRoleTagsError) throw deleteRoleTagsError;

      if (selectedRoles.length > 0) {
        const roleTagsToInsert = selectedRoles.map(role => ({
          checklist_id: id,
          role: role as 'admin' | 'manager' | 'team_member',
        }));
        const { error: roleTagsError } = await supabase
          .from('checklist_role_tags')
          .insert(roleTagsToInsert);
        if (roleTagsError) throw roleTagsError;
      }

      // User tags (individual people granted access on top of role tags)
      const { error: deleteUserTagsError } = await supabase
        .from('checklist_user_tags')
        .delete()
        .eq('checklist_id', id);
      if (deleteUserTagsError) throw deleteUserTagsError;

      if (selectedUserIds.length > 0) {
        const userTagsToInsert = selectedUserIds.map(user_id => ({
          checklist_id: id!,
          user_id,
        }));
        const { error: userTagsError } = await supabase
          .from('checklist_user_tags')
          .insert(userTagsToInsert);
        if (userTagsError) throw userTagsError;
      }

      const archiveCopy = archivePeriodCopy({ template_type: templateType, frequency, ...(templateType === 'standard' ? scheduleFormToRow(schedule, storeToday) : {}) } as any);
      toast({
        title: 'Success',
        description: removedIds.length > 0
          ? `Checklist updated. ${removedIds.length} task${removedIds.length === 1 ? '' : 's'} pulled off the floor — no overdue reminders for them. ${archiveCopy.scoreLine} ${archiveCopy.nextLine}`
          : 'Checklist updated successfully',
      });

      // Refresh the snapshot and clear the dirty flag before leaving.
      const nextSnap = new Map<string, Record<string, unknown>>();
      validItems.forEach((it, i) => {
        const sid = savedIds[i];
        if (sid) nextSnap.set(sid, { checklist_id: id, ...toItemRow(it, i, enableAmPmDivision, positionFilteringEnabled) });
      });
      itemSnapshotRef.current = nextSnap;
      setBaselineKey(formKey);
      navigate('/tasks');
    } catch (error: any) {
      console.error('Error updating checklist:', error);
      toast({
        title: 'Error',
        description: error?.message || error?.details || 'Failed to update checklist',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };
  const uploadReference = async (file: File): Promise<string> => {
    // Errors propagate so the photo slot shows its inline message.
    const compressedFile = await compressImage(file, 1200, 1200, 0.8);
    const fileName = `references/${id || 'new'}/ref-${Date.now()}.jpg`;
    const { error: uploadError } = await supabase.storage.from('checklist-images').upload(fileName, compressedFile);
    if (uploadError) throw uploadError;
    const { data } = supabase.storage.from('checklist-images').getPublicUrl(fileName);
    toast({ title: 'Photo added', description: 'Tap Save to keep it.' });
    return data.publicUrl;
  };

  if (roleLoading || loading) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </Layout>
    );
  }

  if (!isAdmin) return null;

  return (
    <Layout>
    <DuoPage>
      <div className="-mx-1 md:mx-auto max-w-[1200px] pt-1 pb-4">
        <ChecklistEditor
          fallbackTitle="Edit checklist"
          initialTab="items"
          settings={settings}
          onSettingsChange={patchSettings}
          items={items}
          setItems={setItems}
          templateTypeOptions={templateType === 'dynamic' ? ['dynamic'] : ['standard', 'training']}
          locationId={checklistLocationId}
          storeToday={storeToday}
          availablePositions={availablePositions}
          uploadReference={uploadReference}
          minItems={0}
          bulkUpload={templateType !== 'dynamic'}
          singleDayHint="Shows only on this date, then moves to history."
          onCancel={leaveEditor}
          onSave={handleSave}
          saving={saving}
          saveLabel="Save"
          saveLabelWide="Save changes"
          savingLabel="Saving..."
          notice={isDirty ? (
            <span role="status">Unsaved changes</span>
          ) : null}
        />
      </div>
    </DuoPage>
    </Layout>
  );
}
