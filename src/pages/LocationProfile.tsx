import { Layout } from '@/components/Layout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { MapPin, ArrowLeft, Copy, RefreshCw } from 'lucide-react';
import { LocationMap } from '@/components/settings/LocationMap';
import { LocationSettingsSection } from '@/components/settings/LocationSettingsSection';
import { LaborRulesSection } from '@/components/settings/LaborRulesSection';

export default function LocationProfile() {
  const { locationId } = useParams();
  const navigate = useNavigate();
  const [location, setLocation] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (locationId) {
      fetchLocation();
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
        <div className="flex items-start gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate('/settings')} className="mt-2">
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="flex-1 flex items-center gap-4">
            <div className="flex-1">
              <h1 className="text-3xl font-bold flex items-center gap-2">
                <MapPin className="h-8 w-8 text-primary" />
                {location.name}
              </h1>
              <p className="text-muted-foreground">Manage location details and settings</p>
              {location.address && (
                <p className="text-sm text-muted-foreground mt-1">{location.address}</p>
              )}
            </div>
            {location.latitude && location.longitude && (
              <div className="w-48 h-32 rounded-lg overflow-hidden border shadow-sm flex-shrink-0">
                <LocationMap 
                  lat={parseFloat(location.latitude)} 
                  lng={parseFloat(location.longitude)}
                  locationName={location.name}
                />
              </div>
            )}
          </div>
        </div>

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
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="location-lat">Latitude</Label>
                  <Input
                    id="location-lat"
                    type="number"
                    step="0.0001"
                    placeholder="33.7294"
                    value={location.latitude || ''}
                    onChange={(e) => setLocation({...location, latitude: e.target.value})}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="location-lng">Longitude</Label>
                  <Input
                    id="location-lng"
                    type="number"
                    step="0.0001"
                    placeholder="-116.9719"
                    value={location.longitude || ''}
                    onChange={(e) => setLocation({...location, longitude: e.target.value})}
                  />
                </div>
              </div>
              {location.latitude && location.longitude && (
                <div className="h-48 rounded-md overflow-hidden border">
                  <LocationMap 
                    lat={parseFloat(location.latitude)} 
                    lng={parseFloat(location.longitude)}
                    locationName={location.name}
                  />
                </div>
              )}
              {location.location_code && (
                <div className="pt-4 border-t space-y-2">
                  <Label>Location Code</Label>
                  <div className="flex items-center gap-2">
                    <code className="text-sm bg-muted px-3 py-2 rounded font-mono flex-1">
                      {location.location_code}
                    </code>
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

          {/* Labor Rules */}
          <LaborRulesSection locationId={locationId} />
        </div>
      </div>
    </Layout>
  );
}
