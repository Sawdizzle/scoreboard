// The team's leaderboards for a season: who is best in each category, and
// who has the most work to do. Staff only: the bottom of a list is for the
// coaches, never the public page.
//
// A rate means little on a handful of chances, so rates count only players
// who qualify: a plate appearance per game the team has data for (three at
// least; a youth lineup bats everyone, so a player gets one or two a game),
// and two innings pitched. Counting stats take everyone who has one.
import { batting, pitching, rate2, rate3, innings, type SeasonLine } from './stats.ts';

export type Board = {
  key: string;
  label: string;
  // What the number means, for the card's small print.
  note: string;
  rows: { s: SeasonLine; v: number; text: string }[];
};

type Def = {
  key: string; label: string; note: string;
  // The value, or null when the player has none to rank.
  v: (s: SeasonLine) => number | null;
  // Higher first, or lower first.
  high: boolean;
  show: (v: number, s: SeasonLine) => string;
  pool: 'hit' | 'hitQ' | 'pitch' | 'pitchQ';
};

const count = (k: keyof SeasonLine) => (s: SeasonLine) => (Number(s[k]) > 0 ? Number(s[k]) : null);
const int = (v: number) => String(v);

export function boards(lines: SeasonLine[], gameInnings = 7, size = 3) {
  const games = Math.max(0, ...lines.map((s) => s.b_g));
  const minPa = Math.max(3, games);
  const minOuts = 6;
  const pools = {
    hit: lines.filter((s) => s.b_pa > 0),
    hitQ: lines.filter((s) => s.b_pa >= minPa),
    pitch: lines.filter((s) => s.p_outs > 0 || s.p_bf > 0),
    pitchQ: lines.filter((s) => s.p_outs >= minOuts),
  };
  const era = (s: SeasonLine) => pitching(s, gameInnings).era;
  const whip = (s: SeasonLine) => pitching(s, gameInnings).whip;
  const qNote = `At least ${minPa} plate appearances`;
  const pNote = 'At least 2 innings pitched';

  const best: Def[] = [
    { key: 'avg', label: 'Batting average', note: qNote, v: (s) => batting(s).avg, high: true, show: (v) => rate3(v), pool: 'hitQ' },
    { key: 'obp', label: 'On-base percentage', note: qNote, v: (s) => batting(s).obp, high: true, show: (v) => rate3(v), pool: 'hitQ' },
    { key: 'ops', label: 'OPS', note: `On base plus slugging · ${qNote.toLowerCase()}`, v: (s) => batting(s).ops, high: true, show: (v) => rate3(v), pool: 'hitQ' },
    { key: 'h', label: 'Hits', note: 'Season total', v: count('b_h'), high: true, show: int, pool: 'hit' },
    { key: 'xbh', label: 'Extra-base hits', note: 'Doubles, triples and home runs', v: (s) => (s.b_2b + s.b_3b + s.b_hr > 0 ? s.b_2b + s.b_3b + s.b_hr : null), high: true, show: int, pool: 'hit' },
    { key: 'rbi', label: 'RBI', note: 'Runs batted in', v: count('b_rbi'), high: true, show: int, pool: 'hit' },
    { key: 'r', label: 'Runs', note: 'Runs scored', v: count('b_r'), high: true, show: int, pool: 'hit' },
    { key: 'bb', label: 'Walks', note: 'A good eye at the plate', v: count('b_bb'), high: true, show: int, pool: 'hit' },
    { key: 'sb', label: 'Stolen bases', note: 'Season total', v: count('b_sb'), high: true, show: int, pool: 'hit' },
    { key: 'era', label: 'ERA', note: `Earned runs per ${gameInnings} innings · ${pNote.toLowerCase()}`, v: era, high: false, show: (v) => rate2(v), pool: 'pitchQ' },
    { key: 'whip', label: 'WHIP', note: `Walks and hits per inning · ${pNote.toLowerCase()}`, v: whip, high: false, show: (v) => rate2(v), pool: 'pitchQ' },
    { key: 'k', label: 'Strikeouts', note: 'Pitching', v: count('p_so'), high: true, show: int, pool: 'pitch' },
    { key: 'ip', label: 'Innings pitched', note: 'Season total', v: (s) => (s.p_outs > 0 ? s.p_outs : null), high: true, show: (v) => innings(v), pool: 'pitch' },
  ];
  const work: Def[] = [
    { key: 'so', label: 'Most strikeouts', note: 'At the plate', v: count('b_so'), high: true, show: int, pool: 'hit' },
    { key: 'kl', label: 'Most called third strikes', note: 'Struck out looking', v: count('b_kl'), high: true, show: int, pool: 'hit' },
    { key: 'avgLow', label: 'Lowest batting average', note: qNote, v: (s) => batting(s).avg, high: false, show: (v) => rate3(v), pool: 'hitQ' },
    { key: 'obpLow', label: 'Lowest on-base percentage', note: qNote, v: (s) => batting(s).obp, high: false, show: (v) => rate3(v), pool: 'hitQ' },
    { key: 'cs', label: 'Most caught stealing', note: 'On the bases', v: count('b_cs'), high: true, show: int, pool: 'hit' },
    { key: 'pbb', label: 'Most walks allowed', note: 'Pitching', v: count('p_bb'), high: true, show: int, pool: 'pitch' },
    { key: 'bbRate', label: 'Most walks per inning', note: pNote, v: (s) => (s.p_outs > 0 ? s.p_bb / (s.p_outs / 3) : null), high: true, show: (v) => rate2(v), pool: 'pitchQ' },
    { key: 'eraHigh', label: 'Highest ERA', note: pNote, v: era, high: true, show: (v) => rate2(v), pool: 'pitchQ' },
    { key: 'hbp', label: 'Most hit batters', note: 'Pitching', v: count('p_hbp'), high: true, show: int, pool: 'pitch' },
    { key: 'wp', label: 'Most wild pitches', note: 'Pitching', v: count('p_wp'), high: true, show: int, pool: 'pitch' },
  ];

  const rank = (d: Def): Board => {
    const rows = pools[d.pool]
      .map((s) => ({ s, v: d.v(s) }))
      .filter((x): x is { s: SeasonLine; v: number } => x.v !== null && Number.isFinite(x.v))
      .sort((a, b) => (d.high ? b.v - a.v : a.v - b.v) || b.s.b_pa + b.s.p_outs - (a.s.b_pa + a.s.p_outs));
    return { key: d.key, label: d.label, note: d.note, rows: rows.slice(0, size).map((x) => ({ ...x, text: d.show(x.v, x.s) })) };
  };
  const keep = (b: Board) => b.rows.length > 0;
  return { leaders: best.map(rank).filter(keep), work: work.map(rank).filter(keep), minPa, games };
}
