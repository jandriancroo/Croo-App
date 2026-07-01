import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useLocation } from "@/hooks/useLocation";
import { useEffect, useState } from "react";
import { resolveBrandId } from "@/utils/resolveBrandId";

export type LibraryScope = "brand" | "org";

export interface LibraryDoc {
  id: string;
  scope: LibraryScope;
  brand_id: string | null;
  organization_id: string | null;
  doc_type: "recipe" | "document";
  title: string;
  description: string | null;
  body: any;
  steps: any;
  step_photos: any;
  photo_url: string | null;
  file_url: string | null;
  file_type: string | null;
  tags: string[];
  category: string | null;
  yield_qty: number | null;
  yield_unit: string | null;
  servings: number | null;
  prep_time_min: number | null;
  cook_time_min: number | null;
  video_url: string | null;
  created_at: string;
  updated_at: string;
}


export interface LibraryIngredient {
  id: string;
  scope: LibraryScope;
  brand_id: string | null;
  organization_id: string | null;
  name: string;
}

/** Resolve current brand_id from the location's org chain. */
export function useCurrentBrandId(): string | null {
  const { currentLocation } = useLocation();
  const [brandId, setBrandId] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    if (!currentLocation?.id) { setBrandId(null); return; }
    resolveBrandId(currentLocation.id).then((b) => { if (alive) setBrandId(b); });
    return () => { alive = false; };
  }, [currentLocation?.id]);
  return brandId;
}

/** Library settings for the active brand + org. */
export function useLibrarySettings() {
  const { organizationId } = useLocation();
  const brandId = useCurrentBrandId();

  return useQuery({
    queryKey: ["library-settings", brandId, organizationId],
    queryFn: async () => {
      const [brandRes, orgRes] = await Promise.all([
        brandId
          ? supabase.from("library_settings" as any).select("*").eq("brand_id", brandId).maybeSingle()
          : Promise.resolve({ data: null } as any),
        organizationId
          ? supabase.from("library_settings" as any).select("*").eq("organization_id", organizationId).maybeSingle()
          : Promise.resolve({ data: null } as any),
      ]);
      const brand = (brandRes as any).data;
      const org = (orgRes as any).data;
      return {
        brandEnabled: !!brand?.brand_library_enabled,
        orgEnabled: !!org?.org_library_enabled,
        brandId,
        organizationId: organizationId ?? null,
      };
    },
    enabled: !!(brandId || organizationId),
    staleTime: 60_000,
  });
}

/** Upsert brand-scope library settings (brand admin only). */
export function useSaveBrandLibrarySettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ brandId, enabled }: { brandId: string; enabled: boolean }) => {
      const { data: existing } = await supabase
        .from("library_settings" as any)
        .select("id")
        .eq("brand_id", brandId)
        .maybeSingle();
      if (existing) {
        const { error } = await supabase
          .from("library_settings" as any)
          .update({ brand_library_enabled: enabled, updated_at: new Date().toISOString() })
          .eq("id", (existing as any).id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("library_settings" as any)
          .insert({ brand_id: brandId, brand_library_enabled: enabled } as any);
        if (error) throw error;
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["library-settings"] }),
  });
}

/** Upsert org-scope library settings. */
export function useSaveOrgLibrarySettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ organizationId, enabled }: { organizationId: string; enabled: boolean }) => {
      const { data: existing } = await supabase
        .from("library_settings" as any)
        .select("id")
        .eq("organization_id", organizationId)
        .maybeSingle();
      if (existing) {
        const { error } = await supabase
          .from("library_settings" as any)
          .update({ org_library_enabled: enabled, updated_at: new Date().toISOString() })
          .eq("id", (existing as any).id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("library_settings" as any)
          .insert({ organization_id: organizationId, org_library_enabled: enabled } as any);
        if (error) throw error;
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["library-settings"] }),
  });
}

interface DocFilter {
  scope: LibraryScope;
  brandId: string | null;
  organizationId: string | null;
  search?: string;
}

export function useLibraryDocuments({ scope, brandId, organizationId, search }: DocFilter) {
  return useQuery({
    queryKey: ["library-documents", scope, brandId, organizationId, search ?? ""],
    queryFn: async () => {
      let q = supabase
        .from("library_documents" as any)
        .select("*")
        .eq("scope", scope)
        .order("updated_at", { ascending: false })
        .limit(200);
      if (scope === "brand" && brandId) q = q.eq("brand_id", brandId);
      if (scope === "org" && organizationId) q = q.eq("organization_id", organizationId);
      if (search && search.trim()) {
        const term = search.trim().replace(/'/g, "''");
        q = q.textSearch("search_tsv", term, { type: "websearch" });
      }
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as unknown as LibraryDoc[];
    },
    enabled: scope === "brand" ? !!brandId : !!organizationId,
  });
}

export function useLibraryDocument(id: string | null) {
  return useQuery({
    queryKey: ["library-document", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("library_documents" as any)
        .select("*")
        .eq("id", id!)
        .maybeSingle();
      if (error) throw error;
      return data as unknown as LibraryDoc | null;
    },
    enabled: !!id,
  });
}

export function useRecipeIngredients(recipeId: string | null) {
  return useQuery({
    queryKey: ["library-recipe-ingredients", recipeId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("library_recipe_ingredients" as any)
        .select("*, ingredient:library_ingredients(id,name)")
        .eq("recipe_id", recipeId!)
        .order("sort_order");
      if (error) throw error;
      return (data ?? []) as any[];
    },
    enabled: !!recipeId,
  });
}

export function useRecipeLinks(recipeId: string | null) {
  return useQuery({
    queryKey: ["library-recipe-links", recipeId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("library_recipe_links" as any)
        .select("id, to_recipe_id, to:library_documents!library_recipe_links_to_recipe_id_fkey(id,title,doc_type)")
        .eq("from_recipe_id", recipeId!);
      if (error) throw error;
      return (data ?? []) as any[];
    },
    enabled: !!recipeId,
  });
}

export function useIngredientSearch(scope: LibraryScope, brandId: string | null, organizationId: string | null, query: string) {
  return useQuery({
    queryKey: ["library-ingredients", scope, brandId, organizationId, query],
    queryFn: async () => {
      let q = supabase
        .from("library_ingredients" as any)
        .select("id, name, scope, brand_id, organization_id")
        .eq("scope", scope)
        .order("name")
        .limit(20);
      if (scope === "brand" && brandId) q = q.eq("brand_id", brandId);
      if (scope === "org" && organizationId) q = q.eq("organization_id", organizationId);
      if (query.trim()) q = q.ilike("name", `%${query.trim()}%`);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as unknown as LibraryIngredient[];
    },
    enabled: scope === "brand" ? !!brandId : !!organizationId,
  });
}

export async function ensureIngredient(
  name: string,
  scope: LibraryScope,
  brandId: string | null,
  organizationId: string | null,
): Promise<string> {
  const trimmed = name.trim();
  let q = supabase.from("library_ingredients" as any).select("id").ilike("name", trimmed).eq("scope", scope).limit(1);
  if (scope === "brand" && brandId) q = q.eq("brand_id", brandId);
  if (scope === "org" && organizationId) q = q.eq("organization_id", organizationId);
  const { data: existing } = await q.maybeSingle();
  if (existing) return (existing as any).id;
  const payload: any = { name: trimmed, scope };
  if (scope === "brand") payload.brand_id = brandId;
  if (scope === "org") payload.organization_id = organizationId;
  const { data, error } = await supabase.from("library_ingredients" as any).insert(payload).select("id").single();
  if (error) throw error;
  return (data as any).id;
}

/** All recipe IDs the current user has favorited. */
export function useMyFavorites() {
  return useQuery({
    queryKey: ["library-favorites"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return new Set<string>();
      const { data, error } = await supabase
        .from("library_recipe_favorites" as any)
        .select("recipe_id")
        .eq("user_id", user.id);
      if (error) throw error;
      return new Set<string>((data ?? []).map((r: any) => r.recipe_id));
    },
    staleTime: 30_000,
  });
}

export function useToggleFavorite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ recipeId, on }: { recipeId: string; on: boolean }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Sign in required");
      if (on) {
        const { error } = await supabase
          .from("library_recipe_favorites" as any)
          .insert({ user_id: user.id, recipe_id: recipeId });
        if (error && !String(error.message).includes("duplicate")) throw error;
      } else {
        const { error } = await supabase
          .from("library_recipe_favorites" as any)
          .delete()
          .eq("user_id", user.id)
          .eq("recipe_id", recipeId);
        if (error) throw error;
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["library-favorites"] }),
  });
}

/** Upload an image to library-assets and return a long-lived signed URL. */
export async function uploadLibraryImage(file: File, scope: LibraryScope): Promise<string> {
  const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
  const path = `${scope}/images/${crypto.randomUUID()}.${ext}`;
  const { error: upErr } = await supabase.storage.from("library-assets").upload(path, file, {
    cacheControl: "31536000",
    contentType: file.type || "image/jpeg",
  });
  if (upErr) throw upErr;
  const { data: signed, error: sErr } = await supabase.storage
    .from("library-assets")
    .createSignedUrl(path, 60 * 60 * 24 * 365 * 5);
  if (sErr) throw sErr;
  return signed.signedUrl;
}

/** List version snapshots for a recipe (newest first). */
export function useRecipeVersions(recipeId: string | null) {
  return useQuery({
    queryKey: ["library-doc-versions", recipeId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("library_document_versions" as any)
        .select("id, created_at, editor_name, created_by, snapshot")
        .eq("document_id", recipeId!)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as any[];
    },
    enabled: !!recipeId,
  });
}

/** Save a snapshot of the recipe's current state (doc + ingredients + links). */
export async function snapshotRecipeVersion(recipeId: string) {
  const { data: { user } } = await supabase.auth.getUser();
  const [docRes, ingsRes, linksRes, profileRes] = await Promise.all([
    supabase.from("library_documents" as any).select("*").eq("id", recipeId).maybeSingle(),
    supabase.from("library_recipe_ingredients" as any)
      .select("ingredient_id, quantity, unit, sort_order, ingredient:library_ingredients(name)")
      .eq("recipe_id", recipeId).order("sort_order"),
    supabase.from("library_recipe_links" as any).select("to_recipe_id").eq("from_recipe_id", recipeId),
    user ? supabase.from("profiles" as any).select("full_name").eq("id", user.id).maybeSingle() : Promise.resolve({ data: null } as any),
  ]);
  const editorName = (profileRes as any).data?.full_name || user?.email || null;
  const snapshot = {
    doc: (docRes as any).data,
    ingredients: (ingsRes as any).data ?? [],
    links: (linksRes as any).data ?? [],
  };
  const { error } = await supabase.from("library_document_versions" as any).insert({
    document_id: recipeId,
    snapshot,
    created_by: user?.id ?? null,
    editor_name: editorName,
  });
  if (error) throw error;
}

/** Restore a recipe to a saved snapshot. */
export function useRestoreRecipeVersion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ recipeId, versionId }: { recipeId: string; versionId: string }) => {
      // Snapshot current state first so the restore itself is undoable
      await snapshotRecipeVersion(recipeId);
      const { data: ver, error: vErr } = await supabase
        .from("library_document_versions" as any)
        .select("snapshot")
        .eq("id", versionId)
        .maybeSingle();
      if (vErr) throw vErr;
      const snap = (ver as any)?.snapshot;
      if (!snap?.doc) throw new Error("Snapshot missing");
      const d = snap.doc;
      const { error: uErr } = await supabase.from("library_documents" as any).update({
        title: d.title,
        description: d.description,
        category: d.category,
        tags: d.tags,
        photo_url: d.photo_url,
        video_url: d.video_url,
        yield_qty: d.yield_qty,
        yield_unit: d.yield_unit,
        servings: d.servings,
        prep_time_min: d.prep_time_min,
        cook_time_min: d.cook_time_min,
        steps: d.steps,
        step_photos: d.step_photos,
        updated_at: new Date().toISOString(),
      }).eq("id", recipeId);
      if (uErr) throw uErr;
      // Rewrite ingredients
      await supabase.from("library_recipe_ingredients" as any).delete().eq("recipe_id", recipeId);
      const ingRows = (snap.ingredients ?? [])
        .filter((r: any) => r.ingredient_id)
        .map((r: any, i: number) => ({
          recipe_id: recipeId,
          ingredient_id: r.ingredient_id,
          quantity: r.quantity,
          unit: r.unit,
          sort_order: r.sort_order ?? i,
        }));
      if (ingRows.length) {
        const { error } = await supabase.from("library_recipe_ingredients" as any).insert(ingRows);
        if (error) throw error;
      }
      // Rewrite links
      await supabase.from("library_recipe_links" as any).delete().eq("from_recipe_id", recipeId);
      const linkRows = (snap.links ?? []).map((l: any) => ({
        from_recipe_id: recipeId,
        to_recipe_id: l.to_recipe_id,
      }));
      if (linkRows.length) {
        const { error } = await supabase.from("library_recipe_links" as any).insert(linkRows);
        if (error) throw error;
      }
    },
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ["library-document", v.recipeId] });
      qc.invalidateQueries({ queryKey: ["library-recipe-ingredients", v.recipeId] });
      qc.invalidateQueries({ queryKey: ["library-recipe-links", v.recipeId] });
      qc.invalidateQueries({ queryKey: ["library-doc-versions", v.recipeId] });
      qc.invalidateQueries({ queryKey: ["library-documents"] });
    },
  });
}

