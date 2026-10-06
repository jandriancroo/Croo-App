// Vendor invoice reading profiles.
//
// "default" is today's reader (_shared/invoice-ai.ts, unchanged). PFG, PA and
// every other vendor keep using it exactly as before. A vendor gets its own
// profile only when its invoice layout needs rules the default can't follow.
//
// Chosen by the vendor name the default read found on the invoice, normalized
// the same way as public.normalize_vendor_name (so "Heimark Distributing, LLC"
// and "HEIMARK DISTRIBUTING, LLC" both become "heimark").

export type InvoiceProfile = "default" | "heimark";

/** Mirror of public.normalize_vendor_name. */
export function normalizeVendorName(name: string | null | undefined): string {
  return String(name ?? "")
    .toLowerCase()
    .replace(/\b(inc|llc|l\.l\.c|corp|corporation|co|ltd|company|distributing|distributors)\b\.?/g, " ")
    .replace(/[^a-z0-9]/g, "");
}

const PROFILE_BY_VENDOR: Record<string, InvoiceProfile> = {
  heimark: "heimark",
};

/** Clean display names for vendors we know but that aren't in vendor_registry yet. */
export const PROFILE_DISPLAY_NAME: Record<InvoiceProfile, string | null> = {
  default: null,
  heimark: "Heimark Distributing, LLC",
};

export function chooseProfile(vendorName: string | null | undefined): InvoiceProfile {
  return PROFILE_BY_VENDOR[normalizeVendorName(vendorName)] ?? "default";
}
