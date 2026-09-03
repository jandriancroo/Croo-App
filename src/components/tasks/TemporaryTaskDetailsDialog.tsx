import { useState, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Check, Clock, User, Users, Camera, Image, Loader2, ExternalLink } from "lucide-react";
import opusLogo from "@/assets/opus-logo.png";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useIsIOS } from "@/hooks/useIsIOS";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { format, formatDistanceToNow } from "date-fns";
import { compressImage, uploadWithRetry } from "@/utils/imageCompression";
import { WriteUpSignatureView } from "@/components/logbook/WriteUpSignatureView";
import { getAlarmIntervalKey, DEFAULT_TIMEZONE } from "@/utils/timezoneUtils";
import { PhotoPickerButton } from "@/components/PhotoPickerButton";

interface TemporaryTaskDetailsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  task: any;
  onComplete: () => void;
}

const ROLE_LABELS: Record<string, string> = {
  super_admin: "Super Admin",
  brand_admin: "Brand Admin",
  org_admin: "Org Admin",
  admin: "Admin",
  manager: "Manager",
  shift_manager: "Shift Manager",
  shift_manager_in_training: "Shift Manager in Training",
  team_member: "Team Member",
};

export function TemporaryTaskDetailsDialog({ 
  open, 
  onOpenChange, 
  task,
  onComplete 
}: TemporaryTaskDetailsDialogProps) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const isIOS = useIsIOS();
  const [isCompleting, setIsCompleting] = useState(false);
  const [uploadingSubtaskId, setUploadingSubtaskId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [activeSubtaskId, setActiveSubtaskId] = useState<string | null>(null);
  const [showWriteUpSignature, setShowWriteUpSignature] = useState(false);

  // Fetch write-up data if this task has a write_up_id
  const { data: writeUpData } = useQuery({
    queryKey: ['write-up-for-task', task?.write_up_id],
    queryFn: async () => {
      if (!task?.write_up_id) return null;
      const { data, error } = await supabase
        .from('employee_writeups')
        .select(`
          id, reason, issue_description, next_steps, photo_url, created_at, signed_at, employee_id, location_id,
          created_by_profile:profiles!employee_writeups_created_by_fkey(full_name)
        `)
        .eq('id', task.write_up_id)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: open && !!task?.write_up_id,
  });

  // Fetch subtasks
  const { data: subtasks = [], refetch: refetchSubtasks } = useQuery({
    queryKey: ['temp-task-subtasks', task?.id],
    queryFn: async () => {
      if (!task?.id) return [];
      
      const { data, error } = await supabase
        .from('temporary_task_subtasks')
        .select('*, completed_by_profile:profiles!temporary_task_subtasks_completed_by_fkey(full_name)')
        .eq('task_id', task.id)
        .order('order_index');

      if (error) throw error;
      return data || [];
    },
    enabled: open && !!task?.id,
  });

  // Fetch assignments
  const { data: assignments = [] } = useQuery({
    queryKey: ['temp-task-assignments', task?.id],
    queryFn: async () => {
      if (!task?.id) return [];
      
      const { data, error } = await supabase
        .from('temporary_task_assignments')
        .select('*, user:profiles(full_name)')
        .eq('task_id', task.id);

      if (error) throw error;
      return data || [];
    },
    enabled: open && !!task?.id,
  });

  const handleToggleSubtask = async (subtaskId: string, completed: boolean) => {
    try {
      const updateData = completed 
        ? { completed_at: new Date().toISOString(), completed_by: user!.id }
        : { completed_at: null, completed_by: null, response_image_url: null };

      const { error } = await supabase
        .from('temporary_task_subtasks')
        .update(updateData)
        .eq('id', subtaskId);

      if (error) throw error;
      
      const { data: refreshedSubtasks } = await refetchSubtasks();
      
      // Auto-complete task when all subtasks are done
      if (completed && refreshedSubtasks && refreshedSubtasks.length > 0) {
        const allComplete = refreshedSubtasks.every((s: any) => s.completed_at);
        if (allComplete) {
          await autoCompleteTask();
        }
      }
    } catch (error) {
      console.error("Error toggling subtask:", error);
      toast.error("Failed to update subtask");
    }
  };

  const autoCompleteTask = async () => {
    try {
      const { error } = await supabase
        .from('temporary_tasks')
        .update({ 
          completed_at: new Date().toISOString(),
          completed_by: user!.id,
          is_active: false
        })
        .eq('id', task.id);

      if (error) throw error;

      toast.success("Task completed!");
      onComplete();
      onOpenChange(false);
    } catch (error) {
      console.error("Error auto-completing task:", error);
    }
  };

  const handlePhotoUpload = async (subtaskId: string, file: File) => {
    setUploadingSubtaskId(subtaskId);
    
    try {
      // Compress image for mobile devices
      const compressedFile = await compressImage(file, 1200, 1200, 0.8);
      
      // Upload with retry logic for flaky Android connections
      const fileExt = 'jpg';
      const fileName = `${task.id}/${subtaskId}/${Date.now()}.${fileExt}`;
      
      const { publicUrl } = await uploadWithRetry(supabase, 'checklist-images', fileName, compressedFile, 3);

      // Update subtask
      const { error: updateError } = await supabase
        .from('temporary_task_subtasks')
        .update({
          response_image_url: publicUrl,
          completed_at: new Date().toISOString(),
          completed_by: user!.id,
        })
        .eq('id', subtaskId);

      if (updateError) throw updateError;

      toast.success("Photo uploaded");
      const { data: refreshedSubtasks } = await refetchSubtasks();
      
      // Auto-complete task when all subtasks are done
      if (refreshedSubtasks && refreshedSubtasks.length > 0) {
        const allComplete = refreshedSubtasks.every((s: any) => s.completed_at);
        if (allComplete) {
          await autoCompleteTask();
        }
      }
    } catch (error) {
      console.error("Error uploading photo:", error);
      toast.error("Failed to upload photo");
    } finally {
      setUploadingSubtaskId(null);
      setActiveSubtaskId(null);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && activeSubtaskId) {
      handlePhotoUpload(activeSubtaskId, file);
    }
    e.target.value = '';
  };

  const triggerFileInput = (subtaskId: string) => {
    setActiveSubtaskId(subtaskId);
    fileInputRef.current?.click();
  };

  const handleCompleteTask = async () => {
    // Check if all subtasks are complete
    const incompleteSubtasks = subtasks.filter((s: any) => !s.completed_at);
    if (incompleteSubtasks.length > 0) {
      toast.error("Please complete all subtasks first");
      return;
    }

    setIsCompleting(true);
    try {
      // For alarm tasks, record completion in alarm_task_completions with null completed_by (represents "Store")
      if (task.task_style === 'alarm') {
        const now = new Date();
        // Use timezone-aware interval key generation (default to PST for all Blaze locations)
        const intervalKey = task.last_triggered_at 
          ? getAlarmIntervalKey(task.last_triggered_at, DEFAULT_TIMEZONE)
          : getAlarmIntervalKey(now, DEFAULT_TIMEZONE);

        const { error } = await supabase
          .from('alarm_task_completions')
          .insert({
            task_id: task.id,
            interval_key: intervalKey,
            completed_by: null, // null = "Store" completion
          });

        if (error) throw error;
      } else {
        // Standard task - mark as completed with user
        const { error } = await supabase
          .from('temporary_tasks')
          .update({ 
            completed_at: new Date().toISOString(),
            completed_by: user!.id,
            is_active: false
          })
          .eq('id', task.id);

        if (error) throw error;
      }

      toast.success("Task completed!");
      onComplete();
      onOpenChange(false);
    } catch (error) {
      console.error("Error completing task:", error);
      toast.error("Failed to complete task");
    } finally {
      setIsCompleting(false);
    }
  };

  const allSubtasksComplete = subtasks.length === 0 || subtasks.every((s: any) => s.completed_at);
  const completedCount = subtasks.filter((s: any) => s.completed_at).length;

  // Handle write-up signature completion — idempotent close
  const handleWriteUpComplete = async () => {
    const finish = () => {
      queryClient.invalidateQueries({ queryKey: ['employee-writeups'] });
      queryClient.invalidateQueries({ queryKey: ['temporary-tasks'] });
      setShowWriteUpSignature(false);
      onComplete();
      onOpenChange(false);
    };

    // Never re-close an already closed task, never re-open one.
    const { data: current } = await supabase
      .from('temporary_tasks')
      .select('id, completed_at, is_active')
      .eq('id', task.id)
      .maybeSingle();

    if (current?.completed_at) {
      finish();
      return;
    }

    const { error } = await supabase
      .from('temporary_tasks')
      .update({
        completed_at: new Date().toISOString(),
        completed_by: user!.id,
        is_active: false
      })
      .eq('id', task.id)
      .is('completed_at', null);

    if (error) {
      // The signature is already saved; closing the task is a no-op success once signed.
      const { data: signed } = await supabase
        .from('employee_writeups')
        .select('signed_at')
        .eq('id', task.write_up_id)
        .maybeSingle();

      if (signed?.signed_at) {
        finish();
        return;
      }

      toast.error("Failed to complete task");
      return;
    }

    finish();
  };

  // If this is a write-up task, go straight to the single read-and-sign surface.
  if (task?.write_up_id && writeUpData) {
    return (
      <WriteUpSignatureView
        writeUp={writeUpData}
        onComplete={handleWriteUpComplete}
        onCancel={() => onOpenChange(false)}
      />
    );
  }


  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {task?.icon_name === "opus_logo" ? (
              <img src={opusLogo} alt="OPUS" className="h-5 w-auto" />
            ) : (
              <div 
                className="w-3 h-3 rounded-full" 
                style={{ backgroundColor: task?.accent_color || "#8B5CF6" }}
              />
            )}
            {task?.title}
          </DialogTitle>
        </DialogHeader>

        {/* Camera input handled per-subtask via PhotoPickerButton below */}

        <div className="space-y-4 py-2">
          {/* Description */}
          {task?.description && (
            <p className="text-sm text-muted-foreground whitespace-pre-line">{task.description}</p>
          )}

          {/* Assignment Info */}
          <div className="flex flex-wrap gap-2">
            {assignments.map((assignment: any) => (
              <Badge key={assignment.id} variant="secondary" className="gap-1">
                {assignment.user_id ? (
                  <>
                    <User className="h-3 w-3" />
                    {assignment.user?.full_name || "Unknown"}
                  </>
                ) : (
                  <>
                    <Users className="h-3 w-3" />
                    {ROLE_LABELS[assignment.role] || assignment.role}
                  </>
                )}
              </Badge>
            ))}
          </div>

          {/* Expiry Info */}
          {task?.expires_at && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Clock className="h-4 w-4" />
              <span>
                Expires {formatDistanceToNow(new Date(task.expires_at), { addSuffix: true })}
              </span>
            </div>
          )}

          {/* Subtasks */}
          {subtasks.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">
                  Subtasks ({completedCount}/{subtasks.length})
                </span>
                {completedCount > 0 && completedCount < subtasks.length && (
                  <Badge variant="outline" className="text-xs">
                    {Math.round((completedCount / subtasks.length) * 100)}% Complete
                  </Badge>
                )}
              </div>
              <div className="border rounded-lg p-3 space-y-3">
                {subtasks.map((subtask: any) => (
                  <div key={subtask.id} className="space-y-2">
                    <div className="flex items-start gap-3">
                      {subtask.item_type === 'photo' ? (
                        // Photo type subtask
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-2">
                            <Camera className="h-4 w-4 text-muted-foreground" />
                            <p className={`text-sm ${subtask.completed_at ? "line-through text-muted-foreground" : ""}`}>
                              {subtask.title}
                            </p>
                            <Badge variant="outline" className="text-[10px]">Photo</Badge>
                          </div>
                          
                          {subtask.response_image_url ? (
                            // Show uploaded image
                            <div className="relative">
                              <img 
                                src={subtask.response_image_url} 
                                alt="Completion photo"
                                className="w-full h-32 object-cover rounded-lg border"
                              />
                              <Button
                                size="sm"
                                variant="secondary"
                                className="absolute top-2 right-2 h-7 text-xs"
                                onClick={() => handleToggleSubtask(subtask.id, false)}
                              >
                                Remove
                              </Button>
                              {subtask.completed_by_profile && (
                                <p className="text-xs text-muted-foreground mt-1">
                                  by {subtask.completed_by_profile.full_name} · {format(new Date(subtask.completed_at), "h:mm a")}
                                </p>
                              )}
                            </div>
                          ) : (
                            // Show upload button
                            <PhotoPickerButton
                              onFileSelected={(file) => handlePhotoUpload(subtask.id, file)}
                              disabled={uploadingSubtaskId === subtask.id}
                              className="w-full block"
                            >
                              <Button
                                variant="outline"
                                className="w-full gap-2"
                                disabled={uploadingSubtaskId === subtask.id}
                              >
                                {uploadingSubtaskId === subtask.id ? (
                                  <>
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                    Uploading...
                                  </>
                                ) : (
                                  <>
                                    <Camera className="h-4 w-4" />
                                    Take Photo
                                  </>
                                )}
                              </Button>
                            </PhotoPickerButton>
                          )}
                        </div>
                      ) : (
                        // Checkbox type subtask
                        <>
                          <Checkbox
                            checked={!!subtask.completed_at}
                            onCheckedChange={(checked) => handleToggleSubtask(subtask.id, !!checked)}
                            className="mt-0.5"
                          />
                          <div className="flex-1 min-w-0">
                            <p className={`text-sm ${subtask.completed_at ? "line-through text-muted-foreground" : ""}`}>
                              {subtask.title}
                            </p>
                            {subtask.completed_at && subtask.completed_by_profile && (
                              <p className="text-xs text-muted-foreground">
                                by {subtask.completed_by_profile.full_name} · {format(new Date(subtask.completed_at), "h:mm a")}
                              </p>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* OPUS tasks get a GO button instead of Complete */}
        {task?.icon_name === "opus_logo" ? (
          <Button 
            className="w-full gap-2"
            onClick={() => window.open("https://app.opus.so", "_blank")}
          >
            <ExternalLink className="h-4 w-4" />
            GO — Open OPUS
          </Button>
        ) : (
          <Button 
            onClick={handleCompleteTask}
            disabled={!allSubtasksComplete || isCompleting}
            className="w-full gap-2"
          >
            <Check className="h-4 w-4" />
            {isCompleting ? "Completing..." : "Complete Task"}
          </Button>
        )}
      </DialogContent>
    </Dialog>
  );
}
