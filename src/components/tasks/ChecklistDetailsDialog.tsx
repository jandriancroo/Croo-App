import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, XCircle } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

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
      // Use local day boundaries to match completion history logic
      const startOfDay = new Date(date);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(date);
      endOfDay.setHours(23, 59, 59, 999);
      const dayOfWeek = date.getDay();
      
      // Get checklist with items
      const { data: checklist } = await supabase
        .from('checklists')
        .select(`
          id,
          title,
          frequency,
          checklist_items (
            id,
            question,
            order_index,
            item_type,
            days_of_week
          )
        `)
        .eq('id', checklistId)
        .single();

      if (!checklist) return null;

      // Filter items by day of week for dynamic checklists
      let filteredItems = checklist.checklist_items;
      if (checklist.frequency === 'dynamic') {
        filteredItems = checklist.checklist_items.filter((item: any) => 
          !item.days_of_week || item.days_of_week.length === 0 || item.days_of_week.includes(dayOfWeek)
        );
      }

      // Get all submissions for this checklist on this date (collaborative model)
      const { data: submissions } = await supabase
        .from('checklist_submissions')
        .select(`
          id,
          submitted_at
        `)
        .eq('checklist_id', checklistId)
        .gte('submitted_at', startOfDay.toISOString())
        .lte('submitted_at', endOfDay.toISOString());

      if (!submissions || submissions.length === 0) {
        // No submissions for this date - all items incomplete
        return {
          ...checklist,
          items: filteredItems
            .map((item: any) => ({ ...item, responses: [], completed: false }))
            .sort((a: any, b: any) => a.order_index - b.order_index),
          submissions: []
        };
      }

      const submissionIds = submissions.map((s: any) => s.id);

      // Get all responses for these submissions with user info
      const { data: responses } = await supabase
        .from('checklist_responses')
        .select(`
          id,
          item_id,
          response_text,
          response_image_url,
          completed_by,
          created_at,
          profiles:completed_by (
            full_name,
            profile_photo_url
          )
        `)
        .in('submission_id', submissionIds);

      // Map responses to items (treat items with any completed response as completed)
      const items = filteredItems.map((item: any) => {
        const itemResponses = (responses || []).filter((r: any) => r.item_id === item.id && r.completed_by);
        
        return {
          ...item,
          responses: itemResponses,
          completed: itemResponses.length > 0
        };
      });

      return {
        ...checklist,
        items: items.sort((a: any, b: any) => a.order_index - b.order_index),
        submissions,
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
            <div className="text-center py-8 text-muted-foreground">Loading...</div>
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
                            <div key={idx} className="text-sm space-y-1">
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
                              {response.profiles && (
                                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                  {response.profiles.profile_photo_url && (
                                    <img 
                                      src={response.profiles.profile_photo_url} 
                                      alt={response.profiles.full_name}
                                      className="w-4 h-4 rounded-full"
                                    />
                                  )}
                                  <span>{response.profiles.full_name}</span>
                                  <span>•</span>
                                  <span>{new Date(response.created_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}</span>
                                </div>
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
