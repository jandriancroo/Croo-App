DELETE FROM public.time_punches
WHERE id IN (
  '42051b29-b47a-44be-9b85-bde1587cacbc'::uuid, -- Ty Hutcherson 5/9 (let me re-verify) 
  'a4cf93fb-73f0-4628-abe7-8d47c9cc68f5'::uuid, -- Nicole Mendez 5/6
  '395dda2a-486b-456c-86c2-8c89523cc629'::uuid, -- Diego Martinez 5/5
  'b2938207-21f3-4547-bad9-276542b01e60'::uuid, -- Alle Rowe 5/5
  'a371d7c4-0fa2-461b-a287-53513ea83015'::uuid, -- Wilson Segovia 4/22
  'c9827324-9679-4243-8736-6230a7ba064c'::uuid  -- Jamarii Ceasar 4/21
)
AND is_auto_punched_out = true
AND EXISTS (
  SELECT 1 FROM public.time_punches t2
  WHERE t2.user_id = time_punches.user_id
    AND t2.location_id = time_punches.location_id
    AND t2.punch_type = 'clock_out'
    AND t2.id <> time_punches.id
    AND t2.punch_time < time_punches.punch_time
    AND t2.punch_time > time_punches.punch_time - interval '24 hours'
);

-- Also mark labor cache stale so the affected days recompute hours
UPDATE public.labor_cache SET is_stale = true
WHERE source = 'punch_clock'
  AND ((location_id = '12c977c7-1786-4131-90f5-1eef3f96e2c6' AND labor_date IN ('2026-05-05','2026-05-06'))
    OR (location_id = '6eda7b4b-dab1-435c-89b3-38a7a5ac0a3e' AND labor_date IN ('2026-04-21','2026-04-22','2026-05-08')));