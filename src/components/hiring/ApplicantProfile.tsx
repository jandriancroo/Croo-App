import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Mail, Phone, MapPin, FileText, ExternalLink, Briefcase, Users, Trash2, Calendar, Clock } from 'lucide-react';
import { format } from 'date-fns';
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { HiringChatPreview } from './HiringChatPreview';
import { ApplicantFlagSelector } from './ApplicantFlagSelector';
import { ApplicantNotesSection } from './ApplicantNotesSection';

type ApplicationStatus = 'pending' | 'interested' | 'interviewing' | 'hired' | 'rejected';

const STATUS_COLORS: Record<ApplicationStatus, string> = {
  pending: 'bg-muted text-muted-foreground',
  interested: 'bg-blue-500/20 text-blue-700 dark:text-blue-300',
  interviewing: 'bg-amber-500/20 text-amber-700 dark:text-amber-300',
  hired: 'bg-green-500/20 text-green-700 dark:text-green-300',
  rejected: 'bg-red-500/20 text-red-700 dark:text-red-300',
};

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const;

interface ApplicantProfileProps {
  applicationId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onStatusChange: (id: string, status: ApplicationStatus) => void;
}

export function ApplicantProfile({ applicationId, open, onOpenChange, onStatusChange }: ApplicantProfileProps) {
  const queryClient = useQueryClient();
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const { data: application, isLoading } = useQuery({
    queryKey: ['application-detail', applicationId],
    queryFn: async () => {
      if (!applicationId) return null;

      const { data, error } = await supabase
        .from('job_applications')
        .select(`
          *,
          location:locations(name),
          template:job_application_templates(name, questions:job_application_template_questions(*)),
          work_history:job_application_work_history(*),
          references:job_application_references(*)
        `)
        .eq('id', applicationId)
        .single();

      if (error) throw error;
      return data;
    },
    enabled: !!applicationId && open,
  });


  const deleteApplicationMutation = useMutation({
    mutationFn: async () => {
      if (!applicationId) return;
      
      // Delete related records first (work history, references)
      await supabase.from('job_application_work_history').delete().eq('application_id', applicationId);
      await supabase.from('job_application_references').delete().eq('application_id', applicationId);
      
      // Delete the application
      const { error } = await supabase.from('job_applications').delete().eq('id', applicationId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['job-applications'] });
      toast.success('Application deleted');
      setShowDeleteConfirm(false);
      onOpenChange(false);
    },
    onError: () => {
      toast.error('Failed to delete application');
    },
  });

  if (!open) return null;

  const availability = application?.availability as Record<string, { am: boolean; pm: boolean }> | null;
  const customResponses = application?.custom_responses as Record<string, string> | null;

  const getInterviewStatusBadge = () => {
    if (!application?.interview_date || !application?.interview_status) return null;
    
    const statusColors: Record<string, string> = {
      pending: 'bg-amber-500/20 text-amber-700 dark:text-amber-300',
      accepted: 'bg-green-500/20 text-green-700 dark:text-green-300',
      declined: 'bg-red-500/20 text-red-700 dark:text-red-300',
      cancelled: 'bg-muted text-muted-foreground',
    };

    return (
      <Badge className={statusColors[application.interview_status] || 'bg-muted'}>
        {application.interview_status === 'pending' ? 'Invite Sent' : application.interview_status}
      </Badge>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto overflow-x-hidden">
        {isLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : application ? (
          <>
            <DialogHeader className="pr-8">
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                <div className="min-w-0">
                  <DialogTitle className="text-xl sm:text-2xl">{application.full_name}</DialogTitle>
                  <div className="flex items-center gap-2 mt-2 flex-wrap">
                    <ApplicantFlagSelector applicationId={application.id} />
                    {application.template && (
                      <Badge variant="outline" className="text-xs">{application.template.name}</Badge>
                    )}
                  </div>
                </div>
                <Select 
                  value={application.status} 
                  onValueChange={val => onStatusChange(application.id, val as ApplicationStatus)}
                >
                  <SelectTrigger className="w-full sm:w-[140px] shrink-0">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pending">Pending</SelectItem>
                    <SelectItem value="interested">Interested</SelectItem>
                    <SelectItem value="interviewing">Interviewing</SelectItem>
                    <SelectItem value="hired">Hired</SelectItem>
                    <SelectItem value="rejected">Rejected</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </DialogHeader>

            <div className="space-y-6 mt-4">
              {/* Interview Info - shown at the top when scheduled */}
              {application.interview_date && (
                <div className="bg-primary/5 border border-primary/20 rounded-lg p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Calendar className="h-4 w-4 text-primary" />
                      <span className="text-sm font-medium">Interview Scheduled</span>
                    </div>
                    {getInterviewStatusBadge()}
                  </div>
                  <div className="flex items-center gap-4 mt-2 text-sm text-muted-foreground">
                    <span>{format(new Date(application.interview_date + 'T00:00:00'), 'EEEE, MMMM d, yyyy')}</span>
                    {application.interview_time && (
                      <span className="flex items-center gap-1">
                        <Clock className="h-3.5 w-3.5" />
                        {application.interview_time}
                      </span>
                    )}
                  </div>
                </div>
              )}

              {/* Contact Info */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Contact Information</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="flex items-center gap-2 text-sm">
                    <Mail className="h-4 w-4 text-muted-foreground" />
                    <a href={`mailto:${application.email}`} className="text-primary hover:underline">
                      {application.email}
                    </a>
                  </div>
                  {application.phone && (
                    <div className="flex items-center gap-2 text-sm">
                      <Phone className="h-4 w-4 text-muted-foreground" />
                      <a href={`tel:${application.phone}`} className="text-primary hover:underline">
                        {application.phone}
                      </a>
                    </div>
                  )}
                  {application.location && (
                    <div className="flex items-center gap-2 text-sm">
                      <MapPin className="h-4 w-4 text-muted-foreground" />
                      <span>{application.location.name}</span>
                    </div>
                  )}
                  {application.resume_url && (
                    <div className="flex items-center gap-2 text-sm">
                      <FileText className="h-4 w-4 text-muted-foreground" />
                      {(() => {
                        const url = application.resume_url;
                        const extension = url.split('.').pop()?.toLowerCase() || '';
                        const isViewable = ['pdf', 'png', 'jpg', 'jpeg', 'gif', 'webp'].includes(extension);

                        // The resumes bucket is private — mint a short-lived
                        // signed URL on click instead of linking a public URL.
                        const openResume = async () => {
                          const path = url.split('/resumes/')[1];
                          if (!path) {
                            toast.error('Resume link is invalid');
                            return;
                          }
                          const { data, error } = await supabase.storage
                            .from('resumes')
                            .createSignedUrl(decodeURIComponent(path), 300);
                          if (error || !data?.signedUrl) {
                            toast.error('Could not open resume');
                            return;
                          }
                          window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
                        };

                        return (
                          <button
                            type="button"
                            onClick={openResume}
                            className="text-primary hover:underline flex items-center gap-1"
                          >
                            {isViewable ? 'View Resume' : `Download Resume (${extension.toUpperCase()})`}
                            <ExternalLink className="h-3 w-3" />
                          </button>
                        );
                      })()}
                    </div>
                  )}

                  <p className="text-xs text-muted-foreground pt-2">
                    Applied {format(new Date(application.submitted_at), 'MMMM d, yyyy \'at\' h:mm a')}
                  </p>
                </CardContent>
              </Card>

              {/* Availability */}
              {availability && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">Availability</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr>
                            <th className="text-left py-2"></th>
                            {DAYS.map(day => (
                              <th key={day} className="text-center py-2 px-2 capitalize text-xs">
                                {day.slice(0, 3)}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          <tr>
                            <td className="py-2 font-medium">AM</td>
                            {DAYS.map(day => (
                              <td key={`${day}-am`} className="text-center py-2 px-2">
                                <div 
                                  className={`w-6 h-6 rounded mx-auto flex items-center justify-center text-xs ${
                                    availability[day]?.am 
                                      ? 'bg-green-500/20 text-green-700' 
                                      : 'bg-muted text-muted-foreground'
                                  }`}
                                >
                                  {availability[day]?.am ? '✓' : '–'}
                                </div>
                              </td>
                            ))}
                          </tr>
                          <tr>
                            <td className="py-2 font-medium">PM</td>
                            {DAYS.map(day => (
                              <td key={`${day}-pm`} className="text-center py-2 px-2">
                                <div 
                                  className={`w-6 h-6 rounded mx-auto flex items-center justify-center text-xs ${
                                    availability[day]?.pm 
                                      ? 'bg-green-500/20 text-green-700' 
                                      : 'bg-muted text-muted-foreground'
                                  }`}
                                >
                                  {availability[day]?.pm ? '✓' : '–'}
                                </div>
                              </td>
                            ))}
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Work History */}
              {application.work_history && application.work_history.length > 0 && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Briefcase className="h-4 w-4" />
                      Work History
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {application.work_history.map((work: any, i: number) => (
                      <div key={i} className="border-b last:border-0 pb-3 last:pb-0">
                        <p className="font-medium">{work.employer_name}</p>
                        {work.job_title && (
                          <p className="text-sm text-muted-foreground">{work.job_title}</p>
                        )}
                        <p className="text-xs text-muted-foreground">
                          {work.start_date && format(new Date(work.start_date), 'MMM yyyy')}
                          {' – '}
                          {work.is_current ? 'Present' : (work.end_date ? format(new Date(work.end_date), 'MMM yyyy') : 'N/A')}
                        </p>
                        {work.reason_for_leaving && (
                          <p className="text-sm mt-1">
                            <span className="text-muted-foreground">Left because:</span> {work.reason_for_leaving}
                          </p>
                        )}
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}

              {/* References */}
              {application.references && application.references.length > 0 && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Users className="h-4 w-4" />
                      References
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {application.references.map((ref: any, i: number) => (
                      <div key={i} className="border-b last:border-0 pb-3 last:pb-0">
                        <p className="font-medium">{ref.name}</p>
                        {ref.relationship && (
                          <p className="text-sm text-muted-foreground">{ref.relationship}</p>
                        )}
                        <div className="flex gap-4 mt-1 text-sm">
                          {ref.phone && (
                            <a href={`tel:${ref.phone}`} className="text-primary hover:underline">
                              {ref.phone}
                            </a>
                          )}
                          {ref.email && (
                            <a href={`mailto:${ref.email}`} className="text-primary hover:underline">
                              {ref.email}
                            </a>
                          )}
                        </div>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}

              {/* Custom Responses */}
              {customResponses && Object.keys(customResponses).length > 0 && application.template?.questions && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">Additional Questions</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {application.template.questions.map((q: any) => (
                      customResponses[q.id] && (
                        <div key={q.id}>
                          <p className="text-sm font-medium">{q.question}</p>
                          <p className="text-sm text-muted-foreground mt-1">
                            {customResponses[q.id]}
                          </p>
                        </div>
                      )
                    ))}
                  </CardContent>
                </Card>
              )}

              {/* Notes Section */}
              <ApplicantNotesSection applicationId={application.id} />

              {/* Chat Preview */}
              <HiringChatPreview 
                applicationId={application.id} 
                applicantName={application.full_name}
              />

              {/* Delete Application */}
              <div className="pt-4 border-t">
                <Button 
                  variant="destructive" 
                  size="sm"
                  onClick={() => setShowDeleteConfirm(true)}
                  className="w-full sm:w-auto"
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete Application
                </Button>
              </div>
            </div>
          </>
        ) : (
          <div className="text-center py-12 text-muted-foreground">
            Application not found
          </div>
        )}
      </DialogContent>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Application</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to permanently delete this application from {application?.full_name}? 
              This will remove all associated data including work history and references. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteApplicationMutation.mutate()}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteApplicationMutation.isPending}
            >
              {deleteApplicationMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4 mr-2" />
              )}
              Delete Permanently
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}
