import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export type CloneType = 'shift_templates' | 'checklists' | 'logbook_categories' | 'writeup_reasons';

interface CloneResult {
  type: CloneType;
  targetName: string;
  count: number;
  skipped: number;
}

export function useCloneLocationSettings() {
  const [cloning, setCloning] = useState(false);
  const [results, setResults] = useState<CloneResult[]>([]);

  const cloneShiftTemplates = async (sourceLocationId: string, targetLocationId: string, targetName: string): Promise<CloneResult> => {
    const { data: templates, error } = await supabase
      .from('shift_templates')
      .select('*')
      .eq('location_id', sourceLocationId);

    if (error) throw error;
    if (!templates?.length) return { type: 'shift_templates', targetName, count: 0, skipped: 0 };

    // Check existing at target
    const { data: existing } = await supabase
      .from('shift_templates')
      .select('position, start_time, end_time')
      .eq('location_id', targetLocationId);

    const existingSet = new Set((existing || []).map(e => `${e.position}|${e.start_time}|${e.end_time}`));

    const toInsert = templates.filter(t => !existingSet.has(`${t.position}|${t.start_time}|${t.end_time}`));
    const skipped = templates.length - toInsert.length;

    if (toInsert.length > 0) {
      const rows = toInsert.map(t => ({
        location_id: targetLocationId,
        start_time: t.start_time,
        end_time: t.end_time,
        position: t.position,
        color: t.color,
        role_type: t.role_type,
      }));
      const { error: insertError } = await supabase.from('shift_templates').insert(rows);
      if (insertError) throw insertError;
    }

    return { type: 'shift_templates', targetName, count: toInsert.length, skipped };
  };

  const cloneChecklists = async (sourceLocationId: string, targetLocationId: string, targetName: string): Promise<CloneResult> => {
    const { data: checklists, error } = await supabase
      .from('checklists')
      .select('*, checklist_items(*), checklist_role_tags(*)')
      .eq('location_id', sourceLocationId)
      .eq('is_active', true);

    if (error) throw error;
    if (!checklists?.length) return { type: 'checklists', targetName, count: 0, skipped: 0 };

    let count = 0;
    for (const cl of checklists) {
      // Soft replace: deactivate existing with same title
      await supabase
        .from('checklists')
        .update({ is_active: false })
        .eq('location_id', targetLocationId)
        .eq('title', cl.title)
        .eq('is_active', true);

      // Insert new checklist
      const { data: newCl, error: clError } = await supabase
        .from('checklists')
        .insert({
          location_id: targetLocationId,
          title: cl.title,
          description: cl.description,
          frequency: cl.frequency,
          is_active: true,
          due_by_time: cl.due_by_time,
          template_type: cl.template_type,
          enable_am_pm_division: cl.enable_am_pm_division,
          position_filtering_enabled: cl.position_filtering_enabled,
          display_order: cl.display_order,
          assigned_day_of_week: cl.assigned_day_of_week,
          lock_until_time: cl.lock_until_time,
          visible_days_before_month_end: cl.visible_days_before_month_end,
        })
        .select('id')
        .single();

      if (clError) throw clError;

      // Clone items
      const items = cl.checklist_items || [];
      if (items.length > 0) {
        const itemRows = items.map((item: any) => ({
          checklist_id: newCl.id,
          question: item.question,
          item_type: item.item_type,
          order_index: item.order_index,
          is_required: item.is_required,
          options: item.options,
          days_of_week: item.days_of_week,
          position: item.position,
          manager_shift: item.manager_shift,
          reference_image_url: item.reference_image_url,
          reference_video_url: item.reference_video_url,
          reference_link: item.reference_link,
          reference_notes: item.reference_notes,
          requires_temperature_validation: item.requires_temperature_validation,
          temperature_alert_enabled: item.temperature_alert_enabled,
        }));
        await supabase.from('checklist_items').insert(itemRows);
      }

      // Clone role tags
      const roleTags = cl.checklist_role_tags || [];
      if (roleTags.length > 0) {
        const tagRows = roleTags.map((tag: any) => ({
          checklist_id: newCl.id,
          role: tag.role,
        }));
        await supabase.from('checklist_role_tags').insert(tagRows);
      }

      count++;
    }

    return { type: 'checklists', targetName, count, skipped: 0 };
  };

  const cloneLogbookCategories = async (sourceLocationId: string, targetLocationId: string, targetName: string): Promise<CloneResult> => {
    const { data: categories, error } = await supabase
      .from('logbook_categories')
      .select('*')
      .eq('location_id', sourceLocationId)
      .eq('is_active', true);

    if (error) throw error;
    if (!categories?.length) return { type: 'logbook_categories', targetName, count: 0, skipped: 0 };

    const { data: existing } = await supabase
      .from('logbook_categories')
      .select('name')
      .eq('location_id', targetLocationId);

    const existingNames = new Set((existing || []).map(e => e.name.toLowerCase()));
    const toInsert = categories.filter(c => !existingNames.has(c.name.toLowerCase()));

    if (toInsert.length > 0) {
      const rows = toInsert.map(c => ({
        location_id: targetLocationId,
        name: c.name,
        display_order: c.display_order,
        is_active: true,
        alert_enabled: c.alert_enabled,
        push_notification_enabled: c.push_notification_enabled,
      }));
      await supabase.from('logbook_categories').insert(rows);
    }

    return { type: 'logbook_categories', targetName, count: toInsert.length, skipped: categories.length - toInsert.length };
  };

  const cloneWriteupReasons = async (sourceLocationId: string, targetLocationId: string, targetName: string): Promise<CloneResult> => {
    const { data: reasons, error } = await supabase
      .from('employee_writeup_reasons')
      .select('*')
      .eq('location_id', sourceLocationId)
      .eq('is_active', true);

    if (error) throw error;
    if (!reasons?.length) return { type: 'writeup_reasons', targetName, count: 0, skipped: 0 };

    const { data: existing } = await supabase
      .from('employee_writeup_reasons')
      .select('reason')
      .eq('location_id', targetLocationId);

    const existingReasons = new Set((existing || []).map(e => e.reason.toLowerCase()));
    const toInsert = reasons.filter(r => !existingReasons.has(r.reason.toLowerCase()));

    if (toInsert.length > 0) {
      const rows = toInsert.map(r => ({
        location_id: targetLocationId,
        reason: r.reason,
        display_order: r.display_order,
        is_active: true,
      }));
      await supabase.from('employee_writeup_reasons').insert(rows);
    }

    return { type: 'writeup_reasons', targetName, count: toInsert.length, skipped: reasons.length - toInsert.length };
  };

  const ensurePositions = async (sourceLocationId: string, targetLocationIds: string[]) => {
    // Get source org
    const { data: sourceLoc } = await supabase
      .from('locations')
      .select('organization_id')
      .eq('id', sourceLocationId)
      .single();

    if (!sourceLoc) return;

    const { data: sourcePositions } = await supabase
      .from('organization_positions')
      .select('name')
      .eq('organization_id', sourceLoc.organization_id);

    if (!sourcePositions?.length) return;

    // Get unique target org IDs
    const { data: targetLocs } = await supabase
      .from('locations')
      .select('organization_id')
      .in('id', targetLocationIds);

    const targetOrgIds = [...new Set((targetLocs || []).map(l => l.organization_id))];

    for (const orgId of targetOrgIds) {
      if (orgId === sourceLoc.organization_id) continue;

      const { data: existingPos } = await supabase
        .from('organization_positions')
        .select('name')
        .eq('organization_id', orgId);

      const existingNames = new Set((existingPos || []).map(p => p.name.toLowerCase()));
      const missing = sourcePositions.filter(p => !existingNames.has(p.name.toLowerCase()));

      if (missing.length > 0) {
        await supabase.from('organization_positions').insert(
          missing.map(p => ({ organization_id: orgId, name: p.name }))
        );
      }
    }
  };

  const cloneSettings = async (
    sourceLocationId: string,
    targetLocationIds: string[],
    selectedTypes: CloneType[],
    locationNames: Record<string, string>
  ) => {
    setCloning(true);
    setResults([]);
    const allResults: CloneResult[] = [];

    try {
      // Ensure positions exist in target orgs if cloning shift templates
      if (selectedTypes.includes('shift_templates')) {
        await ensurePositions(sourceLocationId, targetLocationIds);
      }

      for (const targetId of targetLocationIds) {
        const targetName = locationNames[targetId] || targetId;

        for (const type of selectedTypes) {
          try {
            let result: CloneResult;
            switch (type) {
              case 'shift_templates':
                result = await cloneShiftTemplates(sourceLocationId, targetId, targetName);
                break;
              case 'checklists':
                result = await cloneChecklists(sourceLocationId, targetId, targetName);
                break;
              case 'logbook_categories':
                result = await cloneLogbookCategories(sourceLocationId, targetId, targetName);
                break;
              case 'writeup_reasons':
                result = await cloneWriteupReasons(sourceLocationId, targetId, targetName);
                break;
            }
            allResults.push(result);
          } catch (err: any) {
            console.error(`Error cloning ${type} to ${targetName}:`, err);
            toast.error(`Failed to clone ${type} to ${targetName}`);
          }
        }
      }

      setResults(allResults);
      const totalCloned = allResults.reduce((sum, r) => sum + r.count, 0);
      toast.success(`Clone complete — ${totalCloned} items deployed across ${targetLocationIds.length} location(s)`);
    } catch (err: any) {
      console.error('Clone error:', err);
      toast.error('Clone operation failed');
    } finally {
      setCloning(false);
    }
  };

  return { cloning, results, cloneSettings };
}
