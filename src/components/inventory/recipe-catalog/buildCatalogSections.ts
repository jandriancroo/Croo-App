import type { SectionType } from "./types";
import { getCoreSortPriority, getSizeFromName } from "./utils";

/**
 * Single source of truth for how recipes are grouped into menu sections
 * (11" / 14" / Half / Detroit / Salads / Sides / Catering / Drinks / Other)
 * and split into Bases / Cores / Menu Items.
 *
 * Used by BOTH the store Build tab (RecipeCatalog) and the Brand Recipes tab,
 * so the two screens can never drift apart.
 */

export interface SectionableRecipe {
  name: string;
  category: string | null;
  catalog_section: string | null;
}

export interface BuiltSection<T extends SectionableRecipe> {
  key: SectionType;
  label: string;
  bases: T[];
  cores: T[];
  menuItems: T[];
}

export const CATALOG_SECTION_DEFS: { key: SectionType; label: string }[] = [
  { key: "md_pizza", label: '11" Pizzas' },
  { key: "lg_pizza", label: '14" Pizzas' },
  { key: "half_pizza", label: "Half Pizzas" },
  { key: "detroit", label: "Detroit Pizzas" },
  { key: "salads", label: "Salads" },
  { key: "sides", label: "Sides & Extras" },
  { key: "catering", label: "Catering" },
  { key: "drinks", label: "Drinks" },
  { key: "other", label: "Other" },
];

const DRINK_WORDS = [
  "drink", "juice", "water", "lemonade", "tea", "beer", "wine", "bubbles", "orchard",
  "aranciata", "limonata", "pellegrino", "fountain", "izze",
];
const SIDE_WORDS = [
  "cheesy bread", "meatball", "brownie", "cookie", "s'more", "cinnamon", "fold", "sandwich",
  "garlic & sausage",
];

export function buildCatalogSections<T extends SectionableRecipe>(items: T[]): BuiltSection<T>[] {
  const result: BuiltSection<T>[] = CATALOG_SECTION_DEFS.map(d => ({
    ...d, bases: [], cores: [], menuItems: [],
  }));
  const sectionMap = new Map(result.map(s => [s.key, s]));

  for (const item of items) {
    const name = item.name;
    const lower = name.toLowerCase();
    const cat = item.category?.toUpperCase() || "";

    // Manual override takes priority
    if (item.catalog_section && sectionMap.has(item.catalog_section as SectionType)) {
      const section = sectionMap.get(item.catalog_section as SectionType)!;
      if (cat === "BASE") section.bases.push(item);
      else if (cat === "CORE") section.cores.push(item);
      else section.menuItems.push(item);
      continue;
    }

    let section: BuiltSection<T> | undefined;

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
      else if (DRINK_WORDS.some(w => lower.includes(w))) section = sectionMap.get("drinks");
      else if (SIDE_WORDS.some(w => lower.includes(w))) section = sectionMap.get("sides");
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
}
