import { useQuery } from '@tanstack/react-query';
import { useParams, Link, Navigate } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { safeJsonLd, buildJobPosting, parseJobAddress } from '@/lib/jobSeo';
import { supabase } from '@/integrations/supabase/client';
import { MapPin, DollarSign, Clock, ArrowLeft, Loader2 } from 'lucide-react';
import crooLogo from '@/assets/croo-logo-square.png';

const EMPLOYMENT_LABEL: Record<string, string> = {
  full_time: 'Full Time',
  part_time: 'Part Time',
  contract: 'Contract',
  temporary: 'Temporary',
  seasonal: 'Seasonal',
  intern: 'Intern',
};
export default function JobDetail() {
  const { slug } = useParams<{ slug: string }>();
  const idMatch = slug?.match(/([0-9a-f]{8})$/i);
  const idPrefix = idMatch?.[1];

  const { data: job, isLoading, error } = useQuery({
    queryKey: ['job-detail', idPrefix],
    enabled: !!idPrefix,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('job_listings')
        .select(`
          id, title, description, employment_type, pay_min, pay_max, pay_type, posted_at, expires_at, status, syndication_enabled,
          location:locations(id, name, address),
          organization:organizations(id, name, slug, brand_name, logo_url)
        `)
        .eq('status', 'active')
        .eq('syndication_enabled', true);
      if (error) throw error;
      const found = (data || []).find((l: any) => (l.id || '').toLowerCase().startsWith(idPrefix!.toLowerCase()));
      return (found || null) as any;
    },
  });

  if (!idPrefix) return <Navigate to="/jobs" replace />;

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#f5f4f1] flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-teal-700" />
      </div>
    );
  }

  if (error || !job) {
    return (
      <div className="min-h-screen bg-[#f5f4f1] flex flex-col items-center justify-center p-6 text-center">
        <Helmet>
          <title>Job no longer available | CrooHQ Jobs</title>
          <meta name="robots" content="noindex" />
        </Helmet>
        <h1 className="text-2xl font-semibold text-gray-900 mb-2">Job not found</h1>
        <p className="text-gray-500 mb-6">This listing is no longer available.</p>
        <Link to="/jobs" className="text-teal-700 font-medium">Browse open positions →</Link>
      </div>
    );
  }

  const built = buildJobPosting(job);
  const addr = parseJobAddress(job.location?.address || null);
  const company = job.organization?.brand_name || job.organization?.name || 'Company';
  const empLabel = EMPLOYMENT_LABEL[job.employment_type] || 'Full Time';
  const payStr = job.pay_min
    ? `$${job.pay_min}${job.pay_max && job.pay_max !== job.pay_min ? `–$${job.pay_max}` : ''}/${job.pay_type === 'salary' ? 'yr' : 'hr'}`
    : '';
  const applyUrl = `/apply/${job.organization?.slug}?utm_source=job_detail&listing=${job.id}`;
  const documentTitle = built.document.documentTitle;
  const metaDescription = built.document.metaDescription;
  const canonical = built.canonical;
  const jsonLd = built.posting;

  const paragraphs = (job.description || '').split(/\n{2,}/).map((p: string) => p.trim()).filter(Boolean);

  return (
    <>
      <Helmet>
        <title>{documentTitle}</title>
        <meta name="description" content={metaDescription} />
        <link rel="canonical" href={canonical} />
        <meta property="og:title" content={documentTitle} />
        <meta property="og:description" content={metaDescription} />
        <meta property="og:type" content="article" />
        <meta property="og:url" content={canonical} />
        <script type="application/ld+json">{safeJsonLd(jsonLd)}</script>
      </Helmet>
      <div className="min-h-screen bg-[#f5f4f1]">
        <header className="bg-white border-b border-gray-200">
          <div className="max-w-3xl mx-auto px-4 py-4 flex items-center gap-3">
            <Link to="/jobs" className="flex items-center gap-2 text-gray-600 hover:text-gray-900">
              <ArrowLeft className="h-4 w-4" />
              <span className="text-sm">All jobs</span>
            </Link>
            <div className="ml-auto flex items-center gap-2">
              <img src={crooLogo} alt="CrooHQ" className="h-7 w-7 rounded" />
              <span className="text-xs text-gray-500">Powered by CrooHQ</span>
            </div>
          </div>
        </header>

        <main className="max-w-3xl mx-auto px-4 py-8">
          <article>
            <h1 className="text-3xl font-bold text-gray-900 mb-1">{job.title}</h1>
            <p className="text-teal-700 font-semibold mb-4">{company}</p>
            <div className="flex flex-wrap gap-3 text-sm text-gray-600 mb-6">
              {addr.city && (
                <span className="bg-white border border-gray-200 rounded-full px-3 py-1.5 flex items-center gap-1.5">
                  <MapPin className="h-3.5 w-3.5" /> {addr.city}{addr.state ? `, ${addr.state}` : ''}{addr.zip ? ` ${addr.zip}` : ''}
                </span>
              )}
              {payStr && (
                <span className="bg-white border border-gray-200 rounded-full px-3 py-1.5 flex items-center gap-1.5">
                  <DollarSign className="h-3.5 w-3.5" /> {payStr}
                </span>
              )}
              <span className="bg-white border border-gray-200 rounded-full px-3 py-1.5 flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5" /> {empLabel}
              </span>
            </div>

            <Link
              to={applyUrl}
              className="inline-block bg-teal-700 hover:bg-teal-800 text-white font-semibold rounded-xl px-6 py-3 mb-8 transition-colors"
            >
              Apply for this position →
            </Link>

            <section className="bg-white rounded-xl border border-gray-200 p-6 space-y-4" aria-label="Job description">
              {paragraphs.length > 0 ? (
                paragraphs.map((p: string, i: number) => (
                  <p key={i} className="text-gray-700 leading-relaxed whitespace-pre-line">{p}</p>
                ))
              ) : (
                <p className="text-gray-700">{job.title} at {company}.</p>
              )}
            </section>

            <div className="mt-8">
              <Link
                to={applyUrl}
                className="inline-block bg-teal-700 hover:bg-teal-800 text-white font-semibold rounded-xl px-6 py-3 transition-colors"
              >
                Apply now →
              </Link>
            </div>

            <p className="text-xs text-gray-500 text-center mt-10">
              Posted {job.posted_at?.split('T')[0]} ·{' '}
              <Link to="/jobs" className="text-teal-700">Browse all open positions</Link>
            </p>
          </article>
        </main>
      </div>
    </>
  );
}
