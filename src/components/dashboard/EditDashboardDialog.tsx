import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Plus, LayoutGrid } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";
import { SalesDataForCubes } from "./DataCube";

// Available dashboard sections
export const DASHBOARD_SECTIONS = [
  { key: 'data-cubes', label: 'Data Cubes', description: 'Sales and metrics at a glance' },
  { key: 'sales-overview', label: 'Sales Overview', description: 'Detailed sales breakdown' },
  { key: 'assigned-tasks', label: 'Assigned Tasks', description: 'Your temporary tasks' },
  { key: 'event-tasks', label: 'Event Tasks', description: 'Daily event cards' },
  { key: 'cash-handling', label: 'Cash Handling', description: 'Drawer and safe counts' },
  { key: 'catering-orders', label: 'Catering Orders', description: 'Today\'s catering pickups' },
  { key: 'checklists', label: 'Checklists', description: 'Daily/weekly/monthly checklists' },
] as const;

export type SectionKey = typeof DASHBOARD_SECTIONS[number]['key'];

export interface SectionConfig {
  key: SectionKey;
  isVisible: boolean;
  displayOrder: number;
}

interface EditDashboardDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  locationId: string;
  existingCubes?: any[];
  existingSections?: SectionConfig[];
  onSave: () => void;
  salesData?: SalesDataForCubes | null;
  hasQuBeyondIntegration?: boolean;
  onAddCube?: () => void;
}

export function EditDashboardDialog({ 
  open, 
  onOpenChange, 
  locationId, 
  existingSections,
  onSave,
  hasQuBeyondIntegration = true,
  onAddCube,
}: EditDashboardDialogProps) {
  const { user } = useAuth();
  const [sections, setSections] = useState<SectionConfig[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Initialize sections when dialog opens
  useEffect(() => {
    if (open) {
      if (existingSections && existingSections.length > 0) {
        setSections(existingSections);
      } else {
        // Default all sections to visible
        setSections(DASHBOARD_SECTIONS.map((s, i) => ({
          key: s.key,
          isVisible: true,
          displayOrder: i,
        })));
      }
    }
  }, [open, existingSections]);

  const toggleSectionVisibility = (key: SectionKey) => {
    setSections(prev => prev.map(s => 
      s.key === key ? { ...s, isVisible: !s.isVisible } : s
    ));
  };

  const handleSave = async () => {
    if (!user?.id || !locationId) return;
    
    setIsSubmitting(true);
    try {
      // Save section preferences
      for (const section of sections) {
        const { error } = await supabase
          .from('user_dashboard_sections')
          .upsert({
            user_id: user.id,
            location_id: locationId,
            section_key: section.key,
            is_visible: section.isVisible,
            display_order: section.displayOrder,
          }, { onConflict: 'user_id,location_id,section_key' });
        
        if (error) throw error;
      }

      toast.success('Dashboard updated');
      onSave();
      onOpenChange(false);
    } catch (error) {
      console.error('Error saving dashboard:', error);
      toast.error('Failed to save dashboard');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Filter sections based on QuBeyond integration
  const availableSections = DASHBOARD_SECTIONS.filter(section => {
    if (!hasQuBeyondIntegration && (section.key === 'data-cubes' || section.key === 'sales-overview')) {
      return false;
    }
    return true;
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Edit Dashboard</DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-4 py-2">
          <p className="text-xs text-muted-foreground">
            Toggle which sections appear on your dashboard
          </p>
          
          {availableSections.map(section => {
            const config = sections.find(s => s.key === section.key);
            const isVisible = config?.isVisible ?? true;
            
            return (
              <div 
                key={section.key}
                className="flex items-center justify-between p-3 rounded-lg border bg-card hover:bg-accent/50 transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm">{section.label}</p>
                  <p className="text-xs text-muted-foreground truncate">{section.description}</p>
                </div>
                <Switch
                  checked={isVisible}
                  onCheckedChange={() => toggleSectionVisibility(section.key)}
                />
              </div>
            );
          })}

          {/* Add Data Cube Button */}
          {hasQuBeyondIntegration && onAddCube && (
            <Button
              variant="outline"
              className="w-full gap-2 border-dashed"
              onClick={() => {
                onOpenChange(false);
                onAddCube();
              }}
            >
              <Plus className="h-4 w-4" />
              Add Data Cube
            </Button>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={isSubmitting}>
            {isSubmitting ? 'Saving...' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}