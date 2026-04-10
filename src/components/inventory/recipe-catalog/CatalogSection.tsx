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

interface CollapsibleSegmentProps {
  label: string;
  items: MenuItem[];
  tagLabel: string;
  locationId: string;
  onEditRecipe?: (id: string) => void;
  posMappings?: CatalogSectionProps["posMappings"];
  posItems?: PosItem[];
  onPosLink?: CatalogSectionProps["onPosLink"];
  onPosUnlink?: CatalogSectionProps["onPosUnlink"];
  onUpdateMappingMeta?: CatalogSectionProps["onUpdateMappingMeta"];
  isPosLinking?: boolean;
}

const CollapsibleSegment = ({ label, items, tagLabel, locationId, onEditRecipe, posMappings, posItems, onPosLink, onPosUnlink, onUpdateMappingMeta, isPosLinking, defaultOpen = false }: CollapsibleSegmentProps & { defaultOpen?: boolean }) => {
  const [open, setOpen] = useState(defaultOpen);

  if (items.length === 0) return null;

  return (
    <div className="mb-1">
      <button
        type="button"
        className="w-full flex items-center gap-1.5 px-2 py-1 hover:bg-muted/30 transition-colors text-left"
        onClick={() => setOpen(!open)}
      >
        {open ? (
          <ChevronDown className="h-3 w-3 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3 w-3 text-muted-foreground" />
        )}
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">{label}</span>
        <span className="text-[10px] text-muted-foreground/60 tabular-nums">{items.length}</span>
      </button>
      {open && items.map(item => (
        <RecipeRow
          key={item.id}
          item={item}
          tagLabel={tagLabel}
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
              <CollapsibleSegment label="Foundation" items={section.bases} tagLabel="base" locationId={locationId} onEditRecipe={onEditRecipe} posMappings={posMappings} posItems={posItems} onPosLink={onPosLink} onPosUnlink={onPosUnlink} onUpdateMappingMeta={onUpdateMappingMeta} isPosLinking={isPosLinking} />
              <CollapsibleSegment label="Build" items={section.cores} tagLabel="core" locationId={locationId} onEditRecipe={onEditRecipe} posMappings={posMappings} posItems={posItems} onPosLink={onPosLink} onPosUnlink={onPosUnlink} onUpdateMappingMeta={onUpdateMappingMeta} isPosLinking={isPosLinking} />
              <CollapsibleSegment label="Menu Items" items={section.menuItems} tagLabel="mi" locationId={locationId} onEditRecipe={onEditRecipe} posMappings={posMappings} posItems={posItems} onPosLink={onPosLink} onPosUnlink={onPosUnlink} onUpdateMappingMeta={onUpdateMappingMeta} isPosLinking={isPosLinking} />
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default CatalogSectionComponent;
