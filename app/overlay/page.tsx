import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';

export const metadata: Metadata = { title: 'Scorebug', robots: { index: false, follow: false } };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Scoreboard v4's Browser Source links, kept working. v4 had one link per
// account, /overlay?ch=<token>; v5 has one per team, /overlay/<token>, and the
// team that took over the account's stream kept its token. Anything else on
// the old link (obs, replay, scenes, debug) rides along.
//
// v4's older per-game link, /overlay?game=<id>&t=<token>, has no v5 match: it
// gets a note the operator sees in OBS, rather than a stream that is silently
// blank.
export default async function LegacyOverlay({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const ch = typeof sp.ch === 'string' ? sp.ch : '';
  if (UUID.test(ch)) {
    const rest = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) if (k !== 'ch' && typeof v === 'string') rest.set(k, v);
    const q = rest.toString();
    redirect(`/overlay/${ch.toLowerCase()}${q ? `?${q}` : ''}`);
  }
  if (typeof sp.game !== 'string') notFound();
  return (
    <main style={{ position: 'fixed', left: 40, bottom: 40, maxWidth: 720, padding: '20px 26px', borderRadius: 12,
      background: 'rgba(11,16,24,.86)', color: '#f2f6fc', font: '600 26px/1.35 system-ui, sans-serif' }}>
      {/* The page behind the note stays see-through, as a Browser Source should. */}
      <style>{'html,body{background:transparent}'}</style>
      This stream link is from Scoreboard v4 and no longer shows a game. Copy your team&rsquo;s link from
      the Stream screen and paste it into this Browser Source.
    </main>
  );
}
