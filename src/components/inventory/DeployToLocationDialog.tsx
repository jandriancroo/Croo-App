/**
 * DeployToLocationDialog — two-step wizard to deploy brand master templates to a target location.
 * Step 1: Pick target location + select which features to deploy
 * Step 2: Review matched items + deploy
 *
 * Three-tier matching:
 *   Tier 1: Vendor code match (PFG item_number or PA pa_item_id)
 *   Tier 2: Exact product name match (recipes, manual items)
 *   Tier 3: No match → auto-create in "Unassigned" with needs_review flag
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
import { Loader2, Download, AlertTriangle, ArrowRight, X, Flame, ChevronLeft, Plus, FlaskConical, Trash2 } from "lucide-react";
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
  // Legacy single-rate (backward compat)
  usage_rate: number | null;
  usage_rate_unit: string | null;
  usage_rate_manual_override: boolean | null;
  product_group_name: string | null;
  product_group_pos_categories: string[] | null;
  product_group_pos_items: string[] | null;
  // NEW: multi-group mappings
  usage_rate_mappings: Array<{
    group_name: string | null;
    pos_categories: string[] | null;
    pos_items: string[] | null;
    usage_rate: number;
    rate_unit: string | null;
    manual_override: boolean;
  }>;
  pan_overrides: any;
  is_recipe: boolean;
  recipe_yield_qty: number | null;
  recipe_yield_unit: string | null;
  recipe_ingredients: any[];
  vendor_source: string | null;
  item_number: string | null;
  pa_item_id: string | null;
  source_item_id: string | null;
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
  pa_item_id: string | null;
  is_recipe: boolean;
}

type MatchTier = 1 | 2 | 3;

interface MatchResult {
  templateId: string;
  targetItemId: string | null;
  calculatedBaseline: number | null;
  weightPerUnit: number | null;
  needsReview: boolean;
  reviewReason: string | null;
  autoMatched: boolean;
  matchTier: MatchTier;
  autoCreate: boolean;
}

type DeployFeature = 'pan_sizes' | 'common_names' | 'categories' | 'storage_locations' | 'shortcuts' | 'product_groups' | 'recipes';

const FEATURE_LABELS: Record<DeployFeature, string> = {
  pan_sizes: "Pan Sizes",
  common_names: "Common Names",
  categories: "Categories",
  storage_locations: "Storage Locations",
  shortcuts: "Shortcuts",
  product_groups: "POS Mapping",
  recipes: "Recipes",
};

const FEATURE_DESCRIPTIONS: Record<DeployFeature, string> = {
  pan_sizes: "Pan size configurations & volume conversions",
  common_names: "Friendly display names for items",
  categories: "Item categories (Produce, Dairy, etc.)",
  storage_locations: "Where items are stored (auto-creates missing)",
  shortcuts: "All shortcuts placed in a 'Shortcuts (Review)' location for you to sort or delete",
  product_groups: "POS category & menu item mappings",
  recipes: "Recipe definitions with ingredients & yields",
};

const DEFAULT_FEATURES: DeployFeature[] = ['pan_sizes', 'common_names', 'categories', 'storage_locations', 'product_groups', 'recipes'];
const ALL_FEATURES: DeployFeature[] = ['pan_sizes', 'common_names', 'categories', 'storage_locations', 'shortcuts', 'product_groups', 'recipes'];

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

/**
 * Three-tier matching:
 * Tier 1: Vendor code match (item_number for PFG, pa_item_id for PA)
 * Tier 2: Exact product name match
 * Tier 3: No match (will auto-create)
 */
function findBestMatch(template: Template, items: TargetItem[], usedIds: Set<string>): { item: TargetItem | null; tier: MatchTier } {
  // Tier 1: Vendor code match
  if (template.item_number) {
    const vendorMatch = items.find(i =>
      !usedIds.has(i.id) &&
      i.item_number &&
      i.item_number.trim().toLowerCase() === template.item_number!.trim().toLowerCase()
    );
    if (vendorMatch) return { item: vendorMatch, tier: 1 };
  }
  if (template.pa_item_id) {
    const paMatch = items.find(i =>
      !usedIds.has(i.id) &&
      i.pa_item_id &&
      i.pa_item_id.trim().toLowerCase() === template.pa_item_id!.trim().toLowerCase()
    );
    if (paMatch) return { item: paMatch, tier: 1 };
  }

  // Tier 2: Exact product name match
  // Guard: Don't match a recipe template against a vendor-coded item (PFG/PA product)
  const nameMatch = items.find(i =>
    !usedIds.has(i.id) &&
    !(template.is_recipe && (i.item_number || i.pa_item_id)) && // vendor items can't become recipes
    (
      (i.common_name || i.name).toLowerCase() === template.product_name.toLowerCase() ||
      i.name.toLowerCase() === template.product_name.toLowerCase()
    )
  );
  if (nameMatch) return { item: nameMatch, tier: 2 };

  // Tier 3: No match
  return { item: null, tier: 3 };
}

export default function DeployToLocationDialog({ open, onOpenChange, brandId, sourceLocationId }: DeployToLocationDialogProps) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [step, setStep] = useState<1 | 2>(1);
  const [targetLocationId, setTargetLocationId] = useState<string>("");
  const [selectedFeatures, setSelectedFeatures] = useState<Set<DeployFeature>>(new Set(DEFAULT_FEATURES));
  const [matches, setMatches] = useState<Map<string, MatchResult>>(new Map());
  const [selectedTemplateIds, setSelectedTemplateIds] = useState<Set<string>>(new Set());
  const [cleanSlate, setCleanSlate] = useState(false);

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

  const handleOpenChange = (o: boolean) => {
    if (!o) {
      setStep(1);
      setTargetLocationId("");
      setSelectedFeatures(new Set(DEFAULT_FEATURES));
      setMatches(new Map());
      setSelectedTemplateIds(new Set());
      setCleanSlate(false);
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
      return (data || []).map((t: any) => ({
        ...t,
        is_recipe: t.is_recipe || false,
        recipe_yield_qty: t.recipe_yield_qty || null,
        recipe_yield_unit: t.recipe_yield_unit || null,
        recipe_ingredients: t.recipe_ingredients || [],
        vendor_source: t.vendor_source || null,
        item_number: t.item_number || null,
        pa_item_id: t.pa_item_id || null,
        usage_rate_mappings: t.usage_rate_mappings || [],
      })) as Template[];
    },
    enabled: open,
  });

  // Fetch target location items when on step 2
  const { data: targetItems, isLoading: loadingTarget } = useQuery({
    queryKey: ["target-items", targetLocationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory_items")
        .select("id, name, common_name, pack_size, pack_quantity, pan_sizes, vendor_source, item_number, pa_item_id, is_recipe")
        .eq("location_id", targetLocationId)
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return (data || []).map((i: any) => ({ ...i, pa_item_id: i.pa_item_id || null, is_recipe: i.is_recipe || false })) as TargetItem[];
    },
    enabled: step === 2 && !!targetLocationId,
  });

  // Auto-match when target items load — 3-tier matching
  useMemo(() => {
    if (!templates || !targetItems || step !== 2) return;

    const newMatches = new Map<string, MatchResult>();
    const usedTargetIds = new Set<string>();

    // Filter templates to only those that have data for selected features
    const relevantTemplates = templates.filter(tmpl => {
      if (selectedFeatures.has('pan_sizes') && (tmpl.pan_units_per_lb != null || tmpl.pan_units_per_unit != null)) return true;
      if (selectedFeatures.has('common_names') && tmpl.common_name) return true;
      if (selectedFeatures.has('categories') && tmpl.category) return true;
      if (selectedFeatures.has('storage_locations') && tmpl.storage_location_name) return true;
      if (selectedFeatures.has('shortcuts') && tmpl.shortcut_location_names?.length) return true;
      
      if (selectedFeatures.has('product_groups') && (tmpl.usage_rate_mappings?.some(m => m.group_name) || tmpl.product_group_name)) return true;
      if (selectedFeatures.has('recipes') && tmpl.is_recipe) return true;
      return false;
    });

    for (const tmpl of relevantTemplates) {
      const { item: bestItem, tier } = findBestMatch(tmpl, targetItems, usedTargetIds);

      if (bestItem) {
        usedTargetIds.add(bestItem.id);
      }

      const packQty = bestItem?.pack_quantity || 1;
      const targetWeight = bestItem ? parsePerUnitWeight(bestItem.pack_size) : null;

      let calculatedBaseline: number | null = null;
      let needsReview = tier === 3;
      let reviewReason: string | null = tier === 3 ? "Will be auto-created at target" : null;

      if (bestItem && selectedFeatures.has('pan_sizes')) {
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
        targetItemId: bestItem?.id || null,
        calculatedBaseline,
        weightPerUnit: targetWeight,
        needsReview,
        reviewReason,
        autoMatched: true,
        matchTier: tier,
        autoCreate: tier === 3,
      });
    }

    setMatches(newMatches);
    // Auto-select all matched items (Tier 1 & 2) + auto-create items (Tier 3)
    setSelectedTemplateIds(new Set(
      Array.from(newMatches.entries())
        .filter(([_, m]) => m.targetItemId || m.autoCreate)
        .filter(([_, m]) => !selectedFeatures.has('pan_sizes') || m.autoCreate || (m.calculatedBaseline && !m.needsReview))
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
      next.set(templateId, { templateId, targetItemId, calculatedBaseline, weightPerUnit: targetWeight, needsReview, reviewReason, autoMatched: false, matchTier: 2, autoCreate: false });
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

  const getFeatureIndicators = (tmpl: Template) => {
    const indicators: string[] = [];
    if (selectedFeatures.has('pan_sizes') && (tmpl.pan_units_per_lb != null || tmpl.pan_units_per_unit != null)) indicators.push("Pan");
    if (selectedFeatures.has('common_names') && tmpl.common_name) indicators.push("Name");
    if (selectedFeatures.has('categories') && tmpl.category) indicators.push("Cat");
    if (selectedFeatures.has('storage_locations') && tmpl.storage_location_name) indicators.push("Stor");
    if (selectedFeatures.has('shortcuts') && tmpl.shortcut_location_names?.length) indicators.push(`${tmpl.shortcut_location_names.length} SC`);
    const mappings = tmpl.usage_rate_mappings || [];
    if (selectedFeatures.has('product_groups') && mappings.some(m => m.group_name)) indicators.push("Grp");
    if (selectedFeatures.has('recipes') && tmpl.is_recipe) indicators.push("Recipe");
    return indicators;
  };

  // Count new storage locations
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

  // Summary counts
  const tier1Count = Array.from(matches.values()).filter(m => m.matchTier === 1 && selectedTemplateIds.has(m.templateId)).length;
  const tier2Count = Array.from(matches.values()).filter(m => m.matchTier === 2 && selectedTemplateIds.has(m.templateId)).length;
  const tier3Count = Array.from(matches.values()).filter(m => m.matchTier === 3 && selectedTemplateIds.has(m.templateId)).length;
  const recipeCount = templates?.filter(t => t.is_recipe && selectedTemplateIds.has(t.id)).length || 0;

  const deployMutation = useMutation({
    mutationFn: async () => {
      if (!templates || !user) throw new Error("Missing data");

      // Step 0: Clean Slate — wipe target location's recipes, usage rates, groups, shortcuts
      if (cleanSlate) {
        // Delete all shortcuts at target location
        const { data: targetItemIds } = await supabase
          .from("inventory_items")
          .select("id")
          .eq("location_id", targetLocationId);
        if (targetItemIds?.length) {
          for (let i = 0; i < targetItemIds.length; i += 50) {
            const chunk = targetItemIds.slice(i, i + 50).map(r => r.id);
            await supabase.from("inventory_item_locations").delete().in("item_id", chunk);
          }
        }

        // Get all recipe item IDs at target
        const { data: targetRecipes } = await supabase
          .from("inventory_items")
          .select("id")
          .eq("location_id", targetLocationId)
          .eq("is_recipe", true)
          .eq("is_active", true);
        const recipeIds = (targetRecipes || []).map(r => r.id);

        // Delete recipe ingredients
        if (recipeIds.length > 0) {
          await supabase.from("inventory_recipe_ingredients").delete().in("recipe_item_id", recipeIds);
        }

        // Reset recipe flags on items
        if (recipeIds.length > 0) {
          await supabase.from("inventory_items").update({
            is_recipe: false, recipe_yield_qty: null, recipe_yield_unit: null, cost_per_unit: null
          } as any).in("id", recipeIds);
        }

        // Delete product groups (usage rates removed — recipes are source of truth)
        await supabase.from("inventory_product_groups").delete().eq("location_id", targetLocationId);

        // Ensure "Unassigned" storage location exists
        const { data: existingLocs } = await supabase
          .from("inventory_locations")
          .select("id, name")
          .eq("location_id", targetLocationId);
        let unassignedId = existingLocs?.find(l => l.name.toLowerCase() === 'unassigned')?.id;
        if (!unassignedId) {
          const { data: newLoc } = await supabase
            .from("inventory_locations")
            .insert({ location_id: targetLocationId, name: 'Unassigned', display_order: (existingLocs?.length || 0) })
            .select("id")
            .single();
          unassignedId = newLoc?.id;
        }

        // Move non-master items to Unassigned
        if (unassignedId) {
          const masterNames = new Set(templates.map(t => t.product_name.toLowerCase()));
          const masterItemNumbers = new Set(templates.filter(t => t.item_number).map(t => t.item_number!.toLowerCase()));
          const masterPaIds = new Set(templates.filter(t => t.pa_item_id).map(t => t.pa_item_id!.toLowerCase()));

          const { data: allTargetItems } = await supabase
            .from("inventory_items")
            .select("id, name, item_number, pa_item_id")
            .eq("location_id", targetLocationId)
            .eq("is_active", true);

          const nonMasterIds = (allTargetItems || [])
            .filter(i => {
              // Check if item matches any master template
              if (i.item_number && masterItemNumbers.has(i.item_number.toLowerCase())) return false;
              if (i.pa_item_id && masterPaIds.has(i.pa_item_id.toLowerCase())) return false;
              if (masterNames.has(i.name.toLowerCase())) return false;
              return true;
            })
            .map(i => i.id);

          if (nonMasterIds.length > 0) {
            // Batch update in chunks of 50
            for (let i = 0; i < nonMasterIds.length; i += 50) {
              const chunk = nonMasterIds.slice(i, i + 50);
              await supabase.from("inventory_items")
                .update({ storage_location_id: unassignedId })
                .in("id", chunk);
            }
          }
        }
      }

      // Step 1: Auto-create missing storage locations
      const needsStorageCreation = (selectedFeatures.has('storage_locations') || selectedFeatures.has('shortcuts')) && newStorageLocations.length > 0;
      if (needsStorageCreation) {
        const { data: existingLocs } = await supabase
          .from("inventory_locations")
          .select("name")
          .eq("location_id", targetLocationId);
        const existingNames = new Set((existingLocs || []).map(l => l.name.toLowerCase()));
        
        // Always ensure "Unassigned" exists for Tier 3 items
        const allNames = [...newStorageLocations, 'Unassigned'];
        const locsToCreate = allNames
          .filter(n => !existingNames.has(n.toLowerCase()))
          .filter((v, i, a) => a.findIndex(x => x.toLowerCase() === v.toLowerCase()) === i) // dedupe
          .map((name, i) => ({
            location_id: targetLocationId,
            name,
            display_order: (existingLocs?.length || 0) + i,
          }));
        if (locsToCreate.length > 0) {
          await supabase.from("inventory_locations").insert(locsToCreate);
        }
      }

      // Ensure "Unassigned" exists for Tier 3 auto-creates even if no storage feature selected
      if (tier3Count > 0) {
        const { data: existingLocs } = await supabase
          .from("inventory_locations")
          .select("name")
          .eq("location_id", targetLocationId);
        const existingNames = new Set((existingLocs || []).map(l => l.name.toLowerCase()));
        if (!existingNames.has('unassigned')) {
          await supabase.from("inventory_locations").insert({
            location_id: targetLocationId,
            name: 'Unassigned',
            display_order: (existingLocs?.length || 0),
          });
        }
      }

      // Fetch storage locations at target for ID resolution
      const { data: targetStorageLocs } = await supabase
        .from("inventory_locations")
        .select("id, name")
        .eq("location_id", targetLocationId);
      const targetStorageMap = new Map((targetStorageLocs || []).map(l => [l.name.toLowerCase(), l.id]));

      // Create/find product groups at target (collect from ALL usage_rate_mappings)
      let targetGroupMap = new Map<string, string>();
      if (selectedFeatures.has('product_groups')) {
        const { data: existingGroups } = await supabase
          .from("inventory_product_groups")
          .select("id, name")
          .eq("location_id", targetLocationId);
        targetGroupMap = new Map((existingGroups || []).map(g => [g.name.toLowerCase(), g.id]));

        // Collect all unique group names from usage_rate_mappings
        const groupsToCreate: { name: string; pos_categories: string[] | null; pos_items: string[] | null }[] = [];
        const seenGroupNames = new Set<string>();
        for (const tid of selectedTemplateIds) {
          const tmpl = templates.find(t => t.id === tid);
          if (!tmpl) continue;
          const mappings = tmpl.usage_rate_mappings || [];
          // Fallback to legacy single group
          const allGroups = mappings.length > 0
            ? mappings.filter(m => m.group_name).map(m => ({ name: m.group_name!, pos_categories: m.pos_categories, pos_items: m.pos_items }))
            : (tmpl.product_group_name ? [{ name: tmpl.product_group_name, pos_categories: tmpl.product_group_pos_categories, pos_items: tmpl.product_group_pos_items }] : []);
          
          for (const g of allGroups) {
            const key = g.name.toLowerCase();
            if (!targetGroupMap.has(key) && !seenGroupNames.has(key)) {
              groupsToCreate.push(g);
              seenGroupNames.add(key);
              targetGroupMap.set(key, '__pending__');
            }
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
      // Track auto-created item IDs for recipe ingredient resolution
      const autoCreatedItemMap = new Map<string, string>(); // template product_name → new item id

      for (const templateId of selectedTemplateIds) {
        const match = matches.get(templateId);
        const tmpl = templates.find(t => t.id === templateId);
        if (!tmpl) continue;

        let targetItemId = match?.targetItemId || null;

        // Tier 3: Auto-create item at target location
        if (match?.autoCreate && !targetItemId) {
          const unassignedId = targetStorageMap.get('unassigned') || null;
          const { data: newItem, error: createErr } = await supabase
            .from("inventory_items")
            .insert({
              location_id: targetLocationId,
              name: tmpl.product_name,
              common_name: tmpl.common_name,
              category: tmpl.category,
              storage_location_id: unassignedId,
              is_active: true,
              is_recipe: tmpl.is_recipe,
              recipe_yield_qty: tmpl.recipe_yield_qty,
              recipe_yield_unit: tmpl.recipe_yield_unit,
              vendor_source: tmpl.vendor_source as any,
            } as any)
            .select("id")
            .single();

          if (createErr) {
            console.error('Failed to auto-create item:', tmpl.product_name, createErr);
            continue;
          }
          targetItemId = newItem.id;
          autoCreatedItemMap.set(tmpl.product_name.toLowerCase(), targetItemId);
        }

        if (!targetItemId) continue;

        const updateData: any = {};

        // Pan sizes
        if (selectedFeatures.has('pan_sizes') && match?.calculatedBaseline && (tmpl.pan_units_per_lb != null || tmpl.pan_units_per_unit != null)) {
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
          await supabase.from("inventory_items").update(updateData).eq("id", targetItemId);
        }

        // Shortcuts — dump all into a single "Shortcuts (Review)" location
        if (selectedFeatures.has('shortcuts') && tmpl.shortcut_location_names?.length) {
          if (!targetStorageMap.has('shortcuts (review)')) {
            // Create the review location once
            const { data: newLoc } = await supabase
              .from("inventory_locations")
              .insert({ location_id: targetLocationId, name: 'Shortcuts (Review)', display_order: 999 })
              .select("id")
              .single();
            if (newLoc) {
              targetStorageMap.set('shortcuts (review)', newLoc.id);
            }
          }
          const reviewLocId = targetStorageMap.get('shortcuts (review)');
          if (reviewLocId) {
            await supabase
              .from("inventory_item_locations" as any)
              .upsert({
                item_id: targetItemId,
                storage_location_id: reviewLocId,
              } as any, { onConflict: "item_id,storage_location_id" });
          }
        }

        // Usage rates removed — recipes are now the single source of truth for consumption

        deploymentRecords.push({
          template_id: tmpl.id,
          inventory_item_id: targetItemId,
          location_id: targetLocationId,
          weight_per_unit: match?.weightPerUnit,
          calculated_baseline: match?.calculatedBaseline,
          needs_review: match?.autoCreate || match?.needsReview || false,
          review_reason: match?.autoCreate ? 'Auto-created (no match at target)' : match?.reviewReason,
          deployed_by: user.id,
        });
      }

      // Step 4: Deploy recipe ingredients
      if (selectedFeatures.has('recipes')) {
        // Fetch ALL target items (including newly created) for ingredient matching
        const { data: allTargetItems } = await supabase
          .from("inventory_items")
          .select("id, name, common_name, item_number, pa_item_id, vendor_source, is_recipe")
          .eq("location_id", targetLocationId)
          .eq("is_active", true);

        const targetItemsList = allTargetItems || [];

        for (const templateId of selectedTemplateIds) {
          const tmpl = templates.find(t => t.id === templateId);
          if (!tmpl?.is_recipe || !tmpl.recipe_ingredients?.length) continue;

          const recipeMatch = matches.get(templateId);
          const recipeTargetId = recipeMatch?.targetItemId ||
            autoCreatedItemMap.get(tmpl.product_name.toLowerCase());
          if (!recipeTargetId) continue;

          // Clear existing recipe ingredients at target
          await supabase
            .from("inventory_recipe_ingredients")
            .delete()
            .eq("recipe_item_id", recipeTargetId);

          // Match each ingredient to target items
          const ingredientInserts: any[] = [];
          for (const ing of tmpl.recipe_ingredients) {
            let ingredientItemId: string | null = null;

            // Tier 1: vendor code match
            if (ing.ingredient_item_number) {
              const match = targetItemsList.find(i =>
                i.item_number?.trim().toLowerCase() === ing.ingredient_item_number.trim().toLowerCase()
              );
              if (match) ingredientItemId = match.id;
            }
            if (!ingredientItemId && ing.ingredient_pa_item_id) {
              const match = targetItemsList.find(i =>
                i.pa_item_id?.trim().toLowerCase() === ing.ingredient_pa_item_id.trim().toLowerCase()
              );
              if (match) ingredientItemId = match.id;
            }

            // Tier 2: name match
            if (!ingredientItemId && ing.ingredient_name) {
              const match = targetItemsList.find(i =>
                (i.common_name || i.name).toLowerCase() === ing.ingredient_name.toLowerCase() ||
                i.name.toLowerCase() === ing.ingredient_name.toLowerCase()
              );
              if (match) ingredientItemId = match.id;
            }

            // Tier 3: auto-create the ingredient
            if (!ingredientItemId) {
              const unassignedId = targetStorageMap.get('unassigned') || null;
              const { data: newIng } = await supabase
                .from("inventory_items")
                .insert({
                  location_id: targetLocationId,
                  name: ing.ingredient_name || 'Unknown Ingredient',
                  storage_location_id: unassignedId,
                  is_active: true,
                  vendor_source: ing.ingredient_vendor_source as any,
                } as any)
                .select("id")
                .single();
              if (newIng) ingredientItemId = newIng.id;
            }

            if (ingredientItemId) {
              ingredientInserts.push({
                recipe_item_id: recipeTargetId,
                ingredient_item_id: ingredientItemId,
                quantity: ing.quantity,
                unit: ing.unit,
              });
            }
          }

          if (ingredientInserts.length > 0) {
            await supabase.from("inventory_recipe_ingredients").insert(ingredientInserts);
          }
        }

        // Step 4b: Copy recipe costs from source items to target recipes
        const sourceItemIds = [...selectedTemplateIds]
          .map(tid => templates.find(t => t.id === tid))
          .filter(t => t?.is_recipe && t?.source_item_id)
          .map(t => t!.source_item_id!);

        if (sourceItemIds.length > 0) {
          const { data: sourceItems } = await supabase
            .from("inventory_items")
            .select("id, cost_per_unit")
            .in("id", sourceItemIds);

          const sourceCostMap = new Map<string, number>();
          for (const si of sourceItems || []) {
            if (si.cost_per_unit != null) sourceCostMap.set(si.id, si.cost_per_unit);
          }

          for (const templateId of selectedTemplateIds) {
            const tmpl = templates.find(t => t.id === templateId);
            if (!tmpl?.is_recipe || !tmpl.source_item_id) continue;
            const sourceCost = sourceCostMap.get(tmpl.source_item_id);
            if (sourceCost == null) continue;

            const recipeMatch = matches.get(templateId);
            const recipeTargetId = recipeMatch?.targetItemId ||
              autoCreatedItemMap.get(tmpl.product_name.toLowerCase());
            if (!recipeTargetId) continue;

            await supabase
              .from("inventory_items")
              .update({ cost_per_unit: sourceCost })
              .eq("id", recipeTargetId);
          }
        }
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

  const matchedCount = Array.from(selectedTemplateIds).filter(id => {
    const m = matches.get(id);
    return m?.targetItemId || m?.autoCreate;
  }).length;

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

            {/* Clean Slate Option */}
            <div
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border-2 transition-colors cursor-pointer ${
                cleanSlate ? "border-destructive/60 bg-destructive/5" : "border-border"
              }`}
              onClick={() => {
                const next = !cleanSlate;
                setCleanSlate(next);
                if (next) {
                  setSelectedFeatures(prev => { const s = new Set(prev); s.delete('shortcuts'); return s; });
                }
              }}
            >
              <Trash2 className={`h-4 w-4 ${cleanSlate ? "text-destructive" : "text-muted-foreground"}`} />
              <div className="flex-1">
                <p className="text-xs font-semibold">Clean Slate</p>
                <p className="text-[10px] text-muted-foreground">
                  Wipe recipes, usage rates & groups first. Non-master items → Unassigned.
                </p>
              </div>
              <Switch checked={cleanSlate} onCheckedChange={setCleanSlate} />
            </div>

            <div className="space-y-1">
              <p className="text-xs text-muted-foreground font-medium mb-1.5">Or select individually:</p>
              {ALL_FEATURES.map(f => {
                const hasData = templates?.some(t => {
                  if (f === 'pan_sizes') return t.pan_units_per_lb != null || t.pan_units_per_unit != null;
                  if (f === 'common_names') return !!t.common_name;
                  if (f === 'categories') return !!t.category;
                  if (f === 'storage_locations') return !!t.storage_location_name;
                  if (f === 'shortcuts') return !!(t.shortcut_location_names?.length);
                  if (f === 'product_groups') return !!t.product_group_name;
                  if (f === 'recipes') return t.is_recipe;
                  return false;
                });
                const count = templates?.filter(t => {
                  if (f === 'pan_sizes') return t.pan_units_per_lb != null || t.pan_units_per_unit != null;
                  if (f === 'common_names') return !!t.common_name;
                  if (f === 'categories') return !!t.category;
                  if (f === 'storage_locations') return !!t.storage_location_name;
                  if (f === 'shortcuts') return !!(t.shortcut_location_names?.length);
                  
                  if (f === 'product_groups') return !!t.product_group_name;
                  if (f === 'recipes') return t.is_recipe;
                  return false;
                }).length ?? 0;

                return (
                  <div
                    key={f}
                    className={`flex items-center gap-2.5 px-2.5 py-2 rounded-md border transition-colors cursor-pointer ${
                      selectedFeatures.has(f) ? "border-primary/40 bg-primary/5" : "border-border"
                    } ${!hasData || (cleanSlate && f === 'shortcuts') ? "opacity-40" : ""}`}
                    onClick={() => hasData && !(cleanSlate && f === 'shortcuts') && toggleFeature(f)}
                  >
                    <Checkbox
                      checked={selectedFeatures.has(f)}
                      disabled={!hasData || (cleanSlate && f === 'shortcuts')}
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
                {/* Match summary */}
                <div className="flex items-center gap-3 py-1.5 flex-wrap">
                  {tier1Count > 0 && (
                    <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-medium">
                      ✅ {tier1Count} vendor match
                    </span>
                  )}
                  {tier2Count > 0 && (
                    <span className="text-[10px] text-blue-600 dark:text-blue-400 font-medium">
                      📝 {tier2Count} name match
                    </span>
                  )}
                  {tier3Count > 0 && (
                    <span className="text-[10px] text-amber-600 dark:text-amber-400 font-medium">
                      🆕 {tier3Count} auto-create
                    </span>
                  )}
                  {recipeCount > 0 && selectedFeatures.has('recipes') && (
                    <span className="text-[10px] text-purple-600 dark:text-purple-400 font-medium">
                      <FlaskConical className="h-2.5 w-2.5 inline mr-0.5" />
                      {recipeCount} recipes
                    </span>
                  )}
                </div>

                {newStorageLocations.length > 0 && (selectedFeatures.has('storage_locations') || selectedFeatures.has('shortcuts')) && (
                  <span className="text-[10px] text-blue-500 block mb-1">
                    +{newStorageLocations.length} new storage loc{newStorageLocations.length !== 1 ? 's' : ''}
                  </span>
                )}

                <div className="flex-1 overflow-y-auto space-y-1.5 min-h-0">
                  {templates.map(tmpl => {
                    const match = matches.get(tmpl.id);
                    const targetItem = match?.targetItemId
                      ? targetItems.find(i => i.id === match.targetItemId)
                      : null;
                    const isSelected = selectedTemplateIds.has(tmpl.id);
                    const indicators = getFeatureIndicators(tmpl);

                    if (!match && indicators.length === 0) return null;

                    const tierBadge = match?.matchTier === 1 ? "Vendor" : match?.matchTier === 2 ? "Name" : match?.autoCreate ? "New" : null;
                    const tierColor = match?.matchTier === 1 ? "text-emerald-600" : match?.matchTier === 2 ? "text-blue-600" : "text-amber-600";

                    return (
                      <div
                        key={tmpl.id}
                        className={`px-2.5 py-2 rounded-md border transition-colors ${
                          match?.autoCreate
                            ? "border-amber-300/60 bg-amber-50/30 dark:bg-amber-950/20"
                            : match?.needsReview
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
                            className="h-3.5 w-3.5"
                          />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                              <p className="text-xs font-medium truncate">{tmpl.product_name}</p>
                              {tmpl.is_recipe && <FlaskConical className="h-2.5 w-2.5 text-purple-500 shrink-0" />}
                              {tierBadge && (
                                <span className={`text-[8px] font-semibold ${tierColor}`}>
                                  {tierBadge}
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-1 mt-0.5">
                              <ArrowRight className="h-2.5 w-2.5 text-muted-foreground shrink-0" />
                              {targetItem ? (
                                <span className="text-[10px] text-muted-foreground truncate">
                                  {targetItem.name}
                                </span>
                              ) : match?.autoCreate ? (
                                <span className="text-[10px] text-amber-600 italic flex items-center gap-0.5">
                                  <Plus className="h-2 w-2" /> Auto-create in Unassigned
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
                            {match?.needsReview && !match.autoCreate && <AlertTriangle className="h-3 w-3 text-amber-500" />}
                            {match && !match.autoCreate && (
                              <button onClick={() => clearMatch(tmpl.id)} className="p-0.5">
                                <X className="h-3 w-3 text-muted-foreground" />
                              </button>
                            )}
                          </div>
                        </div>

                        {!match?.targetItemId && !match?.autoCreate && (
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

                        {match?.needsReview && match.reviewReason && !match.autoCreate && (
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
                  {tier3Count > 0 && ` (${tier3Count} new)`}
                </Button>
              </>
            ) : null}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
