import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Check, Camera, Clock, User } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";

interface CompletedTaskDetailsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  task: any;
}

export function CompletedTaskDetailsDialog({
  open,
  onOpenChange,
  task,
}: CompletedTaskDetailsDialogProps) {
  // Fetch subtasks with completion details
  const { data: subtasks = [] } = useQuery({
    queryKey: ["completed-task-subtasks", task?.id],
    queryFn: async () => {
      if (!task?.id) return [];

      const { data, error } = await supabase
        .from("temporary_task_subtasks")
        .select(
          "*, completed_by_profile:profiles!temporary_task_subtasks_completed_by_fkey(full_name, profile_photo_url)"
        )
        .eq("task_id", task.id)
        .order("order_index");

      if (error) throw error;
      return data || [];
    },
    enabled: open && !!task?.id,
  });

  if (!task) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <div
              className="w-3 h-3 rounded-full"
              style={{ backgroundColor: task.accent_color || "#8B5CF6" }}
            />
            {task.title}
            <Badge variant="secondary" className="ml-auto text-xs">
              Completed
            </Badge>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Description */}
          {task.description && (
            <p className="text-sm text-muted-foreground">{task.description}</p>
          )}

          {/* Completion Info */}
          {task.completed_at && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Clock className="h-4 w-4" />
              <span>
                Completed {format(new Date(task.completed_at), "MMM d, yyyy 'at' h:mm a")}
              </span>
            </div>
          )}

          {/* Completer */}
          {(task.completerName || task.completerPhoto) && (
            <div className="flex items-center gap-2 text-sm">
              <User className="h-4 w-4 text-muted-foreground" />
              <span className="text-muted-foreground">Completed by:</span>
              <div className="flex items-center gap-2">
                {task.completerPhoto && (
                  <img
                    src={task.completerPhoto}
                    alt=""
                    className="h-10 w-10 rounded-full object-cover"
                  />
                )}
                <span className="font-medium">{task.completerName}</span>
              </div>
            </div>
          )}

          {/* Subtasks */}
          {subtasks.length > 0 && (
            <div className="space-y-2">
              <div className="text-sm font-medium">
                Subtasks ({subtasks.filter((s: any) => s.completed_at).length}/{subtasks.length})
              </div>
              <div className="border rounded-lg p-3 space-y-3">
                {subtasks.map((subtask: any) => (
                  <div key={subtask.id} className="space-y-2">
                    <div className="flex items-start gap-3">
                      {subtask.item_type === "photo" ? (
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-2">
                            <Camera className="h-4 w-4 text-muted-foreground" />
                            <p
                              className={`text-sm ${
                                subtask.completed_at ? "line-through text-muted-foreground" : ""
                              }`}
                            >
                              {subtask.title}
                            </p>
                            <Badge variant="outline" className="text-[10px]">
                              Photo
                            </Badge>
                          </div>

                          {subtask.response_image_url && (
                            <div className="relative">
                              <img
                                src={subtask.response_image_url}
                                alt="Completion photo"
                                className="w-full h-32 object-cover rounded-lg border"
                              />
                              {subtask.completed_by_profile && (
                                <p className="text-xs text-muted-foreground mt-1">
                                  by {subtask.completed_by_profile.full_name} ·{" "}
                                  {format(new Date(subtask.completed_at), "h:mm a")}
                                </p>
                              )}
                            </div>
                          )}
                        </div>
                      ) : (
                        <>
                          <div
                            className={`mt-0.5 h-4 w-4 rounded border flex items-center justify-center ${
                              subtask.completed_at
                                ? "bg-primary border-primary text-primary-foreground"
                                : "border-muted-foreground"
                            }`}
                          >
                            {subtask.completed_at && <Check className="h-3 w-3" />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p
                              className={`text-sm ${
                                subtask.completed_at ? "line-through text-muted-foreground" : ""
                              }`}
                            >
                              {subtask.title}
                            </p>
                            {subtask.completed_at && subtask.completed_by_profile && (
                              <p className="text-xs text-muted-foreground">
                                by {subtask.completed_by_profile.full_name} ·{" "}
                                {format(new Date(subtask.completed_at), "h:mm a")}
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
      </DialogContent>
    </Dialog>
  );
}