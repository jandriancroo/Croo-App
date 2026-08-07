import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Loader2, AlertTriangle, Plus, RefreshCw } from 'lucide-react';
import { useLocation as useAppLocation } from '@/hooks/useLocation';
import { useQueryClient } from '@tanstack/react-query';

interface CopyChecklistDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  checklistIds: string[];
  checklistTitles: string[];
}

interface TargetLocation {
  id: string;
  name: string;
  storeNumber?: string | null;
  orgName?: string | null;
  brandName?: string | null;
  existingTitles: string[];
}

export function CopyChecklistDialog({ 
  open, 
  onOpenChange, 
  checklistIds,
  checklistTitles 
}: CopyChecklistDialogProps) {
  const { currentLocation } = useAppLocation();
  const queryClient = useQueryClient();
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
      // Get all locations the user has access to (except current)
      const { data: locations, error: locError } = await supabase
        .from('locations')
        .select('id, name')
        .neq('id', currentLocation?.id)
        .order('name');

      if (locError) throw locError;

      // For each location, check which of the selected checklists already exist
      const locationsWithExisting: TargetLocation[] = await Promise.all(
        (locations || []).map(async (loc) => {
          const { data: existing } = await supabase
            .from('checklists')
            .select('title')
            .eq('location_id', loc.id)
            .in('title', checklistTitles);

          return {
            id: loc.id,
            name: loc.name,
            existingTitles: existing?.map(c => c.title) || []
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
      // Fetch full checklist data for selected checklists
      const { data: sourceChecklists, error: fetchError } = await supabase
        .from('checklists')
        .select(`
          *,
          checklist_items(*),
          checklist_role_tags(*)
        `)
        .in('id', checklistIds);

      if (fetchError) throw fetchError;

      console.log('Source checklists fetched:', sourceChecklists);
      
      // Verify items were fetched
      for (const cl of sourceChecklists || []) {
        console.log(`Checklist "${cl.title}" has ${cl.checklist_items?.length || 0} items`);
        if (!cl.checklist_items || cl.checklist_items.length === 0) {
          // Try fetching items separately if nested query failed
          const { data: items } = await supabase
            .from('checklist_items')
            .select('*')
            .eq('checklist_id', cl.id);
          if (items && items.length > 0) {
            cl.checklist_items = items;
            console.log(`Fetched ${items.length} items separately for "${cl.title}"`);
          }
        }
      }

      let totalCopied = 0;

      for (const targetLocationId of selectedLocationIds) {
        for (const checklist of sourceChecklists || []) {
          // Check if exists at target - delete if so
          const { data: existing } = await supabase
            .from('checklists')
            .select('id')
            .eq('location_id', targetLocationId)
            .eq('title', checklist.title)
            .maybeSingle();

          if (existing) {
            // Deactivate old checklist instead of deleting to preserve history
            await supabase.from('checklists').update({ is_active: false }).eq('id', existing.id);
          }

          // Create new checklist at target
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
              location_id: targetLocationId,
              is_active: true,
            })
            .select()
            .single();

          if (createError) {
            console.error('Error creating checklist:', createError);
            toast.error(`Failed to create "${checklist.title}": ${createError.message}`);
            continue;
          }

          // Copy items
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

            const { error: itemsError } = await supabase.from('checklist_items').insert(items);
            if (itemsError) {
              console.error('Error copying checklist items:', itemsError);
              toast.error(`Failed to copy items for "${checklist.title}": ${itemsError.message}`);
            }
          }

          // Copy role tags
          if (checklist.checklist_role_tags?.length > 0) {
            const tags = checklist.checklist_role_tags.map((tag: any) => ({
              checklist_id: newChecklist.id,
              role: tag.role,
            }));

            const { error: tagsError } = await supabase.from('checklist_role_tags').insert(tags);
            if (tagsError) {
              console.error('Error copying role tags:', tagsError);
            }
          }

          totalCopied++;
        }
      }

      toast.success(`Copied ${totalCopied} checklist(s) to ${selectedLocationIds.length} location(s)`);
      queryClient.invalidateQueries({ queryKey: ['user-checklists'] });
      onOpenChange(false);
      setSelectedLocationIds([]);
    } catch (error: any) {
      console.error('Error copying checklists:', error);
      toast.error(error.message || 'Failed to copy checklists');
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
        checklistTitles.forEach(title => {
          const key = `${loc.name}: ${title}`;
          if (loc.existingTitles.includes(title)) {
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
          <DialogTitle>Copy To Locations</DialogTitle>
          <DialogDescription>
            Push {checklistTitles.length} checklist{checklistTitles.length > 1 ? 's' : ''} to other locations
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : (
          <div className="space-y-4">
            {/* Checklists being copied */}
            <div className="space-y-1">
              <Label className="text-sm text-muted-foreground">Copying:</Label>
              <div className="flex flex-wrap gap-1">
                {checklistTitles.map(title => (
                  <Badge key={title} variant="secondary">{title}</Badge>
                ))}
              </div>
            </div>

            {/* Target locations */}
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
                        {loc.existingTitles.length > 0 && (
                          <div className="text-xs text-muted-foreground">
                            {loc.existingTitles.length} will be replaced
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
