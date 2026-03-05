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
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Plus, Trash2, Upload, Link as LinkIcon, Video, FileText, Loader2, FileInput, ArrowLeft } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import { compressImage } from '@/utils/imageCompression';

interface ChecklistItem {
  question: string;
  item_type: 'text' | 'multiple_choice' | 'image' | 'confirmation';
  options?: string[];
  is_required: boolean;
  requires_temperature_validation?: boolean;
  temperature_alert_enabled?: boolean;
  reference_image_url?: string;
  reference_link?: string;
  reference_video_url?: string;
  reference_notes?: string;
  position?: string | null;
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
  const [visibleDaysBeforeMonthEnd, setVisibleDaysBeforeMonthEnd] = useState<number | null>(7);
  const [items, setItems] = useState<ChecklistItem[]>([
    { question: '', item_type: 'text', is_required: true }
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
      setVisibleDaysBeforeMonthEnd(
        typeof parsed.visibleDaysBeforeMonthEnd === 'number' ? parsed.visibleDaysBeforeMonthEnd : 7
      );
      setItems(Array.isArray(parsed.items) && parsed.items.length > 0 ? parsed.items : [{ question: '', item_type: 'text', is_required: true }]);
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
          title,
          description,
          frequency,
          dueByTime,
          lockUntilTime: lockTimeEnabled ? lockUntilTime : '',
          templateType,
          selectedRoles,
          visibleDaysBeforeMonthEnd,
          items,
          bulkText,
        })
      );
    } catch {
      // ignore storage errors
    }
  }, [
    didLoadDraft,
    isAdmin,
    roleLoading,
    currentLocation?.id,
    draftKey,
    title,
    description,
    frequency,
    dueByTime,
    lockUntilTime,
    lockTimeEnabled,
    templateType,
    selectedRoles,
    visibleDaysBeforeMonthEnd,
    items,
    bulkText,
  ]);

  const clearDraft = () => {
    try {
      localStorage.removeItem(draftKey);
    } catch {
      // ignore
    }
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
    setItems([...items, { question: '', item_type: 'text', is_required: true }]);
  };

  const removeItem = (index: number) => {
    setItems(items.filter((_, i) => i !== index));
  };

  const updateItem = (index: number, field: keyof ChecklistItem, value: any) => {
    const newItems = [...items];
    newItems[index] = { ...newItems[index], [field]: value };
    setItems(newItems);
  };

  const handleReferenceImageUpload = async (index: number, file: File) => {
    setUploadingImage(`${index}`);
    try {
      // Compress image to reduce memory usage on mobile
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
        item_type: 'text',
        is_required: true
      };

      // Parse type indicators
      if (trimmedLine.toLowerCase().startsWith('photo:')) {
        item.question = trimmedLine.substring(6).trim();
        item.item_type = 'image';
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
        // For dynamic templates, create template then navigate to calendar
        await createDynamicTemplate(user.id, currentLocation.id);
      } else {
        // Standard checklist creation
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

  const createStandardChecklist = async (userId: string, locationId: string) => {
    // Create checklist
    const { data: checklist, error: checklistError } = await supabase
      .from('checklists')
      .insert({
        title,
        description,
        frequency,
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

    // Create checklist items
    const itemsToInsert = items.map((item, index) => ({
      checklist_id: checklist.id,
      question: item.question,
      item_type: item.item_type,
      options: item.item_type === 'multiple_choice' ? item.options : null,
      order_index: index,
      is_required: item.is_required,
      requires_temperature_validation: item.item_type === 'image' ? (item.requires_temperature_validation || false) : false,
      temperature_alert_enabled: item.item_type === 'image' && item.requires_temperature_validation ? (item.temperature_alert_enabled || false) : false,
      reference_image_url: item.reference_image_url || null,
      reference_link: item.reference_link || null,
      reference_video_url: item.reference_video_url || null,
      reference_notes: item.reference_notes || null,
      position: positionFilteringEnabled ? (item.position || null) : null,
    }));

    const { error: itemsError } = await supabase
      .from('checklist_items')
      .insert(itemsToInsert);

    if (itemsError) throw itemsError;

    // Create role tags if any roles are selected
    if (selectedRoles.length > 0) {
      const roleTagsToInsert = selectedRoles.map((role) => ({
        checklist_id: checklist.id,
        role: role as 'super_admin' | 'admin' | 'manager' | 'shift_manager' | 'team_member',
      }));

      const { error: roleTagsError } = await supabase
        .from('checklist_role_tags')
        .insert(roleTagsToInsert);

      if (roleTagsError) throw roleTagsError;
    }

    clearDraft();
  };

  const createDynamicTemplate = async (userId: string, locationId: string) => {
    // Create the template checklist (without generating daily checklists yet)
    const { data: checklist, error: checklistError } = await supabase
      .from('checklists')
      .insert({
        title,
        description,
        frequency,
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

    // Insert items
    const itemsToInsert = items.map((item, index) => ({
      checklist_id: checklist.id,
      question: item.question,
      item_type: item.item_type,
      options: item.item_type === 'multiple_choice' ? item.options : null,
      order_index: index,
      is_required: item.is_required,
      requires_temperature_validation: item.item_type === 'image' ? (item.requires_temperature_validation || false) : false,
      reference_image_url: item.reference_image_url || null,
      reference_link: item.reference_link || null,
      reference_video_url: item.reference_video_url || null,
      reference_notes: item.reference_notes || null,
    }));

    const { error: itemsError } = await supabase
      .from('checklist_items')
      .insert(itemsToInsert);

    if (itemsError) throw itemsError;

    // Insert role tags if any are selected
    if (selectedRoles.length > 0) {
      const roleTagsToInsert = selectedRoles.map((role) => ({
        checklist_id: checklist.id,
        role: role as 'super_admin' | 'admin' | 'manager' | 'shift_manager' | 'team_member',
      }));

      const { error: roleTagsError } = await supabase
        .from('checklist_role_tags')
        .insert(roleTagsToInsert);

      if (roleTagsError) throw roleTagsError;
    }

    clearDraft();

    toast.success('Template created! Now assign tasks to days.');

    // Navigate to the dynamic checklist calendar page
    navigate(`/dynamic-checklist/${checklist.id}`);
  };

  return (
    <Layout>
      <div className="max-w-3xl mx-auto space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate('/tasks')}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h2 className="text-3xl font-bold">Create Checklist</h2>
            <p className="text-muted-foreground">Build a new line check checklist</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Checklist Details</CardTitle>
              <CardDescription>Basic information about your checklist</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="title">Title</Label>
                <Input
                  id="title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g., Morning Kitchen Line Check"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="description">Description (Optional)</Label>
                <Textarea
                  id="description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Brief description of this checklist"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="frequency">Frequency</Label>
                <Select value={frequency} onValueChange={(value: any) => setFrequency(value)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="daily">Daily</SelectItem>
                    <SelectItem value="weekly">Weekly</SelectItem>
                    <SelectItem value="monthly">Monthly</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {frequency === 'monthly' && (
                <div className="space-y-2">
                  <Label htmlFor="visible_days">Show During Last X Days of Month</Label>
                  <Select 
                    value={visibleDaysBeforeMonthEnd?.toString() || '7'} 
                    onValueChange={(value) => setVisibleDaysBeforeMonthEnd(parseInt(value))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="3">Last 3 days</SelectItem>
                      <SelectItem value="5">Last 5 days</SelectItem>
                      <SelectItem value="7">Last 7 days (1 week)</SelectItem>
                      <SelectItem value="10">Last 10 days</SelectItem>
                      <SelectItem value="14">Last 14 days (2 weeks)</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    This checklist will only appear during the selected window at the end of each month
                  </p>
                </div>
              )}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label htmlFor="lock_time_toggle">Lock Until Time</Label>
                  <Switch
                    id="lock_time_toggle"
                    checked={lockTimeEnabled}
                    onCheckedChange={(checked) => {
                      setLockTimeEnabled(checked);
                      if (!checked) setLockUntilTime('');
                    }}
                  />
                </div>
                {lockTimeEnabled && (
                  <Input
                    id="lock_until_time"
                    type="time"
                    value={lockUntilTime}
                    onChange={(e) => setLockUntilTime(e.target.value)}
                    placeholder="Select time"
                  />
                )}
                <p className="text-xs text-muted-foreground">
                  {lockTimeEnabled 
                    ? 'Checklist will be visible but locked until this time each day'
                    : 'Enable to lock this checklist until a specific time each day'}
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="due_by_time">Alert Time</Label>
                <Input
                  id="due_by_time"
                  type="time"
                  value={dueByTime}
                  onChange={(e) => setDueByTime(e.target.value)}
                  placeholder="e.g., 14:00"
                />
                <p className="text-xs text-muted-foreground">
                  Push notification alerts will be sent if this checklist is incomplete after this time
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="template_type">Template Type</Label>
                <Select value={templateType} onValueChange={(value: any) => setTemplateType(value)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="standard">Standard Checklist</SelectItem>
                    <SelectItem value="dynamic">Dynamic Calendar Template</SelectItem>
                  </SelectContent>
                </Select>
                {templateType === 'dynamic' && (
                  <p className="text-xs text-muted-foreground">
                    After creating, you'll assign tasks to specific days on a calendar
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label>Assigned Roles (Optional)</Label>
                <p className="text-sm text-muted-foreground mb-2">
                  If no roles are selected, all users can see this checklist
                </p>
                <div className="space-y-2">
                  {[
                    { value: 'admin', label: 'Admin' },
                    { value: 'manager', label: 'Manager' },
                    { value: 'shift_manager', label: 'Shift Manager' },
                    { value: 'team_member', label: 'Team Member' },
                  ].map((role) => (
                    <div key={role.value} className="flex items-center space-x-2">
                      <Checkbox
                        id={`role-${role.value}`}
                        checked={selectedRoles.includes(role.value)}
                        onCheckedChange={(checked) => {
                          if (checked) {
                            setSelectedRoles([...selectedRoles, role.value]);
                          } else {
                            setSelectedRoles(selectedRoles.filter(r => r !== role.value));
                          }
                        }}
                      />
                      <Label htmlFor={`role-${role.value}`} className="text-sm font-normal">
                        {role.label}
                      </Label>
                    </div>
                  ))}
                </div>
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div>
                    <Label htmlFor="position-filtering">Position Filtering</Label>
                    <p className="text-xs text-muted-foreground">Assign items to shift positions so crew sees only their tasks</p>
                  </div>
                  <Switch
                    id="position-filtering"
                    checked={positionFilteringEnabled}
                    onCheckedChange={setPositionFilteringEnabled}
                  />
                </div>
                {positionFilteringEnabled && availablePositions.length === 0 && (
                  <p className="text-xs text-amber-600 dark:text-amber-400">
                    No positions found. Create positions in Schedule Templates first.
                  </p>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Checklist Items</CardTitle>
                  <CardDescription>Add questions and tasks</CardDescription>
                </div>
                <Button type="button" onClick={addItem} variant="outline" size="sm">
                  <Plus className="h-4 w-4 mr-2" />
                  Add Item
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Bulk Upload Section */}
              <Card className="bg-muted/50">
                <CardContent className="pt-6 space-y-3">
                  <div className="flex items-center gap-2 mb-2">
                    <FileInput className="h-4 w-4 text-primary" />
                    <Label className="text-sm font-semibold">Bulk Add Items</Label>
                  </div>
                  <p className="text-xs text-muted-foreground mb-2">
                    Paste your checklist items (one per line). Use prefixes for specific types:
                    <br />• <code className="text-xs">Photo:</code> for image uploads
                    <br />• <code className="text-xs">Confirm:</code> for confirmation checkmarks
                    <br />• <code className="text-xs">MC: question | option1, option2, option3</code> for multiple choice
                    <br />• Plain text for text input questions
                  </p>
                  <Textarea
                    value={bulkText}
                    onChange={(e) => setBulkText(e.target.value)}
                    placeholder="Photo: Take picture of prep station&#10;Confirm: All surfaces sanitized&#10;MC: Temperature check | Pass, Fail, Needs Adjustment&#10;Any cleaning issues?"
                    rows={6}
                    className="font-mono text-sm"
                  />
                  <Button 
                    type="button" 
                    onClick={parseBulkText}
                    variant="secondary"
                    size="sm"
                    className="w-full"
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    Parse & Add Items
                  </Button>
                </CardContent>
              </Card>
              {items.map((item, index) => (
                <Card key={index}>
                  <CardContent className="pt-6 space-y-4">
                    <div className="flex justify-between items-start gap-4">
                      <div className="flex-1 space-y-4">
                        <div className="space-y-2">
                          <Label>Question</Label>
                          <Input
                            value={item.question}
                            onChange={(e) => updateItem(index, 'question', e.target.value)}
                            placeholder="Enter your question"
                            required
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>Type</Label>
                          <Select
                            value={item.item_type}
                            onValueChange={(value) => updateItem(index, 'item_type', value)}
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="text">Text Input</SelectItem>
                              <SelectItem value="multiple_choice">Multiple Choice</SelectItem>
                              <SelectItem value="image">Photo</SelectItem>
                              <SelectItem value="confirmation">Confirmation Checkmark</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        {item.item_type === 'multiple_choice' && (
                          <div className="space-y-2">
                            <Label>Options (comma separated)</Label>
                            <Input
                              value={item.options?.join(', ') || ''}
                              onChange={(e) =>
                                updateItem(
                                  index,
                                  'options',
                                  e.target.value.split(',').map((opt) => opt.trim())
                                )
                              }
                              placeholder="e.g., Yes, No, N/A"
                              required
                            />
                          </div>
                        )}

                        {item.item_type === 'image' && (
                          <div className="space-y-2">
                            <div className="flex items-center space-x-2">
                              <Checkbox
                                id={`temp-validation-${index}`}
                                checked={item.requires_temperature_validation || false}
                                onCheckedChange={(checked) => updateItem(index, 'requires_temperature_validation', checked)}
                              />
                              <Label htmlFor={`temp-validation-${index}`} className="text-sm font-normal">
                                Requires Temperature Validation
                              </Label>
                            </div>
                            {item.requires_temperature_validation && (
                              <div className="flex items-center space-x-2 ml-6">
                                <Checkbox
                                  id={`temp-alert-${index}`}
                                  checked={item.temperature_alert_enabled || false}
                                  onCheckedChange={(checked) => updateItem(index, 'temperature_alert_enabled', checked)}
                                />
                                <Label htmlFor={`temp-alert-${index}`} className="text-sm font-normal text-muted-foreground">
                                  Send push notification to managers when out of range
                                </Label>
                              </div>
                            )}
                          </div>
                        )}

                        {item.item_type === 'confirmation' && (
                          <div className="space-y-2">
                            <Label htmlFor={`ref-notes-${index}`} className="text-sm flex items-center gap-2">
                              <FileText className="h-4 w-4" />
                              Instructions/Notes (Optional)
                            </Label>
                            <Textarea
                              id={`ref-notes-${index}`}
                              value={item.reference_notes || ''}
                              onChange={(e) => updateItem(index, 'reference_notes', e.target.value)}
                              placeholder="Add instructions or notes that will appear with the confirmation checkmark"
                              rows={3}
                            />
                          </div>
                        )}

                        {/* Reference Materials Section */}
                        <div className="border-t pt-4 space-y-4">
                          <Label className="text-sm font-semibold">Reference Materials (Optional)</Label>
                          
                          {/* Reference Image */}
                          <div className="space-y-2">
                            <Label htmlFor={`ref-image-${index}`} className="text-sm flex items-center gap-2">
                              <Upload className="h-4 w-4" />
                              Reference Photo
                            </Label>
                            <div className="flex gap-2">
                              <Input
                                id={`ref-image-${index}`}
                                type="file"
                                accept="image/*"
                                onChange={(e) => {
                                  const file = e.target.files?.[0];
                                  if (file) handleReferenceImageUpload(index, file);
                                }}
                                disabled={uploadingImage === `${index}`}
                              />
                            </div>
                            {item.reference_image_url && (
                              <img
                                src={item.reference_image_url}
                                alt="Reference"
                                className="mt-2 rounded-lg max-h-32 object-cover"
                              />
                            )}
                          </div>

                          {/* Reference Link */}
                          <div className="space-y-2">
                            <Label htmlFor={`ref-link-${index}`} className="text-sm flex items-center gap-2">
                              <LinkIcon className="h-4 w-4" />
                              Reference Link
                            </Label>
                            <Input
                              id={`ref-link-${index}`}
                              type="url"
                              value={item.reference_link || ''}
                              onChange={(e) => updateItem(index, 'reference_link', e.target.value)}
                              placeholder="https://example.com/resource"
                            />
                          </div>

                          {/* Reference Video */}
                          <div className="space-y-2">
                            <Label htmlFor={`ref-video-${index}`} className="text-sm flex items-center gap-2">
                              <Video className="h-4 w-4" />
                              Training Video URL
                            </Label>
                            <Input
                              id={`ref-video-${index}`}
                              type="url"
                              value={item.reference_video_url || ''}
                              onChange={(e) => updateItem(index, 'reference_video_url', e.target.value)}
                              placeholder="https://youtube.com/watch?v=..."
                            />
                          </div>
                        </div>
                      </div>
                      {items.length > 1 && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => removeItem(index)}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </CardContent>
          </Card>

          <div className="flex gap-4">
            <Button type="button" variant="outline" onClick={() => navigate('/')} className="flex-1">
              Cancel
            </Button>
            <Button type="submit" disabled={loading} className="flex-1">
              {loading ? 'Creating...' : 'Create Checklist'}
            </Button>
          </div>
        </form>
      </div>
    </Layout>
  );
}
