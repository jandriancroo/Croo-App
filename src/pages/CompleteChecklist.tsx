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
import { Upload } from 'lucide-react';

interface ChecklistItem {
  id: string;
  question: string;
  item_type: string;
  options: any;
  is_required: boolean;
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
  }, [id]);

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
        response_text: item.item_type === 'image' ? null : responses[item.id] || null,
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
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleImageUpload(item.id, file);
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
