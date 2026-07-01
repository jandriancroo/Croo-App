import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Pencil, ExternalLink } from "lucide-react";
import { useLibraryDocument, useRecipeIngredients, useRecipeLinks } from "@/hooks/useLibrary";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  recipeId: string | null;
  canEdit: boolean;
  onEdit?: () => void;
}

export function RecipeViewer({ open, onOpenChange, recipeId, canEdit, onEdit }: Props) {
  const { data: doc } = useLibraryDocument(recipeId);
  const { data: ings = [] } = useRecipeIngredients(recipeId);
  const { data: links = [] } = useRecipeLinks(recipeId);
  const [stackedId, setStackedId] = useState<string | null>(null);

  if (!doc) return null;

  const stepsArr: string[] = Array.isArray(doc.steps) ? (doc.steps as string[]) : [];

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1">
                <DialogTitle className="text-2xl">{doc.title}</DialogTitle>
                {doc.category && <p className="text-sm text-muted-foreground mt-1">{doc.category}</p>}
              </div>
              {canEdit && onEdit && (
                <Button size="sm" variant="outline" onClick={onEdit}><Pencil className="h-4 w-4 mr-1" />Edit</Button>
              )}
            </div>
          </DialogHeader>

          {doc.description && <p className="text-sm">{doc.description}</p>}

          {doc.tags?.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {doc.tags.map((t) => <Badge key={t} variant="secondary">{t}</Badge>)}
            </div>
          )}

          {doc.doc_type === "recipe" && (
            <>
              <div>
                <h3 className="font-semibold text-sm mb-2">Ingredients</h3>
                {ings.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No ingredients listed.</p>
                ) : (
                  <ul className="space-y-1 text-sm">
                    {ings.map((r: any) => (
                      <li key={r.id} className="flex justify-between border-b border-border/50 py-1">
                        <span>{r.ingredient?.name}</span>
                        <span className="text-muted-foreground">
                          {r.quantity ? `${r.quantity}${r.unit ? ` ${r.unit}` : ""}` : ""}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {stepsArr.length > 0 && (
                <div>
                  <h3 className="font-semibold text-sm mb-2">Steps</h3>
                  <ol className="list-decimal ml-5 space-y-1 text-sm">
                    {stepsArr.map((s, i) => <li key={i}>{s}</li>)}
                  </ol>
                </div>
              )}

              {links.length > 0 && (
                <div>
                  <h3 className="font-semibold text-sm mb-2">Related Recipes</h3>
                  <div className="flex flex-wrap gap-1.5">
                    {links.map((l: any) => (
                      <button key={l.id} onClick={() => setStackedId(l.to_recipe_id)}>
                        <Badge variant="outline" className="cursor-pointer hover:bg-accent">
                          <ExternalLink className="h-3 w-3 mr-1" />{l.to?.title}
                        </Badge>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {doc.doc_type === "document" && doc.file_url && (
            <div className="border rounded-lg p-3">
              <a href={doc.file_url} target="_blank" rel="noreferrer" className="text-sm text-primary underline flex items-center gap-1">
                <ExternalLink className="h-4 w-4" /> Open attached file
              </a>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {stackedId && (
        <RecipeViewer
          open={!!stackedId}
          onOpenChange={(o) => !o && setStackedId(null)}
          recipeId={stackedId}
          canEdit={false}
        />
      )}
    </>
  );
}
