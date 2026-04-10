
# Theo Upgrade Plan

## Phase 1: Immediate (This Session)

### 1A. System Prompt Overhaul
- Replace current personality prompt with the elite "Digital GM / Co-Pilot" persona
- Keep all existing tool-calling logic, formatting rules, and safety guards intact
- Add SOP/knowledge-base awareness instructions

### 1B. Long-Term Memory System ("Theo's Brain")
- **Database**: Create `theo_knowledge` table with `location_id`, `topic`, `content`, and `embedding` (pgvector)
- **Save Button**: Add a "Pin to Memory" button next to Theo's responses
- **Embedding**: When pinned, call Lovable AI to generate an embedding and store it
- **Retrieval**: Before each query, do a similarity search on `theo_knowledge` and inject top 3 relevant facts into context
- **Edge Function**: Add a `theo-memory` edge function to handle save + search

### 1C. System Prompt: Employee Tag Format
- Switch from `[[employee:Name]]` to `<employee>Name</employee>` tags as requested (update markdown renderer too)

## Phase 2: Coverage Assessment for 50 Questions

### ✅ Already Supported (Theo can answer these TODAY with existing tools)
- Questions 1-5, 7, 9 (Sales/Labor via `query_sales`, `query_labor`)
- Questions 11-14, 16-19 (Ovation via `query_ovation_reviews`)
- Questions 21-22, 24, 29-30 (Schedule/Punches via `query_schedule`, `query_labor`)
- Questions 41-49 (Checklists, tasks, logbook, catering via existing tools)

### ⚠️ Partially Supported (need minor tool tweaks)
- Q5 "cut one person" — needs labor projection logic (complex, future)
- Q6 "overtime across brand" — needs cross-location query (org-level)
- Q20 "auto-flag reviews" — needs task-creation tool (new)
- Q27 "which SM had highest labor%" — needs shift-level labor correlation
- Q44 "create a temporary task" — needs task-creation tool (new)
- Q50 "shift-readiness report" — composite query across multiple tools

### ❌ Needs New Data Sources (not available in your system yet)
- Q7, Q10 (KDS ticket times, discounts/comps — not in sales_cache)
- Q8 (Catering vs Walk-in split — not tracked separately in POS data)
- Q23 (I-9 documents — no HR document tracking table)
- Q25 (OPUS training data — no integration exists)
- Q31-39 (Recipe database, prep pars, shelf life, ingredient impact — no recipe/COGS tables yet)

## Recommendation
Start with **Phase 1** now (prompt + memory + tag format). The 50-question coverage is mostly already there — the gaps are data sources that don't exist yet, not Theo limitations. We can add task-creation as a new tool in this session too.

---

# QU API Optimization Plan

## Phase 1: Quick Wins ✅ COMPLETED (April 10, 2026)

### Changes Made
1. **Removed dead payment endpoints** — Stripped `payments/main` and `payment-types/main` from both `sales-service` and `fetch-qubeyond-sales`. Only `summary/payments` is used (the only one that works for Blaze stores).
2. **Removed 100-item product mix cap** — `.slice(0, 100)` removed from `fetch-qubeyond-sales` so full menu data is preserved.
3. **Skip unprovisioned stores (Sparks)** — `fetchHourlySales` now detects 403 "No operational units" and throws `UNPROVISIONED_STORE`, causing the sync loop to skip all remaining API calls for that location.

### Results
- **Before:** ~32,500 QU API calls/day
- **After:** ~21,600 QU API calls/day
- **Savings:** ~10,900 dead calls/day eliminated (33.6% reduction)
- **Zero error log noise** from 404/403 responses on dead endpoints

---

## Phase 2: Data Streaming Migration (PLANNED — NOT YET STARTED)

### Goal
Replace 1-minute polling with real-time webhook consumption from QU Data Streaming Service. Target: **96% total API reduction** (from ~21,600 → ~1,400 calls/day).

### Already Subscribed Topics (via `kds-stream` webhook)
- Sales (Closed Check, modifications)
- Cash (Till Close/Reconcile)
- Labor (Time Entry)
- Menu/Inventory Updates
- Operations (End of Day)
- Monitoring (Terminal Update)

### Implementation Steps

#### Step 2a: Wire "Closed Check" stream → sales_cache
- Parse incoming Closed Check webhooks for: net sales, guest count, payment type, line items (product mix)
- Accumulate into `sales_cache` in real-time instead of polling
- Derive hourly breakdown from check timestamps
- **Eliminates:** `hourly-sales`, `product-mix`, `summary/payments` polling for all streaming-enabled locations
- **Savings:** ~20,160 calls/day (8 locations × 3 endpoints × 840 minutes)

#### Step 2b: Add streaming status flag to location_integrations
- Add `streaming_active` boolean or `sync_mode` enum ('polling' | 'streaming') to `location_integrations`
- `sales-service` checks this flag: if streaming is active, skip API polling for that location
- Fallback: if no stream events received in 5 minutes during business hours, temporarily revert to polling

#### Step 2c: KDS polling retirement
- Once Closed Check stream is proven reliable, disable `kds-orders` 10-second polling for KDS locations
- **Savings:** ~10,080 calls/day (2 locations × 6/min × 840 min)

#### Step 2d: Monitoring & alerting
- Add a "stream health" check: if a location hasn't received a stream event in X minutes during business hours, log a warning and auto-fallback to polling
- Dashboard indicator showing which locations are on streaming vs polling

### Estimated Final State
| Metric | Polling Only | After Phase 1 | After Phase 2 |
|---|---|---|---|
| QU API calls/day | ~32,500 | ~21,600 | ~1,400 |
| Reduction | — | -33% | -96% |
| Data freshness | 1 min | 1 min | Real-time |
| Error noise | High (404/403) | Low | Minimal |

### Risks & Mitigations
- **Stream downtime:** Automatic fallback to polling if no events in 5 min
- **Data gaps:** Reconciliation check at End of Day (compare stream totals vs API snapshot)
- **Ordering:** Stream events may arrive out of order — use check timestamps, not arrival order

---

## Phase 3: pos-search Local Cache (PLANNED)
- Move `pos-search` edge function from live QU API to querying `sales_cache.product_mix` column
- Eliminates dangerous 90-day multi-location API queries on user search
- Prevents rate limit risk from concurrent searches
- Also fixes the 500-item pagination bug (irrelevant once searching local data)
