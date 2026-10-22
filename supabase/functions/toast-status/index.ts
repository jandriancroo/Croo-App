import { createClient } from 'npm:@supabase/supabase-js@2';
import { createHandler } from './handler.ts';

const url = Deno.env.get('SUPABASE_URL');
const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
if (!url || !key) throw new Error('Toast Status service configuration missing');
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
Deno.serve(createHandler(db));