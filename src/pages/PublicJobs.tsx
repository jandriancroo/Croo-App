import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Link } from 'react-router-dom';
import { MapPin, DollarSign, Clock, Briefcase, Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { useState, useEffect } from 'react';
import { Helmet } from 'react-helmet-async';
import crooLogo from '@/assets/croo-logo.webp';

interface JobListing {
  id: string;
  title: string;
  description: string | null;
  employment_type: string;
  pay_min: number | null;
  pay_max: number | null;
  pay_type: string;
  posted_at: string;
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

function parseCity(address: string | null): string {
  if (!address) return '';
  const parts = address.split(',').map(s => s.trim());
  if (parts.length >= 3) return parts[parts.length - 2];
  if (parts.length === 2) return parts[0];
  return '';
}

function parseStateZip(address: string | null): string {
  if (!address) return '';
  const parts = address.split(',').map(s => s.trim());
  const last = parts[parts.length - 1];
  return last || '';
}

export default function PublicJobs() {
  const [search, setSearch] = useState('');

  const { data: listings, isLoading } = useQuery({
    queryKey: ['public-job-listings'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('job_listings')
        .select(`
          id, title, description, employment_type, pay_min, pay_max, pay_type, posted_at,
          location:locations(id, name, address),
          organization:organizations(id, name, slug, brand_name)
        `)
        .eq('status', 'active')
        .eq('syndication_enabled', true)
        .lte('posted_at', new Date().toISOString())
        .order('posted_at', { ascending: false });
      if (error) throw error;
      return (data || []).filter((l: any) => !l.expires_at || l.expires_at > new Date().toISOString()) as JobListing[];
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

  // JSON-LD for all listings
  const jsonLd = filtered.map(job => {
    const addr = job.location?.address || '';
    const parts = addr.split(',').map(s => s.trim());
    const city = parts.length >= 3 ? parts[parts.length - 2] : '';
    const lastPart = parts[parts.length - 1] || '';
    const stateMatch = lastPart.match(/^([A-Za-z\s]+?)\s+(\d{5})/);
    const state = stateMatch ? stateMatch[1] : lastPart;
    const zip = stateMatch ? stateMatch[2] : '';
    const company = job.organization?.brand_name || job.organization?.name || '';

    const posting: any = {
      '@context': 'https://schema.org/',
      '@type': 'JobPosting',
      title: job.title,
      description: job.description || job.title,
      datePosted: job.posted_at?.split('T')[0],
      employmentType: job.employment_type === 'full_time' ? 'FULL_TIME' : job.employment_type === 'part_time' ? 'PART_TIME' : 'FULL_TIME',
      hiringOrganization: { '@type': 'Organization', name: company },
      jobLocation: {
        '@type': 'Place',
        address: {
          '@type': 'PostalAddress',
          streetAddress: parts[0] || '',
          addressLocality: city,
          addressRegion: state,
          postalCode: zip,
          addressCountry: 'US',
        },
      },
      directApply: true,
      url: `https://croohq.lovable.app/apply/${job.organization?.slug}?utm_source=google_jobs&listing=${job.id}`,
    };

    if (job.pay_min) {
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
  });

  return (
    <>
      <Helmet>
        <title>Restaurant Jobs Near You | CrooHQ</title>
        <meta name="description" content="Find restaurant jobs near you — Team Members, Shift Managers, and more. Apply instantly through CrooHQ." />
        <link rel="canonical" href="https://croohq.lovable.app/jobs" />
        {jsonLd.length > 0 && (
          <script type="application/ld+json">
            {JSON.stringify(jsonLd)}
          </script>
        )}
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
