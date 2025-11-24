import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Layout } from '@/components/Layout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { History as HistoryIcon, Calendar, Eye, Trash2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { useAuth } from '@/lib/auth';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

interface Submission {
  id: string;
  submitted_at: string;
  submitted_by: string;
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

export default function History() {
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletingSubmission, setDeletingSubmission] = useState<Submission | null>(null);
  const navigate = useNavigate();
  const { user } = useAuth();

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
          profiles (full_name, email, profile_photo_url)
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

  const handleDeleteSubmission = async () => {
    if (!deletingSubmission) return;

    try {
      // Delete responses first (cascading)
      const { error: responsesError } = await supabase
        .from('checklist_responses')
        .delete()
        .eq('submission_id', deletingSubmission.id);

      if (responsesError) throw responsesError;

      // Delete submission
      const { error: submissionError } = await supabase
        .from('checklist_submissions')
        .delete()
        .eq('id', deletingSubmission.id);

      if (submissionError) throw submissionError;

      toast.success('Submission deleted successfully');
      setDeleteDialogOpen(false);
      setDeletingSubmission(null);
      fetchSubmissions();
    } catch (error: any) {
      toast.error('Failed to delete submission');
      console.error('Error deleting submission:', error);
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
                          <Avatar className="h-8 w-8">
                            <AvatarImage src={submission.profiles.profile_photo_url || undefined} />
                            <AvatarFallback>
                              {submission.profiles.full_name?.charAt(0) || submission.profiles.email.charAt(0).toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                          <span className="font-medium">
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
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => navigate(`/submission/${submission.id}`)}
                      >
                        <Eye className="h-4 w-4 mr-2" />
                        View Details
                      </Button>
                      {user?.id === submission.submitted_by && (
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => {
                            setDeletingSubmission(submission);
                            setDeleteDialogOpen(true);
                          }}
                        >
                          <Trash2 className="h-4 w-4 mr-2" />
                          Undo
                        </Button>
                      )}
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

        <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Are you sure?</AlertDialogTitle>
              <AlertDialogDescription>
                This will permanently delete this submission and all its responses. This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleDeleteSubmission}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </Layout>
  );
}