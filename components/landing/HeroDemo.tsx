'use client';

import Image from 'next/image';
import { useEffect, useState } from 'react';

// The front page's demo, one at-bat on a loop: the scorer taps the pad, the
// stream's scorebug follows, a home run gets its moment, and a parent's phone
// hears about it. Every frame is drawn here (no video), so it stays sharp and
// light. With reduced motion asked for, it rests on the home run.
type Frame = {
  tap: 'ball' | 'strike' | 'inplay' | null;
  balls: number; strikes: number; home: number; away: number;
  first: boolean; moment: string | null; push: boolean; caption: string;
};
const FRAMES: Frame[] = [
  { tap: null, balls: 0, strikes: 0, home: 2, away: 4, first: true, moment: null, push: false, caption: 'Bottom 5th. The scorer has the pad.' },
  { tap: 'ball', balls: 1, strikes: 0, home: 2, away: 4, first: true, moment: null, push: false, caption: 'Tap BALL. The stream knows.' },
  { tap: 'strike', balls: 1, strikes: 1, home: 2, away: 4, first: true, moment: null, push: false, caption: 'Tap STRIKE. Same second.' },
  { tap: 'inplay', balls: 1, strikes: 1, home: 2, away: 4, first: true, moment: null, push: false, caption: 'In play...' },
  { tap: null, balls: 0, strikes: 0, home: 4, away: 4, first: false, moment: 'HOME RUN', push: false, caption: 'Home run. The stream gets its moment.' },
  { tap: null, balls: 0, strikes: 0, home: 4, away: 4, first: false, moment: null, push: true, caption: 'Parents hear it too, wherever they are.' },
];
const STEP_MS = 1900;

export function HeroDemo() {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- the reader's setting is only known here
      setI(4);
      return;
    }
    const t = setInterval(() => setI((n) => (n + 1) % FRAMES.length), STEP_MS);
    return () => clearInterval(t);
  }, []);
  const f = FRAMES[i];
  const dots = (n: number, of: number, cls: string) => Array.from({ length: of }, (_, k) => <i key={k} className={k < n ? cls : ''} />);
  return (
    <div className="demo" aria-hidden="true">
      <div className="demo-stream">
        <div className="demo-field" />
        <span className="demo-live">LIVE</span>
        <div className="demo-bug">
          <div className="bug-team" style={{ '--c': '#1a7541' } as React.CSSProperties}><b>RIVER</b><span key={`a${f.away}`} className="bug-n">{f.away}</span></div>
          <div className="bug-team" style={{ '--c': '#2857b5' } as React.CSSProperties}><b>STEEL</b><span key={`h${f.home}`} className="bug-n">{f.home}</span></div>
          <div className="bug-sit">
            <span className="bug-inn">▼ 5</span>
            <span className="bug-bases"><i className={f.first ? 'on' : ''} /><i /><i /></span>
            <span className="bug-count">
              <span className="dots">{dots(f.balls, 3, 'b')}</span>
              <span className="dots">{dots(f.strikes, 2, 's')}</span>
              <span className="dots">{dots(1, 2, 'o')}</span>
            </span>
          </div>
        </div>
        {f.moment && <div key={i} className="demo-moment"><span>{f.moment}</span><small>Ruiz · 2 runs</small></div>}
      </div>

      <div className="demo-phone">
        <Image src="/landing/pad.png" alt="" width={390} height={844} priority />
        {f.tap && <span key={i} className={`demo-tap ${f.tap}`} />}
      </div>

      <div className={`demo-push${f.push ? ' on' : ''}`}>
        <svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M12 22a2.5 2.5 0 0 0 2.45-2h-4.9A2.5 2.5 0 0 0 12 22Zm7-6V11a7 7 0 0 0-5-6.7V3.5a2 2 0 1 0-4 0v.8A7 7 0 0 0 5 11v5l-2 2v1h18v-1l-2-2Z" /></svg>
        <span><b>Blue Steel</b>Home run! Ruiz, 2 runs. Steel 4, River 4 in the 5th.</span>
      </div>

      <p className="demo-caption" key={`c${i}`}>{f.caption}</p>
    </div>
  );
}
