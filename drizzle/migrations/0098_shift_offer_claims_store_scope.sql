-- Store-scope SELECT on shift_offer_claims.
-- Replaces the open "Anyone can view shift claims" policy (USING true).
-- Staff can still see claims on offers at their locations, including their own.
-- Matches the shift_offers SELECT check: has_location_access on the offer's store.
-- Confirmed live before shipping: policy name, shift_offer_id, user_id, and
-- has_location_access(uuid, uuid).

drop policy "Anyone can view shift claims" on public.shift_offer_claims;

create policy "Users can view shift claims at their locations" on public.shift_offer_claims
for select to authenticated
using (
  auth.uid() = user_id
  or exists (
    select 1 from public.shift_offers so
    join public.scheduled_shifts ss on ss.id = so.shift_id
    join public.schedules s on s.id = ss.schedule_id
    where so.id = shift_offer_claims.shift_offer_id
      and public.has_location_access(auth.uid(), s.location_id)
  )
);

-- ROLLBACK:
-- drop policy "Users can view shift claims at their locations" on public.shift_offer_claims;
-- create policy "Anyone can view shift claims" on public.shift_offer_claims for select to authenticated using (true);
