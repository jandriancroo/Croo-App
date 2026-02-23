/**
 * DeployToLocationDialog — two-step wizard to deploy brand master templates to a target location.
 * Step 1: Pick target location + select which features to deploy
 * Step 2: Review matched items + deploy
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
import { Loader2, Download, AlertTriangle, ArrowRight, X, Flame, ChevronLeft } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

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
  storage_location_name: string | null;
  shortcut_location_names: string[] | null;
  usage_rate: number | null;
  usage_rate_unit: string | null;
  usage_rate_manual_override: boolean | null;
  product_group_name: string | null;
  product_group_pos_categories: string[] | null;
  product_group_pos_items: string[] | null;
  pan_overrides: any;
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

type DeployFeature = 'pan_sizes' | 'common_names' | 'categories' | 'storage_locations' | 'shortcuts' | 'usage_rates' | 'product_groups';

const FEATURE_LABELS: Record<DeployFeature, string> = {
  pan_sizes: "Pan Sizes",
  common_names: "Common Names",
  categories: "Categories",
  storage_locations: "Storage Locations",
  shortcuts: "Shortcuts",
  usage_rates: "Usage Rates",
  product_groups: "Product Groups",
};

const FEATURE_DESCRIPTIONS: Record<DeployFeature, string> = {
  pan_sizes: "Pan size configurations & volume conversions",
  common_names: "Friendly display names for items",
  categories: "Item categories (Produce, Dairy, etc.)",
  storage_locations: "Where items are stored (auto-creates missing)",
  shortcuts: "Secondary storage locations (auto-creates missing)",
  usage_rates: "Consumption rates per product group",
  product_groups: "Product groupings & POS category mappings",
};

const ALL_FEATURES: DeployFeature[] = ['pan_sizes', 'common_names', 'categories', 'storage_locations', 'shortcuts', 'usage_rates', 'product_groups'];

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
  if (item.item_number) {
    const cleanNum = item.item_number.trim().toLowerCase();
    if (cleanNum.length > 0 && template.match_keywords.includes(cleanNum)) {
      return 95;
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
  const [step, setStep] = useState<1 | 2>(1);
  const [targetLocationId, setTargetLocationId] = useState<string>("");
  const [selectedFeatures, setSelectedFeatures] = useState<Set<DeployFeature>>(new Set(ALL_FEATURES));
  const [matches, setMatches] = useState<Map<string, MatchResult>>(new Map());
  const [selectedTemplateIds, setSelectedTemplateIds] = useState<Set<string>>(new Set());

  const isDeployAll = selectedFeatures.size === ALL_FEATURES.length;

  const toggleDeployAll = () => {
    if (isDeployAll) {
      setSelectedFeatures(new Set());
    } else {
      setSelectedFeatures(new Set(ALL_FEATURES));
    }
  };

  const toggleFeature = (f: DeployFeature) => {
    setSelectedFeatures(prev => {
      const next = new Set(prev);
      if (next.has(f)) next.delete(f);
      else next.add(f);
      return next;
    });
  };

  // Reset state when dialog closes
  const handleOpenChange = (o: boolean) => {
    if (!o) {
      setStep(1);
      setTargetLocationId("");
      setSelectedFeatures(new Set(ALL_FEATURES));
      setMatches(new Map());
      setSelectedTemplateIds(new Set());
    }
    onOpenChange(o);
  };

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

  // Fetch target location items when on step 2
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
    enabled: step === 2 && !!targetLocationId,
  });

  // Auto-match when target items load
  useMemo(() => {
    if (!templates || !targetItems || step !== 2) return;

    const newMatches = new Map<string, MatchResult>();
    const usedTargetIds = new Set<string>();

    // Filter templates to only those that have data for selected features
    const relevantTemplates = templates.filter(tmpl => {
      if (selectedFeatures.has('pan_sizes') && tmpl.pan_units_per_lb != null) return true;
      if (selectedFeatures.has('pan_sizes') && tmpl.pan_units_per_unit != null) return true;
      if (selectedFeatures.has('common_names') && tmpl.common_name) return true;
      if (selectedFeatures.has('categories') && tmpl.category) return true;
      if (selectedFeatures.has('storage_locations') && tmpl.storage_location_name) return true;
      if (selectedFeatures.has('shortcuts') && tmpl.shortcut_location_names?.length) return true;
      if (selectedFeatures.has('usage_rates') && tmpl.usage_rate != null) return true;
      if (selectedFeatures.has('product_groups') && tmpl.product_group_name) return true;
      return false;
    });

    for (const tmpl of relevantTemplates) {
      let bestItem: TargetItem | null = null;
      let bestScore = 0;

      for (const item of targetItems) {
        if (usedTargetIds.has(item.id)) continue;
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

        if (selectedFeatures.has('pan_sizes')) {
          if (tmpl.is_weight_based && tmpl.pan_units_per_lb != null) {
            if (targetWeight && targetWeight > 0) {
              const perUnit = tmpl.pan_units_per_lb * targetWeight;
              calculatedBaseline = Math.round((perUnit / packQty) * 100) / 100;
            } else {
              needsReview = true;
              reviewReason = "Can't parse weight from pack size: " + (bestItem.pack_size || "unknown");
            }
          } else if (!tmpl.is_weight_based && tmpl.pan_units_per_unit != null) {
            calculatedBaseline = Math.round((tmpl.pan_units_per_unit / packQty) * 100) / 100;
            needsReview = true;
            reviewReason = "Count-based item — verify conversion";
          }
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
        .filter(([_, m]) => m.targetItemId)
        .filter(([_, m]) => !selectedFeatures.has('pan_sizes') || (m.calculatedBaseline && !m.needsReview))
        .map(([id]) => id)
    ));
  }, [templates, targetItems, step]);

  const updateMatch = (templateId: string, targetItemId: string) => {
    if (!templates || !targetItems) return;
    const tmpl = templates.find(t => t.id === templateId)!;
    const item = targetItems.find(i => i.id === targetItemId)!;
    const packQty = item.pack_quantity || 1;
    const targetWeight = parsePerUnitWeight(item.pack_size);

    let calculatedBaseline: number | null = null;
    let needsReview = false;
    let reviewReason: string | null = null;

    if (selectedFeatures.has('pan_sizes')) {
      if (tmpl.is_weight_based && tmpl.pan_units_per_lb != null && targetWeight) {
        const perUnit = tmpl.pan_units_per_lb * targetWeight;
        calculatedBaseline = Math.round((perUnit / packQty) * 100) / 100;
      } else {
        needsReview = true;
        reviewReason = "Verify conversion manually";
      }
    }

    setMatches(prev => {
      const next = new Map(prev);
      next.set(templateId, { templateId, targetItemId, calculatedBaseline, weightPerUnit: targetWeight, needsReview, reviewReason, autoMatched: false });
      return next;
    });
  };

  const clearMatch = (templateId: string) => {
    setMatches(prev => { const next = new Map(prev); next.delete(templateId); return next; });
    setSelectedTemplateIds(prev => { const next = new Set(prev); next.delete(templateId); return next; });
  };

  const toggleSelected = (id: string) => {
    setSelectedTemplateIds(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  };

  /** Count what data each template will push */
  const getFeatureIndicators = (tmpl: Template) => {
    const indicators: string[] = [];
    if (selectedFeatures.has('pan_sizes') && (tmpl.pan_units_per_lb != null || tmpl.pan_units_per_unit != null)) indicators.push("Pan");
    if (selectedFeatures.has('common_names') && tmpl.common_name) indicators.push("Name");
    if (selectedFeatures.has('categories') && tmpl.category) indicators.push("Cat");
    if (selectedFeatures.has('storage_locations') && tmpl.storage_location_name) indicators.push("Stor");
    if (selectedFeatures.has('shortcuts') && tmpl.shortcut_location_names?.length) indicators.push(`${tmpl.shortcut_location_names.length} SC`);
    if (selectedFeatures.has('usage_rates') && tmpl.usage_rate != null) indicators.push("Rate");
    if (selectedFeatures.has('product_groups') && tmpl.product_group_name) indicators.push("Grp");
    return indicators;
  };

  // Count new storage locations that will be created (from primary + shortcuts)
  const newStorageLocations = useMemo(() => {
    if (!templates) return [];
    const needsStorageLocs = selectedFeatures.has('storage_locations') || selectedFeatures.has('shortcuts');
    if (!needsStorageLocs) return [];
    const names = new Set<string>();
    for (const tid of selectedTemplateIds) {
      const tmpl = templates.find(t => t.id === tid);
      if (selectedFeatures.has('storage_locations') && tmpl?.storage_location_name) {
        names.add(tmpl.storage_location_name);
      }
      if (selectedFeatures.has('shortcuts') && tmpl?.shortcut_location_names?.length) {
        for (const n of tmpl.shortcut_location_names) names.add(n);
      }
    }
    return Array.from(names);
  }, [selectedTemplateIds, templates, selectedFeatures]);

  const deployMutation = useMutation({
    mutationFn: async () => {
      if (!templates || !user) throw new Error("Missing data");

      // Step 1: Auto-create missing storage locations (for primary + shortcuts)
      const needsStorageCreation = (selectedFeatures.has('storage_locations') || selectedFeatures.has('shortcuts')) && newStorageLocations.length > 0;
      if (needsStorageCreation) {
        const { data: existingLocs } = await supabase
          .from("inventory_locations")
          .select("name")
          .eq("location_id", targetLocationId);

        const existingNames = new Set((existingLocs || []).map(l => l.name.toLowerCase()));
        const locsToCreate = newStorageLocations
          .filter(n => !existingNames.has(n.toLowerCase()))
          .map((name, i) => ({
            location_id: targetLocationId,
            name,
            display_order: (existingLocs?.length || 0) + i,
          }));

        if (locsToCreate.length > 0) {
          await supabase.from("inventory_locations").insert(locsToCreate);
        }
      }

      // Fetch storage locations at target for ID resolution
      const { data: targetStorageLocs } = await supabase
        .from("inventory_locations")
        .select("id, name")
        .eq("location_id", targetLocationId);
      const targetStorageMap = new Map((targetStorageLocs || []).map(l => [l.name.toLowerCase(), l.id]));

      // Step 2: Create/find product groups at target
      let targetGroupMap = new Map<string, string>(); // group name → group id
      if (selectedFeatures.has('product_groups')) {
        const { data: existingGroups } = await supabase
          .from("inventory_product_groups")
          .select("id, name")
          .eq("location_id", targetLocationId);
        targetGroupMap = new Map((existingGroups || []).map(g => [g.name.toLowerCase(), g.id]));

        // Create missing product groups
        const groupsToCreate: { name: string; pos_categories: string[] | null; pos_items: string[] | null }[] = [];
        for (const tid of selectedTemplateIds) {
          const tmpl = templates.find(t => t.id === tid);
          if (tmpl?.product_group_name && !targetGroupMap.has(tmpl.product_group_name.toLowerCase())) {
            groupsToCreate.push({
              name: tmpl.product_group_name,
              pos_categories: tmpl.product_group_pos_categories,
              pos_items: tmpl.product_group_pos_items,
            });
            targetGroupMap.set(tmpl.product_group_name.toLowerCase(), '__pending__');
          }
        }

        if (groupsToCreate.length > 0) {
          const { data: created } = await supabase
            .from("inventory_product_groups")
            .insert(groupsToCreate.map(g => ({
              location_id: targetLocationId,
              name: g.name,
              pos_categories: g.pos_categories,
              pos_items: g.pos_items,
            })))
            .select("id, name");
          for (const g of created || []) {
            targetGroupMap.set(g.name.toLowerCase(), g.id);
          }
        }
      }

      // Step 3: Deploy item configurations
      const deploymentRecords: any[] = [];

      for (const templateId of selectedTemplateIds) {
        const match = matches.get(templateId);
        const tmpl = templates.find(t => t.id === templateId);
        if (!match?.targetItemId || !tmpl) continue;

        const updateData: any = {};

        // Pan sizes
        if (selectedFeatures.has('pan_sizes') && match.calculatedBaseline && (tmpl.pan_units_per_lb != null || tmpl.pan_units_per_unit != null)) {
          updateData.pan_sizes = {
            enabled: true,
            baseline_key: tmpl.pan_baseline_key,
            baseline_units: match.calculatedBaseline,
            enabled_keys: tmpl.pan_enabled_keys,
            ...(tmpl.pan_overrides ? { overrides: tmpl.pan_overrides } : {}),
          };
        }

        // Common name
        if (selectedFeatures.has('common_names') && tmpl.common_name) {
          updateData.common_name = tmpl.common_name;
        }

        // Category
        if (selectedFeatures.has('categories') && tmpl.category) {
          updateData.category = tmpl.category;
        }

        // Storage location
        if (selectedFeatures.has('storage_locations') && tmpl.storage_location_name) {
          const storageId = targetStorageMap.get(tmpl.storage_location_name.toLowerCase());
          if (storageId) {
            updateData.storage_location_id = storageId;
          }
        }

        if (Object.keys(updateData).length > 0) {
          const { error } = await supabase
            .from("inventory_items")
            .update(updateData)
            .eq("id", match.targetItemId);
          if (error) throw error;
        }

        // Shortcuts (junction table entries)
        if (selectedFeatures.has('shortcuts') && tmpl.shortcut_location_names?.length) {
          for (const scName of tmpl.shortcut_location_names) {
            const scId = targetStorageMap.get(scName.toLowerCase());
            if (scId) {
              await supabase
                .from("inventory_item_locations" as any)
                .upsert({
                  item_id: match.targetItemId,
                  storage_location_id: scId,
                  location_id: targetLocationId,
                } as any, { onConflict: "item_id,storage_location_id" });
            }
          }
        }

        // Usage rates (separate table)
        if (selectedFeatures.has('usage_rates') && tmpl.usage_rate != null && tmpl.product_group_name) {
          const groupId = targetGroupMap.get(tmpl.product_group_name.toLowerCase());
          if (groupId && groupId !== '__pending__') {
            await supabase
              .from("inventory_usage_rates")
              .upsert({
                inventory_item_id: match.targetItemId,
                location_id: targetLocationId,
                product_group_id: groupId,
                usage_rate: tmpl.usage_rate,
                rate_unit: tmpl.usage_rate_unit,
                manual_override: tmpl.usage_rate_manual_override ?? false,
              } as any, { onConflict: "inventory_item_id,product_group_id" });
          }
        }

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

      // Record deployments
      if (deploymentRecords.length > 0) {
        await supabase
          .from("brand_inventory_deployments")
          .upsert(deploymentRecords, { onConflict: "template_id,location_id" });
      }

      return deploymentRecords.length;
    },
    onSuccess: (count) => {
      toast.success(`Deployed ${count} items to location`);
      queryClient.invalidateQueries({ queryKey: ["target-items"] });
      handleOpenChange(false);
    },
    onError: (err: any) => {
      toast.error("Deploy failed: " + err.message);
    },
  });

  const matchedCount = Array.from(selectedTemplateIds).filter(id => matches.get(id)?.targetItemId).length;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Download className="h-4 w-4" />
            {step === 1 ? "Deploy — Select Features" : "Deploy — Review Items"}
          </DialogTitle>
        </DialogHeader>

        {step === 1 && (
          <div className="space-y-4">
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

            {/* Deploy All toggle */}
            <div
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border-2 transition-colors cursor-pointer ${
                isDeployAll ? "border-orange-400 bg-orange-50 dark:bg-orange-950/30" : "border-border"
              }`}
              onClick={toggleDeployAll}
            >
              <Flame className={`h-5 w-5 ${isDeployAll ? "text-orange-500" : "text-muted-foreground"}`} />
              <div className="flex-1">
                <p className="text-sm font-semibold">Deploy Blaze Master</p>
                <p className="text-[10px] text-muted-foreground">Push all features at once</p>
              </div>
              <Switch checked={isDeployAll} onCheckedChange={toggleDeployAll} />
            </div>

            {/* Individual feature toggles */}
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground font-medium mb-1.5">Or select individually:</p>
              {ALL_FEATURES.map(f => {
                const hasData = templates?.some(t => {
                  if (f === 'pan_sizes') return t.pan_units_per_lb != null || t.pan_units_per_unit != null;
                  if (f === 'common_names') return !!t.common_name;
                  if (f === 'categories') return !!t.category;
                  if (f === 'storage_locations') return !!t.storage_location_name;
                  if (f === 'shortcuts') return !!(t.shortcut_location_names?.length);
                  if (f === 'usage_rates') return t.usage_rate != null;
                  if (f === 'product_groups') return !!t.product_group_name;
                  return false;
                });
                const count = templates?.filter(t => {
                  if (f === 'pan_sizes') return t.pan_units_per_lb != null || t.pan_units_per_unit != null;
                  if (f === 'common_names') return !!t.common_name;
                  if (f === 'categories') return !!t.category;
                  if (f === 'storage_locations') return !!t.storage_location_name;
                  if (f === 'shortcuts') return !!(t.shortcut_location_names?.length);
                  if (f === 'usage_rates') return t.usage_rate != null;
                  if (f === 'product_groups') return !!t.product_group_name;
                  return false;
                }).length ?? 0;

                return (
                  <div
                    key={f}
                    className={`flex items-center gap-2.5 px-2.5 py-2 rounded-md border transition-colors cursor-pointer ${
                      selectedFeatures.has(f) ? "border-primary/40 bg-primary/5" : "border-border"
                    } ${!hasData ? "opacity-40" : ""}`}
                    onClick={() => hasData && toggleFeature(f)}
                  >
                    <Checkbox
                      checked={selectedFeatures.has(f)}
                      disabled={!hasData}
                      className="h-3.5 w-3.5"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium">{FEATURE_LABELS[f]}</p>
                      <p className="text-[10px] text-muted-foreground">{FEATURE_DESCRIPTIONS[f]}</p>
                    </div>
                    <Badge variant="secondary" className="text-[9px] px-1.5 py-0 h-4">
                      {count}
                    </Badge>
                  </div>
                );
              })}
            </div>

            <Button
              onClick={() => setStep(2)}
              disabled={!targetLocationId || selectedFeatures.size === 0}
              className="w-full"
            >
              Continue to Review
              <ArrowRight className="h-4 w-4 ml-2" />
            </Button>
          </div>
        )}

        {step === 2 && (
          <>
            <button
              onClick={() => setStep(1)}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors mb-1"
            >
              <ChevronLeft className="h-3 w-3" />
              Back to features
            </button>

            <div className="flex items-center gap-2 flex-wrap mb-1">
              {Array.from(selectedFeatures).map(f => (
                <Badge key={f} variant="secondary" className="text-[9px] px-1.5 py-0 h-4">
                  {FEATURE_LABELS[f]}
                </Badge>
              ))}
            </div>

            {loadingTarget ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : targetItems && templates ? (
              <>
                <div className="flex items-center justify-between py-1">
                  <span className="text-xs text-muted-foreground">
                    {matches.size} of {templates.length} matched
                  </span>
                  {newStorageLocations.length > 0 && (selectedFeatures.has('storage_locations') || selectedFeatures.has('shortcuts')) && (
                    <span className="text-[10px] text-blue-500">
                      +{newStorageLocations.length} new storage loc{newStorageLocations.length !== 1 ? 's' : ''}
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
                    const indicators = getFeatureIndicators(tmpl);

                    if (!match && indicators.length === 0) return null;

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
                            disabled={!match?.targetItemId}
                            className="h-3.5 w-3.5"
                          />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                              <p className="text-xs font-medium truncate">{tmpl.product_name}</p>
                            </div>
                            <div className="flex items-center gap-1 mt-0.5">
                              <ArrowRight className="h-2.5 w-2.5 text-muted-foreground shrink-0" />
                              {targetItem ? (
                                <span className="text-[10px] text-muted-foreground truncate">
                                  {targetItem.name}
                                </span>
                              ) : (
                                <span className="text-[10px] text-muted-foreground italic">No match</span>
                              )}
                            </div>
                            {indicators.length > 0 && (
                              <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                                {indicators.map(ind => (
                                  <Badge key={ind} variant="outline" className="text-[8px] px-1 py-0 h-3">
                                    {ind}
                                  </Badge>
                                ))}
                              </div>
                            )}
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            {match?.calculatedBaseline && selectedFeatures.has('pan_sizes') && (
                              <Badge variant="outline" className="text-[9px] px-1 py-0 h-3.5 font-mono">
                                {match.calculatedBaseline}
                              </Badge>
                            )}
                            {match?.needsReview && <AlertTriangle className="h-3 w-3 text-amber-500" />}
                            {match && (
                              <button onClick={() => clearMatch(tmpl.id)} className="p-0.5">
                                <X className="h-3 w-3 text-muted-foreground" />
                              </button>
                            )}
                          </div>
                        </div>

                        {!match?.targetItemId && (
                          <Select onValueChange={(v) => updateMatch(tmpl.id, v)}>
                            <SelectTrigger className="h-6 text-[10px] mt-1.5">
                              <SelectValue placeholder="Pick item manually..." />
                            </SelectTrigger>
                            <SelectContent>
                              {targetItems.map(i => (
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
            ) : null}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
