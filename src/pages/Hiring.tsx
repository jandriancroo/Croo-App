import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Layout } from '@/components/Layout';
import { PageHeaderDivider } from '@/components/ui/page-header-divider';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { Database } from '@/integrations/supabase/types';

type ApplicationStatus = Database['public']['Enums']['application_status'];
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { useLocation as useAppLocation } from '@/hooks/useLocation';
import { useUserRole } from '@/hooks/useUserRole';
import { Loader2, Plus, Search, ThumbsUp, Users, FileText, QrCode, Link as LinkIcon, Copy, ExternalLink, Sparkles, CalendarDays } from 'lucide-react';
import { format } from 'date-fns';
import { ApplicationTemplates } from '@/components/hiring/ApplicationTemplates';
import { ApplicantProfile } from '@/components/hiring/ApplicantProfile';
import { HireApplicantDialog } from '@/components/hiring/HireApplicantDialog';
import { InterviewCalendarDialog } from '@/components/hiring/InterviewCalendarDialog';
import { QRCodeSVG } from 'qrcode.react';

const STATUS_COLORS: Record<ApplicationStatus, string> = {
  pending: 'bg-muted text-muted-foreground',
  interested: 'bg-blue-500/20 text-blue-700 dark:text-blue-300',
  interviewing: 'bg-amber-500/20 text-amber-700 dark:text-amber-300',
  hired: 'bg-green-500/20 text-green-700 dark:text-green-300',
  rejected: 'bg-red-500/20 text-red-700 dark:text-red-300',
};

export default function Hiring() {
  const queryClient = useQueryClient();
  const { currentLocation } = useAppLocation();
  const { isAdmin } = useUserRole();
  const [activeTab, setActiveTab] = useState('applicants');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [selectedApplicant, setSelectedApplicant] = useState<string | null>(null);
  const [showQrDialog, setShowQrDialog] = useState(false);
  const [showHireDialog, setShowHireDialog] = useState(false);
  const [showInterviewCalendar, setShowInterviewCalendar] = useState(false);
  const [applicantToHire, setApplicantToHire] = useState<{ id: string; full_name: string; email: string; phone?: string } | null>(null);

  // Get organization for current location
  const { data: organization, isLoading: orgLoading } = useQuery({
    queryKey: ['location-org', currentLocation?.id],
    queryFn: async () => {
      if (!currentLocation?.id) return null;
      
      const { data: loc } = await supabase
        .from('locations')
        .select('organization_id')
        .eq('id', currentLocation.id)
        .single();
      
      if (!loc?.organization_id) return null;

      const { data: org } = await supabase
        .from('organizations')
        .select('*')
        .eq('id', loc.organization_id)
        .single();
      
      return org;
    },
    enabled: !!currentLocation?.id,
  });

  // Fetch applications
  const { data: applications, isLoading: appsLoading } = useQuery({
    queryKey: ['job-applications', organization?.id, currentLocation?.id, statusFilter],
    queryFn: async () => {
      if (!organization?.id) return [];

      let query = supabase
        .from('job_applications')
        .select(`
          *,
          location:locations(name),
          template:job_application_templates(name),
          work_history:job_application_work_history(*)
        `)
        .eq('organization_id', organization.id)
        .order('submitted_at', { ascending: false });

      // Filter by location if not org admin
      if (currentLocation?.id && !isAdmin) {
        query = query.eq('location_id', currentLocation.id);
      }

      if (statusFilter !== 'all') {
        query = query.eq('status', statusFilter as ApplicationStatus);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
    enabled: !!organization?.id,
  });

  // Auto-analyze applications that need analysis (new or missing availability info)
  useEffect(() => {
    const analyzeUnanalyzed = async () => {
      if (!applications) return;
      
      const needsAnalysis = applications.filter(
        (app: any) => {
          // Not analyzed yet
          if (app.ai_analyzed_at === null && app.work_history?.length > 0) return true;
          // Analyzed but missing availability note (needs re-analysis with new prompt)
          if (app.ai_analyzed_at && app.ai_match_reason && !app.ai_match_reason.includes('Availability:')) return true;
          return false;
        }
      );

      for (const app of needsAnalysis.slice(0, 5)) { // Limit to 5 at a time to avoid rate limits
        try {
          await supabase.functions.invoke('analyze-application', {
            body: { applicationId: app.id }
          });
        } catch (error) {
          console.error('Error analyzing application:', error);
        }
      }

      if (needsAnalysis.length > 0) {
        // Refetch after analysis
        setTimeout(() => {
          queryClient.invalidateQueries({ queryKey: ['job-applications'] });
        }, 2000);
      }
    };

    analyzeUnanalyzed();
  }, [applications, queryClient]);

  // Update application status
  const updateStatusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: ApplicationStatus }) => {
      const { error } = await supabase
        .from('job_applications')
        .update({ status, updated_at: new Date().toISOString() })
        .eq('id', id);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['job-applications'] });
      toast.success('Status updated');
    },
    onError: () => {
      toast.error('Failed to update status');
    },
  });

  const quickInterested = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    updateStatusMutation.mutate({ id, status: 'interested' });
  };

  const filteredApplicants = applications?.filter(app => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      app.full_name.toLowerCase().includes(q) ||
      app.email.toLowerCase().includes(q) ||
      (app.phone && app.phone.includes(q))
    );
  });

  const applicationUrl = organization && currentLocation ? `${window.location.origin}/apply/${organization.slug}?location=${currentLocation.id}` : '';

  const copyLink = () => {
    navigator.clipboard.writeText(applicationUrl);
    toast.success('Link copied to clipboard');
  };

  if (!currentLocation) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-64">
          <p className="text-muted-foreground">Please select a location</p>
        </div>
      </Layout>
    );
  }

  if (orgLoading) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </Layout>
    );
  }

  if (!organization) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-64">
          <Card className="max-w-md">
            <CardContent className="pt-6 text-center">
              <h2 className="text-lg font-semibold mb-2">No Organization</h2>
              <p className="text-muted-foreground">
                This location is not associated with an organization. Please set up an organization first.
              </p>
            </CardContent>
          </Card>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="space-y-4">
        {/* Header */}
        <div>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold">Hiring</h1>
              <p className="text-muted-foreground">
                {(organization as any).brand_name ? (
                  <><span className="font-medium text-foreground">{(organization as any).brand_name}</span> — {organization.name}</>
                ) : (
                  organization.name
                )}
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setShowInterviewCalendar(true)}>
                <CalendarDays className="h-4 w-4 mr-2" />
                <span className="hidden sm:inline">Interviews</span>
              </Button>
              <Button variant="outline" onClick={() => setShowQrDialog(true)}>
                <QrCode className="h-4 w-4 mr-2" />
                <span className="hidden sm:inline">Share Link</span>
              </Button>
            </div>
          </div>
          <PageHeaderDivider />
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="applicants" className="gap-2">
              <Users className="h-4 w-4" />
              Applicants
            </TabsTrigger>
            <TabsTrigger value="templates" className="gap-2">
              <FileText className="h-4 w-4" />
              Templates
            </TabsTrigger>
          </TabsList>

          <TabsContent value="applicants" className="space-y-4 mt-4">
            {/* Filters */}
            <div className="flex flex-col gap-3">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by name, email, or phone..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="pl-9"
                />
              </div>
              
              {/* Mobile: Dropdown */}
              <div className="sm:hidden">
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Filter by status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Statuses</SelectItem>
                    <SelectItem value="pending">Pending</SelectItem>
                    <SelectItem value="interested">Interested</SelectItem>
                    <SelectItem value="interviewing">Interviewing</SelectItem>
                    <SelectItem value="hired">Hired</SelectItem>
                    <SelectItem value="rejected">Rejected</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              
              {/* Desktop/Tablet: Tab-style selectors */}
              <div className="hidden sm:flex flex-wrap gap-2">
                {[
                  { value: 'all', label: 'All' },
                  { value: 'pending', label: 'Pending' },
                  { value: 'interested', label: 'Interested' },
                  { value: 'interviewing', label: 'Interviewing' },
                  { value: 'hired', label: 'Hired' },
                  { value: 'rejected', label: 'Rejected' },
                ].map(status => (
                  <Button
                    key={status.value}
                    variant={statusFilter === status.value ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setStatusFilter(status.value)}
                    className="min-w-[80px]"
                  >
                    {status.label}
                  </Button>
                ))}
              </div>
            </div>

            {/* Applicants List */}
            {appsLoading ? (
              <div className="flex justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
              </div>
            ) : filteredApplicants?.length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center">
                  <Users className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                  <h3 className="text-lg font-medium mb-2">No Applicants Yet</h3>
                  <p className="text-muted-foreground mb-4">
                    Share your application link to start receiving applications
                  </p>
                  <Button onClick={() => setShowQrDialog(true)}>
                    <LinkIcon className="h-4 w-4 mr-2" />
                    Get Application Link
                  </Button>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-2">
                {filteredApplicants?.map((app: any) => {
                  const mostRecentEmployer = app.work_history?.[0]?.employer_name;
                  const isAiMatch = app.ai_match === true;
                  
                  return (
                    <Card 
                      key={app.id} 
                      className={`cursor-pointer hover:bg-muted/50 transition-colors ${isAiMatch ? 'ring-1 ring-primary/30' : ''}`}
                      onClick={() => setSelectedApplicant(app.id)}
                    >
                      <CardContent className="py-4">
                        <div className="flex items-center gap-4">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <h3 className="font-semibold truncate">{app.full_name}</h3>
                              <Badge className={STATUS_COLORS[app.status as ApplicationStatus]}>
                                {app.status}
                              </Badge>
                              {isAiMatch && (
                                <Badge className="bg-gradient-to-r from-primary to-purple-500 text-white border-0 flex items-center gap-1">
                                  <Sparkles className="h-3 w-3" />
                                  Croo AI Match!
                                </Badge>
                              )}
                            </div>
                            {mostRecentEmployer && (
                              <p className="text-sm text-muted-foreground truncate">
                                Previously at {mostRecentEmployer}
                              </p>
                            )}
                            <div className="flex items-center gap-4 mt-1 text-xs text-muted-foreground">
                              {app.location && <span>{app.location.name}</span>}
                              <span>{format(new Date(app.submitted_at), 'MMM d, yyyy')}</span>
                            </div>
                            {app.ai_match_reason && (
                              <p className="text-xs text-muted-foreground mt-1 line-clamp-2 sm:line-clamp-1">
                                {app.ai_match_reason}
                              </p>
                            )}
                          </div>
                          {app.status === 'pending' && (
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={e => quickInterested(app.id, e)}
                              title="Mark as Interested"
                              className="text-blue-500 hover:text-blue-600 hover:bg-blue-500/10"
                            >
                              <ThumbsUp className="h-5 w-5" />
                            </Button>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </TabsContent>

          <TabsContent value="templates" className="mt-4">
            <ApplicationTemplates organizationId={organization.id} />
          </TabsContent>
        </Tabs>

        {/* Applicant Profile Dialog */}
        <ApplicantProfile
          applicationId={selectedApplicant}
          open={!!selectedApplicant}
          onOpenChange={open => !open && setSelectedApplicant(null)}
          onStatusChange={(id, status) => {
            // If status is "hired", open the hire dialog instead
            if (status === 'hired') {
              const app = applications?.find((a: any) => a.id === id);
              if (app) {
                setApplicantToHire({
                  id: app.id,
                  full_name: app.full_name,
                  email: app.email,
                  phone: app.phone,
                });
                setSelectedApplicant(null);
                setShowHireDialog(true);
              }
            } else {
              updateStatusMutation.mutate({ id, status });
            }
          }}
        />

        {/* Hire Applicant Dialog */}
        <HireApplicantDialog
          open={showHireDialog}
          onOpenChange={setShowHireDialog}
          applicant={applicantToHire}
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: ['job-applications'] });
            setApplicantToHire(null);
          }}
        />

        {/* Interview Calendar Dialog */}
        {organization && (
          <InterviewCalendarDialog
            open={showInterviewCalendar}
            onOpenChange={setShowInterviewCalendar}
            organizationId={organization.id}
          />
        )}

        <Dialog open={showQrDialog} onOpenChange={setShowQrDialog}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Share Application Link</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="flex justify-center p-4 bg-white rounded-lg">
                <QRCodeSVG value={applicationUrl} size={200} />
              </div>
              <div className="flex gap-2">
                <Input value={applicationUrl} readOnly className="text-sm" />
                <Button variant="outline" size="icon" onClick={copyLink}>
                  <Copy className="h-4 w-4" />
                </Button>
                <Button variant="outline" size="icon" onClick={() => window.open(applicationUrl, '_blank')}>
                  <ExternalLink className="h-4 w-4" />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground text-center">
                Applicants can scan this QR code or visit the link to apply
              </p>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </Layout>
  );
}
