import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Layout } from '@/components/Layout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Save, ArrowLeft } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { useUserRole } from '@/hooks/useUserRole';

interface ChecklistItem {
  id?: string;
  question: string;
  item_type: 'text' | 'multiple_choice' | 'image';
  is_required: boolean;
  options?: string[];
  reference_type?: 'none' | 'link' | 'image' | 'video';
  reference_image_url?: string;
  reference_link?: string;
  reference_video_url?: string;
  order_index: number;
}

export default function EditChecklist() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { isAdmin, loading: roleLoading } = useUserRole();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [frequency, setFrequency] = useState<'daily' | 'weekly' | 'monthly'>('daily');
  const [selectedRoles, setSelectedRoles] = useState<string[]>([]);
  const [items, setItems] = useState<ChecklistItem[]>([]);

  useEffect(() => {
    if (!roleLoading && !isAdmin) {
      navigate('/dashboard');
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

  const fetchChecklist = async () => {
    try {
      setLoading(true);
      
      const { data: checklist, error: checklistError } = await supabase
        .from('checklists')
        .select('*')
        .eq('id', id)
        .single();

      if (checklistError) throw checklistError;

      const { data: checklistItems, error: itemsError } = await supabase
        .from('checklist_items')
        .select('*')
        .eq('checklist_id', id)
        .order('order_index');

      if (itemsError) throw itemsError;

      // Fetch role tags
      const { data: roleTags, error: roleTagsError } = await supabase
        .from('checklist_role_tags')
        .select('role')
        .eq('checklist_id', id);

      if (roleTagsError) throw roleTagsError;

      setTitle(checklist.title);
      setDescription(checklist.description || '');
      setFrequency(checklist.frequency as 'daily' | 'weekly' | 'monthly');
      setSelectedRoles(roleTags?.map(rt => rt.role) || []);
      setItems(checklistItems.map(item => {
        // Determine reference type based on what's populated
        let refType: 'none' | 'link' | 'image' | 'video' = 'none';
        if (item.reference_link) refType = 'link';
        else if (item.reference_image_url) refType = 'image';
        else if (item.reference_video_url) refType = 'video';

        return {
          id: item.id,
          question: item.question,
          item_type: item.item_type as 'text' | 'multiple_choice' | 'image',
          is_required: item.is_required,
          options: item.options as string[] | undefined,
          reference_type: refType,
          reference_image_url: item.reference_image_url || undefined,
          reference_link: item.reference_link || undefined,
          reference_video_url: item.reference_video_url || undefined,
          order_index: item.order_index,
        };
      }));
    } catch (error) {
      console.error('Error fetching checklist:', error);
      toast({
        title: 'Error',
        description: 'Failed to load checklist',
        variant: 'destructive',
      });
      navigate('/dashboard');
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

    try {
      setSaving(true);

      // Update checklist
      const { error: checklistError } = await supabase
        .from('checklists')
        .update({
          title,
          description,
          frequency,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id);

      if (checklistError) throw checklistError;

      // Delete existing items
      const { error: deleteError } = await supabase
        .from('checklist_items')
        .delete()
        .eq('checklist_id', id);

      if (deleteError) throw deleteError;

      // Insert updated items
      const itemsToInsert = items.map((item, index) => ({
        checklist_id: id,
        question: item.question,
        item_type: item.item_type,
        is_required: item.is_required,
        options: item.item_type === 'multiple_choice' ? item.options : null,
        reference_image_url: item.reference_type === 'image' ? item.reference_image_url : null,
        reference_link: item.reference_type === 'link' ? item.reference_link : null,
        reference_video_url: item.reference_type === 'video' ? item.reference_video_url : null,
        reference_notes: null,
        order_index: index,
      }));

      const { error: itemsError } = await supabase
        .from('checklist_items')
        .insert(itemsToInsert);

      if (itemsError) throw itemsError;

      // Delete existing role tags
      const { error: deleteRoleTagsError } = await supabase
        .from('checklist_role_tags')
        .delete()
        .eq('checklist_id', id);

      if (deleteRoleTagsError) throw deleteRoleTagsError;

      // Insert new role tags if any are selected
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

      toast({
        title: 'Success',
        description: 'Checklist updated successfully',
      });

      navigate('/dashboard');
    } catch (error) {
      console.error('Error updating checklist:', error);
      toast({
        title: 'Error',
        description: 'Failed to update checklist',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  const addItem = () => {
    setItems([...items, {
      question: '',
      item_type: 'text',
      is_required: true,
      reference_type: 'none',
      order_index: items.length,
    }]);
  };

  const handleReferenceImageUpload = async (index: number, file: File) => {
    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `references/${Date.now()}.${fileExt}`;
      
      const { error: uploadError } = await supabase.storage
        .from('checklist-images')
        .upload(fileName, file);

      if (uploadError) throw uploadError;

      const { data } = supabase.storage
        .from('checklist-images')
        .getPublicUrl(fileName);

      updateItem(index, 'reference_image_url', data.publicUrl);
      toast({
        title: 'Success',
        description: 'Reference image uploaded',
      });
    } catch (error: any) {
      toast({
        title: 'Error',
        description: 'Failed to upload image',
        variant: 'destructive',
      });
    }
  };

  const removeItem = (index: number) => {
    setItems(items.filter((_, i) => i !== index));
  };

  const updateItem = (index: number, field: keyof ChecklistItem, value: any) => {
    const newItems = [...items];
    newItems[index] = { ...newItems[index], [field]: value };
    setItems(newItems);
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
      <div className="container mx-auto p-6 max-w-4xl space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate('/dashboard')}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-3xl font-bold">Edit Checklist Template</h1>
            <p className="text-muted-foreground">Update your checklist template</p>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Basic Information</CardTitle>
            <CardDescription>Update the checklist details</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="title">Title</Label>
              <Input
                id="title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g., Morning Kitchen Check"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Brief description of this checklist"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="frequency">Frequency</Label>
              <Select value={frequency} onValueChange={(value: 'daily' | 'weekly' | 'monthly') => setFrequency(value)}>
                <SelectTrigger id="frequency">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="daily">Daily</SelectItem>
                  <SelectItem value="weekly">Weekly</SelectItem>
                  <SelectItem value="monthly">Monthly</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Assigned Roles (Optional)</Label>
              <p className="text-sm text-muted-foreground mb-2">
                If no roles are selected, all users can see this checklist
              </p>
              <div className="space-y-2">
                {['admin', 'manager', 'team_member'].map((role) => (
                  <div key={role} className="flex items-center space-x-2">
                    <Checkbox
                      id={`role-${role}`}
                      checked={selectedRoles.includes(role)}
                      onCheckedChange={(checked) => {
                        if (checked) {
                          setSelectedRoles([...selectedRoles, role]);
                        } else {
                          setSelectedRoles(selectedRoles.filter(r => r !== role));
                        }
                      }}
                    />
                    <Label htmlFor={`role-${role}`} className="text-sm font-normal capitalize">
                      {role.replace('_', ' ')}
                    </Label>
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Checklist Items</CardTitle>
            <CardDescription>Update the items in this checklist</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {items.map((item, index) => (
              <div key={index} className="p-4 border rounded-lg space-y-4">
                <div className="flex justify-between items-center">
                  <Label>Item {index + 1}</Label>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => removeItem(index)}
                  >
                    Remove
                  </Button>
                </div>

                <div className="space-y-2">
                  <Label>Question</Label>
                  <Input
                    value={item.question}
                    onChange={(e) => updateItem(index, 'question', e.target.value)}
                    placeholder="Enter your question"
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
                      <SelectItem value="text">Text Response</SelectItem>
                      <SelectItem value="multiple_choice">Multiple Choice</SelectItem>
                      <SelectItem value="image">Image Upload</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {item.item_type === 'multiple_choice' && (
                  <div className="space-y-2">
                    <Label>Options (comma-separated)</Label>
                    <Input
                      value={item.options?.join(', ') || ''}
                      onChange={(e) =>
                        updateItem(
                          index,
                          'options',
                          e.target.value.split(',').map((opt) => opt.trim())
                        )
                      }
                      placeholder="Option 1, Option 2, Option 3"
                    />
                  </div>
                )}

                <div className="space-y-2">
                  <Label>Reference Material (Optional)</Label>
                  <Select
                    value={item.reference_type || 'none'}
                    onValueChange={(value: 'none' | 'link' | 'image' | 'video') => {
                      updateItem(index, 'reference_type', value);
                      // Clear other reference fields when type changes
                      if (value !== 'link') updateItem(index, 'reference_link', undefined);
                      if (value !== 'image') updateItem(index, 'reference_image_url', undefined);
                      if (value !== 'video') updateItem(index, 'reference_video_url', undefined);
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      <SelectItem value="link">Link</SelectItem>
                      <SelectItem value="image">Image Upload</SelectItem>
                      <SelectItem value="video">Video URL</SelectItem>
                    </SelectContent>
                  </Select>

                  {item.reference_type === 'link' && (
                    <Input
                      value={item.reference_link || ''}
                      onChange={(e) => updateItem(index, 'reference_link', e.target.value)}
                      placeholder="https://example.com/resource"
                      type="url"
                    />
                  )}

                  {item.reference_type === 'image' && (
                    <div className="space-y-2">
                      <Input
                        type="file"
                        accept="image/*"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) handleReferenceImageUpload(index, file);
                        }}
                      />
                      {item.reference_image_url && (
                        <img
                          src={item.reference_image_url}
                          alt="Reference"
                          className="mt-2 rounded-lg max-h-32 object-cover"
                        />
                      )}
                    </div>
                  )}

                  {item.reference_type === 'video' && (
                    <Input
                      value={item.reference_video_url || ''}
                      onChange={(e) => updateItem(index, 'reference_video_url', e.target.value)}
                      placeholder="https://youtube.com/watch?v=..."
                      type="url"
                    />
                  )}
                </div>
              </div>
            ))}

            <Button onClick={addItem} variant="outline" className="w-full">
              Add Item
            </Button>
          </CardContent>
        </Card>

        <div className="flex gap-4">
          <Button onClick={() => navigate('/dashboard')} variant="outline" className="flex-1">
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving} className="flex-1">
            {saving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Save className="mr-2 h-4 w-4" />
                Save Changes
              </>
            )}
          </Button>
        </div>
      </div>
    </Layout>
  );
}
