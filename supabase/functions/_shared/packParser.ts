// Shared pack-string parser — single source of truth for PFG/PA pack parsing.
//
// USED BY:
//   - pack-config-seeder     (proposes brand_pack_configs from vendor sources)
//   - pack-selection-backfill (resolves location_pack_selections in Phase 2)
//
// DO NOT duplicate this logic in another edge function. If a new vendor pack
// format appears, fix it HERE so both call sites benefit. The whole point of
// extracting this module is to prevent parser drift.

export interface ParsedPack {
  outer_qty: number;
  inner_qty: number;
  inner_type: string;
  common_unit: string;
}

export function parsePackString(packString: string | null | undefined): ParsedPack | null {
  if (!packString) return null;
  const trimmed = packString.trim();

  // Format: "4 / 1 GA" or "1/4 LB" or "6/5LB" or "12/1 RL"
  const slashMatch = trimmed.match(/^\s*(\d+)\s*\/\s*(\d+(?:\.\d+)?)\s*([A-Za-z]+)\s*$/);
  if (slashMatch) {
    const outer_qty = parseInt(slashMatch[1], 10);
    const inner_qty = parseFloat(slashMatch[2]);
    const rawUnit = slashMatch[3].toLowerCase();
    if (!Number.isFinite(outer_qty) || !Number.isFinite(inner_qty) || outer_qty <= 0 || inner_qty <= 0) return null;
    const { inner_type, common_unit } = normalizeUnit(rawUnit);
    return { outer_qty, inner_qty, inner_type, common_unit };
  }

  // Format: "3 CT" or "2.5 KG" (no slash — single pack, outer=1)
  const noSlashMatch = trimmed.match(/^\s*(\d+(?:\.\d+)?)\s*([A-Za-z]+)\s*$/);
  if (noSlashMatch) {
    const inner_qty = parseFloat(noSlashMatch[1]);
    const rawUnit = noSlashMatch[2].toLowerCase();
    if (!Number.isFinite(inner_qty) || inner_qty <= 0) return null;
    const { inner_type, common_unit } = normalizeUnit(rawUnit);
    return { outer_qty: 1, inner_qty, inner_type, common_unit };
  }

  return null;
}

export function normalizeUnit(raw: string): { inner_type: string; common_unit: string } {
  switch (raw) {
    case 'lb': case 'lbs': return { inner_type: 'lb', common_unit: 'lb' };
    case 'oz': case 'ozs': return { inner_type: 'oz', common_unit: 'oz' };
    case 'ga': case 'gal': case 'gallon': case 'gallons': return { inner_type: 'ga', common_unit: 'ga' };
    case 'kg': case 'kgs': return { inner_type: 'kg', common_unit: 'kg' };
    case 'g': case 'gs': return { inner_type: 'g', common_unit: 'g' };
    case 'ml': return { inner_type: 'ml', common_unit: 'ml' };
    case 'l': case 'liter': case 'liters': return { inner_type: 'l', common_unit: 'l' };
    case 'ct': case 'ea': case 'each': case 'cn': case 'count': case 'rl': return { inner_type: 'ea', common_unit: 'ea' };
    default: return { inner_type: raw, common_unit: raw };
  }
}
