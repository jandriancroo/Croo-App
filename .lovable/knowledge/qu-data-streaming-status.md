# Qu Data Streaming — Current Status & Roadmap

_Last updated: May 6, 2026_

## Endpoint
- Webhook receiver: `supabase/functions/kds-stream/index.ts`
- Logs every payload to `kds_stream_events` (raw body + headers)
- Handles AWS SNS `SubscriptionConfirmation` handshake automatically
- Public URL: `https://lmodeiyrpwvgyqcvjkjr.supabase.co/functions/v1/kds-stream`

## What Qu is currently sending (last 7 days)
| Entity | Action | Volume | Status |
|---|---|---|---|
| Menu | Updated | 33 | ✅ flowing (not useful for us right now) |
| TimeEntry | Created | 23 | ✅ flowing — labor punches |
| Till | Upsert | 1 | ✅ flowing |
| **Closed Check / Order** | — | **0** | ❌ MISSING — needed for KDS + sales |
| **Payment** | — | **0** | ❌ MISSING — needed for paid status |
| **EOD** | — | **0** | ❌ MISSING — needed for daily reconciliation |

## End-state vision: replace ~95% of QU REST polling
Streaming should be the **primary** ingestion pipeline. Estimated drop from ~20K calls/day/store to ~200–500/day/store.

### ✅ Replace with streaming (event-driven)
| Currently polling | Stream event | Purpose |
|---|---|---|
| Live sales sync (1 min) | `Closed Check` | Real-time sales, no rate limit |
| Labor cache refresh | `TimeEntry` Created/Updated | Sub-second labor % |
| Tills / over-under | `Till` | Real-time cash drawer |
| KDS orders | `Closed Check` / `Order` | Already wired in `processOrderEvent` |
| Payment status | `Payment` | Hybrid paid check |
| EOD reconciliation | `EOD` | Replaces daily totals fetch |

### ❌ Keep as REST (on-demand only)
- POS item search (mapping screen) — see `pos-search` edge function
- Historical backfills (>30 days)
- Nightly reconciliation sweep (safety net)
- Menu/category catalog pulls

## Open requests to Rose @ Qu
1. Confirm/enable `Closed Check / Order`, `Payment`, `EOD` event types
2. Schema docs / sample payloads per entity
3. Retry behavior on 5xx + event replay capability
4. Throughput / throttling limits
5. Confirm subscription scope is chain-wide (intentional) and easy path to add new stores

## Code touch points
- `supabase/functions/kds-stream/index.ts` — receiver + Phase 2 KDS upsert
- `src/components/dashboard/DataStreamTask.tsx` — super-admin liveness chip
- `src/components/settings/DataStreamStatus.tsx` — recent events panel
- `kds_stream_events` table — raw event log for field mapping

## Phase plan
- **Phase 1 (done):** Receive + log every payload
- **Phase 2 (in progress):** Hydrate KDS orders from `Closed Check` events
- **Phase 3:** Route `TimeEntry` → `labor_cache` (source `qubeyond`) and retire labor poll
- **Phase 4:** Route `Closed Check` + `Payment` → `sales_cache` and retire 1-min sales poll
- **Phase 5:** `EOD` event → nightly reconciliation, drop redundant REST job

## Memory reference
- `mem://integrations/qu-data-streaming` — locked architectural rule
- `mem://integrations/qu-payment-sync-strategy` — payment merge behavior
- `mem://integrations/pos-search-optimization` — keep REST for search
