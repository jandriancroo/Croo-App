import { Layout } from '@/components/Layout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/lib/auth';
import { useUserRole } from '@/hooks/useUserRole';
import { supabase } from '@/integrations/supabase/client';
import { Award, Upload, ExternalLink, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { format } from 'date-fns';
import { toast as sonnerToast } from 'sonner';
import { LocationsSection } from '@/components/settings/LocationsSection';
import { LocationSettingsSection } from '@/components/settings/LocationSettingsSection';

const themes = [
  { value: 'default', label: 'Default' },
  { value: 'oled', label: 'OLED Black' },
  { value: 'blue', label: 'Ocean Blue' },
  { value: 'forest', label: 'Forest Green' },
  { value: 'sunset', label: 'Sunset Orange' },
];

const timezones = [
  { value: 'America/Los_Angeles', label: 'Pacific Time (PT)' },
  { value: 'America/Denver', label: 'Mountain Time (MT)' },
  { value: 'America/Chicago', label: 'Central Time (CT)' },
  { value: 'America/New_York', label: 'Eastern Time (ET)' },
  { value: 'America/Anchorage', label: 'Alaska Time (AKT)' },
  { value: 'Pacific/Honolulu', label: 'Hawaii Time (HST)' },
];

type CertificationType = 'food_handlers' | 'servsafe';

export default function Settings() {
  const { toast } = useToast();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { isAdmin } = useUserRole();
  const [theme, setTheme] = useState(localStorage.getItem('app-theme') || 'default');
  const [timezone, setTimezone] = useState(localStorage.getItem('app-timezone') || 'America/Los_Angeles');
  const [myCertifications, setMyCertifications] = useState<any[]>([]);
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedType, setSelectedType] = useState<CertificationType>('food_handlers');
  const [expirationDate, setExpirationDate] = useState('');
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    // Apply theme to document
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  useEffect(() => {
    if (user) {
      fetchMyCertifications();
    }
  }, [user]);

  const fetchMyCertifications = async () => {
    if (!user) return;

    try {
      const { data, error } = await supabase
        .from('certifications')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setMyCertifications(data || []);
    } catch (error: any) {
      console.error('Error fetching certifications:', error);
    }
  };

  const handleUpload = async () => {
    if (!user || !selectedFile || !expirationDate) {
      sonnerToast.error('Please fill in all fields');
      return;
    }

    try {
      setUploading(true);

      // Upload file to storage
      const fileExt = selectedFile.name.split('.').pop();
      const fileName = `${user.id}/${Date.now()}.${fileExt}`;

      const { error: uploadError } = await supabase.storage
        .from('certificates')
        .upload(fileName, selectedFile);

      if (uploadError) throw uploadError;

      // Get public URL
      const { data: { publicUrl } } = supabase.storage
        .from('certificates')
        .getPublicUrl(fileName);

      // Create certification record
      const { error: insertError } = await supabase
        .from('certifications')
        .insert({
          user_id: user.id,
          certification_type: selectedType,
          certificate_url: publicUrl,
          expiration_date: expirationDate,
          status: 'pending',
        });

      if (insertError) throw insertError;

      sonnerToast.success('Certificate uploaded successfully! Awaiting admin approval.');
      setUploadDialogOpen(false);
      setSelectedFile(null);
      setExpirationDate('');
      fetchMyCertifications();
    } catch (error: any) {
      console.error('Error uploading certificate:', error);
      sonnerToast.error('Failed to upload certificate');
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (certId: string) => {
    if (!confirm('Are you sure you want to delete this certificate?')) return;

    try {
      const { error } = await supabase
        .from('certifications')
        .delete()
        .eq('id', certId);

      if (error) throw error;

      sonnerToast.success('Certificate deleted');
      fetchMyCertifications();
    } catch (error: any) {
      console.error('Error deleting certificate:', error);
      sonnerToast.error('Failed to delete certificate');
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'approved':
        return <Badge className="bg-green-500">Approved</Badge>;
      case 'rejected':
        return <Badge variant="destructive">Rejected</Badge>;
      default:
        return <Badge variant="secondary">Pending</Badge>;
    }
  };

  const getCertTypeName = (type: CertificationType) => {
    return type === 'food_handlers' ? 'Food Handlers Card' : 'ServSafe Certification';
  };

  const handleThemeChange = (value: string) => {
    setTheme(value);
    localStorage.setItem('app-theme', value);
    document.documentElement.setAttribute('data-theme', value);
    toast({
      title: 'Theme Updated',
      description: 'Your theme preference has been saved.',
    });
  };

  const handleTimezoneChange = (value: string) => {
    setTimezone(value);
    localStorage.setItem('app-timezone', value);
    toast({
      title: 'Timezone Updated',
      description: 'Your timezone preference has been saved.',
    });
  };

  return (
    <Layout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold">Settings</h1>
          <p className="text-muted-foreground">Manage your application preferences</p>
        </div>

        <div className="grid gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Theme</CardTitle>
              <CardDescription>
                Customize the appearance of the application
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="theme">Color Theme</Label>
                <Select value={theme} onValueChange={handleThemeChange}>
                  <SelectTrigger id="theme">
                    <SelectValue placeholder="Select a theme" />
                  </SelectTrigger>
                  <SelectContent>
                    {themes.map((t) => (
                      <SelectItem key={t.value} value={t.value}>
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Region</CardTitle>
              <CardDescription>
                Set your timezone and regional preferences
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="timezone">Timezone</Label>
                <Select value={timezone} onValueChange={handleTimezoneChange}>
                  <SelectTrigger id="timezone">
                    <SelectValue placeholder="Select a timezone" />
                  </SelectTrigger>
                  <SelectContent>
                    {timezones.map((tz) => (
                      <SelectItem key={tz.value} value={tz.value}>
                        {tz.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          {isAdmin && <LocationsSection />}
          
          {isAdmin && <LocationSettingsSection />}

          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>My Certifications</CardTitle>
                  <CardDescription>
                    Upload and manage your certifications
                  </CardDescription>
                </div>
                <Dialog open={uploadDialogOpen} onOpenChange={setUploadDialogOpen}>
                  <DialogTrigger asChild>
                    <Button size="sm">
                      <Upload className="w-4 h-4 mr-2" />
                      Upload
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Upload Certificate</DialogTitle>
                      <DialogDescription>
                        Upload your certification document. It will be reviewed by an admin.
                      </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4">
                      <div>
                        <Label>Certification Type</Label>
                        <Select value={selectedType} onValueChange={(value: CertificationType) => setSelectedType(value)}>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="food_handlers">Food Handlers Card</SelectItem>
                            <SelectItem value="servsafe">ServSafe Certification</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label>Certificate File</Label>
                        <Input
                          type="file"
                          accept="image/*,.pdf"
                          onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
                        />
                      </div>
                      <div>
                        <Label>Expiration Date</Label>
                        <Input
                          type="date"
                          value={expirationDate}
                          onChange={(e) => setExpirationDate(e.target.value)}
                        />
                      </div>
                      <Button onClick={handleUpload} disabled={uploading} className="w-full">
                        {uploading ? 'Uploading...' : 'Upload'}
                      </Button>
                    </div>
                  </DialogContent>
                </Dialog>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {myCertifications.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">
                  No certifications uploaded yet
                </p>
              ) : (
                myCertifications.map((cert) => (
                  <div key={cert.id} className="border rounded-lg p-4">
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <h4 className="font-semibold">{getCertTypeName(cert.certification_type as CertificationType)}</h4>
                        <p className="text-sm text-muted-foreground">
                          Expires: {format(new Date(cert.expiration_date), 'MMM d, yyyy')}
                        </p>
                      </div>
                      {getStatusBadge(cert.status)}
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => window.open(cert.certificate_url, '_blank')}
                      >
                        <ExternalLink className="w-3 h-3 mr-1" />
                        View
                      </Button>
                      {cert.status === 'pending' && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleDelete(cert.id)}
                        >
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      )}
                    </div>
                  </div>
                ))
              )}
              {isAdmin && (
                <Button onClick={() => navigate('/certifications')} variant="outline" className="w-full mt-4">
                  <Award className="w-4 h-4 mr-2" />
                  Manage All Certifications (Admin)
                </Button>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </Layout>
  );
}
