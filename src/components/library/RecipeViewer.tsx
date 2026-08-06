import { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Pencil, ExternalLink, Star, Printer, Clock, Users, ChefHat, Video, History } from "lucide-react";
import {
  useLibraryDocument,
  useRecipeIngredients,
  useRecipeLinks,
  useMyFavorites,
  useToggleFavorite,
} from "@/hooks/useLibrary";
import { RecipeVersionHistorySheet } from "./RecipeVersionHistorySheet";
import { InlineVideoPlayer, toEmbedUrl } from "@/components/ui/inline-video-player";

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
  const { data: favs } = useMyFavorites();
  const toggleFav = useToggleFavorite();
  const [stackedId, setStackedId] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);

  const isFav = !!(recipeId && favs?.has(recipeId));
  const stepsArr: string[] = useMemo(
    () => (Array.isArray(doc?.steps) ? (doc!.steps as string[]) : []),
    [doc?.steps]
  );
  const stepPhotos: (string | null)[] = useMemo(
    () => (Array.isArray(doc?.step_photos) ? (doc!.step_photos as any[]) : []),
    [doc?.step_photos]
  );

  if (!doc) return null;

  const embedUrl = toEmbedUrl(doc.video_url);

  const handlePrint = () => {
    window.print();
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto print:max-w-full print:max-h-none print:shadow-none">
          <div id="recipe-print-root" className="space-y-4">
            {doc.photo_url && (
              <div className="w-full aspect-video rounded-lg overflow-hidden bg-muted -mt-2">
                <img src={doc.photo_url} alt={doc.title} className="w-full h-full object-cover" />
              </div>
            )}

            <DialogHeader>
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1">
                  <DialogTitle className="text-2xl">{doc.title}</DialogTitle>
                  {doc.category && <p className="text-sm text-muted-foreground mt-1">{doc.category}</p>}
                </div>
                <div className="flex items-center gap-1 print:hidden">
                  {recipeId && (
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => toggleFav.mutate({ recipeId, on: !isFav })}
                      title={isFav ? "Unfavorite" : "Favorite"}
                    >
                      <Star className={`h-4 w-4 ${isFav ? "fill-primary text-primary" : ""}`} />
                    </Button>
                  )}
                  <Button size="icon" variant="ghost" onClick={handlePrint} title="Print">
                    <Printer className="h-4 w-4" />
                  </Button>
                  {recipeId && (
                    <Button size="icon" variant="ghost" onClick={() => setHistoryOpen(true)} title="Version history">
                      <History className="h-4 w-4" />
                    </Button>
                  )}
                  {canEdit && onEdit && (
                    <Button size="sm" variant="outline" onClick={onEdit}>
                      <Pencil className="h-4 w-4 mr-1" />Edit
                    </Button>
                  )}
                </div>
              </div>
            </DialogHeader>

            {doc.description && <p className="text-sm">{doc.description}</p>}

            {(doc.prep_time_min != null || doc.cook_time_min != null || doc.servings != null || doc.yield_qty != null) && (
              <div className="flex flex-wrap gap-4 text-sm border-y py-3">
                {doc.prep_time_min != null && (
                  <Metric icon={<Clock className="h-4 w-4" />} label="Prep" value={`${doc.prep_time_min} min`} />
                )}
                {doc.cook_time_min != null && (
                  <Metric icon={<ChefHat className="h-4 w-4" />} label="Cook" value={`${doc.cook_time_min} min`} />
                )}
                {doc.servings != null && (
                  <Metric icon={<Users className="h-4 w-4" />} label="Serves" value={String(doc.servings)} />
                )}
                {doc.yield_qty != null && (
                  <Metric icon={<span className="text-xs font-bold">Y</span>} label="Yield" value={`${doc.yield_qty}${doc.yield_unit ? ` ${doc.yield_unit}` : ""}`} />
                )}
              </div>
            )}

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
                    <ol className="space-y-3">
                      {stepsArr.map((s, i) => (
                        <li key={i} className="flex gap-3">
                          <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs font-semibold flex items-center justify-center">
                            {i + 1}
                          </span>
                          <div className="flex-1 space-y-2">
                            <p className="text-sm">{s}</p>
                            {stepPhotos[i] && (
                              <img
                                src={stepPhotos[i] as string}
                                alt={`Step ${i + 1}`}
                                className="rounded-md max-w-xs w-full h-auto"
                              />
                            )}
                          </div>
                        </li>
                      ))}
                    </ol>
                  </div>
                )}

                {doc.video_url && (
                  <div className="print:hidden">
                    <h3 className="font-semibold text-sm mb-2 flex items-center gap-1.5">
                      <Video className="h-4 w-4" />Video
                    </h3>
                    <InlineVideoPlayer url={doc.video_url} title={doc.title} />
                  </div>
                )}

                {links.length > 0 && (
                  <div className="print:hidden">
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
          </div>
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

      <RecipeVersionHistorySheet
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        recipeId={recipeId}
        canRestore={canEdit}
      />
    </>
  );
}

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-muted-foreground">{icon}</span>
      <span className="text-xs text-muted-foreground">{label}:</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}
