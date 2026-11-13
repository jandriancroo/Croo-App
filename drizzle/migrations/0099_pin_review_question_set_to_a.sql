-- Temporarily pin next_customer_review_question_set() to A so customers
-- do not get Set B while the old write-customer-review edge function is live.
-- Applied live 2026-11-13 before the edge-function deploy. Reversible.

create or replace function public.next_customer_review_question_set()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select 'A';
$$;

comment on function public.next_customer_review_question_set() is
  'Temporarily pinned to A while the old write-customer-review edge function is live. Restore rotation after the function is redeployed.';

-- ROLLBACK / restore rotation (apply after write-customer-review is redeployed):
-- create or replace function public.next_customer_review_question_set()
-- returns text
-- language sql
-- stable
-- security definer
-- set search_path = public, pg_temp
-- as $$
--   select case
--     when (
--       select r.question_set
--       from public.customer_reviews r
--       order by r.created_at desc
--       limit 1
--     ) = 'A' then 'B'
--     else 'A'
--   end;
-- $$;
--
-- comment on function public.next_customer_review_question_set() is
--   'Returns A or B only: the opposite of the latest customer_reviews.question_set, or A when none exist. No review text.';
