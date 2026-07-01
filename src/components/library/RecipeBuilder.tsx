import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, Save, Link2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { IngredientCombobox } from "./IngredientCombobox";
import { ensureIngredient, LibraryScope, useLibraryDocument, useRecipeIngredients, useRecipeLinks, useLibraryDocuments } from "@/hooks/useLibrary";
import { useQueryClient } from "@tanstack/react-query";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  recipeId?: string | null;
  scope: LibraryScope;
  brandId: string | null;
  organizationId: string | null;
}

interface IngRow { key: string; name: string; quantity: string; unit: string; }

export function RecipeBuilder({ open, onOpenChange, recipeId, scope, brandId, organizationId }: Props) {
  const qc = useQueryClient();
  const { data: doc } = useLibraryDocument(recipeId ?? null);
  const { data: existingIngs = [] } = useRecipeIngredients(recipeId ?? null);
  const { data: existingLinks = [] } = useRecipeLinks(recipeId ?? null);
  const { data: allRecipes = [] } = useLibraryDocuments({ scope, brandId, organizationId });

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [tags, setTags] = useState("");
  const [steps, setSteps] = useState("");
  const [ings, setIngs] = useState<IngRow[]>([]);
  const [links, setLinks] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTitle(doc?.title ?? "");
    setDescription(doc?.description ?? "");
    setCategory(doc?.category ?? "");
    setTags((doc?.tags ?? []).join(", "));
    setSteps(Array.isArray(doc?.steps) ? (doc!.steps as string[]).join("\n") : (typeof doc?.steps === "string" ? doc!.steps : ""));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, recipeId, doc?.id]);

  useEffect(() => {
    if (!open) return;
    setIngs(existingIngs.map((r: any) => ({
      key: r.id,
      name: r.ingredient?.name ?? "",
      quantity: r.quantity != null ? String(r.quantity) : "",
      unit: r.unit ?? "",
    })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, recipeId, existingIngs.length]);

  useEffect(() => {
    if (!open) return;
    setLinks(existingLinks.map((l: any) => l.to_recipe_id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, recipeId, existingLinks.length]);

  const addIng = () => setIngs((s) => [...s, { key: crypto.randomUUID(), name: "", quantity: "", unit: "" }]);
  const rmIng = (key: string) => setIngs((s) => s.filter((r) => r.key !== key));

  const save = async () => {
    if (!title.trim()) return toast.error("Title required");
    setSaving(true);
    try {
      const payload: any = {
        scope,
        brand_id: scope === "brand" ? brandId : null,
        organization_id: scope === "org" ? organizationId : null,
        doc_type: "recipe",
        title: title.trim(),
        description: description.trim() || null,
        category: category.trim() || null,
        tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
        steps: steps.split("\n").map((s) => s.trim()).filter(Boolean),
        updated_at: new Date().toISOString(),
      };
      let id = recipeId;
      if (id) {
        const { error } = await supabase.from("library_documents" as any).update(payload).eq("id", id);
        if (error) throw error;
      } else {
        const { data, error } = await supabase.from("library_documents" as any).insert(payload).select("id").single();
        if (error) throw error;
        id = (data as any).id;
      }
      // Rewrite ingredients
      await supabase.from("library_recipe_ingredients" as any).delete().eq("recipe_id", id!);
      const rows: any[] = [];
      for (let i = 0; i < ings.length; i++) {
        const r = ings[i];
        if (!r.name.trim()) continue;
        const ingredient_id = await ensureIngredient(r.name, scope, brandId, organizationId);
        rows.push({
          recipe_id: id,
          ingredient_id,
          quantity: r.quantity ? Number(r.quantity) : null,
          unit: r.unit || null,
          sort_order: i,
        });
      }
      if (rows.length) {
        const { error } = await supabase.from("library_recipe_ingredients" as any).insert(rows);
        if (error) throw error;
      }
      // Rewrite links
      await supabase.from("library_recipe_links" as any).delete().eq("from_recipe_id", id!);
      if (links.length) {
        const { error } = await supabase.from("library_recipe_links" as any).insert(
          links.filter((l) => l !== id).map((to_recipe_id) => ({ from_recipe_id: id, to_recipe_id }))
        );
        if (error) throw error;
      }
      toast.success("Recipe saved");
      qc.invalidateQueries({ queryKey: ["library-documents"] });
      qc.invalidateQueries({ queryKey: ["library-document", id] });
      qc.invalidateQueries({ queryKey: ["library-recipe-ingredients", id] });
      qc.invalidateQueries({ queryKey: ["library-recipe-links", id] });
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e.message ?? "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const linkOptions = allRecipes.filter((r) => r.doc_type === "recipe" && r.id !== recipeId);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{recipeId ? "Edit Recipe" : "New Recipe"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Title</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Caesar Salad" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Category</Label>
              <Input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Salads" />
            </div>
            <div className="space-y-2">
              <Label>Tags (comma-separated)</Label>
              <Input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="lunch, vegetarian" />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Description</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Ingredients</Label>
              <Button size="sm" variant="outline" onClick={addIng}><Plus className="h-4 w-4 mr-1" />Add</Button>
            </div>
            <div className="space-y-2">
              {ings.map((r) => (
                <div key={r.key} className="grid grid-cols-[1fr_80px_80px_auto] gap-2 items-center">
                  <IngredientCombobox
                    scope={scope}
                    brandId={brandId}
                    organizationId={organizationId}
                    value={r.name}
                    onChange={(name) => setIngs((s) => s.map((x) => x.key === r.key ? { ...x, name } : x))}
                  />
                  <Input placeholder="Qty" value={r.quantity} onChange={(e) => setIngs((s) => s.map((x) => x.key === r.key ? { ...x, quantity: e.target.value } : x))} />
                  <Input placeholder="Unit" value={r.unit} onChange={(e) => setIngs((s) => s.map((x) => x.key === r.key ? { ...x, unit: e.target.value } : x))} />
                  <Button size="icon" variant="ghost" onClick={() => rmIng(r.key)}><Trash2 className="h-4 w-4" /></Button>
                </div>
              ))}
              {ings.length === 0 && <p className="text-xs text-muted-foreground">No ingredients yet.</p>}
            </div>
          </div>

          <div className="space-y-2">
            <Label>Steps (one per line)</Label>
            <Textarea value={steps} onChange={(e) => setSteps(e.target.value)} rows={6} placeholder={"Wash lettuce\nToss with dressing\n..."} />
          </div>

          <div className="space-y-2">
            <Label className="flex items-center gap-2"><Link2 className="h-4 w-4" />Linked Recipes</Label>
            <div className="flex flex-wrap gap-1.5">
              {linkOptions.map((r) => {
                const active = links.includes(r.id);
                return (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => setLinks((s) => active ? s.filter((x) => x !== r.id) : [...s, r.id])}
                  >
                    <Badge variant={active ? "default" : "outline"}>{r.title}</Badge>
                  </button>
                );
              })}
              {linkOptions.length === 0 && <p className="text-xs text-muted-foreground">No other recipes to link.</p>}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={saving}><Save className="h-4 w-4 mr-2" />{saving ? "Saving..." : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
