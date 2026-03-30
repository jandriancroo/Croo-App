import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, Clock, Archive, Tag, X } from "lucide-react";
import { toast } from "sonner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const CATEGORIES = [
  "Dough", "Sauce", "Cheese", "Meat", "Veggie", "Condiments", "Desserts",
  "Dry Goods", "Beverages", "Paper Goods", "Cleaning", "Other",
];

interface BrandCatalogBulkBarProps {
  selectedIds: Set<string>;
  brandId: string;
  onClear: () => void;
}

export default function BrandCatalogBulkBar({ selectedIds, brandId, onClear }: BrandCatalogBulkBarProps) {
  const queryClient = useQueryClient();
  const [showCategoryPicker, setShowCategoryPicker] = useState(false);
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

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 animate-in slide-in-from-bottom-4 fade-in">
      <div className="flex items-center gap-1 rounded-full border border-border bg-primary px-1 py-1 shadow-lg">
        <Badge variant="secondary" className="rounded-full px-3 py-1.5 text-xs font-semibold bg-primary-foreground text-primary">
          {count} selected
        </Badge>

        <button
          className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium rounded-full text-primary-foreground hover:bg-primary-foreground/20 transition-colors"
          onClick={() => bulkMutation.mutate({ field: "status", value: "live" })}
        >
          <CheckCircle2 className="h-3.5 w-3.5" />
          Publish
        </button>

        <button
          className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium rounded-full text-primary-foreground hover:bg-primary-foreground/20 transition-colors"
          onClick={() => bulkMutation.mutate({ field: "status", value: "draft" })}
        >
          <Clock className="h-3.5 w-3.5" />
          Draft
        </button>

        <button
          className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium rounded-full text-primary-foreground hover:bg-primary-foreground/20 transition-colors"
          onClick={() => bulkMutation.mutate({ field: "status", value: "archived" })}
        >
          <Archive className="h-3.5 w-3.5" />
          Archive
        </button>

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
                  {CATEGORIES.map(cat => (
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
  );
}
