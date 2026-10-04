/* eslint-disable @next/next/no-img-element -- the club's crest layers, small fixed files from /public */
import './bluesteel.css';
import { Sparks } from '@/components/overlay/Sparks';
import type { Brand } from '@/components/TeamBrand';
import type { AirView } from '@/lib/onair';
import type { G } from '@/lib/scoring';

// Blue Steel, drawn here: Scoreboard's bug for the club (public/bugs/bluesteel.html),
// rebuilt as part of the page so the stat cards can sit behind its plate. The
// look is that page's: the layered skull crest that sways and whose eye
// burns, the bevelled steel plate with chamfered corners, clay bases, and the
// strip under it. The forge is kept too: a run strikes its score white-hot
// and it cools to steel blue, a strikeout is cut out of the side as a flag,
// and a home run is a plate stamped letter by letter.
//
// As in ClassicBug, the motion is CSS started by a `key`: a new value mounts
// a new element and its animation plays once. The sparks are a canvas of their
// own (Sparks.tsx). The original's full-frame intro is not carried over.
const IMG = '/bugs/img/bluesteel';
const HIT: Record<string, string> = { Single: 'ice', Double: 'ice', Triple: 'ice', 'Sac fly': 'ice', Walk: '', 'Hit by pitch': '', 'Double play': 'red', 'Stolen base': 'green' };
const tab = (b: Brand, abbr: string) => (b.display.length <= 10 ? b.display : abbr || b.display.slice(0, 6));

function Crest({ fire }: { fire: string | number }) {
  // Remounted when a run scores (or a big play lands): the feathers gust and the eye flares, once.
  return (
    <div key={fire} className="lg flare gust shine">
      <img className="u" src={`${IMG}-under.webp`} alt="" /><img className="f" src={`${IMG}-feathers.webp`} alt="" />
      <img className="s" src={`${IMG}-skull.webp`} alt="" /><i className="eye" /><i className="strk" /><i className="sh" />
    </div>
  );
}

function Side({ brand, abbr, score, bat }: { brand: Brand; abbr: string; score: number; bat: boolean }) {
  return (
    <div className={`team${bat ? ' bat' : ''}`} style={{ '--tc': brand.color } as React.CSSProperties}>
      <div className="slab"><span className="ab">{tab(brand, abbr)}</span></div>
      <div key={score} className="score"><span className="roll"><b>{score}</b></span></div>
    </div>
  );
}

export function BlueSteelBug({ g, air, away, home, abbrs, status, period, showLine, moment, topEdge }: {
  g: G; air: AirView; away: Brand; home: Brand; abbrs: { away: string; home: string };
  status: 'scheduled' | 'live' | 'final'; period: string | null; showLine: boolean; moment: { text: string; who: string } | null;
  // The bug is along the top of the picture: sparks fall away from it, downwards.
  topEdge: boolean;
}) {
  const live = status === 'live', top = g.half === 'top', ball = period === null;
  const bases = g.bases as { first?: boolean; second?: boolean; third?: boolean };
  const balls = g.balls | 0, strikes = g.strikes | 0, outs = g.outs | 0;
  const half = `${g.inning}${g.half}`;
  const runs = (g.away_score | 0) + (g.home_score | 0);
  const dots = (n: number, of: number) => Array.from({ length: of }, (_, i) => <i key={`${i}${i < n ? 1 : 0}`} className={i < n ? 'on pop' : undefined} />);
  const base = (on: boolean | undefined, x: number, y: number, cx: number, cy: number, k: string) => (
    <g key={`${k}${on ? 1 : 0}`} transform={`rotate(45 ${cx} ${cy})`}><rect className={on ? 'b on pop' : 'b'} x={x} y={y} width="13" height="13" /></g>
  );
  const k = moment?.text.startsWith('Strikeout') ? moment : null;
  const hr = moment?.text === 'Home run' ? moment : null;
  const tag = moment && !k && !hr ? moment : null;
  const bat = air.batter, pit = air.pitcher;
  const batBrand = top ? away : home;

  return (
    <div className="bsx">
      <Sparks away={g.away_score | 0} home={g.home_score | 0} moment={moment?.text ?? null} top={topEdge} />
      <div className="pkg">
        <div className="crest"><Crest fire={`${runs}${hr ? 'h' : ''}`} /></div>
        <div className="main">
          <div className="stack">
            <div className="plate"><div className="rail">
              <i key={`${runs}${half}`} className="spec" />
              <Side brand={away} abbr={abbrs.away} score={g.away_score | 0} bat={ball && live && top} />
              <Side brand={home} abbr={abbrs.home} score={g.home_score | 0} bat={ball && live && !top} />
              {!live ? <div className="sit word">{status === 'final' ? 'Final' : 'Pregame'}</div>
                : !ball ? <div className="sit word">{period}</div> : (
                  <div className="sit">
                    <div className="inn">
                      <i className={top ? 'arr up on' : 'arr up'} /><span className="n">{g.inning}</span><i className={top ? 'arr dn' : 'arr dn on'} />
                      {/* Between halves a steel shutter drops over the inning, then lifts. */}
                      <div key={half} className="shut"><small>{top ? 'Top' : 'Mid'}</small><b>{g.inning}</b></div>
                    </div>
                    <svg className="dia" viewBox="0 0 64 56" aria-hidden="true">
                      <path className="path" d="M32 49 L51 30 L32 11 L13 30 Z" />
                      <path className="plateH" d="M28.5 46.5 h7 v3.2 l-3.5 3 l-3.5 -3 z" />
                      {base(bases.second, 25.5, 4.5, 32, 11, 's')}{base(bases.third, 6.5, 23.5, 13, 30, 't')}{base(bases.first, 44.5, 23.5, 51, 30, 'f')}
                    </svg>
                    <div className="bso">
                      <em>B</em><div className="dots b">{dots(balls, 3)}</div>
                      <em>S</em><div className="dots s">{dots(strikes, 2)}</div>
                      <em>O</em><div className="dots o">{dots(outs, 2)}</div>
                    </div>
                  </div>
                )}
            </div></div>
            {ball && live && (bat || pit || tag) && (
              <div className="strip">
                {tag ? (
                  <div key={`t${tag.text}${tag.who}`} className="line in">
                    <span className={`tag ${HIT[tag.text] ?? 'hot'}`}>{tag.text}</span><span className="txt">{tag.who}</span>
                  </div>
                ) : (
                  <div key={bat?.bid ?? 'none'} className="line in">
                    {bat && <><span className="tag">AB</span><span className="txt">{bat.name}</span></>}
                    {bat && showLine && bat.avg && <span className="tag hot">{bat.avg}</span>}
                    {bat && showLine && bat.today && <span className="side" style={{ marginLeft: 0 }}>{bat.today}</span>}
                    {pit && <span className="side">P · {pit.last}<b>{pit.pitches}</b></span>}
                  </div>
                )}
              </div>
            )}
          </div>
          {k && (
            <div className={`kw play${k.text.endsWith('looking') ? ' looking' : ''}`}>
              <div className="kflag"><div className="kin">
                <div className="k"><span>K</span></div>
                <div className="kt"><b>{k.who || 'Strikeout'}</b><small>{k.text.endsWith('looking') ? 'Caught looking' : 'Struck out swinging'}</small></div>
              </div></div>
              <i className="blade" />
            </div>
          )}
          {hr && (
            <div className="hrw play">
              <div className="hr"><div className="hin">
                <div className="hcrest"><Crest fire="hr" /></div>
                <div className="hbody">
                  <div className="t1">{[...'Home run'].map((c, i) => (c === ' ' ? <span key={i} className="sp" /> : <span key={i} className="ch" style={{ '--i': i } as React.CSSProperties}>{c}</span>))}</div>
                  <div className="t2"><i style={{ '--tc': batBrand.color } as React.CSSProperties} /><b>{hr.who}</b><span>{tab(batBrand, top ? abbrs.away : abbrs.home)}</span></div>
                </div>
                <div className="gleam" />
              </div></div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
