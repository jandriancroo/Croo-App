-- Public testimonials collected at /review.
-- Anon and authenticated users may INSERT a consented row only.
-- They cannot SELECT, UPDATE, or DELETE the table, so raw answers and the
-- names of anonymous reviewers never come back through the API.
-- Public display goes through list_public_customer_reviews (text + attribution
-- of status = 'approved' only). New rows stay pending until the table owner
-- approves one:
--   update public.customer_reviews set status = 'approved' where id = '...';
-- Hide one later the same way:
--   update public.customer_reviews set status = 'hidden' where id = '...';

create table public.customer_reviews (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text not null,
  role text not null,
  restaurant text not null,
  anonymous boolean not null default false,
  display_attribution text not null,
  raw_answers jsonb not null,
  final_text text not null,
  consent boolean not null,
  consent_at timestamptz,
  status text not null default 'pending',
  constraint customer_reviews_name_len check (char_length(btrim(name)) between 1 and 120),
  constraint customer_reviews_role_len check (char_length(btrim(role)) between 1 and 80),
  constraint customer_reviews_restaurant_len check (char_length(btrim(restaurant)) between 1 and 160),
  constraint customer_reviews_attribution_len check (char_length(display_attribution) between 1 and 240),
  constraint customer_reviews_text_len check (char_length(btrim(final_text)) between 1 and 1200),
  constraint customer_reviews_consent_true check (consent is true),
  constraint customer_reviews_status check (status in ('pending', 'approved', 'hidden')),
  constraint customer_reviews_answers_object check (jsonb_typeof(raw_answers) = 'object'),
  constraint customer_reviews_answers_size check (octet_length(raw_answers::text) <= 8000)
);

comment on table public.customer_reviews is
  'Customer testimonials from /review. Insert-only for anon; new rows stay pending. Read approved quotes through list_public_customer_reviews. Approve with update public.customer_reviews set status = ''approved'' where id = ''...''; hide with status = ''hidden''.';

create index customer_reviews_approved_created_at
  on public.customer_reviews (created_at desc)
  where status = 'approved';

-- Brand spellings customers actually type, plus a short POS-vendor and
-- "rip and replace" scrub so a direct insert cannot publish those phrases.
create function public.customer_review_public_text(_text text)
returns text
language sql
immutable
set search_path = public
as $$
  select btrim(
    regexp_replace(
      regexp_replace(
        regexp_replace(
          regexp_replace(
            coalesce(_text, ''),
            '\m(crew\s*hq|croo\s*hq|qhq|croohq)\M',
            'CrooHQ',
            'gi'
          ),
          '\m(toast|clover|aloha|revel|qubeyond|heartland|spoton|touchbistro|touch\s+bistro|lightspeed|micros|brink)\M',
          'our old system',
          'gi'
        ),
        '\mrip[\s-]+and[\s-]+replace\M',
        '',
        'gi'
      ),
      '[[:space:]]+',
      ' ',
      'g'
    )
  );
$$;

create function public.customer_review_attribution(
  _anonymous boolean,
  _name text,
  _role text,
  _restaurant text,
  _answers jsonb
)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  _type text := nullif(btrim(coalesce(_answers->>'restaurantType', '')), '');
  _state text := nullif(btrim(coalesce(_answers->>'state', '')), '');
  _line text;
begin
  if coalesce(_anonymous, false) then
    if _type is null or _state is null then
      raise exception 'anonymous reviews need a restaurant type and state';
    end if;
    if char_length(_type) > 80 or char_length(_state) > 40 then
      raise exception 'restaurant type or state is too long';
    end if;
    _line := _role || ', ' || _type || ', ' || _state;
  else
    _line := _name || ', ' || _role || ', ' || _restaurant;
  end if;
  if char_length(_line) > 240 then
    raise exception 'attribution is too long';
  end if;
  return _line;
end;
$$;

create function public.customer_reviews_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
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
  new.status := 'pending';
  new.consent_at := now();
  new.display_attribution := public.customer_review_attribution(
    new.anonymous, new.name, new.role, new.restaurant, new.raw_answers
  );
  return new;
end;
$$;

create trigger customer_reviews_before_insert
  before insert on public.customer_reviews
  for each row execute function public.customer_reviews_before_insert();

create function public.list_public_customer_reviews()
returns table (
  id uuid,
  created_at timestamptz,
  quote text,
  attribution text
)
language sql
stable
security definer
set search_path = public
as $$
  select r.id, r.created_at, r.final_text, r.display_attribution
  from public.customer_reviews r
  where r.status = 'approved'
  order by r.created_at desc
  limit 12;
$$;

comment on function public.list_public_customer_reviews() is
  'Public read of approved testimonials: quote and attribution only. Raw answers and anonymous reviewers'' names stay on the table.';

revoke all on function public.customer_review_public_text(text) from public, anon, authenticated;
revoke all on function public.customer_review_attribution(boolean, text, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.customer_reviews_before_insert() from public, anon, authenticated;
revoke all on function public.list_public_customer_reviews() from public, anon, authenticated;
grant execute on function public.list_public_customer_reviews() to anon, authenticated, service_role;

alter table public.customer_reviews enable row level security;

revoke all on table public.customer_reviews from public, anon, authenticated;
grant insert on table public.customer_reviews to anon, authenticated;
grant all on table public.customer_reviews to service_role;

create policy customer_reviews_insert_with_consent
  on public.customer_reviews
  for insert
  to anon, authenticated
  with check (consent is true);
