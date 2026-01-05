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

interface CopyShiftTemplatesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  templateIds: string[];
  templateNames: string[];
  onSuccess?: () => void;
}

interface TargetLocation {
  id: string;
  name: string;
  organizationName?: string;
  existingTemplateNames: string[];
}

export function CopyShiftTemplatesDialog({ 
  open, 
  onOpenChange, 
  templateIds,
  templateNames,
  onSuccess
}: CopyShiftTemplatesDialogProps) {
  const { currentLocation } = useAppLocation();
  const { isSuperAdmin } = useUserRole();
  const [targetLocations, setTargetLocations] = useState<TargetLocation[]>([]);
  const [selectedLocationIds, setSelectedLocationIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [copying, setCopying] = useState(false);

  useEffect(() => {
    if (open && currentLocation?.id) {
      fetchTargetLocations();
      setSelectedLocationIds([]);
    }
  }, [open, currentLocation?.id, isSuperAdmin]);

  const fetchTargetLocations = async () => {
    setLoading(true);
    try {
      let locations: { id: string; name: string; organization_id: string | null; organizations?: { name: string } | null }[] = [];

      if (isSuperAdmin) {
        // Super admins can copy to any location across all organizations
        const { data, error } = await supabase
          .from('locations')
          .select('id, name, organization_id, organizations(name)')
          .neq('id', currentLocation?.id)
          .order('name');

        if (error) throw error;
        locations = data || [];
      } else {
        // Regular users: only locations in their organization
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

      // For each location, check which of the selected templates already exist (by name)
      const locationsWithExisting: TargetLocation[] = await Promise.all(
        locations.map(async (loc) => {
          const { data: existing } = await supabase
            .from('shift_templates')
            .select('template_name')
            .eq('location_id', loc.id)
            .in('template_name', templateNames);

          return {
            id: loc.id,
            name: loc.name,
            organizationName: isSuperAdmin ? (loc.organizations as any)?.name : undefined,
            existingTemplateNames: existing?.map(t => t.template_name) || []
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
      // Fetch full template data for selected templates
      const { data: sourceTemplates, error: fetchError } = await supabase
        .from('shift_templates')
        .select('*')
        .in('id', templateIds);

      if (fetchError) throw fetchError;

      let totalCopied = 0;

      for (const targetLocationId of selectedLocationIds) {
        for (const template of sourceTemplates || []) {
          // Check if exists at target - delete if so (replace mode)
          const { data: existing } = await supabase
            .from('shift_templates')
            .select('id')
            .eq('location_id', targetLocationId)
            .eq('template_name', template.template_name)
            .maybeSingle();

          if (existing) {
            await supabase.from('shift_templates').delete().eq('id', existing.id);
          }

          // Create new template at target
          const { error: createError } = await supabase
            .from('shift_templates')
            .insert({
              template_name: template.template_name,
              start_time: template.start_time,
              end_time: template.end_time,
              role: template.role,
              color: template.color,
              position: template.position,
              days_of_week: template.days_of_week,
              allowed_roles: template.allowed_roles,
              location_id: targetLocationId,
            });

          if (createError) {
            console.error('Error creating template:', createError);
            toast.error(`Failed to copy "${template.template_name}": ${createError.message}`);
            continue;
          }

          totalCopied++;
        }
      }

      toast.success(`Copied ${totalCopied} template(s) to ${selectedLocationIds.length} location(s)`);
      onOpenChange(false);
      setSelectedLocationIds([]);
      onSuccess?.();
    } catch (error: any) {
      console.error('Error copying templates:', error);
      toast.error(error.message || 'Failed to copy templates');
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
        templateNames.forEach(name => {
          const key = `${loc.name}: ${name}`;
          if (loc.existingTemplateNames.includes(name)) {
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
          <DialogTitle>Copy Templates to Other Locations</DialogTitle>
          <DialogDescription>
            Copy {templateNames.length} template{templateNames.length > 1 ? 's' : ''} to other locations{isSuperAdmin ? '' : ' in your organization'}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : (
          <div className="space-y-4">
            {/* Templates being copied */}
            <div className="space-y-1">
              <Label className="text-sm text-muted-foreground">Copying:</Label>
              <div className="flex flex-wrap gap-1">
                {templateNames.map(name => (
                  <Badge key={name} variant="secondary">{name}</Badge>
                ))}
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
                        {loc.organizationName && (
                          <div className="text-xs text-muted-foreground">{loc.organizationName}</div>
                        )}
                        {loc.existingTemplateNames.length > 0 && (
                          <div className="text-xs text-amber-600">
                            {loc.existingTemplateNames.length} will be replaced
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
                    <div className="text-xs text-muted-foreground pl-4 max-h-20 overflow-y-auto">
                      {willReplace.slice(0, 5).map(item => (
                        <div key={item}>{item}</div>
                      ))}
                      {willReplace.length > 5 && (
                        <div>...and {willReplace.length - 5} more</div>
                      )}
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
                      {willCreate.length > 5 && (
                        <div>...and {willCreate.length - 5} more</div>
                      )}
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
