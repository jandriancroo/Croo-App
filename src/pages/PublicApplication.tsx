import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { toast } from 'sonner';
import { Loader2, Plus, Trash2, Upload, CheckCircle, Sparkles } from 'lucide-react';
import crooLogo from '@/assets/croo-logo.webp';

const TURNSTILE_SITE_KEY = '0x4AAAAAACcJ6BAHEpqeaClk';

interface WorkHistoryEntry {
  employer_name: string;
  job_title: string;
  start_date: string;
  end_date: string;
  is_current: boolean;
  reason_for_leaving: string;
}

interface ReferenceEntry {
  name: string;
  relationship: string;
  phone: string;
  email: string;
}

type AvailabilityDay = {
  am: boolean;
  pm: boolean;
};

type Availability = {
  monday: AvailabilityDay;
  tuesday: AvailabilityDay;
  wednesday: AvailabilityDay;
  thursday: AvailabilityDay;
  friday: AvailabilityDay;
  saturday: AvailabilityDay;
  sunday: AvailabilityDay;
};

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const;

export default function PublicApplication() {
  const { orgSlug } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [submitted, setSubmitted] = useState(false);
  const turnstileRef = useRef<HTMLDivElement>(null);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  
  // Form state
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [selectedLocation, setSelectedLocation] = useState('');
  const [selectedTemplate, setSelectedTemplate] = useState('');
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [resumeUrl, setResumeUrl] = useState('');
  const [uploading, setUploading] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [customResponses, setCustomResponses] = useState<Record<string, string>>({});
  
  const [availability, setAvailability] = useState<Availability>({
    monday: { am: false, pm: false },
    tuesday: { am: false, pm: false },
    wednesday: { am: false, pm: false },
    thursday: { am: false, pm: false },
    friday: { am: false, pm: false },
    saturday: { am: false, pm: false },
    sunday: { am: false, pm: false },
  });

  const [workHistory, setWorkHistory] = useState<WorkHistoryEntry[]>([
    { employer_name: '', job_title: '', start_date: '', end_date: '', is_current: false, reason_for_leaving: '' }
  ]);

  const [references, setReferences] = useState<ReferenceEntry[]>([
    { name: '', relationship: '', phone: '', email: '' }
  ]);

  // Fetch organization by slug
  const { data: organization, isLoading: orgLoading, error: orgError } = useQuery({
    queryKey: ['org-by-slug', orgSlug],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('organizations')
        .select('*')
        .eq('slug', orgSlug)
        .eq('is_active', true)
        .single();
      
      if (error) throw error;
      return data;
    },
    enabled: !!orgSlug,
  });

  // Fetch locations for the organization
  const { data: locations } = useQuery({
    queryKey: ['org-locations', organization?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('locations')
        .select('id, name')
        .eq('organization_id', organization!.id)
        .eq('location_type', 'standard')
        .order('name');
      
      if (error) throw error;
      return data;
    },
    enabled: !!organization?.id,
  });

  // Fetch application templates for the organization
  const { data: templates } = useQuery({
    queryKey: ['org-templates', organization?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('job_application_templates')
        .select('*')
        .eq('organization_id', organization!.id)
        .eq('is_active', true)
        .order('name');
      
      if (error) throw error;
      return data;
    },
    enabled: !!organization?.id,
  });

  // Fetch custom questions for selected template
  const { data: customQuestions } = useQuery({
    queryKey: ['template-questions', selectedTemplate],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('job_application_template_questions')
        .select('*')
        .eq('template_id', selectedTemplate)
        .order('display_order');
      
      if (error) throw error;
      return data;
    },
    enabled: !!selectedTemplate,
  });

  // Auto-select first template if only one
  useEffect(() => {
    if (templates?.length === 1 && !selectedTemplate) {
      setSelectedTemplate(templates[0].id);
    }
  }, [templates, selectedTemplate]);

  // Load Turnstile script
  useEffect(() => {
    if (document.getElementById('turnstile-script')) return;
    const script = document.createElement('script');
    script.id = 'turnstile-script';
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
    script.async = true;
    script.defer = true;
    document.head.appendChild(script);
    return () => {
      const el = document.getElementById('turnstile-script');
      if (el) el.remove();
    };
  }, []);

  // Render Turnstile widget when ref is available
  useEffect(() => {
    if (!turnstileRef.current) return;
    const w = window as any;
    const render = () => {
      if (!turnstileRef.current || turnstileRef.current.childElementCount > 0) return;
      w.turnstile.render(turnstileRef.current, {
        sitekey: TURNSTILE_SITE_KEY,
        callback: (token: string) => setTurnstileToken(token),
        'expired-callback': () => setTurnstileToken(null),
        'error-callback': () => setTurnstileToken(null),
        theme: 'auto',
      });
    };
    if (w.turnstile) {
      render();
    } else {
      const script = document.getElementById('turnstile-script');
      script?.addEventListener('load', render);
      return () => script?.removeEventListener('load', render);
    }
  }, [turnstileRef.current]);

  const parseResumeWithAI = async (file: File) => {
    setIsScanning(true);
    try {
      toast.loading('Scanning resume...', { id: 'resume-parse' });

      let requestBody: { resumeText?: string; resumeBase64?: string; mimeType?: string } = {};

      if (file.type === 'application/pdf' || file.type.startsWith('image/')) {
        // Convert to base64 for PDFs and images
        const arrayBuffer = await file.arrayBuffer();
        const base64 = btoa(
          new Uint8Array(arrayBuffer).reduce((data, byte) => data + String.fromCharCode(byte), '')
        );
        requestBody = { resumeBase64: base64, mimeType: file.type };
      } else {
        // For text files, read as text
        const resumeText = await file.text();
        if (!resumeText.trim()) {
          toast.dismiss('resume-parse');
          return;
        }
        requestBody = { resumeText };
      }

      const { data, error } = await supabase.functions.invoke('ai-extraction-service?action=parse-resume', {
        body: requestBody
      });

      if (error) {
        console.error('Parse error:', error);
        toast.error('Could not scan resume', { id: 'resume-parse' });
        return;
      }

      if (data?.success && data?.data) {
        const parsed = data.data;
        
        // Auto-fill form fields only if they're empty
        if (parsed.firstName) setFirstName(prev => prev.trim() ? prev : parsed.firstName);
        if (parsed.lastName) setLastName(prev => prev.trim() ? prev : parsed.lastName);
        if (parsed.email) setEmail(prev => prev.trim() ? prev : parsed.email);
        if (parsed.phone) setPhone(prev => prev.trim() ? prev : parsed.phone);
        
        // Auto-fill work history only if user hasn't manually entered any
        if (parsed.workHistory && parsed.workHistory.length > 0) {
          setWorkHistory(prev => {
            // Check if user has already entered work history manually
            const hasManualData = prev.some(w => w.employer_name.trim());
            if (hasManualData) return prev;
            
            return parsed.workHistory.map((w: any) => ({
              employer_name: w.employer_name || '',
              job_title: w.job_title || '',
              start_date: w.start_date || '',
              end_date: w.end_date || '',
              is_current: w.is_current || false,
              reason_for_leaving: ''
            }));
          });
        }

        toast.success('Resume scanned! Fields auto-filled.', { id: 'resume-parse' });
      } else {
        toast.error('Could not extract info from resume', { id: 'resume-parse' });
      }
    } catch (error) {
      console.error('AI parse error:', error);
      toast.error('Resume scan failed', { id: 'resume-parse' });
    } finally {
      setIsScanning(false);
    }
  };

  // Handle resume upload via Turnstile-verified edge function
  const handleResumeUpload = async (file: File) => {
    if (!turnstileToken) {
      toast.error('Please complete the CAPTCHA verification first');
      return;
    }

    setUploading(true);
    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`;
      const filePath = `${orgSlug}/${fileName}`;

      const formData = new FormData();
      formData.append('turnstile_token', turnstileToken);
      formData.append('file', file);
      formData.append('file_path', filePath);

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/utility-service?action=verify-turnstile-upload`,
        {
          method: 'POST',
          body: formData,
        }
      );

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Upload failed');
      }

      setResumeUrl(result.url);
      setResumeFile(file);
      toast.success('Resume uploaded');

      // Try to parse with AI
      parseResumeWithAI(file);
    } catch (error: any) {
      console.error('Upload error:', error);
      toast.error(error?.message || 'Failed to upload resume');
    } finally {
      setUploading(false);
    }
  };

  // Submit application
  const submitMutation = useMutation({
    mutationFn: async () => {
      if (!organization || !selectedTemplate) throw new Error('Missing required data');

      // Capture source from URL params
      const utmSource = searchParams.get('utm_source') || 'direct';
      const listingId = searchParams.get('listing') || null;

      // Insert main application
      const { data: application, error: appError } = await supabase
        .from('job_applications')
        .insert({
          template_id: selectedTemplate,
          organization_id: organization.id,
          location_id: selectedLocation || null,
          full_name: `${firstName.trim()} ${lastName.trim()}`.trim(),
          email: email.trim(),
          phone: phone.trim(),
          availability,
          resume_url: resumeUrl || null,
          custom_responses: customResponses,
          source: utmSource,
          job_listing_id: listingId,
        } as any)
        .select()
        .single();

      if (appError) throw appError;

      // Insert work history
      const validWorkHistory = workHistory.filter(w => w.employer_name.trim());
      console.log('Work history to submit:', workHistory);
      console.log('Valid work history after filter:', validWorkHistory);
      if (validWorkHistory.length > 0) {
        const workHistoryPayload = validWorkHistory.map((w, i) => ({
          application_id: application.id,
          employer_name: w.employer_name.trim(),
          job_title: w.job_title.trim(),
          start_date: w.start_date || null,
          end_date: w.is_current ? null : (w.end_date || null),
          is_current: w.is_current,
          reason_for_leaving: w.reason_for_leaving.trim(),
          display_order: i,
        }));
        console.log('Work history payload:', workHistoryPayload);
        
        const { error: workError, data: workData } = await supabase
          .from('job_application_work_history')
          .insert(workHistoryPayload)
          .select();

        console.log('Work history insert result:', { workData, workError });
        if (workError) console.error('Work history error:', workError);
      } else {
        console.log('No valid work history to insert');
      }

      // Insert references
      const validRefs = references.filter(r => r.name.trim());
      if (validRefs.length > 0) {
        const { error: refError } = await supabase
          .from('job_application_references')
          .insert(
            validRefs.map((r, i) => ({
              application_id: application.id,
              name: r.name.trim(),
              relationship: r.relationship.trim(),
              phone: r.phone.trim(),
              email: r.email.trim(),
              display_order: i,
            }))
          );

        if (refError) console.error('References error:', refError);
      }

      // Send notification email to admins/GMs
      const templateName = templates?.find(t => t.id === selectedTemplate)?.name || 'Job Application';
      try {
        await supabase.functions.invoke('notify-new-application', {
          body: {
            applicationId: application.id,
            applicantName: `${firstName.trim()} ${lastName.trim()}`.trim(),
            applicantEmail: email.trim(),
            applicantPhone: phone.trim() || undefined,
            locationId: selectedLocation || undefined,
            organizationId: organization.id,
            templateName,
          },
        });
        console.log('Notification email sent successfully');
      } catch (notifyError) {
        // Don't fail the submission if notification fails
        console.error('Failed to send notification email:', notifyError);
      }

      return application;
    },
    onSuccess: () => {
      // Save email for the applicant portal before showing success
      localStorage.setItem('applicant_email', email.toLowerCase().trim());
      setSubmitted(true);
    },
    onError: (error) => {
      console.error('Submit error:', error);
      toast.error('Failed to submit application. Please try again.');
    },
  });

  const toggleAvailability = (day: keyof Availability, shift: 'am' | 'pm') => {
    setAvailability(prev => ({
      ...prev,
      [day]: {
        ...prev[day],
        [shift]: !prev[day][shift]
      }
    }));
  };

  const addWorkHistory = () => {
    setWorkHistory(prev => [...prev, { employer_name: '', job_title: '', start_date: '', end_date: '', is_current: false, reason_for_leaving: '' }]);
  };

  const removeWorkHistory = (index: number) => {
    setWorkHistory(prev => prev.filter((_, i) => i !== index));
  };

  const updateWorkHistory = (index: number, field: keyof WorkHistoryEntry, value: string | boolean) => {
    setWorkHistory(prev => prev.map((item, i) => i === index ? { ...item, [field]: value } : item));
  };

  const addReference = () => {
    setReferences(prev => [...prev, { name: '', relationship: '', phone: '', email: '' }]);
  };

  const removeReference = (index: number) => {
    setReferences(prev => prev.filter((_, i) => i !== index));
  };

  const updateReference = (index: number, field: keyof ReferenceEntry, value: string) => {
    setReferences(prev => prev.map((item, i) => i === index ? { ...item, [field]: value } : item));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!firstName.trim() || !lastName.trim()) {
      toast.error('Please enter your first and last name');
      return;
    }
    if (!email.trim()) {
      toast.error('Please enter your email');
      return;
    }
    if (!selectedTemplate) {
      toast.error('Please select a position');
      return;
    }

    // Check required custom questions (skip built-in types that use separate state)
    const builtInTypes = ['availability', 'work_history', 'references'];
    if (customQuestions) {
      for (const q of customQuestions) {
        // Skip built-in types - they use separate state variables
        if (builtInTypes.includes(q.question_type)) continue;
        
        if (q.is_required && !customResponses[q.id]?.trim()) {
          toast.error(`Please answer: ${q.question}`);
          return;
        }
      }
    }
    
    // Check if availability is required and at least one slot is selected
    const availabilityQuestion = customQuestions?.find(q => q.question_type === 'availability');
    if (availabilityQuestion?.is_required) {
      const hasAnyAvailability = Object.values(availability).some(day => day.am || day.pm);
      if (!hasAnyAvailability) {
        toast.error('Please select at least one availability slot');
        return;
      }
    }

    // Check if work history is required and at least one entry is filled
    const workHistoryQuestion = customQuestions?.find(q => q.question_type === 'work_history');
    if (workHistoryQuestion?.is_required) {
      const hasValidWorkHistory = workHistory.some(wh => wh.employer_name.trim() && wh.job_title.trim());
      if (!hasValidWorkHistory) {
        toast.error('Please add at least one work history entry');
        return;
      }
    }

    if (!turnstileToken) {
      toast.error('Please complete the CAPTCHA verification');
      return;
    }

    submitMutation.mutate();
  };

  if (orgLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (orgError || !organization) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="max-w-md w-full">
          <CardContent className="pt-6 text-center">
            <h2 className="text-xl font-semibold mb-2">Organization Not Found</h2>
            <p className="text-muted-foreground">
              The application link you followed doesn't exist or is no longer active.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }
  if (submitted) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="max-w-md w-full">
          <CardContent className="pt-6 text-center space-y-6">
            <CheckCircle className="h-16 w-16 text-green-500 mx-auto" />
            <div>
              <h2 className="text-2xl font-semibold mb-2">Application Submitted!</h2>
              <p className="text-muted-foreground">
                Thank you for applying to {(organization as any).brand_name || organization.name}. We'll review your application and be in touch soon.
              </p>
            </div>
            
            <div className="border-t border-border pt-6 space-y-3">
              <Button
                className="w-full"
                onClick={() => navigate('/my-applications')}
              >
                View My Applications
              </Button>
              <p className="text-xs text-muted-foreground">
                Add to your home screen to easily check your application status
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Get selected location name
  const selectedLocationName = locations?.find(l => l.id === selectedLocation)?.name;

  return (
    <div className="min-h-screen bg-background py-8 px-4">
      <div className="max-w-2xl mx-auto space-y-6">
        {/* Header */}
        <div className="border-b border-border pb-6">
          <div className="flex items-center justify-center gap-4">
            {organization.logo_url && (
              <img src={organization.logo_url} alt={(organization as any).brand_name || organization.name} className="h-14 w-14 object-contain rounded-lg" />
            )}
            <div className="text-left">
              <h1 className="text-2xl font-bold tracking-tight text-foreground">
                {(organization as any).brand_name || organization.name}
              </h1>
              {(organization as any).brand_name && (
                <p className="text-xs text-muted-foreground">{organization.name}</p>
              )}
              {selectedLocationName && (
                <p className="text-sm text-muted-foreground font-normal">{selectedLocationName}</p>
              )}
            </div>
          </div>
          <p className="text-center text-primary font-medium mt-4 text-lg">Join Our Team</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Position Selection or Display */}
          {templates && templates.length === 1 ? (
            <div className="text-center py-2">
              <p className="text-sm text-muted-foreground">Applying for</p>
              <p className="text-lg font-semibold text-foreground">{templates[0].name}</p>
            </div>
          ) : templates && templates.length > 1 ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Select Position</CardTitle>
              </CardHeader>
              <CardContent>
                <Select value={selectedTemplate} onValueChange={setSelectedTemplate}>
                  <SelectTrigger>
                    <SelectValue placeholder="Choose position to apply for" />
                  </SelectTrigger>
                  <SelectContent>
                    {templates.map(t => (
                      <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </CardContent>
            </Card>
          ) : null}

          {/* Basic Info */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Personal Information</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="firstName">First Name *</Label>
                  <Input
                    id="firstName"
                    value={firstName}
                    onChange={e => setFirstName(e.target.value)}
                    placeholder="John"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="lastName">Last Name *</Label>
                  <Input
                    id="lastName"
                    value={lastName}
                    onChange={e => setLastName(e.target.value)}
                    placeholder="Smith"
                    required
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">Email *</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="john@example.com"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="phone">Phone Number</Label>
                <Input
                  id="phone"
                  type="tel"
                  value={phone}
                  onChange={e => setPhone(e.target.value)}
                  placeholder="(555) 123-4567"
                />
              </div>
              {locations && locations.length > 0 && (
                <div className="space-y-2">
                  <Label>Preferred Location</Label>
                  <Select value={selectedLocation} onValueChange={setSelectedLocation}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select location" />
                    </SelectTrigger>
                    <SelectContent>
                      {locations.map(loc => (
                        <SelectItem key={loc.id} value={loc.id}>{loc.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Availability - only show if included in template */}
          {customQuestions?.some(q => q.question_type === 'availability') && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">
                  Availability
                  {customQuestions.find(q => q.question_type === 'availability')?.is_required && (
                    <span className="text-destructive ml-1">*</span>
                  )}
                </CardTitle>
                <CardDescription>Select when you're available to work</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr>
                        <th className="text-left py-2"></th>
                        {DAYS.map(day => (
                          <th key={day} className="text-center py-2 px-1 capitalize text-xs">
                            {day.slice(0, 3)}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td className="py-2 font-medium">AM</td>
                        {DAYS.map(day => (
                          <td key={`${day}-am`} className="text-center py-2 px-1">
                            <button
                              type="button"
                              onClick={() => toggleAvailability(day, 'am')}
                              className={`w-8 h-8 rounded-md border-2 transition-colors ${
                                availability[day].am 
                                  ? 'bg-primary border-primary text-primary-foreground' 
                                  : 'bg-muted border-border hover:border-primary/50'
                              }`}
                            >
                              {availability[day].am && '✓'}
                            </button>
                          </td>
                        ))}
                      </tr>
                      <tr>
                        <td className="py-2 font-medium">PM</td>
                        {DAYS.map(day => (
                          <td key={`${day}-pm`} className="text-center py-2 px-1">
                            <button
                              type="button"
                              onClick={() => toggleAvailability(day, 'pm')}
                              className={`w-8 h-8 rounded-md border-2 transition-colors ${
                                availability[day].pm 
                                  ? 'bg-primary border-primary text-primary-foreground' 
                                  : 'bg-muted border-border hover:border-primary/50'
                              }`}
                            >
                              {availability[day].pm && '✓'}
                            </button>
                          </td>
                        ))}
                      </tr>
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Resume Upload */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Resume</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {resumeFile ? (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 p-3 bg-muted rounded-lg">
                      <span className="flex-1 truncate">{resumeFile.name}</span>
                      <Button 
                        type="button" 
                        variant="ghost" 
                        size="sm"
                        onClick={() => { setResumeFile(null); setResumeUrl(''); }}
                        disabled={isScanning}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                    {isScanning && (
                      <div className="flex items-center gap-2 px-3 py-2 bg-primary/10 border border-primary/20 rounded-lg animate-pulse">
                        <Sparkles className="h-4 w-4 text-primary animate-spin" />
                        <span className="text-sm font-medium text-primary">Croo AI Scanning Resume...</span>
                      </div>
                    )}
                  </div>
                ) : (
                  <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed rounded-lg cursor-pointer hover:bg-muted/50 transition-colors">
                    <div className="flex flex-col items-center justify-center pt-5 pb-6">
                      {uploading ? (
                        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                      ) : (
                        <>
                          <Upload className="h-8 w-8 text-muted-foreground mb-2" />
                          <p className="text-sm text-muted-foreground">
                            Click to upload resume (PDF, DOC, DOCX)
                          </p>
                        </>
                      )}
                    </div>
                    <input 
                      type="file" 
                      className="hidden" 
                      accept=".pdf,.doc,.docx"
                      onChange={e => e.target.files?.[0] && handleResumeUpload(e.target.files[0])}
                      disabled={uploading}
                    />
                  </label>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Work History - only show if included in template */}
          {customQuestions?.some(q => q.question_type === 'work_history') && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">
                  Work History
                  {customQuestions.find(q => q.question_type === 'work_history')?.is_required && (
                    <span className="text-destructive ml-1">*</span>
                  )}
                </CardTitle>
                <CardDescription>List your previous employers (most recent first)</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {workHistory.map((work, index) => (
                  <div key={index} className="p-4 border rounded-lg space-y-3">
                    <div className="flex justify-between items-start">
                      <span className="text-sm font-medium text-muted-foreground">Employer {index + 1}</span>
                      {workHistory.length > 1 && (
                        <Button type="button" variant="ghost" size="sm" onClick={() => removeWorkHistory(index)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Input
                        placeholder="Company Name"
                        value={work.employer_name}
                        onChange={e => updateWorkHistory(index, 'employer_name', e.target.value)}
                      />
                      <Input
                        placeholder="Job Title"
                        value={work.job_title}
                        onChange={e => updateWorkHistory(index, 'job_title', e.target.value)}
                      />
                      <Input
                        type="date"
                        placeholder="Start Date"
                        value={work.start_date}
                        onChange={e => updateWorkHistory(index, 'start_date', e.target.value)}
                      />
                      <div className="space-y-2">
                        <Input
                          type="date"
                          placeholder="End Date"
                          value={work.end_date}
                          onChange={e => updateWorkHistory(index, 'end_date', e.target.value)}
                          disabled={work.is_current}
                        />
                        <div className="flex items-center gap-2">
                          <Checkbox
                            id={`current-${index}`}
                            checked={work.is_current}
                            onCheckedChange={checked => updateWorkHistory(index, 'is_current', checked as boolean)}
                          />
                          <label htmlFor={`current-${index}`} className="text-sm">Currently employed here</label>
                        </div>
                      </div>
                    </div>
                    <Input
                      placeholder="Reason for leaving"
                      value={work.reason_for_leaving}
                      onChange={e => updateWorkHistory(index, 'reason_for_leaving', e.target.value)}
                    />
                  </div>
                ))}
                <Button type="button" variant="outline" onClick={addWorkHistory} className="w-full">
                  <Plus className="h-4 w-4 mr-2" /> Add Another Employer
                </Button>
              </CardContent>
            </Card>
          )}

          {/* References - only show if included in template */}
          {customQuestions?.some(q => q.question_type === 'references') && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">
                  References
                  {customQuestions.find(q => q.question_type === 'references')?.is_required && (
                    <span className="text-destructive ml-1">*</span>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {references.map((ref, index) => (
                  <div key={index} className="p-4 border rounded-lg space-y-3">
                    <div className="flex justify-between items-start">
                      <span className="text-sm font-medium text-muted-foreground">Reference {index + 1}</span>
                      {references.length > 1 && (
                        <Button type="button" variant="ghost" size="sm" onClick={() => removeReference(index)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Input
                        placeholder="Name"
                        value={ref.name}
                        onChange={e => updateReference(index, 'name', e.target.value)}
                      />
                      <Input
                        placeholder="Relationship (e.g., Former Manager)"
                        value={ref.relationship}
                        onChange={e => updateReference(index, 'relationship', e.target.value)}
                      />
                      <Input
                        type="tel"
                        placeholder="Phone"
                        value={ref.phone}
                        onChange={e => updateReference(index, 'phone', e.target.value)}
                      />
                      <Input
                        type="email"
                        placeholder="Email"
                        value={ref.email}
                        onChange={e => updateReference(index, 'email', e.target.value)}
                      />
                    </div>
                  </div>
                ))}
                <Button type="button" variant="outline" onClick={addReference} className="w-full">
                  <Plus className="h-4 w-4 mr-2" /> Add Another Reference
                </Button>
              </CardContent>
            </Card>
          )}

          {/* Custom Questions - filter out built-in field types */}
          {customQuestions && customQuestions.filter(q => !['availability', 'work_history', 'references'].includes(q.question_type)).length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Additional Questions</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {customQuestions
                  .filter(q => !['availability', 'work_history', 'references'].includes(q.question_type))
                  .map(q => (
                  <div key={q.id} className="space-y-2">
                    <Label>
                      {q.question}
                      {q.is_required && <span className="text-destructive ml-1">*</span>}
                    </Label>
                    {q.question_type === 'textarea' ? (
                      <Textarea
                        value={customResponses[q.id] || ''}
                        onChange={e => setCustomResponses(prev => ({ ...prev, [q.id]: e.target.value }))}
                        required={q.is_required}
                      />
                    ) : q.question_type === 'select' && q.options ? (
                      <Select 
                        value={customResponses[q.id] || ''} 
                        onValueChange={val => setCustomResponses(prev => ({ ...prev, [q.id]: val }))}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select an option" />
                        </SelectTrigger>
                        <SelectContent>
                          {(q.options as string[]).map((opt, i) => (
                            <SelectItem key={i} value={opt}>{opt}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Input
                        value={customResponses[q.id] || ''}
                        onChange={e => setCustomResponses(prev => ({ ...prev, [q.id]: e.target.value }))}
                        required={q.is_required}
                      />
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Turnstile CAPTCHA */}
          <div className="flex justify-center">
            <div ref={turnstileRef} />
          </div>

          <Button 
            type="submit" 
            className="w-full h-12 text-lg"
            disabled={submitMutation.isPending || !turnstileToken}
          >
            {submitMutation.isPending ? (
              <>
                <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                Submitting...
              </>
            ) : (
              'Submit Application'
            )}
          </Button>
        </form>

        {/* Footer */}
        <div className="text-center pt-6 pb-4 text-muted-foreground text-sm flex items-center justify-center gap-2">
          <span>Powered by</span>
          <img src={crooLogo} alt="Croo" className="h-6" />
        </div>
      </div>
    </div>
  );
}
