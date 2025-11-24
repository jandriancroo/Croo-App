import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { MapPin, Plus, Trash2 } from 'lucide-react';
import { useLocation } from '@/hooks/useLocation';

export const LocationsSection = () => {
  const [locations, setLocations] = useState<any[]>([]);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [newLocationName, setNewLocationName] = useState('');
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

  const handleAddLocation = async () => {
    if (!newLocationName.trim()) {
      toast.error('Please enter a location name');
      return;
    }

    try {
      setLoading(true);
      const { error } = await supabase
        .from('locations')
        .insert({ name: newLocationName.trim() });

      if (error) throw error;

      toast.success('Location added successfully');
      setNewLocationName('');
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
          <div className="space-y-2">
            {locations.map((location) => (
              <div
                key={location.id}
                className="flex items-center justify-between p-3 border rounded-lg"
              >
                <div className="flex items-center gap-2">
                  <MapPin className="h-4 w-4 text-muted-foreground" />
                  <span className="font-medium">{location.name}</span>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleDeleteLocation(location.id)}
                  className="text-destructive hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
};
