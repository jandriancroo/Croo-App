import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { MapPin, Plus, Trash2, Edit, Copy, RefreshCw, Rocket } from 'lucide-react';
import { useLocation } from '@/hooks/useLocation';
import { LocationMap } from './LocationMap';
import { DeployLocationWizard } from './DeployLocationWizard';

export const LocationsSection = () => {
  const [locations, setLocations] = useState<any[]>([]);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [selectedLocation, setSelectedLocation] = useState<any>(null);
  const [newLocationName, setNewLocationName] = useState('');
  const [newLocationAddress, setNewLocationAddress] = useState('');
  const [newLocationLat, setNewLocationLat] = useState('');
  const [newLocationLng, setNewLocationLng] = useState('');
  const [loading, setLoading] = useState(false);
  const { refetchLocations } = useLocation();

  useEffect(() => {
    fetchLocations();
  }, []);

  const fetchLocations = async () => {
    try {
      const { data, error } = await supabase
        .from('locations')
        .select('*')
        .order('created_at', { ascending: true });

      if (error) throw error;
      setLocations(data || []);
    } catch (error) {
      console.error('Error fetching locations:', error);
    }
  };

  const handleCopyCode = (code: string) => {
    navigator.clipboard.writeText(code);
    toast.success('Location code copied to clipboard');
  };

  const handleRegenerateCode = async (locationId: string) => {
    if (!confirm('Are you sure you want to generate a new location code? The old code will no longer work.')) {
      return;
    }

    try {
      setLoading(true);
      
      // Call the generate_location_code function
      const { data, error } = await supabase.rpc('generate_location_code');
      
      if (error) throw error;
      
      // Update the location with the new code
      const { error: updateError } = await supabase
        .from('locations')
        .update({ location_code: data })
        .eq('id', locationId);

      if (updateError) throw updateError;

      toast.success('New location code generated');
      fetchLocations();
    } catch (error: any) {
      console.error('Error regenerating code:', error);
      toast.error('Failed to regenerate code');
    } finally {
      setLoading(false);
    }
  };

  const handleAddLocation = async () => {
    if (!newLocationName.trim()) {
      toast.error('Please enter a location name');
      return;
    }

    try {
      setLoading(true);
      const { error } = await supabase
        .from('locations')
        .insert({ 
          name: newLocationName.trim(),
          address: newLocationAddress.trim() || null,
          latitude: newLocationLat ? parseFloat(newLocationLat) : null,
          longitude: newLocationLng ? parseFloat(newLocationLng) : null
        });

      if (error) throw error;

      toast.success('Location added successfully');
      setNewLocationName('');
      setNewLocationAddress('');
      setNewLocationLat('');
      setNewLocationLng('');
      setAddDialogOpen(false);
      fetchLocations();
      refetchLocations();
    } catch (error: any) {
      console.error('Error adding location:', error);
      toast.error('Failed to add location');
    } finally {
      setLoading(false);
    }
  };

  const handleEditLocation = async () => {
    if (!selectedLocation || !selectedLocation.name.trim()) {
      toast.error('Please enter a location name');
      return;
    }

    try {
      setLoading(true);
      const { error } = await supabase
        .from('locations')
        .update({
          name: selectedLocation.name.trim(),
          address: selectedLocation.address?.trim() || null,
          latitude: selectedLocation.latitude ? parseFloat(selectedLocation.latitude) : null,
          longitude: selectedLocation.longitude ? parseFloat(selectedLocation.longitude) : null
        })
        .eq('id', selectedLocation.id);

      if (error) throw error;

      toast.success('Location updated successfully');
      setEditDialogOpen(false);
      setSelectedLocation(null);
      fetchLocations();
      refetchLocations();
    } catch (error: any) {
      console.error('Error updating location:', error);
      toast.error('Failed to update location');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteLocation = async (locationId: string) => {
    if (!confirm('Are you sure you want to delete this location? This will remove all associated data.')) {
      return;
    }

    try {
      const { error } = await supabase
        .from('locations')
        .delete()
        .eq('id', locationId);

      if (error) throw error;

      toast.success('Location deleted');
      fetchLocations();
      refetchLocations();
    } catch (error: any) {
      console.error('Error deleting location:', error);
      toast.error('Failed to delete location');
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Locations</CardTitle>
            <CardDescription>Manage your company locations</CardDescription>
          </div>
          <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
            <DialogTrigger asChild>
              <Button size="sm" className="gap-2">
                <Plus className="h-4 w-4" />
                Add Location
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add New Location</DialogTitle>
                <DialogDescription>
                  Create a new location for your company
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="location-name">Location Name</Label>
                  <Input
                    id="location-name"
                    placeholder="e.g., Downtown Store"
                    value={newLocationName}
                    onChange={(e) => setNewLocationName(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="location-address">Address (Optional)</Label>
                  <Textarea
                    id="location-address"
                    placeholder="123 Main St, City, State ZIP"
                    value={newLocationAddress}
                    onChange={(e) => setNewLocationAddress(e.target.value)}
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="location-lat">Latitude (Optional)</Label>
                    <Input
                      id="location-lat"
                      type="number"
                      step="0.0001"
                      placeholder="33.7294"
                      value={newLocationLat}
                      onChange={(e) => setNewLocationLat(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="location-lng">Longitude (Optional)</Label>
                    <Input
                      id="location-lng"
                      type="number"
                      step="0.0001"
                      placeholder="-116.9719"
                      value={newLocationLng}
                      onChange={(e) => setNewLocationLng(e.target.value)}
                    />
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setAddDialogOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={handleAddLocation} disabled={loading}>
                  {loading ? 'Adding...' : 'Add Location'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      <CardContent>
        {locations.length === 0 ? (
          <p className="text-sm text-muted-foreground">No locations yet. Add your first location to get started.</p>
        ) : (
          <div className="space-y-4">
            {locations.map((location) => (
              <div
                key={location.id}
                className="border rounded-lg overflow-hidden"
              >
                <div className="p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <MapPin className="h-5 w-5 text-primary" />
                      <h3 className="font-semibold text-lg">{location.name}</h3>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setSelectedLocation(location);
                          setEditDialogOpen(true);
                        }}
                      >
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDeleteLocation(location.id)}
                        className="text-destructive hover:text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                  {location.address && (
                    <p className="text-sm text-muted-foreground pl-7">{location.address}</p>
                  )}
                  {location.location_code && (
                    <div className="pl-7 pt-2 space-y-2">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">Location Code:</span>
                        <code className="text-sm bg-muted px-2 py-1 rounded font-mono">
                          {location.location_code}
                        </code>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleCopyCode(location.location_code)}
                          className="h-7 px-2"
                        >
                          <Copy className="h-3 w-3" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleRegenerateCode(location.id)}
                          className="h-7 px-2"
                        >
                          <RefreshCw className="h-3 w-3" />
                        </Button>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Share this code with new employees to allow them to sign up for this location
                      </p>
                    </div>
                  )}
                  {location.latitude && location.longitude && (
                    <div className="mt-3 h-48 rounded-md overflow-hidden border">
                      <LocationMap 
                        lat={location.latitude} 
                        lng={location.longitude}
                        locationName={location.name}
                      />
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
        
        <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Edit Location</DialogTitle>
              <DialogDescription>
                Update location details and coordinates
              </DialogDescription>
            </DialogHeader>
            {selectedLocation && (
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="edit-location-name">Location Name</Label>
                  <Input
                    id="edit-location-name"
                    value={selectedLocation.name}
                    onChange={(e) => setSelectedLocation({...selectedLocation, name: e.target.value})}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-location-address">Address</Label>
                  <Textarea
                    id="edit-location-address"
                    placeholder="123 Main St, City, State ZIP"
                    value={selectedLocation.address || ''}
                    onChange={(e) => setSelectedLocation({...selectedLocation, address: e.target.value})}
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="edit-location-lat">Latitude</Label>
                    <Input
                      id="edit-location-lat"
                      type="number"
                      step="0.0001"
                      placeholder="33.7294"
                      value={selectedLocation.latitude || ''}
                      onChange={(e) => setSelectedLocation({...selectedLocation, latitude: e.target.value})}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="edit-location-lng">Longitude</Label>
                    <Input
                      id="edit-location-lng"
                      type="number"
                      step="0.0001"
                      placeholder="-116.9719"
                      value={selectedLocation.longitude || ''}
                      onChange={(e) => setSelectedLocation({...selectedLocation, longitude: e.target.value})}
                    />
                  </div>
                </div>
                {selectedLocation.latitude && selectedLocation.longitude && (
                  <div className="h-64 rounded-md overflow-hidden border">
                    <LocationMap 
                      lat={parseFloat(selectedLocation.latitude)} 
                      lng={parseFloat(selectedLocation.longitude)} 
                    />
                  </div>
                )}
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditDialogOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleEditLocation} disabled={loading}>
                {loading ? 'Updating...' : 'Update Location'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
};
