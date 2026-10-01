import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { normalizeUnit } from "@/utils/unitConversion";
import { money, useBrandRecipePricing, type IngredientPricing } from "./useBrandRecipes";

const UNIT_OPTIONS = ["oz", "qt", "gal", "lb", "kg", "g", "ea", "tbsp", "tsp", "ml", "cups", "bags", "ct"];
const CATEGORY_OPTIONS = ["MI", "CORE", "BASE", "PREP", "SUB", "CATERING"];

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
          .select("id, name, category, yield_qty, yield_unit, is_countable, brand_id, location_id")
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
        supabase.from("brand_inventory_templates")
          .select("id, common_name, product_name")
          .eq("brand_id", brandId).order("common_name"),
        supabase.from("recipe_blueprints" as any)
          .select("id, name, yield_unit")
          .eq("brand_id", brandId).is("location_id", null).eq("is_active", true).order("name"),
      ]);
      if (tpl.error) throw tpl.error;
      if (bps.error) throw bps.error;
      return {
        items: (tpl.data || []).map((t: any) => ({ id: t.id, name: t.common_name || t.product_name || "Item" })),
        recipes: ((bps.data || []) as any[]).map(b => ({ id: b.id, name: b.name, unit: b.yield_unit })),
      };
    },
  });

  const { data: pricing, isFetching: pricingLoading } = useBrandRecipePricing(open ? blueprintId : null);

  useEffect(() => {
    if (!open) return;
    if (isNew) {
      setName(""); setCategory(""); setYieldQty("1"); setYieldUnit("ea"); setCountable(false); setIngs([]);
      return;
    }
    if (!loaded || !options) return;
    const itemName = new Map(options.items.map(i => [i.id, i.name]));
    const recName = new Map(options.recipes.map(r => [r.id, r.name]));
    setName(loaded.bp.name || "");
    setCategory(loaded.bp.category || "");
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

  const save = async () => {
    const y = parseFloat(yieldQty);
    if (!name.trim() || !(y > 0)) { toast.error("Name and a yield above 0 are required"); return; }
    setSaving(true);
    try {
      let id = blueprintId;
      const fields = {
        name: name.trim(), category: category || null, yield_qty: y, yield_unit: yieldUnit, is_countable: countable,
      };
      if (id) {
        const { error } = await supabase.from("recipe_blueprints" as any)
          .update(fields as any).eq("id", id).is("location_id", null).eq("brand_id", brandId);
        if (error) throw error;
        const { error: delErr } = await supabase.from("recipe_blueprint_ingredients" as any).delete().eq("blueprint_id", id);
        if (delErr) throw delErr;
      } else {
        const { data, error } = await supabase.from("recipe_blueprints" as any)
          .insert({ ...fields, brand_id: brandId, location_id: null, is_active: true, source: "manual" } as any)
          .select("id").single();
        if (error) throw error;
        id = (data as any).id;
      }
      const rows = ings.map(i => ({
        blueprint_id: id,
        ingredient_type: i.type,
        vendor_item_id: i.type === "vendor_item" ? i.vendor_item_id : null,
        sub_blueprint_id: i.type === "blueprint" ? i.sub_blueprint_id : null,
        quantity: i.quantity,
        unit: normalizeUnit(i.unit) || i.unit,
        source_name: i.source_name,
      }));
      if (rows.length) {
        const { error } = await supabase.from("recipe_blueprint_ingredients" as any).insert(rows);
        if (error) throw error;
      }
      toast.success("Brand recipe saved");
      qc.invalidateQueries({ queryKey: ["brand-recipes", brandId] });
      qc.invalidateQueries({ queryKey: ["brand-recipe-edit", id] });
      qc.invalidateQueries({ queryKey: ["brand-recipe-pricing", id] });
      qc.invalidateQueries({ queryKey: ["brand-price-outliers", brandId] });
      onOpenChange(false);
    } catch (e: any) {
      toast.error("Save failed: " + (e?.message || "unknown error"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isNew ? "New brand recipe" : "Edit brand recipe"}</DialogTitle>
          <p className="text-xs text-muted-foreground">Brand record only. Store items are not changed here.</p>
        </DialogHeader>

        {isLoading && !isNew ? (
          <div className="py-10 flex justify-center"><Loader2 className="h-5 w-5 animate-spin" /></div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Name</Label>
                <Input value={name} onChange={e => setName(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Category</Label>
                <Select value={category || "none"} onValueChange={v => setCategory(v === "none" ? "" : v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {[...new Set([...CATEGORY_OPTIONS, ...(category ? [category] : [])])].map(c => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Yield</Label>
                <div className="flex gap-2">
                  <Input type="number" inputMode="decimal" value={yieldQty} onChange={e => setYieldQty(e.target.value)} className="w-28" />
                  <Select value={yieldUnit} onValueChange={setYieldUnit}>
                    <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {[...new Set([...UNIT_OPTIONS, yieldUnit])].map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
                <div>
                  <p className="text-sm font-medium">Counted</p>
                  <p className="text-[11px] text-muted-foreground">Brand setting. Stores follow it in a later step.</p>
                </div>
                <Switch checked={countable} onCheckedChange={setCountable} />
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs">Ingredients</Label>
                <span className="text-[11px] text-muted-foreground">
                  Typical price = middle store price, each store at its own pack
                </span>
              </div>
              <div className="rounded-lg border border-border divide-y divide-border">
                {ings.map((ing, idx) => {
                  const p = !ing.key.startsWith("new-") ? priceByRow.get(ing.key) : undefined;
                  const wide = p && p.min_cost != null && p.max_cost != null && p.min_cost > 0 && p.max_cost / p.min_cost > 1.5;
                  return (
                    <div key={ing.key} className="px-3 py-2 flex flex-wrap items-center gap-2">
                      <div className="flex-1 min-w-[140px]">
                        <p className="text-sm truncate">
                          {ing.name}
                          {ing.type === "blueprint" && <Badge variant="outline" className="ml-1 text-[9px]">recipe</Badge>}
                          {p && p.outliers.length > 0 && (
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild><span className="ml-1 cursor-help">⚠️</span></TooltipTrigger>
                                <TooltipContent className="max-w-xs text-xs">
                                  {p.outliers.map((o, i) => (
                                    <div key={i}>
                                      {o.problem
                                        ? `${o.store}: ${o.problem}`
                                        : `${o.store} ${money(o.unit_price)}/${p.unit_label} vs typical ${money(p.median_unit_price)}/${p.unit_label}`}
                                    </div>
                                  ))}
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          )}
                        </p>
                        {p && p.outliers.length > 0 && (
                          <p className="text-[10px] text-destructive truncate">
                            {p.outliers.map(o => o.problem ? `${o.store}: can't price` : `${o.store} ${money(o.unit_price)}/${p.unit_label} vs typical ${money(p.median_unit_price)}`).join(" · ")}
                          </p>
                        )}
                      </div>
                      <Input type="number" inputMode="decimal" value={ing.quantity}
                        onChange={e => setIngs(prev => prev.map((x, i) => i === idx ? { ...x, quantity: parseFloat(e.target.value) || 0 } : x))}
                        className="w-20 h-8" />
                      <Select value={ing.unit} onValueChange={v => setIngs(prev => prev.map((x, i) => i === idx ? { ...x, unit: v } : x))}>
                        <SelectTrigger className="w-20 h-8"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {[...new Set([...UNIT_OPTIONS, ing.unit])].map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      <div className="w-28 text-right text-xs tabular-nums">
                        {ing.key.startsWith("new-") ? <span className="text-muted-foreground">after save</span>
                          : pricingLoading && !p ? "…"
                          : p?.median_cost == null ? <span className="text-muted-foreground">no price</span>
                          : <>
                              {money(p.median_cost)}
                              {wide && <span className="block text-[10px] text-muted-foreground">{money(p.min_cost)}–{money(p.max_cost)}</span>}
                            </>}
                      </div>
                      <Button variant="ghost" size="icon" className="h-8 w-8"
                        onClick={() => setIngs(prev => prev.filter((_, i) => i !== idx))} aria-label="Remove ingredient">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  );
                })}
                {ings.length === 0 && <p className="px-3 py-3 text-xs text-muted-foreground">No ingredients.</p>}
              </div>

              <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className="gap-1"><Plus className="h-3.5 w-3.5" />Add ingredient</Button>
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
              <div className="flex items-center justify-between rounded-lg bg-muted/40 px-3 py-2 text-sm">
                <span>Typical batch cost</span>
                <span className="tabular-nums font-medium">
                  {totalMedian == null ? "incomplete" : money(totalMedian)}
                  {totalMedian != null && parseFloat(yieldQty) > 0 && (
                    <span className="text-xs text-muted-foreground ml-2">
                      {money(totalMedian / parseFloat(yieldQty))}/{yieldUnit}
                    </span>
                  )}
                </span>
              </div>
            )}
            <p className="text-[11px] text-muted-foreground">
              Recipe pans are set at brand level in a later step (after the store counts).
            </p>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default BrandRecipeDialog;
