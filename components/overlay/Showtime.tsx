'use client';
/* eslint-disable @next/next/no-img-element -- logos are small files from Storage, shown at fixed sizes */

import './showtime.css';
import type { ReactNode } from 'react';
import type { Brand } from '@/components/TeamBrand';
import { inkOn } from '@/lib/format';

// Showtime: the elevated package for the full-frame scenes (Starting Soon,
// Mid-inning, Final, Game paused). One language across all four: a dark
// studio lit by the two teams' colors, stadium beams, a moving floor and
// floating dust; a slash of both colors that wipes each scene on; logos in
// medallions with a light running round the rim; numbers that roll and count.
// Everything that moves for long is transform or opacity, since a scene can
// sit on air for half an hour inside OBS.

export const teamVars = (b: Brand) => ({ '--c': b.color, '--c2': b.color2, '--ink': inkOn(b.color) }) as React.CSSProperties;

// Fixed scatter, worked out once: dust motes and confetti need to look random
// but must draw the same on every render.
function scatter(n: number, seed: number) {
  let s = seed;
  const r = () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
  return Array.from({ length: n }, () => [r(), r(), r(), r(), r()]);
}
const MOTES = scatter(26, 7);
const CONFETTI = scatter(64, 20);

export function Backdrop({ floor = true, motes = true, children }: { floor?: boolean; motes?: boolean; children?: ReactNode }) {
  return (
    <div className="st-bg" aria-hidden="true">
      <i className="st-pool a" /><i className="st-pool b" />
      {floor && <div className="st-floor"><i /></div>}
      {children}
      <i className="st-beam l" /><i className="st-beam r" />
      {motes && (
        <div className="st-motes">
          {MOTES.map(([x, d, dl, s, dx], i) => (
            <i key={i} style={{ '--x': `${(x * 100).toFixed(1)}%`, '--d': `${(14 + d * 16).toFixed(1)}s`, '--dl': `${(-dl * 30).toFixed(1)}s`, '--s': `${(0.25 + s * 0.45).toFixed(2)}rem`, '--dx': `${((dx - 0.5) * 16).toFixed(1)}rem` } as React.CSSProperties} />
          ))}
        </div>
      )}
      <i className="st-sheen" /><i className="st-grain" /><i className="st-vig" />
    </div>
  );
}

// The two colors slash across the frame from opposite sides and cross in the middle.
export function Wipe({ a, b }: { a: string; b: string }) {
  return <div className="st-wipe" aria-hidden="true" style={{ '--wa': a, '--wb': b } as React.CSSProperties}><i className="a" /><i className="b" /><i className="flash" /></div>;
}

export function Medallion({ b, abbr, size = 18, glory = false }: { b: Brand; abbr: string; size?: number; glory?: boolean }) {
  const mark = (abbr || b.display.slice(0, 3)).toUpperCase().slice(0, 6);
  return (
    <div className={`st-med${glory ? ' glory' : ''}`} style={{ ...teamVars(b), '--m': `${size}rem` } as React.CSSProperties}>
      {glory && <i className="st-rays" />}
      <i className="st-rim" />
      <div className="st-face">{b.logo ? <img src={b.logo} alt="" /> : <span style={{ fontSize: `calc(var(--m) * ${mark.length <= 3 ? 0.27 : mark.length === 4 ? 0.22 : 0.18})` }}>{mark}</span>}</div>
    </div>
  );
}

// A time or a score whose characters roll in as they change.
export function Digits({ text, className }: { text: string; className?: string }) {
  return (
    <span className={`st-digits${className ? ` ${className}` : ''}`}>
      {[...text].map((ch, i) => <span key={`${i}${ch}`} className={/\d/.test(ch) ? 'd' : 'p'}>{ch}</span>)}
    </span>
  );
}

// A score that counts up from nothing when the scene arrives.
export const CountUp = ({ n, delay = 0.9 }: { n: number; delay?: number }) => (
  <span key={n} className="st-count" style={{ '--to': n, '--cd': `${delay}s`, '--dur': `${Math.min(1.6, 0.5 + n * 0.12)}s` } as React.CSSProperties} aria-label={String(n)} />
);

export function Confetti({ colors }: { colors: string[] }) {
  return (
    <div className="st-confetti" aria-hidden="true">
      {CONFETTI.map(([x, d, dl, r, dx], i) => (
        <i key={i} className={i % 3 === 0 ? 'ribbon' : undefined} style={{
          '--x': `${(x * 100).toFixed(1)}%`, '--d': `${(5.5 + d * 6).toFixed(2)}s`, '--dl': `${(0.5 + dl * 5).toFixed(2)}s`,
          '--rz': `${Math.round((r - 0.5) * 1440)}deg`, '--dx': `${((dx - 0.5) * 30).toFixed(1)}rem`, background: colors[i % colors.length],
        } as React.CSSProperties} />
      ))}
    </div>
  );
}

// Words set round a slowly turning ring, behind the VS.
export function Ring({ text }: { text: string }) {
  const t = `${text.toUpperCase()} • `.repeat(3);
  return (
    <svg className="st-ring" viewBox="0 0 200 200" aria-hidden="true">
      <defs><path id="st-ring-path" d="M100 100 m-82 0 a82 82 0 1 1 164 0 a82 82 0 1 1 -164 0" /></defs>
      <text><textPath href="#st-ring-path" textLength="510">{t}</textPath></text>
    </svg>
  );
}

// The ring that empties as a restart comes closer.
export function Countdown({ left, total }: { left: number; total: number }) {
  const f = total > 0 ? Math.max(0, Math.min(1, left / total)) : 0;
  return (
    <svg className="st-dial" viewBox="0 0 120 120" aria-hidden="true">
      <circle className="track" cx="60" cy="60" r="52" />
      <circle className="fill" cx="60" cy="60" r="52" style={{ strokeDashoffset: 327 * (1 - f) }} />
    </svg>
  );
}

// A title sized to its length, so a long team name still fits the frame.
export const titleSize = (t: string, max: number, room = 150) => `${Math.min(max, room / Math.max(8, t.length)).toFixed(2)}rem`;

type Due = { bid: string; num: string; name: string; pos: string; avg?: string | null };

// The mid-inning board, Showtime's way: both teams on slabs of their color,
// the line score with the finished half lit, the half in a line, and who is
// due up on cards that turn in.
export function MidShow({ tag, title, away, home, abbrs, scores, line, recap, list, up, sponsor }: {
  tag: string; title: string; away: Brand; home: Brand; abbrs: { away: string; home: string }; scores: { away: number; home: number };
  line: ReactNode; recap: string[]; list: Due[]; up: Brand; sponsor?: { name: string; logo: string | null } | null;
}) {
  const team = (b: Brand, abbr: string, n: number, lead: boolean, i: number) => (
    <div className={`st-mteam st-glass${lead ? ' lead' : ''}`} style={{ ...teamVars(b), '--in': `${1 + i * 0.15}s` } as React.CSSProperties}>
      <div className="slab"><Medallion b={b} abbr={abbr} size={6.6} /><strong>{b.display}</strong></div>
      <b>{n}</b>
    </div>
  );
  return (
    <div className="st st-midinn" style={{ '--away': away.color, '--home': home.color } as React.CSSProperties}>
      <Backdrop />
      <Wipe a={away.color} b={home.color} />
      <div className="col">
        <div className="st-mhead"><span className="st-tag">{tag}</span><h1 className="st-title" style={{ '--in': '0.9s', fontSize: titleSize(title, 6.4, 120) } as React.CSSProperties}>{title}</h1></div>
        {team(away, abbrs.away, scores.away, scores.away > scores.home, 0)}
        {team(home, abbrs.home, scores.home, scores.home > scores.away, 1)}
        <div className="st-mline st-glass ov-box st-in" style={{ '--in': '1.4s' } as React.CSSProperties}>{line}</div>
        {recap.length > 0 && <div className="st-recap st-glass st-in" style={{ '--in': '1.6s' } as React.CSSProperties}><small>That half</small>{recap.map((r, i) => <span key={i}>{r}</span>)}</div>}
        {list.length > 0 && (
          <div className="st-due" style={teamVars(up)}>
            <small className="st-in" style={{ '--in': '1.7s' } as React.CSSProperties}><i />Due up · {up.display}</small>
            {list.map((b, i) => (
              <div key={b.bid} className="st-glass" style={{ '--in': `${1.85 + i * 0.15}s` } as React.CSSProperties}><i>{b.num}</i><strong>{b.name}</strong><span>{b.pos}</span>{b.avg && <b>{b.avg}</b>}</div>
            ))}
          </div>
        )}
      </div>
      {sponsor && <div className="st-sponsor">Presented by{sponsor.logo && <img src={sponsor.logo} alt="" />}<b>{sponsor.name}</b></div>}
    </div>
  );
}
