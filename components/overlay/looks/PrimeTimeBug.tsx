import './primetime.css';
import type { Brand } from '@/components/TeamBrand';
import { homerText, tabName, type BugProps } from '@/components/overlay/looks/types';

// Prime Time, drawn here: Scoreboard's network-television bug
// (public/bugs/primetime.html), rebuilt as part of the page so the stat cards
// can slide out from behind it. The look is that page's: a dark glass rail,
// team-colour slabs with a score well each, a lit gold diamond, a numeric
// count over three out lamps, and a context strip for the at-bat. Its moments
// are kept: a run flares the slab and flashes the well gold while a sheen
// crosses the rail, the inning flips to MID / END between halves, a strikeout
// wipes a K flag out of the side of the rail, and a home run wipes a
// lower-third band out of the bug.
//
// As in ClassicBug, the motion is CSS started by a `key`: a new value mounts a
// new element and its animation plays once.
type Tag = { tag: React.ReactNode; cls: string; text: string };

const surname = (n: string | undefined) => { const w = String(n ?? '').trim().split(/\s+/).filter(Boolean); return w.length ? w[w.length - 1] : ''; };
const ordinal = (n: number) => { const s = ['TH', 'ST', 'ND', 'RD'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };

// What the strip says for a play, in the original's words.
function tagFor(text: string, who: string): Tag {
  switch (text) {
    case 'Home run': return { tag: 'HR', cls: 'gold', text: who || 'Home run' };
    case 'Strikeout': return { tag: 'K', cls: 'red', text: who ? `${who} strikes out` : 'Strikeout swinging' };
    case 'Strikeout looking': return { tag: <span className="back">K</span>, cls: 'red', text: who ? `${who} caught looking` : 'Called strike three' };
    case 'Single': case 'Double': case 'Triple': return { tag: text, cls: 'gold', text: who || 'Base hit' };
    case 'Walk': return { tag: 'Walk', cls: 'green', text: who ? `${who} takes first` : 'Ball four' };
    case 'Hit by pitch': return { tag: 'HBP', cls: 'green', text: who ? `${who} takes first` : 'Hit by pitch' };
    case 'Double play': return { tag: 'DP', cls: 'red', text: who ? `${who} · double play` : 'Double play' };
    case 'Stolen base': return { tag: 'SB', cls: 'green', text: who ? `${who} · stolen base` : 'Stolen base' };
    case 'Sac fly': return { tag: 'SF', cls: 'amber', text: who ? `${who} · sac fly` : 'Sacrifice fly' };
    default: return { tag: text, cls: '', text: who };
  }
}

function Side({ brand, abbr, score, bat, side }: { brand: Brand; abbr: string; score: number; bat: boolean; side: 'away' | 'home' }) {
  // A new score mounts a new slab and well: the slab flares, the well flashes gold, the numeral rolls in.
  const flash = score > 0 ? ' flash' : '';
  return (
    <div className={`team ${side}${bat ? ' bat' : ''}`} style={{ '--tc': brand.color } as React.CSSProperties}>
      <div key={`s${score}`} className={`slab${flash}`}><span className="ab">{tabName(brand, abbr)}</span></div>
      <div key={`w${score}`} className={`score${flash}`}><span className="roll"><b>{score}</b></span></div>
    </div>
  );
}

export function PrimeTimeBug({ g, air, away, home, abbrs, status, period, showLine, moment }: BugProps) {
  const live = status === 'live', top = g.half === 'top', ball = period === null;
  const play = live && ball;
  const bases = g.bases as { first?: boolean; second?: boolean; third?: boolean };
  const balls = Math.min(g.balls | 0, 3), strikes = Math.min(g.strikes | 0, 2), outs = g.outs | 0;
  const inning = Number(g.inning) || 1;
  const half = `${g.inning}${g.half}`;
  const aw = g.away_score | 0, hm = g.home_score | 0;
  const awayName = tabName(away, abbrs.away), homeName = tabName(home, abbrs.home);
  const base = (on: boolean | undefined, x: number, y: number, k: string) => (
    // The turn is on the group: the pop animates the square's own transform, and would undo it.
    <g key={`${k}${on ? 1 : 0}`} transform={`rotate(45 ${x + 8.5} ${y + 8.5})`}><rect className={on ? 'b on pop' : 'b'} x={x} y={y} width="17" height="17" /></g>
  );
  const m = play ? moment : null;
  const k = m?.text.startsWith('Strikeout') ? m : null;
  const looking = !!k && k.text.endsWith('looking');
  const hr = m?.text === 'Home run' ? m : null;
  const said = m ? tagFor(m.text, m.who) : null;
  const bat = air.batter, pit = air.pitcher;
  const batBrand = top ? away : home, batName = top ? awayName : homeName;
  // The half that just ended, for the flip and the strip: MID 3RD, END 3RD.
  const turn = top ? (inning > 1 ? { w: 'End', n: inning - 1 } : { w: 'Top', n: 1 }) : { w: 'Mid', n: inning };

  return (
    <div className="lk-pt">
      <div className="pkg">
        <div className="rail">
          <Side brand={away} abbr={abbrs.away} score={aw} bat={play && top} side="away" />
          <Side brand={home} abbr={abbrs.home} score={hm} bat={play && !top} side="home" />
          {!live ? <div className="sit word">{status === 'final' ? 'Final' : 'Pregame'}</div>
            : !ball ? <div className="sit word">{period}</div> : (
              <div className="sit">
                {/* Between halves the inning flips over to MID / END, then flips back. */}
                <div key={half} className="inn">
                  <div className="face"><i className={top ? 'arr up on' : 'arr up'} /><span className="n">{g.inning}</span><i className={top ? 'arr dn' : 'arr dn on'} /></div>
                  <div className="mid"><small>{turn.w}</small><b>{turn.n}</b></div>
                </div>
                <svg className="dia" viewBox="0 0 62 52" aria-hidden="true">
                  {base(bases.second, 22, 3, 's')}{base(bases.third, 5, 22, 't')}{base(bases.first, 39, 22, 'f')}
                </svg>
                <div className="cnt">
                  <div className="bs">
                    <span className="roll"><b key={balls}>{balls}</b></span><span className="dash">-</span><span className="roll"><b key={strikes}>{strikes}</b></span>
                  </div>
                  <div className="outs">{[0, 1, 2].map((i) => <i key={`${i}${i < outs ? 1 : 0}`} className={i < outs ? 'on pop' : undefined} />)}</div>
                </div>
              </div>
            )}
          {(aw + hm > 0 || hr) && <i key={`${aw}-${hm}${hr ? 'h' : ''}`} className="sheen" />}
        </div>
        {k && (
          <div key={`k${k.text}${k.who}`} className={`kflag play${looking ? ' looking' : ''}`}>
            <div className="k"><span>K</span></div>
            <div className="kt">
              <b>{looking ? 'Called strike three' : 'Strikes out swinging'}</b>
              <small>{[surname(k.who), pit?.last].filter(Boolean).join(' · ') || 'Strikeout'}</small>
            </div>
          </div>
        )}
        {play && (
          <div className="strip">
            <div key={bat?.bid ?? 'none'} className="line in">
              {bat ? <><span className="xtag">AB</span><span className="txt">{bat.name}</span></>
                : <><span className="xtag">{top ? 'TOP' : 'BOT'} {g.inning}</span><span className="txt">{outs === 1 ? '1 out' : `${Math.min(outs, 2)} outs`}</span></>}
              {bat && showLine && bat.avg && <span className="xtag gold">{bat.avg}</span>}
              {bat && showLine && bat.today && <span className="today">{bat.today}</span>}
              {pit && <span className="side">P · {pit.last}<b>{pit.pitches}</b></span>}
            </div>
            {/* The half turning over takes the strip for a moment, then gives it back. */}
            <div key={`h${half}`} className="line over turn">
              <span className="xtag gold">{turn.w} {ordinal(turn.n)}</span><span className="txt">{batName} coming to bat</span>
            </div>
            {said && m && (
              <div key={`m${m.text}${m.who}`} className="line over in">
                <span className={`xtag ${said.cls}`}>{said.tag}</span><span className="txt">{said.text}</span>
              </div>
            )}
          </div>
        )}
        {hr && (
          <div key={`hr${hr.who}`} className="hr play" style={{ '--tc': batBrand.color } as React.CSSProperties}>
            <div className="hslab"><span className="hab">{batName}</span><span className="hsc">{top ? 'TOP' : 'BOT'} {ordinal(inning)}</span></div>
            <div className="hbody">
              <div className="t1"><span>Home run</span></div>
              <div className="t2">{hr.who && <b>{hr.who}</b>}<span>{homerText(hr.runs) || `${awayName} ${aw} · ${homeName} ${hm}`}</span></div>
            </div>
            <i className="bar" /><i className="gleam" />
          </div>
        )}
      </div>
    </div>
  );
}
