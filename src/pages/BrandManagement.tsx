import { Layout } from '@/components/Layout';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { ArrowLeft, Plus, Tag, Upload, X, Wand2, Loader2, Save, Pencil, Building2, Crop } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useState, useRef } from 'react';
import { toast } from 'sonner';
import { compressImage } from '@/utils/imageCompression';
import { removeBackground, loadImageFromUrl } from '@/utils/backgroundRemoval';
import { useUserRole } from '@/hooks/useUserRole';
import { ImageCropDialog } from '@/components/ImageCropDialog';

export default function BrandManagement() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { isSuperAdmin, loading: roleLoading } = useUserRole();
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingBrand, setEditingBrand] = useState<any>(null);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [logoUrl, setLogoUrl] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isRemovingBg, setIsRemovingBg] = useState(false);
  const [cropDialogOpen, setCropDialogOpen] = useState(false);
  const [imageToCrop, setImageToCrop] = useState('');

  const { data: brands = [], isLoading } = useQuery({
    queryKey: ['brands-management'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('brands')
        .select('*, organizations(id, name)')
        .order('name');
      if (error) throw error;
      return data;
    },
  });

  const resetForm = () => {
    setName('');
    setSlug('');
    setLogoUrl('');
    setEditingBrand(null);
  };

  const openCreateDialog = () => {
    resetForm();
    setIsDialogOpen(true);
  };

  const openEditDialog = (brand: any) => {
    setEditingBrand(brand);
    setName(brand.name);
    setSlug(brand.slug);
    setLogoUrl(brand.logo_url || '');
    setIsDialogOpen(true);
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Create preview URL and open crop dialog
    const previewUrl = URL.createObjectURL(file);
    setImageToCrop(previewUrl);
    setCropDialogOpen(true);
    
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleCropComplete = async (croppedBlob: Blob) => {
    setIsUploading(true);
    try {
      // Upload PNG directly to preserve transparency
      const fileName = `brand-${Date.now()}.png`;
      const filePath = `brands/${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from('brand-assets')
        .upload(filePath, croppedBlob, { upsert: true });

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('brand-assets')
        .getPublicUrl(filePath);

      setLogoUrl(publicUrl);
      toast.success('Logo uploaded');
    } catch (error: any) {
      toast.error(error.message || 'Failed to upload logo');
    } finally {
      setIsUploading(false);
      if (imageToCrop) {
        URL.revokeObjectURL(imageToCrop);
        setImageToCrop('');
      }
    }
  };

  const handleRemoveBackground = async () => {
    if (!logoUrl) return;
    
    setIsRemovingBg(true);
    try {
      toast.info('Loading AI model... This may take a moment the first time.');
      
      const img = await loadImageFromUrl(logoUrl);
      const resultBlob = await removeBackground(img);
      
      const fileName = `brand-${Date.now()}-nobg.png`;
      const filePath = `brands/${fileName}`;
      
      const { error: uploadError } = await supabase.storage
        .from('brand-assets')
        .upload(filePath, resultBlob, { upsert: true });

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('brand-assets')
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
      if (editingBrand) {
        const { error } = await supabase
          .from('brands')
          .update({
            name: name.trim(),
            slug: slug.trim(),
            logo_url: logoUrl.trim() || null,
          })
          .eq('id', editingBrand.id);
        if (error) throw error;
        toast.success('Brand updated');
      } else {
        const { error } = await supabase
          .from('brands')
          .insert({
            name: name.trim(),
            slug: slug.trim(),
            logo_url: logoUrl.trim() || null,
            is_active: true,
          });
        if (error) throw error;
        toast.success('Brand created');
      }
      queryClient.invalidateQueries({ queryKey: ['brands-management'] });
      queryClient.invalidateQueries({ queryKey: ['brands'] });
      setIsDialogOpen(false);
      resetForm();
    } catch (error: any) {
      toast.error(error.message || 'Failed to save brand');
    } finally {
      setIsSaving(false);
    }
  };

  if (roleLoading) {
    return (
      <Layout>
        <div className="text-center py-8">Loading...</div>
      </Layout>
    );
  }

  if (!isSuperAdmin) {
    return (
      <Layout>
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <Tag className="h-16 w-16 text-muted-foreground mb-4" />
          <h2 className="text-xl font-semibold mb-2">Access Denied</h2>
          <p className="text-muted-foreground mb-4">
            Only super administrators can manage brands.
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
        <div className="flex flex-col sm:flex-row sm:items-center gap-4">
          <div className="flex items-center gap-4 flex-1 min-w-0">
            <Button variant="ghost" size="icon" onClick={() => navigate('/settings')} className="shrink-0">
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div className="min-w-0">
              <h1 className="text-2xl sm:text-3xl font-bold">Brand Management</h1>
              <p className="text-muted-foreground text-sm">
                Create and manage brands for your organizations
              </p>
            </div>
          </div>
          <Dialog open={isDialogOpen} onOpenChange={(open) => {
            setIsDialogOpen(open);
            if (!open) resetForm();
          }}>
            <DialogTrigger asChild>
              <Button onClick={openCreateDialog} className="shrink-0 w-full sm:w-auto">
                <Plus className="h-4 w-4 mr-2" />
                New Brand
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>{editingBrand ? 'Edit Brand' : 'Create Brand'}</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="brand-name">Brand Name</Label>
                  <Input
                    id="brand-name"
                    value={name}
                    onChange={(e) => {
                      setName(e.target.value);
                      if (!editingBrand) {
                        setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''));
                      }
                    }}
                    placeholder="e.g., Blaze Pizza"
                  />
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="brand-slug">URL Slug</Label>
                  <Input
                    id="brand-slug"
                    value={slug}
                    onChange={(e) => setSlug(e.target.value)}
                    placeholder="e.g., blaze-pizza"
                  />
                </div>
                
                <div className="space-y-2">
                  <Label>Brand Logo</Label>
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
                        <div className="p-4 border rounded-lg bg-[repeating-conic-gradient(hsl(var(--muted))_0%_25%,hsl(var(--background))_0%_50%)] bg-[length:16px_16px]">
                          <img 
                            src={logoUrl} 
                            alt="Logo preview" 
                            className="h-16 object-contain"
                          />
                        </div>
                        <Button
                          variant="destructive"
                          size="icon"
                          className="absolute -top-2 -right-2 h-6 w-6"
                          onClick={() => setLogoUrl('')}
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                      <div className="flex flex-wrap gap-2">
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
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setImageToCrop(logoUrl);
                            setCropDialogOpen(true);
                          }}
                        >
                          <Crop className="h-4 w-4 mr-2" />
                          Crop
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
                          {isRemovingBg ? 'Processing...' : 'Remove BG'}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <Button
                      variant="outline"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={isUploading}
                      className="w-full h-20 border-dashed"
                    >
                      <div className="flex flex-col items-center gap-1">
                        <Upload className="h-5 w-5 text-muted-foreground" />
                        <span className="text-xs text-muted-foreground">
                          {isUploading ? 'Uploading...' : 'Upload logo'}
                        </span>
                      </div>
                    </Button>
                  )}
                </div>
                
                <Button onClick={handleSave} disabled={isSaving} className="w-full">
                  <Save className="h-4 w-4 mr-2" />
                  {isSaving ? 'Saving...' : editingBrand ? 'Update Brand' : 'Create Brand'}
                </Button>
              </div>
            </DialogContent>
          </Dialog>

          {/* Image Crop Dialog */}
          <ImageCropDialog
            open={cropDialogOpen}
            onOpenChange={setCropDialogOpen}
            imageSrc={imageToCrop}
            onCropComplete={handleCropComplete}
            cropShape="rect"
          />
        </div>

        {isLoading ? (
          <div className="text-center py-8 text-muted-foreground">Loading brands...</div>
        ) : brands.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12">
              <Tag className="h-12 w-12 text-muted-foreground mb-4" />
              <h3 className="font-medium mb-1">No brands yet</h3>
              <p className="text-sm text-muted-foreground mb-4">
                Create your first brand to get started
              </p>
              <Button onClick={openCreateDialog}>
                <Plus className="h-4 w-4 mr-2" />
                Create Brand
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {brands.map((brand: any) => (
              <Card key={brand.id} className="hover:border-primary/50 transition-colors">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      {brand.logo_url ? (
                        <div className="p-2 border rounded-lg bg-background">
                          <img 
                            src={brand.logo_url} 
                            alt={brand.name} 
                            className="h-10 w-10 object-contain"
                          />
                        </div>
                      ) : (
                        <div className="p-2 border rounded-lg bg-muted">
                          <Tag className="h-10 w-10 text-muted-foreground" />
                        </div>
                      )}
                      <div>
                        <CardTitle className="text-base">{brand.name}</CardTitle>
                        <CardDescription className="text-xs">/{brand.slug}</CardDescription>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={(e) => { e.stopPropagation(); openEditDialog(brand); }}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="pt-0 space-y-3">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Building2 className="h-3 w-3" />
                    <span>
                      {brand.organizations?.length || 0} organization{(brand.organizations?.length || 0) !== 1 ? 's' : ''}
                    </span>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full gap-2"
                    onClick={() => navigate(`/brand/${brand.id}/inventory`)}
                  >
                    <Package className="h-3.5 w-3.5" />
                    Inventory
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
}
