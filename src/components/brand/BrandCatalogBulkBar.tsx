import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, Clock, Archive, Tag, X, Grid3X3 } from "lucide-react";
import BrandPanMatrixSheet from "./BrandPanMatrixSheet";
import { toast } from "sonner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface BrandCatalogBulkBarProps {
  selectedIds: Set<string>;
  brandId: string;
  onClear: () => void;
  activeFilter?: string;
  categories?: string[];
}

export default function BrandCatalogBulkBar({ selectedIds, brandId, onClear, activeFilter = 'live', categories = [] }: BrandCatalogBulkBarProps) {
  const queryClient = useQueryClient();
  const [showCategoryPicker, setShowCategoryPicker] = useState(false);
  const [publishCategoryDialog, setPublishCategoryDialog] = useState(false);
  const [publishCategory, setPublishCategory] = useState<string>('');
  const count = selectedIds.size;

  const bulkMutation = useMutation({
    mutationFn: async ({ field, value }: { field: string; value: string }) => {
      const ids = Array.from(selectedIds);
      const { error } = await supabase
        .from("brand_inventory_templates" as any)
        .update({ [field]: value, updated_at: new Date().toISOString() })
        .in("id", ids);
      if (error) throw error;
    },
    onSuccess: (_, { field, value }) => {
      queryClient.invalidateQueries({ queryKey: ["brand-templates", brandId] });
      const label = field === "status" ? value : `category → ${value}`;
      toast.success(`Updated ${count} items: ${label}`);
      onClear();
      setShowCategoryPicker(false);
    },
    onError: (err: any) => {
      toast.error(err.message || "Bulk update failed");
    },
  });

  const publishWithCategory = useMutation({
    mutationFn: async ({ category }: { category: string }) => {
      const ids = Array.from(selectedIds);
      const { error } = await supabase
        .from("brand_inventory_templates" as any)
        .update({ status: 'live', category, updated_at: new Date().toISOString() })
        .in("id", ids);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["brand-templates", brandId] });
      toast.success(`Published ${count} items to Live`);
      onClear();
      setPublishCategoryDialog(false);
      setPublishCategory('');
    },
    onError: (err: any) => {
      toast.error(err.message || "Publish failed");
    },
  });

  const handlePublishClick = () => {
    if (activeFilter === 'draft') {
      // Require category selection before publishing drafts
      setPublishCategoryDialog(true);
    } else {
      bulkMutation.mutate({ field: "status", value: "live" });
    }
  };

  return (
    <>
      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 animate-in slide-in-from-bottom-4 fade-in">
        <div className="flex items-center gap-1 rounded-full border border-border bg-primary px-1 py-1 shadow-lg">
          <Badge variant="secondary" className="rounded-full px-3 py-1.5 text-xs font-semibold bg-primary-foreground text-primary">
            {count} selected
          </Badge>

          {activeFilter !== 'live' && (
            <button
              className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium rounded-full text-primary-foreground hover:bg-primary-foreground/20 transition-colors"
              onClick={handlePublishClick}
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              Publish
            </button>
          )}

          {activeFilter !== 'draft' && (
            <button
              className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium rounded-full text-primary-foreground hover:bg-primary-foreground/20 transition-colors"
              onClick={() => bulkMutation.mutate({ field: "status", value: "draft" })}
            >
              <Clock className="h-3.5 w-3.5" />
              Draft
            </button>
          )}

          {activeFilter !== 'archived' && (
            <button
              className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium rounded-full text-primary-foreground hover:bg-primary-foreground/20 transition-colors"
              onClick={() => bulkMutation.mutate({ field: "status", value: "archived" })}
            >
              <Archive className="h-3.5 w-3.5" />
              Archive
            </button>
          )}

          <div className="relative">
            <button
              className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium rounded-full text-primary-foreground hover:bg-primary-foreground/20 transition-colors"
              onClick={() => setShowCategoryPicker(!showCategoryPicker)}
            >
              <Tag className="h-3.5 w-3.5" />
              Category
            </button>
            {showCategoryPicker && (
              <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2">
                <Select
                  onValueChange={(val) => {
                    bulkMutation.mutate({ field: "category", value: val });
                  }}
                >
                  <SelectTrigger className="w-[160px] h-8 text-xs bg-background">
                    <SelectValue placeholder="Pick category" />
                  </SelectTrigger>
                  <SelectContent>
                    {categories.map(cat => (
                      <SelectItem key={cat} value={cat} className="text-xs">
                        {cat}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          <button
            className="p-1.5 rounded-full text-primary-foreground hover:bg-primary-foreground/20 transition-colors"
            onClick={onClear}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Category selection dialog when publishing drafts */}
      <Dialog open={publishCategoryDialog} onOpenChange={setPublishCategoryDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Assign Category Before Publishing</DialogTitle>
            <DialogDescription>
              Select an official brand category for {count} item{count !== 1 ? 's' : ''} before making them live.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Select value={publishCategory} onValueChange={setPublishCategory}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select a category..." />
              </SelectTrigger>
              <SelectContent>
                {categories.map(cat => (
                  <SelectItem key={cat} value={cat}>
                    {cat}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPublishCategoryDialog(false)}>
              Cancel
            </Button>
            <Button
              disabled={!publishCategory || publishWithCategory.isPending}
              onClick={() => publishWithCategory.mutate({ category: publishCategory })}
            >
              <CheckCircle2 className="h-4 w-4 mr-1.5" />
              Publish to Live
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
