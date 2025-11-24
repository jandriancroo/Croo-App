import { useEffect, useState } from 'react';
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
  const { user } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    fetchChecklistData();
    checkForExistingSubmission();
  }, [id]);

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
      setItems(itemsData || []);
    } catch (error: any) {
      toast.error('Failed to load checklist');
      navigate('/');
    } finally {
      setLoading(false);
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

      setResponses({ ...responses, [itemId]: data.publicUrl });
      toast.success('Image uploaded successfully');
    } catch (error: any) {
      toast.error('Failed to upload image');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);

    try {
      // Create submission
      const { data: submission, error: submissionError } = await supabase
        .from('checklist_submissions')
        .insert({
          checklist_id: id,
          submitted_by: user?.id,
          notes,
        })
        .select()
        .single();

      if (submissionError) throw submissionError;

      // Create responses
      const responsesToInsert = items.map((item) => ({
        submission_id: submission.id,
        item_id: item.id,
        response_text: item.item_type === 'image' || item.item_type === 'confirmation' ? null : responses[item.id] || null,
        response_image_url: item.item_type === 'image' ? responses[item.id] || null : null,
      }));

      const { error: responsesError } = await supabase
        .from('checklist_responses')
        .insert(responsesToInsert);

      if (responsesError) throw responsesError;

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
          <h2 className="text-3xl font-bold">{checklist.title}</h2>
          {checklist.description && (
            <p className="text-muted-foreground">{checklist.description}</p>
          )}
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          {items.map((item) => (
            <Card key={item.id}>
              <CardHeader>
                <CardTitle className="text-lg">
                  {item.question}
                  {item.is_required && <span className="text-destructive ml-1">*</span>}
                </CardTitle>
                
                {/* Reference Material Display */}
                {(item.reference_image_url || item.reference_link || item.reference_video_url) && (
                  <div className="mt-4 space-y-3 bg-muted/50 p-4 rounded-lg">
                    <div className="text-sm font-semibold">Reference Material:</div>
                    
                    {item.reference_image_url && (
                      <div className="space-y-2">
                        <Badge variant="secondary" className="text-xs">Photo</Badge>
                        <img
                          src={item.reference_image_url}
                          alt="Reference"
                          className="rounded-lg max-h-48 object-cover border"
                        />
                      </div>
                    )}
                    
                    {item.reference_link && (
                      <div className="space-y-1">
                        <Badge variant="secondary" className="text-xs">Link</Badge>
                        <a
                          href={item.reference_link}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm text-primary hover:underline block break-all"
                        >
                          {item.reference_link}
                        </a>
                      </div>
                    )}
                    
                    {item.reference_video_url && (
                      <div className="space-y-1">
                        <Badge variant="secondary" className="text-xs">Video</Badge>
                        <a
                          href={item.reference_video_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm text-primary hover:underline block break-all"
                        >
                          {item.reference_video_url}
                        </a>
                      </div>
                    )}
                  </div>
                )}
              </CardHeader>
              <CardContent>
                {item.item_type === 'text' && (
                  <Textarea
                    value={responses[item.id] || ''}
                    onChange={(e) =>
                      setResponses({ ...responses, [item.id]: e.target.value })
                    }
                    placeholder="Enter your response"
                    required={item.is_required}
                  />
                )}
                {item.item_type === 'multiple_choice' && item.options && (
                  <RadioGroup
                    value={responses[item.id] || ''}
                    onValueChange={(value) =>
                      setResponses({ ...responses, [item.id]: value })
                    }
                    required={item.is_required}
                  >
                    {item.options.map((option) => (
                      <div key={option} className="flex items-center space-x-2">
                        <RadioGroupItem value={option} id={`${item.id}-${option}`} />
                        <Label htmlFor={`${item.id}-${option}`}>{option}</Label>
                      </div>
                    ))}
                  </RadioGroup>
                )}
                {item.item_type === 'image' && (
                  <div className="space-y-2">
                    <Label htmlFor={`image-${item.id}`} className="cursor-pointer">
                      <div className="flex items-center justify-center gap-2 p-8 border-2 border-dashed border-border rounded-lg hover:border-primary transition-colors">
                        <Upload className="h-6 w-6" />
                        <span>Click to upload image</span>
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
                        // Clear input to force camera re-open
                        e.target.value = '';
                      }}
                      required={item.is_required && !responses[item.id]}
                    />
                    {responses[item.id] && (
                      <img
                        src={responses[item.id]}
                        alt="Uploaded"
                        className="mt-4 rounded-lg max-h-64 object-cover"
                      />
                    )}
                  </div>
                )}
                {item.item_type === 'confirmation' && (
                  <div className="flex items-center justify-center py-8">
                    <div 
                      className={`flex flex-col items-center gap-4 p-8 rounded-lg border-2 transition-all cursor-pointer ${
                        responses[item.id] 
                          ? 'bg-destructive/10 border-destructive' 
                          : 'border-border hover:border-destructive/50'
                      }`}
                      onClick={() => setResponses({ ...responses, [item.id]: !responses[item.id] })}
                    >
                      <CheckCircle2 
                        className={`h-24 w-24 transition-colors ${
                          responses[item.id] ? 'text-destructive' : 'text-muted-foreground'
                        }`}
                        strokeWidth={2.5}
                      />
                      <div className="flex items-center gap-2">
                        <Checkbox 
                          checked={responses[item.id] || false}
                          onCheckedChange={(checked) => 
                            setResponses({ ...responses, [item.id]: checked })
                          }
                          required={item.is_required}
                        />
                        <Label className="text-lg font-semibold cursor-pointer">
                          {responses[item.id] ? 'Confirmed' : 'Click to confirm'}
                        </Label>
                      </div>
                      {item.reference_notes && (
                        <p className="text-sm text-muted-foreground text-center max-w-md">
                          {item.reference_notes}
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}

          <Card>
            <CardHeader>
              <CardTitle>Additional Notes (Optional)</CardTitle>
              <CardDescription>Add any additional comments or observations</CardDescription>
            </CardHeader>
            <CardContent>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Enter any additional notes"
                rows={4}
              />
            </CardContent>
          </Card>

          <div className="flex gap-4">
            <Button type="button" variant="outline" onClick={() => navigate('/')} className="flex-1">
              Cancel
            </Button>
            <Button type="submit" disabled={submitting} className="flex-1">
              {submitting ? 'Submitting...' : 'Submit Checklist'}
            </Button>
          </div>
        </form>
      </div>
    </Layout>
  );
}
