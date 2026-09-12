# Dashboard-created Stripe subscription → Active Ludicrous in Croo-App?

## Short answer
Yes — with conditions. A subscription created directly in the Stripe Dashboard is recognized, because the app never stores subscriptions locally; it reads Stripe live on every check.

## The live path
- `supabase/functions/check-subscription/index.ts` is the only source of truth. It lists/searches Stripe subscriptions, then builds `location_subscriptions` keyed by `sub.metadata.location_id` (`:206-226`), with `product_id` taken from `sub.items.data[0].price.product`.
- `src/hooks/useSubscription.ts:49-83` calls it on login, on auth change, and every 60 seconds, then `getLocationTier` (`:150-154`) maps `product_id` through `PRODUCT_TO_TIER`.
- `src/config/subscriptionTiers.ts:32-36` already contains `prod_U49J9N7epjx3ZR` → `ludicrous`, and `price_1T610wCmnsCrRQe0TcPDTjJy` matches that product.
- `src/pages/Billing.tsx:173-202` renders the location as subscribed and shows the tier name, falling back to the word "Active" only if the product is unmapped.

## Gotchas that will silently break it
1. **Status must be `active` or `trialing`.** Both queries only pull those two (`:139-146`, `:92-93`). `incomplete`, `past_due`, `unpaid`, or `paused` produces nothing — so an unpaid first invoice on a dashboard-created subscription shows the location as not subscribed until the invoice is paid.
2. **`metadata.location_id` is mandatory.** Without it the subscription counts toward the org total but the location never appears in `location_subscriptions`, so the location row stays unsubscribed.
3. **`metadata.organization_id` must equal the org the user is viewing.** For non-super-admins, subscriptions are filtered by exactly that (`:148-151`). A mismatch hides it.
4. **Customer email must match an org member's profile email** for non-super-admins (`:126-140`); customers are looked up by email only. Super admins bypass this by searching Stripe metadata directly (`:92-113`).
5. **Metadata must be on the Subscription, not the Customer or the Invoice.** Only `sub.metadata` is read.
6. **UUIDs must be exact, unquoted strings** — Stripe search is an exact match on `metadata['location_id']`.
7. Super admin metadata search can lag briefly (Stripe search index), while the non-super-admin `subscriptions.list` path is immediate. A page refresh or the 60-second poll resolves it.

## Verification once created
Sign in as an org admin for that org, open Billing, and confirm the location shows the Ludicrous badge. If it shows "Active" with no plan name, the product ID does not match the catalog map. If it shows nothing, check status and the two metadata keys in that order.

No code change is needed for this to work.
