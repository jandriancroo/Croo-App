import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Loader2, MessageCircle, Building2, MapPin, Clock } from 'lucide-react';
import { AddToHomeScreenButton } from '@/components/AddToHomeScreenButton';
import { format } from 'date-fns';
import crooLogo from '@/assets/croo-logo.webp';

interface Application {
  id: string;
  full_name: string;
  status: string;
  submitted_at: string;
  organization: {
    name: string;
    brand_name?: string | null;
    logo_url: string | null;
  };
  location: {
    name: string;
  } | null;
  conversation: {
    access_token: string;
  } | null;
}

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-yellow-500/20 text-yellow-600 border-yellow-500/30',
  reviewing: 'bg-blue-500/20 text-blue-600 border-blue-500/30',
  interviewed: 'bg-purple-500/20 text-purple-600 border-purple-500/30',
  hired: 'bg-green-500/20 text-green-600 border-green-500/30',
  rejected: 'bg-red-500/20 text-red-600 border-red-500/30',
};

const STATUS_LABELS: Record<string, string> = {
  pending: 'Under Review',
  reviewing: 'Being Reviewed',
  interviewed: 'Interviewed',
  hired: 'Hired!',
  rejected: 'Not Selected',
};

export default function ApplicantPortal() {
  const [email, setEmail] = useState('');
  const [submittedEmail, setSubmittedEmail] = useState<string | null>(null);
  const [applications, setApplications] = useState<Application[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Check for saved email on mount
  useEffect(() => {
    const savedEmail = localStorage.getItem('applicant_email');
    if (savedEmail) {
      setEmail(savedEmail);
      setSubmittedEmail(savedEmail);
      fetchApplications(savedEmail);
    }
  }, []);

  const fetchApplications = async (emailToSearch: string) => {
    setLoading(true);
    setError(null);
    
    try {
      const { data, error: fetchError } = await supabase
        .from('job_applications')
        .select(`
          id,
          full_name,
          status,
          submitted_at,
          organization:organizations!job_applications_organization_id_fkey (
            name,
            brand_name,
            logo_url
          ),
          location:locations!job_applications_location_id_fkey (
            name
          ),
          conversation:hiring_conversations (
            access_token
          )
        `)
        .eq('email', emailToSearch.toLowerCase().trim())
        .order('submitted_at', { ascending: false });

      if (fetchError) throw fetchError;

      // Transform the data to handle the conversation array
      const transformedData = (data || []).map(app => ({
        ...app,
        organization: app.organization as Application['organization'],
        location: app.location as Application['location'],
        conversation: app.conversation?.[0] || null,
      }));

      setApplications(transformedData);
      localStorage.setItem('applicant_email', emailToSearch.toLowerCase().trim());
    } catch (err) {
      console.error('Error fetching applications:', err);
      setError('Unable to load applications. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setSubmittedEmail(email.trim());
    fetchApplications(email.trim());
  };

  const handleLogout = () => {
    localStorage.removeItem('applicant_email');
    setEmail('');
    setSubmittedEmail(null);
    setApplications([]);
  };

  // Show email entry form
  if (!submittedEmail) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardHeader className="text-center">
            <img src={crooLogo} alt="Croo" className="h-12 mx-auto mb-4" />
            <CardTitle className="text-xl">View Your Applications</CardTitle>
            <p className="text-sm text-muted-foreground mt-2">
              Enter the email you used to apply
            </p>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email Address</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="your@email.com"
                  required
                />
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'View Applications'}
              </Button>
            </form>
            
            <div className="mt-6 pt-6 border-t border-border">
              <AddToHomeScreenButton variant="outline" className="w-full" />
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="sticky top-0 bg-background/95 backdrop-blur border-b border-border z-10">
        <div className="max-w-2xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src={crooLogo} alt="Croo" className="h-8" />
            <span className="font-semibold">My Applications</span>
          </div>
          <Button variant="ghost" size="sm" onClick={handleLogout}>
            Switch Email
          </Button>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-6 space-y-4">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <Card>
            <CardContent className="pt-6 text-center">
              <p className="text-destructive">{error}</p>
              <Button variant="outline" className="mt-4" onClick={() => fetchApplications(submittedEmail)}>
                Try Again
              </Button>
            </CardContent>
          </Card>
        ) : applications.length === 0 ? (
          <Card>
            <CardContent className="pt-6 text-center">
              <p className="text-muted-foreground">No applications found for {submittedEmail}</p>
              <Button variant="outline" className="mt-4" onClick={handleLogout}>
                Try Different Email
              </Button>
            </CardContent>
          </Card>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              Showing {applications.length} application{applications.length !== 1 ? 's' : ''} for {submittedEmail}
            </p>
            
            {applications.map((app) => (
              <Card key={app.id} className="overflow-hidden">
                <CardContent className="p-4">
                  <div className="flex items-start gap-4">
                    {/* Org Logo */}
                    <div className="flex-shrink-0">
                      {app.organization?.logo_url ? (
                        <img 
                          src={app.organization.logo_url} 
                          alt={app.organization.brand_name || app.organization.name}
                          className="h-12 w-12 rounded-lg object-contain bg-muted"
                        />
                      ) : (
                        <div className="h-12 w-12 rounded-lg bg-muted flex items-center justify-center">
                          <Building2 className="h-6 w-6 text-muted-foreground" />
                        </div>
                      )}
                    </div>
                    
                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <h3 className="font-semibold text-foreground">
                            {app.organization?.brand_name || app.organization?.name || 'Unknown Organization'}
                          </h3>
                          {app.organization?.brand_name && app.organization?.name && (
                            <p className="text-xs text-muted-foreground">{app.organization.name}</p>
                          )}
                          {app.location && (
                            <p className="text-sm text-muted-foreground flex items-center gap-1 mt-0.5">
                              <MapPin className="h-3 w-3" />
                              {app.location.name}
                            </p>
                          )}
                        </div>
                        <Badge 
                          variant="outline" 
                          className={STATUS_COLORS[app.status] || STATUS_COLORS.pending}
                        >
                          {STATUS_LABELS[app.status] || app.status}
                        </Badge>
                      </div>
                      
                      <p className="text-xs text-muted-foreground flex items-center gap-1 mt-2">
                        <Clock className="h-3 w-3" />
                        Applied {format(new Date(app.submitted_at), 'MMM d, yyyy')}
                      </p>
                      
                      {/* Chat Button - only shows if conversation exists */}
                      {app.conversation ? (
                        <Button
                          variant="default"
                          size="sm"
                          className="mt-3 w-full"
                          onClick={() => window.location.href = `/hiring-chat/${app.conversation!.access_token}`}
                        >
                          <MessageCircle className="h-4 w-4 mr-2" />
                          Open Messages
                        </Button>
                      ) : (
                        <p className="text-xs text-muted-foreground mt-3 text-center py-2 bg-muted/50 rounded">
                          We'll notify you when there's an update
                        </p>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </>
        )}
        
        {/* Add to home screen prompt */}
        <Card className="bg-primary/5 border-primary/20">
          <CardContent className="p-4">
            <p className="text-sm text-center text-muted-foreground mb-3">
              Add to your home screen for easy access
            </p>
            <AddToHomeScreenButton variant="outline" className="w-full" />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
