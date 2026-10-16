import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = { title: 'How your recap is generated' };

// Public, plain-language: what the AI writes, from what, and what it never does.
// Linked from the Recap card and the AI writing card in Settings.
export default function AiHelp() {
  return (
    <main className="shell">
      <div className="page" style={{ maxWidth: 680, paddingTop: 24, gap: 18 }}>
        <Link href="/" className="disp" style={{ fontSize: 22, letterSpacing: '0.14em' }}>SCOREBOARD</Link>
        <h1 className="disp h1">How your recap is generated</h1>

        <section className="card pad">
          <h2 className="h-sec">Nothing on the live stream is written by AI</h2>
          <p>The scorebug, the cards and every scene come from the plays your scorer taps, as they happen. AI writing runs only before a game (a pregame blurb) or after it (a recap), and only when a coach asks for it.</p>
        </section>

        <section className="card pad">
          <h2 className="h-sec">It writes from the game&rsquo;s facts, and only those</h2>
          <p>When a coach taps <b>Write the recap</b>, Scoreboard works out the game&rsquo;s facts from the play log: the line score, every run and how it scored, lead changes, big moments, strikeouts and who stood out. Those facts, and nothing else, go to Claude, an AI model made by Anthropic. It is told never to add a play, a score, a statistic or a player that is not in them.</p>
          <p>If a game&rsquo;s log is missing some runs (a run added by hand, say), the recap can give that inning&rsquo;s total but will not guess how those runs scored.</p>
        </section>

        <section className="card pad">
          <h2 className="h-sec">Every score is checked</h2>
          <p>Before you see a draft, Scoreboard checks it against the facts: every score must be one the game actually passed through, every inning one that was played, and the player of the game someone the facts name. If anything does not match, it is written again; anything still wrong is shown to the coach in red.</p>
        </section>

        <section className="card pad">
          <h2 className="h-sec">Names follow your settings</h2>
          <p>Players are named the way your team&rsquo;s name format and each player&rsquo;s public-name setting allow, the same as on your public pages. A player shown only by number stays a number. Pregame blurbs name no players at all.</p>
        </section>

        <section className="card pad">
          <h2 className="h-sec">A coach decides what goes out</h2>
          <p>A recap is a draft until a coach reads it, edits it if needed and taps <b>Publish</b>; only then does it show on the public game page, and it can be taken down at any time. Social captions are never posted for you: you copy them. A pregame blurb reaches the stream only when the operator taps <b>Use</b>.</p>
        </section>

        <section className="card pad">
          <h2 className="h-sec">Limits</h2>
          <p>Each team has a number of AI writes a month, shown under Team settings. One recap or one blurb is one write. When AI writing is off, or the month&rsquo;s writes are used up, everything else in Scoreboard works exactly the same.</p>
        </section>
      </div>
    </main>
  );
}
