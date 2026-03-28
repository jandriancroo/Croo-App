import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Loader2, Plus, RefreshCw } from 'lucide-react';
import { useLocation as useAppLocation } from '@/hooks/useLocation';
import { useUserRole } from '@/hooks/useUserRole';

interface CopyEventCategoriesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categoryIds: string[];
  categoryNames: string[];
  onSuccess?: () => void;
}

interface TargetLocation {
  id: string;
  name: string;
  existingNames: string[];
}

export function CopyEventCategoriesDialog({
  open,
  onOpenChange,
  categoryIds,
  categoryNames,
  onSuccess
}: CopyEventCategoriesDialogProps) {
  const { currentLocation } = useAppLocation();
  const { isSuperAdmin } = useUserRole();
  const [targetLocations, setTargetLocations] = useState<TargetLocation[]>([]);
  const [selectedLocationIds, setSelectedLocationIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [copying, setCopying] = useState(false);

  useEffect(() => {
    if (open && currentLocation?.id) {
      fetchTargetLocations();
    }
  }, [open, currentLocation?.id]);

  const fetchTargetLocations = async () => {
    setLoading(true);
    try {
      let locations: { id: string; name: string }[] = [];

      if (isSuperAdmin) {
        const { data, error } = await supabase
          .from('locations')
          .select('id, name')
          .neq('id', currentLocation?.id)
          .order('name');
        if (error) throw error;
        locations = data || [];
      } else {
        // Get current location's org, then only show locations in same org
        const { data: locationData } = await supabase
          .from('locations')
          .select('organization_id')
          .eq('id', currentLocation?.id)
          .single();

        if (locationData?.organization_id) {
          const { data, error } = await supabase
            .from('locations')
            .select('id, name')
            .eq('organization_id', locationData.organization_id)
            .neq('id', currentLocation?.id)
            .order('name');
          if (error) throw error;
          locations = data || [];
        }
      }

      const locationsWithExisting: TargetLocation[] = await Promise.all(
        (locations || []).map(async (loc) => {
          const { data: existing } = await supabase
            .from('event_categories')
            .select('name')
            .eq('location_id', loc.id)
            .in('name', categoryNames);

          return {
            id: loc.id,
            name: loc.name,
            existingNames: existing?.map(c => c.name) || []
          };
        })
      );

      setTargetLocations(locationsWithExisting);
    } catch (error) {
      console.error('Error fetching locations:', error);
      toast.error('Failed to load locations');
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async () => {
    if (selectedLocationIds.length === 0) {
      toast.error('Please select at least one location');
      return;
    }

    setCopying(true);
    try {
      const { data: sourceCategories, error: fetchError } = await supabase
        .from('event_categories')
        .select('*')
        .in('id', categoryIds);

      if (fetchError) throw fetchError;

      let totalCopied = 0;

      for (const targetLocationId of selectedLocationIds) {
        for (const category of sourceCategories || []) {
          // Check if exists - update if so, create if not
          const { data: existing } = await supabase
            .from('event_categories')
            .select('id')
            .eq('location_id', targetLocationId)
            .eq('name', category.name)
            .maybeSingle();

          if (existing) {
            await supabase
              .from('event_categories')
              .update({ color: category.color })
              .eq('id', existing.id);
          } else {
            await supabase
              .from('event_categories')
              .insert({
                name: category.name,
                color: category.color,
                location_id: targetLocationId,
              });
          }

          totalCopied++;
        }
      }

      toast.success(`Copied ${totalCopied} category(s) to ${selectedLocationIds.length} location(s)`);
      onOpenChange(false);
      setSelectedLocationIds([]);
      onSuccess?.();
    } catch (error: any) {
      console.error('Error copying categories:', error);
      toast.error(error.message || 'Failed to copy categories');
    } finally {
      setCopying(false);
    }
  };

  const toggleLocation = (locationId: string) => {
    setSelectedLocationIds(prev =>
      prev.includes(locationId)
        ? prev.filter(id => id !== locationId)
        : [...prev, locationId]
    );
  };

  const getReplacementInfo = () => {
    const willReplace: string[] = [];
    const willCreate: string[] = [];

    selectedLocationIds.forEach(locId => {
      const loc = targetLocations.find(l => l.id === locId);
      if (loc) {
        categoryNames.forEach(name => {
          const key = `${loc.name}: ${name}`;
          if (loc.existingNames.includes(name)) {
            if (!willReplace.includes(key)) willReplace.push(key);
          } else {
            if (!willCreate.includes(key)) willCreate.push(key);
          }
        });
      }
    });

    return { willReplace, willCreate };
  };

  const { willReplace, willCreate } = getReplacementInfo();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Copy Categories To Locations</DialogTitle>
          <DialogDescription>
            Push {categoryNames.length} event category{categoryNames.length > 1 ? 'ies' : 'y'} to other locations
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-1">
              <Label className="text-sm text-muted-foreground">Copying:</Label>
              <div className="flex flex-wrap gap-1">
                {categoryNames.map(name => (
                  <Badge key={name} variant="secondary">{name}</Badge>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <Label>Select target locations:</Label>
              <div className="border rounded-lg max-h-48 overflow-y-auto">
                {targetLocations.length === 0 ? (
                  <p className="text-sm text-muted-foreground p-3">No other locations available</p>
                ) : (
                  targetLocations.map(loc => (
                    <div
                      key={loc.id}
                      className="flex items-center gap-3 p-3 border-b last:border-b-0 hover:bg-muted/50 cursor-pointer"
                      onClick={() => toggleLocation(loc.id)}
                    >
                      <Checkbox
                        checked={selectedLocationIds.includes(loc.id)}
                        onCheckedChange={() => toggleLocation(loc.id)}
                      />
                      <div className="flex-1">
                        <div className="font-medium">{loc.name}</div>
                        {loc.existingNames.length > 0 && (
                          <div className="text-xs text-muted-foreground">
                            {loc.existingNames.length} will be updated
                          </div>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {selectedLocationIds.length > 0 && (
              <div className="space-y-2 pt-2 border-t">
                {willReplace.length > 0 && (
                  <div className="space-y-1">
                    <div className="flex items-center gap-1 text-sm text-amber-600">
                      <RefreshCw className="h-3 w-3" />
                      <span>Will be updated ({willReplace.length}):</span>
                    </div>
                    <div className="text-xs text-muted-foreground pl-4 max-h-20 overflow-y-auto">
                      {willReplace.slice(0, 5).map(item => (
                        <div key={item}>{item}</div>
                      ))}
                      {willReplace.length > 5 && <div>...and {willReplace.length - 5} more</div>}
                    </div>
                  </div>
                )}
                {willCreate.length > 0 && (
                  <div className="space-y-1">
                    <div className="flex items-center gap-1 text-sm text-green-600">
                      <Plus className="h-3 w-3" />
                      <span>Will be created ({willCreate.length}):</span>
                    </div>
                    <div className="text-xs text-muted-foreground pl-4 max-h-20 overflow-y-auto">
                      {willCreate.slice(0, 5).map(item => (
                        <div key={item}>{item}</div>
                      ))}
                      {willCreate.length > 5 && <div>...and {willCreate.length - 5} more</div>}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleCopy} disabled={copying || selectedLocationIds.length === 0}>
            {copying ? (
              <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Copying...</>
            ) : (
              `Copy to ${selectedLocationIds.length} Location${selectedLocationIds.length !== 1 ? 's' : ''}`
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
