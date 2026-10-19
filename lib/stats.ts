// Rates from counts, the way the scorebook and GameChanger work them out.
// Every screen that shows a rate goes through here, so AVG on the roster and
// AVG on the player card cannot disagree.

export type SeasonLine = {
  player_id: string; season_id: string;
  b_g: number; b_pa: number; b_ab: number; b_h: number; b_2b: number; b_3b: number; b_hr: number;
  b_rbi: number; b_r: number; b_bb: number; b_so: number; b_kl: number; b_hbp: number; b_sac: number;
  b_sf: number; b_roe: number; b_fc: number; b_sb: number; b_cs: number;
  p_g: number; p_gs: number; p_outs: number; p_bf: number; p_pitches: number; p_w: number; p_l: number;
  p_sv: number; p_h: number; p_r: number; p_er: number; p_bb: number; p_so: number; p_hbp: number;
  p_wp: number; p_bk: number;
  imported_at: string | null;
  // Fielding, and the runner's, pitcher's and catcher's pickoffs and steals.
  // Optional: a line read before the fielding columns existed has none.
  f_po?: number; f_a?: number; f_e?: number; b_pik?: number; p_pik?: number;
  c_sb?: number; c_cs?: number; c_pik?: number; c_pb?: number;
};

const div = (a: number, b: number) => (b > 0 ? a / b : null);

export function batting(s: SeasonLine) {
  const singles = s.b_h - s.b_2b - s.b_3b - s.b_hr;
  const tb = singles + 2 * s.b_2b + 3 * s.b_3b + 4 * s.b_hr;
  const avg = div(s.b_h, s.b_ab);
  const obp = div(s.b_h + s.b_bb + s.b_hbp, s.b_ab + s.b_bb + s.b_hbp + s.b_sf);
  const slg = div(tb, s.b_ab);
  return { avg, obp, slg, ops: obp === null || slg === null ? null : obp + slg, tb };
}

// ERA is earned runs per game, and a game here is the season's length in
// innings (7 by default, as GameChanger does for youth), not MLB's 9.
export function pitching(s: SeasonLine, gameInnings = 7) {
  const ip = s.p_outs / 3;
  return {
    era: div(s.p_er * gameInnings, ip),
    whip: div(s.p_bb + s.p_h, ip),
    kPerGame: div(s.p_so * gameInnings, ip),
  };
}

// .273, and 1.162 when it gets there. A rate with no chances behind it is a
// dash, not .000.
export const rate3 = (v: number | null) => (v === null ? '–' : v >= 1 ? v.toFixed(3) : v.toFixed(3).replace(/^0/, ''));
export const rate2 = (v: number | null) => (v === null ? '–' : v.toFixed(2));
// 29 outs is "9.2" innings.
export const innings = (outs: number) => `${Math.floor(outs / 3)}.${outs % 3}`;

// Fielding percentage: outs and assists over every chance, errors included.
// Caught-stealing percentage: runners thrown out over runners who tried.
export function fielding(s: SeasonLine) {
  const po = s.f_po ?? 0, a = s.f_a ?? 0, e = s.f_e ?? 0, sb = s.c_sb ?? 0, cs = s.c_cs ?? 0;
  return { tc: po + a + e, fpct: div(po + a, po + a + e), csPct: div(cs, sb + cs) };
}

export const hasBatting = (s: SeasonLine | undefined) => !!s && s.b_pa > 0;
export const hasFielding = (s: SeasonLine | undefined) => !!s && ((s.f_po ?? 0) + (s.f_a ?? 0) + (s.f_e ?? 0) + (s.c_sb ?? 0) + (s.c_cs ?? 0) + (s.c_pb ?? 0)) > 0;
export const hasPitching = (s: SeasonLine | undefined) => !!s && (s.p_outs > 0 || s.p_bf > 0);
