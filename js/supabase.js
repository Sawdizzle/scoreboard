import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { SUPABASE_URL, SUPABASE_ANON_KEY, DB_SCHEMA } from './config.js';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  realtime: { params: { eventsPerSecond: 20 } },
});

// Scoped client for the `scoreboard` schema: db.from('games') etc.
export const db = supabase.schema(DB_SCHEMA);
