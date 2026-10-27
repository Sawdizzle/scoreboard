import Image from 'next/image';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { HeroDemo } from '@/components/landing/HeroDemo';
import { Reveal } from '@/components/landing/Reveal';
import { getUserId } from '@/lib/data';
import { supabaseConfigured } from '@/lib/supabase/server';
import '@/components/landing/landing.css';

const ROLES = [
  ['League admin', 'Every team in the league, one announcement to every family, one calendar.'],
  ['Team admin', 'The team, its people and its seats.'],
  ['Coach', 'Roster, lineups, schedule and messages.'],
  ['Scorer', 'Lineups, game times and the pad. Often a parent.'],
  ['Broadcaster', 'The stream: OBS or Mevo, looks, scenes, sponsor.'],
  ['Parent', 'Calendar, one-tap RSVP, announcements, the parents’ chat.'],
  ['Fan', 'Game times and the final score, wherever they are.'],
];

// The front door: what Scoreboard does, shown rather than told, and a way in.
// Someone already signed in goes straight to their teams.
export default async function Home() {
  if (supabaseConfigured && (await getUserId())) redirect('/t');
  return (
    <main className="land">
      <header className="land-top">
        <span className="wordmark">SCOREBOARD</span>
        <nav className="land-nav">
          <Link href="/sign-in" className="btn btn-quiet btn-sm">Sign in</Link>
          <Link href="/sign-up" className="btn btn-primary btn-sm">Get started</Link>
        </nav>
      </header>

      <section className="land-hero">
        <div className="land-copy">
          <span className="eyebrow gold">Baseball, football, soccer, basketball, volleyball</span>
          <h1 className="disp land-h1">Score it once.<br /><span>Everyone sees it.</span></h1>
          <p className="land-lede">
            One tap on the pad runs the scorebug on your live stream, the season stats, and the notification on every parent&rsquo;s phone. The calendar, the lineups and the team chat live in the same app.
          </p>
          <div className="btn-row land-cta">
            <Link href="/sign-up" className="btn btn-primary btn-big">Create a free account</Link>
            <Link href="/sign-in" className="btn btn-quiet btn-big">Sign in</Link>
          </div>
          {!supabaseConfigured && (
            <p className="note note-plain">
              Not connected to a database yet. Copy <code>.env.example</code> to <code>.env.local</code>, fill
              in the Supabase project URL and publishable key, and restart.
            </p>
          )}
        </div>
        <HeroDemo />
      </section>

      <Reveal className="land-row">
        <div className="land-text">
          <span className="eyebrow">01 · The pad</span>
          <h2 className="disp land-h2">Score from your phone</h2>
          <p>BALL, STRIKE, FOUL and IN PLAY, big enough for a thumb in the bleachers. Every tap saves in order through a weak signal, a second phone stays in step, and Undo takes back anything. Set the lineup and batting order before first pitch; the pad does the rest.</p>
        </div>
        <div className="land-shot phone"><Image src="/landing/pad.png" alt="The scoring pad: BALL, STRIKE, FOUL and IN PLAY keys" width={390} height={844} /></div>
      </Reveal>

      <Reveal className="land-row flip">
        <div className="land-text">
          <span className="eyebrow">02 · The stream</span>
          <h2 className="disp land-h2">A broadcast, not a webcam</h2>
          <p>Fourteen scorebug looks, stat cards, the mid-inning board, Starting Soon and Final scenes, sponsors and sound, from one link in OBS or Mevo. The broadcaster runs it from On Air; the scorebug follows the score by itself.</p>
        </div>
        <div className="land-shot wide"><Image src="/landing/scene-final.jpg" alt="The Final scene: River 6, Steel 3, with the line score" width={1280} height={720} /></div>
      </Reveal>

      <Reveal className="land-row">
        <div className="land-text">
          <span className="eyebrow">03 · The families</span>
          <h2 className="disp land-h2">Parents always know</h2>
          <p>The team calendar syncs to their own phone. One tap says who&rsquo;s coming. Announcements and the parents&rsquo; chat replace the group text, and notifications arrive the moment practice moves or the game ends.</p>
        </div>
        <div className="land-stack" aria-hidden="true">
          <div className="land-note"><b>Practice moved</b>Thursday 5:30 PM · Kerman Park, Field 2</div>
          <div className="land-note"><b>Coach Torres</b>Team photos after practice. Full uniform.</div>
          <div className="land-note"><b>Final</b>Blue Steel 6, River 3</div>
          <div className="land-rsvp"><span>Saturday vs River</span><i className="yes">Going</i><i>Maybe</i><i>Can&rsquo;t</i></div>
        </div>
      </Reveal>

      <Reveal className="land-row flip">
        <div className="land-text">
          <span className="eyebrow">04 · The league</span>
          <h2 className="disp land-h2">Built for the whole league</h2>
          <p>League admins see every team, one calendar, and send one announcement to every family at once. Players never have accounts and there are no private messages: every conversation sits where the coaches can see it.</p>
        </div>
        <ul className="land-roles">
          {ROLES.map(([name, what]) => <li key={name}><b>{name}</b><span>{what}</span></li>)}
        </ul>
      </Reveal>

      <Reveal className="land-end" as="div">
        <h2 className="disp land-h2">Ready for opening day?</h2>
        <div className="btn-row land-cta">
          <Link href="/sign-up" className="btn btn-primary btn-big">Create a free account</Link>
          <Link href="/sign-in" className="btn btn-quiet btn-big">Sign in</Link>
        </div>
        <p className="sub"><Link href="/privacy" className="link">Privacy</Link></p>
      </Reveal>
    </main>
  );
}
