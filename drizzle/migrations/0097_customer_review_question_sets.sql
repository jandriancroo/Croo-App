-- Second question set for /review, plus a near-match flag for Jordan's notice.
-- question_set is A or B. next_customer_review_question_set() returns the opposite
-- of the latest saved row (A when the table is empty) and never returns review text.
-- Anon may execute that RPC only. Near-match comparison runs inside the existing
-- SECURITY DEFINER insert trigger with pg_trgm, so anon cannot read other rows.
-- Flagged reviews stay pending. The notice email leads with a heads-up when flagged.

create extension if not exists pg_trgm with schema public;

alter table public.customer_reviews
  add column if not exists question_set text not null default 'A',
  add column if not exists near_match boolean not null default false,
  add column if not exists near_match_review_id uuid,
  add column if not exists near_match_score numeric;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'customer_reviews_question_set_check'
      and conrelid = 'public.customer_reviews'::regclass
  ) then
    alter table public.customer_reviews
      add constraint customer_reviews_question_set_check
      check (question_set in ('A', 'B'));
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'customer_reviews_near_match_review_id_fkey'
      and conrelid = 'public.customer_reviews'::regclass
  ) then
    alter table public.customer_reviews
      add constraint customer_reviews_near_match_review_id_fkey
      foreign key (near_match_review_id)
      references public.customer_reviews(id)
      on delete set null;
  end if;
end
$$;

comment on column public.customer_reviews.question_set is
  'Which /review question group the customer answered: A or B.';
comment on column public.customer_reviews.near_match is
  'True when final_text is at least 0.6 similar (pg_trgm) to an earlier review.';
comment on column public.customer_reviews.near_match_review_id is
  'The earlier review this row most closely matches, when near_match is true.';
comment on column public.customer_reviews.near_match_score is
  'pg_trgm similarity to near_match_review_id, when near_match is true.';

create index if not exists customer_reviews_final_text_trgm
  on public.customer_reviews using gin (final_text public.gin_trgm_ops);

create or replace function public.next_customer_review_question_set()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when (
      select r.question_set
      from public.customer_reviews r
      order by r.created_at desc
      limit 1
    ) = 'A' then 'B'
    else 'A'
  end;
$$;

comment on function public.next_customer_review_question_set() is
  'Returns A or B only: the opposite of the latest customer_reviews.question_set, or A when none exist. No review text.';

create or replace function public.customer_reviews_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  _match_id uuid;
  _match_score real;
begin
  if new.consent is not true then
    raise exception 'consent required';
  end if;
  if (
    select count(*)
    from public.customer_reviews
    where created_at > now() - interval '1 hour'
  ) >= 50 then
    raise exception 'too many reviews this hour';
  end if;
  new.id := gen_random_uuid();
  new.created_at := now();
  new.name := btrim(new.name);
  new.role := btrim(new.role);
  new.restaurant := btrim(new.restaurant);
  new.anonymous := coalesce(new.anonymous, false);
  new.raw_answers := coalesce(new.raw_answers, '{}'::jsonb);
  new.final_text := public.customer_review_public_text(new.final_text);
  if new.final_text is null or new.final_text = '' then
    raise exception 'review text required';
  end if;
  new.question_set := upper(btrim(coalesce(new.question_set, 'A')));
  if new.question_set not in ('A', 'B') then
    new.question_set := 'A';
  end if;
  new.status := 'pending';
  new.consent_at := now();
  new.display_attribution := public.customer_review_attribution(
    new.anonymous, new.name, new.role, new.restaurant, new.raw_answers
  );

  _match_id := null;
  _match_score := null;
  select r.id, similarity(r.final_text, new.final_text)
    into _match_id, _match_score
  from public.customer_reviews r
  where r.id is distinct from new.id
    and r.final_text is not null
    and btrim(r.final_text) <> ''
  order by similarity(r.final_text, new.final_text) desc
  limit 1;

  if _match_id is not null and _match_score >= 0.6 then
    new.near_match := true;
    new.near_match_review_id := _match_id;
    new.near_match_score := _match_score;
  else
    new.near_match := false;
    new.near_match_review_id := null;
    new.near_match_score := null;
  end if;

  return new;
end;
$$;

create or replace function public.customer_reviews_notify_pending()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  _match_name text;
  _score text;
  _heads_up text := '';
begin
  if new.near_match is true and new.near_match_review_id is not null then
    select r.name into _match_name
    from public.customer_reviews r
    where r.id = new.near_match_review_id;
    _score := trim(to_char(coalesce(new.near_match_score, 0)::numeric, 'FM0.00'));
    if _match_name is not null and btrim(_match_name) <> '' then
      _heads_up :=
        '<p style="margin:0 0 16px;padding:12px 16px;border-left:4px solid #b45309;background:#fff7ed">'
        || '<b>Heads up: this reads very close to '
        || public.customer_review_html_escape(_match_name)
        || '''s review (score '
        || public.customer_review_html_escape(_score)
        || ')</b></p>';
    else
      _heads_up :=
        '<p style="margin:0 0 16px;padding:12px 16px;border-left:4px solid #b45309;background:#fff7ed">'
        || '<b>Heads up: this reads very close to an earlier review (score '
        || public.customer_review_html_escape(_score)
        || ')</b></p>';
    end if;
  end if;

  begin
    insert into public.email_queue (from_address, to_addresses, subject, html, source, dedup_key, metadata)
    values (
      'CrooHQ <hello@croohq.email>',
      array['jordan@croohq.com'],
      'New customer review waiting for approval',
      '<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#111">'
        || _heads_up
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
      jsonb_build_object(
        'customer_review_id', new.id,
        'near_match', coalesce(new.near_match, false)
      )
    );
  exception when others then
    -- Never lose a customer's review because the notice failed.
    raise warning 'customer review notice failed for %: %', new.id, sqlerrm;
  end;
  return new;
end;
$$;

revoke all on function public.next_customer_review_question_set() from public, anon, authenticated;
revoke all on function public.customer_reviews_before_insert() from public, anon, authenticated;
revoke all on function public.customer_reviews_notify_pending() from public, anon, authenticated;
grant execute on function public.next_customer_review_question_set() to anon, authenticated, service_role;
