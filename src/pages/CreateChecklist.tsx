import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { useUserRole } from '@/hooks/useUserRole';
import { useLocation } from '@/hooks/useLocation';
import { Layout } from '@/components/Layout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Trash2, Upload, Link as LinkIcon, Video, Loader2, FileInput, ArrowLeft, ChevronDown, ChevronUp } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import { compressImage } from '@/utils/imageCompression';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { NotesTextarea } from '@/components/tasks/NotesTextarea';
import { AssigneePicker } from '@/components/shared/AssigneePicker';
import { ChecklistMentionInput } from '@/components/tasks/ChecklistMentionInput';
import type { ChecklistLinkRef } from '@/lib/checklistLinks';

interface ChecklistItem {
  question: string;
  item_type: 'text' | 'multiple_choice' | 'image' | 'confirmation' | 'temperature' | 'number' | 'section_header';
  options?: string[];
  is_required: boolean;
  temperature_alert_enabled?: boolean;
  reference_image_url?: string;
  reference_link?: string;
  reference_video_url?: string;
  reference_notes?: string;
  position?: string | null;
  link_refs?: ChecklistLinkRef[];
}

export default function CreateChecklist() {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [frequency, setFrequency] = useState<'daily' | 'weekly' | 'monthly'>('daily');
  const [dueByTime, setDueByTime] = useState('');
  const [lockUntilTime, setLockUntilTime] = useState('');
  const [lockTimeEnabled, setLockTimeEnabled] = useState(false);
  const [templateType, setTemplateType] = useState<'standard' | 'dynamic'>('standard');
  const [selectedRoles, setSelectedRoles] = useState<string[]>([]);
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [visibleDaysBeforeMonthEnd, setVisibleDaysBeforeMonthEnd] = useState<number | null>(7);
  const [items, setItems] = useState<ChecklistItem[]>([
    { question: '', item_type: 'confirmation', is_required: true }
  ]);
  const [loading, setLoading] = useState(false);
  const [uploadingImage, setUploadingImage] = useState<string | null>(null);
  const [bulkText, setBulkText] = useState('');
  const [didLoadDraft, setDidLoadDraft] = useState(false);
  const [positionFilteringEnabled, setPositionFilteringEnabled] = useState(false);
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
      setTitle(parsed.title ?? '');
      setDescription(parsed.description ?? '');
      setFrequency(parsed.frequency ?? 'daily');
      setDueByTime(parsed.dueByTime ?? '');
      const savedLockTime = parsed.lockUntilTime ?? '';
      setLockUntilTime(savedLockTime);
      setLockTimeEnabled(!!savedLockTime);
      setTemplateType(parsed.templateType ?? 'standard');
      setSelectedRoles(Array.isArray(parsed.selectedRoles) ? parsed.selectedRoles : []);
      setSelectedUserIds(Array.isArray(parsed.selectedUserIds) ? parsed.selectedUserIds : []);
      setVisibleDaysBeforeMonthEnd(
        typeof parsed.visibleDaysBeforeMonthEnd === 'number' ? parsed.visibleDaysBeforeMonthEnd : 7
      );
      setItems(Array.isArray(parsed.items) && parsed.items.length > 0 ? parsed.items : [{ question: '', item_type: 'confirmation', is_required: true }]);
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
          title, description, frequency, dueByTime,
          lockUntilTime: lockTimeEnabled ? lockUntilTime : '',
          templateType, selectedRoles, selectedUserIds, visibleDaysBeforeMonthEnd, items, bulkText,
        })
      );
    } catch {
      // ignore storage errors
    }
  }, [didLoadDraft, isAdmin, roleLoading, currentLocation?.id, draftKey, title, description, frequency, dueByTime, lockUntilTime, lockTimeEnabled, templateType, selectedRoles, selectedUserIds, visibleDaysBeforeMonthEnd, items, bulkText]);

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

  const addItem = () => {
    setItems([...items, { question: '', item_type: 'confirmation', is_required: true }]);
  };

  const removeItem = (index: number) => {
    setItems(items.filter((_, i) => i !== index));
  };

  const updateItem = (index: number, field: keyof ChecklistItem, value: any) => {
    // Functional update — two fields can be written in the same tick (e.g. an
    // @mention sets both `question` and `link_refs`) without clobbering each other.
    setItems((prev) => {
      const newItems = [...prev];
      newItems[index] = { ...newItems[index], [field]: value };
      return newItems;
    });
  };

  const handleReferenceImageUpload = async (index: number, file: File) => {
    setUploadingImage(`${index}`);
    try {
      const compressedFile = await compressImage(file, 1200, 1200, 0.8);
      const fileName = `references/${user?.id}/${Date.now()}.jpg`;
      
      const { error: uploadError } = await supabase.storage
        .from('checklist-images')
        .upload(fileName, compressedFile);
      if (uploadError) throw uploadError;

      const { data } = supabase.storage
        .from('checklist-images')
        .getPublicUrl(fileName);

      updateItem(index, 'reference_image_url', data.publicUrl);
      toast.success('Reference image uploaded');
    } catch (error: any) {
      toast.error('Failed to upload image');
    } finally {
      setUploadingImage(null);
    }
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!user?.id) {
      toast.error('Your session is missing. Please sign out and sign back in.');
      return;
    }
    if (!currentLocation?.id) {
      toast.error('Please select a location first');
      return;
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

  const buildItemsToInsert = (checklistId: string) => {
    return items.map((item, index) => ({
      checklist_id: checklistId,
      question: item.question,
      item_type: item.item_type,
      options: item.item_type === 'multiple_choice' ? item.options : null,
      order_index: index,
      is_required: item.is_required,
      requires_temperature_validation: item.item_type === 'temperature',
      temperature_alert_enabled: item.item_type === 'temperature' ? (item.temperature_alert_enabled || false) : false,
      reference_image_url: item.reference_image_url || null,
      reference_link: item.reference_link || null,
      reference_video_url: item.reference_video_url || null,
      reference_notes: item.reference_notes || null,
      position: positionFilteringEnabled ? (item.position || null) : null,
      link_refs: (item.link_refs && item.link_refs.length > 0 ? item.link_refs : null) as any,
    }));
  };

  const createStandardChecklist = async (userId: string, locationId: string) => {
    const { data: checklist, error: checklistError } = await supabase
      .from('checklists')
      .insert({
        title, description, frequency,
        due_by_time: dueByTime || null,
        lock_until_time: lockTimeEnabled && lockUntilTime ? lockUntilTime : null,
        template_type: 'standard',
        created_by: userId,
        location_id: locationId,
        visible_days_before_month_end: frequency === 'monthly' ? visibleDaysBeforeMonthEnd : null,
        position_filtering_enabled: positionFilteringEnabled,
      })
      .select()
      .single();

    if (checklistError) throw checklistError;

    const { error: itemsError } = await supabase
      .from('checklist_items')
      .insert(buildItemsToInsert(checklist.id));
    if (itemsError) throw itemsError;

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
      })
      .select()
      .single();

    if (checklistError) throw checklistError;

    const { error: itemsError } = await supabase
      .from('checklist_items')
      .insert(buildItemsToInsert(checklist.id));
    if (itemsError) throw itemsError;

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

  return (
    <Layout>
      <div className="max-w-3xl mx-auto space-y-4 p-4">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate('/tasks')}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-xl font-bold">Create Checklist</h1>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Condensed Basic Info */}
          <Card>
            <CardContent className="pt-4 space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="title" className="text-xs">Title</Label>
                  <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g., Morning Kitchen Check" required />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Frequency</Label>
                  <Select value={frequency} onValueChange={(value: any) => setFrequency(value)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="daily">Daily</SelectItem>
                      <SelectItem value="weekly">Weekly</SelectItem>
                      <SelectItem value="monthly">Monthly</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-1">
                <Label htmlFor="description" className="text-xs">Description (Optional)</Label>
                <Textarea id="description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Brief description" rows={2} />
              </div>

              {frequency === 'monthly' && (
                <div className="space-y-1">
                  <Label className="text-xs">Show During Last X Days of Month</Label>
                  <Select value={visibleDaysBeforeMonthEnd?.toString() || '7'} onValueChange={(value) => setVisibleDaysBeforeMonthEnd(parseInt(value))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="3">Last 3 days</SelectItem>
                      <SelectItem value="5">Last 5 days</SelectItem>
                      <SelectItem value="7">Last 7 days</SelectItem>
                      <SelectItem value="10">Last 10 days</SelectItem>
                      <SelectItem value="14">Last 14 days</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs">Lock Until Time</Label>
                    <Switch checked={lockTimeEnabled} onCheckedChange={(checked) => { setLockTimeEnabled(checked); if (!checked) setLockUntilTime(''); }} />
                  </div>
                  {lockTimeEnabled && <Input type="time" value={lockUntilTime} onChange={(e) => setLockUntilTime(e.target.value)} />}
                  <p className="text-[10px] text-muted-foreground">{lockTimeEnabled ? 'Locked until this time each day' : 'Lock checklist until a time'}</p>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Alert Time</Label>
                  <Input type="time" value={dueByTime} onChange={(e) => setDueByTime(e.target.value)} />
                  <p className="text-[10px] text-muted-foreground">Alert if incomplete after this time</p>
                </div>
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Template Type</Label>
                <Select value={templateType} onValueChange={(value: any) => setTemplateType(value)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="standard">Standard</SelectItem>
                    <SelectItem value="dynamic">Dynamic Calendar</SelectItem>
                  </SelectContent>
                </Select>
                {templateType === 'dynamic' && <p className="text-[10px] text-muted-foreground">After creating, assign tasks to days on calendar</p>}
              </div>

              <AssigneePicker
                locationId={currentLocation?.id}
                selectedRoles={selectedRoles}
                onRolesChange={setSelectedRoles}
                selectedUserIds={selectedUserIds}
                onUserIdsChange={setSelectedUserIds}
                label="Visible to"
                helperText="Roles auto-include everyone in that role. Add specific people to grant access without changing their role (e.g. shadowing a line check)."
              />

              {/* Toggle row */}
              <div className="flex flex-wrap gap-4 pt-2 border-t">
                <label className="flex items-center gap-2 text-xs cursor-pointer">
                  <Switch checked={positionFilteringEnabled} onCheckedChange={setPositionFilteringEnabled} />
                  Position Filtering
                </label>
              </div>
              {positionFilteringEnabled && availablePositions.length === 0 && (
                <p className="text-xs text-amber-600 dark:text-amber-400">No positions found. Create positions in Schedule Templates first.</p>
              )}
            </CardContent>
          </Card>

          {/* Checklist Items */}
          <Card>
            <CardHeader className="pb-2 pt-4 px-4">
              <CardTitle className="text-base">Checklist Items</CardTitle>
              <CardDescription className="text-xs">Add questions and tasks</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 px-4">
              {items.map((item, index) => (
                <ChecklistItemCard
                  key={index}
                  item={item}
                  index={index}
                  updateItem={updateItem}
                  removeItem={removeItem}
                  canRemove={items.length > 1}
                  handleReferenceImageUpload={handleReferenceImageUpload}
                  uploadingImage={uploadingImage}
                  positionFilteringEnabled={positionFilteringEnabled}
                  availablePositions={availablePositions}
                  locationId={currentLocation?.id}
                />
              ))}

              <Button type="button" onClick={addItem} variant="outline" className="w-full">
                <Plus className="h-4 w-4 mr-2" />
                Add Item
              </Button>

              {/* Bulk Upload Section - at bottom */}
              <Collapsible>
                <CollapsibleTrigger asChild>
                  <Button type="button" variant="ghost" className="w-full text-xs text-muted-foreground">
                    <FileInput className="h-4 w-4 mr-2" />
                    Bulk Add Items
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent className="pt-2 space-y-3">
                  <p className="text-xs text-muted-foreground">
                    One per line. Prefixes: <code>Photo:</code> <code>Temp:</code> <code>Text:</code> <code>Confirm:</code> <code>MC: question | opt1, opt2</code>
                  </p>
                  <Textarea
                    value={bulkText}
                    onChange={(e) => setBulkText(e.target.value)}
                    placeholder="Photo: Take picture of prep station&#10;Confirm: All surfaces sanitized&#10;Temp: Walk-in cooler"
                    rows={5}
                    className="font-mono text-sm"
                  />
                  <Button type="button" onClick={parseBulkText} variant="secondary" size="sm" className="w-full">
                    <Plus className="h-4 w-4 mr-2" />
                    Parse & Add Items
                  </Button>
                </CollapsibleContent>
              </Collapsible>
            </CardContent>
          </Card>

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Creating...</> : 'Create Checklist'}
          </Button>
        </form>
      </div>
    </Layout>
  );
}

interface ChecklistItemCardProps {
  item: ChecklistItem;
  index: number;
  updateItem: (index: number, field: keyof ChecklistItem, value: any) => void;
  removeItem: (index: number) => void;
  canRemove: boolean;
  handleReferenceImageUpload: (index: number, file: File) => void;
  uploadingImage: string | null;
  positionFilteringEnabled: boolean;
  availablePositions: string[];
  locationId?: string | null;
}

function ChecklistItemCard({ item, index, updateItem, removeItem, canRemove, handleReferenceImageUpload, uploadingImage, positionFilteringEnabled, availablePositions, locationId }: ChecklistItemCardProps) {
  const [showReference, setShowReference] = useState(false);
  const isSection = item.item_type === 'section_header';

  return (
    <Card>
      <CardContent className="pt-4 space-y-3">
        {/* Top row: question + position badge + delete */}
        <div className="flex items-start gap-2">
          <div className="flex-1 space-y-1 min-w-0">
            <ChecklistMentionInput
              value={item.question}
              onChange={(v) => updateItem(index, 'question', v)}
              refs={item.link_refs || []}
              onRefsChange={(next) => updateItem(index, 'link_refs', next)}
              locationId={locationId}
              placeholder={isSection ? 'Section heading' : 'Question / task name — type @ to link a recipe, log, role or teammate'}
              required
            />
          </div>
          {!isSection && positionFilteringEnabled && availablePositions.length > 0 && (
            <Select
              value={item.position || 'none'}
              onValueChange={(value) => updateItem(index, 'position', value === 'none' ? null : value)}
            >
              <SelectTrigger className="w-auto min-w-0 h-8 px-2 text-xs border-dashed shrink-0">
                <SelectValue placeholder="All" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">All Positions</SelectItem>
                {availablePositions.map(pos => (
                  <SelectItem key={pos} value={pos}>{pos}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {canRemove && (
            <Button type="button" variant="ghost" size="icon" onClick={() => removeItem(index)} className="shrink-0 h-8 w-8">
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>

        {/* Type selector */}
        <Select
          value={item.item_type}
          onValueChange={(value) => updateItem(index, 'item_type', value)}
        >
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="confirmation">Check</SelectItem>
            <SelectItem value="text">Text</SelectItem>
            <SelectItem value="image">Photo</SelectItem>
            <SelectItem value="temperature">Temp Photo</SelectItem>
            <SelectItem value="multiple_choice">Multiple Choice</SelectItem>
            <SelectItem value="section_header">— Section Header —</SelectItem>
          </SelectContent>
        </Select>

        {!isSection && item.item_type === 'multiple_choice' && (
          <Input
            value={item.options?.join(', ') || ''}
            onChange={(e) => updateItem(index, 'options', e.target.value.split(',').map((opt) => opt.trim()))}
            placeholder="Options (comma separated)"
          />
        )}

        {!isSection && item.item_type === 'temperature' && (
          <div className="flex items-center space-x-2">
            <Checkbox
              id={`temp-alert-${index}`}
              checked={item.temperature_alert_enabled || false}
              onCheckedChange={(checked) => updateItem(index, 'temperature_alert_enabled', checked)}
            />
            <Label htmlFor={`temp-alert-${index}`} className="text-sm font-normal text-muted-foreground">
              Alert managers on unsafe temps
            </Label>
          </div>
        )}

        {!isSection && (
          <>
            {/* Reference notes - always visible for non-section types */}
            <NotesTextarea
              value={item.reference_notes || ''}
              onChange={(v) => updateItem(index, 'reference_notes', v)}
              placeholder="Instructions / notes (optional)"
              rows={2}
              className="text-sm"
            />

        {/* Collapsible reference materials */}
        <Collapsible open={showReference} onOpenChange={setShowReference}>
          <CollapsibleTrigger asChild>
            <button type="button" className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1">
              {showReference ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              Reference materials
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-2 pt-2">
            <div className="space-y-1">
              <Label className="text-xs flex items-center gap-1"><Upload className="h-3 w-3" /> Photo</Label>
              <Input
                type="file"
                accept="image/*"
                className="text-xs"
                disabled={uploadingImage === `${index}`}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleReferenceImageUpload(index, file);
                }}
              />
              {item.reference_image_url && (
                <img src={item.reference_image_url} alt="Reference" className="rounded max-h-20 object-cover" />
              )}
            </div>
            <div className="space-y-1">
              <Label className="text-xs flex items-center gap-1"><LinkIcon className="h-3 w-3" /> Link</Label>
              <Input
                type="url"
                value={item.reference_link || ''}
                onChange={(e) => updateItem(index, 'reference_link', e.target.value)}
                placeholder="https://..."
                className="text-xs"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs flex items-center gap-1"><Video className="h-3 w-3" /> Video</Label>
              <Input
                type="url"
                value={item.reference_video_url || ''}
                onChange={(e) => updateItem(index, 'reference_video_url', e.target.value)}
                placeholder="https://youtube.com/..."
                className="text-xs"
              />
            </div>
          </CollapsibleContent>
        </Collapsible>
          </>
        )}
      </CardContent>
    </Card>
  );
}
