import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { 
  Trash2, 
  Plus, 
  ClipboardList, 
  AlarmClock, 
  QrCode, 
  Search,
  FileText,
  Pencil
} from "lucide-react";
import { EditTemplateDialog } from "./EditTemplateDialog";
import { supabase } from "@/integrations/supabase/client";
import { useLocation as useAppLocation } from "@/hooks/useLocation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface QuickTaskTemplateLibraryProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectTemplate: (template: any) => void;
}

export function QuickTaskTemplateLibrary({ 
  open, 
  onOpenChange, 
  onSelectTemplate 
}: QuickTaskTemplateLibraryProps) {
  const { currentLocation } = useAppLocation();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [deleteTemplateId, setDeleteTemplateId] = useState<string | null>(null);
  const [editTemplate, setEditTemplate] = useState<any>(null);

  const { data: templates = [], isLoading } = useQuery({
    queryKey: ['quick-task-templates', currentLocation?.id],
    queryFn: async () => {
      if (!currentLocation?.id) return [];
      
      const { data, error } = await supabase
        .from('quick_task_templates')
        .select('*, created_by_profile:profiles!quick_task_templates_created_by_fkey(full_name)')
        .eq('location_id', currentLocation.id)
        .order('name');
      
      if (error) throw error;
      return data || [];
    },
    enabled: open && !!currentLocation?.id,
  });

  const filteredTemplates = templates.filter((t: any) => 
    t.name.toLowerCase().includes(search.toLowerCase()) ||
    t.description?.toLowerCase().includes(search.toLowerCase())
  );

  const handleDelete = async () => {
    if (!deleteTemplateId) return;
    
    try {
      const { error } = await supabase
        .from('quick_task_templates')
        .delete()
        .eq('id', deleteTemplateId);

      if (error) throw error;
      
      toast.success("Template deleted");
      queryClient.invalidateQueries({ queryKey: ['quick-task-templates'] });
    } catch (error) {
      console.error("Error deleting template:", error);
      toast.error("Failed to delete template");
    } finally {
      setDeleteTemplateId(null);
    }
  };

  const getTaskStyleIcon = (style: string, isQr: boolean) => {
    if (isQr) return <QrCode className="h-4 w-4" />;
    if (style === 'alarm') return <AlarmClock className="h-4 w-4" />;
    return <ClipboardList className="h-4 w-4" />;
  };

  const getTaskStyleLabel = (style: string, isQr: boolean) => {
    if (isQr) return 'QR';
    if (style === 'alarm') return 'Alarm';
    return 'Standard';
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Task Templates
            </DialogTitle>
          </DialogHeader>

          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search templates..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10"
            />
          </div>

          <div className="flex-1 overflow-y-auto min-h-0">
            {isLoading ? (
              <p className="text-center text-muted-foreground py-8">Loading...</p>
            ) : filteredTemplates.length === 0 ? (
              <div className="text-center py-8 space-y-2">
                <FileText className="h-12 w-12 mx-auto text-muted-foreground/50" />
                <p className="text-muted-foreground">
                  {search ? "No matching templates" : "No templates saved yet"}
                </p>
                <p className="text-xs text-muted-foreground">
                  Save a task as template to reuse it later
                </p>
              </div>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {filteredTemplates.map((template: any) => (
                  <div
                    key={template.id}
                    className="group flex items-center gap-1.5 rounded-full border border-border/50 bg-card shadow-sm pl-1 pr-1 py-1 cursor-pointer hover:bg-accent/50 transition-colors"
                    style={{ borderLeftWidth: 3, borderLeftColor: template.accent_color }}
                    onClick={() => {
                      onSelectTemplate(template);
                      onOpenChange(false);
                    }}
                  >
                    <span className="flex items-center justify-center h-5 w-5 rounded-full shrink-0" style={{ backgroundColor: `${template.accent_color}20`, color: template.accent_color }}>
                      {getTaskStyleIcon(template.task_style, template.is_qr_triggered)}
                    </span>
                    <span className="text-xs font-medium whitespace-nowrap pr-1">{template.name}</span>
                    {template.subtasks && (template.subtasks as any[]).length > 0 && (
                      <span className="text-[10px] text-muted-foreground shrink-0">{(template.subtasks as any[]).length}✓</span>
                    )}
                    <div className="flex items-center gap-0.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-6 w-6 rounded-full"
                        onClick={() => setEditTemplate(template)}
                        title="Edit template"
                      >
                        <Pencil className="h-3 w-3" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-6 w-6 rounded-full text-destructive hover:text-destructive"
                        onClick={() => setDeleteTemplateId(template.id)}
                        title="Delete template"
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTemplateId} onOpenChange={(open) => !open && setDeleteTemplateId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Template</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this template? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction 
              onClick={handleDelete} 
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <EditTemplateDialog
        open={!!editTemplate}
        onOpenChange={(open) => !open && setEditTemplate(null)}
        template={editTemplate}
      />
    </>
  );
}
