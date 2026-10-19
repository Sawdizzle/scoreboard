import { sprayCounts, sprayLabel, sprayPlaces, type SprayBall, type SprayResult } from '@/lib/spray';

// Where a batter's balls in play went, on the pad's own field: the fielder
// picker's drawing (components/pad/PadSheets.tsx), in the shape it has on a
// phone, so a mark sits where the scorer dropped the fielder. Hits, outs and
// the rest differ in shape as well as colour: a disc, a cross, a ring.
const ASPECT = 1.4; // the picker on a 375-pixel phone is about 347 by 250
const W = 100 * ASPECT;
const R = 2.1; // a mark's radius, in the chart's units (a hundredth of its height)
const PAD = R + 0.5; // room at the edges, for a ball dragged right to one
const BASES: [number, number][] = [[72, 66], [50, 44], [28, 66]];
const KEY: [SprayResult, string, string][] = [['hit', 'hit', 'hits'], ['out', 'out', 'outs'], ['reached', 'safe on E or FC', 'safe on E or FC']];
// Hits drawn last, so an out never covers one.
const DRAW: Record<SprayResult, number> = { out: 0, reached: 1, hit: 2 };

function Mark({ result }: { result: SprayResult }) {
  if (result !== 'out') return <circle r={R} />;
  const d = `M${-R * 0.75} ${-R * 0.75} L${R * 0.75} ${R * 0.75} M${R * 0.75} ${-R * 0.75} L${-R * 0.75} ${R * 0.75}`;
  return <><path d={d} className="spray-halo" /><path d={d} /></>;
}

export function SprayChart({ balls }: { balls: SprayBall[] }) {
  const n = sprayCounts(balls);
  const drawn = n.hit + n.out + n.reached;
  const places = sprayPlaces(balls, ASPECT, R * 2 + 0.4).sort((a, b) => DRAW[a.ball.result] - DRAW[b.ball.result]);
  const many = (k: number, one: string, more: string) => `${k} ${k === 1 ? one : more}`;
  return (
    <>
      <h2 className="h-sec" style={{ padding: '0 4px' }}>Spray chart</h2>
      {drawn ? (
        <div className="spray">
          <svg className="spray-field" viewBox={`${-PAD} ${-PAD} ${W + PAD * 2} ${100 + PAD * 2}`} role="img"
            aria-label={`${many(drawn, 'ball', 'balls')} in play: ${many(n.hit, 'hit', 'hits')}, ${many(n.out, 'out', 'outs')}${n.reached ? `, ${n.reached} safe on an error or a fielder’s choice` : ''}`}>
            <g transform={`scale(${ASPECT} 1)`}>
              <path d="M50 97 L4 34 A62 62 0 0 1 96 34 Z" className="fp-grass" />
              <path d="M50 92 L28 66 L50 44 L72 66 Z" className="fp-dirt" />
            </g>
            {BASES.map(([x, y]) => <rect key={x * 100 + y} className="spray-base" x={x * ASPECT - 1} y={y - 1} width={2} height={2} transform={`rotate(45 ${x * ASPECT} ${y})`} />)}
            <path className="spray-base" d={`M${50 * ASPECT - 1.2} 90.8 h2.4 v1.2 l-1.2 1.2 l-1.2 -1.2 z`} />
            {places.map(({ ball, x, y }) => (
              <g key={ball.event_id} className={`spray-${ball.result}`} transform={`translate(${x} ${y})`}>
                <title>{sprayLabel(ball)}</title>
                <Mark result={ball.result} />
              </g>
            ))}
          </svg>
          <ul className="spray-key">
            {KEY.filter(([k]) => k !== 'reached' || n.reached).map(([k, one, more]) => (
              <li key={k}>
                <svg viewBox={`${-PAD} ${-PAD} ${PAD * 2} ${PAD * 2}`} className={`spray-${k}`} aria-hidden="true"><Mark result={k} /></svg>
                <span><b>{n[k]}</b> {n[k] === 1 ? one : more}</span>
              </li>
            ))}
          </ul>
          {n.unspotted > 0 && <p className="source">{many(n.unspotted, 'more ball', 'more balls')} in play had no spot.</p>}
        </div>
      ) : (
        <p className="sub" style={{ padding: '0 4px' }}>No spots yet for {n.unspotted === 1 ? 'this ball' : `these ${n.unspotted} balls`} in play. On the pad, drag the fielder to where the ball went.</p>
      )}
    </>
  );
}
