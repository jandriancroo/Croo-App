-- Store-scope manager writes on location_stations.
-- The old "Managers can manage stations" policy let any manager insert, update,
-- or delete stations at any store. Managers now need has_location_access on the
-- station's store (USING and WITH CHECK, so a station cannot be moved to a store
-- they do not run). super_admin keeps full access. Staff SELECT is unchanged
-- ("Members can view stations for their locations").
-- Confirmed live before shipping: policy name, location_id uuid not null, and
-- has_location_access(uuid, uuid).

drop policy "Managers can manage stations" on public.location_stations;

create policy "Managers can manage stations" on public.location_stations
for all to authenticated
using (
  (public.has_role_or_higher(auth.uid(), 'manager'::text) and public.has_location_access(auth.uid(), location_id))
  or public.has_role(auth.uid(), 'super_admin'::app_role)
)
with check (
  (public.has_role_or_higher(auth.uid(), 'manager'::text) and public.has_location_access(auth.uid(), location_id))
  or public.has_role(auth.uid(), 'super_admin'::app_role)
);

-- ROLLBACK:
-- drop policy "Managers can manage stations" on public.location_stations;
-- create policy "Managers can manage stations" on public.location_stations for all to authenticated using (public.has_role_or_higher(auth.uid(), 'manager'::text) or public.has_role(auth.uid(), 'super_admin'::app_role)) with check (public.has_role_or_higher(auth.uid(), 'manager'::text) or public.has_role(auth.uid(), 'super_admin'::app_role));
