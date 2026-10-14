'use client';

import { createBrowserClient } from '@supabase/ssr';

// The browser's client, on the same cookie session the server reads. The pad
// writes plays through it directly: one hop to the database instead of two,
// which is the difference you feel tapping BALL with a runner going.
let client: ReturnType<typeof createBrowserClient> | null = null;
export function browserClient() {
  if (!client) {
    client = createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '', process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '');
  }
  return client;
}
