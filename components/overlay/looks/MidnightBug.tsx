import './midnight.css';
import { tabName, type BugProps } from '@/components/overlay/looks/types';

// Midnight, drawn here: Scoreboard's night-game bug (public/bugs/midnight.html),
// rebuilt as part of the page so the stat cards can sit behind its plate. The
// look is that page's: a moon at the edge with a breathing halo, a navy plate
// that is a window on a drifting, twinkling sky, gold bases and count, and the
// strip under it. Its moments are kept too: a run strikes the score with
// starlight as a shooting star crosses the plate, a hit runs a line of light
// round the little diamond, a strikeout is a bank of stadium bulbs that punches
// a K on and goes dark, a home run is the moonshot banner, and between halves
// a small moon rises in the inning box.
//
// As in ClassicBug, the motion is CSS started by a `key`: a new value mounts
// a new element and its animation plays once. The original's canvas (comets,
// stardust, fireworks) and its full-frame intro are not carried over.
type V = React.CSSProperties;
const TAG: Record<string, [tag: string, cls: string, fallback: string]> = {
  'Home run': ['HR', 'hot', 'Home run'], Strikeout: ['K', 'red', 'Strikeout swinging'], 'Strikeout looking': ['ꓘ', 'red', 'Called strike three'],
  Single: ['Single', 'ice', 'Base hit'], Double: ['Double', 'ice', 'Base hit'], Triple: ['Triple', 'ice', 'Base hit'],
  Walk: ['Walk', 'green', 'Ball four'], 'Hit by pitch': ['HBP', 'green', 'Hit by pitch'],
  'Double play': ['DP', 'red', 'Double play'], 'Stolen base': ['SB', 'green', 'Stolen base'], 'Sac fly': ['Sac fly', 'ice', 'Sacrifice fly'],
};
// How far round the diamond the line of light runs for a play.
const BASES: Record<string, number> = { Single: 1, Double: 2, Triple: 3, Walk: 1, 'Hit by pitch': 1 };
// A K on a 5 x 7 bank, in the order the bulbs strike: the stem, then both arms out from the middle.
const K_ORDER = [[0, 0], [0, 1], [0, 2], [0, 3], [0, 4], [0, 5], [0, 6], [1, 3], [2, 2], [2, 4], [3, 1], [3, 5], [4, 0], [4, 6]];
// Twinkling stars: left %, top %, period s, head start s, warm.
const TW: [number, number, number, number, boolean][] = [
  [6, 12, 3.1, 0.4, false], [15, 88, 4.4, 2.1, true], [24, 8, 2.6, 3.3, false], [33, 91, 5, 1.2, false], [41, 18, 3.7, 4.5, true], [50, 84, 2.9, 0.9, false],
  [58, 10, 4.8, 2.8, false], [67, 93, 3.3, 3.9, true], [76, 21, 2.4, 1.7, false], [85, 86, 4.1, 4.8, false], [94, 14, 3.5, 0.2, false],
];
const TW_HR: [number, number, number, number, boolean][] = [
  ...TW, [10, 22, 4.6, 1.5, true], [29, 82, 2.7, 3.1, false], [46, 6, 3.9, 2.4, false], [62, 89, 4.3, 0.7, false], [72, 9, 2.5, 4.1, true], [89, 81, 3.2, 2.9, false], [97, 23, 5.1, 1.1, false],
];
const surname = (n: string) => n.trim().split(/\s+/).pop() ?? '';

function Moon({ flare, extra }: { flare?: string | number; extra?: boolean }) {
  // The halo is remounted when a run scores, and flares once; a big play adds a flare of its own.
  return (
    <>
      <i key={flare} className="halo" />{extra && <i className="halo x" />}
      <svg viewBox="0 0 100 100" aria-hidden="true"><use href="#lkmnMoon" /></svg>
      <i className="cl" /><i className="cl" />
    </>
  );
}

function Stars({ tw }: { tw: typeof TW }) {
  return (
    <>
      {tw.map(([l, t, d, dl, g], i) => <i key={i} className={g ? 'tw g' : 'tw'} style={{ left: `${l}%`, top: `${t}%`, '--d': `${d}s`, '--dl': `-${dl}s` } as V} />)}
      <i className="l1" /><i className="l2" />
    </>
  );
}

export function MidnightBug({ g, air, away, home, abbrs, status, period, showLine, moment }: BugProps) {
  const live = status === 'live', top = g.half === 'top', ball = period === null;
  const bases = g.bases as { first?: boolean; second?: boolean; third?: boolean };
  const balls = g.balls | 0, strikes = g.strikes | 0, outs = g.outs | 0;
  const inning = Number(g.inning) || 1;
  const half = `${g.inning}${g.half}`;
  const runs = (g.away_score | 0) + (g.home_score | 0);
  const dots = (n: number, of: number) => Array.from({ length: of }, (_, i) => <i key={`${i}${i < n ? 1 : 0}`} className={i < n ? 'on pop' : undefined} />);
  const base = (on: boolean | undefined, x: number, y: number, cx: number, cy: number, k: string) => (
    <g key={`${k}${on ? 1 : 0}`} transform={`rotate(45 ${cx} ${cy})`}><rect className={on ? 'b on pop' : 'b'} x={x} y={y} width="13" height="13" /></g>
  );
  const team = (side: 'away' | 'home') => {
    const brand = side === 'away' ? away : home, score = (side === 'away' ? g.away_score : g.home_score) | 0;
    const bat = ball && live && (side === 'away') === top;
    return (
      <div className={`team${bat ? ' bat' : ''}`} style={{ '--tc': brand.color } as V}>
        <i className="pip" /><span className="ab">{tabName(brand, abbrs[side])}</span>
        <div key={score} className="score"><span className="roll"><b>{score}</b></span></div>
      </div>
    );
  };
  const k = moment?.text.startsWith('Strikeout') ? moment : null;
  const looking = !!k && k.text.endsWith('looking');
  const hr = moment?.text === 'Home run' ? moment : null;
  const mkey = moment ? `${moment.text}${moment.who}` : '';
  const tag = moment ? TAG[moment.text] ?? [moment.text, 'ice', ''] : null;
  const run = moment ? BASES[moment.text] ?? 0 : 0;
  const big = !!hr || moment?.text === 'Double' || moment?.text === 'Triple';
  const bat = air.batter, pit = air.pitcher;
  const batBrand = top ? away : home;
  const said = k && k.who ? `${k.who} ${looking ? 'caught looking' : 'strikes out'}` : moment && moment.text === 'Walk' && moment.who ? `${moment.who} takes first` : moment?.who || tag?.[2];
  // The moon that rises in the inning box says what just ended.
  const rise: [string, number] = !top ? ['MID', inning] : inning > 1 ? ['END', inning - 1] : ['TOP', 1];
  const kWho = k ? [surname(k.who), pit?.last].filter(Boolean).join(' · ') : '';

  return (
    <div className="lk-mn">
      {/* The moon, drawn once and used wherever it appears. */}
      <svg className="defs" width="0" height="0" aria-hidden="true">
        <defs>
          <radialGradient id="lkmnLit" cx="36%" cy="40%" r="70%">
            <stop offset="0" stopColor="#fffdf5" /><stop offset=".45" stopColor="#f5eacb" /><stop offset=".8" stopColor="#dccb9c" /><stop offset="1" stopColor="#bfae80" />
          </radialGradient>
          <radialGradient id="lkmnDark" cx="64%" cy="34%" r="72%"><stop offset="0" stopColor="#2a3550" /><stop offset="1" stopColor="#151c2e" /></radialGradient>
          <radialGradient id="lkmnCr" cx="45%" cy="40%" r="60%">
            <stop offset="0" stopColor="#b3a273" stopOpacity=".15" /><stop offset=".7" stopColor="#a38f62" stopOpacity=".55" /><stop offset="1" stopColor="#8f7c52" stopOpacity=".2" />
          </radialGradient>
          <filter id="lkmnSoft" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="2.4" /></filter>
          <mask id="lkmnMask" maskUnits="userSpaceOnUse" x="0" y="0" width="100" height="100">
            <rect width="100" height="100" fill="#fff" /><circle cx="73" cy="33" r="36" fill="#000" filter="url(#lkmnSoft)" />
          </mask>
          <symbol id="lkmnMoon" viewBox="0 0 100 100">
            <circle cx="50" cy="50" r="40" fill="url(#lkmnDark)" opacity=".8" />
            <g mask="url(#lkmnMask)">
              <circle cx="50" cy="50" r="40" fill="url(#lkmnLit)" />
              <circle cx="33" cy="58" r="8.5" fill="url(#lkmnCr)" /><circle cx="47" cy="76" r="5.5" fill="url(#lkmnCr)" /><circle cx="22" cy="42" r="4.6" fill="url(#lkmnCr)" />
              <circle cx="29" cy="75" r="3.2" fill="url(#lkmnCr)" /><circle cx="59" cy="66" r="3.6" fill="url(#lkmnCr)" /><circle cx="18" cy="58" r="2.4" fill="url(#lkmnCr)" />
            </g>
            <circle cx="50" cy="50" r="39.6" fill="none" stroke="rgba(255,255,255,.14)" strokeWidth="0.8" />
          </symbol>
        </defs>
      </svg>
      <div className="pkg">
        <div className="mn"><Moon flare={runs} extra={!!k || !!hr} /></div>
        <div className="main">
          <div className="xstack">
            <div className="plate"><div className="rail">
              <div className="sky"><Stars tw={TW} /><i className="shoot idle" /><i key={runs} className="shoot run" /></div>
              {team('away')}{team('home')}
              {!live ? <div className="sit word">{status === 'final' ? 'Final' : 'Pregame'}</div>
                : !ball ? <div className="sit word">{period}</div> : (
                  <div className="sit">
                    {/* Between halves a small moon rises over the inning, then sets. */}
                    <div key={half} className="inn">
                      <i className={top ? 'arr up on' : 'arr up'} /><span className="n">{g.inning}</span><i className={top ? 'arr dn' : 'arr dn on'} />
                      <div className="rise"><small>{rise[0]}</small><b>{rise[1]}</b></div>
                    </div>
                    <svg className="dia" viewBox="0 0 64 56" aria-hidden="true">
                      <path className="path" d="M32 49 L51 30 L32 11 L13 30 Z" />
                      <path className="plateH" d="M28.5 46.5 h7 v3.2 l-3.5 3 l-3.5 -3 z" />
                      {run > 0 && <path key={mkey} className={moment?.text === 'Walk' || moment?.text === 'Hit by pitch' ? 'trace ice' : 'trace'} pathLength={4} d="M32 49 L51 30 L32 11 L13 30 L32 49" style={{ '--k': run } as V} />}
                      {base(bases.second, 25.5, 4.5, 32, 11, 's')}{base(bases.third, 6.5, 23.5, 13, 30, 't')}{base(bases.first, 44.5, 23.5, 51, 30, 'f')}
                    </svg>
                    <div className="bso">
                      <em>B</em><div className="dots b">{dots(balls, 3)}</div>
                      <em>S</em><div className="dots s">{dots(strikes, 2)}</div>
                      <em>O</em><div className="dots o">{dots(outs, 2)}</div>
                    </div>
                  </div>
                )}
              {/* The searchlight: when a run scores or the half turns, and again for a big play. */}
              <i key={`${runs}${half}`} className="sweep" />{big && <i key={mkey} className="sweep" />}
            </div></div>
            {ball && live && (
              <div className="strip">
                {tag ? (
                  <div key={`t${mkey}`} className="line in"><span className={`xtag ${tag[1]}`}>{tag[0]}</span><span className="txt">{said}</span></div>
                ) : (
                  <div key={bat?.bid ?? half} className="line in">
                    {bat ? <><span className="xtag">AB</span><span className="txt">{bat.name}</span></>
                      : <><span className="xtag">{top ? 'Top' : 'Bot'} {g.inning}</span><span className="txt">{outs === 1 ? '1 out' : `${Math.min(outs, 2)} outs`}</span></>}
                    {bat && showLine && bat.avg && <span className="xtag hot">{bat.avg}</span>}
                    {bat && showLine && bat.today && <span className="side today">{bat.today}</span>}
                    {pit && <span className="side">P · {pit.last}{!!pit.pitches && <b>{pit.pitches}</b>}</span>}
                  </div>
                )}
              </div>
            )}
          </div>
          {k && (
            <div key={mkey} className="kw">
              <div className="kflag"><div className="kin">
                <div className="bank">
                  {Array.from({ length: 35 }, (_, n) => {
                    const i = K_ORDER.findIndex(([c, r]) => r * 5 + (looking ? 4 - c : c) === n);
                    return i < 0 ? <i key={n} /> : <i key={n} className="on" style={{ '--on': `${260 + i * 42 + (i >= 7 ? 60 : 0)}ms`, '--off': `${3050 + (K_ORDER.length - 1 - i) * 26}ms` } as V} />;
                  })}
                </div>
                <div className="kt"><b>{looking ? 'Called strike three' : 'Strikes out swinging'}</b>{kWho && <small>{kWho}</small>}</div>
              </div></div>
            </div>
          )}
          {hr && (
            <div key={mkey} className="hrw">
              <div className="hr"><div className="hin">
                <div className="sky"><Stars tw={TW_HR} /></div>
                <i className="beam b1" /><i className="beam b2" />
                <div className="bigmoon mn"><Moon /></div>
                <i className="ball" /><i className="pop" /><i className="pop r" />
                <div className="hbody">
                  <div className="t1">{[...'Home run'].map((c, i) => (c === ' ' ? <span key={i} className="sp" /> : <span key={i} className="tx" style={{ '--i': i } as V}>{c}</span>))}</div>
                  <div className="t2" style={{ '--tc': batBrand.color } as V}>
                    <i /><b>{[hr.who, tabName(batBrand, top ? abbrs.away : abbrs.home)].filter(Boolean).join(' · ')}</b><span>Moonshot</span>
                  </div>
                </div>
              </div></div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
