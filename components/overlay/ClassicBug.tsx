/* eslint-disable @next/next/no-img-element -- logos are small files from Storage, shown at fixed sizes */
import type { Brand } from '@/components/TeamBrand';
import { inkOn } from '@/lib/format';
import type { AirView } from '@/lib/onair';
import type { G } from '@/lib/scoring';

// The Classic look: a broadcast scorebug in one tight row, and everything on
// it moves when the game does.
//
// The motion is CSS, started by React: each part that can change carries a
// `key` made from its value, so a new value mounts a new element and its
// animation plays once. The score rolls, the team's tab catches a sheen, a
// base lights with a pulse, a ball or strike pip pops, an out lands with a
// ring, the inning flips and a wipe crosses the bug when the half turns, and
// the batter's line slides in. A play worth it (lib/onair momentText) takes
// the row over for a few seconds as a stinger.
const STING: Record<string, string> = {
  'Home run': 'hr', Strikeout: 'k', 'Strikeout looking': 'k look', 'Double play': 'dp', 'Stolen base': 'sb',
  Single: 'hit', Double: 'hit', Triple: 'hit', Walk: 'walk', 'Hit by pitch': 'walk', 'Sac fly': 'hit',
};
const vars = (b: Brand) => ({ '--c': b.color, '--c2': b.color2, '--ink': inkOn(b.color) }) as React.CSSProperties;
// A team's name in its tab: its display name when short, else as few letters as say it.
const tab = (b: Brand, abbr: string) => (b.display.length <= 10 ? b.display : abbr || b.display.slice(0, 6));

function Side({ brand, abbr, score, bat }: { brand: Brand; abbr: string; score: number; bat: boolean }) {
  return (
    <div className={`cb-team${bat ? ' bat' : ''}`} style={vars(brand)}>
      <div className="cb-tab">
        <i key={score} className="cb-sheen" />
        {brand.logo && <img src={brand.logo} alt="" />}
        <span>{tab(brand, abbr)}</span>
      </div>
      <div className="cb-score"><b key={score}>{score}</b></div>
    </div>
  );
}

export function ClassicBug({ g, air, away, home, abbrs, status, period, showLine, moment }: {
  g: G; air: AirView; away: Brand; home: Brand; abbrs: { away: string; home: string };
  status: 'scheduled' | 'live' | 'final';
  // For the sports that are score only: the period, in place of the inning and count.
  period: string | null; showLine: boolean; moment: { text: string; who: string } | null;
}) {
  const live = status === 'live', top = g.half === 'top';
  const ball = period === null;
  const bases = g.bases as { first?: boolean; second?: boolean; third?: boolean };
  const balls = g.balls | 0, strikes = g.strikes | 0, outs = g.outs | 0;
  const half = `${g.inning}${g.half}`;
  const base = (on: boolean | undefined, x: number, y: number, k: string) => (
    // The turn is on the group: the pulse animates the square's own transform, and would undo it.
    <g key={`${k}${on ? 1 : 0}`} transform={`rotate(45 ${x + 7.5} ${y + 7.5})`}><rect x={x} y={y} width="15" height="15" className={on ? 'on' : undefined} /></g>
  );
  const pips = (n: number, of: number, cls: string) => Array.from({ length: of }, (_, i) => <i key={`${i}${i < n ? 1 : 0}`} className={i < n ? `on ${cls}` : cls} />);
  const sting = moment ? STING[moment.text] ?? 'hit' : '';

  return (
    <div className="cb">
      <div className="cb-row">
        <Side brand={away} abbr={abbrs.away} score={g.away_score | 0} bat={ball && live && top} />
        <Side brand={home} abbr={abbrs.home} score={g.home_score | 0} bat={ball && live && !top} />
        {!live ? <div className="cb-word">{status === 'final' ? 'Final' : 'Pregame'}</div>
          : !ball ? <div className="cb-word">{period}</div> : (
            <>
              <div className="cb-inn" key={half}>
                <i className={top ? 'up on' : 'up'} /><b>{g.inning}</b><i className={top ? 'dn' : 'dn on'} />
              </div>
              <svg className="cb-dia" viewBox="0 0 60 44" aria-hidden="true">
                {base(bases.second, 22.5, 2, 's')}{base(bases.third, 5, 19.5, 't')}{base(bases.first, 40, 19.5, 'f')}
              </svg>
              <div className="cb-count">
                <span><em>B</em>{pips(balls, 3, 'b')}</span>
                <span><em>S</em>{pips(strikes, 2, 's')}</span>
              </div>
              <div className="cb-outs"><span>{pips(outs, 2, 'o')}</span><em>{outs === 1 ? '1 out' : `${outs} outs`}</em></div>
              <i key={`w${half}`} className="cb-wipe" />
            </>
          )}
        <div className={`cb-sting ${sting}${moment ? ' on' : ''}`} aria-hidden={!moment}>
          {moment && <><i /><b>{moment.text}</b>{moment.who && <span>{moment.who}</span>}</>}
        </div>
      </div>
      {ball && live && (air.batter || air.pitcher) && (
        <div className="cb-drawer">
          {air.batter && (
            <span key={air.batter.bid} className="cb-ab">
              <em>AB</em><b>{air.batter.name}</b>
              {showLine && air.batter.avg && <span className="gold">{air.batter.avg}</span>}
              {showLine && air.batter.today && <small>{air.batter.today}</small>}
            </span>
          )}
          {air.pitcher && <span className="cb-p"><em>P</em>{air.pitcher.last}<b key={air.pitcher.pitches}>{air.pitcher.pitches}</b></span>}
        </div>
      )}
    </div>
  );
}
