-- Restore next_customer_review_question_set() rotation after
-- write-customer-review was redeployed with Set B draft support.
-- Reverses 20261113211000_pin_review_question_set_to_a.sql.

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
