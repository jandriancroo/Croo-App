// @ts-nocheck
// ---------------------------------------------------------------------------
// One shared email header for every brand-tied system email.
//
// resolveEmailLogo: brand logo (location.brand_id or organization.brand_id)
//   → organization logo → CrooHQ logo.
// renderEmailHeader: the one header row (logo left, title centre, optional
//   store / org lines right). All values escaped; logo must be https.
// ---------------------------------------------------------------------------

export const CROO_EMAIL_LOGO =
  "https://lmodeiyrpwvgyqcvjkjr.supabase.co/storage/v1/object/public/email-assets/croo-logo-white.webp";

const HEADER_BG = "#0a7a8a";
const HEADER_FONT =
  "'Manrope', -apple-system, BlinkMacSystemFont, 'SF Pro', 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

export function escapeEmailHtml(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Returns the URL only when it parses as https; otherwise "". */
export function safeHttpsUrl(v: unknown): string {
  try {
    const u = new URL(String(v ?? ""));
    return u.protocol === "https:" ? u.toString() : "";
  } catch {
    return "";
  }
}

export interface EmailLogo {
  logoUrl: string;
  alt: string;
  source: "brand" | "organization" | "croo";
}

/** Pure resolution order, exported for tests. */
export function pickEmailLogo(input: {
  brandLogo?: string | null;
  brandName?: string | null;
  orgLogo?: string | null;
  orgName?: string | null;
}): EmailLogo {
  const brand = safeHttpsUrl(input.brandLogo);
  if (brand) return { logoUrl: brand, alt: input.brandName || input.orgName || "Logo", source: "brand" };
  const org = safeHttpsUrl(input.orgLogo);
  if (org) return { logoUrl: org, alt: input.orgName || input.brandName || "Logo", source: "organization" };
  return { logoUrl: CROO_EMAIL_LOGO, alt: "CrooHQ", source: "croo" };
}

export async function resolveEmailLogo(
  supabase: any,
  ids: { brandId?: string | null; organizationId?: string | null; locationId?: string | null },
): Promise<EmailLogo> {
  let brandId = ids.brandId ?? null;
  let organizationId = ids.organizationId ?? null;
  try {
    if (ids.locationId && (!brandId || !organizationId)) {
      const { data: loc } = await supabase
        .from("locations").select("brand_id, organization_id").eq("id", ids.locationId).maybeSingle();
      brandId = brandId || loc?.brand_id || null;
      organizationId = organizationId || loc?.organization_id || null;
    }
    let org: any = null;
    if (organizationId) {
      const { data } = await supabase
        .from("organizations").select("name, brand_name, logo_url, brand_id").eq("id", organizationId).maybeSingle();
      org = data;
      brandId = brandId || org?.brand_id || null;
    }
    let brand: any = null;
    if (brandId) {
      const { data } = await supabase.from("brands").select("name, logo_url").eq("id", brandId).maybeSingle();
      brand = data;
    }
    return pickEmailLogo({
      brandLogo: brand?.logo_url,
      brandName: brand?.name,
      orgLogo: org?.logo_url,
      orgName: org?.brand_name || org?.name,
    });
  } catch (e) {
    console.error("[emailHeader] logo lookup failed:", e);
    return pickEmailLogo({});
  }
}

/** The one header row (<tr>…</tr>) placed inside an email's main table. */
export function renderEmailHeader(opts: {
  title: string;
  logoUrl?: string | null;
  alt?: string | null;
  line1?: string | null;
  line2?: string | null;
  background?: string;
}): string {
  const logo = safeHttpsUrl(opts.logoUrl) || CROO_EMAIL_LOGO;
  const bg = /^#[0-9a-fA-F]{3,8}$/.test(opts.background || "") ? opts.background : HEADER_BG;
  const right = opts.line1 || opts.line2
    ? `${opts.line1 ? `<p style="color:#fff;font-size:13px;font-weight:600;margin:0;font-family:${HEADER_FONT};">${escapeEmailHtml(opts.line1)}</p>` : ""}${opts.line2 ? `<p style="color:rgba(255,255,255,0.7);font-size:12px;margin:3px 0 0;font-family:${HEADER_FONT};">${escapeEmailHtml(opts.line2)}</p>` : ""}`
    : "";
  return `<tr><td style="background-color:${bg};padding:20px 32px;"><table role="presentation" style="width:100%;border-collapse:collapse;"><tr>
<td style="vertical-align:middle;text-align:left;width:140px;"><img src="${escapeEmailHtml(logo)}" alt="${escapeEmailHtml(opts.alt || "Logo")}" style="max-height:40px;max-width:120px;border-radius:6px;"/></td>
<td style="vertical-align:middle;text-align:center;"><h1 style="color:#fff;font-size:24px;font-weight:700;margin:0;letter-spacing:0.3px;font-family:${HEADER_FONT};">${escapeEmailHtml(opts.title)}</h1></td>
<td style="vertical-align:middle;text-align:right;width:140px;">${right}</td>
</tr></table></td></tr>`;
}
