// Vendored, not fetched at runtime — see the header of that file for why.
import { createClient } from './vendor/supabase-js-2.115.0.js';
import { SUPABASE_URL, SUPABASE_ANON_KEY, DB_SCHEMA } from './config.js';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  realtime: { params: { eventsPerSecond: 20 } },
});

// Scoped client for the `scoreboard` schema: db.from('games') etc.
export const db = supabase.schema(DB_SCHEMA);
