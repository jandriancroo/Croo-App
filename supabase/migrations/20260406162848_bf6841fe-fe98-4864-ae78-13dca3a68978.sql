-- Delete orphan inventory count items first, then the count itself
DELETE FROM inventory_count_items WHERE count_id = 'e147a290-8329-4331-99ed-ad58c0970f47';
DELETE FROM inventory_counts WHERE id = 'e147a290-8329-4331-99ed-ad58c0970f47';