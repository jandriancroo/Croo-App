import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ChevronDown, ChevronRight, Pizza, Salad, UtensilsCrossed, Package, Layers } from "lucide-react";
import { cn } from "@/lib/utils";

interface RecipeCatalogProps {
  locationId: string;
}

interface MenuItem {
  id: string;
  r365_name: string;
  category: string | null;
  is_sellable: boolean | null;
  recipe_yield_qty: number | null;
  recipe_yield_unit: string | null;
  clean_name: string | null;
}

interface RecipeIngredient {
  id: string;
  menu_item_id: string;
  quantity: number;
  unit_of_measure: string | null;
  ingredient: {
    r365_name: string;
    clean_name: string | null;
    inventory_item_id: string | null;
  } | null;
}

// Sort priority for pizza cores within a size group
function getCoreSortPriority(name: string): number {
  const lower = name.toLowerCase();
  if (lower.includes("simple pie")) return 10;
  if (lower.includes("1 top")) return 20;
  if (lower.includes("2 top")) return 30;
  if (lower.includes("3 top")) return 40;
  // Signature pizzas
  if (lower.includes("pepperoni pizza") || lower.includes("pepperoni lover")) return 50;
  if (lower.includes("four cheese")) return 51;
  if (lower.includes("carnivore")) return 52;
  if (lower.includes("meat eater")) return 53;
  if (lower.includes("blazed bbq") || lower.includes("blaze bbq")) return 54;
  if (lower.includes("herbivore")) return 55;
  if (lower.includes("meatball")) return 56;
  if (lower.includes("spicy double pep")) return 57;
  if (lower.includes("spicy hot chicken")) return 58;
  if (lower.includes("hot link")) return 59;
  if (lower.includes("bbq chicken")) return 60;
  if (lower.includes("garlic")) return 61;
  if (lower.includes("veg out")) return 62;
  if (lower.includes("vegan")) return 63;
  if (lower.includes("vegetarian")) return 64;
  if (lower.includes("keto")) return 65;
  if (lower.includes("protein")) return 66;
  if (lower.includes("white top")) return 67;
  if (lower.includes("green stripe")) return 68;
  if (lower.includes("red vine")) return 69;
  if (lower.includes("art lover")) return 70;
  if (lower.includes("maple") || lower.includes("squash")) return 71;
  // BYO always last
  if (lower.includes("byo")) return 200;
  return 100; // Unknown signatures in middle
}

function getSizeFromName(name: string): "MD" | "LG" | "HALF" | null {
  const lower = name.toLowerCase();
  if (lower.includes(" md ") || lower.includes("md -") || lower.includes("md pizza")) return "MD";
  if (lower.includes(" lg ") || lower.includes("lg -") || lower.includes("lg pizza") || lower.includes("large ")) return "LG";
  if (lower.includes("half ") || lower.includes("half pizza")) return "HALF";
  return null;
}

function getCleanDisplayName(name: string): string {
  // Strip prefixes like "Core MD - ", "Base - ", "MI - "
  return name
    .replace(/^(Core (MD|LG|Large|Salad)\s*-?\s*)/i, "")
    .replace(/^(Core\s*-?\s*)/i, "")
    .replace(/^(Base\s*-?\s*)/i, "")
    .replace(/^(MI\s*-?\s*)/i, "")
    .replace(/^(Half\s*)/i, "")
    .trim();
}

type SectionType = "md_pizza" | "lg_pizza" | "half_pizza" | "salads" | "sides" | "drinks" | "catering" | "other";

interface CatalogSection {
  key: SectionType;
  label: string;
  icon: React.ReactNode;
  bases: MenuItem[];
  cores: MenuItem[];
  menuItems: MenuItem[];
}

const RecipeCatalog = ({ locationId }: RecipeCatalogProps) => {
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(["md_pizza"]));
  const [expandedRecipes, setExpandedRecipes] = useState<Set<string>>(new Set());

  // Fetch all menu items
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

  // Fetch ingredients for expanded recipes
  const expandedIds = Array.from(expandedRecipes);
  const { data: ingredients } = useQuery({
    queryKey: ["recipe-catalog-ingredients", locationId, expandedIds],
    queryFn: async () => {
      if (expandedIds.length === 0) return [];
      const { data, error } = await supabase
        .from("bom_recipe_ingredients")
        .select("id, menu_item_id, quantity, unit_of_measure, ingredient:bom_ingredients(r365_name, clean_name, inventory_item_id)")
        .in("menu_item_id", expandedIds)
        .order("quantity", { ascending: false });
      if (error) throw error;
      return data as unknown as RecipeIngredient[];
    },
    enabled: expandedIds.length > 0,
  });

  const ingredientsByRecipe = useMemo(() => {
    const map = new Map<string, RecipeIngredient[]>();
    for (const ing of ingredients || []) {
      const list = map.get(ing.menu_item_id) || [];
      list.push(ing);
      map.set(ing.menu_item_id, list);
    }
    return map;
  }, [ingredients]);

  // Organize items into sections
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

      // Determine which section
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
          else section = sectionMap.get("md_pizza"); // Default cores without size prefix to MD
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
        else section = sectionMap.get("md_pizza"); // Default MI pizzas to MD
        section?.menuItems.push(item);
        continue;
      }

      // PREP, CULINARY, COSTING, OFFER, OTHER
      sectionMap.get("other")?.menuItems.push(item);
    }

    // Sort cores within each section
    for (const s of result) {
      s.cores.sort((a, b) => getCoreSortPriority(a.r365_name) - getCoreSortPriority(b.r365_name));
    }

    // Filter out empty sections
    return result.filter(s => s.bases.length > 0 || s.cores.length > 0 || s.menuItems.length > 0);
  }, [menuItems]);

  const toggleSection = (key: string) => {
    setExpandedSections(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleRecipe = (id: string) => {
    setExpandedRecipes(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const renderRecipeRow = (item: MenuItem, indent: number = 0, tagLabel?: string) => {
    const isExpanded = expandedRecipes.has(item.id);
    const recipeIngs = ingredientsByRecipe.get(item.id) || [];
    const displayName = item.clean_name || getCleanDisplayName(item.r365_name);

    return (
      <div key={item.id} className={cn("border-b border-border/40 last:border-0", indent > 0 && "ml-3")}>
        <button
          type="button"
          className="w-full flex items-center gap-2 py-2 px-2 text-sm hover:bg-muted/50 transition-colors text-left"
          onClick={() => toggleRecipe(item.id)}
        >
          {isExpanded ? (
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
          )}
          <span className="truncate flex-1 font-medium">{displayName}</span>
          {tagLabel && (
            <Badge variant="outline" className="text-[9px] px-1.5 py-0 flex-shrink-0 uppercase tracking-wider">
              {tagLabel}
            </Badge>
          )}
          {item.recipe_yield_qty && item.recipe_yield_unit && (
            <span className="text-xs text-muted-foreground flex-shrink-0">
              yields {item.recipe_yield_qty} {item.recipe_yield_unit}
            </span>
          )}
        </button>
        {isExpanded && (
          <div className="pl-8 pr-2 pb-2 space-y-0.5">
            {recipeIngs.length === 0 ? (
              <p className="text-xs text-muted-foreground italic py-1">No ingredients linked</p>
            ) : (
              recipeIngs.map(ing => (
                <div key={ing.id} className="flex items-center justify-between text-xs py-0.5">
                  <span className={cn(
                    "truncate",
                    ing.ingredient?.inventory_item_id ? "text-foreground" : "text-muted-foreground"
                  )}>
                    {ing.ingredient?.clean_name || ing.ingredient?.r365_name || "Unknown"}
                  </span>
                  <span className="text-muted-foreground flex-shrink-0 ml-2">
                    {ing.quantity} {ing.unit_of_measure || ""}
                  </span>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    );
  };

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
          {sections.map(section => {
            const isOpen = expandedSections.has(section.key);
            const itemCount = section.bases.length + section.cores.length + section.menuItems.length;

            return (
              <div key={section.key}>
                <button
                  type="button"
                  className="w-full flex items-center gap-2 px-4 py-3 hover:bg-muted/30 transition-colors text-left"
                  onClick={() => toggleSection(section.key)}
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
                    {/* Bases */}
                    {section.bases.length > 0 && (
                      <div className="mb-1">
                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold px-2 py-1">
                          Base
                        </p>
                        {section.bases.map(item => renderRecipeRow(item, 0, "base"))}
                      </div>
                    )}

                    {/* Cores */}
                    {section.cores.length > 0 && (
                      <div className="mb-1">
                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold px-2 py-1">
                          Core Recipes
                        </p>
                        {section.cores.map(item => renderRecipeRow(item, 0, "core"))}
                      </div>
                    )}

                    {/* Menu Items */}
                    {section.menuItems.length > 0 && (
                      <div>
                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold px-2 py-1">
                          Menu Items
                        </p>
                        {section.menuItems.map(item => renderRecipeRow(item, 0, "mi"))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
};

export default RecipeCatalog;
