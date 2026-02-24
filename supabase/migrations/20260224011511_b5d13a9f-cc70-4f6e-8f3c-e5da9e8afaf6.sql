
-- Prevent duplicate Shift Marketplace chats per location
CREATE UNIQUE INDEX idx_unique_shift_marketplace_per_location 
ON public.chats (location_id) 
WHERE title = 'Shift Marketplace';
