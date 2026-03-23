export interface MenuItem {
  id: string;
  name: string;
  r365_name: string | null;
  category: string | null;
  yield_qty: number | null;
  yield_unit: string | null;
  source: string | null;
}

export interface BlueprintIngredient {
  id: string;
  blueprint_id: string;
  ingredient_type: string;
  vendor_item_id: string | null;
  sub_blueprint_id: string | null;
  quantity: number;
  unit: string | null;
  source_name: string | null;
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
