import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { useUserRole } from '@/hooks/useUserRole';
import { Layout } from '@/components/Layout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Plus, Trash2, Upload, Link as LinkIcon, Video, FileText, Loader2 } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { toast } from 'sonner';

interface ChecklistItem {
  question: string;
  item_type: 'text' | 'multiple_choice' | 'image';
  options?: string[];
  is_required: boolean;
  reference_image_url?: string;
  reference_link?: string;
  reference_video_url?: string;
}

export default function CreateChecklist() {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [frequency, setFrequency] = useState<'daily' | 'weekly' | 'monthly'>('daily');
  const [selectedRoles, setSelectedRoles] = useState<string[]>([]);
  const [items, setItems] = useState<ChecklistItem[]>([
    { question: '', item_type: 'text', is_required: true }
  ]);
  const [loading, setLoading] = useState(false);
  const [uploadingImage, setUploadingImage] = useState<string | null>(null);
  const { user } = useAuth();
  const { isAdmin, loading: roleLoading } = useUserRole();
  const navigate = useNavigate();

  useEffect(() => {
    if (!roleLoading && !isAdmin) {
      navigate('/');
      toast.error('Only admins can create checklists');
    }
  }, [isAdmin, roleLoading, navigate]);

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
      const fileExt = file.name.split('.').pop();
      const fileName = `references/${user?.id}/${Date.now()}.${fileExt}`;
      
      const { error: uploadError } = await supabase.storage
        .from('checklist-images')
        .upload(fileName, file);

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      // Create checklist
      const { data: checklist, error: checklistError } = await supabase
        .from('checklists')
        .insert({
          title,
          description,
          frequency,
          created_by: user?.id,
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
        reference_image_url: item.reference_image_url || null,
        reference_link: item.reference_link || null,
        reference_video_url: item.reference_video_url || null,
        reference_notes: null,
      }));

      const { error: itemsError } = await supabase
        .from('checklist_items')
        .insert(itemsToInsert);

      if (itemsError) throw itemsError;

      // Create role tags if any roles are selected
      if (selectedRoles.length > 0) {
        const roleTagsToInsert = selectedRoles.map(role => ({
          checklist_id: checklist.id,
          role: role as 'admin' | 'manager' | 'team_member',
        }));

        const { error: roleTagsError } = await supabase
          .from('checklist_role_tags')
          .insert(roleTagsToInsert);

        if (roleTagsError) throw roleTagsError;
      }

      toast.success('Checklist created successfully!');
      navigate('/');
    } catch (error: any) {
      toast.error(error.message || 'Failed to create checklist');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Layout>
      <div className="max-w-3xl mx-auto space-y-6">
        <div>
          <h2 className="text-3xl font-bold">Create Checklist</h2>
          <p className="text-muted-foreground">Build a new line check checklist</p>
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
                              <SelectItem value="image">Image Upload</SelectItem>
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
