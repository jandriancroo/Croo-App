import { useMemo, useState, useCallback, Suspense } from "react";
import { lazyWithRetry } from "@/utils/lazyWithRetry";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Badge } from "@/components/ui/badge";

import { Layers, ArrowRightLeft, Link2, Plus, ChevronDown, Shield } from "lucide-react";
import type { MenuItem, CatalogSection } from "./recipe-catalog/types";
import { buildCatalogSections } from "./recipe-catalog/buildCatalogSections";
import { SECTION_ICONS } from "./recipe-catalog/sectionIcons";
import CatalogSectionComponent from "./recipe-catalog/CatalogSection";
import PrepRecipesSection from "./recipe-catalog/PrepRecipesSection";
import IngredientsSection from "./recipe-catalog/IngredientsSection";
const RecipeBuilderDialog = lazyWithRetry(() => import("./RecipeBuilderDialog"));
import BulkReassignBar from "./recipe-catalog/BulkReassignBar";
import { usePosMapping } from "./recipe-catalog/usePosMapping";
import UnmappedPosBanner from "./recipe-catalog/UnmappedPosBanner";


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

  // Brand context: when a brandId prop is provided (e.g. Brand Inventory page),
  // fetch ONLY brand-level blueprints (location_id IS NULL). Local-scoped recipes
  // must never appear on brand pages — see Brand-Centric Scoping rule.
  const brandOnly = !!brandId;

  const { data: blueprints } = useQuery({
    queryKey: ["recipe-catalog-blueprints", locationId, brandOnly ? "brand-only" : "merged"],
    queryFn: async () => {
      const { fetchBlueprintsForLocation } = await import("@/utils/resolveBrandId");
      const data = await fetchBlueprintsForLocation(
        locationId,
        "id, name, r365_name, category, yield_qty, yield_unit, source, catalog_section",
        { brandOnly }
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

  const sections = useMemo<CatalogSection[]>(() => {
    if (!blueprints) return [];
    return buildCatalogSections(blueprints).map(s => ({ ...s, icon: SECTION_ICONS[s.key] }));
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
      <UnmappedPosBanner
        locationId={locationId}
        brandId={brandId}
        mappedBlueprints={posMap.mappedBlueprints}
      />
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
                  brandId={brandId ?? ""}
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

      {showBuilderDialog && (
        <Suspense fallback={null}>
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
        </Suspense>
      )}
    </>
  );
};

export default RecipeCatalog;
