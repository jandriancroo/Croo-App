import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Pizza, Salad, UtensilsCrossed, Package, Layers } from "lucide-react";
import type { MenuItem, CatalogSection } from "./recipe-catalog/types";
import { getCoreSortPriority, getSizeFromName } from "./recipe-catalog/utils";
import CatalogSectionComponent from "./recipe-catalog/CatalogSection";

interface RecipeCatalogProps {
  locationId: string;
}

const RecipeCatalog = ({ locationId }: RecipeCatalogProps) => {
  const { data: menuItems } = useQuery({
    queryKey: ["recipe-catalog-items", locationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bom_menu_items")
        .select("id, r365_name, category, is_sellable, recipe_yield_qty, recipe_yield_unit, clean_name")
        .eq("location_id", locationId)
        .order("r365_name");
      if (error) throw error;
      return data as MenuItem[];
    },
  });

  const sections = useMemo(() => {
    if (!menuItems) return [];

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

    for (const item of menuItems) {
      const name = item.r365_name;
      const lower = name.toLowerCase();
      const cat = item.category?.toUpperCase() || "";

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
      s.cores.sort((a, b) => getCoreSortPriority(a.r365_name) - getCoreSortPriority(b.r365_name));
    }

    return result.filter(s => s.bases.length > 0 || s.cores.length > 0 || s.menuItems.length > 0);
  }, [menuItems]);

  if (!menuItems) {
    return (
      <Card>
        <CardContent className="p-4">
          <p className="text-sm text-muted-foreground">Loading recipes...</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="p-0">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
          <Layers className="h-4 w-4" />
          <h3 className="font-semibold text-sm">Recipe Catalog</h3>
          <Badge variant="secondary" className="ml-auto text-xs">
            {menuItems.length} recipes
          </Badge>
        </div>

        <div className="divide-y divide-border">
          {sections.map((section, i) => (
            <CatalogSectionComponent
              key={section.key}
              section={section}
              defaultOpen={i === 0}
              locationId={locationId}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  );
};

export default RecipeCatalog;
