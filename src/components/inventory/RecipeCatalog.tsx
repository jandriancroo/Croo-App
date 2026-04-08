import { useMemo, useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Badge } from "@/components/ui/badge";

import { Pizza, Salad, UtensilsCrossed, Package, Layers, ArrowRightLeft, Link2, Plus, ChevronDown, Shield } from "lucide-react";
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
  readOnly?: boolean;
  brandId?: string;
}

const RecipeCatalog = ({ locationId, readOnly = false, brandId }: RecipeCatalogProps) => {
  
  const [editBlueprintId, setEditBlueprintId] = useState<string | null>(null);
  const [showBuilderDialog, setShowBuilderDialog] = useState(false);
  const [reassignMode, setReassignMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const posMap = usePosMapping(locationId, brandId);

  const { data: blueprints } = useQuery({
    queryKey: ["recipe-catalog-blueprints", locationId],
    queryFn: async () => {
      const { fetchBlueprintsForLocation } = await import("@/utils/resolveBrandId");
      const data = await fetchBlueprintsForLocation(
        locationId,
        "id, name, r365_name, category, yield_qty, yield_unit, source, catalog_section"
      );
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
      { key: "md_pizza", label: '11" Pizzas', icon: <Pizza className="h-4 w-4" />, bases: [], cores: [], menuItems: [] },
      { key: "lg_pizza", label: '14" Pizzas', icon: <Pizza className="h-4 w-4" />, bases: [], cores: [], menuItems: [] },
      { key: "half_pizza", label: "Half Pizzas", icon: <Pizza className="h-4 w-4" />, bases: [], cores: [], menuItems: [] },
      { key: "detroit", label: "Detroit Pizzas", icon: <Pizza className="h-4 w-4" />, bases: [], cores: [], menuItems: [] },
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
        if (lower.includes("detroit")) section = sectionMap.get("detroit");
        else if (lower.includes('11"') || lower.includes("md pizza")) section = sectionMap.get("md_pizza");
        else if (lower.includes('14"') || lower.includes("lg pizza")) section = sectionMap.get("lg_pizza");
        else if (lower.includes("half")) section = sectionMap.get("half_pizza");
        else if (lower.includes("salad")) section = sectionMap.get("salads");
        else if (lower.includes("cheesy bread") || lower.includes("fold") || lower.includes("drizzle")) section = sectionMap.get("sides");
        else section = sectionMap.get("other");
        section?.bases.push(item);
        continue;
      }

      if (cat === "CORE") {
        if (lower.includes("detroit")) {
          section = sectionMap.get("detroit");
        } else if (lower.includes("salad")) {
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
        if (lower.includes("detroit")) section = sectionMap.get("detroit");
        else if (lower.includes("salad")) section = sectionMap.get("salads");
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

  // POS mapping progress
  const totalMIs = useMemo(() => sections.reduce((sum, s) => sum + s.menuItems.length, 0), [sections]);
  const mappedMIs = useMemo(() => sections.reduce((sum, s) => sum + s.menuItems.filter(mi => posMap.mappedBlueprints.has(mi.id)).length, 0), [sections, posMap.mappedBlueprints]);

  if (!blueprints) {
    return (
      <Card>
        <div className="p-4">
          <p className="text-sm text-muted-foreground">Loading recipes...</p>
        </div>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <Collapsible defaultOpen={true}>
          <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
            <CollapsibleTrigger asChild>
              <button className="flex items-center gap-2 text-left hover:bg-muted/30 transition-colors flex-1">
                <Layers className="h-4 w-4" />
                <span className="font-semibold text-sm">Recipe Catalog</span>
                <Badge variant="secondary" className="text-xs tabular-nums">
                  {blueprints.length} recipes
                </Badge>
                {totalMIs > 0 && (
                  <Badge
                    variant={mappedMIs === totalMIs ? "default" : "outline"}
                    className="text-[10px] gap-1 tabular-nums"
                  >
                    <Link2 className="h-3 w-3" />
                    {mappedMIs}/{totalMIs} POS
                  </Badge>
                )}
                <ChevronDown className="h-4 w-4 ml-auto text-muted-foreground transition-transform [[data-state=open]>&]:rotate-180" />
              </button>
            </CollapsibleTrigger>
            {!readOnly && (
              <div className="flex items-center rounded-full border border-border bg-muted/40 p-0.5">
                <button
                  className="flex items-center gap-1 px-3 py-1.5 text-[11px] font-medium rounded-full text-muted-foreground hover:text-foreground hover:bg-background/80 transition-colors"
                  onClick={() => {
                    setEditBlueprintId(null);
                    setShowBuilderDialog(true);
                  }}
                >
                  <Plus className="h-3 w-3" />
                  New
                </button>
                <button
                  className={`flex items-center gap-1 px-3 py-1.5 text-[11px] font-medium rounded-full transition-colors ${
                    reassignMode
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground hover:bg-background/80"
                  }`}
                  onClick={() => {
                    setReassignMode(!reassignMode);
                    if (reassignMode) setSelectedIds(new Set());
                  }}
                >
                  <ArrowRightLeft className="h-3 w-3" />
                  {reassignMode ? "Cancel" : "Reassign"}
                </button>
              </div>
            )}
            {readOnly && (
              <Badge variant="outline" className="text-[10px] shrink-0">
                <Shield className="h-3 w-3 mr-1" />
                Brand managed
              </Badge>
            )}
          </div>
          <CollapsibleContent>
            <div className="divide-y divide-border">
              {sections.map((section, i) => (
                <CatalogSectionComponent
                  key={section.key}
                  section={section}
                  defaultOpen={i === 0}
                  locationId={locationId}
                  onEditRecipe={readOnly || reassignMode ? undefined : handleEditRecipe}
                  reassignMode={reassignMode}
                  selectedIds={selectedIds}
                  onToggleSelect={toggleSelect}
                  posMappings={posMap.mappedBlueprints}
                  posItems={posMap.posItems}
                  onPosLink={posMap.linkBlueprint}
                  onPosUnlink={posMap.unlinkBlueprint}
                  onUpdateMappingMeta={posMap.updateMappingMeta}
                  isPosLinking={posMap.isLinking}
                />
              ))}

              {!reassignMode && (
                <IngredientsSection locationId={locationId} />
              )}
            </div>
          </CollapsibleContent>
        </Collapsible>
      </Card>

      {!reassignMode && <PrepRecipesSection locationId={locationId} />}

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
        brandId={brandId}
      />
    </>
  );
};

export default RecipeCatalog;
