'use client';

import './fx.css';
import { useMemo } from 'react';

// v4's stingers on the v5 stream: the full-frame moments (walk-off, touchdown,
// goal, home run), the cards that slide out beside the scorebug for the
// smaller ones, the run flash, and the rally glow that stays up while it is
// on. Each one is keyed by its stamp, so a new one restarts the animation.
export type FxShot = { kind: string; n: number; meta?: Record<string, unknown> };

const REVEAL: Record<string, string> = {
  fieldgoal: 'Field goal', turnover: 'Turnover', bigplay: 'Big play', ace: 'Ace!', three: 'Three!', setwin: 'Set won',
  doubleplay: 'Double play', stolenbase: 'Stolen base', charge: 'Charge!',
};
const CONFETTI = ['#8fb6de', '#e8b23a', '#f4f7fb', '#3b6fd6', '#d1483f'];

// A burst of pieces flying out from one point. Seeded by the stamp, so a
// redraw of the same shot does not scatter them anew.
function pieces(n: number, seed: number, cls: string, delay: number, colors?: string[]) {
  let x = seed % 2147483647 || 1;
  const rnd = () => (x = (x * 48271) % 2147483647) / 2147483647;
  return Array.from({ length: n }, (_, i) => {
    const ang = (Math.PI * 2 * i) / n + rnd() * 0.6, dist = 8 + rnd() * 16;
    return <i key={i} className={cls} style={{
      '--dx': `${(Math.cos(ang) * dist).toFixed(1)}rem`, '--dy': `${(Math.sin(ang) * dist).toFixed(1)}rem`, '--r': `${Math.round(rnd() * 720 - 360)}deg`,
      animationDelay: `${(delay + rnd() * 0.2).toFixed(2)}s`, ...(colors ? { background: colors[i % colors.length] } : {}),
    } as React.CSSProperties} />;
  });
}

export function Fx({ shot, rally, top }: { shot: FxShot | null; rally: boolean; top: boolean }) {
  const body = useMemo(() => {
    if (!shot) return null;
    const { kind, n, meta = {} } = shot;
    if (kind === 'walkoff' || kind === 'goal') {
      return <div key={n} className="fx-item fx-walkoff"><div className="wo-text">{kind === 'goal' ? 'GOAL!' : 'WALK-OFF!'}</div><div className="wo-particles">{pieces(40, n, 'confetti', 0.15, CONFETTI)}</div></div>;
    }
    if (kind === 'homerun' || kind === 'touchdown') {
      const [l1, l2] = kind === 'homerun' ? ['HOME', 'RUN'] : ['TOUCH', 'DOWN'];
      return (
        <div key={n} className="fx-item fx-hr">
          {kind === 'homerun' && <div className="hr-ball" />}
          <div className="hr-rays" />
          <div className="hr-plate"><span className="hr-l1">{l1}</span><span className="hr-l2">{l2}</span></div>
          <div className="hr-particles">{pieces(30, n, 'chalk', kind === 'homerun' ? 0.85 : 0.4)}</div>
        </div>
      );
    }
    if (kind === 'run') return <div key={n} className="fx-item fx-run-flash" />;
    const title = kind === 'setwin' && meta.away != null && meta.home != null ? `Set won ${meta.away}–${meta.home}` : REVEAL[kind];
    if (!title) return null;
    return (
      <div key={n} className={`fx-reveal ${top ? 'from-top' : 'from-bottom'}`}>
        <div className="reveal-card"><span className="rv-title">{title}</span>{typeof meta.sub === 'string' && <span className="rv-sub">{meta.sub}</span>}</div>
      </div>
    );
  }, [shot, top]);
  return (
    <div className={`fx${rally ? ' rally' : ''}`} aria-hidden="true">
      {body}
    </div>
  );
}
