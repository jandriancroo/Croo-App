// Pizza count from item-level product mix: quantity of items whose category or
// name says "pizza"; half pizzas ("1/2" or "half" in the name) count 0.5.
export interface MixItem { itemName: string; category?: string; quantity: number; netSales?: number }

export function pizzaCountFromMix(items: MixItem[]): number {
  let n = 0;
  for (const it of items || []) {
    const name = String(it?.itemName ?? "");
    if (!/pizza/i.test(String(it?.category ?? "")) && !/pizza/i.test(name)) continue;
    const q = Number(it?.quantity) || 0;
    n += /1\/2|half/i.test(name) ? q * 0.5 : q;
  }
  return Math.round(n);
}
