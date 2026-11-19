import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronDown, FlaskConical, Layers, Plus, Search } from "lucide-react";
import PriceOutliersCard from "./PriceOutliersCard";
import BrandRecipeDialog from "./BrandRecipeDialog";
import { useBrandRecipes, useBrandPriceOutliers, type BrandRecipe } from "./useBrandRecipes";
import PosLinkIndicator from "@/components/inventory/recipe-catalog/PosLinkIndicator";
import { usePosMapping } from "@/components/inventory/recipe-catalog/usePosMapping";
import { buildCatalogSections } from "@/components/inventory/recipe-catalog/buildCatalogSections";
import { SECTION_ICONS } from "@/components/inventory/recipe-catalog/sectionIcons";


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

  // Same section layout as the store Build tab (shared buildCatalogSections),
  // fed brand-only records. PREP recipes get their own block at the bottom.
  const { sections, prep } = useMemo(() => {
    const list = (recipes || []).filter(r => !q || r.name.toLowerCase().includes(q.toLowerCase()));
    const isPrep = (r: BrandRecipe) => (r.category || "").toUpperCase() === "PREP";
    return {
      sections: buildCatalogSections(list.filter(r => !isPrep(r))),
      prep: list.filter(isPrep),
    };
  }, [recipes, q]);

  const openEdit = (id: string | null) => { setEditId(id); setOpen(true); };

  const renderRow = (r: BrandRecipe, posCategory: string | null) => (
    <div key={r.id} className="flex items-center gap-2 px-4 pl-10 py-2">
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
      {posCategory && (
        <PosLinkIndicator
          blueprintId={r.id}
          blueprintName={r.name}
          blueprintCategory={posCategory}
          mapping={pos.mappedBlueprints.get(r.id)}
          posItems={pos.posItems}
          onLink={pos.linkBlueprint}
          onUnlink={pos.unlinkBlueprint}
          onUpdateMeta={pos.updateMappingMeta}
          isLinking={pos.isLinking}
        />
      )}
    </div>
  );

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
            {sections.map(sec => (
              <Collapsible key={sec.key + (q ? "-q" : "")} defaultOpen={!!q}>
                <CollapsibleTrigger asChild>
                  <button className="w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-muted/30">
                    <ChevronDown className="h-4 w-4 text-muted-foreground -rotate-90 transition-transform [[data-state=open]>&]:rotate-0" />
                    {SECTION_ICONS[sec.key]}
                    <span className="text-sm font-medium">{sec.label}</span>
                    <Badge variant="outline" className="ml-auto text-[10px] tabular-nums">
                      {sec.bases.length + sec.cores.length + sec.menuItems.length}
                    </Badge>
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  {([
                    ["Bases", "base", sec.bases],
                    ["Cores", "core", sec.cores],
                    ["Menu items", "mi", sec.menuItems],
                  ] as const).filter(([, , items]) => items.length > 0).map(([label, posCat, items]) => (
                    <div key={label} className="pb-1">
                      <p className="px-6 pt-2 pb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                        {label} <span className="tabular-nums">({items.length})</span>
                      </p>
                      <div className="divide-y divide-border/60">
                        {items.map(r => renderRow(r, posCat))}
                      </div>
                    </div>
                  ))}
                </CollapsibleContent>
              </Collapsible>
            ))}

            {prep.length > 0 && (
              <Collapsible key={"prep" + (q ? "-q" : "")} defaultOpen={!!q}>
                <CollapsibleTrigger asChild>
                  <button className="w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-muted/30">
                    <ChevronDown className="h-4 w-4 text-muted-foreground -rotate-90 transition-transform [[data-state=open]>&]:rotate-0" />
                    <FlaskConical className="h-4 w-4" />
                    <span className="text-sm font-medium">Prep Recipes</span>
                    <Badge variant="outline" className="ml-auto text-[10px] tabular-nums">{prep.length}</Badge>
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="divide-y divide-border/60">
                    {prep.map(r => renderRow(r, null))}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            )}

            {sections.length === 0 && prep.length === 0 && (
              <p className="p-4 text-sm text-muted-foreground">No recipes match.</p>
            )}
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
