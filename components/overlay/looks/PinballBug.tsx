import './pinball-dmd.css';
import type { Brand } from '@/components/TeamBrand';
import { homerText, tabName, type BugProps } from '@/components/overlay/looks/types';
import { shortName } from '@/lib/format';

// Backglass, drawn here: Scoreboard's pinball bug (public/bugs/pinball-dmd.html),
// rebuilt as part of the page so the stat cards can sit behind it. A chrome and
// black cabinet holds a 128x32 orange dot-matrix display; under it, a backglass
// strip of plastic insert lamps: an arrow insert per team, the count, the
// bases, and the at-bat line.
//
// The original paints its display on a canvas. Here it is pixel-font text seen
// through a mask of dots, so anything that moves under the mask moves the way
// it does on a real display, dot by dot. `T` is one piece of display text:
// x and y are in dots, w and h are how many dots one font pixel covers.
//
// As in the other looks, the motion is CSS started by a `key`. A moment, a new
// half and a new batter each mount a scene that takes the display over and
// then hides itself, giving it back to the resting screen.
const v = (o: Record<string, string | number>) => o as React.CSSProperties;
const clean = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9 +\-!.'?]/g, '').trim();
const surname = (s: string) => shortName(clean(s));
// A name for the display's 50-dot column: six letters at most.
const dmdName = (b: Brand, abbr: string) => clean(abbr || b.display).slice(0, 6);

function T({ x, y, w = 1, h, n, cls, children }: { x: number; y: number; w?: number; h?: number; n?: number; cls?: string; children: React.ReactNode }) {
  return <span className={cls ? `t ${cls}` : 't'} style={v({ '--cx': x, '--x': x, '--y': y, '--w': w, '--h': h ?? w, ...(n ? { '--n': n } : {}) })}>{children}</span>;
}
// Letters that land one after another.
const chars = (s: string) => [...s].map((c, i) => (c === ' ' ? <span key={i} className="sp" /> : <span key={i} className="ch" style={v({ '--i': i })}>{c}</span>));

// Speed streaks for a hit: row, length (dots), delay.
const STREAKS = [[2, 30, 0], [5, 18, 90], [9, 40, 30], [12, 14, 150], [15, 26, 60], [18, 36, 120], [21, 12, 10], [24, 30, 100], [27, 20, 160], [30, 34, 50]];
const HIT: Record<string, string> = { Single: 'SINGLE', Double: 'DOUBLE', Triple: 'TRIPLE', 'Sac fly': 'SAC FLY', 'Stolen base': 'STOLEN' };

function Moment({ text, who, runs }: { text: string; who: string; runs: number }) {
  const sur = surname(who);
  const full = clean(who).length <= 15 ? clean(who) : sur;
  if (text === 'Home run') return (
    <div className="scn hr">
      <i className="strobe" />
      <div className="ph p1"><T x={64} y={2} w={4} cls="slam">HOME</T></div>
      <div className="ph p2"><T x={64} y={2} w={4} cls="slam">RUN</T><i className="inv" /></div>
      <div className="ph p3">
        <T x={64} y={3} w={2} cls="dim">HOME RUN</T><i className="fence" /><i className="ground" />
        <i className="ballx"><i className="bally" /></i>
      </div>
      <div className="ph p4">
        <i className="strobe" /><i className="bord" />
        <T x={64} y={3} w={2} cls="xdrop">{chars(homerText(runs, 'plus') || 'HOME RUN')}</T>
        {full && <T x={64} y={21} cls="who">{full}</T>}
        <i className="tw" />
      </div>
      <i className="burst fw" />
      <i className="wipe" />
    </div>
  );
  if (text === 'Strikeout') return (
    <div className="scn k">
      <i className="strobe one" />
      <div className="shk">
        <T x={64} y={2} w={4} cls="slam kk">K</T>
        <div className="hold"><T x={64} y={3} h={2}>STRIKEOUT</T>{sur && <T x={64} y={23} cls="mid">{sur}</T>}</div>
      </div>
    </div>
  );
  if (text === 'Strikeout looking') return (
    <div className="scn kl">
      <i className="strobe one" />
      <div className="shk"><div className="hold">
        <T x={0} y={2} w={4} cls="l slam kk">K</T>
        <i className="dv" />
        <T x={37} y={1} h={2} n={6} cls="l type c1">CAUGHT</T>
        <T x={37} y={17} h={2} n={7} cls="l type c2">LOOKING</T>
      </div></div>
    </div>
  );
  if (text === 'Walk' || text === 'Hit by pitch') return (
    <div className="scn walk">
      <div className="ph a">
        {text === 'Walk' ? (
          <>
            <T x={64} y={2} h={2} cls="pop">{chars('BALL FOUR')}</T>
            {[0, 1, 2, 3].map((i) => <i key={i} className="bb" style={v({ '--i': i })} />)}
          </>
        ) : (
          <>
            <T x={64} y={4} h={2} cls="pop">{chars('HIT BY PITCH')}</T>
            {sur && <T x={64} y={22} cls="xsub">{sur}</T>}
          </>
        )}
        <i className="wipe" />
      </div>
      <div className="ph b">
        <T x={64} y={3}>TAKE YOUR BASE</T>
        <T x={64} y={15} w={2}>{[0, 1, 2, 3, 4, 5, 6, 7].map((i) => <span key={i} className="cv" style={v({ '--i': i })}>{'>'}</span>)}</T>
        <i className="rev" />
      </div>
      <i className="wipe" />
    </div>
  );
  if (text === 'Double play') return (
    <div className="scn dp">
      <T x={64} y={1} w={2} cls="w1">DOUBLE</T><T x={64} y={17} w={2} cls="w2">PLAY</T>
      <i className="inv" /><i className="dgi" /><i className="dgo" />
    </div>
  );
  // Hits, and whatever else: speed streaks, the word rockets in, the name rises under it.
  const word = HIT[text] ?? clean(text);
  const sub = text === 'Stolen base' ? (sur ? `BASE - ${sur}`.slice(0, 16) : 'BASE') : full;
  return (
    <div className="scn hit">
      <div className="shk">
        {STREAKS.map(([y, n, dl], i) => <i key={i} className="stk" style={v({ '--y': y, '--n': n, '--dl': `${dl}ms` })} />)}
        <T x={64} y={2} w={word.length <= 8 ? 2 : 1} h={3} cls="rk">{word}</T>
        <i className="inv" />
        {sub && <T x={64} y={24} cls="xsub">{sub}</T>}
      </div>
      <i className="wipe" />
    </div>
  );
}

export function PinballBug({ g, air, away, home, abbrs, status, period, showLine, moment }: BugProps) {
  const live = status === 'live', top = g.half === 'top', ball = period === null;
  const play = live && ball;
  const bases = g.bases as { first?: boolean; second?: boolean; third?: boolean };
  const balls = g.balls | 0, strikes = g.strikes | 0, outs = g.outs | 0;
  const as = g.away_score | 0, hs = g.home_score | 0, runs = as + hs;
  const half = `${g.inning}${g.half}`;
  const bat = air.batter, pit = air.pitcher;
  const hr = moment?.text === 'Home run';
  const sur = bat ? surname(bat.name) : '';
  // Where the inning goes on the display when there is no inning to show.
  const word = status === 'final' ? 'FIN' : status === 'scheduled' ? 'VS' : clean((period ?? '').split(' ')[0]).slice(0, 3);

  const side = (brand: Brand, abbr: string, score: number, x: number, batting: boolean) => {
    const name = dmdName(brand, abbr);
    return (
      <>
        <T key={`n${score}`} x={x} y={1} cls={`nm${play && !batting ? ' off' : ''}${play && batting && name.length <= 5 ? ' mk' : ''}${score > 0 ? ' pulse' : ''}`}>{name}</T>
        <T key={`s${score}`} x={x} y={10} w={score > 99 ? 2 : 3} h={3}>{score}</T>
        {/* A run: the score box flashes inside out and throws a burst of dots. */}
        {score > 0 && <i key={`f${score}`} className="flash" style={v({ '--cx': x })} />}
        {score > 0 && <i key={`b${score}`} className="burst" style={v({ '--cx': x })} />}
      </>
    );
  };
  const lamps = (n: number, of: number, from: number) => Array.from({ length: of }, (_, i) => (
    <i key={`${i}${i < n ? 1 : 0}`} className={i < n ? 'lamp on pop' : 'lamp'} style={v({ '--i': from + i })} />
  ));
  const base = (on: boolean | undefined, k: string, i: number) => (
    <div key={`${k}${on ? 1 : 0}`} className={on ? `bs ${k} on` : `bs ${k}`} style={v({ '--i': i })}><i /></div>
  );
  const insert = (brand: Brand, abbr: string, t: 'away' | 'home', lit: boolean, i: number) => {
    const name = tabName(brand, abbr);
    return (
      <div className={`insw ${t}${lit ? ' on' : ''}`} style={v({ '--c': brand.color || '#888', '--i': i })}>
        <div className={name.length > 6 ? 'ins long' : 'ins'}><span>{name}</span></div>
      </div>
    );
  };
  // The half scene's row: arrow, TOP / BOT, the inning. Laid out in dots so it sits on the grid.
  const digits = String(g.inning).length, x0 = (128 - (68 + 24 * digits)) / 2;

  return (
    <div className={hr ? 'lk-pin chase' : 'lk-pin'}>
      <div className="cab">
        <div className="chrome"><div className="bezel">
          <i className="screw a" /><i className="screw b" /><i className="screw c" /><i className="screw d" />
          <div className="glass">
            <div className="dmd"><div className="lit">
              <div className="rest">
                {side(away, abbrs.away, as, 25, top)}
                {side(home, abbrs.home, hs, 103, !top)}
                <i className="dv" style={v({ left: '25rem' })} /><i className="dv" style={v({ left: '38.5rem' })} />
                {play ? (
                  <>
                    <i className={top ? 'tri' : 'tri dn'} />
                    <T key={half} x={64} y={9} w={digits > 1 ? 1 : 2} h={2}>{g.inning}</T>
                    <T key={`l${runs}`} x={64} y={25} cls={runs > 0 ? 'lbl wait' : 'lbl'}>{top ? 'TOP' : 'BOT'}</T>
                    {runs > 0 && <T key={`r${runs}`} x={64} y={25} cls="runw">{hr ? 'HR' : 'RUN'}</T>}
                  </>
                ) : word && <T x={64} y={9} h={2}>{word}</T>}
              </div>
              {play && sur && (
                <div key={`b${bat?.bid}`} className="scn bat">
                  <T x={20} y={1} n={11} cls="l type hd mid">NOW BATTING</T>
                  <T x={64} y={11} w={sur.length <= 8 ? 2 : 1} h={2} cls="sn">{sur}</T>
                  <i className="dl" /><i className="wipe" />
                </div>
              )}
              {play && (
                <div key={`h${half}`} className={g.inning === 1 && top ? 'scn half first' : 'scn half'}>
                  {/* Nobody was retired before the first pitch: the top of the first skips SIDE RETIRED. */}
                  {!(g.inning === 1 && top) && (
                    <div className="ph a">
                      <T x={64} y={1} w={2} cls="w1">SIDE</T><T x={64} y={17} w={2} cls="w2">RETIRED</T>
                      <i className="inv" /><i className="wipe" />
                    </div>
                  )}
                  <div className="ph b">
                    <i className={top ? 'tri' : 'tri dn'} style={v({ '--x': x0, '--y': 10 })} />
                    <T x={x0 + 14} y={7} w={2} cls="l">{top ? 'TOP' : 'BOT'}</T>
                    <T x={x0 + 68} y={0} w={3} cls="l">{g.inning}</T>
                    <T x={64} y={24} cls="mid">{dmdName(top ? away : home, top ? abbrs.away : abbrs.home)} AT BAT</T>
                    <i className="rev" />
                  </div>
                  <i className="wipe" />
                </div>
              )}
              {play && moment && <Moment key={`${moment.text}|${moment.who}`} text={moment.text} who={moment.who} runs={moment.runs} />}
            </div></div>
            <i className="unlit" /><i className="hot" />
          </div>
        </div></div>
        <div className="strip">
          {insert(away, abbrs.away, 'away', !play || top, 0)}
          {play ? (
            <>
              <div className="mid">
                <div className="count">
                  <div className="grp g-b"><b>B</b>{lamps(balls, 3, 1)}</div>
                  <div className="grp g-s"><b>S</b>{lamps(strikes, 2, 4)}</div>
                  <div className="grp g-o"><b>O</b>{lamps(outs, 2, 6)}</div>
                </div>
                <div className="ab">
                  {bat && <><b>AT BAT</b><span className="who">{bat.name}</span></>}
                  {bat && showLine && bat.avg && <span className="av">{bat.avg}</span>}
                  {bat && showLine && bat.today && <span className="td">{bat.today}</span>}
                  {pit && <span className="pc">P {pit.last}<em>{pit.pitches}</em></span>}
                </div>
              </div>
              <div className="bases">
                {base(bases.second, 'b2', 8)}{base(bases.third, 'b3', 9)}{base(bases.first, 'b1', 10)}
                <i className="plate" />
              </div>
            </>
          ) : <div className={live ? 'word sm' : 'word'}>{!live ? (status === 'final' ? 'Final' : 'Pregame') : period}</div>}
          {insert(home, abbrs.home, 'home', !play || !top, 11)}
        </div>
      </div>
    </div>
  );
}
