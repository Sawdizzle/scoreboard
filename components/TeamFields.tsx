'use client';

import { useState } from 'react';
import { abbrFor, inkOn } from '@/lib/format';

// A team's identity, with the slab it makes shown as it is typed: this is the
// block the scorebug will draw. The abbreviation follows the name until it is
// edited by hand.
export function TeamFields({ name = '', abbr = '', color = '#2f63cc', ageGroup = '' }: {
  name?: string; abbr?: string; color?: string; ageGroup?: string;
}) {
  const [n, setN] = useState(name);
  const [a, setA] = useState(abbr);
  const [c, setC] = useState(color);
  const [touched, setTouched] = useState(abbr !== '');
  const shown = (touched ? a : abbrFor(n)) || 'TEAM';
  return (
    <>
      <div className="next-slab slab" style={{ '--team': c, '--team-ink': inkOn(c), borderRadius: 14 } as React.CSSProperties}>
        <span className="disp">{shown}</span>
        <small>{n || 'Team name'}</small>
      </div>
      <label className="field"><span>Team name</span>
        <input className="input" name="name" value={n} onChange={(e) => setN(e.target.value)} maxLength={60} required autoComplete="off" />
      </label>
      <div className="field-row">
        <label className="field"><span>On the scorebug</span>
          <input className="input" name="abbr" value={touched ? a : abbrFor(n)} maxLength={6} required autoComplete="off" autoCapitalize="characters"
            onChange={(e) => { setTouched(true); setA(e.target.value.toUpperCase()); }} />
        </label>
        <label className="field"><span>Age group</span>
          <input className="input" name="age_group" defaultValue={ageGroup} maxLength={12} placeholder="14U" autoComplete="off" />
        </label>
        <label className="field"><span>Colour</span>
          <input className="input" type="color" name="color" value={c} onChange={(e) => setC(e.target.value)} />
        </label>
      </div>
    </>
  );
}
