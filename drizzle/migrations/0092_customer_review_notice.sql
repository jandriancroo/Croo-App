-- Email Jordan when a new customer review is waiting for approval.
-- An AFTER INSERT trigger queues one row in public.email_queue
-- (sent by email-queue-sender every minute). Customer text is HTML-escaped.
-- The 50-per-hour cap in customer_reviews_before_insert still runs first, so
-- this can queue at most 50 notices an hour. Anon still has INSERT only on
-- customer_reviews and no access to email_queue.

create function public.customer_review_html_escape(_text text)
returns text
language sql
immutable
set search_path = public
as $$
  select replace(
    replace(
      replace(
        replace(
          replace(
            replace(coalesce(_text, ''), '&', '&amp;'),
            '<', '&lt;'),
          '>', '&gt;'),
        '"', '&quot;'),
      '''', '&#39;'),
    E'\n', '<br>');
$$;

create function public.customer_reviews_notify_pending()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    insert into public.email_queue (from_address, to_addresses, subject, html, source, dedup_key, metadata)
    values (
      'CrooHQ <hello@croohq.email>',
      array['jordan@croohq.com'],
      'New customer review waiting for approval',
      '<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#111">'
        || '<p>A new customer review is waiting for approval.</p>'
        || '<blockquote style="margin:16px 0;padding:12px 16px;border-left:4px solid #f15a24;background:#f7f7f7">'
        || public.customer_review_html_escape(new.final_text)
        || '</blockquote>'
        || '<p><b>Attribution:</b> ' || public.customer_review_html_escape(new.display_attribution) || '</p>'
        || '<p><b>Review id:</b> ' || public.customer_review_html_escape(new.id::text) || '</p>'
        || '<p>Reply to Ryan to approve.</p>'
        || '</div>',
      'customer_review_pending',
      'customer_review_pending_' || new.id::text,
      jsonb_build_object('customer_review_id', new.id)
    );
  exception when others then
    -- Never lose a customer's review because the notice failed.
    raise warning 'customer review notice failed for %: %', new.id, sqlerrm;
  end;
  return new;
end;
$$;

revoke all on function public.customer_review_html_escape(text) from public, anon, authenticated;
revoke all on function public.customer_reviews_notify_pending() from public, anon, authenticated;

create trigger customer_reviews_notify_pending
  after insert on public.customer_reviews
  for each row
  when (new.status = 'pending')
  execute function public.customer_reviews_notify_pending();
