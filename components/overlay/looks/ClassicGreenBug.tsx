import './classic-green.css';
import type { Brand } from '@/components/TeamBrand';
import { tabName, type BugProps } from '@/components/overlay/looks/types';

// Classic Green, drawn here: Scoreboard's hand-operated ballpark board
// (public/bugs/classic-green.html), rebuilt as part of the page so the stat
// cards can sit behind it. Painted green steel in an iron frame with brass
// rivets, dark number plates for R / H / E and the inning, an amber diamond,
// and a strip of incandescent count bulbs hung underneath.
//
// As in ClassicBug, the motion is CSS started by a `key`: a new value mounts a
// new element and its animation plays once. A plate flips to its new numeral, a
// run sweeps light across the team's row, glows its R plate and slides a tab
// out from under the board, a strikeout hangs a K card on a rope, and a home
// run drops the big banner with its chasing marquee bulbs. Bases, bulbs and
// the inning arrows keep their elements, so they fade as the original's did.
const OUT = new Set(['Double play']);
const FREE = new Set(['Walk', 'Hit by pitch', 'Stolen base']);

// The marquee bulbs round the home run banner's edge, laid out once (the original's sums).
const BULBS: { left: string; top: string; delay: string }[] = (() => {
  const W = 1120, H = 330, gap = 34, pts: [number, number][] = [];
  for (let x = 0; x <= W; x += gap) pts.push([x, 0]);
  for (let y = gap; y <= H; y += gap) pts.push([W, y]);
  for (let x = W - gap; x >= 0; x -= gap) pts.push([x, H]);
  for (let y = H - gap; y > 0; y -= gap) pts.push([0, y]);
  return pts.map(([x, y], i) => ({ left: `${(x / W) * 100}%`, top: `${(y / H) * 100}%`, delay: `${-(i % 3) * 0.166}s` }));
})();

function Plate({ v, runs }: { v: number | string; runs?: boolean }) {
  // A run remounts the whole R plate so it glows; any plate's numeral remounts to flip in.
  return (
    <div key={runs ? v : undefined} className={`plate${runs ? ' runs' : ''}${runs && Number(v) > 0 ? ' pop' : ''}`}>
      <span key={v} className="v">{v}</span>
    </div>
  );
}

function Row({ brand, abbr, r, h, e, bat, full }: { brand: Brand; abbr: string; r: number; h: number; e: number; bat: boolean; full: boolean }) {
  return (
    <>
      <div className="xchip" style={{ '--team': brand.color } as React.CSSProperties} />
      <div className={`name${bat ? ' batting' : ''}`}>
        <span className="t">{tabName(brand, abbr)}</span><i className="bat" />
        {r > 0 && <i key={r} className="sw" />}
      </div>
      <Plate v={r} runs />
      {full && <><Plate v={h} /><Plate v={e} /></>}
    </>
  );
}

export function ClassicGreenBug({ g, air, away, home, abbrs, status, period, showLine, moment }: BugProps) {
  const live = status === 'live', top = g.half === 'top', ball = period === null;
  const play = live && ball;
  const bases = g.bases as { first?: boolean; second?: boolean; third?: boolean };
  const balls = g.balls | 0, strikes = g.strikes | 0, outs = g.outs | 0;
  const ar = g.away_score | 0, hm = g.home_score | 0;
  const bulbs = (n: number, of: number) => Array.from({ length: of }, (_, i) => <i key={i} className={i < n ? 'bulb on' : 'bulb'} />);
  const k = moment?.text.startsWith('Strikeout') ? moment : null;
  const hr = moment?.text === 'Home run' ? moment : null;
  const tag = moment && !k && !hr ? moment : null;
  const looking = !!k && k.text.endsWith('looking');
  const bat = air.batter, pit = air.pitcher;
  const batBrand = top ? away : home;

  return (
    <div className="lk-cg">
      <div className="pkg">
        <div className="board">
          <div className="rivets" />
          <div className={ball ? 'lines' : 'lines one'}>
            <span /><span />
            <span className="col-h">R</span>
            {ball && <><span className="col-h">H</span><span className="col-h">E</span></>}
            <Row brand={away} abbr={abbrs.away} r={ar} h={Number(g.away_hits) || 0} e={Number(g.away_errors) || 0} bat={play && top} full={ball} />
            <Row brand={home} abbr={abbrs.home} r={hm} h={Number(g.home_hits) || 0} e={Number(g.home_errors) || 0} bat={play && !top} full={ball} />
          </div>
          {!live ? <div className="side word">{status === 'final' ? 'Final' : 'Pregame'}</div>
            : !ball ? <div className="side word">{period}</div> : (
              <div className="side">
                <div className="inning">
                  <div className="arrows"><i className={top ? 'arrow up on' : 'arrow up'} /><i className={top ? 'arrow down' : 'arrow down on'} /></div>
                  <Plate v={g.inning} />
                </div>
                <div className="diamond">
                  <i className={bases.second ? 'base b2 on' : 'base b2'} /><i className={bases.third ? 'base b3 on' : 'base b3'} /><i className={bases.first ? 'base b1 on' : 'base b1'} />
                </div>
              </div>
            )}
          {/* The props carry the score, not how many came home, so the tab says a run is in rather than "+2 RUNS". */}
          {live && ar > 0 && <div key={`a${ar}`} className="runtab">RUN IN</div>}
          {live && hm > 0 && <div key={`h${hm}`} className="runtab home">RUN IN</div>}
        </div>

        {play && (
          <div className="strip">
            <div className="grp balls"><b>B</b>{bulbs(balls, 3)}</div>
            <div className="grp strikes"><b>S</b>{bulbs(strikes, 2)}</div>
            <div className="grp outs"><b>O</b>{bulbs(outs, 2)}</div>
            {tag ? (
              <div key={`t${tag.text}${tag.who}`} className="batter">
                <span className={`mo${OUT.has(tag.text) ? ' out' : FREE.has(tag.text) ? ' walk' : ''}`}>{tag.text}</span>
                {tag.who && <span className="bn">{tag.who}</span>}
              </div>
            ) : (bat || pit) && (
              <div key={bat?.bid ?? 'none'} className="batter">
                {bat && <span className="bn">{bat.name}</span>}
                {bat && showLine && bat.avg && <span className="av">{bat.avg}</span>}
                {bat && showLine && bat.today && <span className="td">{bat.today}</span>}
                {pit && <span className="pc">{pit.last} · P {pit.pitches}</span>}
              </div>
            )}
          </div>
        )}

        {hr && (
          <div key={`hr${hr.who}`} className="hr">
            <div className="marquee">{BULBS.map((b, i) => <i key={i} className="mb" style={{ left: b.left, top: b.top, animationDelay: b.delay }} />)}</div>
            <div className="hr-word">
              {[...'HOME RUN'].map((c, i) => (c === ' ' ? <i key={i} className="gap" />
                : <div key={i} className={c === 'M' ? 'lp wide' : 'lp'} style={{ '--i': i } as React.CSSProperties}><span>{c}</span></div>))}
            </div>
            <div className="hr-who">{hr.who}</div>
            <div className="hr-sub">{hr.runs === 1 ? 'Solo shot' : hr.runs >= 4 ? 'Grand slam' : hr.runs > 1 ? `${hr.runs} runs score` : tabName(batBrand, top ? abbrs.away : abbrs.home)}</div>
          </div>
        )}
        {k && (
          <div key={`k${k.text}${k.who}`} className={looking ? 'kcard looking' : 'kcard'}>
            <div className="rope" />
            <div className="xcard"><div className="k">K</div><div className="kl">{looking ? 'Caught looking' : 'Strikeout'}</div></div>
          </div>
        )}
      </div>
    </div>
  );
}
