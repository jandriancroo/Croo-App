# Invoice profiles

- Vendor invoice reading profiles live only in supabase/functions/_shared/invoiceProfiles (default = _shared/invoice-ai.ts untouched; vendor profiles copy text, code works out pack/cost and self-checks; a failed check saves nothing). Why: one vendor's layout rules never change how other vendors are read.
