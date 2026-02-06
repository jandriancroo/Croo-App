import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent } from '@/components/ui/card';
import { CheckCircle, AlertTriangle, Send, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

interface TaskData {
  id: string;
  title: string;
  description: string | null;
  qr_issue_options: string[];
  qr_allow_notes: boolean;
  location_id: string;
  accent_color: string;
  locations?: {
    name: string;
    organization_id: string;
    organizations?: {
      name: string;
      logo_url: string | null;
    };
  };
}

export default function QRQuickTaskReport() {
  const { qrCode } = useParams<{ qrCode: string }>();
  const [task, setTask] = useState<TaskData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedIssues, setSelectedIssues] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    const fetchTask = async () => {
      if (!qrCode) {
        setError('Invalid QR code');
        setLoading(false);
        return;
      }

      try {
        const { data, error: fetchError } = await supabase
          .from('temporary_tasks')
          .select(`
            id,
            title,
            description,
            qr_issue_options,
            qr_allow_notes,
            location_id,
            accent_color,
            locations!inner (
              name,
              organization_id,
              organizations (
                name,
                logo_url
              )
            )
          `)
          .eq('qr_code', qrCode)
          .eq('is_qr_triggered', true)
          .single();

        if (fetchError || !data) {
          setError('This QR code is no longer active');
          setLoading(false);
          return;
        }

        // Parse qr_issue_options from JSON
        const taskData: TaskData = {
          ...data,
          qr_issue_options: Array.isArray(data.qr_issue_options) 
            ? data.qr_issue_options 
            : JSON.parse(data.qr_issue_options as string || '[]'),
          locations: data.locations as TaskData['locations'],
        };

        setTask(taskData);
      } catch (err) {
        console.error('Error fetching task:', err);
        setError('Something went wrong');
      } finally {
        setLoading(false);
      }
    };

    fetchTask();
  }, [qrCode]);

  const toggleIssue = (issue: string) => {
    setSelectedIssues(prev =>
      prev.includes(issue)
        ? prev.filter(i => i !== issue)
        : [...prev, issue]
    );
  };

  const handleSubmit = async () => {
    if (selectedIssues.length === 0) {
      toast.error('Please select at least one issue');
      return;
    }

    setSubmitting(true);
    try {
      // Call edge function to handle submission + notifications
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/utility-service?action=submit-qr-task-report`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          },
          body: JSON.stringify({
            task_id: task!.id,
            location_id: task!.location_id,
            selected_issues: selectedIssues,
            guest_note: note.trim() || null,
          }),
        }
      );

      if (!response.ok) {
        throw new Error('Failed to submit');
      }

      setSubmitted(true);
    } catch (err) {
      console.error('Error submitting report:', err);
      toast.error('Failed to submit. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-background to-muted">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error || !task) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-gradient-to-b from-background to-muted">
        <AlertTriangle className="h-16 w-16 text-destructive mb-4" />
        <h1 className="text-xl font-semibold text-center">{error || 'Task not found'}</h1>
        <p className="text-muted-foreground text-center mt-2">
          This QR code may have expired or been removed.
        </p>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-gradient-to-b from-background to-muted">
        <div 
          className="rounded-full p-4 mb-4"
          style={{ backgroundColor: `${task.accent_color}20` }}
        >
          <CheckCircle 
            className="h-16 w-16" 
            style={{ color: task.accent_color }} 
          />
        </div>
        <h1 className="text-2xl font-bold text-center">Thank You!</h1>
        <p className="text-muted-foreground text-center mt-2 max-w-xs">
          Your report has been submitted. Our team has been notified and will address this promptly.
        </p>
      </div>
    );
  }

  const orgLogo = task.locations?.organizations?.logo_url;
  const orgName = task.locations?.organizations?.name;
  const locationName = task.locations?.name;

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted p-4 pb-safe">
      <div className="max-w-md mx-auto pt-8 space-y-6">
        {/* Header with branding */}
        <div className="text-center space-y-2">
          {orgLogo && (
            <img 
              src={orgLogo} 
              alt={orgName || 'Logo'} 
              className="h-12 mx-auto object-contain"
            />
          )}
          <h1 className="text-2xl font-bold">{task.title}</h1>
          {task.description && (
            <p className="text-muted-foreground">{task.description}</p>
          )}
          {locationName && (
            <p className="text-sm text-muted-foreground">{locationName}</p>
          )}
        </div>

        {/* Issue Selection */}
        <Card>
          <CardContent className="p-4 space-y-3">
            <p className="font-medium text-sm">What's the issue? (Select all that apply)</p>
            <div className="grid gap-2">
              {task.qr_issue_options.map((issue) => (
                <Button
                  key={issue}
                  type="button"
                  variant={selectedIssues.includes(issue) ? "default" : "outline"}
                  className="justify-start h-auto py-3 px-4 text-left"
                  style={selectedIssues.includes(issue) ? {
                    backgroundColor: task.accent_color,
                    borderColor: task.accent_color,
                  } : undefined}
                  onClick={() => toggleIssue(issue)}
                >
                  {issue}
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Optional Note */}
        {task.qr_allow_notes && (
          <Card>
            <CardContent className="p-4 space-y-2">
              <p className="font-medium text-sm">Additional details (optional)</p>
              <Textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Any other details you'd like to share..."
                rows={3}
                maxLength={500}
              />
              <p className="text-xs text-muted-foreground text-right">
                {note.length}/500
              </p>
            </CardContent>
          </Card>
        )}

        {/* Submit Button */}
        <Button
          className="w-full h-12 text-lg gap-2"
          style={{ backgroundColor: task.accent_color }}
          onClick={handleSubmit}
          disabled={submitting || selectedIssues.length === 0}
        >
          {submitting ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : (
            <>
              <Send className="h-5 w-5" />
              Submit Report
            </>
          )}
        </Button>

        <p className="text-xs text-center text-muted-foreground">
          No personal information is collected. Your feedback helps us improve.
        </p>
      </div>
    </div>
  );
}
