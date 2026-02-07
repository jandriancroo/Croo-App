import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Plus } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { useUserRole } from "@/hooks/useUserRole";
import { useLocation as useAppLocation } from "@/hooks/useLocation";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, DragEndEvent } from '@dnd-kit/core';
import { arrayMove, SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { SortableChecklistItem } from './SortableChecklistItem';
import { CopyChecklistDialog } from './CopyChecklistDialog';
import { TemporaryTasksSection } from './TemporaryTasksSection';
import { supabase } from "@/integrations/supabase/client";
import { TemplateTypeDialog } from "@/components/TemplateTypeDialog";
import { useQuery } from "@tanstack/react-query";
import { getDayOfWeekInTimezone } from '@/utils/dateUtils';
import { useLocationTimezone } from "@/hooks/useLocationTimezone";

interface EditTabContentProps {
  checklists: any[];
  isAdmin: boolean;
  isManager: boolean;
  isDynamic?: boolean;
}

export default function EditTabContent({
  checklists,
  isAdmin,
  isManager,
  isDynamic,
}: EditTabContentProps) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { currentLocation } = useAppLocation();
  const { timezone } = useLocationTimezone();
  const queryClient = useQueryClient();
  const [showTemplateDialog, setShowTemplateDialog] = useState(false);
  const [isReordering, setIsReordering] = useState(false);
  const [copyDialogOpen, setCopyDialogOpen] = useState(false);
  const [copyChecklistIds, setCopyChecklistIds] = useState<string[]>([]);
  const [copyChecklistTitles, setCopyChecklistTitles] = useState<string[]>([]);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor)
  );

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = checklists.findIndex((c: any) => c.id === active.id);
    const newIndex = checklists.findIndex((c: any) => c.id === over.id);
    
    const reorderedChecklists = arrayMove(checklists, oldIndex, newIndex);
    
    const updates = reorderedChecklists.map((checklist: any, index: number) => ({
      id: checklist.id,
      display_order: index,
    }));

    try {
      await Promise.all(
        updates.map(update => 
          supabase
            .from('checklists')
            .update({ display_order: update.display_order })
            .eq('id', update.id)
        )
      );
      
      toast.success("Checklist order updated");
      queryClient.invalidateQueries({ queryKey: ['user-checklists'] });
      queryClient.invalidateQueries({ queryKey: ['checklists'] });
    } catch {
      toast.error("Failed to update order");
    }
  };

  const handleDeactivate = async (checklistId: string) => {
    const { error } = await supabase
      .from('checklists')
      .update({ is_active: false })
      .eq('id', checklistId);

    if (error) {
      toast.error("Failed to deactivate checklist");
      return;
    }

    toast.success("Checklist deactivated");
    queryClient.invalidateQueries({ queryKey: ['user-checklists'] });
  };

  const handleDelete = async (checklistId: string) => {
    const { error } = await supabase
      .from('checklists')
      .delete()
      .eq('id', checklistId);

    if (error) {
      toast.error("Failed to delete checklist");
      return;
    }

    toast.success("Checklist deleted");
    queryClient.invalidateQueries({ queryKey: ['user-checklists'] });
  };

  const handleCopyTo = (checklistId: string, checklistTitle: string) => {
    setCopyChecklistIds([checklistId]);
    setCopyChecklistTitles([checklistTitle]);
    setCopyDialogOpen(true);
  };

  const currentDayIndex = getDayOfWeekInTimezone(timezone);
  const dayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

  return (
    <div className="space-y-6">
      {/* Quick Tasks Section */}
      <TemporaryTasksSection />

      {/* Checklist Templates */}
      <Card>
        <CardHeader className="py-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base font-semibold">Checklist Templates</CardTitle>
            <div className="flex gap-2">
              {isAdmin && checklists.length > 1 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setIsReordering(!isReordering)}
                >
                  {isReordering ? "Done" : "Reorder"}
                </Button>
              )}
              {isAdmin && (
                <Button
                  size="icon"
                  onClick={() => setShowTemplateDialog(true)}
                  title="New Checklist"
                >
                  <Plus className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {checklists.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">No checklist templates available</p>
          ) : (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={checklists.map((c: any) => c.id)}
                strategy={verticalListSortingStrategy}
              >
                <div className="space-y-2">
                  {checklists.map((checklist: any) => {
                    const isDynamicChecklist = checklist.template_type === 'dynamic';
                    return (
                      <SortableChecklistItem
                        key={checklist.id}
                        checklist={checklist}
                        isDynamic={isDynamicChecklist}
                        isReordering={isReordering}
                        isAdmin={isAdmin}
                        currentDay={currentDayIndex}
                        dayNames={dayNames}
                        onNavigate={navigate}
                        onDeactivate={handleDeactivate}
                        onDelete={handleDelete}
                        onCopyTo={handleCopyTo}
                        editMode={true}
                      />
                    );
                  })}
                </div>
              </SortableContext>
            </DndContext>
          )}
        </CardContent>
      </Card>

      <TemplateTypeDialog open={showTemplateDialog} onOpenChange={setShowTemplateDialog} />
      <CopyChecklistDialog
        open={copyDialogOpen}
        onOpenChange={setCopyDialogOpen}
        checklistIds={copyChecklistIds}
        checklistTitles={copyChecklistTitles}
      />
    </div>
  );
}
