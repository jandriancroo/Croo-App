import { Layout } from '@/components/Layout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useState, useEffect } from 'react';
import { useParams, useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { MapPin, ArrowLeft, Copy, RefreshCw, Save, Shield } from 'lucide-react';
import { LocationMap } from '@/components/settings/LocationMap';
import { LocationSettingsSection } from '@/components/settings/LocationSettingsSection';
import { LaborRulesSection } from '@/components/settings/LaborRulesSection';
import { IntegrationsSection } from '@/components/settings/IntegrationsSection';
import { useAuth } from '@/lib/auth';
import { useUserRole } from '@/hooks/useUserRole';

export default function LocationProfile() {
  const { locationId } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const routerLocation = useLocation();
  const { user } = useAuth();
  const { isSuperAdmin } = useUserRole();
  const isNew = locationId === 'new';
  const orgId = searchParams.get('org');
  
  const [location, setLocation] = useState<any>(isNew ? { name: '', address: '', location_type: 'standard' } : null);
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);

  // Scroll to hash section on load
  useEffect(() => {
    if (routerLocation.hash && !loading) {
      const elementId = routerLocation.hash.replace('#', '');
      setTimeout(() => {
        const element = document.getElementById(elementId);
        if (element) {
          element.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }, 100);
    }
  }, [routerLocation.hash, loading]);

  useEffect(() => {
    if (locationId && !isNew) {
      fetchLocation();
    }
  }, [locationId, isNew]);

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


  // Geocode address to get coordinates
  const geocodeAddress = async (address: string): Promise<{ lat: number; lng: number } | null> => {
    if (!address.trim()) return null;
    
    try {
      // Try with full address first
      let response = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}&limit=1&countrycodes=us`,
        { headers: { 'User-Agent': 'CrooHQ/1.0' } }
      );
      let data = await response.json();
      
      // If no results, try simplifying the address (remove suite/unit numbers)
      if (!data || data.length === 0) {
        const simplified = address.replace(/\s*(suite|ste|unit|apt|#)\s*\d+\w*/gi, '').trim();
        response = await fetch(
          `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(simplified)}&limit=1&countrycodes=us`,
          { headers: { 'User-Agent': 'CrooHQ/1.0' } }
        );
        data = await response.json();
      }
      
      if (data && data.length > 0) {
        return {
          lat: parseFloat(data[0].lat),
          lng: parseFloat(data[0].lon),
        };
      }
      return null;
    } catch (error) {
      console.error('Geocoding error:', error);
      return null;
    }
  };

  const handleSave = async () => {
    if (!location || !location.name.trim()) {
      toast.error('Please enter a location name');
      return;
    }

    try {
      setSaving(true);
      
      // Geocode address if provided and coordinates not set
      let coordinates = { lat: location.latitude, lng: location.longitude };
      if (location.address?.trim() && (!location.latitude || !location.longitude)) {
        toast.info('Looking up address coordinates...');
        const geocoded = await geocodeAddress(location.address);
        if (geocoded) {
          coordinates = { lat: geocoded.lat, lng: geocoded.lng };
        }
      }
      
      if (isNew) {
        // Generate location code
        const { data: locationCode, error: codeError } = await supabase.rpc('generate_location_code');
        if (codeError) throw codeError;

        // Create new location
        const { data: newLocation, error: createError } = await supabase
          .from('locations')
          .insert({
            name: location.name.trim(),
            address: location.address?.trim() || null,
            latitude: coordinates.lat || null,
            longitude: coordinates.lng || null,
            location_type: location.location_type || 'standard',
            organization_id: orgId || null,
            location_code: locationCode,
            created_by: user?.id,
            store_number: location.store_number?.trim() || null,
          })
          .select()
          .single();

        if (createError) throw createError;

        // Assign current user to the new location
        if (user?.id && newLocation) {
          await supabase.from('user_locations').insert({
            user_id: user.id,
            location_id: newLocation.id,
          });

          // Create default location settings
          await supabase.from('location_settings').insert({
            location_id: newLocation.id,
            timezone: 'America/Los_Angeles',
          });
        }

        toast.success('Location created successfully');
        navigate(`/location/${newLocation.id}`);
      } else {
        const { error } = await supabase
          .from('locations')
          .update({
            name: location.name.trim(),
            address: location.address?.trim() || null,
            latitude: coordinates.lat ? parseFloat(String(coordinates.lat)) : null,
            longitude: coordinates.lng ? parseFloat(String(coordinates.lng)) : null,
            store_number: location.store_number?.trim() || null,
          })
          .eq('id', location.id);

        if (error) throw error;

        toast.success('Location updated successfully');
        fetchLocation();
      }
    } catch (error: any) {
      console.error('Error saving location:', error);
      toast.error(error.message || 'Failed to save location');
    } finally {
      setSaving(false);
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

  if (!location && !isNew) {
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
      <div className="space-y-6 max-w-3xl mx-auto overflow-x-hidden">
        {/* Header */}
        <div className="flex items-start gap-3">
          <Button 
            variant="ghost" 
            size="icon" 
            onClick={() => orgId ? navigate(`/organization/${orgId}`) : navigate('/settings')} 
            className="mt-1 flex-shrink-0"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl sm:text-3xl font-bold flex items-center gap-2">
              <MapPin className="h-6 w-6 sm:h-8 sm:w-8 text-primary flex-shrink-0" />
              <span className="truncate">{isNew ? 'New Location' : location?.name}</span>
            </h1>
            <p className="text-sm text-muted-foreground">
              {isNew ? 'Create a new location' : 'Manage location settings'}
            </p>
          </div>
        </div>

        {/* Map - full width on mobile (only for existing locations with coordinates) */}
        {!isNew && location?.latitude && location?.longitude && (
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
              <CardDescription>
                {isNew ? 'Enter details for the new location' : 'Basic details about this location'}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="location-name">Location Name</Label>
                  <Input
                    id="location-name"
                    value={location?.name || ''}
                    onChange={(e) => setLocation({...location, name: e.target.value})}
                    placeholder="e.g., Downtown Store"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="store-number">Store Number</Label>
                  <Input
                    id="store-number"
                    value={location?.store_number || ''}
                    onChange={(e) => setLocation({...location, store_number: e.target.value})}
                    placeholder="e.g., 1234"
                  />
                  <p className="text-xs text-muted-foreground">
                    Optional franchise store number
                  </p>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="location-address">Address</Label>
                <Textarea
                  id="location-address"
                  placeholder="123 Main St, City, State ZIP"
                  value={location?.address || ''}
                  onChange={(e) => setLocation({...location, address: e.target.value})}
                />
              </div>
              
              {isNew && (
                <div className="space-y-2">
                  <Label htmlFor="location-type">Location Type</Label>
                  <Select 
                    value={location?.location_type || 'standard'} 
                    onValueChange={(value) => setLocation({...location, location_type: value})}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="standard">Standard (Full Features)</SelectItem>
                      <SelectItem value="checklist_only">Checklist Only</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Checklist Only locations have simplified navigation and features
                  </p>
                </div>
              )}
              
              {/* Super Admin Only: Location Type Toggle for existing locations */}
              {!isNew && isSuperAdmin && (
                <div className="pt-4 border-t space-y-3">
                  <div className="flex items-center gap-2">
                    <Shield className="h-4 w-4 text-primary" />
                    <Label className="text-sm font-medium">Full Features Mode</Label>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <p className="text-sm text-muted-foreground">
                        {location?.location_type === 'standard' 
                          ? 'This location has access to all features'
                          : 'This location is limited to checklists only'}
                      </p>
                    </div>
                    <Switch
                      checked={location?.location_type === 'standard'}
                      onCheckedChange={async (checked) => {
                        const newType = checked ? 'standard' : 'checklist_only';
                        try {
                          const { error } = await supabase
                            .from('locations')
                            .update({ location_type: newType })
                            .eq('id', locationId);
                          
                          if (error) throw error;
                          
                          setLocation({ ...location, location_type: newType });
                          toast.success(`Location ${checked ? 'upgraded to full features' : 'set to checklist only'}`);
                        } catch (error: any) {
                          console.error('Error updating location type:', error);
                          toast.error('Failed to update location type');
                        }
                      }}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Super admin only setting
                  </p>
                </div>
              )}
              
              {!isNew && location?.location_code && (
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
                <Save className="h-4 w-4 mr-2" />
                {saving ? 'Saving...' : isNew ? 'Create Location' : 'Save Changes'}
              </Button>
            </CardContent>
          </Card>

          {/* Location Settings (hours and blackout dates) - only for existing locations */}
          {!isNew && <LocationSettingsSection locationId={locationId} />}

          {/* Labor Rules - only for existing standard locations */}
          {!isNew && location?.location_type !== 'checklist_only' && (
            <LaborRulesSection locationId={locationId} />
          )}

          {/* Integrations - at bottom, for all existing locations */}
          {!isNew && (
            <IntegrationsSection locationId={locationId} />
          )}
        </div>
      </div>
    </Layout>
  );
}
