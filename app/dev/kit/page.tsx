import { notFound } from 'next/navigation';
import { TeamTabs } from '@/components/TabBar';
import { TeamFrame } from '@/components/TeamFrame';
import { ImportFlow } from '@/components/ImportFlow';
import { LineupEditor } from '@/components/LineupEditor';
import { Pad } from '@/components/pad/Pad';
import type { Log } from '@/components/pad/PlaysSheet';
import { SpotsDemo } from '@/components/overlay/Spots';
import { Scenes } from '@/components/overlay/Scenes';
import { Stage } from '@/components/overlay/Stage';

// A short made-up log for the pad's Plays sheet, pitch counts and pitching
// decisions: we field in the top (Ortiz pitching, then a reliever in the 3rd),
// they field in the bottom (their #38 pitching).
const top = { inning: 1, half: 'top' as const }, bot = { inning: 1, half: 'bottom' as const };
const ourField = { CF: 'p1', SS: 'p2', C: 'p3', '1B': 'p4', P: 'p5', '3B': 'p6', LF: 'p7', '2B': 'p8', RF: 'p9' };
const theirField = { CF: 'o0', SS: 'o1', '1B': 'o2', C: 'o3', '3B': 'o4', '2B': 'o5', LF: 'o6', RF: 'o7', P: 'o8' };
const kitLog: Log = {
  events: [
    { id: 1, seq: 1, type: 'ball', payload: {}, prev_live: top },
    { id: 2, seq: 2, type: 'strike', payload: {}, prev_live: top },
    { id: 3, seq: 3, type: 'play', payload: { play: { kind: 'GB', code: '6-3', outs: 1, ...top }, field: ourField }, prev_live: top },
    { id: 4, seq: 4, type: 'strikeout', payload: { play: { kind: 'K', outs: 1, ...top }, field: ourField }, prev_live: top },
    { id: 5, seq: 5, type: 'foul', payload: {}, prev_live: bot },
    { id: 6, seq: 6, type: 'play', payload: { play: { kind: 'H2', code: '', runs: 1, ...bot }, field: theirField }, prev_live: bot },
    { id: 7, seq: 7, type: 'runner', payload: { play: { kind: 'PO', code: '2-5', outs: 1, inning: 2, half: 'bottom' }, field: theirField }, prev_live: { inning: 2, half: 'bottom' as const } },
    { id: 8, seq: 8, type: 'ball', payload: {}, prev_live: { inning: 3, half: 'top' as const } },
    { id: 9, seq: 9, type: 'strike', payload: {}, prev_live: { inning: 3, half: 'top' as const } },
  ],
  stats: [
    ...[1, 2, 3, 4].map((e) => ({ event_id: e, side: 'us' as const, bid: 'p5', p_pitches: 1 })),
    { event_id: 3, side: 'them' as const, bid: 'o0', b_pa: 1 }, { event_id: 3, side: 'us' as const, bid: 'p2', f_a: 1 }, { event_id: 3, side: 'us' as const, bid: 'p4', f_po: 1 },
    { event_id: 4, side: 'them' as const, bid: 'o1', b_pa: 1 }, { event_id: 4, side: 'us' as const, bid: 'p3', f_po: 1 },
    { event_id: 5, side: 'them' as const, bid: 'o8', p_pitches: 1 }, { event_id: 6, side: 'them' as const, bid: 'o8', p_pitches: 1 },
    { event_id: 6, side: 'us' as const, bid: 'p2', b_pa: 1 }, { event_id: 6, side: 'us' as const, bid: 'p1', b_r: 1 },
    { event_id: 7, side: 'us' as const, bid: 'p9', b_pik: 1 }, { event_id: 7, side: 'them' as const, bid: 'o3', f_a: 1, c_pik: 1 }, { event_id: 7, side: 'them' as const, bid: 'o4', f_po: 1 },
    { event_id: 8, side: 'us' as const, bid: 'p6', p_pitches: 1 }, { event_id: 9, side: 'us' as const, bid: 'p6', p_pitches: 1 },
  ],
};

// The lineup screen's links, pointing back into the kit.
const kitNav = (side: 'us' | 'them') => ({
  back: { href: '/dev/kit?v=game', label: 'Back to the game' },
  sides: [{ href: '/dev/kit?v=lineup', label: 'Blue Steel', on: side === 'us' }, { href: '/dev/kit?v=lineup-them', label: 'River Rapids', on: side === 'them' }],
  next: { href: '/dev/kit?v=pad', label: 'Open the pad' },
});
// A fixed moment for the scenes' countdowns, so the kit draws the same every time.
const KIT_NOW = Date.parse('2026-10-17T14:33:00Z');
import type { CardKind, Feed, Look, QrPos } from '@/lib/onair';
import { LiveGame } from '@/components/public/LiveGame';
import type { PublicGame } from '@/lib/public';
import type { Sport } from '@/lib/sports';
import { ScorePad } from '@/components/pad/ScorePad';
import { GameView } from '@/components/views/GameView';
import { lineupFromRoster } from '@/lib/lineup';
import { PlayerView } from '@/components/views/PlayerView';
import { RosterView } from '@/components/views/RosterView';
import { StatsView } from '@/components/views/StatsView';
import { SeasonView } from '@/components/views/SeasonView';
import { SettingsView } from '@/components/views/SettingsView';
import { StreamSetup } from '@/components/stream/StreamSetup';
import { StaffView } from '@/components/views/StaffView';
import { TodayView } from '@/components/views/TodayView';
import { OpponentEditor } from '@/components/OpponentEditor';
import { sprayBalls } from '@/lib/spray';
import type { SeasonLine } from '@/lib/stats';
import type { Game, Invite, Player, Position, Role, Season, StaffMember, Team } from '@/lib/types';

// Every team screen, drawn from made-up data with no database behind it:
// /dev/kit?v=roster (today, roster, player, staff, season, settings), and
// &role=coach to see a seat that cannot edit. Development only. The forms are
// real, so submitting one here fails at the first query; it is for looking.
const baseTeam: Team = { id: 't1', slug: 'blue-steel-14u', name: 'Blue Steel Baseball', display_name: 'Blue Steel', abbr: 'STEEL', color: '#2857b5', color2: '#e0a92a', palette: ['#2857b5', '#e0a92a', '#ffffff'], logo_url: null, age_group: '14U', name_format: 'full' };
const season: Season = { id: 's1', team_id: 't1', name: 'Fall 2026', starts_on: '2026-09-05', ends_on: '2026-11-15', is_current: true, game_innings: 7 };
const seasons: Season[] = [season, { id: 's2', team_id: 't1', name: 'Spring 2026', starts_on: null, ends_on: null, is_current: false, game_innings: 7 }];
const P = (id: number, number: string, first_name: string, last_name: string, positions: Position[], bats: Player['bats'], throws: Player['throws'], active = true): Player =>
  ({ id: `p${id}`, team_id: 't1', number, first_name, last_name, positions, bats, throws, public_name: 'full', active });
const players: Player[] = [
  P(1, '3', 'Cy', 'Park', ['CF'], 'L', 'L'), P(2, '7', 'Johnny', 'Vance', ['SS', '2B'], 'R', 'R'),
  P(3, '21', 'Finn', 'Moore', ['C'], 'R', 'R'), P(4, '18', 'Marco', 'Diaz', ['1B'], 'L', 'L'),
  P(5, '12', 'Ben', 'Ortiz', ['P', '1B'], 'R', 'R'), P(6, '9', 'Theo', 'Lang', ['3B'], 'R', 'R'),
  P(7, '24', 'Sam', 'Whitaker', ['LF'], 'S', 'R'), P(8, '5', 'Nico', 'Ruiz', ['2B'], 'R', 'R'),
  P(9, '33', 'Owen', 'Tate', ['RF', 'P'], 'R', 'R'), P(10, '11', 'Jack', 'Hill', [], null, null),
  P(11, '2', 'Leo', 'Kim', ['UT'], 'L', 'R'), P(12, '40', 'Max', 'Reed', ['P'], 'R', 'R', false),
];
const staff: StaffMember[] = [
  { user_id: 'u1', role: 'organizer', display_name: 'Shawn W.' }, { user_id: 'u2', role: 'head_coach', display_name: 'Ray Dalton' },
  { user_id: 'u3', role: 'coach', display_name: 'Mia Torres' }, { user_id: 'u4', role: 'scorer', display_name: 'Kev Oliver' },
];
// The design canvas's season line for each hitter, made up, plus two pitchers.
const L = (id: number, g: number, ab: number, h: number, d: number, hr: number, rbi: number, bb: number, k: number, sb: number, extra: Partial<SeasonLine> = {}): SeasonLine => ({
  player_id: `p${id}`, season_id: 's1', imported_at: '2026-10-02T20:00:00Z',
  b_g: g, b_pa: ab + bb + 1, b_ab: ab, b_h: h, b_2b: d, b_3b: 0, b_hr: hr, b_rbi: rbi, b_r: Math.round(h * 0.8), b_bb: bb, b_so: k, b_kl: 1,
  b_hbp: 1, b_sac: 0, b_sf: 0, b_roe: 0, b_fc: 0, b_sb: sb, b_cs: 0,
  p_g: 0, p_gs: 0, p_outs: 0, p_bf: 0, p_pitches: 0, p_w: 0, p_l: 0, p_sv: 0, p_h: 0, p_r: 0, p_er: 0, p_bb: 0, p_so: 0, p_hbp: 0, p_wp: 0, p_bk: 0,
  ...extra,
});
const stats: SeasonLine[] = [
  L(1, 11, 36, 13, 3, 0, 6, 5, 4, 9), L(2, 11, 33, 9, 2, 1, 7, 6, 6, 4), L(3, 11, 29, 10, 4, 2, 14, 7, 5, 1),
  L(4, 10, 29, 9, 2, 1, 9, 3, 8, 0), L(5, 11, 31, 8, 1, 0, 5, 4, 7, 2, { p_g: 6, p_gs: 5, p_outs: 71, p_bf: 101, p_pitches: 412, p_h: 18, p_r: 11, p_er: 8, p_bb: 9, p_so: 31 }),
  L(6, 11, 35, 8, 2, 0, 4, 2, 11, 3), L(9, 10, 25, 6, 1, 0, 4, 3, 6, 1, { p_g: 4, p_gs: 2, p_outs: 29, p_bf: 48, p_pitches: 170, p_h: 12, p_r: 9, p_er: 7, p_bb: 6, p_so: 14 }),
];
const game: Game = { id: 'g1', sport: 'baseball', team_id: 't1', season_id: 's1', counts_for_stats: true, opponent_team_id: 'o1', opponent_name: 'River 14U',
  opponent_abbr: 'RIVER', opponent_color: '#1a7541', is_home: true, starts_at: '2026-10-03T23:30:00Z', venue: 'Railyard Park, Field 3', address: '2600 Railyard Rd, Aubrey, TX 76227', tournament_url: 'https://playtgs.com/events/fall-classic', venue_geo: { lat: 33.3, lon: -96.99, label: 'Aubrey, TX' }, status: 'scheduled', live: {},
  opponent: { id: 'o1', slug: 'river-14u', name: 'River Rapids', display_name: 'River Rapids', abbr: 'RIVER', color: '#1a7541', color2: '#f2f6fc', palette: [], logo_url: null, age_group: '14U', name_format: 'full' } };
const lineup = lineupFromRoster(players);
// A season's schedule: two played, one live, two to come, in listGames order.
const schedule: Game[] = ([
  ['g-a', '2026-09-12T17:00:00Z', 'final', 'Canyon Hawks', false], ['g-b', '2026-09-26T23:00:00Z', 'final', 'Eastside Thunder', true],
  ['g1', game.starts_at, 'live', 'River 14U', true], ['g-d', '2026-10-17T18:00:00Z', 'scheduled', 'Mesa Miners', false],
  ['g-e', '2026-10-24T23:30:00Z', 'scheduled', 'North Valley Storm', true],
] as const).map(([id, starts_at, status, opponent_name, is_home]) => ({ ...game, id, starts_at, status, opponent_name, is_home }));
// The player card's spray chart (p2): made-up balls in play from games the
// pad scored, at spots on the pad's fielder picker. Three singles were placed
// by tapping the left fielder, so they share that spot; three have no spot (a
// home run, a hit whose spot was skipped, an older play); two are from the
// spring, which the Fall card leaves out. &spray=none: the same balls, none of
// them with a spot.
const sprayRows: [string, string, number | null, number | null, string?][] = [
  ['H1', 'LD', 17, 21], ['H1', 'GB', 30, 40], ['H2', 'LD', 10, 30], ['GB', 'GB', 36, 46], ['GB', 'HGB', 24, 60], ['FB', 'FB', 52, 14],
  ['H1', 'FB', 17, 21], ['PU', 'PU', 70, 70], ['LD', 'LD', 62, 46], ['E', 'HGB', 25, 64], ['FC', 'GB', 38, 44], ['H3', 'FB', 72, 12],
  ['H1', 'LD', 50, 11], ['GB', 'GB', 49, 66], ['FB', 'FB', 80, 24], ['SF', 'FB', 20, 18], ['DP', 'GB', 34, 44], ['H1', 'GB', 17, 21],
  ['HR', 'FB', null, null], ['H1', 'LD', null, null], ['GB', 'GB', null, null], ['H2', 'LD', 60, 20, 's2'], ['GB', 'GB', 40, 50, 's2'],
];
const kitSpray = sprayBalls(
  sprayRows.map(([kind, bb, x, y, s], i) => ({ id: i + 1, type: kind === 'HR' ? 'homerun' : 'play', season_id: s ?? 's1',
    payload: { play: { kind }, inputs: { kind, bb, ...(x !== null ? { loc: { x, y } } : {}) } } })),
  sprayRows.map((_, i) => ({ event_id: i + 1, side: 'us' as const, bid: 'p2', b_pa: 1 })), 'p2');
const pool = players.filter((p) => p.active).map((p) => ({ bid: p.id, num: p.number, name: `${p.first_name} ${p.last_name}`, avg: '.300' }));
const invites: Invite[] = [{ token: '5f0c2c1e-0000-4000-8000-000000000000', role: 'media', expires_at: '2026-10-09T00:00:00Z' }];

export default async function Kit({ searchParams }: { searchParams: Promise<{ v?: string; role?: string; logo?: string; card?: string; line?: string; status?: string; look?: string; sport?: string; moment?: string; spot?: string; qr?: string; qsize?: string; qop?: string; bs?: string; bpos?: string; cs?: string; theme?: string; style?: string; rhe?: string; scene?: string; reason?: string; ss?: string; win?: string; cpos?: string; blurb?: string; spray?: string }> }) {
  if (process.env.NODE_ENV === 'production') notFound();
  const { v = 'today', role: r, logo, card, line, status, look, sport, moment, spot, qr, qsize, qop, bs, bpos, cs, theme, style, rhe, scene, reason, ss, win, cpos, blurb, spray } = await searchParams;
  // &logo=1 gives the team a made-up crest, to see every screen with a logo.
  const team: Team = logo ? { ...baseTeam, logo_url: '/dev/sample-logo.svg' } : baseTeam;
  const role = (r ?? 'organizer') as Role;
  const base = `/t/${team.slug}`;
  const at = v === 'today' ? base : v.startsWith('lineup') ? `${base}/games/g1/lineup` : `${base}/${v}`;
  const tabs = <div className="page-top team-tabs" style={{ paddingTop: 10 }}><TeamTabs slug={team.slug} players={11} opponents={6} at={at} /></div>;
  if (v === 'pad') {
    // A game in the 5th: two on, 2-1, the made-up lineups on both sides. Taps
    // work on screen; they fail to save, since nothing is behind this page.
    const them = { batters: players.slice(0, 9).map((p, i) => ({ bid: `o${i}`, num: String(30 + i), name: ['Ava Reyes', 'Ben Cole', 'Cal Ruiz', 'Dee Park', 'Eli Moss', 'Finn Shaw', 'Gus Hale', 'Hal Kim', 'Ike Ross'][i] })),
      positions: { CF: 'o0', SS: 'o1', '1B': 'o2', C: 'o3', '3B': 'o4', '2B': 'o5', LF: 'o6', RF: 'o7', P: 'o8' } };
    // &status=over: the bottom of the 7th with the home side ahead, so the pad offers End game.
    // &status=final: that game, ended (Game menu > Pitching decisions).
    // &status=scheduled: before the first pitch (Game menu > Swap home and away).
    const over = status === 'over' || status === 'final', pre = status === 'scheduled';
    const live = pre ? {} : { inning: over ? 7 : 5, half: 'bottom', balls: 2, strikes: 1, outs: 1, bases: { first: true, second: true, third: false }, home_score: over ? 5 : 2, away_score: over ? 3 : 4,
      state: { batIdx: { home: 1 }, pitches: { away: 58 }, runners: { first: 'p1', second: 'p9' } } };
    return <Pad slug={team.slug} team={team} game={{ ...game, live, status: status === 'final' ? 'final' : pre ? 'scheduled' : 'live', seq: 0 }} lineups={{ us: lineup, them }}
      decided={{ w: 'p5', l: null, sv: 'p6' }}
      season={stats} tonightRows={[{ side: 'us', bid: 'p2', b_pa: 2, b_ab: 1, b_bb: 1 }]} regulation={7} canScore
      roster={players.map((p) => ({ id: p.id, first_name: p.first_name, last_name: p.last_name }))}
      bench={players.filter((p) => p.active).map((p) => ({ bid: p.id, num: p.number, name: `${p.first_name} ${p.last_name}` }))} canRoster log={kitLog}
      channel={{ token: 'kit', game_id: 'g1', show_line: true, auto_card: false, auto_mid: true, card: null, sponsor_name: 'Dairy Barn', bug_url: 'https://example.test', qr: { on: true, size: 18, pos: 'tr', opacity: 1 } }} />;
  }
  if (v === 'scorepad') {
    // The score-only pad: /dev/kit?v=scorepad&sport=football (soccer, basketball, volleyball).
    return <ScorePad slug={team.slug} team={team} canScore
      channel={{ token: 'kit', game_id: 'g1', show_line: true, auto_card: false, auto_mid: false, card: null, sponsor_name: 'Dairy Barn', bug_url: 'https://example.test', broadcast: {}, look: 'pressbox' }}
      game={{ ...game, sport: (sport as Sport) ?? 'football', status: 'live', seq: 0, live: { home_score: 14, away_score: 7, state: { period: 2 } } }} />;
  }
  if (v === 'public-game') {
    // The public game page, mid-game: /dev/kit?v=public-game (&status=final, scheduled).
    const them = { batters: players.slice(0, 9).map((p, i) => ({ bid: `o${i}`, num: String(11 + i), name: '' })), positions: { P: 'o0' } };
    const pub: PublicGame = {
      v: 'kit', team: { ...team, slug: team.slug }, opponent: { ...game.opponent!, slug: null }, season: { name: season.name, game_innings: 7 },
      game: { id: 'g1', is_home: true, status: (status as Game['status']) ?? 'live', seq: 9, starts_at: game.starts_at, venue: game.venue, counts_for_stats: true,
        live: { inning: 5, half: 'bottom', balls: 2, strikes: 1, outs: 1, bases: { first: false, second: true, third: false }, home_score: 2, away_score: 4,
          home_hits: 4, away_hits: 6, home_errors: 0, away_errors: 1, line_score: [{ top: 1, bottom: 0 }, { top: 0, bottom: 2 }, { top: 3, bottom: 0 }, { top: 0, bottom: 0 }, { top: 0, bottom: 0 }],
          state: { batIdx: { home: 1 }, pitches: { away: 58 } } } },
      lineups: { us: lineup, them },
      tonight: [{ side: 'us', bid: 'p1', b_pa: 2, b_ab: 1, b_bb: 1 }, { side: 'us', bid: 'p3', b_pa: 2, b_ab: 2, b_h: 1, b_rbi: 2 }, { side: 'us', bid: 'p5', p_outs: 12, p_bf: 19, p_h: 6, p_r: 4, p_er: 4, p_so: 5, p_pitches: 71 },
        { side: 'them', bid: 'o0', b_pa: 2, b_ab: 2, b_h: 1, b_r: 1, p_outs: 13, p_bf: 17, p_h: 4, p_r: 2, p_er: 2, p_so: 4, p_pitches: 58 }],
      pas: [{ side: 'them', bid: 'o0', inning: 1, kind: 'H1', code: '', rbi: 0 }, { side: 'us', bid: 'p1', inning: 1, kind: 'BB', code: null, rbi: 0 },
        { side: 'us', bid: 'p3', inning: 2, kind: 'H2', code: '', rbi: 2 }, { side: 'us', bid: 'p1', inning: 3, kind: 'FB', code: 'F8', rbi: 0 }],
    };
    return <LiveGame initial={pub} />;
  }
  if (v === 'overlay') {
    // The stream over a stand-in camera: /dev/kit?v=overlay&card=batter (pitcher, dueup, leaders, box), &look=primetime, &line=0, &status=final, &moment=1, &sport=football, &spot=pitch (or inning: plays one spot six seconds in), &qr=br&qsize=12&qop=0.6, &bs=0.6&bpos=tr&cs=0.7 (scorebug size and corner, card size), &cpos=tr (cards on their own, in that place).
    // Cards: batter, pitcher, dueup, leaders, box, lineup, defense, matchup, sponsor, mid.
    const them = { batters: players.slice(0, 9).map((p, i) => ({ bid: `o${i}`, num: String(11 + i), name: ['Dane Kell', 'Eli Shaw', 'Rob Pine'][i % 3] })), positions: { P: 'o0' } };
    const feed: Feed = {
      v: 'kit', show_line: line !== '0', auto_card: false, card: null, look: (look as Look) ?? 'pressbox', last: null, sponsor: { name: 'Dairy Barn', line: 'Cold treats on Elm Street', logo: null }, bug: { text: 'Streamed by example.test', url: 'https://example.test/watch' },
      layout: { bug: { scale: Number(bs) || undefined, pos: bpos as never }, cards: { scale: Number(cs) || undefined, pos: cpos as never } },
      qr: qr ? { on: true, size: Number(qsize) || 18, pos: (qr as QrPos), opacity: Number(qop) || 1 } : null,
      // &theme=retro&style=scorebox&rhe=1: v4's themes and layouts on Scoreboard's own bug.
      // &scene=starting (final, paused, mid)&reason=rain&ss=standard: the full-frame scenes; &win=1 has us winning the Final.
      // &blurb=1: a pregame blurb on Starting Soon (&blurb=long: three lines at the 60-character limit).
      broadcast: { theme,
        blurb: blurb ? (blurb === 'long'
          ? { game_id: 'g1', line1: 'W'.repeat(20) + ' Blue Steel meets the Hawks at Railyard Pk', line2: 'Steel are 5-2 this fall and have won three straight games', storyline: 'Last time out the Hawks won 9-2; Steel want that one back' }
          : { game_id: 'g1', line1: 'Blue Steel host the Hawks at Railyard Park', line2: 'Steel are 5-2 this fall, winners of three straight', storyline: 'Rematch: the Hawks took the first meeting 9-2' }) : undefined, style, show: { rhe: rhe === '1' }, scene_style: ss === 'standard' ? 'standard' : undefined,
        scene: scene === 'starting' || scene === 'final' || scene === 'paused' ? { kind: scene, reason: (reason as never) ?? 'lightning', at: new Date(KIT_NOW + 24 * 60000).toISOString(), since: new Date(KIT_NOW - 6 * 60000).toISOString() } : null },
      roster: players.map((p) => ({ id: p.id, num: p.number, name: `${p.first_name} ${p.last_name}` })),
      team, opponent: game.opponent!, season: { name: season.name, game_innings: 7 },
      game: { id: 'g1', sport: (sport as Sport) ?? 'baseball', is_home: true, status: (status as Game['status']) ?? 'live', seq: 9,
        live: { inning: 5, half: 'bottom', balls: 2, strikes: 1, outs: 1, bases: { first: false, second: true, third: false }, home_score: 2, away_score: 4,
          home_hits: 4, away_hits: 6, home_errors: 0, away_errors: 1, line_score: [{ top: 1, bottom: 0 }, { top: 0, bottom: 2 }, { top: 3, bottom: 0 }, { top: 0, bottom: 0 }, { top: 0, bottom: 0 }],
          state: { batIdx: { home: 1 }, pitches: { away: 58 } }, ...(win ? { home_score: 6, inning: 7, half: 'bottom', outs: 3, line_score: [{ top: 1, bottom: 0 }, { top: 0, bottom: 2 }, { top: 3, bottom: 0 }, { top: 0, bottom: 0 }, { top: 0, bottom: 1 }, { top: 0, bottom: 0 }, { top: 0, bottom: 3 }] } : {}) },
        starts_at: new Date(KIT_NOW + 12 * 60000).toISOString(), venue: 'Railyard Park' },
      lineups: { us: lineup, them },
      tonight: [{ side: 'us', bid: 'p1', b_pa: 2, b_ab: 1, b_bb: 1 }, { side: 'us', bid: 'p3', b_pa: 2, b_ab: 2, b_h: 1 }, { side: 'them', bid: 'o0', p_outs: 13, p_r: 2, p_so: 4, p_pitches: 58 }],
      pas: [{ side: 'us', bid: 'p1', inning: 1, kind: 'BB', code: null }, { side: 'us', bid: 'p1', inning: 3, kind: 'FB', code: 'F8' }],
      season_stats: stats,
    };
    return <div style={{ position: 'fixed', inset: 0, background: 'linear-gradient(160deg, #2f5a34 0%, #23452a 38%, #6b4f35 70%, #3d2c1e 100%)' }}><Stage feed={feed} card={scene === 'mid' ? 'mid' : (card as CardKind) ?? null} moment={moment ? { text: 'Home run', who: 'Cy Park', runs: Number(moment) || 0 } : null} />
      <Scenes feed={feed} now={KIT_NOW} weather={{ temp: 72, text: 'Clear', icon: '☀️', wind: 8, dir: 'SW', pop: 10 }} strike={0} />{spot && <SpotsDemo cut={spot === 'inning' ? 'inning' : 'pitch'} />}</div>;
  }
  return (
    <TeamFrame team={team} role={role} season={season} at={at}>
      {v === 'today' && <TodayView team={team} role={role} players={11} opponents={6} season={season} stats={stats} roster={players}
        day={[{ game: { ...game, id: 'g0', status: 'live', opponent_name: 'Calvary Baseball' }, stale: true, lineups: {} }, { game, stale: false, lineups: { us: lineup } },
          { game: { ...game, id: 'g2', starts_at: '2026-10-03T21:45:00Z' }, stale: false, lineups: {} }]} />}
      {v === 'today-empty' && <TodayView team={team} role={role} players={11} opponents={6} season={season} />}
      {v === 'game' && <GameView team={team} role={role} game={game} lineups={{ us: lineup }} seasons={seasons} />}
      {v === 'lineup' && <div className="page"><LineupEditor slug={team.slug} gameId="g1" side="us" initial={lineup} stored={false} pool={pool} presets={[{ label: 'Whole roster, by number', lineup }]} canEdit canRoster {...kitNav('us')} /></div>}
      {v === 'lineup-them' && <div className="page"><LineupEditor slug={team.slug} gameId="g1" side="them" initial={{ batters: [], positions: {} }} stored={false} pool={[]} presets={[]} canEdit {...kitNav('them')} /></div>}
      {v === 'roster' && <>{tabs}<RosterView team={team} role={role} players={players} stats={stats} /></>}
      {v === 'opponent' && <>{tabs}<div className="page"><OpponentEditor slug={team.slug} opponent={{ id: 'o1', name: 'Sanger Wolf', abbr: 'SANGER', color: '#5d4ea6', color2: '#f2f6fc', logo_url: null,
        roster: { batters: [{ bid: 'w1', num: '12', name: 'Bentley Jackway' }, { bid: 'w2', num: '10', name: 'Hayden Wetli' }, { bid: 'w3', num: '5', name: 'Maddox Wolf' }], positions: { P: 'w3', SS: 'w1' } } }} /></div></>}
      {v === 'empty' && <>{tabs}<RosterView team={team} role={role} players={[]} /></>}
      {v === 'player' && <PlayerView team={team} role={role} player={players[1]} lines={stats.filter((x) => x.player_id === 'p2')} seasons={seasons}
        spray={spray === 'none' ? kitSpray.map((b) => ({ ...b, at: null })) : kitSpray} />}
      {v === 'pitcher' && <PlayerView team={team} role={role} player={players[4]} lines={stats.filter((x) => x.player_id === 'p5')} seasons={seasons} />}
      {v === 'staff' && <>{tabs}<StaffView team={team} role={role} me="u1" staff={staff} invites={[]} origin="http://localhost:3000" /></>}
      {v === 'staff-link' && <>{tabs}<StaffView team={team} role={role} me="u1" staff={staff} invites={invites} origin="http://localhost:3000" /></>}
      {v === 'stats' && <>{tabs}<StatsView slug={team.slug} seasons={seasons} season={season} lines={stats} players={players} fmt={team.name_format} /></>}
      {v === 'season' && <SeasonView team={team} role={role} seasons={seasons} stats={stats} players={players} games={schedule} />}
      {v === 'import' && <div className="page"><ImportFlow slug={team.slug} seasons={seasons} roster={players.slice(0, 6)}
        padGames={{ s1: [{ id: 'g1', season_id: 's1', opponent_name: 'Sanger Wolf', is_home: true, starts_at: '2026-10-17T17:00:00Z' }] }} /></div>}
      {v === 'season-empty' && <SeasonView team={team} role={role} seasons={seasons} />}
      {v === 'settings' && <>{tabs}<SettingsView team={team} role={role} publicUrl="http://localhost:3000/team/blue-steel-14u" /></>}
      {v === 'stream' && <>{tabs}<StreamSetup team={team} canLead={role !== 'coach'} streamUrl="http://localhost:3000/overlay/5f0c2c1e-0000-4000-8000-000000000000"
        channel={{ look: 'pressbox', layout: null, qr: null, show_line: true, bug_text: 'Streamed by example.test', bug_url: 'https://example.test', sponsor_name: 'Dairy Barn', sponsor_line: 'Cold treats on Elm Street', sponsor_logo: null }} /></>}
    </TeamFrame>
  );
}
