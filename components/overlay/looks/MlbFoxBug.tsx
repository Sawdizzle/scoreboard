/* eslint-disable @next/next/no-img-element -- logos are small files from Storage, shown at fixed sizes */
import './mlbfox.css';
import type { Brand } from '@/components/TeamBrand';
import { type BugProps } from '@/components/overlay/looks/types';
import { shortName } from '@/lib/format';

// MLBFox, drawn here: Scoreboard's national-TV playoff bug, kept simple
// (public/bugs/mlbfox.html), rebuilt as part of the page so the stat cards can
// slide out from behind it. The look is that page's: a navy pitcher bar, a blue
// batter bar, two team-color score blocks (the team's logo at the outer edge)
// either side of a black box with the inning, a TV count and the outs, three
// bevelled bases hung underneath, and a light strip under each team. Nothing
// moves unless the game does: numerals roll, a run flashes the block and a
// sheen crosses the row, a base pops as it lights, a play wipes a callout
// across the batter bar, the box flips to MID / END between halves, and a home
// run (or the stream's walk-off) opens a banner on the bug.
//
// As in ClassicBug, the motion is CSS started by a `key`: a new value mounts a
// new element and its animation plays once.
type V = React.CSSProperties;
type Side = 'away' | 'home';

const up = (s: string | null | undefined) => String(s ?? '').toUpperCase();
const words = (n: string | null | undefined) => String(n ?? '').trim().split(/\s+/).filter(Boolean);
// "Carter Hayes" → "C. HAYES", the way the network lists a hitter. A name that
// ends in an initial ("Alex R.", a team's format) is already short: it stays.
const short = (n: string | null | undefined) => {
  const w = words(n), s = shortName(w.join(' '));
  return up(w.length > 1 && s !== w.join(' ') ? `${w[0][0]}. ${s}` : s);
};
const ordinal = (n: number) => n + (n % 100 >= 11 && n % 100 <= 13 ? 'TH' : ['TH', 'ST', 'ND', 'RD'][n % 10] || 'TH');
// The abbreviation's size by its length, so a long one still fits the block.
const abSize = (s: string) => `${([5.6, 5.6, 5.4, 4.6, 3.8, 3.2][s.length] ?? 2.6)}rem`;

// A team color as a block: mid tones darken a touch so white reads; pale ones
// keep their color and take dark numerals instead (mixing yellow toward navy goes olive).
function shade(hex: string) {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return { block: '#2a5ab0', foot: '#c9d3e6', ink: '#fff' };
  let h = m[1]; if (h.length === 3) h = [...h].map((c) => c + c).join('');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const pale = L > 0.42;
  return {
    block: !pale && L > 0.2 ? `color-mix(in srgb, #${h} 80%, #000)` : `#${h}`,
    foot: pale ? `color-mix(in srgb, #${h} 60%, #000)` : `color-mix(in srgb, #${h} 45%, #fff)`,
    ink: pale ? '#0a1838' : '#fff',
  };
}

// The batter bar's callout for a play: its tag, its color and the line after it.
const SAY: Record<string, [tag: string, tone: string, fallback: string]> = {
  Strikeout: ['STRIKEOUT', 'red', ''], 'Strikeout looking': ['CALLED STRIKE 3', 'red', ''],
  Single: ['SINGLE', 'gold', ''], Double: ['DOUBLE', 'gold', ''], Triple: ['TRIPLE', 'gold', ''],
  Walk: ['WALK', 'green', 'Ball four'], 'Hit by pitch': ['HIT BY PITCH', 'green', 'Takes first'],
  'Double play': ['DOUBLE PLAY', 'slate', ''], 'Stolen base': ['STOLEN BASE', 'green', ''], 'Sac fly': ['SAC FLY', 'amber', ''],
};

// A team's logo; without one the abbreviation stands in. (The look also renders
// on the server, so it takes no handlers: a logo that fails to load is not swapped out.)
function Logo({ url }: { url: string | null }) {
  return url ? <img key={url} className="lg" src={url} alt="" /> : null;
}

// The bevelled bases: a flattened diamond for the top, two darker faces for the
// bevel. Second up top, first and third a step down and out.
const AT: Record<number, [number, number]> = { 3: [54, 34], 2: [100, 16], 1: [146, 34] };
function Base({ n, on }: { n: number; on: boolean }) {
  const [x, y] = AT[n], w = 40, h = 16, t = 10;
  return (
    <g className={on ? 'on pop' : undefined}>
      <polygon className="sl" points={`${x - w},${y} ${x},${y + h} ${x},${y + h + t} ${x - w},${y + t}`} />
      <polygon className="sr" points={`${x},${y + h} ${x + w},${y} ${x + w},${y + t} ${x},${y + h + t}`} />
      <polygon className="top" points={`${x},${y - h} ${x + w},${y} ${x},${y + h} ${x - w},${y}`} />
    </g>
  );
}

export function MlbFoxBug({ g, air, away, home, abbrs, status, period, clock, detail, showLine, moment, topEdge, intro, fx }: BugProps) {
  const live = status === 'live', top = g.half === 'top', ball = period === null;
  const play = live && ball;
  const bases = g.bases as { first?: boolean; second?: boolean; third?: boolean };
  const balls = Math.min(g.balls | 0, 3), strikes = Math.min(g.strikes | 0, 2), outs = g.outs | 0;
  const inning = Number(g.inning) || 1;
  const half = `${g.inning}${g.half}`;
  const score: Record<Side, number> = { away: g.away_score | 0, home: g.home_score | 0 };
  const brand: Record<Side, Brand> = { away, home };
  const abbrOf = (t: Side) => up(abbrs[t] || brand[t].display || (t === 'home' ? 'HOME' : 'AWAY'));
  const batT: Side = top ? 'away' : 'home', fieldT: Side = top ? 'home' : 'away';
  const bat = air.batter, pit = air.pitcher;
  const ks = Number(pit?.today.find((c) => c.k === 'K')?.v) || 0;

  const m = play ? moment : null;
  // The stream's walk-off takes the banner; a home run opens it otherwise.
  const wo = fx?.kind === 'walkoff' ? fx : null;
  const hr = !wo && m?.text === 'Home run' ? m : null;
  const said = m && m.text !== 'Home run' ? SAY[m.text] ?? [up(m.text), 'gold', ''] : null;
  // A run in the same breath as the play rides along in the callout.
  const scored = m && m.runs > 0 ? (m.runs === 1 ? 'Run scores' : `${m.runs} runs score`) : '';
  const sayText = said && m ? [short(m.who) || up(said[2]), up(scored)].filter(Boolean).join(' · ') : '';

  const banner = (wo || hr) && (() => {
    const t = batT, o: Side = t === 'away' ? 'home' : 'away';
    const sh = shade(brand[t].color), ab = abbrOf(t);
    const who = up((wo ? moment?.who : hr?.who) || brand[t].display);
    const runs = hr?.runs ?? 0;
    const title = wo ? 'Walk-off' : runs >= 4 ? 'Grand slam' : 'Home run';
    const what = wo ? `${ab} win ${score[t]}-${score[o]}`
      : runs >= 4 ? 'Grand slam' : runs === 1 ? 'Solo shot' : runs > 1 ? `${runs}-run homer` : `${abbrOf('away')} ${score.away} · ${abbrOf('home')} ${score.home}`;
    return (
      <div key={wo ? `wo${wo.n}` : `hr${hr!.who}${hr!.runs}`} className={`hrb play${wo ? ' wo' : ''}`}>
        <div className={`hchip${brand[t].logo ? ' has-logo' : ''}`} style={{ '--tb': sh.block, '--ci': sh.ink, '--abs': abSize(ab) } as V}>
          <Logo url={brand[t].logo} /><span>{ab}</span>
        </div>
        <div className="words">
          <div className="t1">{title}</div>
          <div className="t2"><b>{who}</b><span>{up(what)}</span></div>
        </div>
      </div>
    );
  })();

  const team = (t: Side) => {
    const sh = shade(brand[t].color), ab = abbrOf(t), sc = score[t];
    return (
      <div className={`tm ${t}${brand[t].logo ? ' has-logo' : ''}`} style={{ '--tb': sh.block, '--ink': sh.ink, '--abs': abSize(ab) } as V}>
        <Logo url={brand[t].logo} />
        <span className="ab">{ab}</span>
        <div className="tsc"><span className="roll"><b key={sc}>{sc}</b></span></div>
        {sc > 0 && <i key={`f${sc}`} className="fl" />}
        {wo && t === batT && <i key={`w${wo.n}`} className="win" />}
      </div>
    );
  };

  // Between halves the box flips to MID / END over the half that just ended, then back to the count.
  const turn = top ? (inning > 1 ? ['END', inning - 1] as const : ['TOP', 1] as const) : ['MID', inning] as const;
  // A score-only sport's period, split where it says two things ("Set 3 · sets 1-0").
  const [p1, p2] = String(period ?? '').split(' · ');
  const word = !live ? (status === 'final' ? 'FINAL' : 'PREGAME') : up(p1);
  const under = live && !ball ? clock || p2 || '' : '';
  // The batter bar's right side: tonight's line or the average when they are shown, else the half.
  const line = (showLine && bat && (bat.today || bat.avg)) || `${top ? 'TOP' : 'BOT'} ${ordinal(inning)}`;

  return (
    <div className={`lk-mf${topEdge ? ' at-top' : ''}${play ? ' dia' : ''}`}>
      <div key={intro?.n ?? 0} className="mf">
        {!topEdge && banner}
        {play && (
          <div className="bar r1">
            <span className="l">{pit ? up(pit.last) : `${abbrOf(fieldT)} PITCHING`}</span>
            <span className="r">{ks > 0 && <i key={ks} className="ks pop">{ks} K</i>}{!!pit?.pitches && <b className="pc">P: {pit.pitches}</b>}</span>
          </div>
        )}
        {(play || (live && !ball && detail)) && (
          <div className="bar r2">
            {play ? <>
              <span className="l">{bat ? short(bat.name) : `${abbrOf(batT)} BATTING`}</span>
              <span className="r">{up(line)}{clock && <b className="clk">{clock}</b>}</span>
            </> : <span className="l">{up(detail)}</span>}
            {said && m && (
              <div key={`s${m.text}${m.who}${m.runs}`} className="say" style={{ '--sb': `var(--${said[1]})`, '--sc': said[1] === 'gold' || said[1] === 'amber' ? '#111' : '#fff' } as V}>
                <b className="stag">{said[0]}</b><span className="txt">{sayText}</span>
              </div>
            )}
          </div>
        )}
        <div className="main">
          {team('away')}
          {play ? (
            <div className="mid">
              <div className="l1">
                <span className="inn"><span className="roll"><b key={inning}>{inning}</b></span><i className={top ? 'arr' : 'arr dn'} /></span>
                <span className="cnt"><span className="roll"><b key={balls}>{balls}</b></span>-<span className="roll"><b key={strikes}>{strikes}</b></span></span>
              </div>
              <div className="l2"><span className="roll"><b key={outs}>{outs}</b></span><span className="ow">{outs === 1 ? 'OUT' : 'OUTS'}</span></div>
              <div key={half} className="ms"><small>{turn[0]}</small><b>{ordinal(turn[1])}</b></div>
            </div>
          ) : (
            <div className="mid word">
              <b className={word.length > 5 ? 'sm' : undefined}>{word}</b>
              {under && <small className={clock ? 'clk' : undefined}>{up(under)}</small>}
            </div>
          )}
          {team('home')}
          {play && (
            <svg className="bases" viewBox="0 0 200 70" aria-hidden="true">
              <defs>
                <linearGradient id="lkmfSilver" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#ffffff" /><stop offset=".55" stopColor="#d9dce2" /><stop offset="1" stopColor="#a9aeb7" /></linearGradient>
                <linearGradient id="lkmfGold" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#fff58a" /><stop offset=".5" stopColor="#ffd21a" /><stop offset="1" stopColor="#f0a000" /></linearGradient>
              </defs>
              <Base key={`2${bases.second ? 1 : 0}`} n={2} on={!!bases.second} />
              <Base key={`3${bases.third ? 1 : 0}`} n={3} on={!!bases.third} />
              <Base key={`1${bases.first ? 1 : 0}`} n={1} on={!!bases.first} />
            </svg>
          )}
          {/* A light sweep across the blocks when a run scores or a banner opens. */}
          {(score.away + score.home > 0 || banner) && <i key={`${score.away}-${score.home}${banner ? 'b' : ''}`} className="sheen" />}
        </div>
        <div className="feet">
          <i style={{ '--ft': shade(away.color).foot } as V} /><span /><i style={{ '--ft': shade(home.color).foot } as V} />
        </div>
        {topEdge && banner}
      </div>
    </div>
  );
}
