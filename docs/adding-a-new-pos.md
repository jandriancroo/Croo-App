# Adding a New POS — 5-Step Spec

_Last updated: May 28, 2026_

This is the recipe for plugging a new POS (Toast, Square, future webhook stream, etc.) into CrooHQ. Follow it as-is; if you find yourself improvising, update this doc instead of forking the pattern.

See [`pos-modularization.md`](./pos-modularization.md) for the why. This doc is the how.

## The Contract

Every POS writes normalized rows into `public.sales_cache`, tagged with `pos_source`. Per-POS raw payloads land in a dedicated archive table and are **dual-written** alongside the normalized row. Downstream readers (dashboards, pacing, AvT, labor variance) never branch on POS — they read `sales_cache` and trust the shape.

```
   Raw payload ──►  <pos>_sales_cache  (archive, full fidelity)
                         │
                         ▼ normalize
                    sales_cache  (pos_source = '<pos>')
                         │
                         ▼
                 dashboards · pacing · AvT · labor
```

## The 5 Steps

### 1. Register the `pos_source` value

`pos_source` is a free-text column on `sales_cache` (default `'qubeyond'`). Pick a stable lowercase slug — `toast`, `square`, `clover`. Use it consistently across the archive table, the edge function, and any UI filters.

No enum migration needed — the column is TEXT. Just don't typo it.

### 2. Create the per-POS raw archive table

Mirror the `clover_sales_cache` pattern: store the raw payload (JSONB), the location, the business date, and whatever native IDs the POS gives you. This table is the source of truth for re-normalization if the contract ever changes.

```sql
CREATE TABLE public.<pos>_sales_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id UUID NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
  sale_date DATE NOT NULL,
  raw_payload JSONB NOT NULL,
  external_event_id TEXT,  -- if the POS provides one
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.<pos>_sales_cache TO authenticated;
GRANT ALL ON public.<pos>_sales_cache TO service_role;
ALTER TABLE public.<pos>_sales_cache ENABLE ROW LEVEL SECURITY;
-- Policies: scope to location membership (see existing clover_sales_cache for reference)
```

Index on `(location_id, sale_date)` and, if applicable, a unique index on `(location_id, external_event_id)` to dedup at the raw layer too.

### 3. Build the edge function

One function per POS. Two flavors:

**Pull-based** (QU, Clover today):
- Fetch a day's worth of data from the POS API
- Insert raw → `<pos>_sales_cache`
- Normalize → upsert into `sales_cache` on conflict `(location_id, sale_date)`
- Always set `pos_source = '<pos>'`
- Leave `external_event_id` NULL

**Webhook-based** (future):
- Verify signature, parse event
- Insert raw → `<pos>_sales_cache` (with `external_event_id` if available)
- Normalize → upsert into `sales_cache` on conflict `(location_id, pos_source, external_event_id)`
- Always set `pos_source` and `external_event_id`

Reuse the merge pattern from `sales-service` / `fetch-qubeyond-sales`: spread existing `projected`, `labor`, `payments_data` keys conditionally so a partial update never wipes a sibling field. See the **Data Integrity (Sales Cache)** core rule.

### 4. Webhook idempotency — stamp `external_event_id`

If the integration is webhook-based, `external_event_id` is non-optional. The partial unique index `uq_sales_cache_pos_event` on `(location_id, pos_source, external_event_id) WHERE external_event_id IS NOT NULL` is what blocks duplicate event ingestion when the POS retries.

Rules:
- Stamp it on **every** webhook-originated row
- Use the upsert conflict target `(location_id, pos_source, external_event_id)` for webhook writes
- If a specific event type from the POS does **not** carry a stable ID (some Clover order-modification events, for example), document it explicitly as **best-effort, not dedup-protected** in this file. Do not invent a synthetic ID — that defeats the index.

Pull and webhook write paths keep different conflict targets. This is intentional. Don't try to unify them.

### 5. Register in `location_integrations`

Add a row per enabled location so the rest of the app knows the POS is wired up. Use the existing patterns from QU and Clover for credential storage (global env vars preferred; per-location only when the POS truly requires it — see the **QU Auth Architecture** memory for the lesson learned).

UI surfacing (Vendor Gap Finder, Sales Summary, etc.) reads `location_integrations` to decide what to show. Once the row is there, the integration is live.

## Checklist before shipping

- [ ] `pos_source` slug agreed and used consistently
- [ ] `<pos>_sales_cache` raw archive table created with RLS + GRANTs
- [ ] Edge function deployed; pull or webhook flavor chosen
- [ ] Normalized rows land in `sales_cache` with `pos_source` set
- [ ] Webhook writes stamp `external_event_id` and use the partial-unique upsert target
- [ ] Pull writes keep `(location_id, sale_date)` upsert target
- [ ] Conditional-spread merge preserves `projected`, `labor`, `payments_data`
- [ ] `location_integrations` row(s) created
- [ ] Event types without stable IDs documented as best-effort here
- [ ] Smoke test: a duplicate webhook payload is rejected by the unique index

## Clover-specific notes (open)

When the Clover webhook stream comes online, confirm per event type which carry a stable `event_id`:

| Event | Carries stable ID? | Notes |
|---|---|---|
| Order created | TBD | |
| Order modified | TBD | |
| Payment | TBD | |
| Refund | TBD | |
| Void | TBD | |

Fill this in during the Clover webhook build. Anything marked "no" gets the best-effort treatment.
