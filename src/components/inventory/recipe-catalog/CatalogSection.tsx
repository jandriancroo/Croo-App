import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { CatalogSection as CatalogSectionType, MenuItem } from "./types";
import type { PosItem } from "./usePosMapping";
import RecipeRow from "./RecipeRow";

interface CatalogSectionProps {
  section: CatalogSectionType;
  defaultOpen?: boolean;
  locationId: string;
  onEditRecipe?: (bomMenuItemId: string) => void;
  reassignMode?: boolean;
  selectedIds?: Set<string>;
  onToggleSelect?: (id: string) => void;
  // POS mapping props
  posMappings?: Map<string, { groupId: string; posItems: string[]; mappingType?: string; reconciliationGroup?: string | null }>;
  posItems?: PosItem[];
  onPosLink?: (blueprintId: string, blueprintName: string, posItemNames: string[], mappingType?: string, reconciliationGroup?: string | null) => void;
  onPosUnlink?: (blueprintId: string) => void;
  onUpdateMappingMeta?: (blueprintId: string, mappingType: string, reconciliationGroup: string | null) => void;
  isPosLinking?: boolean;
}

const SelectableRow = ({ item, selected, onToggle }: { item: MenuItem; selected: boolean; onToggle: (id: string) => void }) => {
  const displayName = item.name || item.r365_name || "";
  return (
    <button
      type="button"
      className="w-full flex items-center gap-2 py-2 px-2 text-sm hover:bg-muted/50 transition-colors text-left"
      onClick={() => onToggle(item.id)}
    >
      <Checkbox checked={selected} className="flex-shrink-0" />
      <span className="truncate flex-1 font-medium">{displayName}</span>
      <Badge variant="outline" className="text-[9px] px-1.5 py-0 flex-shrink-0 uppercase tracking-wider">
        {item.category || ""}
      </Badge>
    </button>
  );
};

const CatalogSectionComponent = ({
  section, defaultOpen = false, locationId, onEditRecipe,
  reassignMode, selectedIds, onToggleSelect,
  posMappings, posItems, onPosLink, onPosUnlink, onUpdateMappingMeta, isPosLinking,
}: CatalogSectionProps) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const itemCount = section.bases.length + section.cores.length + section.menuItems.length;
  const allItems = [...section.bases, ...section.cores, ...section.menuItems];

  // Count mapped items (MI + CORE + BASE) in this section
  const allMappableItems = [...section.menuItems, ...section.cores, ...section.bases];
  const mappedCount = posMappings
    ? allMappableItems.filter(item => posMappings.has(item.id)).length
    : 0;
  const mappableTotal = allMappableItems.length;

  return (
    <div>
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
        {section.icon}
        <span className="font-semibold text-sm">{section.label}</span>
        {posMappings && mappableTotal > 0 && (
          <Badge
            variant={mappedCount === mappableTotal ? "default" : "outline"}
            className="text-[10px] px-1.5 py-0"
          >
            {mappedCount}/{mappableTotal} POS
          </Badge>
        )}
        <Badge variant="outline" className="ml-auto text-xs">
          {itemCount}
        </Badge>
      </button>

      {isOpen && (
        <div className="px-2 pb-2">
          {reassignMode && onToggleSelect && selectedIds ? (
            allItems.map(item => (
              <SelectableRow
                key={item.id}
                item={item}
                selected={selectedIds.has(item.id)}
                onToggle={onToggleSelect}
              />
            ))
          ) : (
            <>
              {section.bases.length > 0 && (
                <div className="mb-1">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold px-2 py-1">Base</p>
                  {section.bases.map(item => (
                    <RecipeRow
                      key={item.id}
                      item={item}
                      tagLabel="base"
                      locationId={locationId}
                      onEditRecipe={onEditRecipe}
                      posMapping={posMappings?.get(item.id)}
                      posItems={posItems}
                      onPosLink={onPosLink}
                      onPosUnlink={onPosUnlink}
                      onUpdateMappingMeta={onUpdateMappingMeta}
                      isPosLinking={isPosLinking}
                    />
                  ))}
                </div>
              )}
              {section.cores.length > 0 && (
                <div className="mb-1">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold px-2 py-1">Core Recipes</p>
                  {section.cores.map(item => (
                    <RecipeRow
                      key={item.id}
                      item={item}
                      tagLabel="core"
                      locationId={locationId}
                      onEditRecipe={onEditRecipe}
                      posMapping={posMappings?.get(item.id)}
                      posItems={posItems}
                      onPosLink={onPosLink}
                      onPosUnlink={onPosUnlink}
                      onUpdateMappingMeta={onUpdateMappingMeta}
                      isPosLinking={isPosLinking}
                    />
                  ))}
                </div>
              )}
              {section.menuItems.length > 0 && (
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold px-2 py-1">Menu Items</p>
                  {section.menuItems.map(item => (
                    <RecipeRow
                      key={item.id}
                      item={item}
                      tagLabel="mi"
                      locationId={locationId}
                      onEditRecipe={onEditRecipe}
                      posMapping={posMappings?.get(item.id)}
                      posItems={posItems}
                      onPosLink={onPosLink}
                      onPosUnlink={onPosUnlink}
                      onUpdateMappingMeta={onUpdateMappingMeta}
                      isPosLinking={isPosLinking}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default CatalogSectionComponent;
