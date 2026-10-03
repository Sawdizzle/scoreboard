// A GameChanger season export (Team → Stats → Export), read into the counts
// stat_imports holds.
//
// The file is one wide table in three sections side by side. Row 1 names the
// sections ("Batting", "Pitching", "Fielding") in the column each one starts
// at; row 2 is the column headers, which repeat across sections (H, BB, SO,
// HBP, R, SB, CS, PIK, LOB, HR ... appear under both Batting and Pitching). A
// header is only meaningful together with the section it sits in, so columns
// are looked up per section, never across the whole row.
//
// After the players come a "Totals" row, a blank row and a "Glossary" row.
// Everything is quoted; empty cells and "-" are zero. Rates (AVG, ERA, ...)
// are ignored and recomputed from the counts, so a rounding in the export can
// never disagree with the numbers beside it.

export type ImportCounts = {
  b_g: number; b_pa: number; b_ab: number; b_h: number; b_2b: number; b_3b: number; b_hr: number;
  b_rbi: number; b_r: number; b_bb: number; b_so: number; b_kl: number; b_hbp: number; b_sac: number;
  b_sf: number; b_roe: number; b_fc: number; b_sb: number; b_cs: number;
  p_g: number; p_gs: number; p_outs: number; p_bf: number; p_pitches: number; p_w: number; p_l: number;
  p_sv: number; p_h: number; p_r: number; p_er: number; p_bb: number; p_so: number; p_hbp: number;
  p_wp: number; p_bk: number;
};
export type ImportRow = { number: string; first_name: string; last_name: string; counts: ImportCounts };
export type ImportResult = { rows: ImportRow[]; warnings: string[] };

// Our column ← GameChanger's header, within its section.
const BATTING: [keyof ImportCounts, string][] = [
  ['b_g', 'GP'], ['b_pa', 'PA'], ['b_ab', 'AB'], ['b_h', 'H'], ['b_2b', '2B'], ['b_3b', '3B'], ['b_hr', 'HR'],
  ['b_rbi', 'RBI'], ['b_r', 'R'], ['b_bb', 'BB'], ['b_so', 'SO'], ['b_kl', 'K-L'], ['b_hbp', 'HBP'],
  ['b_sac', 'SAC'], ['b_sf', 'SF'], ['b_roe', 'ROE'], ['b_fc', 'FC'], ['b_sb', 'SB'], ['b_cs', 'CS'],
];
const PITCHING: [keyof ImportCounts, string][] = [
  ['p_g', 'GP'], ['p_gs', 'GS'], ['p_bf', 'BF'], ['p_pitches', '#P'], ['p_w', 'W'], ['p_l', 'L'], ['p_sv', 'SV'],
  ['p_h', 'H'], ['p_r', 'R'], ['p_er', 'ER'], ['p_bb', 'BB'], ['p_so', 'SO'], ['p_hbp', 'HBP'], ['p_wp', 'WP'],
  ['p_bk', 'BK'],
];

export const emptyCounts = (): ImportCounts => Object.fromEntries(
  [...BATTING, ...PITCHING, ['p_outs', 'IP'] as const].map(([k]) => [k, 0]),
) as ImportCounts;

// RFC 4180, which is what GameChanger writes: quoted fields, "" for a quote,
// commas and newlines allowed inside quotes.
export function parseCsv(text: string): string[][] {
  const s = text.replace(/^﻿/, '');
  const rows: string[][] = [];
  let row: string[] = [], cell = '', quoted = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      } else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

// "9.2" innings is nine innings and two outs.
export function inningsToOuts(ip: string) {
  const m = /^\s*(\d+)(?:\.(\d))?\s*$/.exec(ip || '');
  if (!m) return 0;
  return Number(m[1]) * 3 + Math.min(Number(m[2] ?? 0), 2);
}

const count = (v: string | undefined) => {
  const t = (v ?? '').trim();
  if (t === '' || t === '-') return 0;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : 0;
};

export function parseGameChanger(text: string): ImportResult {
  const warnings: string[] = [];
  const grid = parseCsv(text);
  const sections = grid[0] ?? [];
  const headers = (grid[1] ?? []).map((h) => h.trim());
  const start = (name: string) => sections.findIndex((c) => c.trim().toLowerCase() === name);
  const bat = start('batting'), pit = start('pitching'), fld = start('fielding');
  if (bat < 0 || headers[0] !== 'Number' || headers[1] !== 'Last' || headers[2] !== 'First') {
    throw new Error('This does not look like a GameChanger stats export. In GameChanger, open the team, then Stats, then Export, and choose the season file.');
  }
  // Where each section ends: the next section's start, or the end of the row.
  const ends = [bat, pit, fld].filter((i) => i >= 0).sort((a, b) => a - b);
  const range = (from: number) => [from, ends.find((e) => e > from) ?? headers.length] as const;
  const colIn = ([from, to]: readonly [number, number], name: string) => {
    for (let i = from; i < to; i++) if (headers[i] === name) return i;
    return -1;
  };
  const batR = range(bat);
  const pitR = pit >= 0 ? range(pit) : null;
  if (!pitR) warnings.push('No pitching section in this file; only batting was read.');

  const batCols = BATTING.map(([k, h]) => [k, colIn(batR, h)] as const);
  const pitCols = pitR ? PITCHING.map(([k, h]) => [k, colIn(pitR, h)] as const) : [];
  const ipCol = pitR ? colIn(pitR, 'IP') : -1;
  const missing = [...batCols, ...pitCols].filter(([, i]) => i < 0).map(([k]) => k);
  if (missing.length) warnings.push(`Columns not in this export, read as 0: ${missing.join(', ')}.`);

  const rows: ImportRow[] = [];
  for (const r of grid.slice(2)) {
    const first = (r[0] ?? '').trim();
    if (first === 'Totals' || first === 'Glossary') break;
    const last_name = (r[1] ?? '').trim(), first_name = (r[2] ?? '').trim();
    if (!first && !last_name && !first_name) continue;
    const counts = emptyCounts();
    for (const [k, i] of [...batCols, ...pitCols]) if (i >= 0) counts[k] = count(r[i]);
    if (ipCol >= 0) counts.p_outs = inningsToOuts(r[ipCol] ?? '');
    rows.push({ number: /^\d{1,3}$/.test(first) ? first : '', first_name: first_name.slice(0, 40), last_name: last_name.slice(0, 40), counts });
  }
  if (!rows.length) throw new Error('The export has no player rows.');
  return { rows, warnings };
}

// Which roster player each imported row is. Number and last name together
// first, then the full name, then the number alone when only one player
// wears it. Anyone left over is offered as a new player.
export type RosterRef = { id: string; number: string; first_name: string; last_name: string };
export function matchRows(rows: ImportRow[], roster: RosterRef[]): (string | null)[] {
  const norm = (s: string) => s.trim().toLowerCase();
  const taken = new Set<string>();
  const pick = (cands: RosterRef[]) => {
    const free = cands.filter((p) => !taken.has(p.id));
    if (free.length !== 1) return null;
    taken.add(free[0].id);
    return free[0].id;
  };
  const out: (string | null)[] = rows.map(() => null);
  const passes: ((r: ImportRow, p: RosterRef) => boolean)[] = [
    (r, p) => !!r.number && r.number === p.number && !!r.last_name && norm(r.last_name) === norm(p.last_name),
    (r, p) => !!r.last_name && norm(r.first_name) === norm(p.first_name) && norm(r.last_name) === norm(p.last_name),
    (r, p) => !!r.number && r.number === p.number,
  ];
  for (const test of passes) {
    rows.forEach((r, i) => { if (!out[i]) out[i] = pick(roster.filter((p) => test(r, p))); });
  }
  return out;
}
