import { useState, useCallback } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Upload, FileText, Plus, RefreshCw, Trash2, CheckCircle2, Loader2, ChevronDown, ChevronRight, Link2, Zap } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

interface BOMImportSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  locationId: string;
}

interface DiffSummary {
  new: number;
  updated: number;
  removed: number;
  unchanged: number;
  total: number;
}

interface ImportBatch {
  id: string;
  source_system: string;
  status: string;
  file_name: string;
  summary: DiffSummary;
  created_at: string;
  uploaded_by: string;
  approved_at: string | null;
}

interface ImportItem {
  id: string;
  entity_type: string;
  change_type: string;
  r365_name: string;
  category: string | null;
  clean_name: string | null;
  parent_r365_name: string | null;
  quantity: number | null;
  unit_of_measure: string | null;
  yield_percent: number | null;
  previous_values: Record<string, any> | null;
  new_values: Record<string, any> | null;
  resolution: string;
}

export default function BOMImportSheet({ open, onOpenChange, locationId }: BOMImportSheetProps) {
  const queryClient = useQueryClient();
  const [uploading, setUploading] = useState(false);
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    new: true, updated: true, removed: true,
  });

  // Fetch import history
  const { data: batches } = useQuery({
    queryKey: ["bom-import-batches", locationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bom_import_batches")
        .select("*")
        .eq("location_id", locationId)
        .order("created_at", { ascending: false })
        .limit(10);
      if (error) throw error;
      return (data || []) as unknown as ImportBatch[];
    },
    enabled: open,
  });

  // Fetch diff items for selected batch
  const { data: diffItems, isLoading: loadingItems } = useQuery({
    queryKey: ["bom-import-items", selectedBatchId],
    queryFn: async () => {
      // Fetch all diff items (may exceed default 1000 row limit)
      const allItems: ImportItem[] = [];
      let from = 0;
      const pageSize = 1000;
      while (true) {
        const { data, error: pageError } = await supabase
          .from("bom_import_items")
          .select("*")
          .eq("batch_id", selectedBatchId!)
          .neq("change_type", "unchanged")
          .order("entity_type")
          .order("change_type")
          .range(from, from + pageSize - 1);
        if (pageError) throw pageError;
        if (!data || data.length === 0) break;
        allItems.push(...(data as ImportItem[]));
        if (data.length < pageSize) break;
        from += pageSize;
      }
      const data = allItems;
      const error = null;
      if (error) throw error;
      return data;
    },
    enabled: !!selectedBatchId,
  });

  const handleFileUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setUploading(true);
    try {
      // Read all selected CSV files
      const fileContents: { name: string; content: string }[] = [];
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const text = await file.text();
        fileContents.push({ name: file.name, content: text });
      }

      const { data: session } = await supabase.auth.getSession();
      const fileNames = fileContents.map(f => f.name).join(", ");

      // Send all CSV contents together — the edge function will merge them
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/data-sync-service?action=diff-bom`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session?.session?.access_token}`,
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          },
          body: JSON.stringify({
            csvFiles: fileContents.map(f => ({ fileName: f.name, csvContent: f.content })),
            // Backwards compat: also send single file format if only one
            csvContent: fileContents.length === 1 ? fileContents[0].content : undefined,
            locationId,
            sourceSystem: "r365",
            fileName: fileNames,
          }),
        }
      );

      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Upload failed");

      toast.success(`Diff complete: ${result.summary.new} new, ${result.summary.updated} updated, ${result.summary.removed} removed`);
      setSelectedBatchId(result.batchId);
      queryClient.invalidateQueries({ queryKey: ["bom-import-batches", locationId] });
    } catch (err: any) {
      console.error("BOM import error:", err);
      toast.error(err.message || "Failed to process CSV");
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  }, [locationId, queryClient]);

  const [applyResults, setApplyResults] = useState<{
    applied: number;
    bridged: number;
    autoMatched: number;
    autoMatchTotal: number;
    usageRatesCreated: number;
    matchResults: { ingredientName: string; matchedTo: string; score: number }[];
  } | null>(null);

  const applyMutation = useMutation({
    mutationFn: async (batchId: string) => {
      const { data: session } = await supabase.auth.getSession();
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/data-sync-service?action=apply-bom-diff`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session?.session?.access_token}`,
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          },
          body: JSON.stringify({ batchId, locationId }),
        }
      );
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Apply failed");
      return result;
    },
    onSuccess: (data) => {
      const parts = [];
      if (data.created) parts.push(`${data.created} blueprints created`);
      if (data.updated) parts.push(`${data.updated} updated`);
      if (data.autoMatched) parts.push(`${data.autoMatched} auto-matched`);
      if (data.unmappedCount) parts.push(`${data.unmappedCount} need mapping`);
      toast.success(parts.join(' · ') || `Applied ${data.applied} changes`);
      setApplyResults(data);
      queryClient.invalidateQueries({ queryKey: ["bom-import-batches", locationId] });
      queryClient.invalidateQueries({ queryKey: ["bom-import-items", selectedBatchId] });
      queryClient.invalidateQueries({ queryKey: ["blueprint-recipes", locationId] });
      queryClient.invalidateQueries({ queryKey: ["blueprint-costs", locationId] });
      queryClient.invalidateQueries({ queryKey: ["recipe-catalog-items", locationId] });
      queryClient.invalidateQueries({ queryKey: ["inventory-items", locationId] });
    },
    onError: (err: any) => {
      toast.error(err.message || "Failed to apply changes");
    },
  });

  const rejectMutation = useMutation({
    mutationFn: async (batchId: string) => {
      const { error } = await supabase
        .from("bom_import_batches")
        .update({ status: "rejected" })
        .eq("id", batchId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Import rejected");
      setSelectedBatchId(null);
      queryClient.invalidateQueries({ queryKey: ["bom-import-batches", locationId] });
    },
  });

  const selectedBatch = batches?.find(b => b.id === selectedBatchId);
  const isReviewable = selectedBatch?.status === "reviewing";

  const toggleSection = (key: string) => {
    setExpandedSections(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const groupedItems = diffItems?.reduce((acc, item) => {
    const key = item.change_type;
    if (!acc[key]) acc[key] = [];
    acc[key].push(item);
    return acc;
  }, {} as Record<string, ImportItem[]>) || {};

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="h-[85vh] p-0">
        <SheetHeader className="px-4 pt-4 pb-2">
          <SheetTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Recipe Import Pipeline
          </SheetTitle>
        </SheetHeader>

        <Tabs defaultValue={selectedBatchId ? "review" : "upload"} className="px-4">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="upload">Upload</TabsTrigger>
            <TabsTrigger value="review">Review</TabsTrigger>
          </TabsList>

          <TabsContent value="upload" className="space-y-4">
            {/* Upload area */}
            <label className="flex flex-col items-center justify-center border-2 border-dashed border-border rounded-lg p-8 cursor-pointer hover:border-primary/50 transition-colors">
              {uploading ? (
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              ) : (
                <Upload className="h-8 w-8 text-muted-foreground" />
              )}
              <span className="mt-2 text-sm text-muted-foreground">
                {uploading ? "Processing diff..." : "Drop R365 BOM export CSVs"}
              </span>
              <span className="text-xs text-muted-foreground/70 mt-1">
                Upload both Recipes + Ingredients files together
              </span>
              <input
                type="file"
                accept=".csv"
                multiple
                className="hidden"
                onChange={handleFileUpload}
                disabled={uploading}
              />
            </label>

            {/* Import history */}
            <div className="space-y-2">
              <h3 className="text-sm font-medium text-muted-foreground">Import History</h3>
              {batches?.map(batch => (
                <button
                  key={batch.id}
                  onClick={() => setSelectedBatchId(batch.id)}
                  className={`w-full text-left p-3 rounded-lg border transition-colors ${
                    selectedBatchId === batch.id
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-primary/30"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">{batch.file_name}</span>
                    <StatusBadge status={batch.status} />
                  </div>
                  <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                    <span>{new Date(batch.created_at).toLocaleDateString()}</span>
                    {batch.summary && (
                      <span>
                        {(batch.summary as DiffSummary).new || 0} new · {(batch.summary as DiffSummary).updated || 0} changed · {(batch.summary as DiffSummary).removed || 0} removed
                      </span>
                    )}
                  </div>
                </button>
              ))}
              {(!batches || batches.length === 0) && (
                <p className="text-sm text-muted-foreground text-center py-4">No imports yet</p>
              )}
            </div>
          </TabsContent>

          <TabsContent value="review">
            {!selectedBatchId ? (
              <p className="text-sm text-muted-foreground text-center py-8">Select an import to review</p>
            ) : loadingItems ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
            ) : (
              <ScrollArea className="h-[calc(85vh-200px)]">
                <div className="space-y-3 pb-20">
                  {/* Summary bar */}
                  {selectedBatch?.summary && (
                    <div className="flex gap-2 flex-wrap">
                      <Badge variant="default" className="bg-emerald-500/15 text-emerald-600 border-emerald-500/30">
                        <Plus className="h-3 w-3 mr-1" />
                        {(selectedBatch.summary as DiffSummary).new} New
                      </Badge>
                      <Badge variant="default" className="bg-amber-500/15 text-amber-600 border-amber-500/30">
                        <RefreshCw className="h-3 w-3 mr-1" />
                        {(selectedBatch.summary as DiffSummary).updated} Updated
                      </Badge>
                      <Badge variant="default" className="bg-red-500/15 text-red-600 border-red-500/30">
                        <Trash2 className="h-3 w-3 mr-1" />
                        {(selectedBatch.summary as DiffSummary).removed} Removed
                      </Badge>
                    </div>
                  )}

                  {/* New items */}
                  {groupedItems.new && groupedItems.new.length > 0 && (
                    <DiffSection
                      title="New Items"
                      items={groupedItems.new}
                      color="emerald"
                      icon={<Plus className="h-4 w-4" />}
                      expanded={expandedSections.new}
                      onToggle={() => toggleSection("new")}
                    />
                  )}

                  {/* Updated items */}
                  {groupedItems.updated && groupedItems.updated.length > 0 && (
                    <DiffSection
                      title="Updated"
                      items={groupedItems.updated}
                      color="amber"
                      icon={<RefreshCw className="h-4 w-4" />}
                      expanded={expandedSections.updated}
                      onToggle={() => toggleSection("updated")}
                    />
                  )}

                  {/* Removed items */}
                  {groupedItems.removed && groupedItems.removed.length > 0 && (
                    <DiffSection
                      title="Removed"
                      items={groupedItems.removed}
                      color="red"
                      icon={<Trash2 className="h-4 w-4" />}
                      expanded={expandedSections.removed}
                      onToggle={() => toggleSection("removed")}
                    />
                  )}

                  {diffItems?.length === 0 && !applyResults && (
                    <div className="text-center py-8">
                      <CheckCircle2 className="h-8 w-8 text-emerald-500 mx-auto mb-2" />
                      <p className="text-sm text-muted-foreground">No changes detected — BOM is up to date</p>
                    </div>
                  )}

                  {/* Apply Results Summary */}
                  {applyResults && (
                    <div className="space-y-3 border border-primary/20 bg-primary/5 rounded-lg p-4">
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="h-5 w-5 text-primary" />
                        <span className="font-medium text-sm">Import Complete</span>
                      </div>
                      
                      <div className="grid grid-cols-2 gap-2 text-sm">
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">BOM Changes</span>
                          <span className="font-mono">{applyResults.applied}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Recipes Synced</span>
                          <span className="font-mono">{applyResults.bridged}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Auto-Matched</span>
                          <span className="font-mono">
                            {applyResults.autoMatched}/{applyResults.autoMatchTotal}
                          </span>
                        </div>
                      </div>

                      {applyResults.autoMatched > 0 && applyResults.matchResults.length > 0 && (
                        <div className="space-y-1">
                          <p className="text-xs font-medium text-muted-foreground">Top Auto-Matches (review in Matching tab)</p>
                          <div className="max-h-32 overflow-y-auto space-y-0.5">
                            {applyResults.matchResults.map((m, i) => (
                              <div key={i} className="flex items-center gap-2 text-xs bg-background/50 rounded px-2 py-1">
                                <Link2 className="h-3 w-3 text-primary shrink-0" />
                                <span className="truncate">{m.ingredientName}</span>
                                <span className="text-muted-foreground">→</span>
                                <span className="truncate font-medium">{m.matchedTo}</span>
                                <Badge variant="outline" className="text-[9px] px-1 py-0 ml-auto shrink-0">
                                  {m.score}%
                                </Badge>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {applyResults.autoMatchTotal - applyResults.autoMatched > 0 && (
                        <p className="text-xs text-muted-foreground">
                          <Zap className="h-3 w-3 inline mr-1" />
                          {applyResults.autoMatchTotal - applyResults.autoMatched} ingredients still need manual matching
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </ScrollArea>
            )}

            {/* Action buttons */}
            {isReviewable && diffItems && diffItems.length > 0 && (
              <div className="absolute bottom-0 left-0 right-0 p-4 bg-background border-t border-border flex gap-2">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => rejectMutation.mutate(selectedBatchId!)}
                  disabled={rejectMutation.isPending}
                >
                  Reject
                </Button>
                <Button
                  className="flex-1"
                  onClick={() => applyMutation.mutate(selectedBatchId!)}
                  disabled={applyMutation.isPending}
                >
                  {applyMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    <CheckCircle2 className="h-4 w-4 mr-2" />
                  )}
                  Approve & Apply
                </Button>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}

function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case "reviewing":
      return <Badge variant="outline" className="bg-amber-500/10 text-amber-600 border-amber-500/30 text-xs">Review</Badge>;
    case "approved":
      return <Badge variant="outline" className="bg-emerald-500/10 text-emerald-600 border-emerald-500/30 text-xs">Applied</Badge>;
    case "rejected":
      return <Badge variant="outline" className="bg-red-500/10 text-red-600 border-red-500/30 text-xs">Rejected</Badge>;
    default:
      return <Badge variant="outline" className="text-xs">{status}</Badge>;
  }
}

function DiffSection({
  title,
  items,
  color,
  icon,
  expanded,
  onToggle,
}: {
  title: string;
  items: ImportItem[];
  color: string;
  icon: React.ReactNode;
  expanded: boolean;
  onToggle: () => void;
}) {
  const colorMap: Record<string, string> = {
    emerald: "border-emerald-500/20 bg-emerald-500/5",
    amber: "border-amber-500/20 bg-amber-500/5",
    red: "border-red-500/20 bg-red-500/5",
  };

  // Separate recipe_links from standalone items
  const recipeLinks = items.filter(i => i.entity_type === "recipe_link");
  const standaloneItems = items.filter(i => i.entity_type !== "recipe_link");

  // Group recipe links by parent menu item
  const menuItemGroups = recipeLinks.reduce((acc, item) => {
    const parent = item.parent_r365_name || "(no parent)";
    if (!acc[parent]) acc[parent] = [];
    acc[parent].push(item);
    return acc;
  }, {} as Record<string, ImportItem[]>);

  // Sort parent names alphabetically
  const sortedParents = Object.keys(menuItemGroups).sort();

  const entityLabels: Record<string, string> = {
    ingredient: "Ingredients",
    menu_item: "Menu Items",
  };

  // Group standalone items by entity type
  const standaloneGroups = standaloneItems.reduce((acc, item) => {
    const key = item.entity_type;
    if (!acc[key]) acc[key] = [];
    acc[key].push(item);
    return acc;
  }, {} as Record<string, ImportItem[]>);

  return (
    <Collapsible open={expanded} onOpenChange={onToggle}>
      <CollapsibleTrigger className="flex items-center gap-2 w-full py-2">
        {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        {icon}
        <span className="font-medium text-sm">{title}</span>
        <Badge variant="secondary" className="text-xs ml-auto">{items.length}</Badge>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="space-y-2 ml-6">
          {/* Standalone items (ingredients, menu_items) */}
          {Object.entries(standaloneGroups).map(([entityType, entityItems]) => (
            <div key={entityType}>
              <p className="text-xs font-medium text-muted-foreground mb-1">
                {entityLabels[entityType] || entityType} ({entityItems.length})
              </p>
              <div className={`rounded-lg border ${colorMap[color]} divide-y divide-border/50`}>
                {entityItems.map(item => (
                  <div key={item.id} className="px-3 py-2 text-sm">
                    <div className="font-medium truncate">{item.clean_name || item.r365_name}</div>
                    {item.change_type === "updated" && item.previous_values && (
                      <div className="text-xs text-muted-foreground">
                        {Object.entries(item.previous_values).map(([key, val]) => (
                          <span key={key} className="mr-2">
                            {key}: <span className="line-through opacity-50">{String(val)}</span> → {String((item.new_values as any)?.[key])}
                          </span>
                        ))}
                      </div>
                    )}
                    {item.category && (
                      <Badge variant="outline" className="text-[10px] mt-1">{item.category}</Badge>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}

          {/* Recipe links grouped by parent menu item */}
          {sortedParents.length > 0 && (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">
                Recipes ({sortedParents.length} items, {recipeLinks.length} links)
              </p>
              <div className={`rounded-lg border ${colorMap[color]} divide-y divide-border/50`}>
                {sortedParents.map(parent => (
                  <MenuItemGroup
                    key={parent}
                    parentName={parent}
                    ingredients={menuItemGroups[parent]}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function MenuItemGroup({ parentName, ingredients }: { parentName: string; ingredients: ImportItem[] }) {
  const [open, setOpen] = useState(false);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex items-center gap-2 w-full px-3 py-2.5 hover:bg-accent/30 transition-colors">
        {open ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
        <span className="font-medium text-sm truncate">{parentName}</span>
        <Badge variant="secondary" className="text-[10px] ml-auto shrink-0">{ingredients.length}</Badge>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="ml-6 border-l border-border/50">
          {ingredients.map(item => {
            const ingredientName = item.r365_name.split("::")[1] || item.r365_name;
            return (
              <div key={item.id} className="px-3 py-1.5 text-sm">
                <div className="text-muted-foreground truncate">{ingredientName}</div>
                {item.quantity != null && (
                  <div className="text-xs text-muted-foreground/70">
                    {item.quantity} {item.unit_of_measure}
                    {item.previous_values?.quantity && (
                      <span className="ml-1 line-through opacity-50">
                        (was {item.previous_values.quantity})
                      </span>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
