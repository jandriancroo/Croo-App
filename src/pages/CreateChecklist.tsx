import { PageTitle } from '@/components/PageTitle';
import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { useUserRole } from '@/hooks/useUserRole';
import { useLocation } from '@/hooks/useLocation';
import { Layout } from '@/components/Layout';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Plus, Loader2, FileInput, ArrowLeft } from 'lucide-react';
import { toast } from 'sonner';
import { compressImage } from '@/utils/imageCompression';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { defaultScheduleForm, scheduleFormError, scheduleFormToRow } from '@/lib/checklistScheduleForm';
import { useLocationTimezone } from '@/hooks/useLocationTimezone';
import { getTodayInTimezone } from '@/utils/timezoneUtils';
import { blankItem, toItemRow, withKey, newItemKey, type EditorItem } from '@/lib/checklistEditorItems';
import { ChecklistEditor } from '@/components/checklists/editor/ChecklistEditor';
import type { ChecklistEditorSettings } from '@/components/checklists/editor/types';

type ChecklistItem = EditorItem;

export default function CreateChecklist() {
  const [searchParams] = useSearchParams();
  const initialType = searchParams.get('type') === 'training' ? 'training' : 'standard';
  const [settings, setSettings] = useState<ChecklistEditorSettings>(() => ({
    title: '', description: '', templateType: initialType, frequency: 'daily', scheduledDate: '',
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
  const [items, setItems] = useState<ChecklistItem[]>(() => [blankItem()]);
  const [loading, setLoading] = useState(false);
  const [bulkText, setBulkText] = useState('');
  const [didLoadDraft, setDidLoadDraft] = useState(false);
  const [availablePositions, setAvailablePositions] = useState<string[]>([]);

  const { user } = useAuth();
  const { isAdmin, loading: roleLoading } = useUserRole();
  const { currentLocation } = useLocation();
  const navigate = useNavigate();

  const draftKey = `createChecklistDraft:${currentLocation?.id ?? 'no-location'}`;

  // Fetch available positions from shift templates
  useEffect(() => {
    if (!currentLocation?.id) return;
    const fetchPositions = async () => {
      const { data: locData } = await supabase
        .from('locations')
        .select('organization_id')
        .eq('id', currentLocation.id)
        .single();
      if (locData?.organization_id) {
        const { data: orgLocs } = await supabase
          .from('locations')
          .select('id')
          .eq('organization_id', locData.organization_id);
        const locIds = orgLocs?.map(l => l.id) || [currentLocation.id];
        const { data: templates } = await supabase
          .from('shift_templates')
          .select('position')
          .in('location_id', locIds);
        const uniquePositions = [...new Set((templates || []).map(t => t.position).filter(Boolean))] as string[];
        setAvailablePositions(uniquePositions.sort());
      }
    };
    fetchPositions();
  }, [currentLocation?.id]);

  useEffect(() => {
    if (!roleLoading && !isAdmin) {
      navigate('/');
      toast.error('Only admins can create checklists');
    }
  }, [isAdmin, roleLoading, navigate]);

  useEffect(() => {
    if (!isAdmin || roleLoading) return;
    if (!currentLocation?.id) return;
    if (didLoadDraft) return;

    try {
      const raw = localStorage.getItem(draftKey);
      if (!raw) {
        setDidLoadDraft(true);
        return;
      }

      const parsed = JSON.parse(raw);
      const savedLockTime = parsed.lockUntilTime ?? '';
      setSettings((prev) => ({
        ...prev,
        title: parsed.title ?? '',
        description: parsed.description ?? '',
        frequency: parsed.frequency ?? 'daily',
        scheduledDate: parsed.scheduledDate ?? '',
        schedule: parsed.schedule && typeof parsed.schedule === 'object' ? { ...defaultScheduleForm(), ...parsed.schedule } : prev.schedule,
        dueByTime: parsed.dueByTime ?? '',
        lockUntilTime: savedLockTime,
        lockTimeEnabled: !!savedLockTime,
        templateType: parsed.templateType ?? 'standard',
        selectedRoles: Array.isArray(parsed.selectedRoles) ? parsed.selectedRoles : [],
        selectedUserIds: Array.isArray(parsed.selectedUserIds) ? parsed.selectedUserIds : [],
        visibleDaysBeforeMonthEnd: typeof parsed.visibleDaysBeforeMonthEnd === 'number' ? parsed.visibleDaysBeforeMonthEnd : 7,
        // Added in Phase C; older drafts don't have these keys.
        enableAmPmDivision: !!parsed.enableAmPmDivision,
        positionFilteringEnabled: !!parsed.positionFilteringEnabled,
      }));
      setItems(Array.isArray(parsed.items) && parsed.items.length > 0 ? parsed.items.map(withKey) : [blankItem()]);
      setBulkText(parsed.bulkText ?? '');
    } catch {
      // If draft is corrupted, ignore it
    } finally {
      setDidLoadDraft(true);
    }
  }, [currentLocation?.id, didLoadDraft, draftKey, isAdmin, roleLoading]);

  useEffect(() => {
    if (!didLoadDraft) return;
    if (!isAdmin || roleLoading) return;
    if (!currentLocation?.id) return;

    try {
      localStorage.setItem(
        draftKey,
        JSON.stringify({
          title, description, frequency, scheduledDate, schedule, dueByTime,
          lockUntilTime: lockTimeEnabled ? lockUntilTime : '',
          templateType, selectedRoles, selectedUserIds, visibleDaysBeforeMonthEnd, items, bulkText,
          enableAmPmDivision, positionFilteringEnabled,
        })
      );
    } catch {
      // ignore storage errors
    }
  }, [didLoadDraft, isAdmin, roleLoading, currentLocation?.id, draftKey, title, description, frequency, scheduledDate, schedule, dueByTime, lockUntilTime, lockTimeEnabled, templateType, selectedRoles, selectedUserIds, visibleDaysBeforeMonthEnd, items, bulkText, enableAmPmDivision, positionFilteringEnabled]);

  const clearDraft = () => {
    try { localStorage.removeItem(draftKey); } catch { /* ignore */ }
  };

  if (roleLoading || !isAdmin) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </Layout>
    );
  }

  const uploadReference = async (file: File): Promise<string> => {
    // Errors propagate so the photo slot shows its inline message.
    const compressedFile = await compressImage(file, 1200, 1200, 0.8);
    const fileName = `references/new/new-${Date.now()}.jpg`;
    const { error: uploadError } = await supabase.storage.from('checklist-images').upload(fileName, compressedFile);
    if (uploadError) throw uploadError;
    const { data } = supabase.storage.from('checklist-images').getPublicUrl(fileName);
    toast.success('Reference image uploaded');
    return data.publicUrl;
  };

  const parseBulkText = () => {
    if (!bulkText.trim()) {
      toast.error('Please enter some text to parse');
      return;
    }

    const lines = bulkText.split('\n').filter(line => line.trim());
    const newItems: ChecklistItem[] = [];

    lines.forEach(line => {
      const trimmedLine = line.trim();
      let item: ChecklistItem = {
        _key: newItemKey(),
        question: trimmedLine,
        item_type: 'confirmation',
        is_required: true
      };

      if (trimmedLine.toLowerCase().startsWith('photo:')) {
        item.question = trimmedLine.substring(6).trim();
        item.item_type = 'image';
      } else if (trimmedLine.toLowerCase().startsWith('temp:')) {
        item.question = trimmedLine.substring(5).trim();
        item.item_type = 'temperature';
      } else if (trimmedLine.toLowerCase().startsWith('text:')) {
        item.question = trimmedLine.substring(5).trim();
        item.item_type = 'text';
      } else if (trimmedLine.toLowerCase().startsWith('confirm:') || trimmedLine.toLowerCase().startsWith('check:')) {
        const colonIndex = trimmedLine.indexOf(':');
        item.question = trimmedLine.substring(colonIndex + 1).trim();
        item.item_type = 'confirmation';
      } else if (trimmedLine.toLowerCase().startsWith('mc:') || trimmedLine.toLowerCase().startsWith('choice:')) {
        const colonIndex = trimmedLine.indexOf(':');
        const rest = trimmedLine.substring(colonIndex + 1).trim();
        const pipeIndex = rest.indexOf('|');
        
        if (pipeIndex > -1) {
          item.question = rest.substring(0, pipeIndex).trim();
          item.options = rest.substring(pipeIndex + 1).split(',').map(opt => opt.trim()).filter(opt => opt);
          item.item_type = 'multiple_choice';
        } else {
          item.question = rest;
          item.item_type = 'multiple_choice';
          item.options = ['Yes', 'No', 'N/A'];
        }
      }

      if (item.question) {
        newItems.push(item);
      }
    });

    if (newItems.length > 0) {
      setItems([...items, ...newItems]);
      setBulkText('');
      toast.success(`Added ${newItems.length} item${newItems.length > 1 ? 's' : ''}`);
    } else {
      toast.error('No valid items found');
    }
  };

  const handleSubmit = async () => {
    if (!title.trim() || items.filter((i) => i.question.trim() !== '').length === 0) {
      toast.error('Please provide a title and at least one checklist item.');
      return;
    }

    if (!user?.id) {
      toast.error('Your session is missing. Please sign out and sign back in.');
      return;
    }
    if (!currentLocation?.id) {
      toast.error('Please select a location first');
      return;
    }
    if (templateType === 'standard') {
      const scheduleError = scheduleFormError(schedule);
      if (scheduleError) {
        toast.error(scheduleError);
        return;
      }
    }

    setLoading(true);
    try {
      if (templateType === 'dynamic') {
        await createDynamicTemplate(user.id, currentLocation.id);
      } else {
        await createStandardChecklist(user.id, currentLocation.id);
        toast.success('Checklist created successfully!');
        navigate('/tasks');
      }
    } catch (error: any) {
      toast.error(error.message || 'Failed to create checklist');
    } finally {
      setLoading(false);
    }
  };

  const validItems = () => items.filter((item) => item.question.trim() !== '');

  const buildItemsToInsert = (checklistId: string) =>
    validItems().map((item, index) => ({
      checklist_id: checklistId,
      ...toItemRow(item, index, enableAmPmDivision, positionFilteringEnabled),
    }));

  /** Insert items, then prep rows for any Prep List tasks (same rows Edit writes). */
  const insertItems = async (checklistId: string) => {
    const list = validItems();
    const { data: inserted, error: itemsError } = await supabase
      .from('checklist_items')
      .insert(buildItemsToInsert(checklistId))
      .select('id, order_index');
    if (itemsError) throw itemsError;
    const idByIndex = new Map((inserted || []).map((r: any) => [r.order_index, r.id as string]));
    const prepPayload = list.flatMap((item, index) => {
      if (item.item_type !== 'prep_list') return [];
      const itemId = idByIndex.get(index);
      if (!itemId) return [];
      return (item.prep_rows || [])
        .filter((r) => r.item_name && r.item_name.trim() !== '')
        .map((r, i) => ({
          checklist_item_id: itemId,
          inventory_item_id: r.inventory_item_id || null,
          item_name: r.item_name.trim(),
          unit: r.unit || null,
          pan_key: r.pan_key || null,
          par: r.par ?? null,
          order_index: i,
        }));
    });
    if (prepPayload.length > 0) {
      const { error: prepErr } = await supabase.from('checklist_prep_rows').insert(prepPayload);
      if (prepErr) throw prepErr;
    }
  };

  const createStandardChecklist = async (userId: string, locationId: string) => {
    const { data: checklist, error: checklistError } = await supabase
      .from('checklists')
      .insert({
        title, description,
        ...(templateType === 'training'
          ? { frequency: 'single_day', scheduled_date: null, visible_days_before_month_end: null }
          : scheduleFormToRow(schedule, storeToday)),
        due_by_time: dueByTime || null,
        lock_until_time: lockTimeEnabled && lockUntilTime ? lockUntilTime : null,
        template_type: templateType === 'training' ? 'training' : 'standard',
        created_by: userId,
        location_id: locationId,
        position_filtering_enabled: positionFilteringEnabled,
        enable_am_pm_division: enableAmPmDivision,
      })
      .select()
      .single();

    if (checklistError) throw checklistError;

    await insertItems(checklist.id);

    if (selectedRoles.length > 0) {
      const roleTagsToInsert = selectedRoles.map((role) => ({
        checklist_id: checklist.id,
        role: role as 'super_admin' | 'admin' | 'manager' | 'shift_manager' | 'shift_manager_in_training' | 'team_member',
      }));
      const { error: roleTagsError } = await supabase.from('checklist_role_tags').insert(roleTagsToInsert);
      if (roleTagsError) throw roleTagsError;
    }

    if (selectedUserIds.length > 0) {
      const userTagsToInsert = selectedUserIds.map((user_id) => ({
        checklist_id: checklist.id,
        user_id,
      }));
      const { error: userTagsError } = await supabase.from('checklist_user_tags').insert(userTagsToInsert);
      if (userTagsError) throw userTagsError;
    }

    clearDraft();
  };

  const createDynamicTemplate = async (userId: string, locationId: string) => {
    const { data: checklist, error: checklistError } = await supabase
      .from('checklists')
      .insert({
        title, description, frequency,
        due_by_time: dueByTime || null,
        lock_until_time: lockTimeEnabled && lockUntilTime ? lockUntilTime : null,
        template_type: 'dynamic',
        created_by: userId,
        location_id: locationId,
        position_filtering_enabled: positionFilteringEnabled,
        enable_am_pm_division: enableAmPmDivision,
      })
      .select()
      .single();

    if (checklistError) throw checklistError;

    await insertItems(checklist.id);

    if (selectedRoles.length > 0) {
      const roleTagsToInsert = selectedRoles.map((role) => ({
        checklist_id: checklist.id,
        role: role as 'super_admin' | 'admin' | 'manager' | 'shift_manager' | 'shift_manager_in_training' | 'team_member',
      }));
      const { error: roleTagsError } = await supabase.from('checklist_role_tags').insert(roleTagsToInsert);
      if (roleTagsError) throw roleTagsError;
    }

    if (selectedUserIds.length > 0) {
      const userTagsToInsert = selectedUserIds.map((user_id) => ({
        checklist_id: checklist.id,
        user_id,
      }));
      const { error: userTagsError } = await supabase.from('checklist_user_tags').insert(userTagsToInsert);
      if (userTagsError) throw userTagsError;
    }

    clearDraft();
    toast.success('Template created! Now assign tasks to days.');
    navigate(`/dynamic-checklist/${checklist.id}`);
  };

  const bulkAdd = (
    <Collapsible>
      <CollapsibleTrigger asChild>
        <Button type="button" variant="ghost" className="h-11 w-full text-sm text-muted-foreground">
          <FileInput className="h-4 w-4 mr-2" />
          Bulk Add Items
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-2 space-y-3">
        <p className="text-sm text-muted-foreground">
          One per line. Prefixes: <code>Photo:</code> <code>Temp:</code> <code>Text:</code> <code>Confirm:</code> <code>MC: question | opt1, opt2</code>
        </p>
        <Textarea
          value={bulkText}
          onChange={(e) => setBulkText(e.target.value)}
          placeholder="Photo: Take picture of prep station&#10;Confirm: All surfaces sanitized&#10;Temp: Walk-in cooler"
          rows={5}
          className="font-mono text-sm"
        />
        <Button type="button" onClick={parseBulkText} variant="secondary" className="h-11 w-full">
          <Plus className="h-4 w-4 mr-2" />
          Parse & Add Items
        </Button>
      </CollapsibleContent>
    </Collapsible>
  );

  return (
    <Layout>
      <div className="max-w-5xl mx-auto [&>*:not(:first-child):not(:nth-child(2))]:mt-4 p-4">
        <PageTitle color="teal" leading={
          <Button variant="ghost" size="icon" onClick={() => navigate('/tasks')} aria-label="Back">
            <ArrowLeft className="h-5 w-5" />
          </Button>
        }>Create Checklist</PageTitle>

        <ChecklistEditor
          initialTab="settings"
          settings={settings}
          onSettingsChange={patchSettings}
          items={items}
          setItems={setItems}
          templateTypeOptions={['standard', 'dynamic', 'training']}
          locationId={currentLocation?.id}
          storeToday={storeToday}
          availablePositions={availablePositions}
          uploadReference={uploadReference}
          addPosition="end"
          minItems={1}
          singleDayHint="Shows only on this date, then moves to history. Leave blank for today."
          onCancel={() => navigate('/tasks')}
          onSave={handleSubmit}
          saving={loading}
          saveLabel="Create"
          savingLabel="Creating..."
          itemsFooter={bulkAdd}
        />
      </div>
    </Layout>
  );
}
