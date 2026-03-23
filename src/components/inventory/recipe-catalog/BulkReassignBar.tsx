import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Check, ArrowRightLeft, X, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { SectionType } from "./types";

interface BulkReassignBarProps {
  selectedIds: Set<string>;
  onClear: () => void;
  onDone: () => void;
  locationId: string;
}

const SECTION_OPTIONS: { value: SectionType; label: string }[] = [
  { value: "md_pizza", label: '11" Pizzas (MD)' },
  { value: "lg_pizza", label: '14" Pizzas (LG)' },
  { value: "half_pizza", label: "Half Pizzas" },
  { value: "salads", label: "Salads" },
  { value: "sides", label: "Sides & Extras" },
  { value: "catering", label: "Catering" },
  { value: "drinks", label: "Drinks" },
  { value: "other", label: "Other" },
];

const BulkReassignBar = ({ selectedIds, onClear, onDone, locationId }: BulkReassignBarProps) => {
  const [targetSection, setTargetSection] = useState<SectionType | "">("");
  const [isSaving, setIsSaving] = useState(false);
  const queryClient = useQueryClient();

  const handleReassign = async () => {
    if (!targetSection || selectedIds.size === 0) return;
    setIsSaving(true);

    try {
      const ids = Array.from(selectedIds);
      // Batch update in chunks of 50
      for (let i = 0; i < ids.length; i += 50) {
        const chunk = ids.slice(i, i + 50);
        const { error } = await supabase
          .from("recipe_blueprints" as any)
          .update({ catalog_section: targetSection } as any)
          .in("id", chunk);
        if (error) throw error;
      }

      toast.success(`Moved ${ids.length} item${ids.length > 1 ? "s" : ""} to ${SECTION_OPTIONS.find(o => o.value === targetSection)?.label}`);
      queryClient.invalidateQueries({ queryKey: ["recipe-catalog-blueprints", locationId] });
      onDone();
    } catch (err) {
      toast.error("Failed to reassign items");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed bottom-6 left-4 right-4 z-50 flex items-center gap-2 bg-background border border-border rounded-xl shadow-lg px-4 py-3 max-w-lg mx-auto">
      <Badge variant="secondary" className="text-xs flex-shrink-0">
        {selectedIds.size} selected
      </Badge>

      <Select value={targetSection} onValueChange={(v) => setTargetSection(v as SectionType)}>
        <SelectTrigger className="flex-1 h-8 text-xs">
          <SelectValue placeholder="Move to…" />
        </SelectTrigger>
        <SelectContent>
          {SECTION_OPTIONS.map(opt => (
            <SelectItem key={opt.value} value={opt.value} className="text-xs">
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Button
        size="sm"
        disabled={!targetSection || selectedIds.size === 0 || isSaving}
        onClick={handleReassign}
        className="flex-shrink-0"
      >
        {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
      </Button>

      <Button size="sm" variant="ghost" onClick={onClear} className="flex-shrink-0">
        <X className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
};

export default BulkReassignBar;
export { SECTION_OPTIONS };
