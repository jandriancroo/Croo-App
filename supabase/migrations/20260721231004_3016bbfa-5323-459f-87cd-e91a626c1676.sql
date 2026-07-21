-- Dedupe checklist_responses: keep newest row per (submission_id, item_id).
-- Prefer rows that have image data when tied on created_at.
WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY submission_id, item_id
           ORDER BY
             (response_image_urls IS NOT NULL AND jsonb_array_length(response_image_urls) > 0) DESC,
             (response_image_url IS NOT NULL) DESC,
             created_at DESC NULLS LAST,
             id DESC
         ) AS rn
  FROM public.checklist_responses
)
DELETE FROM public.checklist_responses cr
USING ranked r
WHERE cr.id = r.id AND r.rn > 1;

-- Enforce uniqueness so upsert(onConflict:'submission_id,item_id') is race-safe.
ALTER TABLE public.checklist_responses
  ADD CONSTRAINT checklist_responses_submission_item_unique
  UNIQUE (submission_id, item_id);
