import { Layout } from '@/components/Layout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { MapPin, ArrowLeft, Copy, RefreshCw, ClipboardCopy } from 'lucide-react';
import { LocationMap } from '@/components/settings/LocationMap';
import { LocationSettingsSection } from '@/components/settings/LocationSettingsSection';
import { LaborRulesSection } from '@/components/settings/LaborRulesSection';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';

export default function LocationProfile() {
  const { locationId } = useParams();
  const navigate = useNavigate();
  const [location, setLocation] = useState<any>(null);
  const [allLocations, setAllLocations] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [copyDialogOpen, setCopyDialogOpen] = useState(false);
  const [sourceLocationId, setSourceLocationId] = useState<string>('');
  const [copying, setCopying] = useState(false);

  useEffect(() => {
    if (locationId) {
      fetchLocation();
      fetchAllLocations();
    }
  }, [locationId]);

  const fetchLocation = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('locations')
        .select('*')
        .eq('id', locationId)
        .single();

      if (error) throw error;
      setLocation(data);
    } catch (error: any) {
      console.error('Error fetching location:', error);
      toast.error('Failed to load location');
      navigate('/settings');
    } finally {
      setLoading(false);
    }
  };

  const fetchAllLocations = async () => {
    try {
      const { data, error } = await supabase
        .from('locations')
        .select('id, name')
        .neq('id', locationId)
        .order('name');

      if (error) throw error;
      setAllLocations(data || []);
    } catch (error: any) {
      console.error('Error fetching locations:', error);
    }
  };

  const handleSave = async () => {
    if (!location || !location.name.trim()) {
      toast.error('Please enter a location name');
      return;
    }

    try {
      setSaving(true);
      const { error } = await supabase
        .from('locations')
        .update({
          name: location.name.trim(),
          address: location.address?.trim() || null,
          latitude: location.latitude ? parseFloat(location.latitude) : null,
          longitude: location.longitude ? parseFloat(location.longitude) : null
        })
        .eq('id', location.id);

      if (error) throw error;

      toast.success('Location updated successfully');
      fetchLocation();
    } catch (error: any) {
      console.error('Error updating location:', error);
      toast.error('Failed to update location');
    } finally {
      setSaving(false);
    }
  };

  const handleCopyChecklists = async () => {
    if (!sourceLocationId) {
      toast.error('Please select a source location');
      return;
    }

    try {
      setCopying(true);

      // Fetch checklists from source location
      const { data: sourceChecklists, error: checklistError } = await supabase
        .from('checklists')
        .select(`
          *,
          checklist_items(*),
          checklist_role_tags(*)
        `)
        .eq('location_id', sourceLocationId)
        .eq('is_active', true);

      if (checklistError) throw checklistError;

      if (!sourceChecklists || sourceChecklists.length === 0) {
        toast.error('No checklists found at source location');
        return;
      }

      let copiedCount = 0;

      for (const checklist of sourceChecklists) {
        // Check if a checklist with same title already exists at this location
        const { data: existing } = await supabase
          .from('checklists')
          .select('id')
          .eq('location_id', locationId)
          .eq('title', checklist.title)
          .single();

        if (existing) continue; // Skip if already exists

        // Create new checklist
        const { data: newChecklist, error: createError } = await supabase
          .from('checklists')
          .insert({
            title: checklist.title,
            description: checklist.description,
            frequency: checklist.frequency,
            template_type: checklist.template_type,
            due_by_time: checklist.due_by_time,
            assigned_day_of_week: checklist.assigned_day_of_week,
            visible_days_before_month_end: checklist.visible_days_before_month_end,
            display_order: checklist.display_order,
            location_id: locationId,
            is_active: true,
          })
          .select()
          .single();

        if (createError) {
          console.error('Error creating checklist:', createError);
          continue;
        }

        // Copy checklist items
        if (checklist.checklist_items?.length > 0) {
          const items = checklist.checklist_items.map((item: any) => ({
            checklist_id: newChecklist.id,
            question: item.question,
            item_type: item.item_type,
            order_index: item.order_index,
            is_required: item.is_required,
            options: item.options,
            days_of_week: item.days_of_week,
            reference_image_url: item.reference_image_url,
            reference_link: item.reference_link,
            reference_notes: item.reference_notes,
            reference_video_url: item.reference_video_url,
          }));

          await supabase.from('checklist_items').insert(items);
        }

        // Copy role tags
        if (checklist.checklist_role_tags?.length > 0) {
          const tags = checklist.checklist_role_tags.map((tag: any) => ({
            checklist_id: newChecklist.id,
            role: tag.role,
          }));

          await supabase.from('checklist_role_tags').insert(tags);
        }

        copiedCount++;
      }

      toast.success(`Copied ${copiedCount} checklist template(s)`);
      setCopyDialogOpen(false);
      setSourceLocationId('');
    } catch (error: any) {
      console.error('Error copying checklists:', error);
      toast.error('Failed to copy checklists');
    } finally {
      setCopying(false);
    }
  };

  const handleCopyCode = (code: string) => {
    navigator.clipboard.writeText(code);
    toast.success('Location code copied to clipboard');
  };

  const handleRegenerateCode = async () => {
    if (!confirm('Are you sure you want to generate a new location code? The old code will no longer work.')) {
      return;
    }

    try {
      const { data, error } = await supabase.rpc('generate_location_code');
      if (error) throw error;
      
      const { error: updateError } = await supabase
        .from('locations')
        .update({ location_code: data })
        .eq('id', locationId);

      if (updateError) throw updateError;

      toast.success('New location code generated');
      fetchLocation();
    } catch (error: any) {
      console.error('Error regenerating code:', error);
      toast.error('Failed to regenerate code');
    }
  };

  if (loading) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-64">
          <p className="text-muted-foreground">Loading location...</p>
        </div>
      </Layout>
    );
  }

  if (!location) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-64">
          <p className="text-muted-foreground">Location not found</p>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-start gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate('/settings')} className="mt-1 flex-shrink-0">
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl sm:text-3xl font-bold flex items-center gap-2">
              <MapPin className="h-6 w-6 sm:h-8 sm:w-8 text-primary flex-shrink-0" />
              <span className="truncate">{location.name}</span>
            </h1>
            <p className="text-sm text-muted-foreground">Manage location details and settings</p>
          </div>
        </div>

        {/* Map - full width on mobile */}
        {location.latitude && location.longitude && (
          <div className="w-full h-40 sm:h-48 rounded-lg overflow-hidden border shadow-sm">
            <LocationMap 
              lat={parseFloat(location.latitude)} 
              lng={parseFloat(location.longitude)}
              locationName={location.name}
            />
          </div>
        )}

        <div className="grid gap-6">
          {/* Location Information */}
          <Card>
            <CardHeader>
              <CardTitle>Location Information</CardTitle>
              <CardDescription>Basic details about this location</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="location-name">Location Name</Label>
                <Input
                  id="location-name"
                  value={location.name}
                  onChange={(e) => setLocation({...location, name: e.target.value})}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="location-address">Address</Label>
                <Textarea
                  id="location-address"
                  placeholder="123 Main St, City, State ZIP"
                  value={location.address || ''}
                  onChange={(e) => setLocation({...location, address: e.target.value})}
                />
              </div>
              {location.location_code && (
                <div className="pt-4 border-t space-y-3">
                  <Label>Location Code</Label>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <code className="text-sm bg-muted px-3 py-2 rounded font-mono">
                      {location.location_code}
                    </code>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleCopyCode(location.location_code)}
                      >
                        <Copy className="h-4 w-4 mr-2" />
                        Copy
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleRegenerateCode}
                      >
                        <RefreshCw className="h-4 w-4 mr-2" />
                        Regenerate
                      </Button>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Share this code with new employees to allow them to sign up for this location
                  </p>
                </div>
              )}
              <Button onClick={handleSave} disabled={saving}>
                {saving ? 'Saving...' : 'Save Changes'}
              </Button>
            </CardContent>
          </Card>

          {/* Location Settings (hours and blackout dates) */}
          <LocationSettingsSection locationId={locationId} />

          {/* Copy Checklists */}
          <Card>
            <CardHeader>
              <CardTitle>Copy Checklists</CardTitle>
              <CardDescription>Copy checklist templates from another location</CardDescription>
            </CardHeader>
            <CardContent>
              <Dialog open={copyDialogOpen} onOpenChange={setCopyDialogOpen}>
                <DialogTrigger asChild>
                  <Button variant="outline">
                    <ClipboardCopy className="h-4 w-4 mr-2" />
                    Copy from Another Location
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Copy Checklist Templates</DialogTitle>
                    <DialogDescription>
                      Select a location to copy all checklist templates from. Existing checklists with the same name will be skipped.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4 py-4">
                    <div className="space-y-2">
                      <Label>Source Location</Label>
                      <Select value={sourceLocationId} onValueChange={setSourceLocationId}>
                        <SelectTrigger>
                          <SelectValue placeholder="Select a location" />
                        </SelectTrigger>
                        <SelectContent>
                          {allLocations.map((loc) => (
                            <SelectItem key={loc.id} value={loc.id}>
                              {loc.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setCopyDialogOpen(false)}>
                      Cancel
                    </Button>
                    <Button onClick={handleCopyChecklists} disabled={copying || !sourceLocationId}>
                      {copying ? 'Copying...' : 'Copy Checklists'}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </CardContent>
          </Card>

          {/* Labor Rules - only for standard locations */}
          {location.location_type !== 'checklist_only' && (
            <LaborRulesSection locationId={locationId} />
          )}
        </div>
      </div>
    </Layout>
  );
}
