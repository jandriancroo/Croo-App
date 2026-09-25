# Fix croohq.com SPF (delete the conflicting record)

Read-only investigation is complete; this change happens in Wix DNS, not in the app.

## What's wrong (verified 2026-09-25 via public DNS)

croohq.com root has TWO `v=spf1` TXT records:

1. `v=spf1 include:_spf.google.com ~all` (Google Workspace)
2. `v=spf1 include:amazonses.com include:resend.com ~all` (leftover Resend setup)

Per RFC 7208, two SPF records on the same name = permerror: receivers treat SPF as failed for the whole domain.

## What CrooHQ actually sends and from where

- App email (hiring, reports, support, digests) → Resend, From addresses all `@croohq.email` (hello@, hiring@, support@, reports@, noreply@). No direct SES usage in code; `include:amazonses.com` is just Resend's underlying infra.
- Sign-in/auth email → Lovable-managed sender on `support.croohq.email` (verified, delegated to ns3/ns4.lovable.cloud — leave those NS records alone).
- Nothing sends from `@croohq.com` except Google Workspace mailboxes.
- Resend DKIM exists at `resend._domainkey.croohq.email` and `resend._domainkey.croohq.com`.

## The fix (in Wix DNS, ~1 minute)

1. Delete TXT record #2 (`v=spf1 include:amazonses.com include:resend.com ~all`).
2. Keep record #1: `v=spf1 include:_spf.google.com ~all` — that is the entire merged record; no combining needed since Resend/SES don't send from croohq.com.
3. Only if app mail is ever sent from `@croohq.com` addresses, re-add `include:resend.com` to the single record.

## Also fix while in DNS (found during the check)

- `google._domainkey.croohq.com` is MISSING — Workspace has no DKIM, and SPF was broken, so @croohq.com mail currently fails both alignment paths.
  - In Google Admin → Apps → Google Workspace → Gmail → Authenticate email: generate the key, then publish the TXT record it shows at `google._domainkey.croohq.com`.
- DMARC exists at `p=none` — leave it for now; move to `p=quarantine` after SPF + DKIM are confirmed clean for a couple of weeks.
- Do NOT touch: `support.croohq.email` NS records (Lovable email delegation), Resend DKIM records, MX records.

## Verification after the change

- `dig TXT croohq.com +short @8.8.8.8` should return exactly one `v=spf1` record.
- `dig TXT google._domainkey.croohq.com +short @8.8.8.8` should return the Workspace key.
- Mail-tester or Google's CheckMX on croohq.com should show SPF pass, DKIM pass.
