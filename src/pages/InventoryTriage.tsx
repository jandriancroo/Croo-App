import { useState, useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, Search, Filter, CheckCircle2, Loader2 } from "lucide-react";
import { toast } from "sonner";

type Classification = "MI" | "BASE" | "CORE" | "PREP" | "INGREDIENT" | "EXCLUDE" | "";

interface BlueprintRow {
  id: string;
  name: string;
  category: string | null;
  source: string | null;
  yield_qty: number | null;
  yield_unit: string | null;
}

const CLASSIFICATION_OPTIONS: { value: Classification; label: string; color: string }[] = [
  { value: "MI", label: "Menu Item", color: "bg-blue-500/10 text-blue-700 border-blue-500/30" },
  { value: "BASE", label: "Base", color: "bg-purple-500/10 text-purple-700 border-purple-500/30" },
  { value: "CORE", label: "Core", color: "bg-indigo-500/10 text-indigo-700 border-indigo-500/30" },
  { value: "PREP", label: "Prep Recipe", color: "bg-green-500/10 text-green-700 border-green-500/30" },
  { value: "INGREDIENT", label: "Ingredient", color: "bg-amber-500/10 text-amber-700 border-amber-500/30" },
  { value: "EXCLUDE", label: "Exclude", color: "bg-red-500/10 text-red-700 border-red-500/30" },
];

const classColorMap = new Map(CLASSIFICATION_OPTIONS.map(o => [o.value, o.color]));

const InventoryTriage = () => {
  const { locationId } = useParams<{ locationId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [filterBy, setFilterBy] = useState<Classification | "all" | "unclassified">("unclassified");
  const [classifications, setClassifications] = useState<Map<string, Classification>>(new Map());
  const [isSaving, setIsSaving] = useState(false);

  const { data: blueprints, isLoading } = useQuery({
    queryKey: ["triage-blueprints", locationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("recipe_blueprints" as any)
        .select("id, name, category, source, yield_qty, yield_unit")
        .eq("location_id", locationId)
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return (data || []) as unknown as BlueprintRow[];
    },
    enabled: !!locationId,
  });

  const setClassification = (id: string, value: Classification) => {
    setClassifications(prev => {
      const next = new Map(prev);
      if (value === "") next.delete(id);
      else next.set(id, value);
      return next;
    });
  };

  const filtered = useMemo(() => {
    if (!blueprints) return [];
    let list = blueprints;
    
    if (search) {
      const lower = search.toLowerCase();
      list = list.filter(b => b.name.toLowerCase().includes(lower));
    }

    if (filterBy === "unclassified") {
      list = list.filter(b => {
        const cat = b.category?.toUpperCase();
        return !cat || !["MI", "BASE", "CORE", "PREP", "INGREDIENT"].includes(cat);
      });
    } else if (filterBy !== "all") {
      list = list.filter(b => {
        const assigned = classifications.get(b.id);
        const cat = assigned || b.category?.toUpperCase();
        return cat === filterBy;
      });
    }

    return list;
  }, [blueprints, search, filterBy, classifications]);

  const handleSave = async () => {
    if (classifications.size === 0) return;
    setIsSaving(true);
    try {
      const updates = Array.from(classifications.entries());
      
      for (const [id, classification] of updates) {
        if (classification === "EXCLUDE") {
          // Deactivate excluded items
          await supabase
            .from("recipe_blueprints" as any)
            .update({ is_active: false } as any)
            .eq("id", id);
        } else {
          // Update category
          await supabase
            .from("recipe_blueprints" as any)
            .update({ category: classification } as any)
            .eq("id", id);
        }
      }

      toast.success(`Updated ${updates.length} item${updates.length > 1 ? "s" : ""}`);
      setClassifications(new Map());
      queryClient.invalidateQueries({ queryKey: ["triage-blueprints"] });
      queryClient.invalidateQueries({ queryKey: ["recipe-catalog-blueprints"] });
      queryClient.invalidateQueries({ queryKey: ["blueprint-recipes"] });
    } catch (err: any) {
      toast.error(err.message || "Failed to save");
    } finally {
      setIsSaving(false);
    }
  };

  const pendingCount = classifications.size;
  const totalCount = blueprints?.length || 0;
  const classifiedCount = blueprints?.filter(b => {
    const cat = b.category?.toUpperCase();
    return cat && ["MI", "BASE", "CORE", "PREP", "INGREDIENT"].includes(cat);
  }).length || 0;

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b border-border px-4 py-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate(`/inventory/${locationId}`)}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="flex-1 min-w-0">
            <h1 className="text-lg font-bold">Item Triage</h1>
            <p className="text-xs text-muted-foreground">
              {classifiedCount}/{totalCount} classified
              {pendingCount > 0 && <span className="text-primary ml-1">• {pendingCount} pending</span>}
            </p>
          </div>
          {pendingCount > 0 && (
            <Button size="sm" onClick={handleSave} disabled={isSaving} className="gap-1">
              {isSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
              Save ({pendingCount})
            </Button>
          )}
        </div>

        {/* Search + Filter */}
        <div className="flex gap-2 mt-3">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Search items..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-8 h-8 text-sm"
            />
          </div>
          <Select value={filterBy} onValueChange={(v) => setFilterBy(v as any)}>
            <SelectTrigger className="w-[140px] h-8 text-xs">
              <Filter className="h-3 w-3 mr-1" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All ({totalCount})</SelectItem>
              <SelectItem value="unclassified">Unclassified</SelectItem>
              {CLASSIFICATION_OPTIONS.filter(o => o.value !== "EXCLUDE").map(o => (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* List */}
      <div className="px-2 py-2 space-y-1">
        {isLoading && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}
        
        {!isLoading && filtered.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-12">
            {search ? "No items match your search" : "All items have been classified! 🎉"}
          </p>
        )}

        {filtered.map(item => {
          const currentCat = classifications.get(item.id) || item.category?.toUpperCase() as Classification || "";
          const isPending = classifications.has(item.id);

          return (
            <div
              key={item.id}
              className={`flex items-center gap-2 py-2 px-3 rounded-lg border transition-colors ${
                isPending ? "border-primary/30 bg-primary/5" : "border-transparent hover:bg-muted/50"
              }`}
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{item.name}</p>
                <div className="flex items-center gap-1.5 mt-0.5">
                  {item.category && (
                    <Badge variant="outline" className="text-[9px] px-1 py-0 uppercase">
                      {item.category}
                    </Badge>
                  )}
                  {item.source === "r365_import" && (
                    <Badge variant="outline" className="text-[9px] px-1 py-0 opacity-50">R365</Badge>
                  )}
                  {item.yield_qty && item.yield_unit && (
                    <span className="text-[10px] text-muted-foreground">
                      yields {item.yield_qty} {item.yield_unit}
                    </span>
                  )}
                </div>
              </div>

              <Select
                value={currentCat || "unset"}
                onValueChange={(v) => {
                  if (v === "unset") setClassification(item.id, "");
                  else setClassification(item.id, v as Classification);
                }}
              >
                <SelectTrigger className={`w-[110px] h-7 text-[11px] font-medium border ${
                  currentCat && classColorMap.has(currentCat) ? classColorMap.get(currentCat) : "border-border"
                }`}>
                  <SelectValue placeholder="Classify" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="unset" className="text-xs text-muted-foreground">— Unset —</SelectItem>
                  {CLASSIFICATION_OPTIONS.map(o => (
                    <SelectItem key={o.value} value={o.value} className="text-xs">{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default InventoryTriage;
