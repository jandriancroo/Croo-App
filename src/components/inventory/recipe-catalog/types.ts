export interface MenuItem {
  id: string;
  r365_name: string;
  category: string | null;
  is_sellable: boolean | null;
  recipe_yield_qty: number | null;
  recipe_yield_unit: string | null;
  clean_name: string | null;
}

export interface RecipeIngredient {
  id: string;
  menu_item_id: string;
  ingredient_id: string | null;
  quantity: number;
  unit_of_measure: string | null;
  ingredient: {
    id: string;
    r365_name: string;
    clean_name: string | null;
    inventory_item_id: string | null;
  } | null;
}

export interface ResolvedCost {
  vendor_item_name: string | null;
  ingredient_name: string;
  total_quantity: number;
  unit_of_measure: string | null;
  total_cost: number;
}

export type SectionType = "md_pizza" | "lg_pizza" | "half_pizza" | "salads" | "sides" | "drinks" | "catering" | "other";

export interface CatalogSection {
  key: SectionType;
  label: string;
  icon: React.ReactNode;
  bases: MenuItem[];
  cores: MenuItem[];
  menuItems: MenuItem[];
}
