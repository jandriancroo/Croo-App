import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Layout } from '@/components/Layout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { History as HistoryIcon, Calendar, Eye, Trash2, ClipboardCheck, ClipboardList } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { useAuth } from '@/lib/auth';
import { useLocation as useAppLocation } from '@/hooks/useLocation';
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

interface CompletedTask {
  id: string;
  title: string;
  description: string | null;
  completed_at: string;
  completed_by: string;
  accent_color: string | null;
  completer_name: string | null;
  completer_email: string | null;
  completer_photo: string | null;
}

type HistoryItem = 
  | { type: 'checklist'; data: Submission; timestamp: string }
  | { type: 'task'; data: CompletedTask; timestamp: string };

export default function History() {
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [completedTasks, setCompletedTasks] = useState<CompletedTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletingSubmission, setDeletingSubmission] = useState<Submission | null>(null);
  const navigate = useNavigate();
  const { user } = useAuth();
  const { currentLocation } = useAppLocation();

  useEffect(() => {
    if (currentLocation?.id) {
      fetchData();
    }
  }, [currentLocation?.id]);

  const fetchData = async () => {
    setLoading(true);
    await Promise.all([fetchSubmissions(), fetchCompletedTasks()]);
    setLoading(false);
  };

  const fetchSubmissions = async () => {
    try {
      const { data, error } = await supabase
        .from('checklist_submissions')
        .select(`
          *,
          checklists (title, frequency),
          profiles (full_name, email, profile_photo_url)
        `)
        .eq('location_id', currentLocation?.id)
        .order('submitted_at', { ascending: false })
        .limit(50);

      if (error) throw error;
      setSubmissions(data || []);
    } catch (error: any) {
      toast.error('Failed to load submission history');
    }
  };

  const fetchCompletedTasks = async () => {
    try {
      const { data, error } = await supabase
        .from('temporary_tasks')
        .select(`
          id,
          title,
          description,
          completed_at,
          completed_by,
          accent_color
        `)
        .eq('location_id', currentLocation?.id)
        .not('completed_at', 'is', null)
        .order('completed_at', { ascending: false })
        .limit(50);

      if (error) throw error;

      // Fetch completer profiles separately
      const completedByIds = [...new Set((data || []).map(t => t.completed_by).filter(Boolean))];
      let profilesMap: Record<string, any> = {};
      
      if (completedByIds.length > 0) {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('id, full_name, email, profile_photo_url')
          .in('id', completedByIds);
        
        profilesMap = (profiles || []).reduce((acc, p) => {
          acc[p.id] = p;
          return acc;
        }, {} as Record<string, any>);
      }

      const tasksWithProfiles: CompletedTask[] = (data || []).map(t => ({
        id: t.id,
        title: t.title,
        description: t.description,
        completed_at: t.completed_at!,
        completed_by: t.completed_by!,
        accent_color: t.accent_color,
        completer_name: profilesMap[t.completed_by!]?.full_name || null,
        completer_email: profilesMap[t.completed_by!]?.email || null,
        completer_photo: profilesMap[t.completed_by!]?.profile_photo_url || null,
      }));

      setCompletedTasks(tasksWithProfiles);
    } catch (error: any) {
      console.error('Failed to load completed tasks:', error);
    }
  };

  const handleDeleteSubmission = async () => {
    if (!deletingSubmission) return;

    try {
      const { error: responsesError } = await supabase
        .from('checklist_responses')
        .delete()
        .eq('submission_id', deletingSubmission.id);

      if (responsesError) throw responsesError;

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
        return 'bg-accent text-accent-foreground';
      case 'weekly':
        return 'bg-primary text-primary-foreground';
      case 'monthly':
        return 'bg-primary/80 text-primary-foreground';
      default:
        return 'bg-muted text-muted-foreground';
    }
  };

  // Combine and sort all history items by timestamp
  const historyItems: HistoryItem[] = [
    ...submissions.map(s => ({ 
      type: 'checklist' as const, 
      data: s, 
      timestamp: s.submitted_at 
    })),
    ...completedTasks.map(t => ({ 
      type: 'task' as const, 
      data: t, 
      timestamp: t.completed_at 
    })),
  ].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  return (
    <Layout>
      <div className="space-y-6">
        <div>
          <h2 className="text-3xl font-bold">Submission History</h2>
          <p className="text-muted-foreground">View all completed checklists and tasks</p>
        </div>

        {loading ? (
          <div className="text-center text-muted-foreground">Loading history...</div>
        ) : historyItems.length === 0 ? (
          <Card className="text-center py-12">
            <CardContent>
              <HistoryIcon className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold mb-2">No submissions yet</h3>
              <p className="text-muted-foreground">Complete a checklist or task to see it here</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {historyItems.map((item) => (
              item.type === 'checklist' ? (
                <Card key={`checklist-${item.data.id}`}>
                  <CardHeader>
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <CardTitle className="flex items-center gap-2">
                          <ClipboardCheck className="h-5 w-5 text-muted-foreground" />
                          {item.data.checklists.title}
                          <Badge className={getFrequencyColor(item.data.checklists.frequency)}>
                            {item.data.checklists.frequency}
                          </Badge>
                        </CardTitle>
                        <CardDescription className="mt-2 space-y-1">
                          <div className="flex items-center gap-2">
                            <Avatar className="h-8 w-8">
                              <AvatarImage src={item.data.profiles.profile_photo_url || undefined} />
                              <AvatarFallback>
                                {item.data.profiles.full_name?.charAt(0) || item.data.profiles.email.charAt(0).toUpperCase()}
                              </AvatarFallback>
                            </Avatar>
                            <span className="font-medium">
                              {item.data.profiles.full_name || item.data.profiles.email}
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <Calendar className="h-4 w-4" />
                            <span>
                              {new Date(item.data.submitted_at).toLocaleString()}
                            </span>
                          </div>
                        </CardDescription>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => navigate(`/submission/${item.data.id}`)}
                        >
                          <Eye className="h-4 w-4 mr-2" />
                          View Details
                        </Button>
                        {user?.id === item.data.submitted_by && (
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={() => {
                              setDeletingSubmission(item.data);
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
                  {item.data.notes && (
                    <CardContent>
                      <div className="rounded-lg bg-muted p-4">
                        <p className="text-sm font-medium mb-1">Notes:</p>
                        <p className="text-sm text-muted-foreground">{item.data.notes}</p>
                      </div>
                    </CardContent>
                  )}
                </Card>
              ) : (
                <Card key={`task-${item.data.id}`}>
                  <CardHeader>
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <CardTitle className="flex items-center gap-2">
                          <div 
                            className="w-3 h-3 rounded-full" 
                            style={{ backgroundColor: item.data.accent_color || "#8B5CF6" }}
                          />
                          <ClipboardList className="h-5 w-5 text-muted-foreground" />
                          {item.data.title}
                          <Badge variant="outline" className="text-xs">
                            Quick Task
                          </Badge>
                        </CardTitle>
                        <CardDescription className="mt-2 space-y-1">
                          {(item.data.completer_name || item.data.completer_email) && (
                            <div className="flex items-center gap-2">
                              <Avatar className="h-8 w-8">
                                <AvatarImage src={item.data.completer_photo || undefined} />
                                <AvatarFallback>
                                  {item.data.completer_name?.charAt(0) || item.data.completer_email?.charAt(0).toUpperCase()}
                                </AvatarFallback>
                              </Avatar>
                              <span className="font-medium">
                                {item.data.completer_name || item.data.completer_email}
                              </span>
                            </div>
                          )}
                          <div className="flex items-center gap-2">
                            <Calendar className="h-4 w-4" />
                            <span>
                              {new Date(item.data.completed_at).toLocaleString()}
                            </span>
                          </div>
                        </CardDescription>
                      </div>
                    </div>
                  </CardHeader>
                  {item.data.description && (
                    <CardContent>
                      <p className="text-sm text-muted-foreground">{item.data.description}</p>
                    </CardContent>
                  )}
                </Card>
              )
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