import { useState } from "react";
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
  { value: "md_pizza", label: '11" Pizzas' },
  { value: "lg_pizza", label: '14" Pizzas' },
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
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 animate-in slide-in-from-bottom-4 fade-in">
      <div className="flex items-center gap-1 rounded-full border border-border bg-primary px-1 py-1 shadow-lg">
        <Badge variant="secondary" className="rounded-full px-3 py-1.5 text-xs font-semibold bg-primary-foreground text-primary">
          {selectedIds.size} selected
        </Badge>

        <div className="relative">
          <Select value={targetSection} onValueChange={(v) => setTargetSection(v as SectionType)}>
            <SelectTrigger className="h-7 w-[120px] text-[11px] bg-transparent border-none text-primary-foreground focus:ring-0 focus:ring-offset-0 px-3">
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
        </div>

        {targetSection && (
          <button
            className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium rounded-full text-primary-foreground hover:bg-primary-foreground/20 transition-colors"
            onClick={handleReassign}
            disabled={isSaving}
          >
            {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
            Apply
          </button>
        )}

        <button
          className="p-1.5 rounded-full text-primary-foreground hover:bg-primary-foreground/20 transition-colors"
          onClick={onClear}
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
};

export default BulkReassignBar;
export { SECTION_OPTIONS };
