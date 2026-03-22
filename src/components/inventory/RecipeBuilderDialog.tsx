import { useState, useMemo, useEffect } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, X, Loader2, Search, FlaskConical, Eye, EyeOff, RefreshCw } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import PanSizesSection from "./PanSizesSection";
import type { PanSizesConfig } from "./PanSizesSection";

interface RecipeBuilderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  locationId: string;
  editRecipeId?: string | null;
}

interface RecipeIngredient {
  ingredient_item_id: string;
  quantity: number;
  unit: string;
}

const UNIT_OPTIONS = ["oz", "qt", "gal", "lb", "kg", "g", "ea", "tbsp", "tsp", "ml", "cups", "bags", "ct"];

// Conversion factors to oz (base unit for auto-calc)
const TO_OZ: Record<string, number> = {
  oz: 1, qt: 32, lb: 16, gal: 128, tbsp: 0.5, tsp: 0.1667, ml: 0.033814, cups: 8, ea: 1, bags: 1, ct: 1, kg: 35.274, g: 0.03527,
};

const PACK_UNIT_MAP: Record<string, string> = {
  OZ: "oz", LB: "lb", GA: "gal", GAL: "gal", ML: "ml", CT: "ct", EA: "ea", CN: "ea", KG: "kg", G: "g",
};

// Standard can sizes in oz
const CAN_SIZES: Record<string, number> = { "10": 106, "5": 56, "2.5": 26 };

/** Detect if pack_size is can-based, return cans per case */
const parseCansPerCase = (packSize: string | null): number | null => {
  if (!packSize) return null;
  const canMatch = packSize.match(/^(\d+)\s*\/\s*#(\d+\.?\d*)\s*([A-Za-z]+)$/);
  if (canMatch) return parseInt(canMatch[1]);
  return null;
};

/** Parse pack_size like "1/5 GA", "6/#10 CN", "10/33 OZ", "25#", "6/5#" */
const parsePackSize = (packSize: string | null): { count: number; unit: string } | null => {
  if (!packSize) return null;
  // Handle #N can notation: "6/#10 CN" → 6 cans
  const canMatch = packSize.match(/^(\d+)\s*\/\s*#(\d+\.?\d*)\s*([A-Za-z]+)$/);
  if (canMatch) {
    const packs = parseInt(canMatch[1]);
    const canSize = canMatch[2];
    const rawUnit = canMatch[3].toUpperCase();
    const unit = PACK_UNIT_MAP[rawUnit];
    if (!unit) return null;
    const ozPerCan = CAN_SIZES[canSize];
    if (ozPerCan) return { count: packs * ozPerCan, unit: "oz" };
    return { count: packs, unit: unit };
  }
  // Handle # (pound) notation: "6/5#" → 6 * 5 lb, "25#" → 25 lb
  const poundSlash = packSize.match(/^(\d+)\s*\/\s*(\d+\.?\d*)\s*#$/);
  if (poundSlash) {
    return { count: parseInt(poundSlash[1]) * parseFloat(poundSlash[2]), unit: "lb" };
  }
  const poundStandalone = packSize.match(/^(\d+\.?\d*)\s*#$/);
  if (poundStandalone) {
    return { count: parseFloat(poundStandalone[1]), unit: "lb" };
  }
  // Standard notation: "1/5 GA", "10/33 OZ"
  const match = packSize.match(/^(\d+)\s*\/\s*(\d+\.?\d*)\s*([A-Za-z]+)$/);
  if (!match) return null;
  const packs = parseInt(match[1]);
  const sizePerPack = parseFloat(match[2]);
  const rawUnit = match[3].toUpperCase();
  const unit = PACK_UNIT_MAP[rawUnit];
  if (!unit) return null;
  return { count: packs * sizePerPack, unit };
};

const convertYield = (qty: number, fromUnit: string, toUnit: string): number => {
  const fromFactor = TO_OZ[fromUnit] ?? 1;
  const toFactor = TO_OZ[toUnit] ?? 1;
  return (qty * fromFactor) / toFactor;
};

const RecipeBuilderDialog = ({ open, onOpenChange, locationId, editRecipeId }: RecipeBuilderDialogProps) => {
  const queryClient = useQueryClient();
  const [recipeName, setRecipeName] = useState("");
  const [yieldQty, setYieldQty] = useState("");
  const [yieldUnit, setYieldUnit] = useState("oz");
  const [yieldManuallyEdited, setYieldManuallyEdited] = useState(false);
  const [ingredients, setIngredients] = useState<RecipeIngredient[]>([]);
  const [addingIngredient, setAddingIngredient] = useState(false);
  const [ingredientSearch, setIngredientSearch] = useState("");
  const [selectedIngredientId, setSelectedIngredientId] = useState("");
  const [ingredientQty, setIngredientQty] = useState("");
  const [ingredientUnit, setIngredientUnit] = useState("oz");
  const [countable, setCountable] = useState(true);
  const [panSizesConfig, setPanSizesConfig] = useState<PanSizesConfig | null>(null);
  const [suggestedPrice, setSuggestedPrice] = useState("");

  // Fetch available inventory items (raw items + other recipes)
  const { data: availableItems } = useQuery({
    queryKey: ["inventory-items-for-recipe", locationId, editRecipeId],
    queryFn: async () => {
      let query = supabase
        .from("inventory_items")
        .select("id, name, unit, cost_per_unit, pack_size, count_unit, count_units_per_case, is_recipe, recipe_yield_qty, recipe_yield_unit")
        .eq("location_id", locationId)
        .eq("is_active", true)
        .order("name");
      // Exclude the recipe being edited to prevent self-reference
      if (editRecipeId) {
        query = query.neq("id", editRecipeId);
      }
      const { data, error } = await query;
      if (error) throw error;
      return data;
      if (error) throw error;
      return data;
    },
    enabled: open,
  });

  // Fetch existing recipe data if editing
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
    enabled: open && !!editRecipeId,
  });

  // Auto-calculate yield from ingredients (sum in current yieldUnit)
  const autoYield = useMemo(() => {
    if (ingredients.length === 0) return 0;
    let totalOz = 0;
    for (const ing of ingredients) {
      if (ing.unit === "cn") {
        // Resolve can to oz using the item's pack_size
        const item = availableItems?.find(i => i.id === ing.ingredient_item_id);
        const canMatch = item?.pack_size?.match(/^(\d+)\s*\/\s*#(\d+\.?\d*)\s*([A-Za-z]+)$/);
        const ozPerCan = canMatch ? (CAN_SIZES[canMatch[2]] || 1) : 1;
        totalOz += ing.quantity * ozPerCan;
      } else if (ing.unit === "cs") {
        // Resolve case to oz using pack_size
        const item = availableItems?.find(i => i.id === ing.ingredient_item_id);
        const parsed = item?.pack_size ? parsePackSize(item.pack_size) : null;
        const upc = item?.count_units_per_case || parsed?.count || 1;
        const nativeUnit = item?.count_unit || parsed?.unit || "oz";
        totalOz += upc * (TO_OZ[nativeUnit] ?? 1);
      } else {
        const factor = TO_OZ[ing.unit] ?? 1;
        totalOz += ing.quantity * factor;
      }
    }
    const toFactor = TO_OZ[yieldUnit] ?? 1;
    return totalOz / toFactor;
  }, [ingredients, yieldUnit, availableItems]);

  // Auto-fill yield when ingredients change (unless manually edited)
  const prevAutoYield = useState({ val: 0 });
  if (!yieldManuallyEdited && autoYield > 0 && autoYield !== prevAutoYield[0].val) {
    prevAutoYield[0].val = autoYield;
    const rounded = parseFloat(autoYield.toFixed(2));
    if (yieldQty !== rounded.toString()) {
      setYieldQty(rounded.toString());
    }
  }

  // Populate form when editing
  useEffect(() => {
    if (existingRecipe?.item) {
      setRecipeName(existingRecipe.item.name);
      setYieldQty(existingRecipe.item.recipe_yield_qty?.toString() || "");
      setYieldUnit(existingRecipe.item.recipe_yield_unit || "oz");
      setYieldManuallyEdited(true);
      setCountable((existingRecipe.item as any).countable !== false);
      setPanSizesConfig(existingRecipe.item.pan_sizes ? (existingRecipe.item.pan_sizes as unknown as PanSizesConfig) : null);
      setIngredients(existingRecipe.ingredients.map(i => ({
        ingredient_item_id: i.ingredient_item_id,
        quantity: Number(i.quantity),
        unit: i.unit,
      })));
    }
  }, [existingRecipe]);

  // Calculate total recipe cost from ingredients
  const recipeCostResult = useMemo(() => {
    if (!availableItems || ingredients.length === 0) return null;
    let total = 0;
    let allHaveCost = true;
    const missingItems: string[] = [];

    for (const ing of ingredients) {
      const item = availableItems.find(i => i.id === ing.ingredient_item_id);
      if (!item) {
        allHaveCost = false;
        missingItems.push(ing.ingredient_item_id);
        continue;
      }
      // Items with no cost (e.g. Water) are treated as $0, not "missing"
      if (item.cost_per_unit == null) {
        continue;
      }

      if (item.is_recipe) {
        // Recipe ingredient: cost = (qty_in_oz / yield_in_oz) * batch_cost
        const yieldUnit = item.recipe_yield_unit || "oz";
        const yieldQtyVal = item.recipe_yield_qty || 0;
        if (yieldQtyVal > 0) {
          const ingOz = ing.quantity * (TO_OZ[ing.unit] ?? 1);
          const yieldOz = yieldQtyVal * (TO_OZ[yieldUnit] ?? 1);
          total += (ingOz / yieldOz) * item.cost_per_unit;
        } else {
          allHaveCost = false;
          missingItems.push(item.name);
        }
        continue;
      }

      // Get unit info — use structured fields, fallback to parsing pack_size
      let upc = item.count_units_per_case;
      let nativeUnit = item.count_unit;
      if ((!upc || !nativeUnit) && item.pack_size) {
        const parsed = parsePackSize(item.pack_size);
        if (parsed) {
          if (!upc) upc = parsed.count;
          if (!nativeUnit) nativeUnit = parsed.unit;
        }
      }
      nativeUnit = nativeUnit || "ea";

      if (ing.unit === "cs") {
        total += ing.quantity * item.cost_per_unit;
      } else if (ing.unit === "cn") {
        const cansPerCase = parseCansPerCase(item.pack_size);
        if (cansPerCase && cansPerCase > 0) {
          total += (ing.quantity / cansPerCase) * item.cost_per_unit;
        } else {
          allHaveCost = false;
          missingItems.push(item.name);
        }
      } else if (ing.unit === nativeUnit && upc && upc > 0) {
        const casesUsed = ing.quantity / upc;
        total += casesUsed * item.cost_per_unit;
      } else if (upc && upc > 0 && TO_OZ[ing.unit] && TO_OZ[nativeUnit]) {
        const ingInOz = ing.quantity * TO_OZ[ing.unit];
        const nativeInOz = TO_OZ[nativeUnit];
        const ingInNativeUnits = ingInOz / nativeInOz;
        const casesUsed = ingInNativeUnits / upc;
        total += casesUsed * item.cost_per_unit;
      } else {
        allHaveCost = false;
        missingItems.push(item.name);
      }
    }

    return { total, allHaveCost, missingItems };
  }, [ingredients, availableItems]);

  const recipeCost = recipeCostResult?.total ?? null;

  // Cost per yield unit
  const costPerYieldUnit = useMemo(() => {
    if (recipeCost === null || !yieldQty || parseFloat(yieldQty) <= 0) return null;
    return recipeCost / parseFloat(yieldQty);
  }, [recipeCost, yieldQty]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!recipeName.trim()) throw new Error("Name required");
      if (!yieldQty || parseFloat(yieldQty) <= 0) throw new Error("Yield required");
      if (ingredients.length === 0) throw new Error("Add at least one ingredient");

      // Calculate cost_per_unit as total recipe cost (cost of one batch = one "case")
      const costPerCase = recipeCost;

      if (editRecipeId) {
        // Update existing recipe item
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

        // Delete old ingredients and re-insert
        await supabase
          .from("inventory_recipe_ingredients")
          .delete()
          .eq("recipe_item_id", editRecipeId);

        const { error: ingErr } = await supabase
          .from("inventory_recipe_ingredients")
          .insert(ingredients.map(ing => ({
            recipe_item_id: editRecipeId,
            ingredient_item_id: ing.ingredient_item_id,
            quantity: ing.quantity,
            unit: ing.unit,
          })));
        if (ingErr) throw ingErr;
      } else {
        // Create new recipe item
        const { data: newItem, error: itemErr } = await supabase
          .from("inventory_items")
          .insert({
            location_id: locationId,
            name: recipeName.trim(),
            unit: "recipe",
            is_recipe: true,
            is_active: true,
            recipe_yield_qty: parseFloat(yieldQty),
            recipe_yield_unit: yieldUnit,
            count_unit: yieldUnit,
            count_units_per_case: parseFloat(yieldQty),
            cost_per_unit: costPerCase,
            display_order: 0,
            countable,
            pan_sizes: panSizesConfig as any,
          } as any)
          .select("id")
          .single();
        if (itemErr || !newItem) throw itemErr || new Error("Failed to create recipe");

        const { error: ingErr } = await supabase
          .from("inventory_recipe_ingredients")
          .insert(ingredients.map(ing => ({
            recipe_item_id: newItem.id,
            ingredient_item_id: ing.ingredient_item_id,
            quantity: ing.quantity,
            unit: ing.unit,
          })));
        if (ingErr) throw ingErr;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inventory-items", locationId] });
      queryClient.invalidateQueries({ queryKey: ["inventory-items-usage", locationId] });
      queryClient.invalidateQueries({ queryKey: ["inventory-items-for-recipe", locationId] });
      toast.success(editRecipeId ? "Recipe updated" : "Recipe created");
      resetForm();
      onOpenChange(false);
    },
    onError: (err: any) => {
      toast.error(err?.message || "Failed to save recipe");
    },
  });

  const resetForm = () => {
    setRecipeName("");
    setYieldQty("");
    setYieldUnit("oz");
    setYieldManuallyEdited(false);
    setIngredients([]);
    setAddingIngredient(false);
    setIngredientSearch("");
    setSelectedIngredientId("");
    setIngredientQty("");
    setIngredientUnit("oz");
    setCountable(true);
    setPanSizesConfig(null);
  };

  const addIngredient = () => {
    if (!selectedIngredientId || !ingredientQty || parseFloat(ingredientQty) <= 0) {
      toast.error("Select an item and enter a quantity");
      return;
    }
    if (ingredients.some(i => i.ingredient_item_id === selectedIngredientId)) {
      toast.error("Item already in recipe");
      return;
    }
    setIngredients(prev => [...prev, {
      ingredient_item_id: selectedIngredientId,
      quantity: parseFloat(ingredientQty),
      unit: ingredientUnit,
    }]);
    setSelectedIngredientId("");
    setIngredientQty("");
    setIngredientSearch("");
    setAddingIngredient(false);
  };

  const removeIngredient = (itemId: string) => {
    setIngredients(prev => prev.filter(i => i.ingredient_item_id !== itemId));
  };

  const getItemName = (itemId: string) =>
    availableItems?.find(i => i.id === itemId)?.name || "Unknown";

  const filteredItems = useMemo(() => {
    if (!availableItems) return [];
    const search = ingredientSearch.toLowerCase().trim();
    return availableItems
      .filter(i => !ingredients.some(ing => ing.ingredient_item_id === i.id))
      .filter(i => !search || i.name.toLowerCase().includes(search));
  }, [availableItems, ingredientSearch, ingredients]);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) resetForm(); onOpenChange(o); }}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FlaskConical className="h-5 w-5" />
            {editRecipeId ? "Edit Recipe" : "Create Prep Recipe"}
            {existingRecipe?.item && (existingRecipe.item as any).source === 'r365_import' && (
              <Badge variant="outline" className="bg-blue-500/10 text-blue-600 border-blue-500/30 text-[10px] ml-auto">
                <RefreshCw className="h-3 w-3 mr-1" />
                R365 Synced
              </Badge>
            )}
          </DialogTitle>
          {existingRecipe?.item && (existingRecipe.item as any).source === 'r365_import' && (
            <p className="text-xs text-muted-foreground">
              This recipe was imported from R365. Manual edits may be flagged on the next import.
            </p>
          )}
        </DialogHeader>

        <div className="space-y-4">
          {/* Recipe Name */}
          <div className="space-y-2">
            <Label>Recipe Name</Label>
            <Input
              placeholder="e.g., Dough, Red Sauce, Pesto Blend"
              value={recipeName}
              onChange={(e) => setRecipeName(e.target.value)}
              autoFocus
            />
          </div>

          {/* Yield */}
          <div className="space-y-2">
            <Label>Recipe Yield (one batch makes...)</Label>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                step="0.1"
                placeholder="auto from ingredients"
                value={yieldQty}
                onChange={(e) => {
                  setYieldQty(e.target.value);
                  setYieldManuallyEdited(true);
                }}
                className="flex-1"
              />
              <Select value={yieldUnit} onValueChange={(newUnit) => {
                // Convert existing yield to new unit
                if (yieldQty && parseFloat(yieldQty) > 0) {
                  const converted = convertYield(parseFloat(yieldQty), yieldUnit, newUnit);
                  setYieldQty(parseFloat(converted.toFixed(2)).toString());
                }
                setYieldUnit(newUnit);
              }}>
                <SelectTrigger className="w-24">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {UNIT_OPTIONS.map(u => (
                    <SelectItem key={u} value={u}>{u}</SelectItem>
                  ))}
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
                  // Calculate per-ingredient cost
                  const item = availableItems?.find(i => i.id === ing.ingredient_item_id);
                  let ingCost: number | null = null;
                  if (item?.cost_per_unit != null) {
                    if (item.is_recipe) {
                      // Recipe ingredient: cost = (qty_in_oz / yield_in_oz) * batch_cost
                      const yieldUnit = item.recipe_yield_unit || "oz";
                      const yieldQtyVal = item.recipe_yield_qty || 0;
                      if (yieldQtyVal > 0) {
                        const ingOz = ing.quantity * (TO_OZ[ing.unit] ?? 1);
                        const yieldOz = yieldQtyVal * (TO_OZ[yieldUnit] ?? 1);
                        ingCost = (ingOz / yieldOz) * item.cost_per_unit;
                      }
                    } else {
                      let upc = item.count_units_per_case;
                      let nativeUnit = item.count_unit;
                      if ((!upc || !nativeUnit) && item.pack_size) {
                        const parsed = parsePackSize(item.pack_size);
                        if (parsed) { if (!upc) upc = parsed.count; if (!nativeUnit) nativeUnit = parsed.unit; }
                      }
                      nativeUnit = nativeUnit || "ea";
                      if (ing.unit === "cs") {
                        ingCost = ing.quantity * item.cost_per_unit;
                      } else if (ing.unit === "cn") {
                        const cpc = parseCansPerCase(item.pack_size);
                        if (cpc && cpc > 0) ingCost = (ing.quantity / cpc) * item.cost_per_unit;
                      } else if (ing.unit === nativeUnit && upc && upc > 0) {
                        ingCost = (ing.quantity / upc) * item.cost_per_unit;
                      } else if (upc && upc > 0 && TO_OZ[ing.unit] && TO_OZ[nativeUnit]) {
                        const ingInNative = (ing.quantity * TO_OZ[ing.unit]) / TO_OZ[nativeUnit];
                        ingCost = (ingInNative / upc) * item.cost_per_unit;
                      }
                    }
                  }
                  return (
                  <div key={ing.ingredient_item_id} className="flex items-center justify-between py-1.5 px-2 bg-muted/50 rounded text-sm">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{getItemName(ing.ingredient_item_id)}</span>
                      <span className="text-muted-foreground font-mono text-xs">
                        {ing.quantity} {ing.unit}
                        {ingCost !== null && (
                          <span className="ml-1">· ${ingCost.toFixed(2)}</span>
                        )}
                      </span>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 text-destructive hover:text-destructive"
                      onClick={() => removeIngredient(ing.ingredient_item_id)}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground italic py-2">
                No ingredients added yet
              </p>
            )}

            {/* Add ingredient form */}
            {addingIngredient ? (
              <div className="border rounded-md p-3 space-y-2 bg-muted/30">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    placeholder="Search items..."
                    value={ingredientSearch}
                    onChange={(e) => setIngredientSearch(e.target.value)}
                    className="h-8 pl-8 text-xs"
                  />
                </div>
                {filteredItems.length > 0 && (
                  <div className="max-h-32 overflow-y-auto border rounded-md">
                    {filteredItems.slice(0, 20).map(item => (
                      <button
                        key={item.id}
                        type="button"
                        className={`w-full text-left text-xs py-1.5 px-2 hover:bg-accent ${
                          selectedIngredientId === item.id ? "bg-accent font-medium" : ""
                        }`}
                        onClick={() => {
                          setSelectedIngredientId(item.id);
                          if (item.is_recipe) {
                            // For recipe ingredients, default to yield unit
                            setIngredientUnit(item.recipe_yield_unit || item.count_unit || "oz");
                          } else {
                            const parsed = parsePackSize(item.pack_size);
                            const unit = item.count_unit || parsed?.unit || "ea";
                            const isCan = parseCansPerCase(item.pack_size) !== null;
                            setIngredientUnit(isCan ? "cn" : unit);
                          }
                        }}
                      >
                        {item.is_recipe && <FlaskConical className="h-3 w-3 inline mr-1 text-muted-foreground" />}
                        {item.name}
                        {(() => {
                          if (item.is_recipe) {
                            const yieldUnit = item.recipe_yield_unit || "oz";
                            const yieldQty = item.recipe_yield_qty || 0;
                            const batchCost = item.cost_per_unit;
                            return (
                              <span className="text-muted-foreground ml-2">
                                {batchCost != null ? `$${batchCost.toFixed(2)}/batch` : ""}
                                {` · ${yieldQty} ${yieldUnit}/batch`}
                              </span>
                            );
                          }
                          const parsed = parsePackSize(item.pack_size);
                          const unit = item.count_unit || parsed?.unit;
                          const upc = item.count_units_per_case || parsed?.count;
                          const cansPerCase = parseCansPerCase(item.pack_size);
                          return (
                            <span className="text-muted-foreground ml-2">
                              {item.cost_per_unit ? `$${item.cost_per_unit.toFixed(2)}/cs` : ""}
                              {cansPerCase ? ` · ${cansPerCase} cn/cs` : unit ? ` · ${upc || "?"} ${unit}/cs` : ""}
                            </span>
                          );
                        })()}
                      </button>
                    ))}
                  </div>
                )}
                {selectedIngredientId && (() => {
                  const selectedItem = availableItems?.find(i => i.id === selectedIngredientId);
                  if (selectedItem?.is_recipe) {
                    // For recipe ingredients: yield unit, oz (deduplicated)
                    const yieldUnit = selectedItem.recipe_yield_unit || "oz";
                    const unitOptions = Array.from(new Set([yieldUnit, "oz", "qt", "gal"]));
                    return (
                    <div className="flex items-center gap-2">
                      <Input type="number" step="0.1" placeholder="Qty" value={ingredientQty}
                        onChange={(e) => setIngredientQty(e.target.value)} className="h-8 w-20 text-xs" autoFocus />
                      <Select value={ingredientUnit} onValueChange={setIngredientUnit}>
                        <SelectTrigger className="h-8 w-20 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {unitOptions.map(u => (
                            <SelectItem key={u} value={u} className="text-xs">{u}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button size="sm" className="h-8 text-xs" onClick={addIngredient}>Add</Button>
                      <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => {
                        setAddingIngredient(false); setSelectedIngredientId(""); setIngredientSearch("");
                      }}>Cancel</Button>
                    </div>
                    );
                  }
                  const parsed = selectedItem?.pack_size ? parsePackSize(selectedItem.pack_size) : null;
                  const nativeUnit = selectedItem?.count_unit || parsed?.unit || "ea";
                  const isCan = parseCansPerCase(selectedItem?.pack_size ?? null) !== null;
                  // Build contextual unit options: cn for can items, native unit, cs, oz, tbsp, tsp (deduplicated)
                  const unitOptions = Array.from(new Set([...(isCan ? ["cn"] : []), nativeUnit, "cs", "oz", "tbsp", "tsp"]));
                  return (
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      step="0.1"
                      placeholder="Qty"
                      value={ingredientQty}
                      onChange={(e) => setIngredientQty(e.target.value)}
                      className="h-8 w-20 text-xs"
                      autoFocus
                    />
                    <Select value={ingredientUnit} onValueChange={setIngredientUnit}>
                      <SelectTrigger className="h-8 w-20 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {unitOptions.map(u => (
                          <SelectItem key={u} value={u} className="text-xs">
                            {u === "cs" ? "cs (case)" : u === "cn" ? "cn (can)" : u}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button size="sm" className="h-8 text-xs" onClick={addIngredient}>
                      Add
                    </Button>
                    <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => {
                      setAddingIngredient(false);
                      setSelectedIngredientId("");
                      setIngredientSearch("");
                    }}>
                      Cancel
                    </Button>
                  </div>
                  );
                })()}
              </div>
            ) : (
              <Button
                variant="outline"
                size="sm"
                className="text-xs"
                onClick={() => setAddingIngredient(true)}
              >
                <Plus className="h-3 w-3 mr-1" />
                Add Ingredient
              </Button>
            )}
          </div>

          {/* Cost Summary */}
          {ingredients.length > 0 && (
            <div className="border rounded-md p-3 bg-muted/30 space-y-2">
              <p className="text-xs font-medium">Recipe Cost</p>
               {recipeCost !== null ? (
                <>
                  <p className="text-sm font-mono">
                    {costPerYieldUnit !== null && costPerYieldUnit !== recipeCost ? (
                      <>Batch cost: <span className="font-semibold">${recipeCost.toFixed(2)}</span></>
                    ) : (
                      <>Cost per unit: <span className="font-semibold">${recipeCost.toFixed(2)}</span></>
                    )}
                  </p>
                  {costPerYieldUnit !== null && costPerYieldUnit !== recipeCost && (
                    <p className="text-xs text-muted-foreground font-mono">
                      = ${costPerYieldUnit.toFixed(4)}/{yieldUnit}
                    </p>
                  )}

                  {/* Food Cost % Calculator */}
                  <div className="border-t border-border/40 pt-2 mt-2">
                    <Label className="text-xs text-muted-foreground">Menu Price</Label>
                    <div className="flex items-center gap-2 mt-1">
                      <div className="relative w-28">
                        <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">$</span>
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          placeholder="0.00"
                          value={suggestedPrice}
                          onChange={(e) => setSuggestedPrice(e.target.value)}
                          className="h-8 pl-6 text-xs font-mono"
                        />
                      </div>
                      {suggestedPrice && parseFloat(suggestedPrice) > 0 && recipeCost > 0 && (
                        <Badge
                          variant="outline"
                          className={`font-mono text-xs ${
                            (recipeCost / parseFloat(suggestedPrice)) * 100 <= 20
                              ? "border-green-500/50 text-green-600 dark:text-green-400"
                              : (recipeCost / parseFloat(suggestedPrice)) * 100 <= 25
                              ? "border-yellow-500/50 text-yellow-600 dark:text-yellow-400"
                              : "border-red-500/50 text-red-600 dark:text-red-400"
                          }`}
                        >
                          {((recipeCost / parseFloat(suggestedPrice)) * 100).toFixed(1)}% food cost
                        </Badge>
                      )}
                    </div>
                  </div>
                </>
              ) : (
                <p className="text-xs text-muted-foreground italic">
                  Some ingredients not found in inventory
                </p>
              )}
            </div>
          )}

          {/* Countable toggle */}
          <div className="flex items-center justify-between py-2">
            <div className="space-y-0.5">
              <Label className="text-sm font-medium">Show in inventory count</Label>
              <p className="text-xs text-muted-foreground">
                {countable ? "This recipe will appear as a countable item" : "Hidden from counting (used as ingredient only)"}
              </p>
            </div>
            <Switch checked={countable} onCheckedChange={setCountable} />
          </div>

          {/* Pan Sizes */}
          {countable && (
            <PanSizesSection
              value={panSizesConfig}
              onChange={setPanSizesConfig}
            />
          )}

          {/* Actions */}
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => { resetForm(); onOpenChange(false); }}>
              Cancel
            </Button>
            <Button
              className="flex-1"
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending || !recipeName.trim() || ingredients.length === 0}
            >
              {saveMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                editRecipeId ? "Update Recipe" : "Create Recipe"
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default RecipeBuilderDialog;
