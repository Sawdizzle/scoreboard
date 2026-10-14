import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
export const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '';
// False until .env.local is filled in. Pages check this and say so, rather than
// throwing from deep inside a fetch to an empty URL.
export const supabaseConfigured = SUPABASE_URL.startsWith('http') && SUPABASE_KEY.length > 0;

// One client per request, reading and writing the session in cookies. Every
// query runs as the signed-in user (or as anon), so Row Level Security is what
// decides what comes back — nothing here holds a service key.
export async function createClient() {
  const store = await cookies();
  return createServerClient(SUPABASE_URL, SUPABASE_KEY, {
    cookies: {
      getAll: () => store.getAll(),
      setAll(list) {
        // A Server Component may not set cookies. The proxy refreshes the
        // session on every request, so dropping the write here loses nothing.
        try {
          for (const { name, value, options } of list) store.set(name, value, options);
        } catch { /* rendering, not an action or route handler */ }
      },
    },
  });
}
