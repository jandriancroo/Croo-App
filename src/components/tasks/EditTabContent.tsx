import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Plus, Zap, ClipboardList, Copy, GraduationCap, UserPlus } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, DragEndEvent } from '@dnd-kit/core';
import { arrayMove, SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { SortableChecklistItem } from './SortableChecklistItem';
import { CopyChecklistDialog } from './CopyChecklistDialog';
import { TemporaryTasksSection } from './TemporaryTasksSection';
import { supabase } from "@/integrations/supabase/client";
import { TemplateTypeDialog } from "@/components/TemplateTypeDialog";
import { AssignTrainingDialog } from "./AssignTrainingDialog";
import { TrainingAssignmentSummary } from "./TrainingAssignmentSummary";
import { getDayOfWeekInTimezone } from '@/utils/dateUtils';
import { useLocationTimezone } from "@/hooks/useLocationTimezone";
import { UnderlineGroup } from "@/components/ui/folder-tabs";
import { isPendingDraft } from "@/utils/checklistVersions";
import { DuplicateChecklistDialog } from "./DuplicateChecklistDialog";


interface EditTabContentProps {
  checklists: any[];
  isAdmin: boolean;
  isManager: boolean;
}

export default function EditTabContent({
  checklists,
  isAdmin,
}: EditTabContentProps) {
  const navigate = useNavigate();
  const { timezone } = useLocationTimezone();
  const queryClient = useQueryClient();
  const [showTemplateDialog, setShowTemplateDialog] = useState(false);
  const [isReordering, setIsReordering] = useState(false);
  const [copyDialogOpen, setCopyDialogOpen] = useState(false);
  const [copyChecklistIds, setCopyChecklistIds] = useState<string[]>([]);
  const [copyChecklistTitles, setCopyChecklistTitles] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState("quick-tasks");
  const [assignChecklist, setAssignChecklist] = useState<{ id: string; title: string } | null>(null);
  const [duplicateChecklist, setDuplicateChecklist] = useState<any | null>(null);
  const [scheduleDraft, setScheduleDraft] = useState<any | null>(null);

  // Live now on a draft: the same one-transaction swap the cron runs.
  const handleLiveNowDraft = async (draft: any) => {
    const { error } = await supabase.rpc('perform_checklist_swap', { _draft_id: draft.id });
    if (error) {
      toast.error(error.message || "Couldn't switch this version on");
      return;
    }
    toast.success('New version is live now');
    queryClient.invalidateQueries({ queryKey: ['user-checklists'] });
  };

  // Pending drafts hang under their live parent instead of sitting in the main list.
  const draftsByParent = new Map<string, any>();
  checklists.forEach((c: any) => {
    if (isPendingDraft(c) && c.replaces_checklist_id) draftsByParent.set(c.replaces_checklist_id, c);
  });

  const visibleChecklists = checklists.filter((c: any) => !isPendingDraft(c));
  const standardChecklists = visibleChecklists.filter((c: any) => c.template_type !== 'training');
  const trainingChecklists = visibleChecklists.filter((c: any) => c.template_type === 'training');

  const handleDiscardDraft = async (draftId: string) => {
    const { error } = await supabase.from('checklists').delete().eq('id', draftId);
    if (error) {
      toast.error("Couldn't discard the draft");
      return;
    }
    toast.success("Draft discarded — nothing changed for your crew");
    queryClient.invalidateQueries({ queryKey: ['user-checklists'] });
  };


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

  const handleToggleActive = async (checklistId: string) => {
    const checklist = checklists.find((c: any) => c.id === checklistId);
    const newState = !(checklist?.is_active ?? true);
    
    const { error } = await supabase
      .from('checklists')
      .update({ is_active: newState })
      .eq('id', checklistId);

    if (error) {
      toast.error(`Failed to ${newState ? 'reactivate' : 'deactivate'} checklist`);
      return;
    }

    toast.success(newState ? "Checklist reactivated" : "Checklist deactivated");
    queryClient.invalidateQueries({ queryKey: ['user-checklists'] });
  };

  const handleDelete = async (checklistId: string) => {
    const attempt = async () => {
      const { error } = await supabase
        .from('checklists')
        .delete()
        .eq('id', checklistId);
      if (error) throw error;
    };

    try {
      try {
        await attempt();
      } catch (err: any) {
        // Retry once on transient Safari/Network "Load failed" / fetch failures
        const msg = String(err?.message || err);
        if (/Load failed|Failed to fetch|NetworkError/i.test(msg)) {
          await new Promise((r) => setTimeout(r, 400));
          await attempt();
        } else {
          throw err;
        }
      }
      toast.success("Checklist deleted");
      queryClient.invalidateQueries({ queryKey: ['user-checklists'] });
    } catch (err: any) {
      console.error('[handleDelete] checklist delete failed', { checklistId, err });
      const detail = err?.message || err?.error_description || 'Unknown error';
      toast.error(`Failed to delete checklist: ${detail}`);
    }
  };

  const handleCopyTo = (checklistId: string, checklistTitle: string) => {
    setCopyChecklistIds([checklistId]);
    setCopyChecklistTitles([checklistTitle]);
    setCopyDialogOpen(true);
  };

  const currentDayIndex = getDayOfWeekInTimezone(timezone);
  const dayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

  const subTabs = [
    { id: "quick-tasks", label: "Quick Tasks", icon: <Zap className="h-3.5 w-3.5" /> },
    { id: "templates", label: "Checklists", icon: <ClipboardList className="h-3.5 w-3.5" /> },
  ];

  return (
    <div className="space-y-4">
      {/* Sub-navigation: Underline tabs */}
      <div className="pl-4">
        <UnderlineGroup items={subTabs} active={activeTab} onSelect={setActiveTab} size="sm" />
      </div>

      {/* Quick Tasks Tab Content */}
      {activeTab === "quick-tasks" && (
        <TemporaryTasksSection />
      )}

      {/* Templates Tab Content */}
      {activeTab === "templates" && (
        <div className="space-y-4">
            {/* Header with actions */}
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold">Checklist Templates</h3>
              <div className="flex gap-2">
                {isAdmin && checklists.length > 0 && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5"
                    onClick={() => {
                      setCopyChecklistIds(checklists.map((c: any) => c.id));
                      setCopyChecklistTitles(checklists.map((c: any) => c.title));
                      setCopyDialogOpen(true);
                    }}
                    title="Copy all checklists to another location"
                  >
                    <Copy className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">Copy All</span>
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

            {/* Checklist list */}
            {standardChecklists.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">No checklist templates available</p>
            ) : (
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
              >
                <SortableContext
                  items={standardChecklists.map((c: any) => c.id)}
                  strategy={verticalListSortingStrategy}
                >
                  <div className="space-y-2">
                    {standardChecklists.map((checklist: any) => {
                      const isDynamicChecklist = checklist.template_type === 'dynamic';
                      const draft = draftsByParent.get(checklist.id);
                      return (
                        <div key={checklist.id} className="space-y-1">
                          <SortableChecklistItem
                            checklist={draft ? { ...checklist, __draft: draft } : checklist}
                            isDynamic={isDynamicChecklist}
                            isReordering={false}
                            isAdmin={isAdmin}
                            currentDay={currentDayIndex}
                            dayNames={dayNames}
                            onNavigate={navigate}
                            onDeactivate={handleToggleActive}
                            onDelete={handleDelete}
                            onCopyTo={handleCopyTo}
                            onDuplicate={setDuplicateChecklist}
                            editMode={true}
                          />
                          {draft && (
                            <div className="pl-6 border-l-2 border-dashed border-border ml-3">
                              <SortableChecklistItem
                                checklist={draft}
                                isDynamic={draft.template_type === 'dynamic'}
                                isReordering={false}
                                isAdmin={isAdmin}
                                currentDay={currentDayIndex}
                                dayNames={dayNames}
                                onNavigate={navigate}
                                onDeactivate={handleToggleActive}
                                onDelete={handleDelete}
                                onScheduleDraft={setScheduleDraft}
                                onLiveNowDraft={handleLiveNowDraft}
                                onDiscardDraft={handleDiscardDraft}
                                editMode={true}
                              />
                            </div>
                          )}
                        </div>
                      );
                    })}

                  </div>
                </SortableContext>
              </DndContext>
            )}

            {/* Training templates divider */}
            {trainingChecklists.length > 0 && (
              <div className="space-y-2 pt-4">
                <div className="flex items-center gap-2">
                  <GraduationCap className="h-3.5 w-3.5 text-muted-foreground" />
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Training Templates
                  </h4>
                  <div className="h-px flex-1 bg-border" />
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Reusable — assign to one team member at a time for a specific date.
                </p>
                <DndContext sensors={sensors} collisionDetection={closestCenter}>
                <SortableContext items={trainingChecklists.map((c: any) => c.id)} strategy={verticalListSortingStrategy}>
                <div className="space-y-2">
                  {trainingChecklists.map((checklist: any) => (
                    <div key={checklist.id} className="flex items-center gap-2">
                      <div className="flex-1 min-w-0">
                        <SortableChecklistItem
                          checklist={checklist}
                          isDynamic={false}
                          isReordering={false}
                          isAdmin={isAdmin}
                          currentDay={currentDayIndex}
                          dayNames={dayNames}
                          onNavigate={navigate}
                          onDeactivate={handleToggleActive}
                          onDelete={handleDelete}
                          onCopyTo={handleCopyTo}
                          onDuplicate={setDuplicateChecklist}
                          editMode={true}
                        />
                        <div className="px-3 pt-1">
                          <TrainingAssignmentSummary checklistId={checklist.id} />
                        </div>
                      </div>
                      {isAdmin && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="gap-1.5 shrink-0"
                          onClick={() => {
                            setAssignChecklist({ id: checklist.id, title: checklist.title });
                          }}
                        >
                          <UserPlus className="h-3.5 w-3.5" />
                          <span className="hidden sm:inline">Assign</span>
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
                </SortableContext>
                </DndContext>
              </div>
            )}
          </div>
        )}

      <TemplateTypeDialog open={showTemplateDialog} onOpenChange={setShowTemplateDialog} />
      <CopyChecklistDialog
        open={copyDialogOpen}
        onOpenChange={setCopyDialogOpen}
        checklistIds={copyChecklistIds}
        checklistTitles={copyChecklistTitles}
      />
      <AssignTrainingDialog
        open={!!assignChecklist}
        onOpenChange={(o) => !o && setAssignChecklist(null)}
        checklistId={assignChecklist?.id ?? null}
        checklistTitle={assignChecklist?.title}
        locationId={trainingChecklists.find((c: any) => c.id === assignChecklist?.id)?.location_id}
      />
      <DuplicateChecklistDialog
        open={!!duplicateChecklist}
        onOpenChange={(o) => !o && setDuplicateChecklist(null)}
        checklist={duplicateChecklist}
      />

    </div>
  );
}
