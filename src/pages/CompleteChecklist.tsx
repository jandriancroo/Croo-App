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
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { formatTime12Hour } from '@/lib/utils';

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

interface ResponseWithCompleter {
  responseId: string;
  value: any;
  isImage: boolean;
  completedBy?: {
    userId: string;
    fullName: string;
    profilePhoto: string | null;
    completedAt: string;
  };
}

export default function CompleteChecklist() {
  const { id } = useParams();
  const [checklist, setChecklist] = useState<Checklist | null>(null);
  const [items, setItems] = useState<ChecklistItem[]>([]);
  const [responses, setResponses] = useState<Record<string, any>>({});
  const [responsesWithCompleters, setResponsesWithCompleters] = useState<Record<string, ResponseWithCompleter>>({});
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

  // Create or get shared daily submission (one per checklist per day, not per user)
  useEffect(() => {
    if (!id || !user?.id || submissionId) return;
    
    const createDraftSubmission = async () => {
      try {
        const startOfToday = new Date();
        startOfToday.setHours(0, 0, 0, 0);
        
        // Check if there's already ANY submission for today (shared by all users)
        const { data: existingSubmission } = await supabase
          .from('checklist_submissions')
          .select(`
            id, 
            checklist_responses(
              id, 
              item_id, 
              response_text, 
              response_image_url,
              completed_by,
              created_at,
              profiles:completed_by(full_name, profile_photo_url)
            )
          `)
          .eq('checklist_id', id)
          .gte('submitted_at', startOfToday.toISOString())
          .order('created_at', { ascending: false })
          .limit(1)
          .single();

        if (existingSubmission) {
          setSubmissionId(existingSubmission.id);
          
          // Load existing responses with completer info
          const loadedResponses: Record<string, any> = {};
          const loadedWithCompleters: Record<string, ResponseWithCompleter> = {};
          
          existingSubmission.checklist_responses?.forEach((resp: any) => {
            let value: any;
            let isImage = false;
            
            if (resp.response_image_url) {
              value = resp.response_image_url;
              isImage = true;
            } else if (resp.response_text !== null) {
              // Convert string "true"/"false" to boolean for checkboxes
              if (resp.response_text === 'true' || resp.response_text === 'false') {
                value = resp.response_text === 'true';
              } else {
                value = resp.response_text;
              }
            }
            
            loadedResponses[resp.item_id] = value;
            
            // Store completer info
            if (resp.completed_by && resp.profiles) {
              loadedWithCompleters[resp.item_id] = {
                responseId: resp.id,
                value,
                isImage,
                completedBy: {
                  userId: resp.completed_by,
                  fullName: resp.profiles.full_name || 'Unknown',
                  profilePhoto: resp.profiles.profile_photo_url,
                  completedAt: resp.created_at,
                },
              };
            }
          });
          
          setResponses(loadedResponses);
          setResponsesWithCompleters(loadedWithCompleters);
        } else {
          // Create new shared daily submission
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

  // Removed - no longer blocking users from continuing draft submissions

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
    if (!submissionId || !user?.id) return;

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
        const { error } = await supabase
          .from('checklist_responses')
          .update({
            response_text: isImage ? null : (typeof value === 'boolean' ? String(value) : value),
            response_image_url: isImage ? value : null,
            completed_by: user.id,
          })
          .eq('id', existing.id);
          
        if (error) throw error;
      } else {
        // Insert new response
        const { error } = await supabase
          .from('checklist_responses')
          .insert({
            submission_id: submissionId,
            item_id: itemId,
            response_text: isImage ? null : (typeof value === 'boolean' ? String(value) : value),
            response_image_url: isImage ? value : null,
            completed_by: user.id,
          });
          
        if (error) throw error;
      }
      
      // Fetch updated completer info
      const { data: profile } = await supabase
        .from('profiles')
        .select('full_name, profile_photo_url')
        .eq('id', user.id)
        .single();
        
      if (profile) {
        setResponsesWithCompleters(prev => ({
          ...prev,
          [itemId]: {
            responseId: existing?.id || '',
            value,
            isImage,
            completedBy: {
              userId: user.id,
              fullName: profile.full_name || 'Unknown',
              profilePhoto: profile.profile_photo_url,
              completedAt: new Date().toISOString(),
            },
          },
        }));
      }
    } catch (error) {
      console.error('Error auto-saving response:', error);
    }
  }, [submissionId, user]);

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
  
  const handleUndoCompletion = async (itemId: string) => {
    const responseData = responsesWithCompleters[itemId];
    if (!responseData?.responseId) return;
    
    try {
      const { error } = await supabase
        .from('checklist_responses')
        .delete()
        .eq('id', responseData.responseId);
        
      if (error) throw error;
      
      // Remove from state
      const newResponses = { ...responses };
      delete newResponses[itemId];
      setResponses(newResponses);
      
      const newCompleters = { ...responsesWithCompleters };
      delete newCompleters[itemId];
      setResponsesWithCompleters(newCompleters);
      
      toast.success('Item uncompleted');
    } catch (error) {
      console.error('Error undoing completion:', error);
      toast.error('Failed to undo completion');
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
          {items.map((item) => {
            const isCompleted = responsesWithCompleters[item.id]?.completedBy;
            const completerInfo = responsesWithCompleters[item.id]?.completedBy;
            
            return (
              <Card key={item.id} className="overflow-hidden relative">
                {isCompleted && (
                  <div 
                    className="absolute inset-0 bg-background/50 backdrop-blur-[2px] z-10 flex items-start justify-between p-4 cursor-pointer hover:bg-background/60 transition-colors"
                    onClick={() => handleUndoCompletion(item.id)}
                  >
                    <div className="flex items-center gap-3">
                      <div className="bg-green-600 rounded-full p-3 shadow-lg">
                        <CheckCircle2 className="h-8 w-8 text-white" />
                      </div>
                      <div className="text-sm text-muted-foreground">
                        Click to undo
                      </div>
                    </div>
                    
                    {completerInfo && (
                      <div className="flex items-center gap-2 bg-background/80 backdrop-blur-sm rounded-lg px-3 py-2 shadow-md">
                        <Avatar className="h-8 w-8">
                          <AvatarImage src={completerInfo.profilePhoto || undefined} />
                          <AvatarFallback className="text-xs">
                            {completerInfo.fullName.split(' ').map(n => n[0]).join('')}
                          </AvatarFallback>
                        </Avatar>
                        <div className="text-left">
                          <div className="text-sm font-medium">
                            {completerInfo.fullName.split(' ')[0]} {completerInfo.fullName.split(' ')[1]?.[0]}.
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {formatTime12Hour(new Date(completerInfo.completedAt).toTimeString().slice(0, 5))}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}
                
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
            );
          })}

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
