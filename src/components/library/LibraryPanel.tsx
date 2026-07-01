import { useMemo, useState } from "react";
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
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Search recipes, ingredients, documents..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        {canEdit && (
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
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {docs.map((d) => (
            <Card key={d.id} className="cursor-pointer hover:border-primary/50 transition" onClick={() => setViewingId(d.id)}>
              <CardContent className="p-4 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
                      {d.doc_type === "recipe" ? <BookOpen className="h-3 w-3" /> : <FileText className="h-3 w-3" />}
                      <span>{d.doc_type === "recipe" ? "Recipe" : "Document"}</span>
                      {d.category && <><span>•</span><span>{d.category}</span></>}
                    </div>
                    <h3 className="font-semibold truncate">{d.title}</h3>
                    {d.description && <p className="text-xs text-muted-foreground line-clamp-2 mt-1">{d.description}</p>}
                  </div>
                  {canEdit && (
                    <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" onClick={(e) => { e.stopPropagation(); remove(d.id); }}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
                {d.tags?.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {d.tags.slice(0, 3).map((t) => <Badge key={t} variant="secondary" className="text-[10px]">{t}</Badge>)}
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
      {viewingId && (
        <RecipeViewer
          open={!!viewingId}
          onOpenChange={(o) => !o && setViewingId(null)}
          recipeId={viewingId}
          canEdit={canEdit}
          onEdit={() => openEdit(viewingId)}
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
