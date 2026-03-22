import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { CatalogSection as CatalogSectionType } from "./types";
import RecipeRow from "./RecipeRow";

interface CatalogSectionProps {
  section: CatalogSectionType;
  defaultOpen?: boolean;
  locationId: string;
}

const CatalogSectionComponent = ({ section, defaultOpen = false, locationId }: CatalogSectionProps) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const itemCount = section.bases.length + section.cores.length + section.menuItems.length;

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
          {section.bases.length > 0 && (
            <div className="mb-1">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold px-2 py-1">Base</p>
              {section.bases.map(item => (
                <RecipeRow key={item.id} item={item} tagLabel="base" locationId={locationId} />
              ))}
            </div>
          )}

          {section.cores.length > 0 && (
            <div className="mb-1">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold px-2 py-1">Core Recipes</p>
              {section.cores.map(item => (
                <RecipeRow key={item.id} item={item} tagLabel="core" locationId={locationId} />
              ))}
            </div>
          )}

          {section.menuItems.length > 0 && (
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold px-2 py-1">Menu Items</p>
              {section.menuItems.map(item => (
                <RecipeRow key={item.id} item={item} tagLabel="mi" locationId={locationId} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default CatalogSectionComponent;
