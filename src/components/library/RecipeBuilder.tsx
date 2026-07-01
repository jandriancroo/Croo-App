import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, Save, Link2, ImagePlus, Loader2, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { IngredientCombobox } from "./IngredientCombobox";
import {
  ensureIngredient,
  LibraryScope,
  useLibraryDocument,
  useRecipeIngredients,
  useRecipeLinks,
  useLibraryDocuments,
  uploadLibraryImage,
  snapshotRecipeVersion,
} from "@/hooks/useLibrary";
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
interface StepRow { key: string; text: string; photo_url: string | null; }

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
  const [heroUrl, setHeroUrl] = useState<string | null>(null);
  const [uploadingHero, setUploadingHero] = useState(false);
  const [videoUrl, setVideoUrl] = useState("");
  const [yieldQty, setYieldQty] = useState("");
  const [yieldUnit, setYieldUnit] = useState("");
  const [servings, setServings] = useState("");
  const [prepMin, setPrepMin] = useState("");
  const [cookMin, setCookMin] = useState("");
  const [ings, setIngs] = useState<IngRow[]>([]);
  const [steps, setSteps] = useState<StepRow[]>([]);
  const [links, setLinks] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const heroInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setTitle(doc?.title ?? "");
    setDescription(doc?.description ?? "");
    setCategory(doc?.category ?? "");
    setTags((doc?.tags ?? []).join(", "));
    setHeroUrl(doc?.photo_url ?? null);
    setVideoUrl(doc?.video_url ?? "");
    setYieldQty(doc?.yield_qty != null ? String(doc.yield_qty) : "");
    setYieldUnit(doc?.yield_unit ?? "");
    setServings(doc?.servings != null ? String(doc.servings) : "");
    setPrepMin(doc?.prep_time_min != null ? String(doc.prep_time_min) : "");
    setCookMin(doc?.cook_time_min != null ? String(doc.cook_time_min) : "");

    const stepTexts: string[] = Array.isArray(doc?.steps) ? (doc!.steps as string[]) : [];
    const stepPhotos: (string | null)[] = Array.isArray(doc?.step_photos) ? (doc!.step_photos as any[]) : [];
    setSteps(stepTexts.length === 0
      ? []
      : stepTexts.map((t, i) => ({ key: crypto.randomUUID(), text: t, photo_url: stepPhotos[i] ?? null })));
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

  const addStep = () => setSteps((s) => [...s, { key: crypto.randomUUID(), text: "", photo_url: null }]);
  const rmStep = (key: string) => setSteps((s) => s.filter((r) => r.key !== key));
  const setStepText = (key: string, text: string) =>
    setSteps((s) => s.map((x) => x.key === key ? { ...x, text } : x));

  const handleHeroUpload = async (file: File) => {
    setUploadingHero(true);
    try {
      const url = await uploadLibraryImage(file, scope);
      setHeroUrl(url);
    } catch (e: any) {
      toast.error(e.message ?? "Upload failed");
    } finally {
      setUploadingHero(false);
    }
  };

  const handleStepPhoto = async (key: string, file: File) => {
    try {
      const url = await uploadLibraryImage(file, scope);
      setSteps((s) => s.map((x) => x.key === key ? { ...x, photo_url: url } : x));
    } catch (e: any) {
      toast.error(e.message ?? "Upload failed");
    }
  };

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
        photo_url: heroUrl,
        video_url: videoUrl.trim() || null,
        yield_qty: yieldQty ? Number(yieldQty) : null,
        yield_unit: yieldUnit.trim() || null,
        servings: servings ? parseInt(servings, 10) : null,
        prep_time_min: prepMin ? parseInt(prepMin, 10) : null,
        cook_time_min: cookMin ? parseInt(cookMin, 10) : null,
        steps: steps.map((s) => s.text.trim()).filter(Boolean),
        step_photos: steps.filter((s) => s.text.trim()).map((s) => s.photo_url ?? null),
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
          {/* Hero image */}
          <div className="space-y-2">
            <Label>Hero Image</Label>
            <div className="relative rounded-lg border border-dashed overflow-hidden bg-muted/30 aspect-video flex items-center justify-center">
              {heroUrl ? (
                <>
                  <img src={heroUrl} alt="Recipe" className="absolute inset-0 w-full h-full object-cover" />
                  <Button
                    size="icon"
                    variant="secondary"
                    className="absolute top-2 right-2 h-7 w-7"
                    onClick={() => setHeroUrl(null)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </>
              ) : (
                <Button
                  variant="ghost"
                  onClick={() => heroInputRef.current?.click()}
                  disabled={uploadingHero}
                  className="text-muted-foreground"
                >
                  {uploadingHero
                    ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Uploading...</>
                    : <><ImagePlus className="h-4 w-4 mr-2" />Add cover photo</>}
                </Button>
              )}
              <input
                ref={heroInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => e.target.files?.[0] && handleHeroUpload(e.target.files[0])}
              />
            </div>
          </div>

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

          {/* Metrics */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Prep (min)</Label>
              <Input inputMode="numeric" value={prepMin} onChange={(e) => setPrepMin(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Cook (min)</Label>
              <Input inputMode="numeric" value={cookMin} onChange={(e) => setCookMin(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Servings</Label>
              <Input inputMode="numeric" value={servings} onChange={(e) => setServings(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Yield</Label>
              <div className="flex gap-1">
                <Input className="w-16" placeholder="Qty" value={yieldQty} onChange={(e) => setYieldQty(e.target.value)} />
                <Input placeholder="Unit" value={yieldUnit} onChange={(e) => setYieldUnit(e.target.value)} />
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Video URL (YouTube, Vimeo, or direct link)</Label>
            <Input value={videoUrl} onChange={(e) => setVideoUrl(e.target.value)} placeholder="https://youtube.com/..." />
          </div>

          {/* Ingredients */}
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

          {/* Steps with per-step photos */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Steps</Label>
              <Button size="sm" variant="outline" onClick={addStep}><Plus className="h-4 w-4 mr-1" />Add Step</Button>
            </div>
            <div className="space-y-3">
              {steps.map((s, i) => (
                <StepEditor
                  key={s.key}
                  index={i}
                  step={s}
                  onTextChange={(t) => setStepText(s.key, t)}
                  onPhoto={(f) => handleStepPhoto(s.key, f)}
                  onRemovePhoto={() => setSteps((prev) => prev.map((x) => x.key === s.key ? { ...x, photo_url: null } : x))}
                  onRemove={() => rmStep(s.key)}
                  scope={scope}
                />
              ))}
              {steps.length === 0 && <p className="text-xs text-muted-foreground">No steps yet.</p>}
            </div>
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

function StepEditor({
  index, step, onTextChange, onPhoto, onRemovePhoto, onRemove,
}: {
  index: number;
  step: StepRow;
  onTextChange: (t: string) => void;
  onPhoto: (f: File) => void;
  onRemovePhoto: () => void;
  onRemove: () => void;
  scope: LibraryScope;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div className="border rounded-lg p-2 space-y-2">
      <div className="flex items-start gap-2">
        <div className="mt-2 text-xs font-semibold text-muted-foreground w-5 text-right">{index + 1}.</div>
        <Textarea
          rows={2}
          value={step.text}
          onChange={(e) => onTextChange(e.target.value)}
          placeholder="Describe this step..."
          className="flex-1"
        />
        <div className="flex flex-col gap-1">
          <Button size="icon" variant="ghost" onClick={() => ref.current?.click()}>
            <ImagePlus className="h-4 w-4" />
          </Button>
          <Button size="icon" variant="ghost" onClick={onRemove}>
            <Trash2 className="h-4 w-4" />
          </Button>
          <input
            ref={ref}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && onPhoto(e.target.files[0])}
          />
        </div>
      </div>
      {step.photo_url && (
        <div className="relative w-32 h-24 rounded overflow-hidden ml-7">
          <img src={step.photo_url} alt={`Step ${index + 1}`} className="w-full h-full object-cover" />
          <Button
            size="icon"
            variant="secondary"
            className="absolute top-1 right-1 h-5 w-5"
            onClick={onRemovePhoto}
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
      )}
    </div>
  );
}
