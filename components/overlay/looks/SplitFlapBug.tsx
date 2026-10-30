import './split-flap.css';
import type { Brand } from '@/components/TeamBrand';
import { homerText, tabName, type BugProps } from '@/components/overlay/looks/types';
import { shortName } from '@/lib/format';

// Departures, drawn here: Scoreboard's split-flap station board
// (public/bugs/split-flap.html), rebuilt as part of the page so the stat cards
// can sit behind its housing. Charcoal housing with four screws, rows of flap
// cells: swatch, team, R, H, E and a ten-cell status column for each side, then
// a smaller row for the batter, count, outs, base lamps and inning.
//
// The original walks every cell through the drum's letters with script. Here
// a cell is keyed by what it shows, so a new character mounts a new cell and
// its leaves do one flip (a blank leaf falls twice, then the new bottom leaf
// lands with a bounce); `--i` staggers the cells left to right. A play is
// called in the status column, a home run takes over both team rows, and a new
// half inning is a set of cells laid over the team rows that flips away.
type C = { ch: string; col?: string; fl?: boolean; sw?: string };
const COL: Record<string, string> = { W: '#EDE6D3', D: '#9a958a', Y: '#FFC933', R: '#FF4D3D', A: '#FF9A1F', G: '#5BE08C' };
const SEGS: [string, number, number][] = [['sw', 0, 1], ['nm', 1, 6], ['r', 7, 2], ['h', 9, 2], ['e', 11, 2], ['st', 13, 10]];
const HDR: Record<string, string> = { sw: '', nm: 'Team', r: 'R', h: 'H', e: 'E', st: 'Status' };

// Only what the drum carries: capitals, numerals and a few marks.
const up = (s: unknown) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9&'+\-./·ꓘ●○▲▼ ]/g, '');
const padL = (s: unknown, n: number) => (up(s) + ' '.repeat(n)).slice(0, n);
const padR = (s: unknown, n: number) => (' '.repeat(n) + up(s)).slice(-n);
const cells = (str: string, col: string, fl = false): C[] => [...str].map((ch) => ({ ch, col, fl }));
const surname = shortName;
const ord = (n: number) => n + (n % 100 >= 11 && n % 100 <= 13 ? 'TH' : ['TH', 'ST', 'ND', 'RD'][n % 10] || 'TH');
function fitName(n: string, len: number) {
  const full = up(n).trim(); if (full.length <= len) return full;
  const p = full.split(/\s+/), s = shortName(full), ini = s === full ? s : `${p[0][0]}. ${s}`;
  return ini.length <= len ? ini : s.slice(0, len);
}
// Tonight's line ("1-3, HR, 2 RBI") in a few cells: as many whole parts as fit, never half of one.
const fitParts = (s: string, len: number) => s.split(',').map((p) => p.trim()).reduce((out, p) => (!out ? p : `${out} ${p}`.length <= len && !out.endsWith('\u0000') ? `${out} ${p}` : `${out}\u0000`), '').replace(/\u0000/g, '');
// The six cells of a team's name: its display name when that fits, else its short code.
const six = (b: Brand, abbr: string) => { const t = up(tabName(b, abbr)).trim(); return t.length <= 6 ? t : up(abbr).trim() || t; };
// A full-width team-row message: swatch, a 12-cell line (across team, R, H, E), the 10-cell status.
const msgRow = (sw: string | undefined, text: string, col: string, st = '', stCol = col, stFl = false): C[] =>
  [{ ch: ' ', sw }, ...cells(padL(text, 12), col), ...cells(padL(st, 10), stCol, stFl)];

// What a play puts in the batting side's status column: [text, color, flashing].
const REMARK: Record<string, [string, string, boolean]> = {
  Strikeout: ['STRIKEOUT', 'R', true], 'Strikeout looking': ['ꓘ LOOKING', 'R', true],
  Single: ['SINGLE', 'Y', false], Double: ['DOUBLE', 'Y', false], Triple: ['TRIPLE', 'Y', false], 'Sac fly': ['SAC FLY', 'Y', false],
  Walk: ['WALK · 1ST', 'G', false], 'Hit by pitch': ['HBP · 1ST', 'G', false],
  'Double play': ['DBL PLAY', 'W', false], 'Stolen base': ['STOLE BASE', 'G', true],
};

function face(c: C) {
  if (c.sw) return <i className="sw" style={{ background: c.sw }} />;
  if (c.ch === '●') return <i className="dot on" />;
  if (c.ch === '○') return <i className="dot" />;
  if (c.ch === '▲') return <i className="tri up" />;
  if (c.ch === '▼') return <i className="tri dn" />;
  if (c.ch === 'ꓘ') return <b className="rev">K</b>;
  return c.ch === ' ' ? null : c.ch;
}

// One flap cell. `i` is its place in the cascade. The key is made by the caller from what it shows.
function cell(c: C, i: number, slot: number, lit = false) {
  const col = COL[c.col ?? 'W'] ?? c.col;
  return (
    <div key={`${slot}|${c.ch}|${c.sw ?? ''}|${c.col ?? ''}`} className={`fc${c.fl ? ' fl' : ''}${lit ? ' lit' : ''}`} style={{ '--i': i, '--c': col } as React.CSSProperties}>
      <div className="t"><span>{face(c)}</span></div>
      <div className="b" />
      <div className="flap t" />
      <div className="flap b"><span>{face(c)}</span></div>
    </div>
  );
}

// A team row's 23 cells in their segments. `wave` runs the cascade across the whole row
// (a takeover); otherwise each segment starts its own. `rk` remounts the runs so they light.
function Row({ cs, rk = '', lit = false, wave = false, off = 0 }: { cs: C[]; rk?: string; lit?: boolean; wave?: boolean; off?: number }) {
  return (
    <div className="fr frT" style={{ '--o': `${off}ms` } as React.CSSProperties}>
      {SEGS.map(([k, at, n]) => (
        <div key={k === 'r' ? `r${rk}` : k} className={`sg sg-${k}`}>
          {cs.slice(at, at + n).map((c, j) => cell(c, wave ? at + j : j, j, k === 'r' && lit))}
        </div>
      ))}
    </div>
  );
}

const seg = (k: string, cs: C[]) => <div className={`sg sg-${k}`}>{cs.map((c, j) => cell(c, j, j))}</div>;

export function SplitFlapBug({ g, air, away, home, abbrs, status, period, showLine, moment }: BugProps) {
  const live = status === 'live', top = g.half === 'top', ball = period === null, play = live && ball;
  const bases = g.bases as { first?: boolean; second?: boolean; third?: boolean };
  const balls = g.balls | 0, strikes = g.strikes | 0, outs = Math.min(g.outs | 0, 3);
  const inning = Math.min(Number(g.inning) || 1, 99);
  const half = `${inning}${g.half}`;
  const bat = air.batter, pit = air.pitcher;
  const batBrand = top ? away : home, batAbbr = top ? abbrs.away : abbrs.home;

  const hr = play && moment?.text === 'Home run' ? moment : null;
  const k = play && moment?.text.startsWith('Strikeout') ? moment : null;
  const looking = !!k && k.text.endsWith('looking');
  const rem = play && moment && !hr ? REMARK[moment.text] ?? [up(moment.text).slice(0, 10), 'Y', false] as [string, string, boolean] : null;
  const kMark = looking ? 'ꓘ' : 'K';

  // The status column: the play for a few seconds, else who is at bat.
  const st = (batting: boolean): C[] => {
    if (!play) return cells(padL('', 10), 'W');
    if (rem && batting) return cells(padL(rem[0], 10), rem[1], rem[2]);
    if (k && !batting) return cells(padL(pit?.last ? `${kMark} · ${up(pit.last)}`.slice(0, 10) : `${kMark} · K · ${kMark}`, 10), 'R');
    return cells(padL(batting ? 'AT BAT' : 'IN FIELD', 10), batting ? 'Y' : 'D');
  };
  const teamRow = (b: Brand, abbr: string, r: number, h: unknown, e: unknown, batting: boolean): C[] => [
    { ch: ' ', sw: b.color || '#888' },
    ...cells(padL(six(b, abbr), 6), 'W'),
    ...cells(padR(Math.min(r, 99), 2), 'W'),
    ...cells(padR(Math.min(Number(h) || 0, 99), 2), 'D'),
    ...cells(padR(Math.min(Number(e) || 0, 99), 2), 'D'),
    ...st(batting),
  ];
  const rowA = hr ? msgRow(batBrand.color, 'HOME RUN', 'Y', homerText(hr.runs, 'plus') || 'GONE', 'Y', true)
    : teamRow(away, abbrs.away, g.away_score | 0, g.away_hits, g.away_errors, top);
  const rowB = hr ? msgRow(batBrand.color, fitName(hr.who || bat?.name || '', 12), 'W', 'DEPARTED', 'Y')
    : teamRow(home, abbrs.home, g.home_score | 0, g.home_hits, g.home_errors, !top);

  const inn = String(inning), arrow = top ? '▲' : '▼';
  const innCells: C[] = inn.length > 1 ? [{ ch: arrow, col: 'Y' }, ...cells(inn, 'W')] : [{ ch: ' ' }, { ch: arrow, col: 'Y' }, { ch: inn, col: 'W' }];
  const word = !live ? (status === 'final' ? 'FINAL' : 'PREGAME') : up(period).trim().slice(0, 28);
  const avg = showLine && bat?.avg ? bat.avg : '', today = showLine && bat?.today ? bat.today : '';

  return (
    <div className="lk-flap">
      <div className="pkg">
        <div className="board">
          <div className="screws" />
          {(hr || k) && <div key={`g${moment?.text}${moment?.who}`} className="glow" style={{ '--gc': hr ? COL.Y : COL.R } as React.CSSProperties} />}
          <div className="fr hdr frT">
            {SEGS.map(([s]) => (
              <div key={s} className={`lab ${s}${s === 'r' || s === 'h' || s === 'e' ? ' c' : ''}${s === 'st' ? ' dep' : ''}`}>{s === 'st' && <i />}{HDR[s]}</div>
            ))}
          </div>
          <div className="trs">
            {/* The runs light once the score changes; after a home run, when the board flips back. */}
            <Row cs={rowA} wave={!!hr} rk={`${g.away_score | 0}${hr && top ? 'h' : ''}`} lit={!hr} />
            <Row cs={rowB} wave={!!hr} off={hr ? 70 : 0} rk={`${g.home_score | 0}${hr && !top ? 'h' : ''}`} lit={!hr} />
            {/* A new half: the board reads "TOP 3RD" and the side coming up is BOARDING, then flips back to the game. */}
            {play && (
              <div key={half} className="over" aria-hidden="true">
                <Row cs={msgRow(undefined, `${top ? 'TOP' : 'BOTTOM'} ${ord(inning)}`, 'Y')} wave />
                <Row cs={msgRow(batBrand.color, six(batBrand, batAbbr), 'W', 'BOARDING', 'G', true)} wave off={70} />
              </div>
            )}
          </div>
          <div className="rule" />
          {play ? (
            <div className="fr frC">
              <div className="grp"><span className="lab two">Now<br />batting</span>{seg('nm', cells(padL(surname(bat?.name ?? ''), 9), 'W'))}</div>
              <div className="grp"><span className="lab">B</span>{seg('b', [{ ch: String(Math.min(balls, 4)), col: 'Y' }])}</div>
              <div className="grp"><span className="lab">S</span>{seg('s', [{ ch: String(Math.min(strikes, 3)), col: 'Y' }])}</div>
              <div className="grp"><span className="lab">Out</span>{seg('o', [0, 1, 2].map((i) => ({ ch: i < outs ? '●' : '○', col: 'R' })))}</div>
              <div className="grp"><div className="bases"><i className={bases.second ? 'b2 on' : 'b2'} /><i className={bases.third ? 'b3 on' : 'b3'} /><i className={bases.first ? 'b1 on' : 'b1'} /></div></div>
              <div className="grp"><span className="lab">Inn</span>{seg('inn', innCells)}</div>
            </div>
          ) : (
            <div className="fr frC word">{seg('w', cells(word, 'Y'))}</div>
          )}
          {play && (pit || avg || today) && (
            <div className="fr frC frD">
              {avg && <div className="grp"><span className="lab">Avg</span>{seg('avg', cells(padL(avg, 4), 'Y'))}</div>}
              {today && <div className="grp"><span className="lab">Today</span>{seg('td', cells(padL(fitParts(today, 7), 7), 'W'))}</div>}
              {pit && <div className="grp"><span className="lab">P</span>{seg('p', cells(padL(pit.last, 8), 'W'))}</div>}
              {pit && <div className="grp"><span className="lab">PC</span>{seg('pc', cells(padR(Math.min(Number(pit.pitches) || 0, 999), 3), 'D'))}</div>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
