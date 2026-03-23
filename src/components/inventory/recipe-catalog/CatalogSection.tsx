import { useState, useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { ChevronDown, ChevronRight, Lock } from "lucide-react";
import type { CatalogSection as CatalogSectionType, MenuItem } from "./types";
import { getCleanDisplayName } from "./utils";
import RecipeRow from "./RecipeRow";

interface CatalogSectionProps {
  section: CatalogSectionType;
  defaultOpen?: boolean;
  locationId: string;
  onEditRecipe?: (bomMenuItemId: string) => void;
}

interface GroupedMenuItem {
  mi: MenuItem;
  matchedCore: MenuItem | null;
}

const CatalogSectionComponent = ({ section, defaultOpen = false, locationId, onEditRecipe }: CatalogSectionProps) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const itemCount = section.bases.length + section.cores.length + section.menuItems.length;

  const hasBuildStructure = section.bases.length > 0 && section.cores.length > 0 && section.menuItems.length > 0;

  const { grouped, unmatchedCores } = useMemo(() => {
    if (!hasBuildStructure) return { grouped: [], unmatchedCores: section.cores };

    const coresByClean = new Map<string, MenuItem>();
    const usedCoreIds = new Set<string>();

    for (const core of section.cores) {
      const clean = getCleanDisplayName(core.name).toLowerCase().trim();
      coresByClean.set(clean, core);
    }

    const grouped: GroupedMenuItem[] = [];
    for (const mi of section.menuItems) {
      const clean = getCleanDisplayName(mi.name).toLowerCase().trim();
      const matchedCore = coresByClean.get(clean) || null;
      if (matchedCore) usedCoreIds.add(matchedCore.id);
      grouped.push({ mi, matchedCore });
    }

    const unmatchedCores = section.cores.filter(c => !usedCoreIds.has(c.id));
    return { grouped, unmatchedCores };
  }, [section, hasBuildStructure]);

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
        <Badge variant="outline" className="ml-auto text-xs">
          {itemCount}
        </Badge>
      </button>

      {isOpen && (
        <div className="px-2 pb-2">
          {hasBuildStructure ? (
            <>
              {/* Shared base at top — no edit pencil */}
              {section.bases.map(item => (
                <div key={item.id} className="border-b border-border/40">
                  <div className="flex items-center gap-2 py-2 px-2 text-sm">
                    <Lock className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                    <span className="truncate flex-1 font-medium text-muted-foreground">
                      {getCleanDisplayName(item.name)}
                    </span>
                    <Badge variant="outline" className="text-[9px] px-1.5 py-0 uppercase tracking-wider">
                      shared base
                    </Badge>
                  </div>
                </div>
              ))}

              {/* Grouped MIs with nested core + base reference */}
              {grouped.map(({ mi, matchedCore }) => (
                <GroupedMenuItemRow
                  key={mi.id}
                  mi={mi}
                  matchedCore={matchedCore}
                  bases={section.bases}
                  locationId={locationId}
                  onEditRecipe={onEditRecipe}
                />
              ))}

              {/* Unmatched cores shown standalone */}
              {unmatchedCores.length > 0 && (
                <div className="mt-1">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold px-2 py-1">Unmatched Cores</p>
                  {unmatchedCores.map(item => (
                    <RecipeRow key={item.id} item={item} tagLabel="core" locationId={locationId} />
                  ))}
                </div>
              )}
            </>
          ) : (
            <>
              {section.bases.length > 0 && (
                <div className="mb-1">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold px-2 py-1">Base</p>
                  {section.bases.map(item => (
                    <RecipeRow key={item.id} item={item} tagLabel="base" locationId={locationId} onEditRecipe={onEditRecipe} />
                  ))}
                </div>
              )}
              {section.cores.length > 0 && (
                <div className="mb-1">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold px-2 py-1">Core Recipes</p>
                  {section.cores.map(item => (
                    <RecipeRow key={item.id} item={item} tagLabel="core" locationId={locationId} onEditRecipe={onEditRecipe} />
                  ))}
                </div>
              )}
              {section.menuItems.length > 0 && (
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold px-2 py-1">Menu Items</p>
                  {section.menuItems.map(item => (
                    <RecipeRow key={item.id} item={item} tagLabel="mi" locationId={locationId} onEditRecipe={onEditRecipe} />
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

/* Nested MI row: shows MI as parent, with base ref + core nested inside on expand */
const GroupedMenuItemRow = ({
  mi,
  matchedCore,
  bases,
  locationId,
  onEditRecipe,
}: {
  mi: MenuItem;
  matchedCore: MenuItem | null;
  bases: MenuItem[];
  locationId: string;
  onEditRecipe?: (id: string) => void;
}) => {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div className="border-b border-border/40 last:border-0">
      {/* MI parent row — this gets the edit pencil */}
      <RecipeRow item={mi} locationId={locationId} onEditRecipe={onEditRecipe} />

      {/* When MI is expanded via RecipeRow, we also show the build components */}
      {/* We use a separate toggle for the build view */}
      <button
        type="button"
        className="w-full flex items-center gap-1.5 pl-8 pr-2 py-1 text-[11px] text-muted-foreground hover:bg-muted/30 transition-colors"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        {isExpanded ? (
          <ChevronDown className="h-3 w-3 flex-shrink-0" />
        ) : (
          <ChevronRight className="h-3 w-3 flex-shrink-0" />
        )}
        <span>Build Components</span>
      </button>

      {isExpanded && (
        <div className="pl-10 pr-2 pb-2 space-y-0.5">
          {/* Base reference — read only */}
          {bases.map(base => (
            <div key={base.id} className="flex items-center gap-1.5 text-xs py-0.5 text-muted-foreground">
              <Lock className="h-2.5 w-2.5 flex-shrink-0" />
              <span className="truncate flex-1">{getCleanDisplayName(base.name)}</span>
              <Badge variant="outline" className="text-[8px] px-1 py-0 uppercase">base</Badge>
            </div>
          ))}

          {/* Matched core — read only in catalog, shows name */}
          {matchedCore ? (
            <div className="flex items-center gap-1.5 text-xs py-0.5">
              <span className="truncate flex-1 font-medium">{getCleanDisplayName(matchedCore.name)}</span>
              <Badge variant="outline" className="text-[8px] px-1 py-0 uppercase">core</Badge>
            </div>
          ) : (
            <div className="text-xs text-amber-500 py-0.5 italic">No matching core recipe found</div>
          )}
        </div>
      )}
    </div>
  );
};

export default CatalogSectionComponent;
