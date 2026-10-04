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
  // Whether to show the batter's season average and tonight's line.
  showLine: boolean;
  // A play to call out for a few seconds, or null. `text` is one of MOMENTS;
  // `who` is the batter's name (may be empty).
  moment: { text: string; who: string } | null;
  // The bug sits along the top of the picture (anything that flies off it should go downwards).
  topEdge: boolean;
};

export const MOMENTS = ['Home run', 'Strikeout', 'Strikeout looking', 'Single', 'Double', 'Triple', 'Double play', 'Stolen base', 'Sac fly', 'Walk', 'Hit by pitch'] as const;

// A team's name where a look has room for a short one: its display name when
// that is short, else its short code.
export const tabName = (b: Brand, abbr: string) => (b.display.length <= 10 ? b.display : abbr || b.display.slice(0, 6));
