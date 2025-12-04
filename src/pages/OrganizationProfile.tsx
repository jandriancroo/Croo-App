import { Layout } from '@/components/Layout';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ArrowLeft, Building2, MapPin, Plus, Palette, Save, ExternalLink } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useState, useEffect } from 'react';
import { toast } from 'sonner';

export default function OrganizationProfile() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const isNew = id === 'new';
  
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [logoUrl, setLogoUrl] = useState('');
  const [isSaving, setIsSaving] = useState(false);

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
      setLogoUrl(organization.logo_url || '');
    }
  }, [organization]);

  // Auto-generate slug from name
  useEffect(() => {
    if (isNew && name) {
      setSlug(name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''));
    }
  }, [name, isNew]);

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
            logo_url: logoUrl.trim() || null,
          });
        if (error) throw error;
        toast.success('Organization created');
        navigate('/settings');
      } else {
        const { error } = await supabase
          .from('organizations')
          .update({
            name: name.trim(),
            slug: slug.trim(),
            logo_url: logoUrl.trim() || null,
          })
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
              <Label htmlFor="logo">Logo URL</Label>
              <Input
                id="logo"
                value={logoUrl}
                onChange={(e) => setLogoUrl(e.target.value)}
                placeholder="https://example.com/logo.png"
              />
            </div>
            
            {logoUrl && (
              <div className="p-4 border rounded-lg bg-muted/50">
                <p className="text-xs text-muted-foreground mb-2">Preview:</p>
                <img 
                  src={logoUrl} 
                  alt="Logo preview" 
                  className="h-16 object-contain"
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = 'none';
                  }}
                />
              </div>
            )}
          </CardContent>
        </Card>

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
