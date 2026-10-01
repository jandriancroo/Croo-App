import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronDown, Layers, Plus, Search } from "lucide-react";
import PriceOutliersCard from "./PriceOutliersCard";
import BrandRecipeDialog from "./BrandRecipeDialog";
import { useBrandRecipes, useBrandPriceOutliers, type BrandRecipe } from "./useBrandRecipes";
import PosLinkIndicator from "@/components/inventory/recipe-catalog/PosLinkIndicator";
import { usePosMapping } from "@/components/inventory/recipe-catalog/usePosMapping";

const GROUPS: { key: string; label: string }[] = [
  { key: "MI", label: "Menu items" },
  { key: "CORE", label: "Cores" },
  { key: "BASE", label: "Bases" },
  { key: "CATERING", label: "Catering" },
  { key: "PREP", label: "Prep & sub-recipes" },
];

/** Brand Recipes tab: brand records only, no store picker. */
const BrandRecipesTab = ({ brandId }: { brandId: string }) => {
  const { data: recipes, isLoading } = useBrandRecipes(brandId);
  const { data: outliers } = useBrandPriceOutliers(brandId);
  const pos = usePosMapping("", brandId);
  const [editId, setEditId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");

  const flaggedRecipes = useMemo(() => {
    const s = new Set<string>();
    for (const o of outliers || []) for (const r of o.recipes) s.add(r);
    return s;
  }, [outliers]);

  const grouped = useMemo(() => {
    const list = (recipes || []).filter(r => !q || r.name.toLowerCase().includes(q.toLowerCase()));
    const m = new Map<string, BrandRecipe[]>();
    for (const r of list) {
      const c = (r.category || "").toUpperCase();
      const k = GROUPS.some(g => g.key === c) ? c : "PREP";
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(r);
    }
    return GROUPS.map(g => ({ ...g, items: m.get(g.key) || [] })).filter(g => g.items.length);
  }, [recipes, q]);

  const openEdit = (id: string | null) => { setEditId(id); setOpen(true); };

  return (
    <div className="space-y-4">
      <PriceOutliersCard brandId={brandId} />

      <Card>
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
          <Layers className="h-4 w-4" />
          <span className="font-semibold text-sm">Brand recipes</span>
          <Badge variant="secondary" className="text-xs tabular-nums">{recipes?.length ?? "…"}</Badge>
          <div className="relative ml-auto w-40 sm:w-56">
            <Search className="h-3.5 w-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Search" className="h-8 pl-7 text-xs" />
          </div>
          <button
            className="flex items-center gap-1 px-3 py-1.5 text-[11px] font-medium rounded-full border border-border text-muted-foreground hover:text-foreground"
            onClick={() => openEdit(null)}
          >
            <Plus className="h-3 w-3" />New
          </button>
        </div>

        {isLoading ? (
          <p className="p-4 text-sm text-muted-foreground">Loading recipes…</p>
        ) : (
          <div className="divide-y divide-border">
            {grouped.map((g, gi) => (
              <Collapsible key={g.key + (q ? "-q" : "")} defaultOpen={gi === 0 || !!q}>
                <CollapsibleTrigger asChild>
                  <button className="w-full flex items-center gap-2 px-4 py-2.5 text-left hover:bg-muted/30">
                    <span className="text-sm font-medium">{g.label}</span>
                    <Badge variant="outline" className="text-[10px] tabular-nums">{g.items.length}</Badge>
                    <ChevronDown className="h-4 w-4 ml-auto text-muted-foreground transition-transform [[data-state=open]>&]:rotate-180" />
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="divide-y divide-border/60">
                    {g.items.map(r => (
                      <div key={r.id} className="flex items-center gap-2 px-4 py-2">
                        <button className="flex-1 min-w-0 text-left" onClick={() => openEdit(r.id)}>
                          <p className="text-sm truncate">
                            {r.name}
                            {flaggedRecipes.has(r.name) && <span className="ml-1" title="Has a price outlier">⚠️</span>}
                          </p>
                          <p className="text-[11px] text-muted-foreground">
                            Yield {r.yield_qty ?? "—"} {r.yield_unit ?? ""}
                          </p>
                        </button>
                        {r.is_countable && <Badge variant="secondary" className="text-[10px]">Counted</Badge>}
                        {(g.key === "MI" || g.key === "CORE" || g.key === "BASE" || g.key === "CATERING") && (
                          <PosLinkIndicator
                            blueprintId={r.id}
                            blueprintName={r.name}
                            blueprintCategory={g.key.toLowerCase()}
                            mapping={pos.mappedBlueprints.get(r.id)}
                            posItems={pos.posItems}
                            onLink={pos.linkBlueprint}
                            onUnlink={pos.unlinkBlueprint}
                            onUpdateMeta={pos.updateMappingMeta}
                            isLinking={pos.isLinking}
                          />
                        )}
                      </div>
                    ))}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            ))}
          </div>
        )}
      </Card>

      {open && (
        <BrandRecipeDialog
          open={open}
          onOpenChange={o => { setOpen(o); if (!o) setEditId(null); }}
          brandId={brandId}
          blueprintId={editId}
        />
      )}
    </div>
  );
};

export default BrandRecipesTab;
