/**
 * Salad Reconciliation Engine
 * ===========================
 * Resolves QU POS data where salad VARIETY (Caesar, BLT Cobb, etc.) is reported
 * separately from salad SIZE (Side vs Entree) via a 4-step reconciliation:
 *
 * Step 1: Named parents (e.g., "Entree Caesar Salad") → deplete 1:1 (ground truth)
 * Step 2: Subtract named parent counts from matching Salad Mod totals
 * Step 3: Build variety PMIX from remaining mod counts
 * Step 4: Apply PMIX to generic parents (e.g., "Simple Salad - Side") for CORE distribution
 *
 * See: /mnt/documents/Salad_Reconciliation_Engine_Reference.docx
 */

interface PosMapping {
  id: string;
  name: string;
  blueprint_id: string | null;
  pos_categories: string[] | null;
  pos_items: string[] | null;
  mapping_type: string;
  reconciliation_group: string | null;
}

interface SalesMixItem {
  category: string;
  itemName: string;
  quantity: number;
}

interface ReconciliationResult {
  /** blueprint_id → total units to deplete */
  depletions: Map<string, number>;
  /** POS item names consumed by reconciliation (so they aren't double-counted) */
  consumedPosItems: Set<string>;
  /** Debug info */
  debug: {
    namedParentSales: Array<{ posItem: string; blueprintId: string; qty: number }>;
    modSubtractions: Array<{ mod: string; original: number; subtracted: number; remaining: number }>;
    pmix: Array<{ variety: string; pct: number }>;
    genericAllocations: Array<{ genericParent: string; variety: string; qty: number; blueprintId: string }>;
  };
}

/**
 * Run the 4-step salad reconciliation for a single reconciliation group.
 *
 * @param mappings     - All POS mappings for this location
 * @param dailyMix     - Raw product_mix data from sales_cache
 * @param groupName    - The reconciliation_group to process (e.g., "salads")
 */
export function reconcileSaladGroup(
  mappings: PosMapping[],
  dailyMix: SalesMixItem[][],
  groupName: string,
): ReconciliationResult {
  const result: ReconciliationResult = {
    depletions: new Map(),
    consumedPosItems: new Set(),
    debug: {
      namedParentSales: [],
      modSubtractions: [],
      pmix: [],
      genericAllocations: [],
    },
  };

  // Filter mappings to this reconciliation group
  const groupMappings = mappings.filter(m => m.reconciliation_group === groupName);
  if (groupMappings.length === 0) return result;

  const namedParents = groupMappings.filter(m => m.mapping_type === "named_parent" && m.blueprint_id);
  const genericParents = groupMappings.filter(m => m.mapping_type === "generic_parent" && m.blueprint_id);
  const varietyMods = groupMappings.filter(m => m.mapping_type === "variety_mod" && m.blueprint_id);

  // Aggregate all POS item quantities across the period
  const allPosQty = new Map<string, number>();
  for (const day of dailyMix) {
    for (const item of day) {
      if (!item.itemName) continue;
      allPosQty.set(item.itemName, (allPosQty.get(item.itemName) || 0) + item.quantity);
    }
  }

  // ──────────────────────────────────────────────
  // STEP 1: Deplete named parents directly
  // ──────────────────────────────────────────────
  // Named parents have both size + variety known (e.g., "Entree Caesar Salad" → MI: Entree Caesar)
  // Each named parent mapping has pos_items pointing to the QU parent item name(s)
  const namedParentByVariety = new Map<string, { blueprintId: string; totalSold: number }>();

  for (const np of namedParents) {
    const posItems = np.pos_items || [];
    let sold = 0;
    for (const posName of posItems) {
      const qty = allPosQty.get(posName) || 0;
      if (qty > 0) {
        sold += qty;
        result.consumedPosItems.add(posName);
      }
    }
    if (sold > 0 && np.blueprint_id) {
      addDepletion(result.depletions, np.blueprint_id, sold);
      result.debug.namedParentSales.push({
        posItem: posItems.join(", "),
        blueprintId: np.blueprint_id,
        qty: sold,
      });

      // Track by mapping name for subtraction in Step 2
      // The mapping name should match or relate to the variety mod name
      namedParentByVariety.set(np.name, { blueprintId: np.blueprint_id, totalSold: sold });
    }
  }

  // ──────────────────────────────────────────────
  // STEP 2: Subtract named parent counts from variety mods
  // ──────────────────────────────────────────────
  // Variety mods (e.g., "Classic Caesar" with 64 total) include BOTH the named entree
  // sales AND the generic sales. We subtract the named entree counts to isolate generics.
  const modRemaining = new Map<string, { mappingId: string; blueprintId: string; remaining: number }>();

  for (const vm of varietyMods) {
    const posItems = vm.pos_items || [];
    let totalModQty = 0;
    for (const posName of posItems) {
      totalModQty += allPosQty.get(posName) || 0;
      result.consumedPosItems.add(posName);
    }

    // Find matching named parent to subtract
    // Convention: variety mod name should relate to named parent name
    // e.g., variety mod "Classic Caesar" ↔ named parent "Entree Caesar" or "Caesar"
    let subtracted = 0;
    const npEntries = Array.from(namedParentByVariety.entries());
    for (const [npName, npData] of npEntries) {
      if (isVarietyMatch(vm.name, npName)) {
        subtracted += npData.totalSold;
      }
    }

    const remaining = Math.max(0, totalModQty - subtracted);

    result.debug.modSubtractions.push({
      mod: vm.name,
      original: totalModQty,
      subtracted,
      remaining,
    });

    if (remaining > 0 && vm.blueprint_id) {
      modRemaining.set(vm.name, {
        mappingId: vm.id,
        blueprintId: vm.blueprint_id,
        remaining,
      });
    }
  }

  // ──────────────────────────────────────────────
  // STEP 3: Build variety PMIX from remaining mod counts
  // ──────────────────────────────────────────────
  const modEntries = Array.from(modRemaining.values());
  const totalRemaining = modEntries.reduce((sum, m) => sum + m.remaining, 0);
  const pmix = new Map<string, { pct: number; blueprintId: string }>();

  if (totalRemaining > 0) {
    for (const [name, data] of Array.from(modRemaining.entries())) {
      const pct = data.remaining / totalRemaining;
      pmix.set(name, { pct, blueprintId: data.blueprintId });
      result.debug.pmix.push({ variety: name, pct: Math.round(pct * 1000) / 10 });
    }
  }

  // ──────────────────────────────────────────────
  // STEP 4: Apply PMIX to generic parents
  // ──────────────────────────────────────────────
  // Generic parents (e.g., "Simple Salad - Side") know SIZE but not VARIETY.
  // We use the PMIX to distribute their sales across variety blueprints.
  // The generic parent's own blueprint (BASE) is also depleted for each sale.
  for (const gp of genericParents) {
    const posItems = gp.pos_items || [];
    let genericSold = 0;
    for (const posName of posItems) {
      const qty = allPosQty.get(posName) || 0;
      if (qty > 0) {
        genericSold += qty;
        result.consumedPosItems.add(posName);
      }
    }

    if (genericSold <= 0) continue;

    // Deplete the generic parent's own blueprint (BASE — packaging, greens, etc.)
    if (gp.blueprint_id) {
      addDepletion(result.depletions, gp.blueprint_id, genericSold);
    }

    // Distribute across variety blueprints using PMIX
    // Each variety mod's blueprint_id points to the MI that contains the CORE sub-recipe
    // The MI's CORE multiplier (1× for side, 2× for entree) is already baked into the MI blueprint
    if (pmix.size > 0) {
      for (const [variety, pmixEntry] of Array.from(pmix.entries())) {
        const allocatedQty = genericSold * pmixEntry.pct;
        if (allocatedQty > 0) {
          addDepletion(result.depletions, pmixEntry.blueprintId, allocatedQty);
          result.debug.genericAllocations.push({
            genericParent: gp.name,
            variety,
            qty: Math.round(allocatedQty * 100) / 100,
            blueprintId: pmixEntry.blueprintId,
          });
        }
      }
    }
  }

  return result;
}

/**
 * Check if a variety mod name matches a named parent name.
 * Uses keyword extraction to handle naming variations.
 * e.g., "Classic Caesar" matches "Entree Caesar" or "Entree Caesar Salad"
 */
function isVarietyMatch(modName: string, parentName: string): boolean {
  const modWords = extractKeywords(modName);
  const parentWords = extractKeywords(parentName);

  // At least one significant keyword must match
  return modWords.some(w => parentWords.includes(w));
}

/**
 * Extract meaningful keywords from a POS item name,
 * filtering out generic terms like "entree", "side", "salad", "simple", "byo"
 */
function extractKeywords(name: string): string[] {
  const stopWords = new Set([
    "entree", "side", "salad", "salads", "simple", "byo", "build",
    "your", "own", "classic", "with", "w/", "-", "–",
  ]);
  return name
    .toLowerCase()
    .split(/[\s\-–]+/)
    .filter(w => w.length > 1 && !stopWords.has(w));
}

function addDepletion(map: Map<string, number>, blueprintId: string, qty: number) {
  map.set(blueprintId, (map.get(blueprintId) || 0) + qty);
}

/**
 * Get all distinct reconciliation groups from the mappings for a location.
 */
export function getReconciliationGroups(mappings: PosMapping[]): string[] {
  const groups = new Set<string>();
  for (const m of mappings) {
    if (m.reconciliation_group) groups.add(m.reconciliation_group);
  }
  return Array.from(groups);
}
