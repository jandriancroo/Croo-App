import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { RotateCcw, Loader2, Clock } from "lucide-react";
import { useRecipeVersions, useRestoreRecipeVersion } from "@/hooks/useLibrary";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import { useState } from "react";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  recipeId: string | null;
  canRestore: boolean;
}

export function RecipeVersionHistorySheet({ open, onOpenChange, recipeId, canRestore }: Props) {
  const { data: versions = [], isLoading } = useRecipeVersions(recipeId);
  const restore = useRestoreRecipeVersion();
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const handleRestore = async (versionId: string) => {
    if (!recipeId) return;
    try {
      await restore.mutateAsync({ recipeId, versionId });
      toast.success("Recipe restored — a snapshot of the previous state was saved first");
      setConfirmId(null);
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e.message ?? "Restore failed");
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Clock className="h-4 w-4" /> Version History
          </SheetTitle>
        </SheetHeader>
        <ScrollArea className="h-[calc(100vh-6rem)] mt-4 pr-3">
          {isLoading ? (
            <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin" /></div>
          ) : versions.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">No prior versions yet — versions are saved automatically each time you save this recipe.</p>
          ) : (
            <ul className="space-y-2">
              {versions.map((v, i) => {
                const snap = v.snapshot ?? {};
                const title = snap?.doc?.title ?? "(untitled)";
                return (
                  <li key={v.id} className="border rounded-lg p-3 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="font-medium text-sm truncate">{title}</span>
                          {i === 0 && <Badge variant="secondary" className="text-[10px]">Latest saved</Badge>}
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {formatDistanceToNow(new Date(v.created_at), { addSuffix: true })}
                          {v.editor_name ? ` · ${v.editor_name}` : ""}
                        </p>
                      </div>
                      {canRestore && (
                        confirmId === v.id ? (
                          <div className="flex gap-1">
                            <Button size="sm" variant="destructive" onClick={() => handleRestore(v.id)} disabled={restore.isPending}>
                              {restore.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "Confirm"}
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setConfirmId(null)}>Cancel</Button>
                          </div>
                        ) : (
                          <Button size="sm" variant="outline" onClick={() => setConfirmId(v.id)}>
                            <RotateCcw className="h-3 w-3 mr-1" />Restore
                          </Button>
                        )
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground flex flex-wrap gap-3">
                      <span>{(snap?.ingredients ?? []).length} ingredients</span>
                      <span>{(snap?.doc?.steps ?? []).length} steps</span>
                      {snap?.doc?.servings != null && <span>Serves {snap.doc.servings}</span>}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
