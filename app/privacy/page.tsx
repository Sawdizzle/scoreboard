import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = { title: 'Privacy' };

// Plain-language: what is public, what leaves Scoreboard, and how to have a
// player or an account removed. PRIVACY_EMAIL is where requests go.
export default function Privacy() {
  const email = process.env.PRIVACY_EMAIL?.trim();
  return (
    <main className="shell">
      <div className="page" style={{ maxWidth: 680, paddingTop: 24, gap: 18 }}>
        <Link href="/" className="disp" style={{ fontSize: 22, letterSpacing: '0.14em' }}>SCOREBOARD</Link>
        <h1 className="disp h1">Privacy</h1>

        <section className="card pad">
          <h2 className="h-sec">What the public sees</h2>
          <p>A team&rsquo;s public page and live stream show its schedule, scores and stats, and its players by first name and last initial unless the team&rsquo;s staff choose otherwise. Staff can show a player by number only, or make the whole team private, which hides its schedule, scores, stats and roster from anyone not on its staff. A game&rsquo;s street address is shown publicly only after the game is over. Players on a typed-in opposing team are shown by number only.</p>
        </section>

        <section className="card pad">
          <h2 className="h-sec">What is sent to Anthropic</h2>
          <p>When a coach uses AI writing (a recap, a pregame blurb, reading a lineup photo or importing a schedule page), the game&rsquo;s facts, player names as the team shows them, and any lineup photo or schedule page the coach supplies are sent to Anthropic for processing by its Claude model. Nothing is sent unless a coach asks for it. <Link href="/help/ai" className="link">How AI writing works</Link>.</p>
        </section>

        <section className="card pad">
          <h2 className="h-sec">Removing a player or an account</h2>
          <p>A team&rsquo;s organizer or head coach can delete a player; that also removes the player&rsquo;s name from past lineups, plays and recaps. Staff can delete their own account from the <Link href="/t" className="link">Your teams</Link> screen.</p>
          <p>Parents, players and leagues: to have a player&rsquo;s name or data removed, or to ask what is held about them,
            {email ? <> email <a className="link" href={`mailto:${email}`}>{email}</a>.</> : <> ask the team&rsquo;s organizer.</>} We act on requests within 30 days.</p>
        </section>
      </div>
    </main>
  );
}
