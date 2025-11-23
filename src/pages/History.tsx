import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Layout } from '@/components/Layout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { History as HistoryIcon, User, Calendar } from 'lucide-react';
import { toast } from 'sonner';

interface Submission {
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
  };
}

export default function History() {
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchSubmissions();
  }, []);

  const fetchSubmissions = async () => {
    try {
      const { data, error } = await supabase
        .from('checklist_submissions')
        .select(`
          *,
          checklists (title, frequency),
          profiles (full_name, email)
        `)
        .order('submitted_at', { ascending: false })
        .limit(50);

      if (error) throw error;
      setSubmissions(data || []);
    } catch (error: any) {
      toast.error('Failed to load submission history');
    } finally {
      setLoading(false);
    }
  };

  const getFrequencyColor = (frequency: string) => {
    switch (frequency) {
      case 'daily':
        return 'bg-accent';
      case 'weekly':
        return 'bg-primary';
      case 'monthly':
        return 'bg-secondary';
      default:
        return 'bg-muted';
    }
  };

  return (
    <Layout>
      <div className="space-y-6">
        <div>
          <h2 className="text-3xl font-bold">Submission History</h2>
          <p className="text-muted-foreground">View all completed checklists</p>
        </div>

        {loading ? (
          <div className="text-center text-muted-foreground">Loading history...</div>
        ) : submissions.length === 0 ? (
          <Card className="text-center py-12">
            <CardContent>
              <HistoryIcon className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold mb-2">No submissions yet</h3>
              <p className="text-muted-foreground">Complete a checklist to see it here</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {submissions.map((submission) => (
              <Card key={submission.id}>
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <CardTitle className="flex items-center gap-2">
                        {submission.checklists.title}
                        <Badge className={getFrequencyColor(submission.checklists.frequency)}>
                          {submission.checklists.frequency}
                        </Badge>
                      </CardTitle>
                      <CardDescription className="mt-2 space-y-1">
                        <div className="flex items-center gap-2">
                          <User className="h-4 w-4" />
                          <span>
                            {submission.profiles.full_name || submission.profiles.email}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <Calendar className="h-4 w-4" />
                          <span>
                            {new Date(submission.submitted_at).toLocaleString()}
                          </span>
                        </div>
                      </CardDescription>
                    </div>
                  </div>
                </CardHeader>
                {submission.notes && (
                  <CardContent>
                    <div className="rounded-lg bg-muted p-4">
                      <p className="text-sm font-medium mb-1">Notes:</p>
                      <p className="text-sm text-muted-foreground">{submission.notes}</p>
                    </div>
                  </CardContent>
                )}
              </Card>
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
}
