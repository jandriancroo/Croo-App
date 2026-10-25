import { useEffect, useMemo, useState } from "react";
import { useDuo } from "@/hooks/useDuo";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Search, Plus, BookOpen, FileText, Trash2, Star } from "lucide-react";
import { useLibrarySettings, useLibraryDocuments, useMyFavorites, LibraryScope } from "@/hooks/useLibrary";

import { useUserRole } from "@/hooks/useUserRole";
import { RecipeBuilder } from "./RecipeBuilder";
import { RecipeViewer } from "./RecipeViewer";
import { DocumentUploader } from "./DocumentUploader";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function LibraryPanel() {
  const qc = useQueryClient();
  const duo = useDuo();
  const { data: settings } = useLibrarySettings();
  const { isSuperAdmin, isBrandAdmin, isOrgAdmin } = useUserRole();

  const scopes: LibraryScope[] = useMemo(() => {
    const s: LibraryScope[] = [];
    if (settings?.brandEnabled) s.push("brand");
    if (settings?.orgEnabled) s.push("org");
    return s;
  }, [settings]);

  const [scope, setScope] = useState<LibraryScope>("brand");
  const activeScope: LibraryScope = scopes.includes(scope) ? scope : (scopes[0] ?? "brand");

  const [query, setQuery] = useState("");
  const [favOnly, setFavOnly] = useState(false);
  const { data: favs } = useMyFavorites();
  const { data: allDocs = [], isLoading } = useLibraryDocuments({
    scope: activeScope,
    brandId: settings?.brandId ?? null,
    organizationId: settings?.organizationId ?? null,
    search: query,
  });
  const docs = favOnly ? allDocs.filter((d) => favs?.has(d.id)) : allDocs;


  const canEdit = activeScope === "brand"
    ? (isSuperAdmin || isBrandAdmin)
    : (isSuperAdmin || isBrandAdmin || isOrgAdmin);

  const [builderOpen, setBuilderOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [viewingId, setViewingId] = useState<string | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);

  // Duo: open mode shows the picked recipe in the docked right pane (first one by default); folded uses a slide-over.
  const [duoSel, setDuoSel] = useState<string | null>(null);
  const dockId = duo.isDuo && duo.isOpen ? (docs.some((d) => d.id === duoSel) ? duoSel : docs[0]?.id ?? null) : null;
  useEffect(() => {
    if (!duo.isDuo || !canEdit) return;
    const root = document.documentElement;
    root.dataset.duoLibEdit = '1';
    const nr = () => { setEditingId(null); setBuilderOpen(true); };
    const up = () => setUploadOpen(true);
    window.addEventListener('open-new-recipe', nr);
    window.addEventListener('open-upload-document', up);
    return () => { delete root.dataset.duoLibEdit; window.removeEventListener('open-new-recipe', nr); window.removeEventListener('open-upload-document', up); };
  }, [duo.isDuo, canEdit]);

  const openNewRecipe = () => { setEditingId(null); setBuilderOpen(true); };
  const openEdit = (id: string) => { setEditingId(id); setBuilderOpen(true); setViewingId(null); };

  const remove = async (id: string) => {
    if (!confirm("Delete this item?")) return;
    const { error } = await supabase.from("library_documents" as any).delete().eq("id", id);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["library-documents"] });
    toast.success("Deleted");
  };

  if (!settings || scopes.length === 0) {
    return (
      <div className="text-center py-12">
        <BookOpen className="h-12 w-12 mx-auto text-muted-foreground mb-3" />
        <p className="text-sm text-muted-foreground">
          Library isn't enabled for this brand or organization yet.
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          Brand admins can enable it from Brand Management.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className={`flex items-center gap-2${duo.isDuo ? ' duo-logs-ctl duo-ctl' : ''}`}>
        <div className="relative flex-1">
          <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Search recipes, ingredients, documents..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <Button
          size="icon"
          variant={favOnly ? "default" : "outline"}
          onClick={() => setFavOnly((v) => !v)}
          title="Show favorites only"
        >
          <Star className={`h-4 w-4 ${favOnly ? "fill-current" : ""}`} />
        </Button>
        {canEdit && !duo.isDuo && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon"><Plus className="h-4 w-4" /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={openNewRecipe}>
                <BookOpen className="h-4 w-4 mr-2" />New Recipe
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setUploadOpen(true)}>
                <FileText className="h-4 w-4 mr-2" />Upload Document
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}

      </div>

      {scopes.length > 1 && (
        <Tabs value={activeScope} onValueChange={(v) => setScope(v as LibraryScope)}>
          <TabsList>
            <TabsTrigger value="brand">Brand Library</TabsTrigger>
            <TabsTrigger value="org">Org Library</TabsTrigger>
          </TabsList>
        </Tabs>
      )}

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : docs.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">
          {query ? "No matches." : "Nothing here yet."}
        </p>
      ) : duo.isDuo ? (
        <div className="duo-log-rows">
          {docs.map((d) => (
            <button key={d.id} type="button" onClick={() => { setDuoSel(d.id); if (!duo.isOpen) setViewingId(d.id); }} className={`duo-log-row${dockId === d.id ? ' duo-row-sel' : ''}`}>
              {d.photo_url
                ? <img src={d.photo_url} alt="" className="duo-lib-thumb" loading="lazy" />
                : <span className="duo-lib-thumb duo-lib-thumb-ph">{d.doc_type === "recipe" ? <BookOpen className="h-4 w-4" /> : <FileText className="h-4 w-4" />}</span>}
              <span className="min-w-0 flex-1">
                <span className="duo-log-top"><b>{d.title}</b>{favs?.has(d.id) && <Star className="h-3.5 w-3.5 fill-primary text-primary shrink-0 ml-auto" />}</span>
                <span className="duo-log-cat">{d.doc_type === "recipe" ? "Recipe" : "Document"}{d.category ? ` • ${d.category}` : ""}</span>
                {d.tags?.length > 0 && <span className="duo-log-prev">{d.tags.slice(0, 3).join(" · ")}</span>}
              </span>
            </button>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {docs.map((d) => (
            <Card key={d.id} className="cursor-pointer hover:border-primary/50 transition overflow-hidden" onClick={() => setViewingId(d.id)}>
              {d.photo_url && (
                <div className="w-full aspect-video bg-muted overflow-hidden">
                  <img src={d.photo_url} alt={d.title} className="w-full h-full object-cover" loading="lazy" />
                </div>
              )}
              <CardContent className="p-4 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
                      {d.doc_type === "recipe" ? <BookOpen className="h-3 w-3" /> : <FileText className="h-3 w-3" />}
                      <span>{d.doc_type === "recipe" ? "Recipe" : "Document"}</span>
                      {d.category && <><span>•</span><span>{d.category}</span></>}
                    </div>
                    <h3 className="font-semibold truncate flex items-center gap-1.5">
                      {favs?.has(d.id) && <Star className="h-3.5 w-3.5 fill-primary text-primary shrink-0" />}
                      <span className="truncate">{d.title}</span>
                    </h3>
                    {d.description && <p className="text-xs text-muted-foreground line-clamp-2 mt-1">{d.description}</p>}
                  </div>
                  {canEdit && (
                    <Button size="icon-sm" variant="ghost" className="shrink-0" onClick={(e) => { e.stopPropagation(); remove(d.id); }}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
                {d.tags?.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {d.tags.slice(0, 3).map((t) => <Badge key={t} variant="secondary" className="text-xs">{t}</Badge>)}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}

        </div>
      )}

      {builderOpen && (
        <RecipeBuilder
          open={builderOpen}
          onOpenChange={setBuilderOpen}
          recipeId={editingId}
          scope={activeScope}
          brandId={settings.brandId}
          organizationId={settings.organizationId}
        />
      )}
      {dockId && (
        <aside className="duo-tasks-dock duo-log-dock">
          <RecipeViewer
            dock
            open
            onOpenChange={() => {}}
            recipeId={dockId}
            canEdit={canEdit}
            onEdit={() => openEdit(dockId)}
            onDelete={canEdit ? () => remove(dockId) : undefined}
          />
        </aside>
      )}
      {viewingId && !(duo.isDuo && duo.isOpen) && (
        <RecipeViewer
          open={!!viewingId}
          onOpenChange={(o) => !o && setViewingId(null)}
          recipeId={viewingId}
          canEdit={canEdit}
          onEdit={() => openEdit(viewingId)}
          onDelete={duo.isDuo && canEdit ? async () => { await remove(viewingId); setViewingId(null); } : undefined}
        />
      )}
      {uploadOpen && (
        <DocumentUploader
          open={uploadOpen}
          onOpenChange={setUploadOpen}
          scope={activeScope}
          brandId={settings.brandId}
          organizationId={settings.organizationId}
        />
      )}
    </div>
  );
}
