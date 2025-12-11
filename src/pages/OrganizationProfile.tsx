import { Layout } from '@/components/Layout';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ArrowLeft, Building2, MapPin, Plus, Palette, Save, ExternalLink, Upload, X, Wand2, Loader2 } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useState, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { compressImage } from '@/utils/imageCompression';
import { removeBackground, loadImageFromUrl } from '@/utils/backgroundRemoval';
import { OrganizationMembersSection } from '@/components/settings/OrganizationMembersSection';

export default function OrganizationProfile() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const isNew = id === 'new';
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [brandName, setBrandName] = useState('');
  const [logoUrl, setLogoUrl] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isRemovingBg, setIsRemovingBg] = useState(false);

  const { data: organization, isLoading } = useQuery({
    queryKey: ['organization', id],
    queryFn: async () => {
      if (isNew) return null;
      const { data, error } = await supabase
        .from('organizations')
        .select('*')
        .eq('id', id)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !isNew && !!id,
  });

  const { data: locations = [] } = useQuery({
    queryKey: ['organization-locations', id],
    queryFn: async () => {
      if (isNew) return [];
      const { data, error } = await supabase
        .from('locations')
        .select('*')
        .eq('organization_id', id)
        .order('name');
      if (error) throw error;
      return data;
    },
    enabled: !isNew && !!id,
  });

  useEffect(() => {
    if (organization) {
      setName(organization.name || '');
      setSlug(organization.slug || '');
      setBrandName((organization as any).brand_name || '');
      setLogoUrl(organization.logo_url || '');
    }
  }, [organization]);

  // Auto-generate slug from name
  useEffect(() => {
    if (isNew && name) {
      setSlug(name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''));
    }
  }, [name, isNew]);

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    try {
      const compressed = await compressImage(file, 800, 800);
      const fileExt = file.name.split('.').pop();
      const fileName = `${id || 'new'}-${Date.now()}.${fileExt}`;
      const filePath = `logos/${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from('organization-branding')
        .upload(filePath, compressed, { upsert: true });

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('organization-branding')
        .getPublicUrl(filePath);

      setLogoUrl(publicUrl);
      toast.success('Logo uploaded');
    } catch (error: any) {
      toast.error(error.message || 'Failed to upload logo');
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleRemoveLogo = () => {
    setLogoUrl('');
  };

  const handleRemoveBackground = async () => {
    if (!logoUrl) return;
    
    setIsRemovingBg(true);
    try {
      toast.info('Loading AI model... This may take a moment the first time.');
      
      const img = await loadImageFromUrl(logoUrl);
      const resultBlob = await removeBackground(img);
      
      // Upload the processed image
      const fileName = `${id || 'new'}-${Date.now()}-nobg.png`;
      const filePath = `logos/${fileName}`;
      
      const { error: uploadError } = await supabase.storage
        .from('organization-branding')
        .upload(filePath, resultBlob, { upsert: true });

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('organization-branding')
        .getPublicUrl(filePath);

      setLogoUrl(publicUrl);
      toast.success('Background removed successfully!');
    } catch (error: any) {
      console.error('Background removal error:', error);
      toast.error(error.message || 'Failed to remove background');
    } finally {
      setIsRemovingBg(false);
    }
  };

  const handleSave = async () => {
    if (!name.trim() || !slug.trim()) {
      toast.error('Name and slug are required');
      return;
    }

    setIsSaving(true);
    try {
      if (isNew) {
        const { error } = await supabase
          .from('organizations')
          .insert({
            name: name.trim(),
            slug: slug.trim(),
            brand_name: brandName.trim() || null,
            logo_url: logoUrl.trim() || null,
          } as any);
        if (error) throw error;
        toast.success('Organization created');
        navigate('/settings');
      } else {
        const { error } = await supabase
          .from('organizations')
          .update({
            name: name.trim(),
            slug: slug.trim(),
            brand_name: brandName.trim() || null,
            logo_url: logoUrl.trim() || null,
          } as any)
          .eq('id', id);
        if (error) throw error;
        toast.success('Organization updated');
        queryClient.invalidateQueries({ queryKey: ['organization', id] });
      }
    } catch (error: any) {
      toast.error(error.message || 'Failed to save');
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading && !isNew) {
    return (
      <Layout>
        <div className="text-center py-8">Loading...</div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate('/settings')}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-3xl font-bold">
              {isNew ? 'New Organization' : organization?.name}
            </h1>
            <p className="text-muted-foreground">
              {isNew ? 'Create a new organization' : 'Manage organization details and locations'}
            </p>
          </div>
        </div>

        {/* Organization Details */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Building2 className="h-4 w-4" />
              <CardTitle className="text-base">Organization Details</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Organization Name</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Acme Restaurant Group"
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="slug">URL Slug</Label>
              <Input
                id="slug"
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                placeholder="e.g., acme-restaurant-group"
              />
              <p className="text-xs text-muted-foreground">
                Used for organization identification (lowercase, no spaces)
              </p>
            </div>
            
            <Button onClick={handleSave} disabled={isSaving}>
              <Save className="h-4 w-4 mr-2" />
              {isSaving ? 'Saving...' : 'Save Changes'}
            </Button>
          </CardContent>
        </Card>

        {/* Branding */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Palette className="h-4 w-4" />
              <CardTitle className="text-base">Branding</CardTitle>
            </div>
            <CardDescription className="text-xs">
              Customize your organization's appearance
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="brandName">Brand Name</Label>
              <Input
                id="brandName"
                value={brandName}
                onChange={(e) => setBrandName(e.target.value)}
                placeholder="e.g., Blaze Pizza"
              />
              <p className="text-xs text-muted-foreground">
                The customer-facing brand name (e.g., "Blaze Pizza" for "Jo Pizza LLC")
              </p>
            </div>
            
            <div className="space-y-2">
              <Label>Organization Logo</Label>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleLogoUpload}
                className="hidden"
              />
              
              {logoUrl ? (
                <div className="space-y-3">
                  <div className="relative inline-block">
                    <div className="p-4 border rounded-lg bg-[repeating-conic-gradient(#e5e5e5_0%_25%,#fff_0%_50%)] bg-[length:16px_16px]">
                      <img 
                        src={logoUrl} 
                        alt="Logo preview" 
                        className="h-20 object-contain"
                      />
                    </div>
                    <Button
                      variant="destructive"
                      size="icon"
                      className="absolute -top-2 -right-2 h-6 w-6"
                      onClick={handleRemoveLogo}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={isUploading}
                    >
                      <Upload className="h-4 w-4 mr-2" />
                      Replace
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={handleRemoveBackground}
                      disabled={isRemovingBg}
                    >
                      {isRemovingBg ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <Wand2 className="h-4 w-4 mr-2" />
                      )}
                      {isRemovingBg ? 'Processing...' : 'Remove Background'}
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Use "Remove Background" to make your logo transparent
                  </p>
                </div>
              ) : (
                <Button
                  variant="outline"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isUploading}
                  className="w-full h-24 border-dashed"
                >
                  <div className="flex flex-col items-center gap-2">
                    <Upload className="h-6 w-6 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">
                      {isUploading ? 'Uploading...' : 'Click to upload logo'}
                    </span>
                  </div>
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Organization Members */}
        {!isNew && id && (
          <OrganizationMembersSection organizationId={id} />
        )}

        {/* Locations */}
        {!isNew && (
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <MapPin className="h-4 w-4" />
                  <CardTitle className="text-base">Locations</CardTitle>
                </div>
                <Button
                  size="sm"
                  onClick={() => navigate(`/location/new?org=${id}`)}
                >
                  <Plus className="h-4 w-4 mr-1" />
                  Add Location
                </Button>
              </div>
              <CardDescription className="text-xs">
                {locations.length} location{locations.length !== 1 ? 's' : ''} in this organization
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {locations.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">
                  No locations yet. Add your first location to get started.
                </p>
              ) : (
                locations.map((location) => (
                  <Button
                    key={location.id}
                    variant="outline"
                    className="w-full justify-between h-auto py-3"
                    onClick={() => navigate(`/location/${location.id}`)}
                  >
                    <div className="flex items-center gap-2">
                      <MapPin className="h-3 w-3" />
                      <div className="text-left">
                        <div className="text-sm font-medium">{location.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {location.location_type === 'checklist_only' ? 'Checklist Only' : 'Full Features'}
                        </div>
                      </div>
                    </div>
                    <ExternalLink className="h-3 w-3" />
                  </Button>
                ))
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </Layout>
  );
}
