import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Link } from 'react-router-dom';
import { MapPin, DollarSign, Clock, Briefcase, Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { useState } from 'react';
import crooLogo from '@/assets/croo-logo.webp';
import { Helmet } from 'react-helmet-async';

interface JobListing {
  id: string;
  title: string;
  description: string | null;
  employment_type: string;
  pay_min: number | null;
  pay_max: number | null;
  pay_type: string;
  posted_at: string;
  expires_at: string | null;
  location: { id: string; name: string; address: string } | null;
  organization: { id: string; name: string; slug: string; brand_name: string | null } | null;
}

const EMPLOYMENT_LABELS: Record<string, string> = {
  full_time: 'Full Time',
  part_time: 'Part Time',
  contract: 'Contract',
  temporary: 'Temporary',
  seasonal: 'Seasonal',
  intern: 'Intern',
};

const EMPLOYMENT_MAP: Record<string, string> = {
  full_time: 'FULL_TIME',
  part_time: 'PART_TIME',
  contract: 'CONTRACTOR',
  temporary: 'TEMPORARY',
  intern: 'INTERN',
  seasonal: 'TEMPORARY',
};

function parseAddress(address: string | null) {
  if (!address) return { street: '', city: '', state: '', zip: '' };
  const parts = address.split(',').map(s => s.trim());
  if (parts.length >= 2) {
    const lastPart = parts[parts.length - 1];
    const match = lastPart.match(/^([A-Za-z\s]+?)\s+(\d{5}(?:-\d{4})?)$/);
    if (match) {
      const city = parts.length >= 3 ? parts[parts.length - 2] : '';
      return { street: parts[0], city, state: match[1].trim(), zip: match[2] };
    }
    return { street: parts[0], city: parts.length >= 3 ? parts[1] : '', state: lastPart, zip: '' };
  }
  return { street: address, city: '', state: '', zip: '' };
}

function parseCity(address: string | null): string {
  return parseAddress(address).city;
}

function parseStateZip(address: string | null): string {
  if (!address) return '';
  const parts = address.split(',').map(s => s.trim());
  return parts[parts.length - 1] || '';
}

function mapOccupationalCategory(titleLower: string): string {
  if (titleLower.includes('manager') || titleLower.includes('supervisor') || titleLower.includes('lead')) return '11-9051.00';
  if (titleLower.includes('cook') || titleLower.includes('chef')) return '35-2014.00';
  if (titleLower.includes('cashier')) return '41-2011.00';
  return '35-3023.00';
}

function buildSyndicationTitle(title: string, company: string, city: string): string {
  const lower = title.toLowerCase();
  if (lower === 'team member' || lower === 'crew member') return `Pizza Team Member – ${company}${city ? `, ${city}` : ''}`;
  if (lower === 'shift manager' || lower === 'shift lead') return `Shift Manager – ${company} Restaurant${city ? `, ${city}` : ''}`;
  if (!lower.includes(company.toLowerCase())) return `${title} – ${company}`;
  return title;
}

function buildJobPostingJsonLd(job: JobListing) {
  const addr = parseAddress(job.location?.address || null);
  const company = job.organization?.brand_name || job.organization?.name || 'Company';
  const titleLower = (job.title || '').toLowerCase();
  const syndicationTitle = buildSyndicationTitle(job.title, company, addr.city);
  const validThrough = job.expires_at
    ? job.expires_at.split('T')[0]
    : new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0];

  const posting: any = {
    '@context': 'https://schema.org/',
    '@type': 'JobPosting',
    title: syndicationTitle,
    description: job.description || job.title,
    datePosted: job.posted_at?.split('T')[0],
    validThrough,
    employmentType: EMPLOYMENT_MAP[job.employment_type] || 'FULL_TIME',
    occupationalCategory: mapOccupationalCategory(titleLower),
    industry: 'Food Services',
    identifier: { '@type': 'PropertyValue', name: company, value: job.id },
    hiringOrganization: {
      '@type': 'Organization',
      name: company,
      sameAs: `https://croohq.com/apply/${job.organization?.slug}`,
    },
    jobLocation: {
      '@type': 'Place',
      address: {
        '@type': 'PostalAddress',
        streetAddress: addr.street,
        addressLocality: addr.city,
        addressRegion: addr.state,
        postalCode: addr.zip,
        addressCountry: 'US',
      },
    },
    directApply: true,
    url: `https://croohq.com/apply/${job.organization?.slug}?utm_source=google_jobs&listing=${job.id}`,
  };

  if (job.pay_min || job.pay_max) {
    posting.baseSalary = {
      '@type': 'MonetaryAmount',
      currency: 'USD',
      value: {
        '@type': 'QuantitativeValue',
        minValue: job.pay_min,
        maxValue: job.pay_max || job.pay_min,
        unitText: job.pay_type === 'salary' ? 'YEAR' : 'HOUR',
      },
    };
  }

  return posting;
}

export default function PublicJobs() {
  const [search, setSearch] = useState('');

  const { data: listings, isLoading } = useQuery({
    queryKey: ['public-job-listings'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('job_listings')
        .select(`
          id, title, description, employment_type, pay_min, pay_max, pay_type, posted_at, expires_at,
          location:locations(id, name, address),
          organization:organizations(id, name, slug, brand_name)
        `)
        .eq('status', 'active')
        .eq('syndication_enabled', true)
        .lte('posted_at', new Date().toISOString())
        .order('posted_at', { ascending: false });
      if (error) throw error;
      const now = new Date().toISOString();
      return (data || []).filter((l: any) => !l.expires_at || l.expires_at > now) as JobListing[];
    },
  });

  const filtered = (listings || []).filter(job => {
    if (!search) return true;
    const q = search.toLowerCase();
    const company = job.organization?.brand_name || job.organization?.name || '';
    const city = parseCity(job.location?.address || null);
    return (
      job.title.toLowerCase().includes(q) ||
      company.toLowerCase().includes(q) ||
      city.toLowerCase().includes(q) ||
      (job.location?.name || '').toLowerCase().includes(q)
    );
  });

  const jsonLdItems = (listings || []).map(buildJobPostingJsonLd);

  return (
    <>
      <Helmet>
        <title>Restaurant Jobs Near You | CrooHQ — Pizza, Fast Food & Food Service Careers</title>
        <meta name="description" content="Find restaurant and fast food jobs at Blaze Pizza and other brands. Apply for pizza maker, team member, shift manager, cook, and kitchen crew positions near you — no account needed." />
        <meta name="keywords" content="pizza jobs, fast food jobs, restaurant jobs, team member jobs, shift manager jobs, kitchen crew, food service careers, Blaze Pizza hiring, cook jobs near me, cashier restaurant jobs" />
        <link rel="canonical" href="https://croohq.com/jobs" />
        {jsonLdItems.map((item, i) => (
          <script key={i} type="application/ld+json">
            {JSON.stringify(item)}
          </script>
        ))}
      </Helmet>

      <div className="min-h-screen bg-[#f5f4f1]">
        {/* Header */}
        <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
          <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <img src={crooLogo} alt="CrooHQ" className="h-8 w-8 rounded-lg" />
              <div>
                <h1 className="text-lg font-bold text-gray-900">Restaurant Jobs</h1>
                <p className="text-xs text-gray-500">Powered by CrooHQ</p>
              </div>
            </div>
          </div>
        </header>

        {/* Search */}
        <div className="max-w-4xl mx-auto px-4 py-6">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <Input
              placeholder="Search by title, company, or city..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10 bg-white border-gray-200 h-12 text-base rounded-xl shadow-sm"
            />
          </div>
        </div>

        {/* Job Cards */}
        <div className="max-w-4xl mx-auto px-4 pb-12">
          {isLoading ? (
            <div className="text-center py-16 text-gray-500">Loading jobs...</div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-16">
              <Briefcase className="h-12 w-12 text-gray-300 mx-auto mb-3" />
              <p className="text-gray-500">No open positions found</p>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-gray-500 mb-2">{filtered.length} open position{filtered.length !== 1 ? 's' : ''}</p>
              {filtered.map(job => {
                const company = job.organization?.brand_name || job.organization?.name || 'Company';
                const city = parseCity(job.location?.address || null);
                const stateZip = parseStateZip(job.location?.address || null);
                const payStr = job.pay_min
                  ? `$${job.pay_min}${job.pay_max && job.pay_max !== job.pay_min ? `-$${job.pay_max}` : ''}/${job.pay_type === 'salary' ? 'yr' : 'hr'}`
                  : null;
                const daysAgo = Math.floor((Date.now() - new Date(job.posted_at).getTime()) / 86400000);
                const postedLabel = daysAgo === 0 ? 'Today' : daysAgo === 1 ? '1 day ago' : `${daysAgo} days ago`;

                return (
                  <Link
                    key={job.id}
                    to={`/apply/${job.organization?.slug}?utm_source=jobs_page&listing=${job.id}`}
                    className="block bg-white rounded-xl border border-gray-200 p-5 hover:shadow-md hover:border-gray-300 transition-all"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <h2 className="text-base font-semibold text-gray-900 truncate">{job.title}</h2>
                        <p className="text-sm text-teal-700 font-medium mt-0.5">{company}</p>
                        <div className="flex flex-wrap items-center gap-3 mt-2 text-xs text-gray-500">
                          {city && (
                            <span className="flex items-center gap-1">
                              <MapPin className="h-3.5 w-3.5" />
                              {city}, {stateZip}
                            </span>
                          )}
                          {payStr && (
                            <span className="flex items-center gap-1">
                              <DollarSign className="h-3.5 w-3.5" />
                              {payStr}
                            </span>
                          )}
                          <span className="flex items-center gap-1">
                            <Clock className="h-3.5 w-3.5" />
                            {EMPLOYMENT_LABELS[job.employment_type] || job.employment_type}
                          </span>
                        </div>
                      </div>
                      <span className="text-xs text-gray-400 whitespace-nowrap mt-1">{postedLabel}</span>
                    </div>
                    {job.description && (
                      <p className="text-xs text-gray-500 mt-3 line-clamp-2">{job.description}</p>
                    )}
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
