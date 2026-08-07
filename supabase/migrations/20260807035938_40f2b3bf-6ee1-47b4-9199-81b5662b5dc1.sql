DELETE FROM auth.refresh_tokens WHERE user_id::uuid = '1c90cd4b-e6af-425f-bb67-9ab14353ee7f';
DELETE FROM auth.sessions WHERE user_id = '1c90cd4b-e6af-425f-bb67-9ab14353ee7f';