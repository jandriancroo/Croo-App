import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Layout } from '@/components/Layout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { Database } from '@/integrations/supabase/types';

type ApplicationStatus = Database['public']['Enums']['application_status'];
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { useLocation as useAppLocation } from '@/hooks/useLocation';
import { useUserRole } from '@/hooks/useUserRole';
import { useRolePermissions } from '@/hooks/useRolePermissions';
import { Loader2, Search, ThumbsUp, Users, FileText, QrCode, Link as LinkIcon, Copy, ExternalLink, Sparkles, CalendarDays, Mail, Calendar } from 'lucide-react';
import { format } from 'date-fns';
import { ApplicationTemplates } from '@/components/hiring/ApplicationTemplates';
import { JobListings } from '@/components/hiring/JobListings';
import { RejectionEmailTemplates } from '@/components/hiring/RejectionEmailTemplates';
import { RejectionEmailDialog } from '@/components/hiring/RejectionEmailDialog';
import { BulkRejectionEmailDialog, type BulkRejectApplicant } from '@/components/hiring/BulkRejectionEmailDialog';
import { ApplicantProfile } from '@/components/hiring/ApplicantProfile';
import { HireApplicantDialog } from '@/components/hiring/HireApplicantDialog';
import { InterviewCalendarDialog } from '@/components/hiring/InterviewCalendarDialog';
import { BulkApplicantActionsBar } from '@/components/hiring/BulkApplicantActionsBar';
import { ApplicantFlagDot } from '@/components/hiring/ApplicantFlagSelector';
import { QRCodeSVG } from 'qrcode.react';
import { Checkbox } from '@/components/ui/checkbox';

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
  const { isOrgAdmin, isBrandAdmin, isSuperAdmin } = useUserRole();
  const { hasPermission } = useRolePermissions();
  const navigate = useNavigate();
  const canAccessHiring = isOrgAdmin || isBrandAdmin || isSuperAdmin || hasPermission('manage_hiring');
  const isOrgLevelAccess = isOrgAdmin || isBrandAdmin || isSuperAdmin; // sees all locations
  const [activeTab, setActiveTab] = useState('applicants');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [rejectionTemplateFilter, setRejectionTemplateFilter] = useState<string>('all');
  const [locationFilter, setLocationFilter] = useState<string>('all');
  const [selectedApplicant, setSelectedApplicant] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showQrDialog, setShowQrDialog] = useState(false);
  const [showHireDialog, setShowHireDialog] = useState(false);
  const [showInterviewCalendar, setShowInterviewCalendar] = useState(false);
  const [showRejectionEmail, setShowRejectionEmail] = useState(false);
  const [showBulkRejectionEmail, setShowBulkRejectionEmail] = useState(false);
  const [applicantToReject, setApplicantToReject] = useState<{ id: string; full_name: string; email: string } | null>(null);
  const [bulkApplicantsToReject, setBulkApplicantsToReject] = useState<BulkRejectApplicant[]>([]);
  const [applicantToHire, setApplicantToHire] = useState<{ id: string; full_name: string; email: string; phone?: string } | null>(null);
  const [isBulkUpdating, setIsBulkUpdating] = useState(false);
  const [templatesSubTab, setTemplatesSubTab] = useState<'application' | 'rejection'>('application');

  // Redirect if no access
  useEffect(() => {
    if (!canAccessHiring) {
      navigate('/dashboard', { replace: true });
    }
  }, [canAccessHiring, navigate]);
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

  // Fetch locations for filtering - org-level sees all, others see only their assigned locations
  const { data: orgLocations } = useQuery({
    queryKey: ['org-locations-hiring', organization?.id, isOrgLevelAccess],
    queryFn: async () => {
      if (!organization?.id) return [];
      
      if (isOrgLevelAccess) {
        // Org admin+ sees all locations
        const { data, error } = await supabase
          .from('locations')
          .select('id, name')
          .eq('organization_id', organization.id)
          .eq('location_type', 'standard')
          .order('name');
        if (error) throw error;
        return data;
      } else {
        // Admin/manager/shift_manager sees only their assigned locations
        const { data, error } = await supabase
          .from('locations')
          .select('id, name, user_locations!inner(user_id)')
          .eq('organization_id', organization.id)
          .eq('location_type', 'standard')
          .eq('user_locations.user_id', (await supabase.auth.getUser()).data.user?.id)
          .order('name');
        if (error) throw error;
        return data;
      }
    },
    enabled: !!organization?.id,
  });

  // Fetch rejection templates for filtering
  const { data: rejectionTemplates = [] } = useQuery({
    queryKey: ['rejection-templates-list', organization?.id],
    queryFn: async () => {
      if (!organization?.id) return [];
      const { data, error } = await supabase
        .from('rejection_email_templates')
        .select('id, name')
        .eq('organization_id', organization.id)
        .order('name');
      if (error) throw error;
      return data;
    },
    enabled: !!organization?.id,
  });

  // Fetch applications
  const { data: applications, isLoading: appsLoading } = useQuery({
    queryKey: ['job-applications', organization?.id, statusFilter, locationFilter, rejectionTemplateFilter, isOrgLevelAccess],
    queryFn: async () => {
      if (!organization?.id) return [];

      let query = supabase
        .from('job_applications')
        .select(`
          *,
          location:locations(name),
          template:job_application_templates(name),
          work_history:job_application_work_history(*),
          rejection_template:rejection_email_templates(id, name)
        `)
        .eq('organization_id', organization.id)
        .order('submitted_at', { ascending: false });

      // Location scoping
      if (locationFilter !== 'all') {
        query = query.eq('location_id', locationFilter);
      } else if (!isOrgLevelAccess && orgLocations?.length) {
        // Non-org-level users: scope to their assigned locations only
        const assignedLocationIds = orgLocations.map((l: any) => l.id);
        query = query.in('location_id', assignedLocationIds);
      }

      if (statusFilter !== 'all') {
        query = query.eq('status', statusFilter as ApplicationStatus);
      }

      // Filter by rejection template
      if (rejectionTemplateFilter !== 'all') {
        if (rejectionTemplateFilter === 'no_email') {
          query = query.is('rejection_template_id', null).eq('status', 'rejected');
        } else {
          query = query.eq('rejection_template_id', rejectionTemplateFilter);
        }
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
          // Not analyzed yet - trigger if has work history OR has a resume to parse
          if (app.ai_analyzed_at === null && (app.work_history?.length > 0 || app.resume_url)) return true;
          // Analyzed but missing availability note (needs re-analysis with new prompt)
          if (app.ai_analyzed_at && app.ai_match_reason && !app.ai_match_reason.includes('Availability:')) return true;
          return false;
        }
      );

      for (const app of needsAnalysis.slice(0, 5)) { // Limit to 5 at a time to avoid rate limits
        try {
          await supabase.functions.invoke('ai-extraction-service?action=analyze-application', {
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

  // Bulk action handlers
  const toggleSelection = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
  };

  const handleBulkStatusChange = async (status: string) => {
    if (selectedIds.size === 0) return;

    // Special case: rejecting should offer the rejection email dialog (one template for all selected).
    if (status === 'rejected') {
      const selected = Array.from(selectedIds);
      const applicants = (applications || [])
        .filter((a: any) => selected.includes(a.id))
        .map((a: any) => ({ id: a.id, full_name: a.full_name, email: a.email }))
        .filter((a: any) => !!a.email);

      if (applicants.length === 0) {
        toast.error('No valid applicant emails found in the selection');
        return;
      }

      setBulkApplicantsToReject(applicants);
      setShowBulkRejectionEmail(true);
      return;
    }

    setIsBulkUpdating(true);
    try {
      const { error } = await supabase
        .from('job_applications')
        .update({ status: status as ApplicationStatus, updated_at: new Date().toISOString() })
        .in('id', Array.from(selectedIds));
      
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ['job-applications'] });
      toast.success(`Updated ${selectedIds.size} applications`);
      setSelectedIds(new Set());
    } catch (error) {
      console.error('Bulk status update error:', error);
      toast.error('Failed to update applications');
    } finally {
      setIsBulkUpdating(false);
    }
  };

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    if (!confirm(`Are you sure you want to delete ${selectedIds.size} applications? This cannot be undone.`)) return;
    
    setIsBulkUpdating(true);
    try {
      // Delete related records first
      const ids = Array.from(selectedIds);
      await supabase.from('job_application_work_history').delete().in('application_id', ids);
      await supabase.from('job_application_references').delete().in('application_id', ids);
      
      const { error } = await supabase
        .from('job_applications')
        .delete()
        .in('id', ids);
      
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ['job-applications'] });
      toast.success(`Deleted ${selectedIds.size} applications`);
      setSelectedIds(new Set());
    } catch (error) {
      console.error('Bulk delete error:', error);
      toast.error('Failed to delete applications');
    } finally {
      setIsBulkUpdating(false);
    }
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

  const applicationUrl = organization ? `${window.location.origin}/apply/${organization.slug}` : '';

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
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="applicants" className="gap-2">
              <Users className="h-4 w-4" />
              Applicants
            </TabsTrigger>
            <TabsTrigger value="listings" className="gap-2">
              <Globe className="h-4 w-4" />
              Job Listings
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
              
              {/* Mobile: Dropdowns */}
              <div className="sm:hidden flex flex-wrap gap-2">
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="flex-1 min-w-[120px]">
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
                {orgLocations && orgLocations.length > 1 && (
                  <Select value={locationFilter} onValueChange={setLocationFilter}>
                    <SelectTrigger className="flex-1 min-w-[120px]">
                      <SelectValue placeholder="Filter by location" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Locations</SelectItem>
                      {orgLocations.map(loc => (
                        <SelectItem key={loc.id} value={loc.id}>{loc.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                {/* Rejection template filter - only show when viewing rejected */}
                {statusFilter === 'rejected' && rejectionTemplates.length > 0 && (
                  <Select value={rejectionTemplateFilter} onValueChange={setRejectionTemplateFilter}>
                    <SelectTrigger className="flex-1 min-w-[140px]">
                      <SelectValue placeholder="All Emails" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Emails</SelectItem>
                      <SelectItem value="no_email">No Email Sent</SelectItem>
                      {rejectionTemplates.map(t => (
                        <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
              
              {/* Desktop/Tablet: Tab-style selectors */}
              <div className="hidden sm:flex flex-wrap items-center gap-2">
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
                    onClick={() => {
                      setStatusFilter(status.value);
                      // Clear rejection template filter when switching away from rejected
                      if (status.value !== 'rejected') {
                        setRejectionTemplateFilter('all');
                      }
                    }}
                    className="min-w-[80px]"
                  >
                    {status.label}
                  </Button>
                ))}
                
                {/* Location filter dropdown for desktop - only show if multiple locations */}
                {orgLocations && orgLocations.length > 1 && (
                  <Select value={locationFilter} onValueChange={setLocationFilter}>
                    <SelectTrigger className="w-[160px] ml-2">
                      <SelectValue placeholder="All Locations" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Locations</SelectItem>
                      {orgLocations.map(loc => (
                        <SelectItem key={loc.id} value={loc.id}>{loc.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                
                {/* Rejection template filter - only show when viewing rejected */}
                {statusFilter === 'rejected' && rejectionTemplates.length > 0 && (
                  <Select value={rejectionTemplateFilter} onValueChange={setRejectionTemplateFilter}>
                    <SelectTrigger className="w-[180px] ml-2">
                      <Mail className="h-4 w-4 mr-2 opacity-50" />
                      <SelectValue placeholder="All Emails" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Emails</SelectItem>
                      <SelectItem value="no_email">No Email Sent</SelectItem>
                      {rejectionTemplates.map(t => (
                        <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
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
                  const isSelected = selectedIds.has(app.id);
                  
                  return (
                    <Card 
                      key={app.id} 
                      className={`cursor-pointer hover:bg-muted/50 transition-colors ${isAiMatch ? 'ring-1 ring-primary/30' : ''} ${isSelected ? 'ring-2 ring-primary bg-primary/5' : ''}`}
                      onClick={() => setSelectedApplicant(app.id)}
                    >
                      <CardContent className="py-4">
                        <div className="flex items-center gap-3">
                          <Checkbox
                            checked={isSelected}
                            onClick={e => toggleSelection(app.id, e)}
                            className="shrink-0"
                          />
                        <div className="flex-1 min-w-0">
                            {/* Row 1: Name + Status + AI Match */}
                            <div className="flex items-center gap-2 flex-wrap">
                              <ApplicantFlagDot applicationId={app.id} />
                              <h3 className="font-semibold truncate">{app.full_name}</h3>
                              <Badge className={STATUS_COLORS[app.status as ApplicationStatus]}>
                                {app.status}
                              </Badge>
                              {isAiMatch && (
                                <>
                                  {/* Mobile: icon only */}
                                  <Sparkles className="h-4 w-4 text-primary shrink-0 sm:hidden" />
                                  {/* Tablet+: full badge */}
                                  <Badge className="hidden sm:flex bg-gradient-to-r from-primary to-purple-500 text-white border-0 items-center gap-1">
                                    <Sparkles className="h-3 w-3" />
                                    Croo AI Match!
                                  </Badge>
                                </>
                              )}
                            </div>
                            
                            {/* Row 2: Interview info when interviewing */}
                            {app.status === 'interviewing' && app.interview_date && (
                              <div className="flex items-center gap-2 mt-1 text-xs">
                                <Calendar className="h-3 w-3 text-primary" />
                                <span className="text-primary font-medium">
                                  {format(new Date(app.interview_date + 'T00:00:00'), 'MMM d')}
                                  {app.interview_time && ` @ ${app.interview_time}`}
                                </span>
                                {app.interview_status === 'accepted' && (
                                  <Badge variant="outline" className="text-[10px] px-1 py-0 bg-green-500/10 text-green-600 border-green-500/30">
                                    Confirmed
                                  </Badge>
                                )}
                                {app.interview_status === 'pending' && (
                                  <Badge variant="outline" className="text-[10px] px-1 py-0 bg-amber-500/10 text-amber-600 border-amber-500/30">
                                    Invite Sent
                                  </Badge>
                                )}
                              </div>
                            )}
                            
                            {/* Rejection email info when rejected */}
                            {app.status === 'rejected' && (
                              <div className="flex items-center gap-2 mt-1 text-xs">
                                <Mail className="h-3 w-3 text-muted-foreground" />
                                {app.rejection_template ? (
                                  <span className="text-muted-foreground">
                                    Sent: <span className="font-medium">{app.rejection_template.name}</span>
                                  </span>
                                ) : (
                                  <span className="text-muted-foreground italic">No email sent</span>
                                )}
                              </div>
                            )}
                            
                            {/* Previous employer */}
                            {mostRecentEmployer && (
                              <p className="text-sm text-muted-foreground truncate">
                                Previously at {mostRecentEmployer}
                              </p>
                            )}
                            
                            {/* Location + Date */}
                            <div className="flex items-center gap-4 mt-1 text-xs text-muted-foreground flex-wrap">
                              {app.location && <span>{app.location.name}</span>}
                              <span>{format(new Date(app.submitted_at), 'MMM d, yyyy')}</span>
                            </div>
                            
                            {/* AI match reason */}
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

          <TabsContent value="templates" className="mt-4 space-y-4">
            <div className="flex gap-2 border-b pb-2">
              <Button
                variant={templatesSubTab === 'application' ? 'default' : 'ghost'}
                size="sm"
                onClick={() => setTemplatesSubTab('application')}
              >
                <FileText className="h-4 w-4 mr-2" />
                Application Templates
              </Button>
              <Button
                variant={templatesSubTab === 'rejection' ? 'default' : 'ghost'}
                size="sm"
                onClick={() => setTemplatesSubTab('rejection')}
              >
                <Mail className="h-4 w-4 mr-2" />
                Rejection Emails
              </Button>
            </div>
            {templatesSubTab === 'application' ? (
              <ApplicationTemplates organizationId={organization.id} />
            ) : (
              <RejectionEmailTemplates organizationId={organization.id} />
            )}
          </TabsContent>
        </Tabs>

        {/* Applicant Profile Dialog */}
        <ApplicantProfile
          applicationId={selectedApplicant}
          open={!!selectedApplicant}
          onOpenChange={open => !open && setSelectedApplicant(null)}
          onStatusChange={(id, status) => {
            const app = applications?.find((a: any) => a.id === id);
            if (!app) return;
            
            // If status is "hired", open the hire dialog
            if (status === 'hired') {
              setApplicantToHire({
                id: app.id,
                full_name: app.full_name,
                email: app.email,
                phone: app.phone,
              });
              setSelectedApplicant(null);
              setShowHireDialog(true);
            } 
            // If status is "rejected", open rejection email dialog
            else if (status === 'rejected') {
              setApplicantToReject({
                id: app.id,
                full_name: app.full_name,
                email: app.email,
              });
              setSelectedApplicant(null);
              setShowRejectionEmail(true);
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

        {/* Rejection Email Dialog */}
        {applicantToReject && organization && (
          <RejectionEmailDialog
            open={showRejectionEmail}
            onOpenChange={(open) => {
              setShowRejectionEmail(open);
              if (!open) setApplicantToReject(null);
            }}
            applicationId={applicantToReject.id}
            applicantName={applicantToReject.full_name}
            applicantEmail={applicantToReject.email}
            organizationId={organization.id}
            onComplete={() => {
              // Update status to rejected after email is handled
              updateStatusMutation.mutate({ id: applicantToReject.id, status: 'rejected' });
              setApplicantToReject(null);
            }}
          />
        )}

        {/* Bulk Rejection Email Dialog */}
        {organization && (
          <BulkRejectionEmailDialog
            open={showBulkRejectionEmail}
            onOpenChange={(open) => {
              setShowBulkRejectionEmail(open);
              if (!open) setBulkApplicantsToReject([]);
            }}
            organizationId={organization.id}
            applicants={bulkApplicantsToReject}
            onComplete={async () => {
              // Only mark rejected after email step completes successfully.
              setIsBulkUpdating(true);
              try {
                const { error } = await supabase
                  .from('job_applications')
                  .update({ status: 'rejected' as ApplicationStatus, updated_at: new Date().toISOString() })
                  .in(
                    'id',
                    bulkApplicantsToReject.map((a) => a.id)
                  );
                if (error) throw error;
                queryClient.invalidateQueries({ queryKey: ['job-applications'] });
                setSelectedIds(new Set());
              } finally {
                setIsBulkUpdating(false);
                setBulkApplicantsToReject([]);
              }
            }}
          />
        )}

        {/* Bulk Actions Bar */}
        <BulkApplicantActionsBar
          selectedCount={selectedIds.size}
          onStatusChange={handleBulkStatusChange}
          onDelete={handleBulkDelete}
          onClearSelection={() => setSelectedIds(new Set())}
          isUpdating={isBulkUpdating}
        />
      </div>
    </Layout>
  );
}
