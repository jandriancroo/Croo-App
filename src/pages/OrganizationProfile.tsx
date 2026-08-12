import { Layout } from '@/components/Layout';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ArrowLeft, Building2, MapPin, Plus, Save, ExternalLink, ShieldX, Tag } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { OrganizationMembersSection } from '@/components/settings/OrganizationMembersSection';
import { RoleManagementSection } from '@/components/settings/RoleManagementSection';

import { PositionManagementInline } from '@/components/settings/PositionManagementInline';
import { useUserRole } from '@/hooks/useUserRole';
import { OrgLibraryEnableSection } from '@/components/library/OrgLibraryEnableSection';
import { PunchDeviceManager } from '@/components/organization/PunchDeviceManager';
import { WatchDeviceManager } from '@/components/organization/WatchDeviceManager';


export default function OrganizationProfile() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { isSuperAdmin, loading: roleLoading } = useUserRole();
  const isNew = id === 'new';
  
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [brandId, setBrandId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Fetch all brands for the dropdown
  const { data: brands = [] } = useQuery({
    queryKey: ['brands'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('brands')
        .select('id, name, logo_url')
        .eq('is_active', true)
        .order('name');
      if (error) throw error;
      return data;
    },
  });

  const { data: organization, isLoading } = useQuery({
    queryKey: ['organization', id],
    queryFn: async () => {
      if (isNew) return null;
      const { data, error } = await supabase
        .from('organizations')
        .select('*, brands(id, name, logo_url)')
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
      setBrandId((organization as any).brand_id || null);
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
            brand_id: brandId,
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
            brand_id: brandId,
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

  // Get selected brand details
  const selectedBrand = brands.find(b => b.id === brandId);

  if (roleLoading || (isLoading && !isNew)) {
    return (
      <Layout>
        <div className="text-center py-8">Loading...</div>
      </Layout>
    );
  }

  // Only super_admin can create new organizations
  if (isNew && !isSuperAdmin) {
    return (
      <Layout>
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <ShieldX className="h-16 w-16 text-muted-foreground mb-4" />
          <h2 className="text-xl font-semibold mb-2">Access Denied</h2>
          <p className="text-muted-foreground mb-4">
            Only super administrators can create new organizations.
          </p>
          <Button variant="outline" onClick={() => navigate('/settings')}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Settings
          </Button>
        </div>
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
            
            <Button onClick={handleSave} disabled={isSaving}>
              <Save className="h-4 w-4 mr-2" />
              {isSaving ? 'Saving...' : 'Save Changes'}
            </Button>
          </CardContent>
        </Card>

        {/* Brand Assignment */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Tag className="h-4 w-4" />
              <CardTitle className="text-base">Brand</CardTitle>
            </div>
            <CardDescription className="text-xs">
              Assign this organization to a brand for branding and logo
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Brand</Label>
              <Select value={brandId || ''} onValueChange={(value) => setBrandId(value || null)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a brand..." />
                </SelectTrigger>
                <SelectContent>
                  {brands.map((brand) => (
                    <SelectItem key={brand.id} value={brand.id}>
                      <div className="flex items-center gap-2">
                        {brand.logo_url && (
                          <img src={brand.logo_url} alt="" className="h-4 w-4 object-contain" />
                        )}
                        {brand.name}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                The brand's name and logo will be used for this organization
              </p>
            </div>

            {selectedBrand && (
              <div className="flex items-center gap-4 p-3 rounded-lg border bg-muted/50">
                {selectedBrand.logo_url && (
                  <div className="p-2 border rounded-lg bg-background">
                    <img 
                      src={selectedBrand.logo_url} 
                      alt={selectedBrand.name} 
                      className="h-12 object-contain"
                    />
                  </div>
                )}
                <div>
                  <p className="font-medium">{selectedBrand.name}</p>
                  <p className="text-xs text-muted-foreground">Current brand</p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Library toggle */}
        {!isNew && id && (
          <Card>
            <CardContent className="pt-6">
              <OrgLibraryEnableSection organizationId={id} />
            </CardContent>
          </Card>
        )}

        {/* Organization Members */}
        {!isNew && id && (
          <OrganizationMembersSection organizationId={id} />
        )}

        {/* Role Management Section (includes Permissions + Notifications) */}
        {!isNew && id && (
          <RoleManagementSection organizationId={id} />
        )}

        {/* Positions */}
        {!isNew && id && (
          <Card>
            <CardContent className="pt-6">
              <PositionManagementInline organizationId={id} />
            </CardContent>
          </Card>
        )}

        {/* Punch Clock Devices (org admins only) */}
        {!isNew && id && (
          <PunchDeviceManager organizationId={id} locations={locations as any[]} />
        )}

        {/* Apple Watch Devices (org admins only) */}
        {!isNew && id && (
          <WatchDeviceManager organizationId={id} locations={locations as any[]} />
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
                locations.map((location: any) => (
                  <Button
                    key={location.id}
                    variant="outline"
                    className="w-full justify-between h-auto py-3"
                    onClick={() => navigate(`/location/${location.id}`)}
                  >
                    <div className="flex items-center gap-2">
                      <MapPin className="h-3 w-3" />
                      <div className="text-left">
                        <div className="text-sm font-medium">
                          {location.store_number && (
                            <span className="text-muted-foreground mr-1">#{location.store_number}</span>
                          )}
                          {location.name}
                        </div>
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
