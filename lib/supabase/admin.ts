import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL } from './server';

// The server's own client, on the project's secret key. Only for the few
// writes no signed-in user may make (settling an AI write). Never import this
// from a client component: the key must not reach a browser.
export function adminClient() {
  const key = process.env.SUPABASE_SECRET_KEY?.trim();
  if (!key || !SUPABASE_URL.startsWith('http')) return null;
  return createClient(SUPABASE_URL, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
