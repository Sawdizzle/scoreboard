import type { Brand } from '@/components/TeamBrand';
import type { AirView } from '@/lib/onair';
import type { G } from '@/lib/scoring';

// What every scorebug look is handed. A look draws these; it fetches nothing
// and keeps no state of its own.
export type BugProps = {
  // The game as the rules see it: g.inning, g.half ('top' | 'bottom'), g.balls,
  // g.strikes, g.outs, g.bases ({ first, second, third } booleans), g.away_score,
  // g.home_score, g.away_hits, g.home_hits, g.away_errors, g.home_errors.
  g: G;
  // The people: air.batter ({ num, name, pos, avg, today } | null), air.pitcher
  // ({ num, name, last, pitches } | null).
  air: AirView;
  // Each side's brand: { display, color, color2, logo } (logo is a URL or null).
  away: Brand; home: Brand;
  // Each side's short code, upper case (may be empty).
  abbrs: { away: string; home: string };
  status: 'scheduled' | 'live' | 'final';
  // For the score-only sports: the period ("Q2", "Set 3 · sets 1-0") to show
  // where baseball has its inning, bases and count. null for baseball.
  period: string | null;
  // The game clock as text ("8:42"), when one is running or set: a quarter, a
  // soccer half counting up, baseball's time limit. null when there is none.
  clock?: string | null;
  // For the score-only sports, the line under the score: "Steel ball · 3rd & 4",
  // "Fouls 6-7 · Steel bonus", "+2 · River 🟨". null for baseball.
  detail?: string | null;
  // Whether to show the batter's season average and tonight's line.
  showLine: boolean;
  // A play to call out for a few seconds, or null. `text` is one of MOMENTS;
  // `who` is the batter's name (may be empty); `runs` is how many scored on
  // the play (0 when it is not known).
  moment: { text: string; who: string; runs: number } | null;
  // The bug sits along the top of the picture (anything that flies off it should go downwards).
  topEdge: boolean;
  // A full-frame intro asked for from the pad (On Air). `n` is its stamp: a
  // look that has an intro plays it once each time n changes; `kind` is
  // 'intro', or 'tribute' for the Forever 20 memorial's own. null: none.
  intro?: { n: number; kind: 'intro' | 'tribute' } | null;
  // The stream-wide stinger playing now (walkoff, homerun, run, touchdown ...),
  // with its stamp, for a look that adds its own touch to it. null: none.
  fx?: { kind: string; n: number } | null;
};

export const MOMENTS = ['Home run', 'Strikeout', 'Strikeout looking', 'Single', 'Double', 'Triple', 'Double play', 'Stolen base', 'Sac fly', 'Walk', 'Hit by pitch'] as const;

// How a home run is called by how many it scored. Three voices, as the looks
// had them: 'homer' (Solo homer, 2-run homer, Grand slam), 'shot' (Solo shot,
// 2-run shot, Grand slam) and 'plus' (SOLO SHOT, +2 RUNS, GRAND SLAM). Empty
// when the count is not known, for the look to fall back on its own words.
export function homerText(runs: number, voice: 'homer' | 'shot' | 'plus' = 'homer') {
  if (runs < 1) return '';
  if (runs >= 4) return voice === 'plus' ? 'GRAND SLAM' : 'Grand slam';
  if (voice === 'plus') return runs === 1 ? 'SOLO SHOT' : `+${runs} RUNS`;
  return runs === 1 ? `Solo ${voice}` : `${runs}-run ${voice}`;
}

// A team's name where a look has room for a short one: its display name when
// that is short, else its short code.
export const tabName = (b: Brand, abbr: string) => (b.display.length <= 10 ? b.display : abbr || b.display.slice(0, 6));
