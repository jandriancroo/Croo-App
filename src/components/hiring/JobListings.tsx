import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { Plus, Pencil, Trash2, Globe, Loader2, Copy, ExternalLink, Rss } from 'lucide-react';
import { useAuth } from '@/lib/auth';

interface JobListingsProps {
  organizationId: string;
  orgSlug: string;
}

const STATUS_BADGES: Record<string, { label: string; variant: 'default' | 'secondary' | 'outline' | 'destructive' }> = {
  draft: { label: 'Draft', variant: 'secondary' },
  active: { label: 'Active', variant: 'default' },
  paused: { label: 'Paused', variant: 'outline' },
  closed: { label: 'Closed', variant: 'destructive' },
};

const EMPLOYMENT_TYPES = [
  { value: 'full_time', label: 'Full Time' },
  { value: 'part_time', label: 'Part Time' },
  { value: 'contract', label: 'Contract' },
  { value: 'temporary', label: 'Temporary' },
  { value: 'seasonal', label: 'Seasonal' },
  { value: 'intern', label: 'Intern' },
];

export function JobListings({ organizationId, orgSlug }: JobListingsProps) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [showDialog, setShowDialog] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showFeedDialog, setShowFeedDialog] = useState(false);

  // Form state
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [employmentType, setEmploymentType] = useState('full_time');
  const [payMin, setPayMin] = useState('');
  const [payMax, setPayMax] = useState('');
  const [payType, setPayType] = useState('hourly');
  const [locationId, setLocationId] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [syndicationEnabled, setSyndicationEnabled] = useState(true);
  const [status, setStatus] = useState('draft');

  // Fetch listings
  const { data: listings, isLoading } = useQuery({
    queryKey: ['job-listings', organizationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('job_listings')
        .select(`
          *,
          location:locations(id, name, address),
          template:job_application_templates(id, name)
        `)
        .eq('organization_id', organizationId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!organizationId,
  });

  // Fetch locations for dropdown
  const { data: locations } = useQuery({
    queryKey: ['org-locations-listings', organizationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('locations')
        .select('id, name, address')
        .eq('organization_id', organizationId)
        .eq('location_type', 'standard')
        .order('name');
      if (error) throw error;
      return data;
    },
    enabled: !!organizationId,
  });

  // Fetch templates for dropdown
  const { data: templates } = useQuery({
    queryKey: ['org-templates-listings', organizationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('job_application_templates')
        .select('id, name')
        .eq('organization_id', organizationId)
        .eq('is_active', true)
        .order('name');
      if (error) throw error;
      return data;
    },
    enabled: !!organizationId,
  });

  const generateSlug = (t: string) => {
    return t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') + '-' + Date.now().toString(36);
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!title.trim()) throw new Error('Title is required');
      if (!locationId) throw new Error('Location is required');

      const listingData: any = {
        organization_id: organizationId,
        title: title.trim(),
        description: description.trim() || null,
        employment_type: employmentType,
        pay_min: payMin ? parseFloat(payMin) : null,
        pay_max: payMax ? parseFloat(payMax) : null,
        pay_type: payType,
        location_id: locationId || null,
        template_id: templateId || null,
        syndication_enabled: syndicationEnabled,
        status,
        created_by: user?.id,
      };

      if (status === 'active' && !editingId) {
        listingData.posted_at = new Date().toISOString();
      }

      if (editingId) {
        // If changing to active and no posted_at, set it
        if (status === 'active') {
          const existing = listings?.find(l => l.id === editingId);
          if (!existing?.posted_at) {
            listingData.posted_at = new Date().toISOString();
          }
        }
        const { error } = await supabase
          .from('job_listings')
          .update(listingData)
          .eq('id', editingId);
        if (error) throw error;
      } else {
        listingData.slug = generateSlug(title);
        const { error } = await supabase
          .from('job_listings')
          .insert(listingData);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['job-listings'] });
      toast.success(editingId ? 'Listing updated' : 'Listing created');
      closeDialog();
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to save');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('job_listings').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['job-listings'] });
      toast.success('Listing deleted');
    },
    onError: () => toast.error('Failed to delete'),
  });

  const openNew = () => {
    setEditingId(null);
    setTitle('');
    setDescription('');
    setEmploymentType('full_time');
    setPayMin('');
    setPayMax('');
    setPayType('hourly');
    setLocationId('');
    setTemplateId('');
    setSyndicationEnabled(true);
    setStatus('draft');
    setShowDialog(true);
  };

  const openEdit = (listing: any) => {
    setEditingId(listing.id);
    setTitle(listing.title);
    setDescription(listing.description || '');
    setEmploymentType(listing.employment_type);
    setPayMin(listing.pay_min?.toString() || '');
    setPayMax(listing.pay_max?.toString() || '');
    setPayType(listing.pay_type);
    setLocationId(listing.location_id || '');
    setTemplateId(listing.template_id || '');
    setSyndicationEnabled(listing.syndication_enabled);
    setStatus(listing.status);
    setShowDialog(true);
  };

  const closeDialog = () => {
    setShowDialog(false);
    setEditingId(null);
  };

  const feedUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/job-feed?format=xml&organization_id=${organizationId}`;
  const feedJsonUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/job-feed?format=json&organization_id=${organizationId}`;

  const copyFeedUrl = (url: string) => {
    navigator.clipboard.writeText(url);
    toast.success('Feed URL copied');
  };

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-sm text-muted-foreground">
          Create job listings to syndicate across job boards
        </p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setShowFeedDialog(true)}>
            <Rss className="h-4 w-4 mr-2" />
            Feed URLs
          </Button>
          <Button onClick={openNew}>
            <Plus className="h-4 w-4 mr-2" />
            New Listing
          </Button>
        </div>
      </div>

      {listings?.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Globe className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-medium mb-2">No Job Listings Yet</h3>
            <p className="text-muted-foreground mb-4">
              Create job listings to post across Google Jobs, LinkedIn, Monster, and more — for free
            </p>
            <Button onClick={openNew}>
              <Plus className="h-4 w-4 mr-2" />
              Create First Listing
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {listings?.map(listing => {
            const statusBadge = STATUS_BADGES[listing.status] || STATUS_BADGES.draft;
            return (
              <Card key={listing.id}>
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <CardTitle className="text-lg flex items-center gap-2 flex-wrap">
                        <span className="truncate">{listing.title}</span>
                        <Badge variant={statusBadge.variant}>{statusBadge.label}</Badge>
                        {listing.syndication_enabled && listing.status === 'active' && (
                          <Badge variant="outline" className="gap-1 text-xs">
                            <Globe className="h-3 w-3" />
                            Syndicated
                          </Badge>
                        )}
                      </CardTitle>
                      <CardDescription className="mt-1">
                        {(listing as any).location?.name || ''}
                      </CardDescription>
                    </div>
                    <div className="flex gap-1 ml-2">
                      <Button variant="ghost" size="icon" onClick={() => openEdit(listing)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-destructive hover:text-destructive"
                        onClick={() => {
                          if (confirm('Delete this listing?')) deleteMutation.mutate(listing.id);
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap gap-2 text-sm text-muted-foreground">
                    <span>{EMPLOYMENT_TYPES.find(t => t.value === listing.employment_type)?.label}</span>
                    {listing.pay_min && (
                      <span>
                        • ${listing.pay_min}{listing.pay_max ? `–$${listing.pay_max}` : ''}/{listing.pay_type === 'salary' ? 'yr' : 'hr'}
                      </span>
                    )}
                    {(listing as any).template?.name && (
                      <span>• Template: {(listing as any).template.name}</span>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Create/Edit Dialog */}
      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingId ? 'Edit Job Listing' : 'New Job Listing'}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Job Title *</Label>
              <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g., Team Member, Shift Manager" />
            </div>

            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="Job description, responsibilities, requirements..." rows={4} />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Location *</Label>
                <Select value={locationId} onValueChange={setLocationId}>
                  <SelectTrigger><SelectValue placeholder="Select location" /></SelectTrigger>
                  <SelectContent>
                    {locations?.map(loc => (
                      <SelectItem key={loc.id} value={loc.id}>
                        {loc.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Application Template</Label>
                <Select value={templateId} onValueChange={setTemplateId}>
                  <SelectTrigger><SelectValue placeholder="Select template" /></SelectTrigger>
                  <SelectContent>
                    {templates?.map(t => (
                      <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Employment Type</Label>
                <Select value={employmentType} onValueChange={setEmploymentType}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {EMPLOYMENT_TYPES.map(t => (
                      <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Pay Type</Label>
                <Select value={payType} onValueChange={setPayType}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="hourly">Hourly</SelectItem>
                    <SelectItem value="salary">Salary</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Pay Min ($)</Label>
                <Input type="number" value={payMin} onChange={e => setPayMin(e.target.value)} placeholder="15.00" />
              </div>
              <div className="space-y-2">
                <Label>Pay Max ($)</Label>
                <Input type="number" value={payMax} onChange={e => setPayMax(e.target.value)} placeholder="20.00" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Status</Label>
                <Select value={status} onValueChange={setStatus}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="draft">Draft</SelectItem>
                    <SelectItem value="active">Active (Live)</SelectItem>
                    <SelectItem value="paused">Paused</SelectItem>
                    <SelectItem value="closed">Closed</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex items-center gap-3 pt-2 border-t">
              <Switch id="syndication" checked={syndicationEnabled} onCheckedChange={setSyndicationEnabled} />
              <div>
                <Label htmlFor="syndication" className="cursor-pointer">Syndicate to Job Boards</Label>
                <p className="text-xs text-muted-foreground">Include in XML feed for Google Jobs, LinkedIn, Monster, Jooble, Talent.com</p>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={closeDialog}>Cancel</Button>
            <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
              {saveMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {editingId ? 'Save Changes' : 'Create Listing'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Feed URLs Dialog */}
      <Dialog open={showFeedDialog} onOpenChange={setShowFeedDialog}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Job Feed URLs</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Submit these feed URLs to job boards for automatic syndication. Active listings with syndication enabled will appear in these feeds.
            </p>

            <div className="space-y-3">
              <div>
                <Label className="text-xs font-medium">XML Feed (Monster, LinkedIn, Jooble, Talent.com)</Label>
                <div className="flex gap-2 mt-1">
                  <Input value={feedUrl} readOnly className="text-xs font-mono" />
                  <Button variant="outline" size="icon" onClick={() => copyFeedUrl(feedUrl)}>
                    <Copy className="h-4 w-4" />
                  </Button>
                  <Button variant="outline" size="icon" onClick={() => window.open(feedUrl, '_blank')}>
                    <ExternalLink className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              <div>
                <Label className="text-xs font-medium">JSON-LD Feed (Google Jobs)</Label>
                <div className="flex gap-2 mt-1">
                  <Input value={feedJsonUrl} readOnly className="text-xs font-mono" />
                  <Button variant="outline" size="icon" onClick={() => copyFeedUrl(feedJsonUrl)}>
                    <Copy className="h-4 w-4" />
                  </Button>
                  <Button variant="outline" size="icon" onClick={() => window.open(feedJsonUrl, '_blank')}>
                    <ExternalLink className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>

            <div className="bg-muted/50 rounded-lg p-3 text-xs text-muted-foreground space-y-2">
              <p className="font-medium text-foreground">Board Registration (one-time setup):</p>
              <ul className="list-disc pl-4 space-y-1">
                <li><strong>Google Jobs</strong> — Automatic via JSON-LD on your application page</li>
                <li><strong>LinkedIn</strong> — Submit XML feed at <a href="https://www.linkedin.com/help/linkedin/answer/a549498" target="_blank" className="underline">LinkedIn Partner Program</a></li>
                <li><strong>Monster</strong> — Submit via <a href="https://hiring.monster.com/employer-resources/recruiting-strategies/job-posting-tips/" target="_blank" className="underline">Monster Publisher Portal</a></li>
                <li><strong>Jooble</strong> — Email your XML feed URL to <a href="mailto:info@jooble.org" className="underline">info@jooble.org</a></li>
                <li><strong>Talent.com</strong> — Submit at <a href="https://www.talent.com/publisher" target="_blank" className="underline">talent.com/publisher</a></li>
              </ul>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
