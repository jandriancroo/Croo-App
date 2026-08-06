import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Layout } from '@/components/Layout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Calendar } from 'lucide-react';
import { toast } from 'sonner';

interface SubmissionDetail {
  id: string;
  submitted_at: string;
  notes: string | null;
  checklists: {
    title: string;
    frequency: string;
  };
  profiles: {
    full_name: string | null;
    email: string;
    profile_photo_url: string | null;
  };
}

interface Response {
  id: string;
  response_text: string | null;
  response_image_url: string | null;
  checklist_items: {
    question: string;
    item_type: string;
  };
}

export default function SubmissionDetails() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [submission, setSubmission] = useState<SubmissionDetail | null>(null);
  const [responses, setResponses] = useState<Response[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchSubmissionDetails();
  }, [id]);

  const fetchSubmissionDetails = async () => {
    try {
      const { data: submissionData, error: submissionError } = await supabase
        .from('checklist_submissions')
        .select(`
          *,
          checklists (title, frequency),
          profiles!checklist_submissions_submitted_by_fkey (full_name, email, profile_photo_url)
        `)
        .eq('id', id)
        .single();

      if (submissionError) throw submissionError;
      setSubmission(submissionData);

      const { data: responsesData, error: responsesError } = await supabase
        .from('checklist_responses')
        .select(`
          *,
          checklist_items (question, item_type)
        `)
        .eq('submission_id', id)
        .order('created_at');

      if (responsesError) throw responsesError;
      setResponses(responsesData || []);
    } catch (error: any) {
      toast.error('Failed to load submission details');
      navigate('/history');
    } finally {
      setLoading(false);
    }
  };

  const getFrequencyColor = (_frequency: string) => {
    // Unified muted color for all frequency badges
    return 'bg-muted text-muted-foreground';
  };

  const formatUserName = (fullName: string | null, email: string) => {
    if (!fullName) return email;
    const parts = fullName.split(' ');
    if (parts.length < 2) return fullName;
    return `${parts[0]} ${parts[parts.length - 1].charAt(0)}.`;
  };

  if (loading) {
    return (
      <Layout>
        <div className="text-center text-muted-foreground">Loading submission...</div>
      </Layout>
    );
  }

  if (!submission) return null;

  return (
    <Layout>
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate('/history')}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h2 className="text-3xl font-bold">{submission.checklists.title}</h2>
            <p className="text-muted-foreground">Submission Details</p>
          </div>
        </div>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Avatar className="h-12 w-12">
                  <AvatarImage src={submission.profiles.profile_photo_url || undefined} />
                  <AvatarFallback>
                    {submission.profiles.full_name?.charAt(0) || submission.profiles.email.charAt(0).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div>
                  <p className="font-semibold">
                    {formatUserName(submission.profiles.full_name, submission.profiles.email)}
                  </p>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Calendar className="h-3 w-3" />
                    {new Date(submission.submitted_at).toLocaleString()}
                  </div>
                </div>
              </div>
              <Badge className={getFrequencyColor(submission.checklists.frequency)}>
                {submission.checklists.frequency}
              </Badge>
            </div>
          </CardHeader>
          {submission.notes && (
            <CardContent>
              <div className="rounded-lg bg-muted p-4">
                <p className="text-sm font-medium mb-1">Additional Notes:</p>
                <p className="text-sm text-muted-foreground">{submission.notes}</p>
              </div>
            </CardContent>
          )}
        </Card>

        <div className="space-y-4">
          <h3 className="text-xl font-semibold">Responses</h3>
          {responses.map((response, index) => (
            <Card key={response.id}>
              <CardHeader>
                <CardTitle className="text-base flex items-center justify-between gap-3">
                  <span className="flex-1">Q{index + 1}: {response.checklist_items.question}</span>
                  <div className="flex items-center gap-2 shrink-0">
                    <Avatar className="h-8 w-8 border-2 border-primary/20 shadow-sm ring-2 ring-background">
                      <AvatarImage src={submission.profiles.profile_photo_url || undefined} />
                      <AvatarFallback className="text-xs bg-primary/10 text-primary font-semibold">
                        {submission.profiles.full_name?.charAt(0) || submission.profiles.email.charAt(0).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <span className="text-xs font-normal text-muted-foreground">
                      {formatUserName(submission.profiles.full_name, submission.profiles.email)}
                    </span>
                  </div>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {response.response_text && (
                  <p className="text-sm">{response.response_text}</p>
                )}
                {response.response_image_url && (
                  <img
                    src={response.response_image_url}
                    alt="Response"
                    className="rounded-lg max-h-64 object-cover border"
                  />
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </Layout>
  );
}