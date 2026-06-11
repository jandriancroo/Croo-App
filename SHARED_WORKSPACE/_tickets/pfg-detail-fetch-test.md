<!--
Entries dated + attributed: [YYYY-MM-DD · Author: Lovable/Claude/Jordan]
STATUS: OPEN / IN-PROGRESS / DONE / WONTFIX
Newest entries at top. Never delete — strike-through or mark SUPERSEDED.
-->

# PFG fetchDeliveryDetail — Test Fixture for DeliveryKey Passthrough

**STATUS: OPEN — MEDIUM PRIORITY**

## Summary

Deferred from the 2026-06-11 PFG sync-breakage resolution. The Tuscaloosa root cause was `fetchDeliveryDetail` reconstructing `DeliveryKey` instead of trusting the native header value (Hickory/OpCo 770 uses 3-part `YYYYMMDD`, reconstruction produced 4-part `YYYY-MM-DD` and PFG returned empty bodies). The fix is live, but there is no regression test.

## Scope

Add a Deno test file at `supabase/functions/pfg-service/fetchDeliveryDetail_test.ts` that:

1. **Stubs `fetchPfgJson`** to capture the request body sent to `GetDeliveryDetail`.
2. **Asserts native passthrough** — given an order with `DeliveryKey: '33501384_20260529_4108438'` (Hickory 3-part), the request body's `DeliveryKey` must equal that string verbatim (no reconstruction).
3. **Asserts fallback reconstruction** — given an order WITHOUT `DeliveryKey` but with `DeliverToCustomerNumber`, `DeliveryDate`, `OrderKey`, the reconstructed key follows `opCo_cust_YYYY-MM-DD_orderKey` and a warning is logged.
4. **Asserts no-fields → empty** — given an order without `DeliveryKey` AND missing reconstruction inputs, returns `[]` without calling PFG.
5. **Asserts audit insert on failure** — when `fetchPfgJson` throws, an `auditCtx` insert into `pfg_refresh_audit` fires with `outcome='detail_fetch_failed'`, `b2c_error_code='request_error'`.

## Run via

```
supabase functions test --pattern fetchDeliveryDetail
```

## Why deferred

Session 2 was scoped to fix + audit; test infrastructure for edge functions in this project is greenfield. Worth a focused session to set the pattern.

## History

- [2026-06-11 · Lovable] Filed as follow-up after Session 2 close. The fix shipped in `supabase/functions/pfg-service/index.ts` (~line 840) and is verified via the Tuscaloosa 7/7 backfill, but it's a regression magnet — needs locked-down test coverage.
