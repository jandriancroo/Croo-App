// Heimark Distributing reading profile.
//
// Heimark prints a narrow thermal receipt:
//   ITEM# | QTY | DESCRIPTION | PRICE | DISC | CRV/DEP | AMOUNT
// plus a footer (Total CRV Units, CRV$, Cases, Gals, Content$, Deposit$,
// Discount$, Invoice Total).
//
// Rules (Jordan, Oct 6 2026):
//   - PRICE, DISC, CRV/DEP are per case; QTY is always cases.
//   - AMOUNT = QTY × (PRICE − DISC + CRV).
//   - The pack is inside DESCRIPTION. The model only copies text; the pack is
//     worked out HERE in code. CRV ÷ 0.05 = units per case decides the form.
//   - Cost per case = AMOUNT ÷ QTY (paid, after discount, with CRV).
//   - Every self-check must pass or the invoice is "needs review" and nothing
//     (no prices, no gaps, no lines) is saved. Never save a guessed line.

export const HEIMARK_PROFILE = "heimark";

export interface HeimarkRawLine {
  item_number?: string;
  quantity?: number;
  description?: string;
  price?: number;
  discount?: number;
  crv_deposit?: number;
  amount?: number;
}

export interface HeimarkRawInvoice {
  vendor_name?: string;
  invoice_number?: string;
  invoice_date?: string;
  delivery_date?: string;
  lines: HeimarkRawLine[];
  footer?: {
    total_crv_units?: number;
    total_crv_dollars?: number;
    cases?: number;
    gallons?: number;
    content_dollars?: number;
    deposit_dollars?: number;
    discount_dollars?: number;
    invoice_total?: number;
  };
}

export interface HeimarkPack {
  units_per_case: number | null;
  oz_per_unit: number | null;
  inner_layout: string | null; // e.g. "2/12", "6/4", "LOOSE"
  container: "can" | null;
  pack_size: string | null;
  problem: string | null;
}

export interface HeimarkLine {
  item_number: string;
  quantity: number;
  raw_description: string;
  list_price: number;
  discount: number;
  deposit: number;
  amount: number;
  cost_per_case: number | null;
  pack: HeimarkPack;
}

export type CheckResult = { name: string; ok: boolean; expected: number | null; got: number | null; note?: string };

export interface HeimarkReading {
  lines: HeimarkLine[];
  checks: CheckResult[];
  ok: boolean;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : Number(String(v ?? "").replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : null;
};

/** Work out the pack from the printed description and the CRV per case. */
export function readHeimarkPack(description: string, crvPerCase: number | null): HeimarkPack {
  const desc = String(description || "").toUpperCase();
  const units = crvPerCase != null && crvPerCase > 0 ? Math.round(crvPerCase / 0.05) : null;
  const container = /\d\s*CN\b|CN\b|\bCAN|CAL\b|CA(?=L?NR)/.test(desc) ? "can" : null;
  const loose = /\bLOOSE\b/.test(desc);
  const pairs = [...desc.matchAll(/(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/g)].map((m) => [Number(m[1]), Number(m[2])]);
  const empty = (problem: string): HeimarkPack => ({
    units_per_case: units, oz_per_unit: null, inner_layout: null, container, pack_size: null, problem,
  });
  if (units == null) return empty("no CRV on the line, so units per case can't be checked");
  if (pairs.length === 0) return empty("no pack printed in the description");

  const [a, b] = pairs[0];
  // Form 1: units/size (24/16, 24/12, 24/11.2, 24/500ML), optional inner layout or LOOSE.
  if (a === units) {
    const isMl = new RegExp(`${a}\\s*/\\s*${String(b).replace(".", "\\.")}\\s*ML\\b`).test(desc);
    const oz = isMl ? Math.round((b / 29.5735) * 100) / 100 : b;
    let inner: string | null = loose ? "LOOSE" : null;
    const second = pairs[1];
    if (second) {
      if (second[0] * second[1] !== units) return empty(`inner layout ${second[0]}/${second[1]} doesn't make ${units}`);
      inner = `${second[0]}/${second[1]}`;
    }
    return {
      units_per_case: units, oz_per_unit: oz, inner_layout: inner, container,
      pack_size: `${units}/${isMl ? `${b} ML` : `${oz} OZ`}${inner ? ` ${inner}` : ""}`, problem: null,
    };
  }
  // Form 2: layout only (6/4CN, 2/12NR, 4/6): packs × units per pack = units.
  if (a * b === units) {
    // Ounces only when printed after the layout, e.g. "STELLA 4/6 NR 11.2Z".
    const ozMatch = desc.slice(desc.indexOf(`${a}/${b}`) + `${a}/${b}`.length).match(/(\d+(?:\.\d+)?)\s*O?Z\b/);
    return {
      units_per_case: units, oz_per_unit: ozMatch ? Number(ozMatch[1]) : null, inner_layout: `${a}/${b}`, container,
      pack_size: `${a}/${b}`, problem: null,
    };
  }
  return empty(`pack ${a}/${b} doesn't agree with CRV (${units} units)`);
}

/** Turn the model's copied text into checked lines. Pure; no database. */
export function interpretHeimark(raw: HeimarkRawInvoice): HeimarkReading {
  const lines: HeimarkLine[] = [];
  const checks: CheckResult[] = [];
  const footer = raw.footer || {};

  const skipped: string[] = [];
  for (const l of raw.lines || []) {
    // Not a delivered product: a note line (e.g. MISPICK) or a zero-quantity
    // line with nothing charged. Listed, never saved, never priced.
    const zeroMoney = !(num(l.price) ?? 0) && !(num(l.amount) ?? 0) && !(num(l.crv_deposit) ?? 0);
    const notDelivered = !(num(l.quantity) ?? 0) && !(num(l.amount) ?? 0);
    const badNumber = !/^\d+$/.test(String(l.item_number ?? "").trim());
    if ((zeroMoney && badNumber) || notDelivered) {
      skipped.push(`${l.item_number ?? "?"} ${l.description ?? ""} (qty ${l.quantity ?? 0}, not charged)`.trim());
      continue;
    }
    const qty = num(l.quantity) ?? 0;
    const price = num(l.price) ?? 0;
    const disc = num(l.discount) ?? 0;
    const crv = num(l.crv_deposit) ?? 0;
    const amount = num(l.amount) ?? 0;
    const pack = readHeimarkPack(String(l.description || ""), crv);
    lines.push({
      item_number: String(l.item_number ?? "").trim(),
      quantity: qty,
      raw_description: String(l.description ?? "").trim(),
      list_price: price,
      discount: disc,
      deposit: crv,
      amount,
      cost_per_case: qty > 0 ? round2(amount / qty) : null,
      pack,
    });
    const expect = round2(qty * (price - disc + crv));
    checks.push({
      name: `line ${l.item_number ?? "?"}: qty × (price − disc + CRV) = amount`,
      ok: qty > 0 && Math.abs(expect - amount) <= 0.011,
      expected: expect, got: amount,
    });
    checks.push({
      name: `line ${l.item_number ?? "?"}: pack readable`,
      ok: pack.problem == null && !!String(l.item_number ?? "").trim(),
      expected: null, got: pack.units_per_case, note: pack.problem ?? undefined,
    });
  }

  const sum = (f: (l: HeimarkLine) => number) => round2(lines.reduce((s, l) => s + f(l), 0));
  const footerCheck = (name: string, printed: unknown, got: number, tol = 0.011) => {
    const p = num(printed);
    checks.push({
      name, expected: p, got,
      ok: p != null && Math.abs(p - got) <= tol,
      note: p == null ? "not read from the footer" : undefined,
    });
  };
  footerCheck("Σ amount = invoice total", footer.invoice_total, sum((l) => l.amount));
  footerCheck("Σ qty = cases", footer.cases, sum((l) => l.quantity));
  footerCheck("Σ qty × units = total CRV units", footer.total_crv_units, sum((l) => l.quantity * (l.pack.units_per_case ?? 0)));
  footerCheck("Σ qty × price = content $", footer.content_dollars, sum((l) => l.quantity * l.list_price));
  footerCheck("Σ qty × disc = discount $", footer.discount_dollars, sum((l) => l.quantity * l.discount));
  footerCheck("Σ qty × CRV = deposit $", footer.deposit_dollars, sum((l) => l.quantity * l.deposit));

  // Gallons only when every line's ounces are known.
  const allOz = lines.length > 0 && lines.every((l) => l.pack.oz_per_unit != null && l.pack.units_per_case != null);
  if (allOz) {
    const gals = round2(lines.reduce((s, l) => s + l.quantity * (l.pack.units_per_case ?? 0) * (l.pack.oz_per_unit ?? 0), 0) / 128);
    footerCheck("Σ oz ÷ 128 ≈ gallons", footer.gallons, gals, 0.15);
  } else {
    checks.push({ name: "Σ oz ÷ 128 ≈ gallons", ok: true, expected: num(footer.gallons), got: null, note: "skipped: some lines don't print ounces" });
  }

  if (skipped.length) checks.push({ name: "lines left out (not charged)", ok: true, expected: null, got: skipped.length, note: skipped.join("; ") });
  if (lines.length === 0) checks.push({ name: "at least one line", ok: false, expected: null, got: 0 });
  return { lines, checks, ok: checks.every((c) => c.ok) };
}

