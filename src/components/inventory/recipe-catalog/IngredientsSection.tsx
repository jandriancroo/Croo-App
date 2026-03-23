import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { ChevronDown, ChevronRight, Beaker, AlertTriangle } from "lucide-react";

interface IngredientsSectionProps {
  locationId: string;
}

interface IngredientRow {
  id: string;
  source_name: string | null;
  vendor_item_id: string | null;
  vendor_item_name: string | null;
}

const IngredientsSection = ({ locationId }: IngredientsSectionProps) => {
  const [isOpen, setIsOpen] = useState(false);

  // Fetch all blueprint ingredients that are vendor_item type
  const { data: ingredients } = useQuery({
    queryKey: ["catalog-ingredients", locationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("recipe_blueprint_ingredients" as any)
        .select("id, source_name, vendor_item_id, blueprint_id")
        .eq("ingredient_type", "vendor_item")
        .in("blueprint_id", 
          supabase.from("recipe_blueprints" as any)
            .select("id")
            .eq("location_id", locationId)
            .eq("is_active", true) as any
        );
      if (error) throw error;
      return (data || []) as unknown as { id: string; source_name: string | null; vendor_item_id: string | null; blueprint_id: string }[];
    },
  });

  // Fetch vendor item names for mapped ones
  const mappedIds = ingredients?.filter(i => i.vendor_item_id).map(i => i.vendor_item_id!) || [];
  const { data: vendorItems } = useQuery({
    queryKey: ["vendor-items-for-ingredients", mappedIds],
    queryFn: async () => {
      if (mappedIds.length === 0) return [];
      const { data, error } = await supabase
        .from("inventory_items")
        .select("id, name")
        .in("id", mappedIds);
      if (error) throw error;
      return data || [];
    },
    enabled: mappedIds.length > 0,
  });

  if (!ingredients) return null;

  // Deduplicate by source_name + vendor_item_id
  const seen = new Map<string, IngredientRow>();
  const vendorNameMap = new Map(vendorItems?.map(v => [v.id, v.name]) || []);

  for (const ing of ingredients) {
    const key = ing.vendor_item_id || ing.source_name || ing.id;
    if (!seen.has(key)) {
      seen.set(key, {
        id: ing.id,
        source_name: ing.source_name,
        vendor_item_id: ing.vendor_item_id,
        vendor_item_name: ing.vendor_item_id ? vendorNameMap.get(ing.vendor_item_id) || null : null,
      });
    }
  }

  const allIngredients = Array.from(seen.values());
  const unmapped = allIngredients.filter(i => !i.vendor_item_id);
  const mapped = allIngredients.filter(i => i.vendor_item_id);
  const sorted = [...unmapped, ...mapped];

  return (
    <div className="border-t-2 border-dashed border-amber-500/30">
      <button
        type="button"
        className="w-full flex items-center gap-2 px-4 py-3 hover:bg-muted/30 transition-colors text-left"
        onClick={() => setIsOpen(!isOpen)}
      >
        {isOpen ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        )}
        <Beaker className="h-4 w-4 text-amber-600" />
        <span className="font-semibold text-sm">Ingredients</span>
        {unmapped.length > 0 && (
          <Badge variant="destructive" className="text-[10px] px-1.5 py-0">
            {unmapped.length} unmapped
          </Badge>
        )}
        <Badge variant="outline" className="ml-auto text-xs">
          {allIngredients.length}
        </Badge>
      </button>

      {isOpen && (
        <div className="px-2 pb-2 space-y-1">
          {unmapped.length > 0 && (
            <div className="mb-2">
              <p className="text-[10px] uppercase tracking-wider text-amber-600 font-semibold px-2 py-1 flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" />
                Needs Mapping ({unmapped.length})
              </p>
              {unmapped.map(ing => (
                <div key={ing.id} className="flex items-center gap-2 py-1.5 px-2 text-sm bg-amber-500/5 rounded mb-0.5">
                  <span className="truncate flex-1">{ing.source_name || "(unnamed)"}</span>
                  <Badge variant="outline" className="text-[9px] px-1.5 py-0 text-amber-600 border-amber-500/30">
                    unmapped
                  </Badge>
                </div>
              ))}
            </div>
          )}
          {mapped.length > 0 && (
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold px-2 py-1">
                Mapped ({mapped.length})
              </p>
              {mapped.map(ing => (
                <div key={ing.id} className="flex items-center gap-2 py-1.5 px-2 text-sm hover:bg-muted/50 rounded mb-0.5">
                  <span className="truncate flex-1">{ing.vendor_item_name || ing.source_name || "(unnamed)"}</span>
                  <span className="text-[10px] text-muted-foreground truncate max-w-[120px]">
                    {ing.source_name && ing.vendor_item_name && ing.source_name !== ing.vendor_item_name ? `← ${ing.source_name}` : ""}
                  </span>
                </div>
              ))}
            </div>
          )}
          {allIngredients.length === 0 && (
            <p className="text-sm text-muted-foreground px-2 py-4 text-center">No ingredients found</p>
          )}
        </div>
      )}
    </div>
  );
};

export default IngredientsSection;
