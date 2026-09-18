# Before authorizing a Hemet wipe — three answers

All numbers read live just now. Nothing changed.

One note up front: Hemet's active item count read **183** right after the cleanup and reads **203** now. Nothing in the cleanup touched active rows — the nightly activation sweep turned 20 items on in between. Worth knowing that this number moves on its own.

## 1. Would the 9 items come back after a wipe and redeploy?

Every one of the 9 points at a brand template with `status = 'live'`, and each one also has exactly one live template matching it by name. So:

| Item | Linked template live? | Comes back? |
|---|---|---|
| Cauliflower Crust | yes (597098) | **Yes** |
| Coke Bottle 20z | yes (532033) | **Yes** |
| Diet Coke Bottle 20oz | yes (18705) | **Yes** |
| Italian Sausage | yes (454609) | **Yes** |
| Low Fat Chocolate Milk 8oz | yes (682242) | **Yes** |
| Mexican Coke 12oz | yes (249358) | **Yes** |
| Mexican Fanta 12oz | yes (408440) | **Yes** |
| Spicy Red Sauce (Pouch) | yes (1047357) | **Yes** |
| Sprite Bottle 20oz | yes (53034) | **Yes, but with a different vendor number** |

None would be lost. Jordan's read is right — all 9 are already spoken for in the brand catalog. Two caveats:

- **Everything comes back switched OFF.** The redeploy job deliberately creates items inactive; only the nightly activation sweep turns an item on once it finds a real price. So the morning after a wipe, Hemet's count sheet would be empty until that sweep runs and prices things. That is the single biggest operational risk in this whole exercise.
- **Sprite Bottle 20oz would come back as 53034, not 584315.** Today the redeploy leaves an existing local number alone; a fresh row gets the brand number. So a wipe silently resolves that mismatch in the brand's favour — fine if the brand number is right, wrong if Hemet's is.
- Shelf positions, `pa_item_id`, and PFG numbers all get re-derived from the brand mappings, not from Hemet's current rows.

**One extra thing to be aware of:** the redeploy job copies its shelf layout **from Hemet** by default for every other store. Hemet is the reference shelf layout. Wiping Hemet's items wipes the item-to-shelf mapping other stores' deploys read from.

## 2. Shortcuts — you are counting products, not lines

**Mechanism.** A shortcut is *not* a second item. One `inventory_items` row per product; extra physical locations live in `inventory_item_locations` (item + storage location, plus its own display order and optional pan/pack overrides). The count screen builds one entry per item-plus-location pair from that junction table. `brand_inventory_templates.shortcut_location_names` is the brand-level instruction that tells a deploy which extra locations to create in that junction table.

**So your item counts are clean.** Shortcuts add zero rows to `inventory_items`. "Hemet has 531 rows / 203 active" counts products. Your comparison table is not inflated.

Shortcut lines per store — only three stores use them at all:

| Store | Junction rows | Items with a shortcut | Extra count lines it creates |
|---|---|---|---|
| Hemet | 47 | 45 | 47 |
| Palm Springs | 51 | 45 | 51 |
| Rowlett | 7 | 7 | 7 |
| Palm Desert, South Meadows, Tuscaloosa, Sparks | 0 | 0 | 0 |

**Count history does split per location.** Hemet's 3,587 count lines cover 2,934 distinct item-and-session pairs — so 653 of those lines are second/third location lines for an item already counted elsewhere in the same session. 3,078 of the 3,587 carry a storage location.

**Double-counting value:** the design is right — each line holds only the quantity physically found in that one spot, and valuation sums lines, so a shortcut adds up rather than duplicating. There is even a `quantity_rollup_blocked` guard field, and it is `false` on all 3,587 Hemet lines. I checked the count session and history screens and the period/COGS panels; I did not audit every downstream report line by line, so I'd call this "no evidence of double-counting" rather than "proven everywhere."

## 3. The wipe — and why I recommend not deleting

### Detaching count history is not viable

`inventory_count_items.item_id` **is** nullable, so a detach is technically possible. But the screens don't read snapshots first — the count history view pulls name, unit, pack size, item number, shelf and recipe fields through a live join to `inventory_items`. Null the link and those rows render nameless.

The snapshot coverage on Hemet's 3,587 lines is partial:

| Snapshot field | Rows filled |
|---|---|
| item name | 1,881 of 3,587 |
| cost | 3,338 |
| unit | 3,263 |
| pack quantity | 3,571 |

So 1,706 lines have no name of their own, and 249 have no cost. Detaching loses the name on roughly half of Hemet's history and the cost on 249 lines — permanently. **Recommendation: don't detach.**

### What a hard delete of Hemet's items would take with it

| Table | Behaviour | Hemet rows affected |
|---|---|---|
| `inventory_count_items` | **cascade — deleted** | **3,587** |
| `inventory_item_locations` (shortcuts) | cascade | 47 |
| `inventory_recipe_ingredients` (as recipe) | cascade | 653 |
| `inventory_recipe_ingredients` (as ingredient) | **restrict — blocks the delete** | 653 |
| `inventory_transfer_items` | **blocks the delete** | 1 |
| `vendor_invoice_items` | blocks (none present) | 0 |
| `brand_inventory_deployments` | cascade | 236 |
| `inventory_waste_logs` | cascade | 3 |
| `daily_spot_count_items` | cascade | 14 |
| `inventory_usage_rates` | cascade | 0 |
| `recipe_integrity_alerts`, `sandbox_item_flags` | cascade | 0 |
| `checklist_prep_completions` | link cleared | **1,060** |
| `checklist_prep_rows` | link cleared | 34 |
| `brand_inventory_templates.source_item_id` | link cleared | **126** |
| `recipe_blueprints.produces_item_id` | link cleared | 6 |
| `inventory_items.linked_item_id` | link cleared | 0 |
| `brand_auto_deployment_log` | link cleared | 0 |

Two things stand out beyond the count history: **1,060 prep-task completions** lose their item link, and **126 brand templates** lose the pointer back to the Hemet row they were originally built from.

### What I recommend instead: archive in place, then redeploy

Same end state on screen, no history loss, and reversible:

1. **Keep every row.** Set `is_active = false` and `user_hidden = true` on Hemet rows that are not linked to a live brand template. `user_hidden` is already the app's hard "never show this" filter, so these vanish from the items list, Start Count, spot checks and the unit matrix.
2. **Redeploy from the 219 live brand templates.** The job already re-uses any row that carries a matching `brand_item_id` — it refreshes name, category, shelf, pack and vendor numbers instead of creating a duplicate — and creates rows only for templates Hemet is missing.
3. **Let the activation sweep price and switch on** what it can, as it does every night.
4. If a hidden row turns out to still be needed, un-hide it. Nothing is gone.

The only thing this doesn't do is shrink the table. If a genuinely small table matters, the safe subset to hard-delete is the same rule we just used: no count history, no other references. Everything with count history stays.

### What Hemet should look like afterwards

- **219 brand-linked items** — one per live brand template (53 archived and 4 draft templates don't deploy).
- Plus whatever hidden legacy rows you choose to keep for history (224 R365 rows today, of which 9 are live items that the redeploy re-adopts).
- **Shortcuts add nothing to that number** — Hemet's 47 shortcut lines live in the junction table.
- Active count immediately after redeploy: **near zero until the activation sweep runs**, then back toward the ~200 range as prices resolve.

## Straight answers

1. All 9 come back — every one links to a live brand template. Sprite Bottle 20oz comes back with the brand's vendor number instead of Hemet's.
2. Shortcuts are extra count lines, not extra items. Your per-store item counts are correct as products. Only Hemet (47), Palm Springs (51) and Rowlett (7) have any.
3. A hard wipe destroys 3,587 count lines and unlinks 1,060 prep completions; detaching them first loses the name on 1,706 lines. **Archiving in place and redeploying gets the same clean list with none of that**, and I'd do that instead.
