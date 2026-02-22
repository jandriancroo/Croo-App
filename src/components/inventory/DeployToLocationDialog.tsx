/**
 * DeployToLocationDialog — deploys brand master templates to a target location.
 * Auto-matches by keywords, auto-calculates pan baselines using weight ratios,
 * and flags items needing manual review (weight mismatches, count-based items).
 */

import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, Download, AlertTriangle, CheckCircle2, ArrowRight, X } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface DeployToLocationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  brandId: string;
  sourceLocationId: string;
}

interface Template {
  id: string;
  product_name: string;
  common_name: string | null;
  pan_baseline_key: string;
  pan_units_per_lb: number | null;
  pan_enabled_keys: string[];
  is_weight_based: boolean;
  pan_units_per_unit: number | null;
  match_keywords: string[];
  category: string | null;
}

interface TargetItem {
  id: string;
  name: string;
  common_name: string | null;
  pack_size: string | null;
  pack_quantity: number | null;
  pan_sizes: any;
  vendor_source: string | null;
  item_number: string | null;
}

interface MatchResult {
  templateId: string;
  targetItemId: string | null;
  calculatedBaseline: number | null;
  weightPerUnit: number | null;
  needsReview: boolean;
  reviewReason: string | null;
  autoMatched: boolean;
}

/** Parse per-unit weight from pack_size */
function parsePerUnitWeight(packSize: string | null): number | null {
  if (!packSize) return null;
  const s = packSize.trim().toUpperCase();
  const multiMatch = s.match(/^(\d+)\s*\/\s*([\d.]+)\s*(LB|#|KG|OZ)?/);
  if (multiMatch) return parseFloat(multiMatch[2]) || null;
  const singleMatch = s.match(/^([\d.]+)\s*(#|LB|KG|OZ)$/);
  if (singleMatch) return parseFloat(singleMatch[1]) || null;
  return null;
}

/** Score how well a template matches a target item (0-100) */
function matchScore(template: Template, item: TargetItem): number {
  // Boost: if item_number matches a keyword exactly, strong signal
  if (item.item_number) {
    const cleanNum = item.item_number.trim().toLowerCase();
    if (cleanNum.length > 0 && template.match_keywords.includes(cleanNum)) {
      return 95; // Near-perfect match via vendor item code
    }
  }

  const itemWords = (item.name + " " + (item.common_name || ""))
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter(w => w.length > 2);

  const matched = template.match_keywords.filter(kw => itemWords.includes(kw));
  if (matched.length === 0) return 0;
  return Math.round((matched.length / template.match_keywords.length) * 100);
}

export default function DeployToLocationDialog({ open, onOpenChange, brandId, sourceLocationId }: DeployToLocationDialogProps) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [targetLocationId, setTargetLocationId] = useState<string>("");
  const [matches, setMatches] = useState<Map<string, MatchResult>>(new Map());
  const [selectedTemplateIds, setSelectedTemplateIds] = useState<Set<string>>(new Set());

  // Fetch available locations (same brand, excluding source)
  const { data: locations } = useQuery({
    queryKey: ["brand-locations", brandId, sourceLocationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("locations")
        .select("id, name, organization_id")
        .neq("id", sourceLocationId)
        .eq("is_active", true);
      if (error) throw error;
      // Filter to same brand
      const { data: orgs } = await supabase
        .from("organizations")
        .select("id")
        .eq("brand_id", brandId);
      const orgIds = new Set(orgs?.map(o => o.id) ?? []);
      return data.filter(l => orgIds.has(l.organization_id));
    },
    enabled: open,
  });

  // Fetch templates
  const { data: templates } = useQuery({
    queryKey: ["brand-templates-deploy", brandId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("brand_inventory_templates")
        .select("*")
        .eq("brand_id", brandId)
        .order("product_name");
      if (error) throw error;
      return data as Template[];
    },
    enabled: open,
  });

  // Fetch target location items when selected
  const { data: targetItems, isLoading: loadingTarget } = useQuery({
    queryKey: ["target-items", targetLocationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory_items")
        .select("id, name, common_name, pack_size, pack_quantity, pan_sizes, vendor_source, item_number")
        .eq("location_id", targetLocationId)
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data as TargetItem[];
    },
    enabled: !!targetLocationId,
  });

  // Auto-match when target items load
  useMemo(() => {
    if (!templates || !targetItems) return;

    const newMatches = new Map<string, MatchResult>();
    const usedTargetIds = new Set<string>();

    for (const tmpl of templates) {
      // Find best matching target item
      let bestItem: TargetItem | null = null;
      let bestScore = 0;

      for (const item of targetItems) {
        if (usedTargetIds.has(item.id)) continue;
        if (item.pan_sizes?.enabled) continue; // Skip already configured
        const score = matchScore(tmpl, item);
        if (score > bestScore) {
          bestScore = score;
          bestItem = item;
        }
      }

      if (bestItem && bestScore >= 40) {
        usedTargetIds.add(bestItem.id);

        const packQty = bestItem.pack_quantity || 1;
        const targetWeight = parsePerUnitWeight(bestItem.pack_size);

        let calculatedBaseline: number | null = null;
        let needsReview = false;
        let reviewReason: string | null = null;

        if (tmpl.is_weight_based && tmpl.pan_units_per_lb != null) {
          if (targetWeight && targetWeight > 0) {
            // per_unit_fills = pan_units_per_lb * weight_per_unit
            // case_fraction = per_unit_fills / pack_quantity  
            const perUnit = tmpl.pan_units_per_lb * targetWeight;
            calculatedBaseline = Math.round((perUnit / packQty) * 100) / 100;
          } else {
            needsReview = true;
            reviewReason = "Can't parse weight from pack size: " + (bestItem.pack_size || "unknown");
          }
        } else if (!tmpl.is_weight_based && tmpl.pan_units_per_unit != null) {
          // Count-based: per_unit fills directly / pack_quantity
          calculatedBaseline = Math.round((tmpl.pan_units_per_unit / packQty) * 100) / 100;
          needsReview = true;
          reviewReason = "Count-based item — verify conversion is correct";
        }

        newMatches.set(tmpl.id, {
          templateId: tmpl.id,
          targetItemId: bestItem.id,
          calculatedBaseline,
          weightPerUnit: targetWeight,
          needsReview,
          reviewReason,
          autoMatched: true,
        });
      }
    }

    setMatches(newMatches);
    setSelectedTemplateIds(new Set(
      Array.from(newMatches.entries())
        .filter(([_, m]) => m.targetItemId && m.calculatedBaseline && !m.needsReview)
        .map(([id]) => id)
    ));
  }, [templates, targetItems]);

  // Change target item for a template
  const updateMatch = (templateId: string, targetItemId: string) => {
    if (!templates || !targetItems) return;
    const tmpl = templates.find(t => t.id === templateId)!;
    const item = targetItems.find(i => i.id === targetItemId)!;
    const packQty = item.pack_quantity || 1;
    const targetWeight = parsePerUnitWeight(item.pack_size);

    let calculatedBaseline: number | null = null;
    let needsReview = false;
    let reviewReason: string | null = null;

    if (tmpl.is_weight_based && tmpl.pan_units_per_lb != null && targetWeight) {
      const perUnit = tmpl.pan_units_per_lb * targetWeight;
      calculatedBaseline = Math.round((perUnit / packQty) * 100) / 100;
    } else {
      needsReview = true;
      reviewReason = "Verify conversion manually";
    }

    setMatches(prev => {
      const next = new Map(prev);
      next.set(templateId, {
        templateId,
        targetItemId,
        calculatedBaseline,
        weightPerUnit: targetWeight,
        needsReview,
        reviewReason,
        autoMatched: false,
      });
      return next;
    });
  };

  const clearMatch = (templateId: string) => {
    setMatches(prev => {
      const next = new Map(prev);
      next.delete(templateId);
      return next;
    });
    setSelectedTemplateIds(prev => {
      const next = new Set(prev);
      next.delete(templateId);
      return next;
    });
  };

  const toggleSelected = (id: string) => {
    setSelectedTemplateIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const deployMutation = useMutation({
    mutationFn: async () => {
      if (!templates || !user) throw new Error("Missing data");

      // Step 1: Deploy storage locations from source to target
      const { data: sourceLocations } = await supabase
        .from("inventory_locations")
        .select("name, display_order")
        .eq("location_id", sourceLocationId)
        .order("display_order");

      if (sourceLocations && sourceLocations.length > 0) {
        const { data: existingTargetLocs } = await supabase
          .from("inventory_locations")
          .select("name")
          .eq("location_id", targetLocationId);
        
        const existingNames = new Set((existingTargetLocs || []).map(l => l.name.toLowerCase()));
        
        const newLocs = sourceLocations
          .filter(l => !existingNames.has(l.name.toLowerCase()))
          .map((l, i) => ({
            location_id: targetLocationId,
            name: l.name,
            display_order: (existingTargetLocs?.length || 0) + i,
          }));

        if (newLocs.length > 0) {
          await supabase.from("inventory_locations").insert(newLocs);
        }
      }

      // Step 2: Deploy inventory item configurations
      const updates: { itemId: string; panSizes: any; commonName: string | null; category: string | null }[] = [];
      const deploymentRecords: any[] = [];

      for (const templateId of selectedTemplateIds) {
        const match = matches.get(templateId);
        const tmpl = templates.find(t => t.id === templateId);
        if (!match?.targetItemId || !match.calculatedBaseline || !tmpl) continue;

        updates.push({
          itemId: match.targetItemId,
          panSizes: {
            enabled: true,
            baseline_key: tmpl.pan_baseline_key,
            baseline_units: match.calculatedBaseline,
            enabled_keys: tmpl.pan_enabled_keys,
          },
          commonName: tmpl.common_name,
          category: tmpl.category,
        });

        deploymentRecords.push({
          template_id: tmpl.id,
          inventory_item_id: match.targetItemId,
          location_id: targetLocationId,
          weight_per_unit: match.weightPerUnit,
          calculated_baseline: match.calculatedBaseline,
          needs_review: match.needsReview,
          review_reason: match.reviewReason,
          deployed_by: user.id,
        });
      }

      // Update inventory items
      for (const upd of updates) {
        const updateData: any = {
          pan_sizes: upd.panSizes,
        };
        if (upd.commonName) updateData.common_name = upd.commonName;
        if (upd.category) updateData.category = upd.category;

        const { error } = await supabase
          .from("inventory_items")
          .update(updateData)
          .eq("id", upd.itemId);
        if (error) throw error;
      }

      // Record deployments
      if (deploymentRecords.length > 0) {
        const { error } = await supabase
          .from("brand_inventory_deployments")
          .upsert(deploymentRecords, { onConflict: "template_id,location_id" });
        if (error) throw error;
      }

      return updates.length;
    },
    onSuccess: (count) => {
      toast.success(`Deployed ${count} items to location`);
      queryClient.invalidateQueries({ queryKey: ["target-items"] });
      onOpenChange(false);
    },
    onError: (err: any) => {
      toast.error("Deploy failed: " + err.message);
    },
  });

  const matchedCount = Array.from(selectedTemplateIds).filter(id => matches.get(id)?.targetItemId).length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Download className="h-4 w-4" />
            Deploy to Location
          </DialogTitle>
        </DialogHeader>

        {/* Location picker */}
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Target Location</label>
          <Select value={targetLocationId} onValueChange={setTargetLocationId}>
            <SelectTrigger className="h-8 text-sm">
              <SelectValue placeholder="Select a location..." />
            </SelectTrigger>
            <SelectContent>
              {locations?.map(loc => (
                <SelectItem key={loc.id} value={loc.id}>{loc.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {targetLocationId && loadingTarget && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        )}

        {targetLocationId && targetItems && templates && (
          <>
            <div className="flex items-center justify-between py-1">
              <span className="text-xs text-muted-foreground">
                {matches.size} of {templates.length} matched
              </span>
              {matches.size > 0 && (
                <span className="text-xs text-muted-foreground">
                  {Array.from(matches.values()).filter(m => m.needsReview).length} need review
                </span>
              )}
            </div>

            <div className="flex-1 overflow-y-auto space-y-1.5 min-h-0">
              {templates.map(tmpl => {
                const match = matches.get(tmpl.id);
                const targetItem = match?.targetItemId 
                  ? targetItems.find(i => i.id === match.targetItemId) 
                  : null;
                const isSelected = selectedTemplateIds.has(tmpl.id);
                const alreadyConfigured = targetItem?.pan_sizes?.enabled;

                return (
                  <div
                    key={tmpl.id}
                    className={`px-2.5 py-2 rounded-md border transition-colors ${
                      match?.needsReview
                        ? "border-amber-300/60 bg-amber-50/30 dark:bg-amber-950/20"
                        : isSelected
                          ? "border-primary/40 bg-primary/5"
                          : "border-border"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={() => toggleSelected(tmpl.id)}
                        disabled={!match?.targetItemId || !match?.calculatedBaseline}
                        className="h-3.5 w-3.5"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <p className="text-xs font-medium">{tmpl.product_name}</p>
                          {tmpl.category && (
                            <Badge variant="secondary" className="text-[9px] px-1 py-0 h-3.5">
                              {tmpl.category}
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-1 mt-0.5">
                          <ArrowRight className="h-2.5 w-2.5 text-muted-foreground" />
                          {targetItem ? (
                            <span className="text-[10px] text-muted-foreground truncate">
                              {targetItem.name}
                            </span>
                          ) : (
                            <span className="text-[10px] text-muted-foreground italic">No match found</span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {match?.calculatedBaseline && (
                          <Badge variant="outline" className="text-[9px] px-1 py-0 h-3.5 font-mono">
                            {match.calculatedBaseline}
                          </Badge>
                        )}
                        {match?.needsReview && (
                          <AlertTriangle className="h-3 w-3 text-amber-500" />
                        )}
                        {alreadyConfigured && (
                          <CheckCircle2 className="h-3 w-3 text-green-500" />
                        )}
                        {match && (
                          <button onClick={() => clearMatch(tmpl.id)} className="p-0.5">
                            <X className="h-3 w-3 text-muted-foreground" />
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Manual item picker if no match or cleared */}
                    {!match?.targetItemId && (
                      <Select onValueChange={(v) => updateMatch(tmpl.id, v)}>
                        <SelectTrigger className="h-6 text-[10px] mt-1.5">
                          <SelectValue placeholder="Pick item manually..." />
                        </SelectTrigger>
                        <SelectContent>
                          {targetItems
                            .filter(i => !i.pan_sizes?.enabled)
                            .map(i => (
                              <SelectItem key={i.id} value={i.id} className="text-xs">
                                {i.name} {i.pack_size ? `(${i.pack_size})` : ""}
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                    )}

                    {match?.needsReview && match.reviewReason && (
                      <p className="text-[9px] text-amber-600 mt-1">{match.reviewReason}</p>
                    )}
                  </div>
                );
              })}
            </div>

            <Button
              onClick={() => deployMutation.mutate()}
              disabled={matchedCount === 0 || deployMutation.isPending}
              className="w-full"
            >
              {deployMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Download className="h-4 w-4 mr-2" />
              )}
              Deploy {matchedCount} Item{matchedCount !== 1 ? "s" : ""}
            </Button>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
