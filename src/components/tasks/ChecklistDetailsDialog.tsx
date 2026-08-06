import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, XCircle } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getDateInPST } from "@/utils/dateUtils";
import { Skeleton } from "@/components/ui/skeleton";
interface ChecklistDetailsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  checklistId: string;
  date: Date;
}

export function ChecklistDetailsDialog({ open, onOpenChange, checklistId, date }: ChecklistDetailsDialogProps) {
  const { data: checklistDetails, isLoading } = useQuery({
    queryKey: ['checklist-details', checklistId, date],
    queryFn: async () => {
      const dateStr = getDateInPST(date);
      const nextDateStr = getDateInPST(new Date(date.getTime() + 86400000));
      
      // Get checklist with items
      const { data: checklist } = await supabase
        .from('checklists')
        .select(`
          id,
          title,
          checklist_items (
            id,
            question,
            order_index,
            item_type
          )
        `)
        .eq('id', checklistId)
        .single();

      if (!checklist) return null;

      // Get submissions for this date
      const { data: submissions } = await supabase
        .from('checklist_submissions')
        .select(`
          id,
          submitted_by,
          profiles!checklist_submissions_submitted_by_fkey(full_name, profile_photo_url),
          checklist_responses(
            id,
            item_id,
            response_text,
            response_image_url
          )
        `)
        .eq('checklist_id', checklistId)
        .gte('submitted_at', dateStr)
        .lt('submitted_at', nextDateStr);

      // Map responses to items
      const items = checklist.checklist_items.map((item: any) => {
        const responses = submissions?.flatMap((sub: any) => 
          sub.checklist_responses?.filter((r: any) => r.item_id === item.id) || []
        ) || [];
        
        // Item is completed if there's a response with completed_by set
        const completedResponse = responses.find((r: any) => r.completed_by !== null);
        
        return {
          ...item,
          responses,
          completed: !!completedResponse
        };
      });

      return {
        ...checklist,
        items: items.sort((a: any, b: any) => a.order_index - b.order_index),
        submissions
      };
    },
    enabled: open && !!checklistId,
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle>{checklistDetails?.title}</DialogTitle>
        </DialogHeader>
        <ScrollArea className="h-[60vh] pr-4">
          {isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3, 4].map((i) => (
                <Skeleton key={i} className="h-16 rounded-lg" />
              ))}
            </div>
          ) : (
            <div className="space-y-3">
              {checklistDetails?.items.map((item: any, index: number) => (
                <div key={item.id} className="p-3 rounded-lg border space-y-2">
                  <div className="flex items-start gap-2">
                    <div className="flex-shrink-0 mt-0.5">
                      {item.completed ? (
                        <CheckCircle2 className="h-5 w-5 text-green-500" />
                      ) : (
                        <XCircle className="h-5 w-5 text-red-500" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <p className="font-medium text-sm">
                          {index + 1}. {item.question}
                        </p>
                        <Badge variant={item.completed ? "default" : "secondary"} className="flex-shrink-0">
                          {item.item_type}
                        </Badge>
                      </div>
                      
                      {item.responses.length > 0 && (
                        <div className="mt-2 space-y-1">
                          {item.responses.map((response: any, idx: number) => (
                            <div key={idx} className="text-sm">
                              {response.response_text && (
                                <p className="text-muted-foreground bg-muted/50 rounded px-2 py-1">
                                  {response.response_text}
                                </p>
                              )}
                              {response.response_image_url && (
                                <img 
                                  src={response.response_image_url} 
                                  alt="Response"
                                  className="mt-1 max-w-[200px] rounded border"
                                />
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                      
                      {!item.completed && (
                        <p className="text-xs text-muted-foreground mt-1">No response</p>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
