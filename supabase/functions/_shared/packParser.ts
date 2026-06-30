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

// Industry-standard #N can sizes in fluid ounces — mirrored from
// src/utils/unitConversion.ts HASH_CAN_OZ. Keep in sync.
const HASH_CAN_OZ: Record<string, number> = {
  "1": 11, "2": 20, "2.5": 29, "3": 33, "5": 56, "10": 104,
};

// Numeric token: supports "5", "5.5", and leading-decimal forms like ".8" or ".1"
// (Peroxide ".8 GA", Sugar Packets ".1 OZ" patterns).
const NUM = String.raw`(?:\d*\.\d+|\d+(?:\.\d+)?)`;

export function parsePackString(packString: string | null | undefined): ParsedPack | null {
  if (!packString) return null;
  // Strip surrounding whitespace AND trailing periods so PA catalog shapes like
  // "lb.", "qt.", "48 ct." normalize to "lb", "qt", "48 ct" before parsing.
  const trimmed = packString.trim().replace(/\.+$/, '').trim();
  if (!trimmed) return null;

  // Format: "6/#10 CN" or "4/#5 CN" — PFG #N-can prefix
  // Outer count / #N can-size, optionally followed by a unit token (CN, CAN, EA).
  // The inner_qty is the industry-standard fluid-oz of that can, inner_type=oz.
  const hashCanMatch = trimmed.match(
    new RegExp(`^\\s*(\\d+)\\s*/\\s*#(${NUM})(?:\\s*[A-Za-z]+)?\\s*$`)
  );
  if (hashCanMatch) {
    const outer_qty = parseInt(hashCanMatch[1], 10);
    const sizeKey = hashCanMatch[2];
    const oz = HASH_CAN_OZ[sizeKey];
    if (Number.isFinite(outer_qty) && outer_qty > 0 && oz) {
      return { outer_qty, inner_qty: oz, inner_type: 'oz', common_unit: 'oz' };
    }
    return null;
  }

  // Format: "4 / 1 GA" or "1/4 LB" or "6/5LB" or "12/1 RL" or ".8 / 1 GA"
  const slashMatch = trimmed.match(
    new RegExp(`^\\s*(${NUM})\\s*/\\s*(${NUM})\\s*([A-Za-z]+)\\s*$`)
  );
  if (slashMatch) {
    const outer_qty = parseFloat(slashMatch[1]);
    const inner_qty = parseFloat(slashMatch[2]);
    const rawUnit = slashMatch[3].toLowerCase();
    if (!Number.isFinite(outer_qty) || !Number.isFinite(inner_qty) || outer_qty <= 0 || inner_qty <= 0) return null;
    const { inner_type, common_unit } = normalizeUnit(rawUnit);
    // outer_qty stays numeric; downstream multiplies it as-is.
    return { outer_qty, inner_qty, inner_type, common_unit };
  }

  // Format: "3 CT", "2.5 KG", ".8 GA", ".1 OZ" (no slash — single pack, outer=1)
  const noSlashMatch = trimmed.match(
    new RegExp(`^\\s*(${NUM})\\s*([A-Za-z]+)\\s*$`)
  );
  if (noSlashMatch) {
    const inner_qty = parseFloat(noSlashMatch[1]);
    const rawUnit = noSlashMatch[2].toLowerCase();
    if (!Number.isFinite(inner_qty) || inner_qty <= 0) return null;
    const { inner_type, common_unit } = normalizeUnit(rawUnit);
    return { outer_qty: 1, inner_qty, inner_type, common_unit };
  }

  // Format: "lb", "qt", "ga", "ea" (unit-only — implicit 1×1 UNIT).
  // PA catalog ships these for loose/bulk items sold by the unit.
  const unitOnlyMatch = trimmed.match(/^[A-Za-z]+$/);
  if (unitOnlyMatch) {
    const { inner_type, common_unit } = normalizeUnit(trimmed.toLowerCase());
    return { outer_qty: 1, inner_qty: 1, inner_type, common_unit };
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
    case 'l': case 'lt': case 'ltr': case 'liter': case 'liters': case 'litre': case 'litres': return { inner_type: 'l', common_unit: 'l' };
    case 'ct': case 'ea': case 'each': case 'cn': case 'count': case 'rl': return { inner_type: 'ea', common_unit: 'ea' };
    default: return { inner_type: raw, common_unit: raw };
  }
}
