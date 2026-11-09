/** Serialize JSON-LD safely for a <script> tag: escapes "<" so DB text can't close the tag (stored XSS). */
export function safeJsonLd(obj: unknown): string {
  return JSON.stringify(obj).replace(/</g, '\\u003c');
}

const DAY_MS = 86_400_000;
const VALID_WINDOW_DAYS = 60;
export const SITE_ORIGIN = 'https://croohq.com';

/**
 * validThrough for a JobPosting.
 * - Real expires_at wins.
 * - Otherwise a rolling 60-day window anchored on posted_at: the end of the
 *   current window (posted + 60·n days, first one in the future). Listings
 *   stay active until a manager closes them; the date keeps rolling forward
 *   and the sitemap/JSON-LD drop the job as soon as status != 'active'.
 */
export function computeValidThrough(postedAt?: string | null, expiresAt?: string | null, now = new Date()): string | undefined {
  if (expiresAt) return new Date(expiresAt).toISOString();
  if (!postedAt) return undefined;
  const posted = new Date(postedAt).getTime();
  if (Number.isNaN(posted)) return undefined;
  const windowMs = VALID_WINDOW_DAYS * DAY_MS;
  const n = Math.max(1, Math.floor((now.getTime() - posted) / windowMs) + 1);
  return new Date(posted + n * windowMs).toISOString();
}

export const JOBS_INDEX_TITLE = 'Restaurant Jobs Near You | CrooHQ — Pizza, Fast Food & Food Service Careers';
export const JOBS_INDEX_DESCRIPTION = 'Find restaurant and fast food jobs at Blaze Pizza and other brands. Apply for pizza maker, team member, shift manager, cook, and kitchen crew positions near you — no account needed.';

/** Live public URLs as of the jobs-box work. The post-build checker requires these files. */
export const PINNED_PUBLIC_JOBS: PinnedJob[] = [
  {
    slug: 'hemet-team-member-e766b367',
    title: 'Team Member - Blaze Pizza',
    city: 'Hemet',
    region: 'CA',
    employmentType: 'PART_TIME',
    company: 'Blaze Pizza',
    sameAs: 'https://croohq.com/apply/jo-pizza-llc',
    occupationalCategory: '35-3023.00',
    descriptionMustInclude: ['hemet', 'pizza', 'restaurant'],
    descriptionFlagIfMissing: ['food', 'food service'],
    requireSalary: true,
  },
  {
    slug: 'hemet-shift-manager-e80d9518',
    title: 'Shift Manager - Blaze Pizza',
    city: 'Hemet',
    region: 'CA',
    employmentType: 'FULL_TIME',
    company: 'Blaze Pizza',
    sameAs: 'https://croohq.com/apply/jo-pizza-llc',
    occupationalCategory: '11-9051.00',
    descriptionMustInclude: ['hemet', 'pizza', 'restaurant', 'food'],
    descriptionFlagIfMissing: ['food service'],
    requireSalary: true,
  },
  {
    slug: 'palm-springs-team-member-bcdcd6b8',
    title: 'Team Member - Blaze Pizza',
    city: 'Palm Springs',
    region: 'CA',
    employmentType: 'FULL_TIME',
    company: 'Blaze Pizza',
    sameAs: 'https://croohq.com/apply/ddm-pizza',
    occupationalCategory: '35-3023.00',
    descriptionMustInclude: ['palm springs', 'pizza', 'restaurant'],
    descriptionFlagIfMissing: ['food', 'food service'],
    requireSalary: true,
  },
];

export type PinnedJob = {
  slug: string;
  title: string;
  city: string;
  region: string;
  employmentType: string;
  company: string;
  sameAs: string;
  occupationalCategory: string;
  descriptionMustInclude: string[];
  descriptionFlagIfMissing: string[];
  requireSalary: boolean;
};

const EMPLOYMENT_SCHEMA: Record<string, string> = {
  full_time: 'FULL_TIME',
  part_time: 'PART_TIME',
  contract: 'CONTRACTOR',
  temporary: 'TEMPORARY',
  intern: 'INTERN',
  seasonal: 'TEMPORARY',
};

export type PostalAddressParts = {
  street: string;
  city: string;
  state: string;
  zip: string;
};

export type JobRecord = {
  id: string;
  title: string;
  description?: string | null;
  employment_type?: string | null;
  pay_min?: number | string | null;
  pay_max?: number | string | null;
  pay_type?: string | null;
  posted_at?: string | null;
  expires_at?: string | null;
  location?: { name?: string | null; address?: string | null } | null;
  organization?: {
    name?: string | null;
    slug?: string | null;
    brand_name?: string | null;
    logo_url?: string | null;
  } | null;
};

export type StaticDocument = {
  documentTitle: string;
  metaDescription: string;
  canonical: string;
  ogType: 'article' | 'website';
  jsonLd: unknown;
  jsonLdId: string;
  shellInnerHtml: string;
};

export type BuiltJob = {
  slug: string;
  canonical: string;
  document: StaticDocument;
  posting: Record<string, unknown>;
  /** Required fields the listing does not have. Nothing is invented to fill these. */
  gaps: string[];
  /** Prose the stored description does not contain. Schema still carries industry. */
  notes: string[];
};

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Same address split the public job pages already use. */
export function parseJobAddress(address?: string | null): PostalAddressParts {
  if (!address) return { street: '', city: '', state: '', zip: '' };
  const parts = address.split(',').map((s) => s.trim());
  if (parts.length >= 2) {
    const lastPart = parts[parts.length - 1];
    const m = lastPart.match(/^([A-Za-z\s]+?)\s+(\d{5}(?:-\d{4})?)$/);
    if (m) {
      const city = parts.length >= 3 ? parts[parts.length - 2] : '';
      return { street: parts[0], city, state: m[1].trim(), zip: m[2] };
    }
    return { street: parts[0], city: parts.length >= 3 ? parts[1] : '', state: lastPart, zip: '' };
  }
  return { street: address, city: '', state: '', zip: '' };
}

export function slugifyPart(value: string): string {
  return (value || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export function buildJobSlug(job: {
  id?: string | null;
  title?: string | null;
  location?: { name?: string | null; address?: string | null } | null;
}): string {
  const addr = parseJobAddress(job.location?.address);
  const city = addr.city || job.location?.name || '';
  return [slugifyPart(city), slugifyPart(job.title || ''), (job.id || '').slice(0, 8)].filter(Boolean).join('-');
}

/** O*NET-SOC codes Google accepts on occupationalCategory. */
export function occupationalCategory(title: string): string {
  const lower = title.toLowerCase();
  if (lower.includes('manager') || lower.includes('supervisor') || lower.includes('lead')) return '11-9051.00';
  if (lower.includes('cook') || lower.includes('chef')) return '35-2014.00';
  if (lower.includes('cashier')) return '41-2011.00';
  return '35-3023.00';
}

export function companyName(org?: JobRecord['organization']): string | null {
  const brand = org?.brand_name?.trim();
  const legal = org?.name?.trim();
  return brand || legal || null;
}

function finiteNumber(value: number | string | null | undefined): number | null {
  if (value == null || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function httpsUrl(value?: string | null): string | null {
  const v = (value || '').trim();
  return /^https:\/\/\S+$/i.test(v) ? v : null;
}

function schemaTitle(title: string, company: string | null): string {
  const role = title.trim();
  return company ? `${role} - ${company}` : role;
}

function composeDescription(title: string, company: string | null, address: PostalAddressParts, description?: string | null): string {
  const place = [address.city, address.state].filter(Boolean).join(', ');
  const who = schemaTitle(title, company);
  const lead = place ? `${who} in ${place}.` : `${who}.`;
  const body = (description || '').trim();
  return body ? `${lead}\n\n${body}` : lead;
}

function descriptionNotes(description: string): string[] {
  const hay = description.toLowerCase();
  const notes: string[] = [];
  if (!/\bfood\b/.test(hay)) notes.push('JobPosting description does not contain the word "food"');
  if (!hay.includes('food service')) {
    notes.push('JobPosting description does not contain "food service"; industry is "Food Services" and occupationalCategory is the O*NET food-service code');
  }
  return notes;
}

function metaDescriptionFrom(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, 158);
}

function documentTitleFor(title: string, address: PostalAddressParts): string {
  const place = [address.city, address.state].filter(Boolean).join(', ');
  return place ? `${title} in ${place} | CrooHQ Jobs` : `${title} | CrooHQ Jobs`;
}

export function buildJobPosting(job: JobRecord, now = new Date()): BuiltJob {
  const gaps: string[] = [];
  const address = parseJobAddress(job.location?.address);
  const company = companyName(job.organization);
  const title = schemaTitle(job.title || '', company);
  const slug = buildJobSlug(job);
  const canonical = `${SITE_ORIGIN}/jobs/${slug}`;
  const description = composeDescription(job.title || '', company, address, job.description);

  if (!company) gaps.push('hiringOrganization.name missing (organization has no brand_name or name)');
  if (!job.title?.trim()) gaps.push('title missing');

  const streetAddress = address.street.trim();
  const addressLocality = address.city.trim();
  const addressRegion = address.state.trim();
  const postalCode = address.zip.trim();
  if (!streetAddress) gaps.push('jobLocation.address.streetAddress missing');
  if (!addressLocality) gaps.push('jobLocation.address.addressLocality missing');
  if (!addressRegion) gaps.push('jobLocation.address.addressRegion missing');
  if (!postalCode) gaps.push('jobLocation.address.postalCode missing');

  const postal: Record<string, string> = { '@type': 'PostalAddress' };
  if (streetAddress) postal.streetAddress = streetAddress;
  if (addressLocality) postal.addressLocality = addressLocality;
  if (addressRegion) postal.addressRegion = addressRegion;
  if (postalCode) postal.postalCode = postalCode;
  if (addressRegion || postalCode) postal.addressCountry = 'US';
  else gaps.push('jobLocation.address.addressCountry missing');

  const orgSlug = job.organization?.slug?.trim() || '';
  const sameAs = orgSlug ? `${SITE_ORIGIN}/apply/${orgSlug}` : null;
  if (!sameAs) gaps.push('hiringOrganization.sameAs missing (organization has no slug)');

  const logo = httpsUrl(job.organization?.logo_url);
  if (!logo) gaps.push('hiringOrganization.logo missing (organization.logo_url is empty or not an https URL)');

  const hiringOrganization: Record<string, unknown> = { '@type': 'Organization' };
  if (company) hiringOrganization.name = company;
  if (sameAs) hiringOrganization.sameAs = sameAs;
  if (logo) hiringOrganization.logo = logo;

  const knownType = job.employment_type ? EMPLOYMENT_SCHEMA[job.employment_type] : undefined;
  if (!knownType) gaps.push(`employmentType missing (listing employment_type is "${job.employment_type || ''}")`);

  const payMin = finiteNumber(job.pay_min);
  const payMax = finiteNumber(job.pay_max);
  let baseSalary: Record<string, unknown> | undefined;
  if (payMin == null && payMax == null) {
    gaps.push('baseSalary missing (listing has no pay_min or pay_max)');
  } else if (job.pay_type !== 'hourly' && job.pay_type !== 'salary') {
    gaps.push(`baseSalary omitted (pay_type is "${job.pay_type || ''}", not hourly or salary)`);
  } else {
    baseSalary = {
      '@type': 'MonetaryAmount',
      currency: 'USD',
      value: {
        '@type': 'QuantitativeValue',
        minValue: payMin ?? payMax,
        maxValue: payMax ?? payMin,
        unitText: job.pay_type === 'salary' ? 'YEAR' : 'HOUR',
      },
    };
  }

  const datePosted = job.posted_at?.split('T')[0];
  if (!datePosted) gaps.push('datePosted missing (no posted_at)');
  const validThrough = computeValidThrough(job.posted_at, job.expires_at, now);
  if (!validThrough) gaps.push('validThrough missing (no posted_at or expires_at)');

  const posting: Record<string, unknown> = {
    '@context': 'https://schema.org/',
    '@type': 'JobPosting',
    title,
    description,
    employmentType: knownType,
    hiringOrganization,
    directApply: true,
    url: canonical,
    industry: 'Food Services',
    occupationalCategory: occupationalCategory(job.title || ''),
  };
  if (streetAddress || addressLocality || addressRegion || postalCode) {
    posting.jobLocation = { '@type': 'Place', address: postal };
  }
  if (datePosted) posting.datePosted = datePosted;
  if (validThrough) posting.validThrough = validThrough;
  if (baseSalary) posting.baseSalary = baseSalary;
  if (company && job.id) {
    posting.identifier = { '@type': 'PropertyValue', name: company, value: job.id };
  }
  if (!knownType) delete posting.employmentType;

  const placeLine = [address.city, [address.state, address.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  const applyHref = sameAs && job.id ? `${sameAs}?utm_source=job_detail&listing=${job.id}` : sameAs;
  const shellInnerHtml = [
    `<h1>${escapeHtml(title)}</h1>`,
    `<p>${escapeHtml([company, placeLine].filter(Boolean).join(' · '))}</p>`,
    `<p>${escapeHtml(description)}</p>`,
    applyHref ? `<a href="${escapeHtml(applyHref)}">Apply</a>` : '',
  ].join('');

  return {
    slug,
    canonical,
    posting,
    gaps,
    notes: descriptionNotes(description),
    document: {
      documentTitle: documentTitleFor(title, address),
      metaDescription: metaDescriptionFrom(description),
      canonical,
      ogType: 'article',
      jsonLd: posting,
      jsonLdId: 'job-posting-jsonld',
      shellInnerHtml,
    },
  };
}

export function buildJobsIndexStructuredData(jobs: JobRecord[], now = new Date()) {
  const built = jobs.map((job) => buildJobPosting(job, now));
  return {
    '@context': 'https://schema.org/',
    '@graph': [
      {
        '@type': 'ItemList',
        name: 'Open restaurant positions',
        numberOfItems: built.length,
        itemListElement: built.map((job, i) => ({
          '@type': 'ListItem',
          position: i + 1,
          url: job.canonical,
          name: job.posting.title,
        })),
      },
      ...built.map((job) => {
        const { ['@context']: _context, ...rest } = job.posting;
        return rest;
      }),
    ],
  };
}

export function buildJobsIndexDocument(jobs: JobRecord[], now = new Date()): { document: StaticDocument; jobs: BuiltJob[] } {
  const built = jobs.map((job) => buildJobPosting(job, now));
  const items = built
    .map((job) => `<li><a href="${escapeHtml(job.canonical)}">${escapeHtml(String(job.posting.title || job.slug))}</a></li>`)
    .join('');
  return {
    jobs: built,
    document: {
      documentTitle: JOBS_INDEX_TITLE,
      metaDescription: JOBS_INDEX_DESCRIPTION,
      canonical: `${SITE_ORIGIN}/jobs`,
      ogType: 'website',
      jsonLd: buildJobsIndexStructuredData(jobs, now),
      jsonLdId: 'jobs-index-jsonld',
      shellInnerHtml: `<h1>Restaurant Jobs</h1><ul>${items}</ul>`,
    },
  };
}

function replaceOnce(html: string, tag: string, next: string): string {
  return html.replace(tag, () => next);
}

function replaceMetaContent(html: string, attr: 'name' | 'property', key: string, value: string): string {
  const re = new RegExp(`<meta\\b[^>]*\\b${attr}=["']${key}["'][^>]*>`, 'i');
  const match = html.match(re);
  if (!match) throw new Error(`shell missing meta ${attr}=${key}`);
  const tag = match[0];
  if (!/content=["'][^"']*["']/.test(tag)) throw new Error(`meta ${key} has no content`);
  const next = tag.replace(/content=["'][^"']*["']/, `content="${escapeHtml(value)}"`);
  return replaceOnce(html, tag, next);
}

function replaceLinkHref(html: string, rel: string, href: string): string {
  const re = new RegExp(`<link\\b[^>]*\\brel=["']${rel}["'][^>]*>`, 'i');
  const match = html.match(re);
  if (!match) throw new Error(`shell missing link rel=${rel}`);
  const tag = match[0];
  if (!/href=["'][^"']*["']/.test(tag)) throw new Error(`link rel=${rel} has no href`);
  const next = tag.replace(/href=["'][^"']*["']/, `href="${escapeHtml(href)}"`);
  return replaceOnce(html, tag, next);
}

/** Copy of the built SPA shell with this page's title, canonical, and JSON-LD in the raw HTML. */
export function injectJobDocument(html: string, doc: StaticDocument): string {
  if (!/<title>[\s\S]*?<\/title>/i.test(html)) throw new Error('shell missing <title>');
  let out = html.replace(/<title>[\s\S]*?<\/title>/i, () => `<title>${escapeHtml(doc.documentTitle)}</title>`);
  out = replaceMetaContent(out, 'name', 'description', doc.metaDescription);
  out = replaceMetaContent(out, 'property', 'og:title', doc.documentTitle);
  out = replaceMetaContent(out, 'property', 'og:description', doc.metaDescription);
  out = replaceMetaContent(out, 'property', 'og:url', doc.canonical);
  out = replaceMetaContent(out, 'property', 'og:type', doc.ogType);
  out = replaceMetaContent(out, 'name', 'twitter:title', doc.documentTitle);
  out = replaceMetaContent(out, 'name', 'twitter:description', doc.metaDescription);
  out = replaceLinkHref(out, 'canonical', doc.canonical);
  out = out.replace(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi, (block) => {
    if (block.includes('SoftwareApplication') || block.includes('"@graph"')) return '';
    return block;
  });
  const ld = `<script type="application/ld+json" id="${escapeHtml(doc.jsonLdId)}">${safeJsonLd(doc.jsonLd)}</script>`;
  if (!out.includes('</head>')) throw new Error('shell missing </head>');
  out = out.replace('</head>', () => `${ld}\n</head>`);
  if (!/<div id="seo-shell"[^>]*>[\s\S]*?<\/div>/.test(out)) throw new Error('shell missing #seo-shell');
  out = out.replace(
    /<div id="seo-shell"[^>]*>[\s\S]*?<\/div>/,
    () => `<div id="seo-shell" style="position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0">${doc.shellInnerHtml}</div>`,
  );
  if (doc.canonical !== `${SITE_ORIGIN}/` && /<link\b[^>]*rel=["']canonical["'][^>]*href=["']https:\/\/croohq\.com\/?["']/i.test(out)) {
    throw new Error(`homepage canonical still present on ${doc.canonical}`);
  }
  return out;
}

export function renderJobsSitemap(entries: { loc: string; lastmod: string }[]): string {
  const urls = entries
    .map((entry) => `  <url><loc>${escapeHtml(entry.loc)}</loc><lastmod>${escapeHtml(entry.lastmod)}</lastmod><changefreq>daily</changefreq></url>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

export function extractJsonLd(html: string): Record<string, unknown>[] {
  const blocks = html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
  const out: Record<string, unknown>[] = [];
  for (const block of blocks) {
    const data = JSON.parse(block[1]) as unknown;
    const items = Array.isArray(data)
      ? data
      : data && typeof data === 'object' && Array.isArray((data as { '@graph'?: unknown })['@graph'])
        ? ((data as { '@graph': unknown[] })['@graph'])
        : [data];
    for (const item of items) {
      if (item && typeof item === 'object') out.push(item as Record<string, unknown>);
    }
  }
  return out;
}

function isJobPosting(item: Record<string, unknown>): boolean {
  const type = item['@type'];
  return type === 'JobPosting' || (Array.isArray(type) && type.includes('JobPosting'));
}

export function jobPostingsIn(html: string): Record<string, unknown>[] {
  return extractJsonLd(html).filter(isJobPosting);
}

function canonicalTag(html: string): string {
  return html.match(/<link\b[^>]*rel=["']canonical["'][^>]*>/i)?.[0] || '';
}

export function assertJobHtml(html: string, pin: PinnedJob): string[] {
  const canonical = `${SITE_ORIGIN}/jobs/${pin.slug}`;
  const tag = canonicalTag(html);
  if (!tag.includes(canonical)) throw new Error(`${pin.slug}: canonical is ${tag || 'missing'}`);
  if (/href=["']https:\/\/croohq\.com\/?["']/.test(tag)) throw new Error(`${pin.slug}: canonical is the homepage`);
  const titleTag = html.match(/<title>([\s\S]*?)<\/title>/i)?.[1] || '';
  if (titleTag.includes('Restaurant Operations Software')) throw new Error(`${pin.slug}: title is still the homepage title`);
  if (!titleTag.includes(pin.title)) throw new Error(`${pin.slug}: <title> missing ${pin.title}`);
  const descriptionTag = html.match(/<meta\b[^>]*name=["']description["'][^>]*>/i)?.[0] || '';
  if (descriptionTag.includes('Restaurant operations software for multi-unit')) {
    throw new Error(`${pin.slug}: meta description is still the homepage`);
  }
  if (!descriptionTag.toLowerCase().includes(pin.city.toLowerCase())) {
    throw new Error(`${pin.slug}: meta description does not mention ${pin.city}`);
  }
  if (html.includes('SoftwareApplication')) throw new Error(`${pin.slug}: homepage SoftwareApplication schema is still in the raw HTML`);
  if (!html.includes('id="root"')) throw new Error(`${pin.slug}: SPA root is missing, so the visible page would change`);

  const postings = jobPostingsIn(html).filter((item) => item.url === canonical);
  if (postings.length !== 1) throw new Error(`${pin.slug}: expected 1 JobPosting for ${canonical}, found ${postings.length}`);
  const posting = postings[0];
  if (posting.title !== pin.title) throw new Error(`${pin.slug}: JobPosting title is ${String(posting.title)}`);
  if (posting.directApply !== true) throw new Error(`${pin.slug}: directApply is not true`);
  if (posting.employmentType !== pin.employmentType) throw new Error(`${pin.slug}: employmentType is ${String(posting.employmentType)}`);
  if (posting.industry !== 'Food Services') throw new Error(`${pin.slug}: industry is ${String(posting.industry)}`);
  if (posting.occupationalCategory !== pin.occupationalCategory) {
    throw new Error(`${pin.slug}: occupationalCategory is ${String(posting.occupationalCategory)}`);
  }
  if (!posting.datePosted) throw new Error(`${pin.slug}: datePosted missing`);
  if (!posting.validThrough) throw new Error(`${pin.slug}: validThrough missing`);

  const org = (posting.hiringOrganization || {}) as Record<string, unknown>;
  if (org.name !== pin.company) throw new Error(`${pin.slug}: hiringOrganization.name is ${String(org.name)}`);
  if (org.sameAs !== pin.sameAs) throw new Error(`${pin.slug}: hiringOrganization.sameAs is ${String(org.sameAs)}`);
  if (typeof org.logo !== 'string' || !org.logo.startsWith('https://')) {
    throw new Error(`${pin.slug}: hiringOrganization.logo is missing`);
  }

  const place = ((posting.jobLocation || {}) as { address?: Record<string, unknown> }).address || {};
  if (!String(place.streetAddress || '').trim()) throw new Error(`${pin.slug}: streetAddress missing`);
  if (place.addressLocality !== pin.city) throw new Error(`${pin.slug}: addressLocality is ${String(place.addressLocality)}`);
  if (place.addressRegion !== pin.region) throw new Error(`${pin.slug}: addressRegion is ${String(place.addressRegion)}`);
  if (!/^\d{5}(?:-\d{4})?$/.test(String(place.postalCode || ''))) throw new Error(`${pin.slug}: postalCode is ${String(place.postalCode)}`);
  if (place.addressCountry !== 'US') throw new Error(`${pin.slug}: addressCountry is ${String(place.addressCountry)}`);

  if (pin.requireSalary) {
    const salary = posting.baseSalary as { currency?: string; value?: { minValue?: number; maxValue?: number; unitText?: string } } | undefined;
    if (!salary || salary.currency !== 'USD') throw new Error(`${pin.slug}: baseSalary missing`);
    const value = salary.value || {};
    if (typeof value.minValue !== 'number' || typeof value.maxValue !== 'number') throw new Error(`${pin.slug}: baseSalary has no numeric range`);
    if (value.unitText !== 'HOUR' && value.unitText !== 'YEAR') throw new Error(`${pin.slug}: baseSalary unit is ${String(value.unitText)}`);
  }

  const text = String(posting.description || '').toLowerCase();
  for (const word of pin.descriptionMustInclude) {
    if (!text.includes(word)) throw new Error(`${pin.slug}: description does not mention ${word}`);
  }
  return pin.descriptionFlagIfMissing.filter((word) => !text.includes(word)).map((word) => `${pin.slug}: description does not contain "${word}"`);
}

export function assertJobsIndexHtml(html: string, pins: PinnedJob[] = PINNED_PUBLIC_JOBS): void {
  const tag = canonicalTag(html);
  if (!/href=["']https:\/\/croohq\.com\/jobs["']/.test(tag)) {
    throw new Error(`/jobs: canonical is ${tag || 'missing'}`);
  }
  const titleTag = html.match(/<title>([\s\S]*?)<\/title>/i)?.[1] || '';
  if (!titleTag.includes('Restaurant Jobs')) throw new Error(`/jobs: title is ${titleTag}`);
  if (html.includes('SoftwareApplication')) throw new Error('/jobs: homepage SoftwareApplication schema is still in the raw HTML');
  const postings = jobPostingsIn(html);
  for (const pin of pins) {
    const canonical = `${SITE_ORIGIN}/jobs/${pin.slug}`;
    const found = postings.find((item) => item.url === canonical);
    if (!found) throw new Error(`/jobs: missing JobPosting for ${pin.slug}`);
    if (found.title !== pin.title) throw new Error(`/jobs: ${pin.slug} title is ${String(found.title)}`);
    const place = ((found.jobLocation || {}) as { address?: Record<string, unknown> }).address || {};
    if (place.addressLocality !== pin.city) throw new Error(`/jobs: ${pin.slug} locality is ${String(place.addressLocality)}`);
  }
}

export function assertHomepageShell(html: string): void {
  const tag = canonicalTag(html);
  if (!/href=["']https:\/\/croohq\.com\/["']/.test(tag)) throw new Error('homepage canonical was removed from the SPA shell');
  if (!html.includes('SoftwareApplication')) throw new Error('homepage SoftwareApplication schema was removed');
  if (html.includes('JobPosting')) throw new Error('homepage shell should not carry a JobPosting');
}
