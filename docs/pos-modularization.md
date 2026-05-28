# POS Modularization — Plan & Status

_Last updated: May 28, 2026_

## The Problem

Adding a new POS (Toast, Square, future Clover webhook stream, etc.) was a custom build every time — each integration re-invented its own write path into `sales_cache`. Two specific pain points:

1. **No shared contract.** New POS code copy-pasted QU's shape with no enforced normalization.
2. **No webhook idempotency.** Nothing prevented the same event from being ingested twice if a webhook retried.

## The Direction: `sales_cache` as a POS-Agnostic Mailroom

Every POS — QU, Clover, and whatever comes next — writes normalized rows into `sales_cache`, tagged with `pos_source`. Downstream features (dashboards, pacing, AvT, labor variance) read from that single shape and don't care which POS the data came from.

```
   QU (pull)  ─┐
   Clover     ─┼─►  sales_cache  ──►  dashboards, pacing, AvT, labor
   Toast (TBD)─┘     (pos_source tagged)
```

## Phase 1 — Cleanup (shipped May 28, 2026)

### What changed

Migration `20260528_*` added to `public.sales_cache`:

| Field | Type | Notes |
|---|---|---|
| `external_event_id` | `TEXT` (nullable) | POS-provided unique event id. NULL for pull-based syncs. |

Plus a **partial unique index**:

```sql
CREATE UNIQUE INDEX uq_sales_cache_pos_event
  ON public.sales_cache (location_id, pos_source, external_event_id)
  WHERE external_event_id IS NOT NULL;
```

### Why TEXT, why partial

- **TEXT** covers numeric (Clover), UUID, and arbitrary string event ids without a future type-migration. The column is the only irreversible piece of this work — type changes on a unique index require a second migration, so we picked the widest safe type up front.
- **Partial index** means existing QU pull rows (which leave `external_event_id` NULL) are not affected. No backfill required. Safe to ship today; webhooks adopt it as they come online.

### Asymmetric upsert keys — by design

| Write mode | Conflict target |
|---|---|
| Pull sync (QU daily, Clover daily) | `(location_id, sale_date)` |
| Webhook ingest (future) | `(location_id, pos_source, external_event_id)` |

Two different conflict targets for two different write modes. This is intentional, not a bug — pull syncs are inherently day-keyed; webhooks are inherently event-keyed.

## Before vs After

| | Before | After |
|---|---|---|
| New POS integration | Custom build, copy-paste QU code | Follow "add a POS in 5 steps" spec (Phase 2) |
| Duplicate webhook events | No protection | Blocked by `uq_sales_cache_pos_event` |
| QU daily pull upsert | `(location_id, sale_date)` | Unchanged |
| Clover daily pull upsert | `(location_id, sale_date)` | Unchanged |
| Future webhook ingest | N/A | `(location_id, pos_source, external_event_id)` |

## Phase 2 — Spec (shipped May 28, 2026)

See [`adding-a-new-pos.md`](./adding-a-new-pos.md) for the 5-step recipe. Summary:

1. Register the `pos_source` slug
2. Create the per-POS raw archive table (mirrors `clover_sales_cache`)
3. Build the edge function (pull or webhook flavor)
4. Webhook ingest stamps `external_event_id` and upserts on the partial-unique key
5. Register the integration in `location_integrations`

Open item tracked in that doc: confirm per-event-type whether Clover webhooks carry stable IDs; mark any that don't as best-effort.


## Phase 3 — Opportunistic Refactor

No big-bang rewrite. As each existing integration is touched for other reasons, align it with the spec. The mailroom shape is already the de-facto contract — the spec just makes it explicit.

## Locked Decisions

- `sales_cache` is the POS-agnostic mailroom. Per-POS raw data lives in dedicated archive tables (e.g. `clover_sales_cache`) and is dual-written.
- `external_event_id` is **TEXT**, **nullable**, with a **partial** unique index. Do not change without a second migration.
- Pull and webhook write paths keep different conflict targets. Don't try to unify them.
