// Shared syndication logging for the public SSR job surfaces
// (job-detail = /jobs/<slug>, jobs-index = /jobs).
// Pure logging: records that crawler-ready HTML was served. No email, no side effects.

export async function logSyndicationServed(
  supabase: any,
  rows: Array<{ jobListingId: string; feedUrl: string; boardName?: string }>,
): Promise<void> {
  if (!rows.length) return;
  const nowIso = new Date().toISOString();
  const payload = rows.map((r) => ({
    job_listing_id: r.jobListingId,
    board_name: r.boardName || "google_jobs_ssr",
    status: "served",
    feed_url: r.feedUrl,
    last_crawled_at: nowIso,
    error_message: null,
    updated_at: nowIso,
  }));

  const { error } = await supabase
    .from("job_syndication_logs")
    .upsert(payload, { onConflict: "job_listing_id,board_name" });

  if (error) {
    // Never fail the crawler response because logging failed.
    console.error("job_syndication_logs upsert failed:", error.message);
  }
}
