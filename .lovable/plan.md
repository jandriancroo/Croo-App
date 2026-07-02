# Inventory Lite — Isolation Rebuild (Dry Run)

Goal: **Lite stops touching Brand-governed tables entirely.** `locations`, `organizations`, and the stateless AI vision call remain shared; everything else forks.

---

## Step 1 — Revert Brand-shared changes

### 1a. Restore governance triggers

Reset both functions to their pre-Lite bodies (no `loc_mode` lookup, no Lite branch).

```sql
-- enforce_inventory_item_brand_link — pre-Lite
CREATE OR REPLACE FUNCTION public.enforce_inventory_item_brand_link()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.is_active = true AND NEW.brand_item_id IS NULL THEN
    RAISE EXCEPTION
      'inventory_items.brand_item_id is required when is_active = true (Brand Catalog governance: row %, name %)',
      NEW.id, NEW.name
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

-- trg_validate_active_brand_link — pre-Lite
CREATE OR REPLACE FUNCTION public.trg_validate_active_brand_link()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
DECLARE tmpl_status text;
BEGIN
  IF NEW.is_active = true THEN
    IF NEW.brand_item_id IS NULL THEN
      RAISE EXCEPTION 'Active inventory items must have a brand_item_id';
    END IF;
    SELECT status INTO tmpl_status FROM public.brand_inventory_templates WHERE id = NEW.brand_item_id;
    IF tmpl_status IS NULL THEN
      RAISE EXCEPTION 'Active inventory item % references a missing brand template %', NEW.id, NEW.brand_item_id;
    END IF;
    IF tmpl_status <> 'live' THEN
      RAISE EXCEPTION 'Cannot activate inventory_item % — brand template % is %, not live', NEW.id, NEW.brand_item_id, tmpl_status;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
```

### 1b. Drop the three Lite-added columns

```sql
ALTER TABLE public.inventory_items       DROP COLUMN IF EXISTS vendor_name_normalized;
ALTER TABLE public.inventory_items       DROP COLUMN IF EXISTS match_status;
ALTER TABLE public.vendor_invoice_items  DROP COLUMN IF EXISTS candidate_item_id;
```

**Important call-out:** `vendor_invoice_items.match_status` **stays** — it predates Lite and is written by the Brand parser (values: `matched`, `matched_brand`, `unmatched`) and read by `InvoiceUploadDialog.tsx`. Only `candidate_item_id` was added for Lite.

### 1c. Delete Lite QA smoke rows

```sql
DELETE FROM public.vendor_invoice_items WHERE invoice_id = '9a5c1e00-2222-4000-8000-000000000001';
DELETE FROM public.vendor_invoices      WHERE id         = '9a5c1e00-2222-4000-8000-000000000001';
DELETE FROM public.inventory_items      WHERE location_id = '9a5c1e00-0000-4000-8000-000000000002';
-- Also delete the negative-test row from Hemet that raised (row was rejected but I'll double-check)
DELETE FROM public.inventory_items      WHERE name = '__NEGATIVE_TEST_SHOULD_FAIL__';
```

### 1d. Evidence

- **Diff:** side-by-side of both triggers' current body vs restored body.
- **Negative test rerun** on Hemet (production, brand-mode): insert active item without `brand_item_id` → confirm `enforce_inventory_item_brand_link` still raises.
- **Production-store row-count parity:** `SELECT count(*)` on `inventory_items` and `vendor_invoice_items` for Hemet, Sparks, South Meadows, Palm Springs, Palm Desert before/after — expect zero delta.

---

## Step 2 — Isolated Lite schema

Fully separate tables, RLS + GRANTs, no FKs to any Brand-governance table, no triggers copied from Brand.

```sql
-- lite_inventory_items
CREATE TABLE public.lite_inventory_items (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id            uuid NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
  name                   text NOT NULL,
  item_number            text,
  vendor_name_normalized text,
  unit                   text,
  cost_per_unit          numeric(12,4) DEFAULT 0,
  is_active              boolean NOT NULL DEFAULT true,
  match_status           text NOT NULL DEFAULT 'new',   -- matched | fuzzy | new
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.lite_inventory_items (location_id);
CREATE INDEX ON public.lite_inventory_items (location_id, vendor_name_normalized, item_number);
CREATE INDEX ON public.lite_inventory_items (location_id, lower(name));

-- lite_vendor_invoices
CREATE TABLE public.lite_vendor_invoices (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id     uuid NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
  vendor_name     text,
  invoice_number  text,
  invoice_date    date,
  delivery_date   date,
  total_amount    numeric(12,2),
  status          text NOT NULL DEFAULT 'parsed',
  storage_path    text,
  parsed_at       timestamptz,
  uploaded_by     uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.lite_vendor_invoices (location_id, invoice_date DESC);

-- lite_vendor_invoice_items
CREATE TABLE public.lite_vendor_invoice_items (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id         uuid NOT NULL REFERENCES public.lite_vendor_invoices(id) ON DELETE CASCADE,
  product_name       text NOT NULL,
  item_number        text,
  quantity           numeric(12,4),
  unit               text,
  unit_price         numeric(12,4),
  total_price        numeric(12,2),
  match_status       text NOT NULL,                                       -- matched | fuzzy | new
  matched_item_id    uuid REFERENCES public.lite_inventory_items(id) ON DELETE SET NULL,
  candidate_item_id  uuid REFERENCES public.lite_inventory_items(id) ON DELETE SET NULL,
  fuzzy_score        numeric(4,3),
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.lite_vendor_invoice_items (invoice_id);
CREATE INDEX ON public.lite_vendor_invoice_items (matched_item_id);

-- GRANTs (required)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.lite_inventory_items       TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.lite_vendor_invoices       TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.lite_vendor_invoice_items  TO authenticated;
GRANT ALL ON public.lite_inventory_items      TO service_role;
GRANT ALL ON public.lite_vendor_invoices      TO service_role;
GRANT ALL ON public.lite_vendor_invoice_items TO service_role;

-- RLS: mirror the location-scoped pattern used by Brand vendor_invoices
ALTER TABLE public.lite_inventory_items       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lite_vendor_invoices       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lite_vendor_invoice_items  ENABLE ROW LEVEL SECURITY;

-- Policies: user must have access to the location (has_location_access(auth.uid(), location_id))
-- Full policy text in the migration.

-- updated_at triggers (local, not brand governance)
CREATE TRIGGER lite_inventory_items_updated_at BEFORE UPDATE ON public.lite_inventory_items
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER lite_vendor_invoices_updated_at BEFORE UPDATE ON public.lite_vendor_invoices
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
```

**Zero Brand-governance surface:** no `brand_item_id`, no `matched_template_id`, no `enforce_inventory_item_brand_link` trigger, no `trg_validate_active_brand_link` trigger, no FK to `brand_inventory_templates` / `brand_pack_configs` / `vendor_gap_alerts`.

---

## Step 3 — Edge function fork

### 3a. Extract shared AI vision helper

New file `supabase/functions/_shared/invoice-ai.ts` exporting `extractInvoiceFromImage(base64, mime) → ParsedInvoice`. Currently the Gemini call lives inline in `parse-vendor-invoice/index.ts` — move it out. Brand parser imports it. **No matching logic moves — only the vision call.**

### 3b. Restore `parse-vendor-invoice` (Brand) to pre-Lite

Strip lines 236–402 (the Lite branch + `inventory_mode` lookup). File becomes byte-identical to its pre-Phase-1 state except for the extracted-helper import. Verified by diff against Phase-1 baseline.

### 3c. Create `parse-vendor-invoice-lite`

Same request/response contract as Brand parser (`storagePath`, `locationId`, preview + confirm flow). Uses the shared helper for extraction. Matching cascade queries and writes exclusively `lite_*`:

```text
per line item:
  1. composite: lite_inventory_items where location_id=$ and vendor_name_normalized=$ and item_number=$
  2. exact:     lite_inventory_items where location_id=$ and lower(name)=lower($)
  3. fuzzy:     pg_trgm similarity >= FUZZY_MATCH_THRESHOLD (0.7)  → candidate_item_id, match_status='fuzzy'
  4. auto-create in lite_inventory_items, match_status='new'
insert into lite_vendor_invoice_items
```

No touch to `inventory_items`, `vendor_invoice_items`, `brand_*`, `vendor_gap_alerts`, or any governance trigger surface.

---

## Step 4 — Frontend rewiring

- New `LiteInvoiceUploadDialog.tsx` (fork of `InvoiceUploadDialog.tsx`) — queries `lite_vendor_invoices` / `lite_vendor_invoice_items`, invokes `parse-vendor-invoice-lite`.
- `Inventory.tsx` / `InventoryItemsManager.tsx`: when `useInventoryMode(locationId).isLite`, render the Lite dialog and a Lite items list backed by `lite_inventory_items`. Brand mode continues to use the existing dialog and tables.
- `useInventoryMode` hook unchanged (already reads `locations.inventory_mode`).

---

## Evidence before merge

1. **Trigger revert proof:**
   - `pg_get_functiondef` output for both functions matches pre-Lite bodies verbatim.
   - Negative test on Hemet: insert active item without `brand_item_id` → raises `enforce_inventory_item_brand_link` error.
2. **Column revert proof:** `information_schema.columns` shows the 3 columns are gone; production row counts unchanged on all 5 stores.
3. **Isolation proof:**
   - `SELECT conname, confrelid::regclass FROM pg_constraint WHERE conrelid IN ('lite_inventory_items','lite_vendor_invoices','lite_vendor_invoice_items'::regclass) AND contype='f'` → shows FKs only to `locations` and other `lite_*` tables.
   - `SELECT tgname FROM pg_trigger WHERE tgrelid = 'lite_inventory_items'::regclass` → shows only `updated_at`, no governance triggers.
4. **Cascade proof:** re-run 4-branch smoke against `lite_*` tables. Report row counts + `match_status` distribution identical in shape to Phase 1.
5. **Cross-contamination scan:**
   `rg -n "inventory_items|vendor_invoice_items|brand_|vendor_gap_alerts" supabase/functions/parse-vendor-invoice-lite/ src/components/inventory/LiteInvoiceUploadDialog.tsx` → expect zero hits on Brand-governed table names (only `lite_*`, `locations`, `organizations`).

---

## What is NOT changing

- Brand parser matching logic
- Brand governance triggers (post-revert)
- `locations`, `organizations`, `useInventoryMode`, guards on Genius tab / Vendor Sync / Deploy wizard (all Phase 1 wins)
- Gemini vision prompt (moves file, keeps content)

## Risks & mitigations

- **Types regen:** dropping columns will regen `src/integrations/supabase/types.ts` and could break Brand components that reference the dropped columns. Only `match_status` on `vendor_invoice_items` has Brand consumers, and we're keeping that one. `vendor_name_normalized`, `match_status` on `inventory_items`, and `candidate_item_id` on `vendor_invoice_items` are Lite-only in current code — dropping is safe.
- **Storage bucket:** invoice uploads currently land in the existing `vendor-invoices` bucket. Lite will reuse the same bucket (path scoped by `location_id`); no new bucket needed.

Awaiting approval before touching anything.
