import './receipt.css';
import { tabName, type BugProps } from '@/components/overlay/looks/types';

// The Play-by-Play Printer, drawn here: Scoreboard's thermal receipt printer
// (public/bugs/receipt.html) rebuilt as part of the page so the stat cards can
// come out from behind it. Dark plastic housing, a backlit LCD for the score
// and inning, LEDs for the count and bases, and a receipt feeding out of the
// slot: hanging down along the top of the picture, rising along the bottom.
//
// The original keeps a running tape of plays. Nothing is remembered here, so
// the tape is the header stub, the pitcher and batter, and, while a play is
// being called out, that play's freshly printed line. A strikeout is stamped
// with the wooden K stamp; a home run prints the long receipt, which is torn
// off and flutters away.
//
// As in ClassicBug, the motion is CSS started by a `key`: a new value mounts
// a new element and its animation plays once.
type Row = { cls: string; code: React.ReactNode; txt: string; right?: string; small?: string };

const last = (n: string) => (n.trim().split(/\s+/).pop() ?? '').toUpperCase();
const pad = (s: string | number, n: number) => String(s).padStart(n);
const STARS = `${'* '.repeat(13)}*`;
const ART = [
  '                . - ~ - .      ',
  "          . - '           ' o  ",
  "      . '                   ## ",
  "   . '                      ## ",
  ' []------------------------ ## ',
];
// The stamp's ink spatter: [left, top, size] in rem, fixed so every strike looks the same.
const SPAT = [[13.1, 7, 0.6], [8.9, 10.5, 0.4], [2.3, 12.5, 0.9], [-0.4, 8.1, 0.5], [-3.2, 3.8, 0.7], [0.2, 0.8, 0.3], [3.2, -3.3, 1], [8.2, -0.2, 0.4], [12.9, 0.7, 0.8], [12.4, 11.1, 0.5]];

// A called-out play as the line the printer prints for it.
function playRow(text: string, who: string): Row {
  const nm = last(who);
  switch (text) {
    case 'Strikeout': return { cls: 'kl', code: 'K', txt: nm, small: 'swinging' };
    case 'Strikeout looking': return { cls: 'kl', code: <span className="bk">K</span>, txt: nm, small: 'looking' };
    case 'Single': return { cls: 'hit', code: '1B', txt: nm, right: 'SINGLE' };
    case 'Double': return { cls: 'hit', code: '2B', txt: nm, right: 'DOUBLE' };
    case 'Triple': return { cls: 'hit', code: '3B', txt: nm, right: 'TRIPLE' };
    case 'Walk': return { cls: '', code: 'BB', txt: 'take your base' };
    case 'Hit by pitch': return { cls: '', code: 'HBP', txt: 'take your base' };
    case 'Double play': return { cls: '', code: 'DP', txt: nm, right: 'DOUBLE PLAY' };
    case 'Stolen base': return { cls: 'hit', code: 'SB', txt: nm, right: 'STOLEN BASE' };
    case 'Sac fly': return { cls: '', code: 'SF', txt: nm, right: 'SAC FLY' };
    default: return { cls: '', code: '>>', txt: nm, right: text.toUpperCase() };
  }
}

function Ink({ r }: { r: Row }) {
  return (
    <div className="ink">
      <b className="c">{r.code}</b><span className="t">{r.txt}</span>
      {r.right && <><i className="lead" /><b className="r">{r.right}</b></>}
      {r.small && <span className="sm">{r.small}</span>}
    </div>
  );
}

export function ReceiptBug({ g, air, away, home, abbrs, status, period, showLine, moment, topEdge }: BugProps) {
  const live = status === 'live', top = g.half === 'top', ball = period === null;
  const play = live && ball;
  const bases = g.bases as { first?: boolean; second?: boolean; third?: boolean };
  const balls = g.balls | 0, strikes = g.strikes | 0, outs = g.outs | 0;
  const as = g.away_score | 0, hs = g.home_score | 0;
  const half = `${g.inning}${g.half}`;
  const nameA = tabName(away, abbrs.away), nameH = tabName(home, abbrs.home);
  const codeA = (abbrs.away || nameA).toUpperCase(), codeH = (abbrs.home || nameH).toUpperCase();
  const word = !live ? (status === 'final' ? 'Final' : 'Pregame') : !ball ? period : null;
  const bat = air.batter, pit = air.pitcher;

  const hr = play && moment?.text === 'Home run' ? moment : null;
  const k = play && moment?.text.startsWith('Strikeout') ? moment : null;
  const looking = !!k && k.text.endsWith('looking');
  const line = play && moment && !hr ? playRow(moment.text, moment.who) : null;
  const mkey = moment ? `${moment.text}${moment.who}` : '';
  const msg = hr ? { t: 'HOME RUN', ms: '3.3s' } : k ? { t: looking ? 'K LOOKING' : 'STRIKE 3', ms: '1.9s' } : null;

  const leds = (n: number, of: number) => Array.from({ length: of }, (_, i) => <i key={`${i}${i < n ? 1 : 0}`} className={i < n ? 'on' : undefined} />);
  const lcdRow = (name: string, score: number, batting: boolean, kk: string) => (
    <div key={`${kk}${score}`} className={`lrw${score > 0 ? ' flash' : ''}${batting ? ' bat' : ''}`}>
      <i className="mk" /><span className="nm">{name}</span><span className="sc">{score}</span>
    </div>
  );
  const delay = (i: number) => ({ '--d': '.19s', '--dl': `${0.19 * i}s` }) as React.CSSProperties;

  // The header stub, in PRINT order (the roll's CSS turns it the way the paper travels):
  // the dashed rule is printed last, so it sits between the header and the plays.
  const hd = (
    <div className="ln hd fresh" style={delay(topEdge ? 1 : 0)}>
      <div className="ink">{play ? `BALLPARK TERMINAL 01 · ${top ? '▲' : '▼'}${g.inning}` : status === 'final' ? 'BALLPARK TERMINAL 01 · FINAL' : 'BALLPARK TERMINAL 01'}</div>
    </div>
  );
  const won = as === hs ? `GAME OVER · ${codeA} ${as} ${codeH} ${hs}` : `GAME OVER · ${as > hs ? codeA : codeH} WIN ${Math.max(as, hs)}-${Math.min(as, hs)}`;
  const sub = play ? `${top ? 'TOP' : 'BOT'} ${g.inning} · ${top ? codeA : codeH} AT BAT`
    : status === 'final' ? won
      : !live ? `PREGAME · ${codeA} AT ${codeH}`
        : (period ?? '').toUpperCase();
  // A finished ball game prints its line score, as the original's final receipt does.
  const box = status === 'final' && ball;
  const cells = (code: string, r: number, h: unknown, e: unknown) => `${code.slice(0, 7).padEnd(7)}${pad(r, 4)}${pad(Number(h) || 0, 4)}${pad(Number(e) || 0, 4)}`;
  const hd2 = box ? (
    <div className="ln tbl fresh" style={delay(topEdge ? 0 : 1)}>
      <div className="ink">
        <span>{`${' '.repeat(7)}${pad('R', 4)}${pad('H', 4)}${pad('E', 4)}`}</span>{'\n'}
        {as > hs ? <b>{`${cells(codeA, as, g.away_hits, g.away_errors)}  W`}</b> : cells(codeA, as, g.away_hits, g.away_errors)}{'\n'}
        {hs > as ? <b>{`${cells(codeH, hs, g.home_hits, g.home_errors)}  W`}</b> : cells(codeH, hs, g.home_hits, g.home_errors)}
      </div>
    </div>
  ) : (
    <div className="ln hd2 fresh" style={delay(topEdge ? 0 : 1)}><div className="ink">{sub}</div></div>
  );

  return (
    <div className="lk-rcpt">
      <div className={`unit${k ? ' thud' : ''}`}>
        <div className={`printer${word !== null ? ' word' : ''}${moment && play ? ' printing' : ''}${hr ? ' overdrive' : ''}`}>
          <div className="keys"><i style={{ '--c': away.color } as React.CSSProperties} /><i style={{ '--c': home.color } as React.CSSProperties} /></div>
          <div className="lcd">
            <div className="lrows">
              {lcdRow(nameA, as, play && top, 'a')}
              {lcdRow(nameH, hs, play && !top, 'h')}
            </div>
            <div className="inn">
              {word !== null ? <span className="wd">{word}</span> : (
                <>
                  <div className="il"><i className={top ? 'arr' : 'arr dn'} /><span className="num">{g.inning}</span></div>
                  <span className="pc">{pit ? `P${pit.pitches}` : ''}</span>
                </>
              )}
            </div>
            {/* The LCD spells out a new half, and a big play, for a moment. */}
            {play && <div key={half} className="msgt">{top ? 'TOP' : 'BOT'} {g.inning}</div>}
            {msg && <div key={mkey} className="msgt" style={{ '--ms': msg.ms } as React.CSSProperties}>{msg.t}</div>}
          </div>
          {play && (
            <div className="panel">
              <div className="cnt">
                <div className="lr b"><b>B</b>{leds(balls, 3)}</div>
                <div className="lr s"><b>S</b>{leds(strikes, 2)}</div>
                <div className="lr o"><b>O</b>{leds(outs, 2)}</div>
              </div>
              <div className="dia">
                <i className={bases.second ? 'b2 on' : 'b2'} /><i className={bases.third ? 'b3 on' : 'b3'} /><i className={bases.first ? 'b1 on' : 'b1'} /><span className="hp" />
              </div>
            </div>
          )}
          <div className="ptag"><i className="act" /><span>PBP-01</span></div>
          <div className="pslot"><i className="head" /></div>
          <div key={`${status}${half}${hr ? 'h' : ''}`} className="teeth" />
        </div>

        <div className="pbox">
          {/* A new half (or a new state) is a new roll. */}
          <div key={`${status}${half}`} className={`paper${line ? ' capped' : ''}`}>
            <div className={`vp${play || box ? ' tall' : ''}`}>
              <div className="roll">
                {topEdge ? <>{hd2}{hd}</> : <>{hd}{hd2}</>}
                <div className="ln rule fresh" style={delay(2)}><div className="ink" /></div>
                {play && pit && (
                  <div key={`p${pit.bid}`} className="ln ab fresh" style={{ '--d': '.24s' } as React.CSSProperties}>
                    <Ink r={{ cls: 'ab', code: 'P', txt: pit.last.toUpperCase(), right: `${pit.pitches}P` }} />
                  </div>
                )}
                {play && bat && (
                  <div key={`b${bat.bid}`} className="ln ab fresh" style={{ '--d': '.24s' } as React.CSSProperties}>
                    <Ink r={{
                      cls: 'ab', code: 'AB', txt: bat.name.toUpperCase(),
                      right: showLine && bat.avg ? bat.avg : undefined, small: showLine && bat.today ? bat.today : undefined,
                    }} />
                  </div>
                )}
                {line && (
                  <div key={`m${mkey}`} className={`ln ${line.cls} fresh feed`}>
                    <Ink r={line} />
                    {k && (
                      <div className={looking ? 'stamp lk' : 'stamp'}>
                        <div className="sk">K</div><div className="sc">{looking ? 'LOOKING' : 'SWINGING'}</div>
                        {SPAT.map(([l, t, s], i) => <i key={i} className="sp" style={{ left: `${l}rem`, top: `${t}rem`, width: `${s}rem`, height: `${s}rem` }} />)}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {hr && (
          <div key={`hr${mkey}`} className="hrbox">
            <div className="hrsh">
              <div className="paper">
                <div className="roll read">
                  <div className="ln stars"><div className="ink">{STARS}</div></div>
                  <div className="ln big"><div className="ink">HOME</div></div>
                  <div className="ln big"><div className="ink">RUN!</div></div>
                  <div className="ln stars"><div className="ink">{STARS}</div></div>
                  <div className="ln who"><div className="ink">{last(hr.who) || (top ? codeA : codeH)}</div></div>
                  <div className="ln ctr"><div className="ink">{hr.runs > 0 ? `RUNS: ${hr.runs}` : top ? `${codeA} ${as}-${hs}` : `${codeH} ${hs}-${as}`}</div></div>
                  {ART.map((a, i) => <div key={i} className="ln asc"><div className="ink">{a}</div></div>)}
                  <div className="ln stars"><div className="ink">{STARS}</div></div>
                </div>
              </div>
            </div>
          </div>
        )}
        {k && <div key={`k${half}${mkey}`} className="stamper" />}

        {/* rubber-stamp ink texture */}
        <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true">
          <filter id="lkrcpt-ink" x="-10%" y="-10%" width="120%" height="120%">
            <feTurbulence type="fractalNoise" baseFrequency=".85" numOctaves="2" seed="7" result="n" />
            <feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  -3 0 0 0 2.45" result="a" />
            <feComposite in="SourceGraphic" in2="a" operator="in" result="s" />
            <feDisplacementMap in="s" in2="n" scale="3" xChannelSelector="R" yChannelSelector="G" />
          </filter>
        </svg>
      </div>
    </div>
  );
}
