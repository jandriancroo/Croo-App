import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { GripVertical, Plus, Trash2, Tag } from "lucide-react";
import { toast } from "sonner";

interface Category {
  id: string;
  name: string;
  display_order: number;
}

interface BrandCategoryEditorProps {
  brandId: string;
  categories: Category[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function BrandCategoryEditor({ brandId, categories, open, onOpenChange }: BrandCategoryEditorProps) {
  const queryClient = useQueryClient();
  const [items, setItems] = useState<Category[]>([]);
  const [newName, setNewName] = useState("");
  const [dragIdx, setDragIdx] = useState<number | null>(null);

  // Sync from props when dialog opens
  const handleOpenChange = (o: boolean) => {
    if (o) setItems([...categories].sort((a, b) => a.display_order - b.display_order));
    onOpenChange(o);
  };

  const addMutation = useMutation({
    mutationFn: async (name: string) => {
      const maxOrder = items.length > 0 ? Math.max(...items.map(i => i.display_order)) + 1 : 0;
      const { data, error } = await supabase
        .from("brand_inventory_categories" as any)
        .insert({ brand_id: brandId, name, display_order: maxOrder })
        .select()
        .single();
      if (error) throw error;
      return data as any;
    },
    onSuccess: (data) => {
      setItems(prev => [...prev, { id: data.id, name: data.name, display_order: data.display_order }]);
      setNewName("");
      queryClient.invalidateQueries({ queryKey: ["brand-categories", brandId] });
      toast.success(`Added "${data.name}"`);
    },
    onError: (err: any) => {
      if (err?.message?.includes("23505") || err?.message?.includes("duplicate")) {
        toast.error("Category already exists");
      } else {
        toast.error("Failed to add category");
      }
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("brand_inventory_categories" as any)
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_, id) => {
      setItems(prev => prev.filter(i => i.id !== id));
      queryClient.invalidateQueries({ queryKey: ["brand-categories", brandId] });
      toast.success("Category removed");
    },
    onError: () => toast.error("Failed to remove"),
  });

  const reorderMutation = useMutation({
    mutationFn: async (ordered: Category[]) => {
      const updates = ordered.map((cat, idx) => 
        supabase
          .from("brand_inventory_categories" as any)
          .update({ display_order: idx })
          .eq("id", cat.id)
      );
      await Promise.all(updates);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["brand-categories", brandId] });
    },
  });

  const handleDragStart = (idx: number) => setDragIdx(idx);

  const handleDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    if (dragIdx === null || dragIdx === idx) return;
    const reordered = [...items];
    const [moved] = reordered.splice(dragIdx, 1);
    reordered.splice(idx, 0, moved);
    setItems(reordered);
    setDragIdx(idx);
  };

  const handleDragEnd = () => {
    setDragIdx(null);
    reorderMutation.mutate(items);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-base flex items-center gap-2">
            <Tag className="h-4 w-4" />
            Category Editor
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-1 max-h-[400px] overflow-y-auto">
          {items.map((cat, idx) => (
            <div
              key={cat.id}
              draggable
              onDragStart={() => handleDragStart(idx)}
              onDragOver={(e) => handleDragOver(e, idx)}
              onDragEnd={handleDragEnd}
              className={`flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors ${
                dragIdx === idx ? "bg-primary/10" : "hover:bg-muted/50"
              }`}
            >
              <GripVertical className="h-3.5 w-3.5 text-muted-foreground cursor-grab flex-shrink-0" />
              <span className="flex-1 font-medium">{cat.name}</span>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 text-muted-foreground hover:text-destructive"
                onClick={() => deleteMutation.mutate(cat.id)}
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          ))}
        </div>

        <div className="flex gap-2 pt-2 border-t">
          <Input
            placeholder="New category name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && newName.trim()) {
                addMutation.mutate(newName.trim());
              }
            }}
            className="h-8 text-sm"
          />
          <Button
            size="sm"
            className="h-8 px-3"
            disabled={!newName.trim() || addMutation.isPending}
            onClick={() => addMutation.mutate(newName.trim())}
          >
            <Plus className="h-3.5 w-3.5" />
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
