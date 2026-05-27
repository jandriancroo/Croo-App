# Brand × POS × Feature Coverage Matrix

Single source of truth for **which CrooHQ features work for which brand**, based on the POS that brand runs on. Keep these files up to date whenever a POS sync, feature, or data-cube dependency changes.

## Brands

| Brand | POS | Spec |
|---|---|---|
| Blaze Pizza | QU Beyond (V4 REST + webhooks) | [blaze-pizza.md](./blaze-pizza.md) |
| Playa Bowls | Clover (V3 REST, polling) | [playa-bowls.md](./playa-bowls.md) |
| Buffalo Wild Wings GO | _TBD_ | [bww-go.md](./bww-go.md) |

## How to read these specs

Every brand file follows the same 6 sections:

1. **POS Integration** — auth, endpoints, sync cadence, rate limits, known quirks
2. **Sales Cache Coverage** — which columns in `sales_cache` are populated
3. **Data Cubes & Widgets Supported** — what renders on the dashboard today
4. **Labor Source** — `qubeyond` / `punch_clock` / `clover` / none
5. **Inventory & Recipes** — PFG, brand catalog, depletion mapping status
6. **Known Gaps & Roadmap** — what's not wired yet + next steps

When you add a new POS, copy `_template.md`, fill it in, and link it from this table.
