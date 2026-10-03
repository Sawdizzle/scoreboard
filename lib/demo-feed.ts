// A made-up game in the feed's shape, for the Stream screen's preview: the
// team's own brand and stream settings around fictional players, mid-game,
// so every part of the overlay has something to show.
import type { Feed, FeedTeam } from './onair.ts';
import type { SeasonLine } from './stats.ts';
import type { Lineup } from './types.ts';

const US: [string, string, string][] = [['3', 'Cy Park', 'CF'], ['7', 'Johnny Vance', 'SS'], ['21', 'Finn Moore', 'C'], ['18', 'Marco Diaz', '1B'], ['12', 'Ben Ortiz', 'P'],
  ['9', 'Theo Lang', '3B'], ['24', 'Sam Whitaker', 'LF'], ['5', 'Nico Ruiz', '2B'], ['33', 'Owen Tate', 'RF']];
const THEM: [string, string, string][] = [['19', 'Dane Kell', 'P'], ['2', 'Eli Shaw', 'C'], ['14', 'Rob Pine', '1B'], ['6', 'Max Reed', '2B'], ['27', 'Leo Kim', '3B'],
  ['10', 'Jack Hill', 'SS'], ['31', 'Abe Lowe', 'LF'], ['8', 'Gus Vale', 'CF'], ['4', 'Ty Nash', 'RF']];
const lineup = (p: string, list: [string, string, string][]): Lineup => ({
  batters: list.map(([num, name], i) => ({ bid: `${p}${i}`, num, name })),
  positions: Object.fromEntries(list.map(([, , pos], i) => [pos, `${p}${i}`])),
});
const line = (id: string, ab: number, h: number, hr: number, rbi: number, bb: number, sb: number, pitch: Partial<SeasonLine> = {}): SeasonLine => ({
  player_id: id, season_id: 'demo', imported_at: null, b_g: 11, b_pa: ab + bb, b_ab: ab, b_h: h, b_2b: 2, b_3b: 0, b_hr: hr, b_rbi: rbi, b_r: h, b_bb: bb, b_so: 5, b_kl: 1,
  b_hbp: 0, b_sac: 0, b_sf: 0, b_roe: 0, b_fc: 0, b_sb: sb, b_cs: 0, p_g: 0, p_gs: 0, p_outs: 0, p_bf: 0, p_pitches: 0, p_w: 0, p_l: 0, p_sv: 0,
  p_h: 0, p_r: 0, p_er: 0, p_bb: 0, p_so: 0, p_hbp: 0, p_wp: 0, p_bk: 0, ...pitch,
});

export type StreamSettings = Pick<Feed, 'look' | 'layout' | 'qr' | 'bug' | 'sponsor' | 'show_line'>;

export function demoFeed(team: FeedTeam, s: StreamSettings): Feed {
  const us = lineup('u', US), them = lineup('t', THEM);
  return {
    v: 'demo', auto_card: false, auto_mid: false, card: null, last: null, spot: null, ...s,
    team, opponent: { name: 'River Rapids', display_name: 'River Rapids', abbr: 'RIVER', color: '#1a7541', color2: '#f2f6fc', logo_url: null, age_group: null },
    season: { name: 'This season', game_innings: 7 },
    game: { id: 'demo', sport: 'baseball', is_home: true, status: 'live', seq: 40,
      live: { inning: 5, half: 'bottom', balls: 2, strikes: 1, outs: 1, bases: { first: false, second: true, third: false }, home_score: 2, away_score: 4,
        home_hits: 4, away_hits: 6, home_errors: 0, away_errors: 1, line_score: [{ top: 1, bottom: 0 }, { top: 0, bottom: 2 }, { top: 3, bottom: 0 }, { top: 0, bottom: 0 }, { top: 0, bottom: 0 }],
        state: { batIdx: { home: 1 }, pitches: { away: 58 } } } },
    lineups: { us, them },
    roster: US.map(([num, name], i) => ({ id: `u${i}`, num, name })),
    tonight: [{ side: 'us', bid: 'u1', b_pa: 2, b_ab: 1, b_bb: 1 }, { side: 'us', bid: 'u2', b_pa: 2, b_ab: 2, b_h: 1 }, { side: 'them', bid: 't0', p_outs: 13, p_r: 2, p_so: 4, p_pitches: 58 }],
    pas: [{ side: 'us', bid: 'u1', inning: 1, kind: 'BB', code: null }, { side: 'us', bid: 'u1', inning: 3, kind: 'FB', code: 'F8' }],
    season_stats: [line('u0', 36, 13, 0, 6, 5, 9), line('u1', 33, 9, 1, 7, 6, 4), line('u2', 29, 10, 2, 14, 7, 1), line('u3', 29, 9, 1, 9, 3, 0), line('u4', 31, 8, 0, 5, 4, 2)],
  };
}
