import { useState, useMemo, useEffect } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, X, Loader2, Search, FlaskConical, RefreshCw, AlertCircle, ChevronRight } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import PanSizesSection from "./PanSizesSection";
import type { PanSizesConfig } from "./PanSizesSection";

interface RecipeBuilderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  locationId: string;
  /** Edit legacy recipe in inventory_items */
  editRecipeId?: string | null;
  /** Edit BOM recipe (legacy catalog) */
  bomMenuItemId?: string | null;
  /** Edit a recipe_blueprint */
  editBlueprintId?: string | null;
}

interface BuilderIngredient {
  type: "vendor_item" | "blueprint";
  ref_id: string; // inventory_items.id or recipe_blueprints.id
  quantity: number;
  unit: string;
  displayName?: string; // fallback name from BOM/R365 data
  unmapped?: boolean; // BOM ingredient not yet linked to a vendor item
  bomSubRecipeId?: string; // if this ingredient is a sub-recipe, its bom_menu_items.id
}

interface DrillStackEntry {
  bomId: string;
  name: string;
}

/** Combined item for the ingredient search list */
interface SearchableItem {
  id: string;
  name: string;
  item_type: "vendor_item" | "blueprint";
  // vendor fields
  cost_per_unit?: number | null;
  pack_size?: string | null;
  count_unit?: string | null;
  count_units_per_case?: number | null;
  // blueprint fields
  yield_qty?: number | null;
  yield_unit?: string | null;
  is_recipe?: boolean;
  recipe_yield_qty?: number | null;
  recipe_yield_unit?: string | null;
}

const UNIT_OPTIONS = ["oz", "qt", "gal", "lb", "kg", "g", "ea", "tbsp", "tsp", "ml", "cups", "bags", "ct"];

const TO_OZ: Record<string, number> = {
  oz: 1, qt: 32, lb: 16, gal: 128, tbsp: 0.5, tsp: 0.1667, ml: 0.033814, cups: 8, ea: 1, bags: 1, ct: 1, kg: 35.274, g: 0.03527,
};

const UNIT_ALIASES: Record<string, string> = {
  "oz-wt": "oz", "oz-fl": "oz", "fl-oz": "oz", "fl_oz": "oz", "oz_fl": "oz",
  "gram": "g", "grams": "g", "each": "ea", "count": "ea",
  "case": "cs", "cases": "cs", "can": "cn", "cans": "cn",
  "quart": "qt", "quarts": "qt", "gallon": "gal", "gallons": "gal",
  "lbs": "lb", "pound": "lb", "pounds": "lb",
};

const normalizeUnit = (unit: string | null | undefined): string => {
  if (!unit) return "";
  const cleaned = unit.trim().toLowerCase().replace(/\s+/g, "").replace(/_/g, "-");
  if (UNIT_ALIASES[cleaned]) return UNIT_ALIASES[cleaned];
  if (cleaned.includes("ml")) return "ml";
  if (cleaned.includes("oz")) return "oz";
  if (cleaned.includes("gram")) return "g";
  return cleaned;
};

const PACK_UNIT_MAP: Record<string, string> = {
  OZ: "oz", LB: "lb", GA: "gal", GAL: "gal", ML: "ml", CT: "ct", EA: "ea", CN: "ea", KG: "kg", G: "g",
};

const CAN_SIZES: Record<string, number> = { "10": 106, "5": 56, "2.5": 26 };

const parseCansPerCase = (packSize: string | null): number | null => {
  if (!packSize) return null;
  const canMatch = packSize.match(/^(\d+)\s*\/\s*#(\d+\.?\d*)\s*([A-Za-z]+)$/);
  if (canMatch) return parseInt(canMatch[1]);
  return null;
};

const parsePackSize = (packSize: string | null): { count: number; unit: string } | null => {
  if (!packSize) return null;
  const canMatch = packSize.match(/^(\d+)\s*\/\s*#(\d+\.?\d*)\s*([A-Za-z]+)$/);
  if (canMatch) {
    const packs = parseInt(canMatch[1]);
    const canSize = canMatch[2];
    const rawUnit = canMatch[3].toUpperCase();
    const unit = PACK_UNIT_MAP[rawUnit];
    if (!unit) return null;
    const ozPerCan = CAN_SIZES[canSize];
    if (ozPerCan) return { count: packs * ozPerCan, unit: "oz" };
    return { count: packs, unit };
  }
  const poundSlash = packSize.match(/^(\d+)\s*\/\s*(\d+\.?\d*)\s*#$/);
  if (poundSlash) return { count: parseInt(poundSlash[1]) * parseFloat(poundSlash[2]), unit: "lb" };
  const poundStandalone = packSize.match(/^(\d+\.?\d*)\s*#$/);
  if (poundStandalone) return { count: parseFloat(poundStandalone[1]), unit: "lb" };
  const match = packSize.match(/^(\d+)\s*\/\s*(\d+\.?\d*)\s*([A-Za-z]+)$/);
  if (!match) return null;
  const rawUnit = match[3].toUpperCase();
  const unit = PACK_UNIT_MAP[rawUnit];
  if (!unit) return null;
  return { count: parseInt(match[1]) * parseFloat(match[2]), unit };
};

const convertYield = (qty: number, fromUnit: string, toUnit: string): number => {
  const fromFactor = TO_OZ[fromUnit] ?? 1;
  const toFactor = TO_OZ[toUnit] ?? 1;
  return (qty * fromFactor) / toFactor;
};

const RecipeBuilderDialog = ({ open, onOpenChange, locationId, editRecipeId, bomMenuItemId, editBlueprintId }: RecipeBuilderDialogProps) => {
  const queryClient = useQueryClient();
  const [recipeName, setRecipeName] = useState("");
  const [category, setCategory] = useState("");
  const [yieldQty, setYieldQty] = useState("");
  const [yieldUnit, setYieldUnit] = useState("oz");
  const [yieldManuallyEdited, setYieldManuallyEdited] = useState(false);
  const [ingredients, setIngredients] = useState<BuilderIngredient[]>([]);
  const [addingIngredient, setAddingIngredient] = useState(false);
  const [ingredientSearch, setIngredientSearch] = useState("");
  const [selectedItem, setSelectedItem] = useState<SearchableItem | null>(null);
  const [ingredientQty, setIngredientQty] = useState("");
  const [ingredientUnit, setIngredientUnit] = useState("oz");
  const [countable, setCountable] = useState(true);
  const [panSizesConfig, setPanSizesConfig] = useState<PanSizesConfig | null>(null);
  const [suggestedPrice, setSuggestedPrice] = useState("");

  const isBlueprint = !!editBlueprintId || (!editRecipeId && !bomMenuItemId);

  // ========== DATA FETCHING ==========

  // Fetch vendor items (non-recipe inventory_items)
  const { data: vendorItems } = useQuery({
    queryKey: ["vendor-items-for-recipe", locationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory_items")
        .select("id, name, unit, cost_per_unit, pack_size, count_unit, count_units_per_case, is_recipe, recipe_yield_qty, recipe_yield_unit")
        .eq("location_id", locationId)
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data || [];
    },
    enabled: open,
  });

  // Fetch other blueprints (for sub-recipe selection)
  const { data: otherBlueprints } = useQuery({
    queryKey: ["blueprints-for-recipe", locationId, editBlueprintId],
    queryFn: async () => {
      let query = supabase
        .from("recipe_blueprints" as any)
        .select("id, name, yield_qty, yield_unit, category")
        .eq("location_id", locationId)
        .eq("is_active", true)
        .order("name");
      if (editBlueprintId) {
        query = query.neq("id", editBlueprintId);
      }
      const { data, error } = await query;
      if (error) throw error;
      return (data || []) as unknown as { id: string; name: string; yield_qty: number | null; yield_unit: string | null; category: string | null }[];
    },
    enabled: open && isBlueprint,
  });

  // Build combined searchable items list
  const searchableItems = useMemo((): SearchableItem[] => {
    const items: SearchableItem[] = [];

    // Vendor items (including legacy recipes in inventory_items)
    vendorItems?.forEach(v => {
      // Skip the item being edited (legacy mode)
      if (editRecipeId && v.id === editRecipeId) return;
      items.push({
        id: v.id,
        name: v.name,
        item_type: "vendor_item",
        cost_per_unit: v.cost_per_unit,
        pack_size: v.pack_size,
        count_unit: v.count_unit,
        count_units_per_case: v.count_units_per_case,
        is_recipe: v.is_recipe,
        recipe_yield_qty: v.recipe_yield_qty,
        recipe_yield_unit: v.recipe_yield_unit,
      });
    });

    // Other blueprints (only in blueprint mode)
    if (isBlueprint) {
      otherBlueprints?.forEach(bp => {
        items.push({
          id: bp.id,
          name: bp.name,
          item_type: "blueprint",
          yield_qty: bp.yield_qty,
          yield_unit: bp.yield_unit,
        });
      });
    }

    return items;
  }, [vendorItems, otherBlueprints, editRecipeId, isBlueprint]);

  // Fetch existing blueprint data if editing
  const { data: existingBlueprint } = useQuery({
    queryKey: ["blueprint-detail", editBlueprintId],
    queryFn: async () => {
      if (!editBlueprintId) return null;
      const { data: bp, error: bpErr } = await supabase
        .from("recipe_blueprints" as any)
        .select("id, name, category, yield_qty, yield_unit, produces_item_id, source")
        .eq("id", editBlueprintId)
        .single();
      if (bpErr) throw bpErr;

      const { data: ings, error: ingErr } = await supabase
        .from("recipe_blueprint_ingredients" as any)
        .select("id, ingredient_type, vendor_item_id, sub_blueprint_id, quantity, unit")
        .eq("blueprint_id", editBlueprintId);
      if (ingErr) throw ingErr;

      // Check if blueprint produces a countable item
      let producedItem: any = null;
      if ((bp as any)?.produces_item_id) {
        const { data: item } = await supabase
          .from("inventory_items")
          .select("id, countable, pan_sizes, storage_location_id")
          .eq("id", (bp as any).produces_item_id)
          .single();
        producedItem = item;
      }

      return {
        blueprint: bp as any,
        ingredients: (ings || []) as any[],
        producedItem,
      };
    },
    enabled: open && !!editBlueprintId,
  });

  // Fetch legacy recipe data (inventory_items mode)
  const { data: existingRecipe } = useQuery({
    queryKey: ["recipe-detail", editRecipeId],
    queryFn: async () => {
      if (!editRecipeId) return null;
      const { data: item } = await supabase
        .from("inventory_items")
        .select("id, name, recipe_yield_qty, recipe_yield_unit, countable, pan_sizes, source")
        .eq("id", editRecipeId)
        .single();
      const { data: ings } = await supabase
        .from("inventory_recipe_ingredients")
        .select("ingredient_item_id, quantity, unit")
        .eq("recipe_item_id", editRecipeId);
      return { item, ingredients: ings || [] };
    },
    enabled: open && !!editRecipeId && !bomMenuItemId && !editBlueprintId,
  });

  // Fetch BOM recipe data (legacy catalog mode)
  const { data: bomRecipe } = useQuery({
    queryKey: ["bom-recipe-detail", bomMenuItemId],
    queryFn: async () => {
      if (!bomMenuItemId) return null;
      const { data: menuItem } = await supabase
        .from("bom_menu_items")
        .select("id, r365_name, clean_name, recipe_yield_qty, recipe_yield_unit, category")
        .eq("id", bomMenuItemId)
        .single();
      const { data: bomIngs } = await supabase
        .from("bom_recipe_ingredients")
        .select("id, ingredient_id, quantity, unit_of_measure, ingredient:bom_ingredients(id, r365_name, clean_name, inventory_item_id)")
        .eq("menu_item_id", bomMenuItemId);
      return { menuItem, ingredients: bomIngs || [] };
    },
    enabled: open && !!bomMenuItemId,
  });

  // ========== AUTO-YIELD CALCULATION ==========

  const autoYield = useMemo(() => {
    if (ingredients.length === 0) return 0;
    let totalOz = 0;
    for (const ing of ingredients) {
      const ingUnit = normalizeUnit(ing.unit);
      if (ing.type === "blueprint") {
        // Blueprint sub-recipe: use its yield unit
        const bp = otherBlueprints?.find(b => b.id === ing.ref_id);
        const bpYieldUnit = normalizeUnit(bp?.yield_unit) || "oz";
        totalOz += ing.quantity * (TO_OZ[bpYieldUnit] ?? 1);
      } else {
        const item = vendorItems?.find(i => i.id === ing.ref_id);
        if (ingUnit === "cn") {
          const canMatch = item?.pack_size?.match(/^(\d+)\s*\/\s*#(\d+\.?\d*)\s*([A-Za-z]+)$/);
          const ozPerCan = canMatch ? (CAN_SIZES[canMatch[2]] || 1) : 1;
          totalOz += ing.quantity * ozPerCan;
        } else if (ingUnit === "cs") {
          const parsed = item?.pack_size ? parsePackSize(item.pack_size) : null;
          const upc = item?.count_units_per_case || parsed?.count || 1;
          const nativeUnit = normalizeUnit(item?.count_unit || parsed?.unit || "oz") || "oz";
          totalOz += upc * (TO_OZ[nativeUnit] ?? 1);
        } else {
          totalOz += ing.quantity * (TO_OZ[ingUnit] ?? 1);
        }
      }
    }
    const toFactor = TO_OZ[yieldUnit] ?? 1;
    return totalOz / toFactor;
  }, [ingredients, yieldUnit, vendorItems, otherBlueprints]);

  const prevAutoYield = useState({ val: 0 });
  if (!yieldManuallyEdited && autoYield > 0 && autoYield !== prevAutoYield[0].val) {
    prevAutoYield[0].val = autoYield;
    const rounded = parseFloat(autoYield.toFixed(2));
    if (yieldQty !== rounded.toString()) {
      setYieldQty(rounded.toString());
    }
  }

  // ========== POPULATE FORM ON EDIT ==========

  // Blueprint edit
  useEffect(() => {
    if (existingBlueprint?.blueprint) {
      const bp = existingBlueprint.blueprint;
      setRecipeName(bp.name || "");
      setCategory(bp.category || "");
      setYieldQty(bp.yield_qty?.toString() || "");
      setYieldUnit(normalizeUnit(bp.yield_unit) || "oz");
      setYieldManuallyEdited(true);
      setCountable(!!existingBlueprint.producedItem);
      setPanSizesConfig(existingBlueprint.producedItem?.pan_sizes || null);
      setIngredients(existingBlueprint.ingredients.map((i: any) => {
        const isBlueprint = i.ingredient_type === "blueprint";
        const refId = isBlueprint ? i.sub_blueprint_id : i.vendor_item_id;
        const bpName = isBlueprint ? otherBlueprints?.find((b: any) => b.id === refId)?.name : vendorItems?.find((v: any) => v.id === refId)?.name;
        return {
          type: isBlueprint ? "blueprint" as const : "vendor_item" as const,
          ref_id: refId,
          quantity: Number(i.quantity),
          unit: normalizeUnit(i.unit) || "oz",
          displayName: bpName || undefined,
        };
      }));
    }
  }, [existingBlueprint]);

  // Legacy recipe edit (inventory_items)
  useEffect(() => {
    if (existingRecipe?.item && !bomMenuItemId && !editBlueprintId) {
      setRecipeName(existingRecipe.item.name);
      setYieldQty(existingRecipe.item.recipe_yield_qty?.toString() || "");
      setYieldUnit(normalizeUnit(existingRecipe.item.recipe_yield_unit) || "oz");
      setYieldManuallyEdited(true);
      setCountable((existingRecipe.item as any).countable !== false);
      setPanSizesConfig(existingRecipe.item.pan_sizes ? (existingRecipe.item.pan_sizes as unknown as PanSizesConfig) : null);
      setIngredients(existingRecipe.ingredients.map(i => ({
        type: "vendor_item" as const,
        ref_id: i.ingredient_item_id,
        quantity: Number(i.quantity),
        unit: normalizeUnit(i.unit) || "oz",
      })));
    }
  }, [existingRecipe, bomMenuItemId, editBlueprintId]);

  // BOM recipe edit
  useEffect(() => {
    if (bomRecipe?.menuItem && bomMenuItemId) {
      const mi = bomRecipe.menuItem;
      setRecipeName(mi.clean_name || mi.r365_name || "");
      setYieldQty(mi.recipe_yield_qty?.toString() || "");
      setYieldUnit(normalizeUnit(mi.recipe_yield_unit) || "oz");
      setYieldManuallyEdited(!!mi.recipe_yield_qty);
      setCountable(false);
      setPanSizesConfig(null);
      const mappedIngs: BuilderIngredient[] = [];
      for (const bomIng of bomRecipe.ingredients) {
        const ing = bomIng.ingredient as any;
        const ingName = ing?.clean_name || ing?.r365_name || "Unknown ingredient";
        if (ing?.inventory_item_id) {
          mappedIngs.push({
            type: "vendor_item",
            ref_id: ing.inventory_item_id,
            quantity: Number(bomIng.quantity),
            unit: normalizeUnit(bomIng.unit_of_measure) || "oz",
            displayName: ingName,
          });
        } else {
          // Include unmapped BOM ingredients so user can see them
          mappedIngs.push({
            type: "vendor_item",
            ref_id: ing?.id || bomIng.id,
            quantity: Number(bomIng.quantity),
            unit: normalizeUnit(bomIng.unit_of_measure) || "oz",
            displayName: ingName,
            unmapped: true,
          });
        }
      }
      setIngredients(mappedIngs);
    }
  }, [bomRecipe, bomMenuItemId]);

  // ========== COST CALCULATION ==========

  const recipeCostResult = useMemo(() => {
    if (ingredients.length === 0) return null;
    let total = 0;
    let allHaveCost = true;
    const missingItems: string[] = [];

    for (const ing of ingredients) {
      if (ing.type === "blueprint") {
        // TODO: calculate sub-blueprint cost inline
        // For now, show as partial
        allHaveCost = false;
        continue;
      }

      const item = vendorItems?.find(i => i.id === ing.ref_id);
      const ingUnit = normalizeUnit(ing.unit);
      if (!item) { allHaveCost = false; missingItems.push(ing.ref_id); continue; }
      if (item.cost_per_unit == null) continue;

      if (item.is_recipe) {
        const recipeYieldUnit = normalizeUnit(item.recipe_yield_unit) || "oz";
        const yieldQtyVal = item.recipe_yield_qty || 0;
        if (yieldQtyVal > 0) {
          const ingOz = ing.quantity * (TO_OZ[ingUnit] ?? 1);
          const yieldOz = yieldQtyVal * (TO_OZ[recipeYieldUnit] ?? 1);
          total += (ingOz / yieldOz) * item.cost_per_unit;
        } else {
          allHaveCost = false;
          missingItems.push(item.name);
        }
        continue;
      }

      let upc = item.count_units_per_case;
      let nativeUnit = normalizeUnit(item.count_unit);
      if ((!upc || !nativeUnit) && item.pack_size) {
        const parsed = parsePackSize(item.pack_size);
        if (parsed) { if (!upc) upc = parsed.count; if (!nativeUnit) nativeUnit = normalizeUnit(parsed.unit); }
      }
      nativeUnit = nativeUnit || "ea";

      if (ingUnit === "cs") {
        total += ing.quantity * item.cost_per_unit;
      } else if (ingUnit === "cn") {
        const cpc = parseCansPerCase(item.pack_size);
        if (cpc && cpc > 0) { total += (ing.quantity / cpc) * item.cost_per_unit; }
        else { allHaveCost = false; missingItems.push(item.name); }
      } else if (ingUnit === nativeUnit && upc && upc > 0) {
        total += (ing.quantity / upc) * item.cost_per_unit;
      } else if (upc && upc > 0 && TO_OZ[ingUnit] && TO_OZ[nativeUnit]) {
        const ingInNative = (ing.quantity * TO_OZ[ingUnit]) / TO_OZ[nativeUnit];
        total += (ingInNative / upc) * item.cost_per_unit;
      } else {
        allHaveCost = false;
        missingItems.push(item.name);
      }
    }

    return { total, allHaveCost, missingItems };
  }, [ingredients, vendorItems]);

  const recipeCost = recipeCostResult?.total ?? null;

  const costPerYieldUnit = useMemo(() => {
    if (recipeCost === null || !yieldQty || parseFloat(yieldQty) <= 0) return null;
    return recipeCost / parseFloat(yieldQty);
  }, [recipeCost, yieldQty]);

  // ========== SAVE MUTATION ==========

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!recipeName.trim()) throw new Error("Name required");
      if (!yieldQty || parseFloat(yieldQty) <= 0) throw new Error("Yield required");
      if (ingredients.length === 0) throw new Error("Add at least one ingredient");

      // === BOM MODE (legacy catalog) ===
      if (bomMenuItemId) {
        const { error: miErr } = await supabase
          .from("bom_menu_items")
          .update({
            clean_name: recipeName.trim(),
            recipe_yield_qty: parseFloat(yieldQty),
            recipe_yield_unit: yieldUnit,
          })
          .eq("id", bomMenuItemId);
        if (miErr) throw miErr;

        await supabase.from("bom_recipe_ingredients").delete().eq("menu_item_id", bomMenuItemId);

        for (const ing of ingredients) {
          if (ing.type !== "vendor_item" || ing.unmapped) continue;
          const { data: existing } = await supabase
            .from("bom_ingredients").select("id")
            .eq("location_id", locationId).eq("inventory_item_id", ing.ref_id)
            .limit(1).single();

          let bomIngredientId: string;
          if (existing) {
            bomIngredientId = existing.id;
          } else {
            const item = vendorItems?.find(i => i.id === ing.ref_id);
            const { data: newBomIng, error: createErr } = await supabase
              .from("bom_ingredients")
              .insert({ location_id: locationId, r365_name: item?.name || "Unknown", clean_name: item?.name || "Unknown", inventory_item_id: ing.ref_id, is_ignored: false })
              .select("id").single();
            if (createErr || !newBomIng) throw createErr || new Error("Failed to create ingredient link");
            bomIngredientId = newBomIng.id;
          }

          await supabase.from("bom_recipe_ingredients").insert({
            menu_item_id: bomMenuItemId, ingredient_id: bomIngredientId,
            quantity: ing.quantity, unit_of_measure: normalizeUnit(ing.unit) || ing.unit, location_id: locationId,
          });
        }
        return;
      }

      // === LEGACY RECIPE MODE (inventory_items) ===
      if (editRecipeId && !editBlueprintId) {
        const costPerCase = recipeCost;
        const { error: itemErr } = await supabase
          .from("inventory_items")
          .update({
            name: recipeName.trim(),
            recipe_yield_qty: parseFloat(yieldQty),
            recipe_yield_unit: yieldUnit,
            count_unit: yieldUnit,
            count_units_per_case: parseFloat(yieldQty),
            cost_per_unit: costPerCase,
            countable,
            pan_sizes: panSizesConfig as any,
          } as any)
          .eq("id", editRecipeId);
        if (itemErr) throw itemErr;

        await supabase.from("inventory_recipe_ingredients").delete().eq("recipe_item_id", editRecipeId);
        const { error: ingErr } = await supabase
          .from("inventory_recipe_ingredients")
          .insert(ingredients.filter(i => i.type === "vendor_item").map(ing => ({
            recipe_item_id: editRecipeId,
            ingredient_item_id: ing.ref_id,
            quantity: ing.quantity,
            unit: normalizeUnit(ing.unit) || ing.unit,
          })));
        if (ingErr) throw ingErr;
        return;
      }

      // === BLUEPRINT MODE (new architecture) ===
      const batchCost = recipeCost;

      if (editBlueprintId) {
        // Update existing blueprint
        const { error: bpErr } = await supabase
          .from("recipe_blueprints" as any)
          .update({
            name: recipeName.trim(),
            category: category || null,
            yield_qty: parseFloat(yieldQty),
            yield_unit: yieldUnit,
          } as any)
          .eq("id", editBlueprintId);
        if (bpErr) throw bpErr;

        // Delete + re-insert ingredients
        await supabase.from("recipe_blueprint_ingredients" as any).delete().eq("blueprint_id", editBlueprintId);
        const ingInserts = ingredients.map(ing => ({
          blueprint_id: editBlueprintId,
          ingredient_type: ing.type,
          vendor_item_id: ing.type === "vendor_item" ? ing.ref_id : null,
          sub_blueprint_id: ing.type === "blueprint" ? ing.ref_id : null,
          quantity: ing.quantity,
          unit: normalizeUnit(ing.unit) || ing.unit,
        }));
        if (ingInserts.length > 0) {
          const { error: ingErr } = await supabase.from("recipe_blueprint_ingredients" as any).insert(ingInserts);
          if (ingErr) throw ingErr;
        }

        // Handle produced item (countable)
        const existingProducesId = existingBlueprint?.blueprint?.produces_item_id;
        if (countable) {
          if (existingProducesId) {
            // Update existing produced item
            await supabase.from("inventory_items").update({
              name: recipeName.trim(),
              recipe_yield_qty: parseFloat(yieldQty),
              recipe_yield_unit: yieldUnit,
              count_unit: yieldUnit,
              count_units_per_case: parseFloat(yieldQty),
              cost_per_unit: batchCost,
              pan_sizes: panSizesConfig as any,
            } as any).eq("id", existingProducesId);
          } else {
            // Create new countable item
            const { data: newItem, error: itemErr } = await supabase
              .from("inventory_items")
              .insert({
                location_id: locationId,
                name: recipeName.trim(),
                unit: yieldUnit,
                is_recipe: false,
                is_active: true,
                recipe_yield_qty: parseFloat(yieldQty),
                recipe_yield_unit: yieldUnit,
                count_unit: yieldUnit,
                count_units_per_case: parseFloat(yieldQty),
                cost_per_unit: batchCost,
                display_order: 0,
                countable: true,
                pan_sizes: panSizesConfig as any,
              } as any)
              .select("id").single();
            if (itemErr || !newItem) throw itemErr || new Error("Failed to create countable item");
            // Link blueprint to produced item
            await supabase.from("recipe_blueprints" as any).update({ produces_item_id: newItem.id } as any).eq("id", editBlueprintId);
          }
        } else if (existingProducesId) {
          // Was countable, now not — deactivate the produced item
          await supabase.from("inventory_items").update({ is_active: false } as any).eq("id", existingProducesId);
          await supabase.from("recipe_blueprints" as any).update({ produces_item_id: null } as any).eq("id", editBlueprintId);
        }
      } else {
        // Create new blueprint
        const { data: newBp, error: bpErr } = await supabase
          .from("recipe_blueprints" as any)
          .insert({
            location_id: locationId,
            name: recipeName.trim(),
            category: category || "PREP",
            yield_qty: parseFloat(yieldQty),
            yield_unit: yieldUnit,
            source: "manual",
          } as any)
          .select("id").single();
        if (bpErr || !newBp) throw bpErr || new Error("Failed to create blueprint");

        const blueprintId = (newBp as any).id;

        // Insert ingredients
        const ingInserts = ingredients.map(ing => ({
          blueprint_id: blueprintId,
          ingredient_type: ing.type,
          vendor_item_id: ing.type === "vendor_item" ? ing.ref_id : null,
          sub_blueprint_id: ing.type === "blueprint" ? ing.ref_id : null,
          quantity: ing.quantity,
          unit: normalizeUnit(ing.unit) || ing.unit,
        }));
        if (ingInserts.length > 0) {
          const { error: ingErr } = await supabase.from("recipe_blueprint_ingredients" as any).insert(ingInserts);
          if (ingErr) throw ingErr;
        }

        // Create countable item if needed
        if (countable) {
          const { data: newItem, error: itemErr } = await supabase
            .from("inventory_items")
            .insert({
              location_id: locationId,
              name: recipeName.trim(),
              unit: yieldUnit,
              is_recipe: false,
              is_active: true,
              recipe_yield_qty: parseFloat(yieldQty),
              recipe_yield_unit: yieldUnit,
              count_unit: yieldUnit,
              count_units_per_case: parseFloat(yieldQty),
              cost_per_unit: batchCost,
              display_order: 0,
              countable: true,
              pan_sizes: panSizesConfig as any,
            } as any)
            .select("id").single();
          if (itemErr || !newItem) throw itemErr || new Error("Failed to create countable item");
          await supabase.from("recipe_blueprints" as any).update({ produces_item_id: newItem.id } as any).eq("id", blueprintId);
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inventory-items", locationId] });
      queryClient.invalidateQueries({ queryKey: ["inventory-items-usage", locationId] });
      queryClient.invalidateQueries({ queryKey: ["vendor-items-for-recipe", locationId] });
      queryClient.invalidateQueries({ queryKey: ["blueprints-for-recipe", locationId] });
      queryClient.invalidateQueries({ queryKey: ["blueprint-recipes", locationId] });
      queryClient.invalidateQueries({ queryKey: ["blueprint-costs", locationId] });
      if (bomMenuItemId) {
        queryClient.invalidateQueries({ queryKey: ["recipe-catalog-items", locationId] });
        queryClient.invalidateQueries({ queryKey: ["recipe-row-ingredients"] });
        queryClient.invalidateQueries({ queryKey: ["recipe-row-costs"] });
        queryClient.invalidateQueries({ queryKey: ["bom-recipe-detail", bomMenuItemId] });
      }
      if (editBlueprintId) {
        queryClient.invalidateQueries({ queryKey: ["blueprint-detail", editBlueprintId] });
      }
      toast.success(editBlueprintId || editRecipeId || bomMenuItemId ? "Recipe updated" : "Recipe created");
      resetForm();
      onOpenChange(false);
    },
    onError: (err: any) => {
      toast.error(err?.message || "Failed to save recipe");
    },
  });

  // ========== HELPERS ==========

  const resetForm = () => {
    setRecipeName("");
    setCategory("");
    setYieldQty("");
    setYieldUnit("oz");
    setYieldManuallyEdited(false);
    setIngredients([]);
    setAddingIngredient(false);
    setIngredientSearch("");
    setSelectedItem(null);
    setIngredientQty("");
    setIngredientUnit("oz");
    setCountable(true);
    setPanSizesConfig(null);
    setSuggestedPrice("");
  };

  const addIngredient = () => {
    if (!selectedItem || !ingredientQty || parseFloat(ingredientQty) <= 0) {
      toast.error("Select an item and enter a quantity");
      return;
    }
    if (ingredients.some(i => i.ref_id === selectedItem.id)) {
      toast.error("Item already in recipe");
      return;
    }
    setIngredients(prev => [...prev, {
      type: selectedItem.item_type,
      ref_id: selectedItem.id,
      quantity: parseFloat(ingredientQty),
      unit: normalizeUnit(ingredientUnit) || ingredientUnit,
    }]);
    setSelectedItem(null);
    setIngredientQty("");
    setIngredientSearch("");
    setAddingIngredient(false);
  };

  const removeIngredient = (refId: string) => {
    setIngredients(prev => prev.filter(i => i.ref_id !== refId));
  };

  const getItemName = (ing: BuilderIngredient) => {
    if (ing.type === "blueprint") {
      return otherBlueprints?.find(b => b.id === ing.ref_id)?.name || ing.displayName || "Unknown Blueprint";
    }
    return vendorItems?.find(i => i.id === ing.ref_id)?.name || ing.displayName || "Unknown";
  };

  const filteredItems = useMemo(() => {
    const search = ingredientSearch.toLowerCase().trim();
    return searchableItems
      .filter(i => !ingredients.some(ing => ing.ref_id === i.id))
      .filter(i => !search || i.name.toLowerCase().includes(search));
  }, [searchableItems, ingredientSearch, ingredients]);

  // ========== RENDER ==========

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) resetForm(); onOpenChange(o); }}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FlaskConical className="h-5 w-5" />
            {editBlueprintId || editRecipeId || bomMenuItemId ? "Edit Recipe" : "Create Prep Recipe"}
            {bomMenuItemId && bomRecipe?.menuItem?.category && (
              <Badge variant="outline" className="text-[10px] ml-auto uppercase">{bomRecipe.menuItem.category}</Badge>
            )}
            {editBlueprintId && existingBlueprint?.blueprint?.source === "r365_import" && (
              <Badge variant="outline" className="bg-blue-500/10 text-blue-600 border-blue-500/30 text-[10px] ml-auto">
                <RefreshCw className="h-3 w-3 mr-1" />R365 Synced
              </Badge>
            )}
            {!bomMenuItemId && !editBlueprintId && existingRecipe?.item && (existingRecipe.item as any).source === "r365_import" && (
              <Badge variant="outline" className="bg-blue-500/10 text-blue-600 border-blue-500/30 text-[10px] ml-auto">
                <RefreshCw className="h-3 w-3 mr-1" />R365 Synced
              </Badge>
            )}
          </DialogTitle>
          {bomMenuItemId && (
            <p className="text-xs text-muted-foreground">Editing BOM recipe. Changes save to the recipe catalog.</p>
          )}
        </DialogHeader>

        <div className="space-y-4">
          {/* Recipe Name */}
          <div className="space-y-2">
            <Label>Recipe Name</Label>
            <Input placeholder="e.g., Dough, Red Sauce, Pesto Blend" value={recipeName} onChange={(e) => setRecipeName(e.target.value)} autoFocus />
          </div>

          {/* Yield */}
          <div className="space-y-2">
            <Label>Recipe Yield (one batch makes...)</Label>
            <div className="flex items-center gap-2">
              <Input type="number" step="0.1" placeholder="auto from ingredients" value={yieldQty}
                onChange={(e) => { setYieldQty(e.target.value); setYieldManuallyEdited(true); }} className="flex-1" />
              <Select value={yieldUnit} onValueChange={(newUnit) => {
                if (yieldQty && parseFloat(yieldQty) > 0) {
                  const converted = convertYield(parseFloat(yieldQty), yieldUnit, newUnit);
                  setYieldQty(parseFloat(converted.toFixed(2)).toString());
                }
                setYieldUnit(newUnit);
              }}>
                <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {UNIT_OPTIONS.map(u => (<SelectItem key={u} value={u}>{u}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
            <p className="text-xs text-muted-foreground">
              {yieldManuallyEdited ? "Manually set — " : "Auto-calculated from ingredients — "}
              <button type="button" className="underline" onClick={() => {
                setYieldManuallyEdited(false);
                const rounded = parseFloat(autoYield.toFixed(2));
                setYieldQty(rounded > 0 ? rounded.toString() : "");
              }}>
                {yieldManuallyEdited ? "reset to auto" : "edit manually"}
              </button>
            </p>
          </div>

          {/* Ingredients List */}
          <div className="space-y-2">
            <Label>Ingredients</Label>
            {ingredients.length > 0 ? (
              <div className="space-y-1 border rounded-md p-2">
                {ingredients.map(ing => {
                  const displayName = getItemName(ing);
                  let ingCost: number | null = null;

                  if (ing.type === "vendor_item") {
                    const item = vendorItems?.find(i => i.id === ing.ref_id);
                    if (item?.cost_per_unit != null) {
                      const ingUnit = normalizeUnit(ing.unit);
                      if (item.is_recipe) {
                        const ryu = normalizeUnit(item.recipe_yield_unit) || "oz";
                        const yqv = item.recipe_yield_qty || 0;
                        if (yqv > 0) {
                          ingCost = ((ing.quantity * (TO_OZ[ingUnit] ?? 1)) / (yqv * (TO_OZ[ryu] ?? 1))) * item.cost_per_unit;
                        }
                      } else {
                        let upc = item.count_units_per_case;
                        let nu = normalizeUnit(item.count_unit);
                        if ((!upc || !nu) && item.pack_size) {
                          const p = parsePackSize(item.pack_size);
                          if (p) { if (!upc) upc = p.count; if (!nu) nu = normalizeUnit(p.unit); }
                        }
                        nu = nu || "ea";
                        if (ingUnit === "cs") ingCost = ing.quantity * item.cost_per_unit;
                        else if (ingUnit === "cn") {
                          const cpc = parseCansPerCase(item.pack_size);
                          if (cpc && cpc > 0) ingCost = (ing.quantity / cpc) * item.cost_per_unit;
                        } else if (ingUnit === nu && upc && upc > 0) {
                          ingCost = (ing.quantity / upc) * item.cost_per_unit;
                        } else if (upc && upc > 0 && TO_OZ[ingUnit] && TO_OZ[nu]) {
                          ingCost = ((ing.quantity * TO_OZ[ingUnit]) / TO_OZ[nu] / upc) * item.cost_per_unit;
                        }
                      }
                    }
                  }

                  return (
                    <div key={ing.ref_id} className={`flex items-center justify-between py-1.5 px-2 rounded text-sm ${ing.unmapped ? "bg-amber-500/10 border border-amber-500/20" : "bg-muted/50"}`}>
                      <div className="flex items-center gap-2 min-w-0">
                        {ing.type === "blueprint" && <FlaskConical className="h-3 w-3 text-muted-foreground flex-shrink-0" />}
                        {ing.unmapped && <AlertCircle className="h-3 w-3 text-amber-500 flex-shrink-0" />}
                        <span className={`font-medium truncate ${ing.unmapped ? "text-amber-700 dark:text-amber-400" : ""}`}>
                          {displayName}
                          {ing.unmapped && <span className="text-[10px] ml-1 font-normal opacity-70">(needs mapping)</span>}
                        </span>
                        <span className="text-muted-foreground font-mono text-xs flex-shrink-0">
                          {ing.quantity} {ing.unit}
                          {ingCost !== null && <span className="ml-1">· ${ingCost.toFixed(2)}</span>}
                        </span>
                      </div>
                      <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive hover:text-destructive flex-shrink-0"
                        onClick={() => removeIngredient(ing.ref_id)}>
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground italic py-2">No ingredients added yet</p>
            )}

            {/* Add ingredient form */}
            {addingIngredient ? (
              <div className="border rounded-md p-3 space-y-2 bg-muted/30">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input placeholder="Search items & recipes..." value={ingredientSearch}
                    onChange={(e) => setIngredientSearch(e.target.value)} className="h-8 pl-8 text-xs" />
                </div>
                {filteredItems.length > 0 && (
                  <div className="max-h-32 overflow-y-auto border rounded-md">
                    {filteredItems.slice(0, 20).map(item => (
                      <button key={item.id} type="button"
                        className={`w-full text-left text-xs py-1.5 px-2 hover:bg-accent ${selectedItem?.id === item.id ? "bg-accent font-medium" : ""}`}
                        onClick={() => {
                          setSelectedItem(item);
                          if (item.item_type === "blueprint") {
                            setIngredientUnit(normalizeUnit(item.yield_unit || "oz") || "oz");
                          } else if (item.is_recipe) {
                            setIngredientUnit(normalizeUnit(item.recipe_yield_unit || item.count_unit || "oz") || "oz");
                          } else {
                            const parsed = parsePackSize(item.pack_size || null);
                            const unit = normalizeUnit(item.count_unit || parsed?.unit || "ea") || "ea";
                            const isCan = parseCansPerCase(item.pack_size || null) !== null;
                            setIngredientUnit(isCan ? "cn" : unit);
                          }
                        }}
                      >
                        {item.item_type === "blueprint" && <FlaskConical className="h-3 w-3 inline mr-1 text-primary" />}
                        {item.is_recipe && item.item_type === "vendor_item" && <FlaskConical className="h-3 w-3 inline mr-1 text-muted-foreground" />}
                        {item.name}
                        {item.item_type === "blueprint" && (
                          <span className="text-muted-foreground ml-2">
                            {item.yield_qty} {item.yield_unit || "oz"}/batch
                          </span>
                        )}
                        {item.item_type === "vendor_item" && !item.is_recipe && (
                          <span className="text-muted-foreground ml-2">
                            {item.cost_per_unit ? `$${item.cost_per_unit.toFixed(2)}/cs` : ""}
                            {(() => {
                              const parsed = parsePackSize(item.pack_size || null);
                              const unit = item.count_unit || parsed?.unit;
                              const upc = item.count_units_per_case || parsed?.count;
                              const cpc = parseCansPerCase(item.pack_size || null);
                              return cpc ? ` · ${cpc} cn/cs` : unit ? ` · ${upc || "?"} ${unit}/cs` : "";
                            })()}
                          </span>
                        )}
                        {item.item_type === "vendor_item" && item.is_recipe && (
                          <span className="text-muted-foreground ml-2">
                            {item.cost_per_unit != null ? `$${item.cost_per_unit.toFixed(2)}/batch` : ""}
                            {` · ${item.recipe_yield_qty || 0} ${item.recipe_yield_unit || "oz"}/batch`}
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
                {selectedItem && (() => {
                  let unitOptions: string[];
                  if (selectedItem.item_type === "blueprint") {
                    const bpUnit = normalizeUnit(selectedItem.yield_unit) || "oz";
                    unitOptions = Array.from(new Set([bpUnit, "oz", "qt", "gal"]));
                  } else if (selectedItem.is_recipe) {
                    const ryu = normalizeUnit(selectedItem.recipe_yield_unit) || "oz";
                    unitOptions = Array.from(new Set([ryu, "oz", "qt", "gal"]));
                  } else {
                    const parsed = parsePackSize(selectedItem.pack_size || null);
                    const nu = normalizeUnit(selectedItem.count_unit || parsed?.unit || "ea") || "ea";
                    const isCan = parseCansPerCase(selectedItem.pack_size || null) !== null;
                    unitOptions = Array.from(new Set([...(isCan ? ["cn"] : []), nu, "cs", "oz", "tbsp", "tsp"]));
                  }
                  return (
                    <div className="flex items-center gap-2">
                      <Input type="number" step="0.1" placeholder="Qty" value={ingredientQty}
                        onChange={(e) => setIngredientQty(e.target.value)} className="h-8 w-20 text-xs" autoFocus />
                      <Select value={ingredientUnit} onValueChange={setIngredientUnit}>
                        <SelectTrigger className="h-8 w-20 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {unitOptions.map(u => (
                            <SelectItem key={u} value={u} className="text-xs">
                              {u === "cs" ? "cs (case)" : u === "cn" ? "cn (can)" : u}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button size="sm" className="h-8 text-xs" onClick={addIngredient}>Add</Button>
                      <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => {
                        setAddingIngredient(false); setSelectedItem(null); setIngredientSearch("");
                      }}>Cancel</Button>
                    </div>
                  );
                })()}
              </div>
            ) : (
              <Button variant="outline" size="sm" className="text-xs" onClick={() => setAddingIngredient(true)}>
                <Plus className="h-3 w-3 mr-1" />Add Ingredient
              </Button>
            )}
          </div>

          {/* Cost Summary */}
          {ingredients.length > 0 && (
            <div className="border rounded-md p-3 bg-muted/30 space-y-2">
              <p className="text-xs font-medium">Recipe Cost</p>
              {recipeCost !== null && recipeCost > 0 ? (
                <>
                  <p className="text-sm font-mono">
                    {costPerYieldUnit !== null && costPerYieldUnit !== recipeCost ? (
                      <>Batch cost: <span className="font-semibold">${recipeCost.toFixed(2)}</span></>
                    ) : (
                      <>Cost per unit: <span className="font-semibold">${recipeCost.toFixed(2)}</span></>
                    )}
                  </p>
                  {costPerYieldUnit !== null && costPerYieldUnit !== recipeCost && (
                    <p className="text-xs text-muted-foreground font-mono">= ${costPerYieldUnit.toFixed(4)}/{yieldUnit}</p>
                  )}
                  {recipeCostResult && !recipeCostResult.allHaveCost && (
                    <p className="text-xs text-muted-foreground italic">
                      ⚠ Partial — {recipeCostResult.missingItems.length} ingredient{recipeCostResult.missingItems.length > 1 ? "s" : ""} missing cost data
                    </p>
                  )}
                  <div className="border-t border-border/40 pt-2 mt-2">
                    <Label className="text-xs text-muted-foreground">Menu Price</Label>
                    <div className="flex items-center gap-2 mt-1">
                      <div className="relative w-28">
                        <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">$</span>
                        <Input type="number" step="0.01" min="0" placeholder="0.00" value={suggestedPrice}
                          onChange={(e) => setSuggestedPrice(e.target.value)} className="h-8 pl-6 text-xs font-mono" />
                      </div>
                      {suggestedPrice && parseFloat(suggestedPrice) > 0 && recipeCost > 0 && (
                        <Badge variant="outline" className={`font-mono text-xs ${
                          (recipeCost / parseFloat(suggestedPrice)) * 100 <= 20 ? "border-green-500/50 text-green-600 dark:text-green-400" :
                          (recipeCost / parseFloat(suggestedPrice)) * 100 <= 25 ? "border-yellow-500/50 text-yellow-600 dark:text-yellow-400" :
                          "border-red-500/50 text-red-600 dark:text-red-400"
                        }`}>
                          {((recipeCost / parseFloat(suggestedPrice)) * 100).toFixed(1)}% food cost
                        </Badge>
                      )}
                    </div>
                  </div>
                </>
              ) : (
                <p className="text-xs text-muted-foreground italic">No ingredient cost data available</p>
              )}
            </div>
          )}

          {/* Countable toggle */}
          {!bomMenuItemId && (
            <div className="flex items-center justify-between py-2">
              <div className="space-y-0.5">
                <Label className="text-sm font-medium">Show in inventory count</Label>
                <p className="text-xs text-muted-foreground">
                  {countable ? "This recipe will appear as a countable item" : "Hidden from counting (used as ingredient only)"}
                </p>
              </div>
              <Switch checked={countable} onCheckedChange={setCountable} />
            </div>
          )}

          {/* Pan Sizes */}
          {!bomMenuItemId && countable && (
            <PanSizesSection value={panSizesConfig} onChange={setPanSizesConfig} />
          )}

          {/* Actions */}
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => { resetForm(); onOpenChange(false); }}>Cancel</Button>
            <Button className="flex-1" onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending || !recipeName.trim() || ingredients.length === 0}>
              {saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> :
                (editBlueprintId || editRecipeId || bomMenuItemId) ? "Update Recipe" : "Create Recipe"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default RecipeBuilderDialog;
