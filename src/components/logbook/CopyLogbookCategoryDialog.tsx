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
import { useAuth } from '@/lib/auth';
import { useQueryClient } from '@tanstack/react-query';
import { useUserRole } from '@/hooks/useUserRole';

interface LogbookCategory {
  id: string;
  name: string;
  display_order: number;
  is_active: boolean;
  alert_enabled: boolean;
  push_notification_enabled: boolean;
  logbook_fields?: any[];
}

interface CopyLogbookCategoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  category?: LogbookCategory | null;
  categories?: LogbookCategory[];
  onSuccess?: () => void;
}

interface TargetLocation {
  id: string;
  name: string;
  hasExisting: boolean;
  organizationName?: string;
}

export function CopyLogbookCategoryDialog({ 
  open, 
  onOpenChange, 
  category,
  categories,
  onSuccess
}: CopyLogbookCategoryDialogProps) {
  // Support both single category and multi-category modes
  const allCategories: LogbookCategory[] = categories || (category ? [category] : []);
  const categoryNames = allCategories.map(c => c.name);
  const { currentLocation } = useAppLocation();
  const { user } = useAuth();
  const { role } = useUserRole();
  const queryClient = useQueryClient();
  const [targetLocations, setTargetLocations] = useState<TargetLocation[]>([]);
  const [selectedLocationIds, setSelectedLocationIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [copying, setCopying] = useState(false);

  const isSuperAdmin = role === 'super_admin';

  useEffect(() => {
    if (open && currentLocation?.id && category) {
      fetchTargetLocations();
      setSelectedLocationIds([]);
    }
  }, [open, currentLocation?.id, category?.id]);

  const fetchTargetLocations = async () => {
    if (!category) return;
    
    setLoading(true);
    try {
      let locations: { id: string; name: string; organization_id: string | null; organizations?: { name: string } | null }[] = [];

      if (isSuperAdmin) {
        // Super admin can see ALL locations across all organizations
        const { data, error } = await supabase
          .from('locations')
          .select('id, name, organization_id, organizations(name)')
          .neq('id', currentLocation?.id)
          .order('name');

        if (error) throw error;
        locations = data || [];
      } else {
        // Regular users only see locations in their organization
        const { data: locationData, error: locationError } = await supabase
          .from('locations')
          .select('organization_id')
          .eq('id', currentLocation?.id)
          .single();

        if (locationError) throw locationError;

        if (!locationData?.organization_id) {
          toast.error('Could not determine organization');
          setTargetLocations([]);
          return;
        }

        const { data, error } = await supabase
          .from('locations')
          .select('id, name, organization_id')
          .eq('organization_id', locationData.organization_id)
          .neq('id', currentLocation?.id)
          .order('name');

        if (error) throw error;
        locations = data || [];
      }

      // For each location, check if the category already exists (by name)
      const locationsWithExisting: TargetLocation[] = await Promise.all(
        locations.map(async (loc) => {
          const { data: existing } = await supabase
            .from('logbook_categories')
            .select('id')
            .eq('location_id', loc.id)
            .ilike('name', category.name)
            .maybeSingle();

          return {
            id: loc.id,
            name: loc.name,
            hasExisting: !!existing,
            organizationName: isSuperAdmin ? (loc.organizations as any)?.name : undefined
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
    if (!category || !user) return;
    
    if (selectedLocationIds.length === 0) {
      toast.error('Please select at least one location');
      return;
    }

    setCopying(true);
    try {
      let totalCopied = 0;
      let replaced = 0;

      for (const targetLocationId of selectedLocationIds) {
        // Check if exists at target - delete if so (replace mode)
        const { data: existing } = await supabase
          .from('logbook_categories')
          .select('id')
          .eq('location_id', targetLocationId)
          .ilike('name', category.name)
          .maybeSingle();

        if (existing) {
          // Delete existing category (fields will cascade)
          await supabase.from('logbook_categories').delete().eq('id', existing.id);
          replaced++;
        }

        // Create new category at target
        const { data: newCategory, error: createError } = await supabase
          .from('logbook_categories')
          .insert({
            name: category.name,
            display_order: category.display_order,
            is_active: category.is_active,
            alert_enabled: category.alert_enabled,
            push_notification_enabled: category.push_notification_enabled,
            location_id: targetLocationId,
            created_by: user.id,
          })
          .select()
          .single();

        if (createError) {
          console.error('Error creating category:', createError);
          toast.error(`Failed to copy "${category.name}": ${createError.message}`);
          continue;
        }

        // Copy fields for this category
        if (category.logbook_fields && category.logbook_fields.length > 0) {
          const fieldsToInsert = category.logbook_fields.map((field: any) => ({
            category_id: newCategory.id,
            field_name: field.field_name,
            field_type: field.field_type,
            is_required: field.is_required,
            display_order: field.display_order,
            options: field.options || null,
          }));

          const { error: fieldsError } = await supabase
            .from('logbook_fields')
            .insert(fieldsToInsert);

          if (fieldsError) {
            console.error('Error copying fields:', fieldsError);
          }
        }

        totalCopied++;
      }

      const message = replaced > 0 
        ? `Copied "${category.name}" to ${totalCopied} location(s) (${replaced} replaced)`
        : `Copied "${category.name}" to ${totalCopied} location(s)`;
      
      toast.success(message);
      queryClient.invalidateQueries({ queryKey: ['logbook-categories'] });
      onOpenChange(false);
      setSelectedLocationIds([]);
      onSuccess?.();
    } catch (error: any) {
      console.error('Error copying category:', error);
      toast.error(error.message || 'Failed to copy category');
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

  const willReplace = targetLocations.filter(loc => 
    selectedLocationIds.includes(loc.id) && loc.hasExisting
  );
  const willCreate = targetLocations.filter(loc => 
    selectedLocationIds.includes(loc.id) && !loc.hasExisting
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Copy Category to Other Locations</DialogTitle>
          <DialogDescription>
            Copy "{category?.name}" and its fields to other locations
            {!isSuperAdmin && ' in your organization'}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : (
          <div className="space-y-4">
            {/* Category being copied */}
            <div className="space-y-1">
              <Label className="text-sm text-muted-foreground">Copying:</Label>
              <div className="flex flex-wrap gap-1">
                <Badge variant="secondary">{category?.name}</Badge>
                <Badge variant="outline">{category?.logbook_fields?.length || 0} fields</Badge>
              </div>
            </div>

            {/* Target locations */}
            <div className="space-y-2">
              <Label>Select target locations:</Label>
              <div className="border rounded-lg max-h-48 overflow-y-auto">
                {targetLocations.length === 0 ? (
                  <p className="text-sm text-muted-foreground p-3">No other locations available in your organization</p>
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
                        {isSuperAdmin && loc.organizationName && (
                          <div className="text-xs text-muted-foreground">
                            {loc.organizationName}
                          </div>
                        )}
                        {loc.hasExisting && (
                          <div className="text-xs text-amber-600">
                            Existing category will be replaced
                          </div>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Preview of changes */}
            {selectedLocationIds.length > 0 && (
              <div className="space-y-2 pt-2 border-t">
                {willReplace.length > 0 && (
                  <div className="space-y-1">
                    <div className="flex items-center gap-1 text-sm text-amber-600">
                      <RefreshCw className="h-3 w-3" />
                      <span>Will be replaced ({willReplace.length}):</span>
                    </div>
                    <div className="text-xs text-muted-foreground pl-4">
                      {willReplace.map(loc => loc.name).join(', ')}
                    </div>
                  </div>
                )}
                {willCreate.length > 0 && (
                  <div className="space-y-1">
                    <div className="flex items-center gap-1 text-sm text-green-600">
                      <Plus className="h-3 w-3" />
                      <span>Will be created ({willCreate.length}):</span>
                    </div>
                    <div className="text-xs text-muted-foreground pl-4">
                      {willCreate.map(loc => loc.name).join(', ')}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button 
            onClick={handleCopy} 
            disabled={copying || selectedLocationIds.length === 0}
          >
            {copying ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Copying...
              </>
            ) : (
              `Copy to ${selectedLocationIds.length} Location${selectedLocationIds.length !== 1 ? 's' : ''}`
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
