import { useMemo, useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Pizza, Salad, UtensilsCrossed, Package, Layers, ArrowRightLeft, ClipboardCheck, Link2 } from "lucide-react";
import type { MenuItem, CatalogSection } from "./recipe-catalog/types";
import { getCoreSortPriority, getSizeFromName } from "./recipe-catalog/utils";
import CatalogSectionComponent from "./recipe-catalog/CatalogSection";
import PrepRecipesSection from "./recipe-catalog/PrepRecipesSection";
import IngredientsSection from "./recipe-catalog/IngredientsSection";
import RecipeBuilderDialog from "./RecipeBuilderDialog";
import BulkReassignBar from "./recipe-catalog/BulkReassignBar";
import { usePosMapping } from "./recipe-catalog/usePosMapping";

interface RecipeCatalogProps {
  locationId: string;
}

const RecipeCatalog = ({ locationId }: RecipeCatalogProps) => {
  const navigate = useNavigate();
  const [editBlueprintId, setEditBlueprintId] = useState<string | null>(null);
  const [showBuilderDialog, setShowBuilderDialog] = useState(false);
  const [reassignMode, setReassignMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const posMap = usePosMapping(locationId);

  const { data: blueprints } = useQuery({
    queryKey: ["recipe-catalog-blueprints", locationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("recipe_blueprints" as any)
        .select("id, name, r365_name, category, yield_qty, yield_unit, source, catalog_section")
        .eq("location_id", locationId)
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return (data || []) as unknown as MenuItem[];
    },
  });

  const handleEditRecipe = (blueprintId: string) => {
    setEditBlueprintId(blueprintId);
    setShowBuilderDialog(true);
  };

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const sections = useMemo(() => {
    if (!blueprints) return [];

    const result: CatalogSection[] = [
      { key: "md_pizza", label: '11" Pizzas (MD)', icon: <Pizza className="h-4 w-4" />, bases: [], cores: [], menuItems: [] },
      { key: "lg_pizza", label: '14" Pizzas (LG)', icon: <Pizza className="h-4 w-4" />, bases: [], cores: [], menuItems: [] },
      { key: "half_pizza", label: "Half Pizzas", icon: <Pizza className="h-4 w-4" />, bases: [], cores: [], menuItems: [] },
      { key: "salads", label: "Salads", icon: <Salad className="h-4 w-4" />, bases: [], cores: [], menuItems: [] },
      { key: "sides", label: "Sides & Extras", icon: <UtensilsCrossed className="h-4 w-4" />, bases: [], cores: [], menuItems: [] },
      { key: "catering", label: "Catering", icon: <Package className="h-4 w-4" />, bases: [], cores: [], menuItems: [] },
      { key: "drinks", label: "Drinks", icon: <UtensilsCrossed className="h-4 w-4" />, bases: [], cores: [], menuItems: [] },
      { key: "other", label: "Other", icon: <Layers className="h-4 w-4" />, bases: [], cores: [], menuItems: [] },
    ];

    const sectionMap = new Map(result.map(s => [s.key, s]));

    for (const item of blueprints) {
      const name = item.name;
      const lower = name.toLowerCase();
      const cat = item.category?.toUpperCase() || "";

      // Manual override takes priority
      if (item.catalog_section && sectionMap.has(item.catalog_section as any)) {
        const section = sectionMap.get(item.catalog_section as any)!;
        if (cat === "BASE") section.bases.push(item);
        else if (cat === "CORE") section.cores.push(item);
        else section.menuItems.push(item);
        continue;
      }

      let section: CatalogSection | undefined;

      if (cat === "BASE") {
        if (lower.includes("md pizza")) section = sectionMap.get("md_pizza");
        else if (lower.includes("lg pizza")) section = sectionMap.get("lg_pizza");
        else if (lower.includes("half pizza")) section = sectionMap.get("half_pizza");
        else if (lower.includes("salad")) section = sectionMap.get("salads");
        else if (lower.includes("cheesy bread") || lower.includes("fold") || lower.includes("drizzle")) section = sectionMap.get("sides");
        else section = sectionMap.get("other");
        section?.bases.push(item);
        continue;
      }

      if (cat === "CORE") {
        if (lower.includes("salad")) {
          section = sectionMap.get("salads");
        } else {
          const size = getSizeFromName(name);
          if (size === "LG") section = sectionMap.get("lg_pizza");
          else if (size === "HALF") section = sectionMap.get("half_pizza");
          else section = sectionMap.get("md_pizza");
        }
        section?.cores.push(item);
        continue;
      }

      if (cat === "CATERING") {
        sectionMap.get("catering")?.menuItems.push(item);
        continue;
      }

      if (cat === "MI") {
        if (lower.includes("salad")) section = sectionMap.get("salads");
        else if (lower.includes("half ")) section = sectionMap.get("half_pizza");
        else if (lower.includes("large") || lower.includes("lg ") || lower.includes("14")) section = sectionMap.get("lg_pizza");
        else if (lower.includes("drink") || lower.includes("juice") || lower.includes("water") || lower.includes("lemonade") || lower.includes("tea") || lower.includes("beer") || lower.includes("wine") || lower.includes("bubbles") || lower.includes("orchard") || lower.includes("aranciata") || lower.includes("limonata") || lower.includes("pellegrino") || lower.includes("fountain") || lower.includes("izze")) section = sectionMap.get("drinks");
        else if (lower.includes("cheesy bread") || lower.includes("meatball") || lower.includes("brownie") || lower.includes("cookie") || lower.includes("s'more") || lower.includes("cinnamon") || lower.includes("fold") || lower.includes("sandwich") || lower.includes("garlic & sausage")) section = sectionMap.get("sides");
        else if (lower.includes("catering") || lower.includes("cat -") || lower.includes("boxed lunch")) section = sectionMap.get("catering");
        else section = sectionMap.get("md_pizza");
        section?.menuItems.push(item);
        continue;
      }

      sectionMap.get("other")?.menuItems.push(item);
    }

    for (const s of result) {
      s.cores.sort((a, b) => getCoreSortPriority(a.name) - getCoreSortPriority(b.name));
    }

    return result.filter(s => s.bases.length > 0 || s.cores.length > 0 || s.menuItems.length > 0);
  }, [blueprints]);

  if (!blueprints) {
    return (
      <Card>
        <CardContent className="p-4">
          <p className="text-sm text-muted-foreground">Loading recipes...</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardContent className="p-0">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
            <Layers className="h-4 w-4" />
            <h3 className="font-semibold text-sm">Recipe Catalog</h3>
            <Badge variant="secondary" className="ml-auto text-xs">
              {blueprints.length} recipes
            </Badge>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs gap-1"
              onClick={() => navigate(`/inventory/${locationId}/triage`)}
            >
              <ClipboardCheck className="h-3 w-3" />
              Triage
            </Button>
            <Button
              size="sm"
              variant={reassignMode ? "default" : "ghost"}
              className="h-7 text-xs gap-1"
              onClick={() => {
                setReassignMode(!reassignMode);
                if (reassignMode) setSelectedIds(new Set());
              }}
            >
              <ArrowRightLeft className="h-3 w-3" />
              {reassignMode ? "Cancel" : "Reassign"}
            </Button>
          </div>

          <div className="divide-y divide-border">
            {sections.map((section, i) => (
              <CatalogSectionComponent
                key={section.key}
                section={section}
                defaultOpen={i === 0}
                locationId={locationId}
                onEditRecipe={reassignMode ? undefined : handleEditRecipe}
                reassignMode={reassignMode}
                selectedIds={selectedIds}
                onToggleSelect={toggleSelect}
              />
            ))}

            {!reassignMode && (
              <>
                <PrepRecipesSection locationId={locationId} />
                <IngredientsSection locationId={locationId} />
              </>
            )}
          </div>
        </CardContent>
      </Card>

      {reassignMode && selectedIds.size > 0 && (
        <BulkReassignBar
          selectedIds={selectedIds}
          locationId={locationId}
          onClear={() => setSelectedIds(new Set())}
          onDone={() => {
            setSelectedIds(new Set());
            setReassignMode(false);
          }}
        />
      )}

      <RecipeBuilderDialog
        open={showBuilderDialog}
        onOpenChange={(open) => {
          setShowBuilderDialog(open);
          if (!open) setEditBlueprintId(null);
        }}
        locationId={locationId}
        editBlueprintId={editBlueprintId}
      />
    </>
  );
};

export default RecipeCatalog;
