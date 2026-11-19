import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { AlertTriangle, ChevronDown, Copy, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { normalizeUnit } from "@/utils/unitConversion";
import { money, useBrandRecipePricing, type IngredientPricing } from "./useBrandRecipes";

const UNIT_OPTIONS = ["oz", "qt", "gal", "lb", "kg", "g", "ea", "tbsp", "tsp", "ml", "cups", "bags", "ct"];
const CATEGORY_OPTIONS: { value: string; label: string; title: string }[] = [
  { value: "MI", label: "Menu item", title: "Menu Item" },
  { value: "CORE", label: "Core", title: "Core" },
  { value: "BASE", label: "Base", title: "Base" },
  { value: "PREP", label: "Prep", title: "Prep Recipe" },
  { value: "SUB", label: "Sub-recipe", title: "Sub-recipe" },
  { value: "CATERING", label: "Catering", title: "Catering Item" },
];
const CATALOG_SECTION_OPTIONS = [
  { value: "md_pizza", label: '11" Pizzas' },
  { value: "lg_pizza", label: '14" Pizzas' },
  { value: "half_pizza", label: "Half Pizzas" },
  { value: "detroit", label: "Detroit Pizzas" },
  { value: "salads", label: "Salads" },
  { value: "sides", label: "Sides & Extras" },
  { value: "catering", label: "Catering" },
  { value: "drinks", label: "Drinks" },
  { value: "other", label: "Other" },
];
const TAG_STYLES: Record<string, string> = {
  BASE: "bg-primary/10 text-primary",
  CORE: "bg-purple-500/10 text-purple-700 dark:text-purple-300",
  MI: "bg-accent/15 text-orange-800 dark:text-orange-300",
  ITEM: "bg-muted text-muted-foreground",
};

interface Ing {
  key: string;
  type: "vendor_item" | "blueprint";
  vendor_item_id: string | null;
  sub_blueprint_id: string | null;
  name: string;
  quantity: number;
  unit: string;
  source_name: string | null;
}

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  brandId: string;
  blueprintId: string | null;
}

/**
 * Brand recipe editor. Reads and saves ONLY brand records:
 * recipe_blueprints (location_id IS NULL) + recipe_blueprint_ingredients.
 * Never creates, edits or deactivates store items. Prices are view only
 * (median across live stores, each at its own pack).
 */
const BrandRecipeDialog = ({ open, onOpenChange, brandId, blueprintId }: Props) => {
  const qc = useQueryClient();
  const isNew = !blueprintId;
  const [name, setName] = useState("");
  const [category, setCategory] = useState<string>("");
  const [catalogSection, setCatalogSection] = useState<string>("");
  const [duplicating, setDuplicating] = useState(false);
  const [openWarn, setOpenWarn] = useState<string | null>(null);
  const [yieldQty, setYieldQty] = useState("1");
  const [yieldUnit, setYieldUnit] = useState("ea");
  const [countable, setCountable] = useState(false);
  const [ings, setIngs] = useState<Ing[]>([]);
  const [saving, setSaving] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  const { data: loaded, isLoading } = useQuery({
    queryKey: ["brand-recipe-edit", blueprintId],
    enabled: open && !!blueprintId,
    queryFn: async () => {
      const [bp, ingRes] = await Promise.all([
        supabase.from("recipe_blueprints" as any)
          .select("id, name, category, catalog_section, yield_qty, yield_unit, is_countable, brand_id, location_id")
          .eq("id", blueprintId!).is("location_id", null).single(),
        supabase.from("recipe_blueprint_ingredients" as any)
          .select("id, ingredient_type, vendor_item_id, sub_blueprint_id, quantity, unit, source_name")
          .eq("blueprint_id", blueprintId!).order("id"),
      ]);
      if (bp.error) throw bp.error;
      if (ingRes.error) throw ingRes.error;
      return { bp: bp.data as any, ings: (ingRes.data || []) as any[] };
    },
  });

  // Brand items + brand sub-recipes for names and the picker
  const { data: options } = useQuery({
    queryKey: ["brand-recipe-ingredient-options", brandId],
    enabled: open,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const [tpl, bps] = await Promise.all([
        (supabase.from as any)("brand_inventory_templates")
          .select("id, common_name, product_name")
          .eq("brand_id", brandId).order("common_name"),
        supabase.from("recipe_blueprints" as any)
          .select("id, name, yield_unit, category")
          .eq("brand_id", brandId).is("location_id", null).eq("is_active", true).order("name"),
      ]);
      if (tpl.error) throw tpl.error;
      if (bps.error) throw bps.error;
      return {
        items: (tpl.data || []).map((t: any) => ({ id: t.id, name: t.common_name || t.product_name || "Item" })),
        recipes: ((bps.data || []) as any[]).map(b => ({ id: b.id, name: b.name, unit: b.yield_unit, category: (b.category || "").toUpperCase() })),
      };
    },
  });

  const { data: pricing, isFetching: pricingLoading } = useBrandRecipePricing(open ? blueprintId : null);

  useEffect(() => {
    if (!open) return;
    if (isNew) {
      setName(""); setCategory(""); setCatalogSection(""); setYieldQty("1"); setYieldUnit("ea"); setCountable(false); setIngs([]);
      return;
    }
    if (!loaded || !options) return;
    const itemName = new Map(options.items.map(i => [i.id, i.name]));
    const recName = new Map(options.recipes.map(r => [r.id, r.name]));
    setName(loaded.bp.name || "");
    setCategory((loaded.bp.category || "").toUpperCase());
    setCatalogSection(loaded.bp.catalog_section || "");
    setYieldQty(String(loaded.bp.yield_qty ?? 1));
    setYieldUnit(loaded.bp.yield_unit || "ea");
    setCountable(!!loaded.bp.is_countable);
    setIngs(loaded.ings.map((i: any) => {
      const isBp = i.ingredient_type === "blueprint" || !!i.sub_blueprint_id;
      return {
        key: i.id,
        type: isBp ? "blueprint" : "vendor_item",
        vendor_item_id: i.vendor_item_id,
        sub_blueprint_id: i.sub_blueprint_id,
        name: (isBp ? recName.get(i.sub_blueprint_id) : itemName.get(i.vendor_item_id)) || i.source_name || "Ingredient",
        quantity: Number(i.quantity) || 0,
        unit: i.unit || "oz",
        source_name: i.source_name,
      };
    }));
  }, [open, isNew, loaded, options]);

  const priceByRow = useMemo(() => {
    const m = new Map<string, IngredientPricing>();
    for (const p of pricing || []) m.set(p.ingredient_id, p);
    return m;
  }, [pricing]);

  const totalMedian = useMemo(() => {
    if (!pricing?.length) return null;
    if (pricing.some(p => p.median_cost == null)) return null;
    return pricing.reduce((s, p) => s + Number(p.median_cost), 0);
  }, [pricing]);

  const addIng = (type: Ing["type"], id: string, nm: string, unit?: string | null) => {
    setIngs(prev => [...prev, {
      key: `new-${Date.now()}-${prev.length}`, type,
      vendor_item_id: type === "vendor_item" ? id : null,
      sub_blueprint_id: type === "blueprint" ? id : null,
      name: nm, quantity: 1, unit: unit || "oz", source_name: null,
    }]);
    setPickerOpen(false);
  };

  const ingredientRows = (bpId: string) => ings.map(i => ({
    blueprint_id: bpId,
    ingredient_type: i.type,
    vendor_item_id: i.type === "vendor_item" ? i.vendor_item_id : null,
    sub_blueprint_id: i.type === "blueprint" ? i.sub_blueprint_id : null,
    quantity: i.quantity,
    unit: normalizeUnit(i.unit) || i.unit,
    source_name: i.source_name,
  }));

  const refresh = (id: string | null) => {
    qc.invalidateQueries({ queryKey: ["brand-recipes", brandId] });
    qc.invalidateQueries({ queryKey: ["brand-recipe-ingredient-options", brandId] });
    qc.invalidateQueries({ queryKey: ["brand-price-outliers", brandId] });
    if (id) {
      qc.invalidateQueries({ queryKey: ["brand-recipe-edit", id] });
      qc.invalidateQueries({ queryKey: ["brand-recipe-pricing", id] });
    }
  };

  const save = async () => {
    const y = parseFloat(yieldQty);
    if (!name.trim() || !(y > 0)) { toast.error("Name and a yield above 0 are required"); return; }
    setSaving(true);
    try {
      let id = blueprintId;
      const fields = {
        name: name.trim(), category: category || null, catalog_section: catalogSection || null,
        yield_qty: y, yield_unit: yieldUnit, is_countable: countable,
      };
      if (id) {
        const { error } = await supabase.from("recipe_blueprints" as any)
          .update(fields as any).eq("id", id).is("location_id", null).eq("brand_id", brandId);
        if (error) throw error;
      } else {
        const { data, error } = await supabase.from("recipe_blueprints" as any)
          .insert({ ...fields, brand_id: brandId, location_id: null, is_active: true, source: "manual" } as any)
          .select("id").single();
        if (error) throw error;
        id = (data as any).id;
      }
      // Ingredients: add the new rows FIRST, then remove the old ones by id.
      // If either step fails the recipe never ends up with zero ingredients.
      const oldIds: string[] = blueprintId ? (loaded?.ings || []).map((i: any) => i.id) : [];
      const rows = ingredientRows(id!);
      if (rows.length) {
        const { error } = await supabase.from("recipe_blueprint_ingredients" as any).insert(rows);
        if (error) throw error;
      }
      if (oldIds.length) {
        const { error } = await supabase.from("recipe_blueprint_ingredients" as any)
          .delete().eq("blueprint_id", id!).in("id", oldIds);
        if (error) {
          refresh(id);
          throw new Error(`New ingredients saved, but the old rows could not be removed (${error.message}). Reopen and check for doubles.`);
        }
      }
      toast.success("Brand recipe saved");
      refresh(id);
      onOpenChange(false);
    } catch (e: any) {
      toast.error("Save failed: " + (e?.message || "unknown error"));
    } finally {
      setSaving(false);
    }
  };

  /** Copy the recipe as it is on screen into a new brand record. */
  const duplicate = async () => {
    const y = parseFloat(yieldQty);
    if (!name.trim() || !(y > 0)) { toast.error("Name and a yield above 0 are required"); return; }
    setDuplicating(true);
    try {
      const { data, error } = await supabase.from("recipe_blueprints" as any)
        .insert({
          name: `${name.trim()} (copy)`, category: category || null, catalog_section: catalogSection || null,
          yield_qty: y, yield_unit: yieldUnit, is_countable: countable,
          brand_id: brandId, location_id: null, is_active: true, source: "manual",
        } as any)
        .select("id").single();
      if (error) throw error;
      const newId = (data as any).id as string;
      const rows = ingredientRows(newId);
      if (rows.length) {
        const { error: insErr } = await supabase.from("recipe_blueprint_ingredients" as any).insert(rows);
        if (insErr) {
          // Don't leave an empty copy behind
          await supabase.from("recipe_blueprints" as any).delete().eq("id", newId).is("location_id", null);
          throw insErr;
        }
      }
      toast.success(`Created "${name.trim()} (copy)"`);
      refresh(newId);
      onOpenChange(false);
    } catch (e: any) {
      toast.error("Duplicate failed: " + (e?.message || "unknown error"));
    } finally {
      setDuplicating(false);
    }
  };

  const categoryTitle = CATEGORY_OPTIONS.find(o => o.value === category)?.title || "Recipe";
  const recCategory = useMemo(() => new Map((options?.recipes || []).map(r => [r.id, r.category])), [options]);

  // Priced rows first, unpriced after (like the store builder). Keeps original index for edits.
  const displayRows = useMemo(() => {
    const withIdx = ings.map((ing, idx) => {
      const p = !ing.key.startsWith("new-") ? priceByRow.get(ing.key) : undefined;
      return { ing, idx, p, missing: !ing.key.startsWith("new-") && !pricingLoading && p?.median_cost == null };
    });
    return [...withIdx.filter(r => !r.missing), ...withIdx.filter(r => r.missing)];
  }, [ings, priceByRow, pricingLoading]);

  const partialCost = useMemo(
    () => (pricing || []).reduce((s, p) => s + (p.median_cost != null ? Number(p.median_cost) : 0), 0),
    [pricing],
  );
  const unpricedNames = displayRows.filter(r => r.missing).map(r => r.ing.name);
  const newCount = ings.filter(i => i.key.startsWith("new-")).length;

  const fieldBtn = "h-11 rounded-xl bg-background";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg p-0 gap-0 max-h-[90vh] flex flex-col overflow-hidden">
        <DialogHeader className="px-5 pt-5 pb-3 border-b border-border space-y-1 text-left">
          <div className="flex items-center gap-2 pr-8">
            <DialogTitle className="text-lg">{isNew ? "New brand recipe" : `Edit ${categoryTitle}`}</DialogTitle>
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-primary/10 text-primary">Brand</span>
            {!isNew && (
              <Button variant="outline" size="sm" className="ml-auto h-8 gap-1 text-xs"
                onClick={duplicate} disabled={duplicating || saving || isLoading}>
                {duplicating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Copy className="h-3.5 w-3.5" />}
                Duplicate
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">Brand record only. Store items are not changed here.</p>
        </DialogHeader>

        {isLoading && !isNew ? (
          <div className="py-10 flex justify-center"><Loader2 className="h-5 w-5 animate-spin" /></div>
        ) : (
          <div className="flex-1 min-h-0 min-w-0 overflow-y-auto px-5 py-4 space-y-4">
            <div className="flex gap-2.5">
              <div className="flex-[3] min-w-0 space-y-1.5">
                <Label className="text-xs font-semibold">Catalog Section</Label>
                <Select value={catalogSection || "none"} onValueChange={v => setCatalogSection(v === "none" ? "" : v)}>
                  <SelectTrigger className={fieldBtn}><SelectValue placeholder="Where does this appear?" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Auto (by name)</SelectItem>
                    {CATALOG_SECTION_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex-[2] min-w-0 space-y-1.5">
                <Label className="text-xs font-semibold">Category</Label>
                <Select value={category || "none"} onValueChange={v => setCategory(v === "none" ? "" : v)}>
                  <SelectTrigger className={fieldBtn}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {[...CATEGORY_OPTIONS, ...(category && !CATEGORY_OPTIONS.some(o => o.value === category) ? [{ value: category, label: category, title: category }] : [])]
                      .map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Recipe Name</Label>
              <Input value={name} onChange={e => setName(e.target.value)} className={fieldBtn} />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Recipe Yield (one batch makes…)</Label>
              <div className="flex gap-2">
                <Input type="number" inputMode="decimal" value={yieldQty} onChange={e => setYieldQty(e.target.value)} className={`${fieldBtn} flex-1`} />
                <Select value={yieldUnit} onValueChange={setYieldUnit}>
                  <SelectTrigger className={`${fieldBtn} w-28`}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {[...new Set([...UNIT_OPTIONS, yieldUnit])].map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-baseline justify-between gap-2">
                <Label className="text-xs font-semibold">Ingredients</Label>
                <span className="text-[11px] text-muted-foreground">Typical price across stores</span>
              </div>

              <div className="space-y-1.5">
                {displayRows.map(({ ing, idx, p, missing }) => {
                  const tag = ing.type === "blueprint" ? (recCategory.get(ing.sub_blueprint_id || "") || "SUB") : "ITEM";
                  const wide = p && p.min_cost != null && p.max_cost != null && p.min_cost > 0 && p.max_cost / p.min_cost > 1.5;
                  const outliers = p?.outliers || [];
                  const chip = outliers.length === 0 ? null
                    : outliers.length === 1
                      ? (outliers[0].problem ? `${outliers[0].store} can't price` : `${outliers[0].store} far off typical`)
                      : `${outliers.length} stores off or unpriced`;
                  return (
                    <div key={ing.key}
                      className={`rounded-xl border px-3 py-2.5 space-y-2 min-w-0 ${missing ? "bg-destructive/5 border-destructive/25" : "bg-background border-border"}`}>
                      <div className="flex items-center gap-2 min-w-0">
                        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded shrink-0 ${TAG_STYLES[tag] || TAG_STYLES.ITEM}`}>{tag}</span>
                        <p className={`flex-1 min-w-0 truncate text-sm font-semibold ${missing ? "text-destructive" : ""}`} title={ing.name}>
                          {ing.name}
                          {missing && <span className="ml-1 text-[10px] font-normal opacity-80">(no cost)</span>}
                        </p>
                        <div className="text-right shrink-0 tabular-nums">
                          {ing.key.startsWith("new-") ? <span className="text-[11px] text-muted-foreground">after save</span>
                            : pricingLoading && !p ? <span className="text-xs text-muted-foreground">…</span>
                            : missing ? <span className="text-sm text-destructive">—</span>
                            : <>
                                <span className="text-sm font-semibold">{money(p!.median_cost)}</span>
                                {wide && <span className="block text-[10px] text-muted-foreground">{money(p!.min_cost)}–{money(p!.max_cost)}</span>}
                              </>}
                        </div>
                        <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0 text-destructive hover:text-destructive"
                          onClick={() => setIngs(prev => prev.filter((_, i) => i !== idx))} aria-label={`Remove ${ing.name}`}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                      <div className="flex items-center gap-1.5 min-w-0">
                        {chip && (
                          <Popover open={openWarn === ing.key} onOpenChange={o => setOpenWarn(o ? ing.key : null)}>
                            <PopoverTrigger asChild>
                              <button type="button"
                                className="min-w-0 max-w-[220px] truncate inline-flex items-center gap-1 rounded-full bg-amber-100 dark:bg-amber-500/15 text-amber-900 dark:text-amber-300 px-2 py-0.5 text-[11px] font-semibold">
                                <AlertTriangle className="h-3 w-3 shrink-0" />
                                <span className="truncate">{chip}</span>
                                {outliers.length > 1 && <ChevronDown className="h-3 w-3 shrink-0" />}
                              </button>
                            </PopoverTrigger>
                            <PopoverContent align="start" className="w-64 p-3 space-y-1.5">
                              <p className="text-xs font-semibold">Store pricing problems</p>
                              {outliers.map((o, i) => (
                                <p key={i} className="text-xs text-muted-foreground">
                                  <span className="text-foreground font-medium">{o.store}</span>{" "}
                                  {o.problem ? `— ${o.problem}` : `— ${money(o.unit_price)}/${p!.unit_label} vs typical ${money(p!.median_unit_price)}/${p!.unit_label}`}
                                </p>
                              ))}
                              <p className="text-[11px] text-muted-foreground pt-1">Full list: Price outliers, above the recipe list.</p>
                            </PopoverContent>
                          </Popover>
                        )}
                        <Input type="number" inputMode="decimal" aria-label={`${ing.name} quantity`} value={ing.quantity}
                          onChange={e => setIngs(prev => prev.map((x, i) => i === idx ? { ...x, quantity: parseFloat(e.target.value) || 0 } : x))}
                          className="ml-auto w-20 h-8 text-xs rounded-lg" />
                        <Select value={ing.unit} onValueChange={v => setIngs(prev => prev.map((x, i) => i === idx ? { ...x, unit: v } : x))}>
                          <SelectTrigger className="w-20 h-8 text-xs rounded-lg" aria-label={`${ing.name} unit`}><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {[...new Set([...UNIT_OPTIONS, ing.unit])].map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  );
                })}
                {ings.length === 0 && <p className="text-xs text-muted-foreground italic py-2">No ingredients added yet</p>}
              </div>

              <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className="gap-1 rounded-lg"><Plus className="h-3.5 w-3.5" />Add ingredient</Button>
                </PopoverTrigger>
                <PopoverContent className="p-0 w-80" align="start">
                  <Command>
                    <CommandInput placeholder="Search brand items or recipes" />
                    <CommandList>
                      <CommandEmpty>Nothing found.</CommandEmpty>
                      <CommandGroup heading="Brand recipes">
                        {(options?.recipes || []).filter(r => r.id !== blueprintId).map(r => (
                          <CommandItem key={r.id} value={`r ${r.name}`} onSelect={() => addIng("blueprint", r.id, r.name, r.unit)}>{r.name}</CommandItem>
                        ))}
                      </CommandGroup>
                      <CommandGroup heading="Brand items">
                        {(options?.items || []).map(i => (
                          <CommandItem key={i.id} value={`i ${i.name} ${i.id}`} onSelect={() => addIng("vendor_item", i.id, i.name)}>{i.name}</CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>

            {!isNew && (
              <div className="rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 space-y-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-sm font-semibold">Typical batch cost</span>
                  <span className="text-lg font-bold tabular-nums">
                    {pricingLoading && !pricing ? "…" : totalMedian != null ? money(totalMedian) : <>{money(partialCost)}<span className="text-xs font-semibold text-destructive"> + ?</span></>}
                  </span>
                </div>
                {totalMedian != null && parseFloat(yieldQty) > 0 && (
                  <p className="text-[11px] text-muted-foreground text-right tabular-nums">
                    {money(totalMedian / parseFloat(yieldQty))}/{yieldUnit}
                  </p>
                )}
                {totalMedian == null && unpricedNames.length > 0 && (
                  <p className="text-[11px] text-destructive">
                    Incomplete — {unpricedNames.length === 1 ? `${unpricedNames[0]} has` : `${unpricedNames.length} ingredients have`} no price yet.
                  </p>
                )}
                {newCount > 0 && <p className="text-[11px] text-muted-foreground">New ingredients are priced after you save.</p>}
              </div>
            )}

            <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-background px-4 py-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold">Show in inventory count</p>
                <p className="text-[11px] text-muted-foreground">Brand setting. Stores follow it.</p>
              </div>
              <Switch checked={countable} onCheckedChange={setCountable} aria-label="Show in inventory count" />
            </div>
          </div>
        )}

        <DialogFooter className="px-5 py-3 border-t border-border bg-muted/30 flex-row justify-end gap-2 sm:space-x-0">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={saving || duplicating}>{saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default BrandRecipeDialog;
