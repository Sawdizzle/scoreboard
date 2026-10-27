import { buildIcs, type Feed } from '@/lib/ics';
import { origin } from '@/lib/origin';
import { createClient, supabaseConfigured } from '@/lib/supabase/server';

// /cal/<token>.ics: a person's subscription to their team's calendar. Calendar
// apps fetch it with no account, so the token is the key; calendar_feed()
// checks the person is still on the team on every fetch.
export async function GET(_: Request, { params }: { params: Promise<{ file: string }> }) {
  const token = /^([0-9a-f-]{36})(\.ics)?$/i.exec((await params).file)?.[1];
  if (!token || !supabaseConfigured) return new Response('Not found', { status: 404 });
  const supabase = await createClient();
  const { data } = await supabase.rpc('calendar_feed', { p_token: token });
  if (!data) return new Response('This calendar link no longer works. Get a new one from the team\'s Calendar.', { status: 404 });
  const feed = data as Feed;
  return new Response(buildIcs(feed, await origin()), {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `inline; filename="${feed.team.slug}.ics"`,
      'Cache-Control': 'private, max-age=300',
      'X-Robots-Tag': 'noindex',
    },
  });
}
