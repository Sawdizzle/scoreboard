/* eslint-disable @next/next/no-img-element -- logos are small files from Storage, shown at fixed sizes */
import { inkOn } from '@/lib/format';
import type { Game, Team } from '@/lib/types';

// How a team looks wherever it appears: its logo, its two colors and the
// name it goes by. Every screen draws a team through this file, so a logo
// uploaded once shows up everywhere at once.
export type Brand = { name: string; display: string; color: string; color2: string; logo: string | null };

export const brandOf = (t: Pick<Team, 'name' | 'display_name' | 'color' | 'color2' | 'logo_url' | 'age_group'>): Brand => ({
  name: `${t.name}${t.age_group ? ` ${t.age_group}` : ''}`,
  display: t.display_name || t.name,
  color: t.color, color2: t.color2, logo: t.logo_url,
});
// The other side of a game: the opponent's own brand when they are on
// Scoreboard, else what was typed when the game was made.
export const opponentBrand = (g: Game): Brand => g.opponent
  ? brandOf(g.opponent)
  : g.saved
    ? { name: g.saved.name, display: g.saved.name, color: g.saved.color, color2: g.saved.color2, logo: g.saved.logo_url }
    : { name: g.opponent_name, display: g.opponent_name, color: g.opponent_color, color2: '#f2f6fc', logo: null };

export const monogram = (s: string) => s.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';

const vars = (b: Brand) => ({ '--c': b.color, '--c2': b.color2, '--ink': inkOn(b.color) }) as React.CSSProperties;
// The type is sized to the box it sits in (container query units): a short
// name is big, a long one shrinks until it fits on one line.
const fit = (s: string, ratio = 0.56) => ({ '--k': (100 / (Math.max(s.length, 4) * ratio)).toFixed(2) }) as React.CSSProperties;

// The small square: the logo on a dark tile ringed in the accent, or the
// initials on the team color when there is no logo yet.
export function TeamMark({ brand, size = 46 }: { brand: Brand; size?: number }) {
  const style = { ...vars(brand), '--s': `${size}px` } as React.CSSProperties;
  return brand.logo
    ? <span className="mark" style={style}><img src={brand.logo} alt="" /></span>
    : <span className="mark mono" style={style} aria-hidden="true">{monogram(brand.display)}</span>;
}

// The team-color block: the scorebug's slab, made big. Primary color lit
// from above, the hatch, an accent stripe along the foot, the logo as a badge
// and again as a faint watermark.
export function Slab({ brand, sub, right, compact, className = '' }: {
  brand: Brand; sub?: React.ReactNode; right?: boolean; compact?: boolean; className?: string;
}) {
  return (
    <div className={`slab2${right ? ' right' : ''}${compact ? ' compact' : ''} ${className}`} style={vars(brand)}>
      {brand.logo && <img className="slab-wm" src={brand.logo} alt="" aria-hidden="true" />}
      {brand.logo ? <img className="slab-logo" src={brand.logo} alt="" /> : <span className="slab-mono" aria-hidden="true">{monogram(brand.display)}</span>}
      <span className="slab-text">
        <span className="slab-name" style={fit(brand.display)}>{brand.display}</span>
        {sub && <small>{sub}</small>}
      </span>
    </div>
  );
}

// Away on the left, home on the right, the way a scoreboard reads.
export function Matchup({ team, game }: { team: Team; game: Game }) {
  const us = brandOf(team), them = opponentBrand(game);
  const [away, home] = game.is_home ? [them, us] : [us, them];
  return (
    <div className="matchup2">
      <Slab brand={away} sub="Away" compact />
      <Slab brand={home} sub="Home" compact right />
    </div>
  );
}

// A scorebug rail in miniature, for the brand editor: the slab as the
// stream will show it, beside a score and a gray opponent.
export function BugPreview({ brand }: { brand: Brand }) {
  const other: Brand = { name: 'Visitors', display: 'Vis', color: '#4b5563', color2: '#9aa8c2', logo: null };
  const side = (b: Brand, score: number, bat?: boolean) => (
    <span className={`bug-team${bat ? ' bat' : ''}`} style={vars(b)}>
      <span className="bug-slab">
        {b.logo ? <img src={b.logo} alt="" /> : null}
        <span className="bug-name">{b.display}</span>
      </span>
      <span className="bug-score">{score}</span>
    </span>
  );
  return (
    <div className="bug-rail" aria-label="Scorebug preview">
      {side(other, 2)}
      {side(brand, 4, true)}
      <span className="bug-sit"><b>▼5</b><small>2-1</small></span>
    </div>
  );
}
