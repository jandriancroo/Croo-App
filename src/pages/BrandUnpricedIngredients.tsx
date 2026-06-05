import { useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, RefreshCw, Archive, AlertCircle, ChefHat, Search } from "lucide-react";
import { Layout } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { supabase } from "@/integrations/supabase/client";
import { fetchBrandUnpricedIngredients } from "@/utils/brandUnpricedIngredients";
import { toast } from "sonner";
import { format } from "date-fns";

const fmtCurrency = (v: number | null) =>
  v == null
    ? "—"
    : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(v);

export default function BrandUnpricedIngredients({ embedded = false }: { embedded?: boolean } = {}) {
  const { brandId } = useParams<{ brandId: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [archiveTarget, setArchiveTarget] = useState<{ id: string; name: string } | null>(null);
  const [syncing, setSyncing] = useState(false);

  const { data: brand } = useQuery({
    queryKey: ["brand-detail", brandId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("brands").select("id, name").eq("id", brandId!).single();
      if (error) throw error;
      return data;
    },
    enabled: !!brandId,
  });

  const { data: items = [], isLoading, refetch } = useQuery({
    queryKey: ["brand-unpriced-ingredients", brandId],
    queryFn: () => fetchBrandUnpricedIngredients(brandId!),
    enabled: !!brandId,
    staleTime: 60_000,
  });

  const filtered = useMemo(() => {
    if (!search.trim()) return items;
    const q = search.toLowerCase();
    return items.filter(
      (i) =>
        i.name.toLowerCase().includes(q) ||
        (i.category || "").toLowerCase().includes(q),
    );
  }, [items, search]);

  const totalRecipesAffected = useMemo(() => {
    const set = new Set<string>();
    for (const i of items) for (const r of i.recipes) set.add(r.blueprintId);
    return set.size;
  }, [items]);

  const handleSync = async () => {
    setSyncing(true);
    try {
      const { error } = await supabase.functions.invoke("vendor-sku-health-sync", {
        body: {},
      });
      if (error) throw error;
      toast.success("Vendor sync triggered. Pricing will refresh in the background.");
      setTimeout(() => refetch(), 3000);
    } catch (e: any) {
      toast.error(`Sync failed: ${e.message ?? e}`);
    } finally {
      setSyncing(false);
    }
  };

  const handleArchive = async () => {
    if (!archiveTarget) return;
    const { error } = await supabase
      .from("brand_inventory_templates")
      .update({ status: "archived" })
      .eq("id", archiveTarget.id);
    if (error) {
      toast.error(`Archive failed: ${error.message}`);
    } else {
      toast.success(`${archiveTarget.name} archived`);
      qc.invalidateQueries({ queryKey: ["brand-unpriced-ingredients", brandId] });
      qc.invalidateQueries({ queryKey: ["brand-templates", brandId] });
    }
    setArchiveTarget(null);
  };

  const Wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) =>
    embedded ? <>{children}</> : <Layout>{children}</Layout>;

  return (
    <Wrapper>
      <div className={embedded ? "space-y-4" : "container max-w-7xl mx-auto p-4 space-y-4"}>
        {/* Header */}
        <div className="flex items-center gap-3">
          {!embedded && (
            <Button variant="ghost" size="icon" onClick={() => navigate(`/brand/${brandId}/inventory`)}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
          )}
          <div className="flex-1 min-w-0">
            {!embedded && <div className="text-xs text-muted-foreground">{brand?.name ?? "Brand"}</div>}
            <h1 className={embedded ? "text-base font-semibold" : "text-xl font-semibold truncate"}>Unpriced Ingredients</h1>
          </div>
          <Button onClick={handleSync} disabled={syncing} size="sm" className="gap-2">
            <RefreshCw className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`} />
            {syncing ? "Syncing..." : "Sync All Vendor Prices"}
          </Button>
        </div>

        {/* Summary */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground font-medium">Unpriced items</CardTitle></CardHeader>
            <CardContent className="text-2xl font-semibold tabular-nums">{items.length}</CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground font-medium">Recipes affected</CardTitle></CardHeader>
            <CardContent className="text-2xl font-semibold tabular-nums">{totalRecipesAffected}</CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground font-medium">With invoice history</CardTitle></CardHeader>
            <CardContent className="text-2xl font-semibold tabular-nums">
              {items.filter(i => i.lastKnownPrice != null).length}
            </CardContent>
          </Card>
        </div>

        {/* Why card */}
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardContent className="p-3 flex gap-3 items-start text-xs">
            <AlertCircle className="h-4 w-4 text-amber-600 mt-0.5 flex-shrink-0" />
            <div className="space-y-1">
              <div className="font-medium">Why these are unpriced</div>
              <div className="text-muted-foreground">
                Each item below is a brand template that recipes depend on but has no resolved cost across any deployed location.
                Theoretical COGS treats these as $0, which inflates AvT variance as mystery loss.
                Fix by re-syncing vendor pricing or archiving the item — never type a price by hand.
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Filter by item name or category..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        {/* Table */}
        <Card>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-8 text-center text-sm text-muted-foreground">Loading…</div>
            ) : filtered.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground">
                {items.length === 0
                  ? "No unpriced ingredients. Every recipe ingredient resolves to a real cost."
                  : "No items match your search."}
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Brand item</TableHead>
                    <TableHead className="hidden md:table-cell">Category</TableHead>
                    <TableHead className="text-right">Last known price</TableHead>
                    <TableHead className="hidden sm:table-cell text-right">Deployments</TableHead>
                    <TableHead>Recipes</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map(item => (
                    <TableRow key={item.templateId}>
                      <TableCell className="font-medium">{item.name}</TableCell>
                      <TableCell className="hidden md:table-cell text-muted-foreground text-sm">
                        {item.category || "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        <div>{fmtCurrency(item.lastKnownPrice)}</div>
                        {item.lastKnownPriceDate && (
                          <div className="text-[10px] text-muted-foreground">
                            {format(new Date(item.lastKnownPriceDate), "MMM d, yyyy")}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="hidden sm:table-cell text-right text-sm tabular-nums">
                        {item.deploymentCount}
                      </TableCell>
                      <TableCell>
                        {item.recipes.length === 0 ? (
                          <span className="text-xs text-muted-foreground">—</span>
                        ) : (
                          <Popover>
                            <PopoverTrigger asChild>
                              <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs">
                                <ChefHat className="h-3 w-3" />
                                {item.recipes.length}
                              </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-72 p-2 text-xs">
                              <div className="font-medium mb-1.5">Recipes using {item.name}</div>
                              <div className="max-h-60 overflow-y-auto space-y-0.5">
                                {item.recipes.map(r => (
                                  <div key={r.blueprintId} className="px-1.5 py-1 rounded hover:bg-muted">
                                    {r.name}
                                  </div>
                                ))}
                              </div>
                            </PopoverContent>
                          </Popover>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 gap-1 text-xs text-destructive hover:text-destructive"
                          onClick={() => setArchiveTarget({ id: item.templateId, name: item.name })}
                        >
                          <Archive className="h-3 w-3" />
                          Archive
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      <AlertDialog open={!!archiveTarget} onOpenChange={(o) => !o && setArchiveTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive {archiveTarget?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This sets the brand template to archived. Recipes that reference it will start showing it as an
              archived ingredient on the AvT data-quality card. You can restore it later from the brand catalog.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleArchive}>Archive</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      </div>
    </Wrapper>
  );
}
