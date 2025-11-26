import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { Layout } from '@/components/Layout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { toast } from 'sonner';
import { Upload, CheckCircle2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';

interface ChecklistItem {
  id: string;
  question: string;
  item_type: string;
  options: any;
  is_required: boolean;
  reference_image_url?: string;
  reference_link?: string;
  reference_video_url?: string;
  reference_notes?: string;
}

interface Checklist {
  id: string;
  title: string;
  description: string | null;
}

export default function CompleteChecklist() {
  const { id } = useParams();
  const [checklist, setChecklist] = useState<Checklist | null>(null);
  const [items, setItems] = useState<ChecklistItem[]>([]);
  const [responses, setResponses] = useState<Record<string, any>>({});
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submissionId, setSubmissionId] = useState<string | null>(null);
  const [completionPercentage, setCompletionPercentage] = useState(0);
  const { user } = useAuth();
  const navigate = useNavigate();
  const autoSaveTimeoutRef = useRef<NodeJS.Timeout>();

  useEffect(() => {
    fetchChecklistData();
    checkForExistingSubmission();
  }, [id]);

  // Calculate completion percentage
  useEffect(() => {
    if (items.length === 0) return;
    
    const completedCount = items.filter(item => {
      const response = responses[item.id];
      if (item.item_type === 'confirmation' || item.item_type === 'CHECKMARK') {
        return response === true;
      }
      return response !== undefined && response !== '' && response !== null;
    }).length;
    
    setCompletionPercentage(Math.round((completedCount / items.length) * 100));
  }, [responses, items]);

  // Create or get draft submission
  useEffect(() => {
    if (!id || !user?.id || submissionId) return;
    
    const createDraftSubmission = async () => {
      try {
        const startOfToday = new Date();
        startOfToday.setHours(0, 0, 0, 0);
        
        // Check if there's already a submission for today
        const { data: existingSubmission } = await supabase
          .from('checklist_submissions')
          .select('id, checklist_responses(id, item_id, response_text, response_image_url)')
          .eq('checklist_id', id)
          .eq('submitted_by', user.id)
          .gte('submitted_at', startOfToday.toISOString())
          .single();

        if (existingSubmission) {
          setSubmissionId(existingSubmission.id);
          
          // Load existing responses
          const loadedResponses: Record<string, any> = {};
          existingSubmission.checklist_responses?.forEach((resp: any) => {
            if (resp.response_image_url) {
              loadedResponses[resp.item_id] = resp.response_image_url;
            } else if (resp.response_text !== null) {
              loadedResponses[resp.item_id] = resp.response_text;
            }
          });
          setResponses(loadedResponses);
        } else {
          // Create new draft submission
          const { data: newSubmission, error } = await supabase
            .from('checklist_submissions')
            .insert({
              checklist_id: id,
              submitted_by: user.id,
              notes: '',
            })
            .select()
            .single();

          if (error) throw error;
          setSubmissionId(newSubmission.id);
        }
      } catch (error) {
        console.error('Error creating draft submission:', error);
      }
    };

    createDraftSubmission();
  }, [id, user, submissionId]);

  const checkForExistingSubmission = async () => {
    if (!id || !user?.id) return;

    try {
      const { data: checklistData } = await supabase
        .from('checklists')
        .select('frequency')
        .eq('id', id)
        .single();

      if (!checklistData) return;

      const now = new Date();
      let startDate: Date;

      switch (checklistData.frequency) {
        case 'daily':
          startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
          break;
        case 'weekly':
          const dayOfWeek = now.getDay();
          startDate = new Date(now.getTime() - dayOfWeek * 24 * 60 * 60 * 1000);
          startDate.setHours(0, 0, 0, 0);
          break;
        case 'monthly':
          startDate = new Date(now.getFullYear(), now.getMonth(), 1);
          break;
        default:
          return;
      }

      const { data: existingSubmissions } = await supabase
        .from('checklist_submissions')
        .select('id')
        .eq('checklist_id', id)
        .eq('submitted_by', user.id)
        .gte('submitted_at', startDate.toISOString())
        .limit(1);

      if (existingSubmissions && existingSubmissions.length > 0) {
        toast.error(`You've already submitted this ${checklistData.frequency} checklist. You can only submit once per ${checklistData.frequency === 'daily' ? 'day' : checklistData.frequency === 'weekly' ? 'week' : 'month'}.`);
        navigate('/history');
      }
    } catch (error) {
      console.error('Error checking for existing submission:', error);
    }
  };

  const fetchChecklistData = async () => {
    try {
      const { data: checklistData, error: checklistError } = await supabase
        .from('checklists')
        .select('*')
        .eq('id', id)
        .single();

      if (checklistError) throw checklistError;
      setChecklist(checklistData);

      const { data: itemsData, error: itemsError } = await supabase
        .from('checklist_items')
        .select('*')
        .eq('checklist_id', id)
        .order('order_index');

      if (itemsError) throw itemsError;
      
      // For dynamic checklists, filter items for current day
      if (checklistData.template_type === 'dynamic') {
        const currentDay = new Date().getDay();
        const todayItems = (itemsData || []).filter(item => 
          item.days_of_week && item.days_of_week.includes(currentDay)
        );
        
        if (todayItems.length === 0) {
          toast.error("No tasks assigned for today in this checklist");
          navigate('/tasks');
          return;
        }
        
        setItems(todayItems);
      } else {
        setItems(itemsData || []);
      }
    } catch (error: any) {
      toast.error('Failed to load checklist');
      navigate('/');
    } finally {
      setLoading(false);
    }
  };

  // Debounced auto-save function
  const autoSaveResponse = useCallback(async (itemId: string, value: any, isImage: boolean = false) => {
    if (!submissionId) return;

    try {
      // Check if response already exists
      const { data: existing } = await supabase
        .from('checklist_responses')
        .select('id')
        .eq('submission_id', submissionId)
        .eq('item_id', itemId)
        .single();

      if (existing) {
        // Update existing response
        await supabase
          .from('checklist_responses')
          .update({
            response_text: isImage ? null : (typeof value === 'boolean' ? String(value) : value),
            response_image_url: isImage ? value : null,
          })
          .eq('id', existing.id);
      } else {
        // Insert new response
        await supabase
          .from('checklist_responses')
          .insert({
            submission_id: submissionId,
            item_id: itemId,
            response_text: isImage ? null : (typeof value === 'boolean' ? String(value) : value),
            response_image_url: isImage ? value : null,
          });
      }
    } catch (error) {
      console.error('Error auto-saving response:', error);
    }
  }, [submissionId]);

  const handleResponseChange = (itemId: string, value: any, isImage: boolean = false) => {
    setResponses({ ...responses, [itemId]: value });
    
    // Debounce auto-save for text inputs
    if (autoSaveTimeoutRef.current) {
      clearTimeout(autoSaveTimeoutRef.current);
    }
    
    if (isImage || typeof value === 'boolean') {
      // Save immediately for images and checkboxes
      autoSaveResponse(itemId, value, isImage);
    } else {
      // Debounce text inputs
      autoSaveTimeoutRef.current = setTimeout(() => {
        autoSaveResponse(itemId, value, isImage);
      }, 1000);
    }
  };

  const handleImageUpload = async (itemId: string, file: File) => {
    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `${user?.id}/${Date.now()}.${fileExt}`;
      
      const { error: uploadError } = await supabase.storage
        .from('checklist-images')
        .upload(fileName, file);

      if (uploadError) throw uploadError;

      const { data } = supabase.storage
        .from('checklist-images')
        .getPublicUrl(fileName);

      handleResponseChange(itemId, data.publicUrl, true);
      toast.success('Image uploaded successfully');
    } catch (error: any) {
      toast.error('Failed to upload image');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);

    try {
      // Update notes on existing submission
      if (submissionId) {
        const { error: updateError } = await supabase
          .from('checklist_submissions')
          .update({ notes })
          .eq('id', submissionId);

        if (updateError) throw updateError;
      }

      toast.success('Checklist submitted successfully!');
      navigate('/history');
    } catch (error: any) {
      toast.error(error.message || 'Failed to submit checklist');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <Layout>
        <div className="text-center text-muted-foreground">Loading checklist...</div>
      </Layout>
    );
  }

  if (!checklist) {
    return null;
  }

  return (
    <Layout>
      <div className="max-w-3xl mx-auto space-y-6">
        <div>
          <div className="flex items-center justify-between">
            <h2 className="text-3xl font-bold">{checklist.title}</h2>
            <Badge variant={completionPercentage === 100 ? "default" : "secondary"} className="text-lg px-3 py-1">
              {completionPercentage}%
            </Badge>
          </div>
          {checklist.description && (
            <p className="text-muted-foreground">{checklist.description}</p>
          )}
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          {items.map((item) => (
            <Card key={item.id} className="overflow-hidden">
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-medium">
                  {item.question}
                  {item.is_required && <span className="text-destructive ml-1">*</span>}
                </CardTitle>
                
                {/* Reference Material Display */}
                {(item.reference_image_url || item.reference_link || item.reference_video_url) && (
                  <div className="mt-2 space-y-2 bg-muted/30 p-2 rounded text-xs">
                    <div className="font-medium text-muted-foreground">Reference:</div>
                    
                    {item.reference_image_url && (
                      <div className="space-y-1">
                        <Badge variant="secondary" className="text-[10px] h-4">Photo</Badge>
                        <img
                          src={item.reference_image_url}
                          alt="Reference"
                          className="rounded max-h-32 object-cover border"
                        />
                      </div>
                    )}
                    
                    {item.reference_link && (
                      <div className="space-y-0.5">
                        <Badge variant="secondary" className="text-[10px] h-4">Link</Badge>
                        <a
                          href={item.reference_link}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-primary hover:underline block break-all"
                        >
                          {item.reference_link}
                        </a>
                      </div>
                    )}
                    
                    {item.reference_video_url && (
                      <div className="space-y-0.5">
                        <Badge variant="secondary" className="text-[10px] h-4">Video</Badge>
                        <a
                          href={item.reference_video_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-primary hover:underline block break-all"
                        >
                          {item.reference_video_url}
                        </a>
                      </div>
                    )}
                  </div>
                )}
              </CardHeader>
              <CardContent className="pt-0">
                {item.item_type === 'text' && (
                  <Textarea
                    value={responses[item.id] || ''}
                    onChange={(e) => handleResponseChange(item.id, e.target.value)}
                    placeholder="Enter your response"
                    required={item.is_required}
                    className="min-h-[60px] text-sm"
                  />
                )}
                {item.item_type === 'multiple_choice' && item.options && (
                  <RadioGroup
                    value={responses[item.id] || ''}
                    onValueChange={(value) => handleResponseChange(item.id, value)}
                    required={item.is_required}
                    className="space-y-1.5"
                  >
                    {item.options.map((option) => (
                      <div key={option} className="flex items-center space-x-2">
                        <RadioGroupItem value={option} id={`${item.id}-${option}`} className="h-4 w-4" />
                        <Label htmlFor={`${item.id}-${option}`} className="text-sm font-normal cursor-pointer">{option}</Label>
                      </div>
                    ))}
                  </RadioGroup>
                )}
                {(item.item_type === 'image' || item.item_type === 'PHOTO') && (
                  <div className="space-y-2">
                    <Label htmlFor={`image-${item.id}`} className="cursor-pointer">
                      <div className="flex items-center justify-center gap-2 p-4 border-2 border-dashed border-border rounded hover:border-primary transition-colors">
                        <Upload className="h-4 w-4" />
                        <span className="text-sm">Tap to take photo</span>
                      </div>
                    </Label>
                    <Input
                      id={`image-${item.id}`}
                      type="file"
                      accept="image/*"
                      capture="environment"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleImageUpload(item.id, file);
                        e.target.value = '';
                      }}
                      required={item.is_required && !responses[item.id]}
                    />
                    {responses[item.id] && (
                      <img
                        src={responses[item.id]}
                        alt="Uploaded"
                        className="rounded max-h-48 object-cover border"
                      />
                    )}
                  </div>
                )}
                {(item.item_type === 'confirmation' || item.item_type === 'CHECKMARK') && (
                  <div className="flex items-center space-x-2 py-2">
                    <Checkbox 
                      id={`confirm-${item.id}`}
                      checked={responses[item.id] || false}
                      onCheckedChange={(checked) => handleResponseChange(item.id, checked)}
                      required={item.is_required}
                    />
                    <Label 
                      htmlFor={`confirm-${item.id}`}
                      className="text-sm font-normal cursor-pointer leading-relaxed"
                    >
                      {item.question}
                    </Label>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-medium">Additional Notes (Optional)</CardTitle>
              <CardDescription className="text-xs">Add any additional comments</CardDescription>
            </CardHeader>
            <CardContent className="pt-0">
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Enter any additional notes"
                rows={3}
                className="text-sm"
              />
            </CardContent>
          </Card>

          <div className="flex gap-3 pt-2">
            <Button type="button" variant="outline" onClick={() => navigate('/')} className="flex-1">
              Cancel
            </Button>
            <Button type="submit" disabled={submitting} className="flex-1">
              {submitting ? 'Submitting...' : 'Submit'}
            </Button>
          </div>
        </form>
      </div>
    </Layout>
  );
}
