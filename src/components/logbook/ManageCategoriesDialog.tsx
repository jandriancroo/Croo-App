import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Plus, Trash2, GripVertical } from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface ManageCategoriesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ManageCategoriesDialog({ open, onOpenChange }: ManageCategoriesDialogProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [newCategoryName, setNewCategoryName] = useState("");

  const { data: categories = [] } = useQuery({
    queryKey: ['logbook-categories-manage'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('logbook_categories')
        .select('*')
        .order('display_order');
      if (error) throw error;
      return data;
    },
    enabled: open,
  });

  const createCategoryMutation = useMutation({
    mutationFn: async (name: string) => {
      const maxOrder = Math.max(...categories.map(c => c.display_order), 0);
      const { error } = await supabase
        .from('logbook_categories')
        .insert({
          name,
          display_order: maxOrder + 1,
          is_active: true,
          alert_enabled: false,
        });
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Category created successfully" });
      queryClient.invalidateQueries({ queryKey: ['logbook-categories-manage'] });
      queryClient.invalidateQueries({ queryKey: ['logbook-categories'] });
      setNewCategoryName("");
    },
    onError: (error: any) => {
      toast({
        title: "Error creating category",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const updateCategoryMutation = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: any }) => {
      const { error } = await supabase
        .from('logbook_categories')
        .update(updates)
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['logbook-categories-manage'] });
      queryClient.invalidateQueries({ queryKey: ['logbook-categories'] });
    },
    onError: (error: any) => {
      toast({
        title: "Error updating category",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const deleteCategoryMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('logbook_categories')
        .delete()
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Category deleted successfully" });
      queryClient.invalidateQueries({ queryKey: ['logbook-categories-manage'] });
      queryClient.invalidateQueries({ queryKey: ['logbook-categories'] });
    },
    onError: (error: any) => {
      toast({
        title: "Error deleting category",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleToggleAlert = (id: string, currentValue: boolean) => {
    updateCategoryMutation.mutate({
      id,
      updates: { alert_enabled: !currentValue },
    });
  };

  const handleToggleActive = (id: string, currentValue: boolean) => {
    updateCategoryMutation.mutate({
      id,
      updates: { is_active: !currentValue },
    });
  };

  const handleCreateCategory = () => {
    if (!newCategoryName.trim()) return;
    createCategoryMutation.mutate(newCategoryName);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Manage Log Book Categories</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Create New Category */}
          <div className="flex gap-2">
            <Input
              placeholder="New category name..."
              value={newCategoryName}
              onChange={(e) => setNewCategoryName(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handleCreateCategory()}
            />
            <Button onClick={handleCreateCategory} disabled={!newCategoryName.trim()}>
              <Plus className="h-4 w-4 mr-2" />
              Add
            </Button>
          </div>

          {/* Categories List */}
          <div className="space-y-2 max-h-[400px] overflow-y-auto">
            {categories.map((category) => (
              <div
                key={category.id}
                className="flex items-center gap-3 p-3 border rounded-lg"
              >
                <GripVertical className="h-4 w-4 text-muted-foreground cursor-move" />
                
                <div className="flex-1">
                  <div className="font-medium">{category.name}</div>
                  <div className="flex items-center gap-2 mt-1">
                    <Badge variant={category.is_active ? "default" : "secondary"}>
                      {category.is_active ? "Active" : "Inactive"}
                    </Badge>
                    {category.alert_enabled && (
                      <Badge variant="outline" className="text-xs">
                        Alerts Enabled
                      </Badge>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-4">
                  <div className="flex flex-col items-end gap-2">
                    <div className="flex items-center gap-2">
                      <Label htmlFor={`alert-${category.id}`} className="text-xs">
                        Dashboard Alert
                      </Label>
                      <Switch
                        id={`alert-${category.id}`}
                        checked={category.alert_enabled}
                        onCheckedChange={() => handleToggleAlert(category.id, category.alert_enabled)}
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <Label htmlFor={`active-${category.id}`} className="text-xs">
                        Active
                      </Label>
                      <Switch
                        id={`active-${category.id}`}
                        checked={category.is_active}
                        onCheckedChange={() => handleToggleActive(category.id, category.is_active)}
                      />
                    </div>
                  </div>

                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => {
                      if (confirm(`Delete "${category.name}"? This will also delete all associated entries.`)) {
                        deleteCategoryMutation.mutate(category.id);
                      }
                    }}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
