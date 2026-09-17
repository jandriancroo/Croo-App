# Pack config unit vocabulary — where the drift comes from and how I'd fix it

Investigation only, nothing changed.

## 1. Where the bad vocabulary comes from

**The parser, not the approval screen.** Every single odd row is stamped with a vendor-sync source:

| unit | rows (approved) | source | created |
| --- | --- | --- | --- |
| `ga` | 8 | vendor_sync:pfg | Jun 3 |
| `ga` | 6 | vendor_sync:pfg:pfg_bid | Jun 9–23 |
| `ga` | 1 | vendor_sync:pfg:pfg_order | Jun 30 |
| `gal` | 22 | vendor_sync:pfg | May 22 – Jun 3 |
| `gal` | 2 | vendor_sync:pfg:pfg_bid | Jun 23–30 |
| `case` | 1 | vendor_sync:pa:pa_order | Jun 23 |

The shared parser (`supabase/functions/_shared/packParser.ts`, `normalizeUnit`) maps `ga`/`gal`/`gallon` → **`ga`**. So PFG's "2/1 GA" becomes `ga` today and will keep becoming `ga` on every nightly seed. The 24 `gal` rows are the fossil — an earlier parser version emitted `gal` before the mapping changed. The conversion table (`src/utils/unitConversion.ts`) only knows `gal`. The two halves of the system were never agreed on which spelling wins.

So: normalizing the 15 rows today fixes nothing durable. They come back.

**`case` is a different problem.** That row's pack string was literally `"1/1 case"` — the unit-only branch of the parser passes unknown tokens straight through. It isn't a bad spelling of a real unit; it means *the vendor never told us the pack shape* and we invented a config anyway. Two more `case` rows are sitting in the proposed queue right now.

## 2. Full blast radius — everything that doesn't convert

Checked all three unit columns against what the conversion table actually supports.

**Approved (live) rows:**
- `common_unit`: `ga` (15), `case` (1). Everything else converts — ea, lb, oz, gal, qt, ml, g, kg, l, rl, cn.
- `inner_type`: `ga` (19), empty/blank (7), `sleeve` (4), `bag` (4), `jug` (1), `case` (1). `OZ` (1) is fine — the reader lowercases.
- `outer_type`: this column is a packaging noun, not a measure, so nothing here breaks math. It does have casing drift (`Bottle`, `JUG`, `jugs`, `rolls`, `Roll`) which is cosmetic only.

**Proposed queue:** `case` (2) — will get approved into the live set unless stopped.

**Archived (no longer read):** `ga` (40), `case` (11), `gm` (5). Worth knowing `gm` exists because the parser will emit it again if PFG ships a "200/3.5GM" pack — `gm` is not in the conversion table either.

So the honest total is bigger than 16: **16 live rows on `common_unit`, 36 live rows across `inner_type`**, and two families of failure (misspelling vs. not-a-unit). No hidden 40 beyond that — the columns are otherwise clean.

## 3. What actually breaks today (honestly: less than it looks)

- **Recipe cost / food cost:** mostly safe. The recipe engines read `item_conversions.canonical_unit` (values there are clean: oz, ea, lb, gal, ft) or `inventory_items.count_unit` (also clean — oz, ea, lb, gal, qt). The bad `ga` never propagated into either, because the propagation trigger only copies `count_unit`, not `common_unit`.
- **Count screen value on prepped/recipe items:** this is the real exposure. The count screen resolves the item's unit from the approved pack config, and for a prepped item it converts counted quantity into batch-yield units. When the unit doesn't convert, the code falls back to "each counted unit = one whole batch" (`countItemValue.ts` line 213) — so it doesn't show zero, it shows a **silently inflated** value. That's the worst kind of failure.
- **Regular (non-recipe) count value:** unaffected. It's quantity × case cost ÷ pack quantity, no unit conversion involved.
- **Variance / theoretical usage:** inherits whatever the count value said, so it drifts wherever the above drifts.
- **Labels on the count screen:** `sleeve`/`bag`/`jug` sitting in `inner_type` display fine but are semantically wrong (that column is meant to hold a measure).

Net: no store is being mis-costed on food cost today; the risk is wrong dollars on prepped-item counts and future recipes that ask for oz of a gallon item.

## 4. My recommendation

**(b) + (a) + a guard, and treat `case` separately. Not (c) alone.**

1. **Fix the parser first (b).** One canonical spelling, chosen to match the conversion table: `gal`, `g`, `l`, `oz`, `lb`, `kg`, `ml`, `ea`. Make `packParser.normalizeUnit` and `unitConversion.normalizeUnit` agree, ideally by having the parser reuse the same vocabulary list instead of keeping its own switch. Without this, everything else is temporary.
2. **Then normalize the existing rows (a)** — the 16 live `common_unit` rows and 36 `inner_type` rows, `ga`→`gal`, `gm`→`g`. Archived rows can be left or swept in the same pass; they aren't read.
3. **Add the aliases anyway (c), as a seatbelt** — teach the conversion table `ga` and `gm`. Cheap, and it means the next unknown vendor spelling degrades to correct math instead of inflated math. But it is a seatbelt, not the fix; alone it leaves two spellings of gallon in the data forever and the next new unit still breaks.
4. **Reject, don't alias, `case` and the packaging nouns.** A pack string the parser can't turn into a real measure should not produce a proposal at all — it should land in the queue flagged "pack shape unknown, needs a human" (or not be proposed). Same for `sleeve`/`bag`/`jug` landing in `inner_type`: those belong in `outer_type`. Aliasing `case` to anything would bake a guess into costing.
5. **Add a standing check** so this can't silently return: a small validation that every unit written to `brand_pack_configs` is in the supported vocabulary, either as a parser assertion or as part of the nightly health surface, plus a test on the parser's unit mapping.

One thing I'd flag as a real judgment call for you: step 4 will make the seeder propose *fewer* configs, and some items will sit without a pack shape until someone supplies one. That's the correct trade — a missing config is visible, a wrong one isn't — but it does mean a little more manual work on the approval screen.

Say which of these you want and I'll write the build plan.
