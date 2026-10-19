// Stage 2c: plays, undo, and season stats that add scored games to imports.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { makeDb } from './db.ts';

type Db = Awaited<ReturnType<typeof makeDb>>;
let t: Db;
let team = '', season = '', game = '', scrim = '', p7 = '', p12 = '';
const fails = (p: Promise<unknown>, re: RegExp) => assert.rejects(p, re);

before(async () => {
  t = await makeDb();
  for (const [k, n] of [['owner', 'Olive'], ['scorer', 'Sam'], ['media', 'Mel'], ['stranger', 'Stan']]) await t.signUp(k, n);
  [{ id: team }] = await t.as<{ id: string }>('owner', `select id from create_team('Blue Steel', 'STEEL', '#2f63cc', '14U', 'Fall 2026')`);
  [{ id: season }] = await t.as<{ id: string }>(null, `select id from seasons where team_id = $1`, [team]);
  for (const role of ['scorer', 'media']) {
    const [{ token }] = await t.as<{ token: string }>('owner', `insert into staff_invites (team_id, role) values ($1, $2) returning token`, [team, role]);
    await t.as(role, `select accept_invite($1)`, [token]);
  }
  [{ id: p7 }] = await t.as<{ id: string }>('owner', `insert into players (team_id, first_name, number) values ($1, 'Johnny', '7') returning id`, [team]);
  [{ id: p12 }] = await t.as<{ id: string }>('owner', `insert into players (team_id, first_name, number) values ($1, 'Ben', '12') returning id`, [team]);
  [{ id: game }] = await t.as<{ id: string }>('owner', `insert into games (team_id, season_id, opponent_name, opponent_abbr) values ($1, $2, 'Hawks', 'HAWKS') returning id`, [team, season]);
  [{ id: scrim }] = await t.as<{ id: string }>('owner', `insert into games (team_id, season_id, opponent_name, opponent_abbr, counts_for_stats) values ($1, $2, 'Scrim', 'SCRIM', false) returning id`, [team, season]);
});

type Res = { seq: number; live: Record<string, unknown>; status: string };
const play = (who: string | null, g: string, seq: number, type: string, patch: object, stats: object[] = [], status: string | null = null) =>
  t.as<{ apply_play: Res }>(who, `select apply_play($1, $2, $3, $4::jsonb, '{}'::jsonb, $5::jsonb, $6)`,
    [g, seq, type, JSON.stringify(patch), JSON.stringify(stats), status]).then((r) => r[0].apply_play);

test('a play moves the game on, makes it live, and counts', async () => {
  const r = await play('scorer', game, 0, 'hit', { balls: 0, strikes: 0, bases: { first: true }, home_hits: 1, secret_name: 'Johnny' },
    [{ side: 'us', bid: p7, b_pa: 1, b_ab: 1, b_h: 1 }, { side: 'them', bid: 'x1', p_bf: 1, p_h: 1, p_pitches: 1 }]);
  assert.equal(r.seq, 1);
  assert.equal(r.status, 'live');
  assert.equal(r.live.home_hits, 1);
  // Only game fields reach the public row.
  assert.equal('secret_name' in r.live, false);
  const [row] = await t.as(null, `select status, seq, live from games where id = $1`, [game]);
  assert.equal(row.seq, 1);
  const stats = await t.as(null, `select side, bid, player_id, b_h, p_h from game_stats where game_id = $1 order by side desc`, [game]);
  assert.deepEqual(stats, [{ side: 'us', bid: p7, player_id: p7, b_h: 1, p_h: 0 }, { side: 'them', bid: 'x1', player_id: null, b_h: 0, p_h: 1 }]);
});

test('a play against an old count is refused: another phone got there first', async () => {
  await fails(play('scorer', game, 0, 'ball', { balls: 1 }), /changed on another device/);
});

test('media, strangers and the public cannot score; nobody writes the log directly', async () => {
  await fails(play('media', game, 1, 'ball', { balls: 1 }), /cannot score/);
  await fails(play('stranger', game, 1, 'ball', { balls: 1 }), /cannot score/);
  await fails(play(null, game, 1, 'ball', { balls: 1 }), /permission denied/);
  await fails(t.as('owner', `insert into game_stats (event_id, game_id, side, bid) values (1, $1, 'us', 'x')`, [game]), /permission denied/);
  await fails(t.as('owner', `update games set live = '{}' where id = $1`, [game]), /permission denied/);
});

test('a stat row cannot claim another team\'s player, or more than one hit on one play', async () => {
  const [{ id: other }] = await t.as<{ id: string }>('stranger', `select id from create_team('Hawks', 'HAWKS', '#aa2222', null, null)`);
  const [{ id: theirs }] = await t.as<{ id: string }>('stranger', `insert into players (team_id, first_name) values ($1, 'Hawk') returning id`, [other]);
  const r = await play('scorer', game, 1, 'ball', { balls: 1 }, [{ side: 'us', bid: theirs, p_pitches: 1 }]);
  const [row] = await t.as(null, `select player_id from game_stats where bid = $1`, [theirs]);
  assert.equal(row.player_id, null);
  await fails(play('scorer', game, r.seq, 'hit', {}, [{ side: 'us', bid: p7, b_h: 2 }]), /check constraint/);
});

test('undo puts the game back and takes the play\'s stats with it', async () => {
  const [{ seq }] = await t.as<{ seq: number }>(null, `select seq from games where id = $1`, [game]);
  const r = await play('scorer', game, seq, 'strikeout', { strikes: 0, outs: 1 }, [{ side: 'us', bid: p12, b_pa: 1, b_ab: 1, b_so: 1 }]);
  const [{ undo_play: u }] = await t.as<{ undo_play: Res & { undone: string } }>('scorer', `select undo_play($1, $2)`, [game, r.seq]);
  assert.equal(u.undone, 'strikeout');
  assert.equal(u.seq, r.seq + 1);
  assert.equal(u.live.outs, undefined);
  assert.equal((await t.as(null, `select 1 from game_stats where bid = $1`, [p12])).length, 0);
  // Undo the first plays too: back to before the first pitch, status and all.
  let s = u.seq;
  for (let i = 0; i < 2; i++) s = (await t.as<{ undo_play: Res }>('scorer', `select undo_play($1, $2)`, [game, s]))[0].undo_play.seq;
  const [g] = await t.as(null, `select status, live from games where id = $1`, [game]);
  assert.deepEqual(g, { status: 'scheduled', live: {} });
  // Nothing left to undo: no change, no error.
  const [{ undo_play: none }] = await t.as<{ undo_play: Res & { undone: null } }>('scorer', `select undo_play($1, $2)`, [game, s]);
  assert.equal(none.undone, null);
});

test('season stats: imports plus counting games, our side only', async () => {
  await t.as('owner', `select import_season_stats($1, $2::jsonb)`, [season, JSON.stringify([{ player_id: p7, b_g: 10, b_pa: 30, b_ab: 27, b_h: 9 }])]);
  const [{ seq }] = await t.as<{ seq: number }>(null, `select seq from games where id = $1`, [game]);
  const a = await play('scorer', game, seq, 'hit', {}, [{ side: 'us', bid: p7, b_pa: 1, b_ab: 1, b_h: 1, b_2b: 1 }, { side: 'them', bid: 'p9', p_bf: 1 }]);
  await play('scorer', game, a.seq, 'out', {}, [{ side: 'us', bid: p7, b_pa: 1, b_ab: 1 }]);
  // A scrimmage is scored but never added.
  await play('scorer', scrim, 0, 'hit', {}, [{ side: 'us', bid: p7, b_pa: 1, b_ab: 1, b_h: 1 }]);
  const [line] = await t.as(null, `select b_g, b_pa, b_ab, b_h, b_2b, imported_at is not null as has_import from season_stats where player_id = $1`, [p7]);
  assert.deepEqual(line, { b_g: 11, b_pa: 32, b_ab: 29, b_h: 10, b_2b: 1, has_import: true });
});

test('a pitcher\'s games count once per game, not once per pitch', async () => {
  const [{ seq }] = await t.as<{ seq: number }>(null, `select seq from games where id = $1`, [game]);
  let s = seq;
  for (let i = 0; i < 3; i++) s = (await play('scorer', game, s, 'ball', {}, [{ side: 'us', bid: p12, p_pitches: 1 }])).seq;
  await play('scorer', game, s, 'out', {}, [{ side: 'us', bid: p12, p_bf: 1, p_outs: 1, p_pitches: 1 }]);
  const [line] = await t.as(null, `select p_g, p_pitches, p_outs from season_stats where player_id = $1`, [p12]);
  assert.deepEqual(line, { p_g: 1, p_pitches: 4, p_outs: 1 });
});

test('fielding: a pickoff 2-5 credits the catcher an assist and a pickoff, the third baseman the putout', async () => {
  const [{ id: g2 }] = await t.as<{ id: string }>('owner', `insert into games (team_id, season_id, opponent_name, opponent_abbr) values ($1, $2, 'Owls', 'OWLS') returning id`, [team, season]);
  // Us in the field: p12 catching, p7 at third. Their runner on third picked off.
  const r = await play('scorer', g2, 0, 'runner', { outs: 1, bases: {} },
    [{ side: 'us', bid: p12, f_a: 1, c_pik: 1 }, { side: 'us', bid: p7, f_po: 1 }, { side: 'them', bid: 'r3', b_cs: 0 }]);
  assert.equal(r.seq, 1);
  const rows = await t.as(null, `select bid, f_po, f_a, c_pik from game_stats where game_id = $1 and side = 'us' order by bid = $2 desc`, [g2, p12]);
  assert.deepEqual(rows, [{ bid: p12, f_po: 0, f_a: 1, c_pik: 1 }, { bid: p7, f_po: 1, f_a: 0, c_pik: 0 }]);
  // The season adds them, beside whatever an import brought.
  const [line] = await t.as<{ f_po: number; f_a: number; c_pik: number }>(null,
    `select f_po, f_a, c_pik from season_stats where season_id = $1 and player_id = $2`, [season, p12]);
  assert.deepEqual(line, { f_po: 0, f_a: 1, c_pik: 1 });
  // A play may touch up to 16 people; a 17th is refused.
  const many = Array.from({ length: 17 }, (_, i) => ({ side: 'them', bid: `x${i}` }));
  await fails(play('scorer', g2, 1, 'play', {}, many), /could not be read/);
  // And a fielder cannot make four putouts on one play.
  await fails(play('scorer', g2, 1, 'play', {}, [{ side: 'us', bid: p7, f_po: 4 }]), /check constraint/);
});

test('fielding: a GameChanger import carries its fielding columns into the season', async () => {
  await t.as('owner', `select import_season_stats($1, $2::jsonb)`, [season, JSON.stringify([{ player_id: p7, b_g: 3, f_po: 5, f_a: 2, f_e: 1, c_sb: 4, c_cs: 1, c_pb: 2, p_pik: 1 }])]);
  const [line] = await t.as(null, `select f_po, f_a, f_e, c_sb, c_cs, c_pb, p_pik from season_stats where season_id = $1 and player_id = $2`, [season, p7]);
  // 5 imported + the 1 putout from the pickoff above.
  assert.deepEqual(line, { f_po: 6, f_a: 2, f_e: 1, c_sb: 4, c_cs: 1, c_pb: 2, p_pik: 1 });
});

test('play edits: the wrong kid credited moves to the right one; the fielders follow a new code', async () => {
  const [{ id: g3 }] = await t.as<{ id: string }>('owner', `insert into games (team_id, season_id, opponent_name, opponent_abbr) values ($1, $2, 'Bees', 'BEES') returning id`, [team, season]);
  // We bat; p7 is credited with a 6-3 groundout that p12 hit. Their 9 pitching, their 6 and 3 fielding.
  await t.as('scorer', `select apply_play($1, 0, 'play', '{"outs":1}'::jsonb, $2::jsonb, $3::jsonb, null)`, [g3,
    JSON.stringify({ play: { kind: 'GB', code: '6-3', outs: 1, inning: 1, half: 'bottom' } }),
    JSON.stringify([{ side: 'us', bid: p7, b_pa: 1, b_ab: 1 }, { side: 'them', bid: 'x9', p_bf: 1, p_outs: 1, p_pitches: 1 },
      { side: 'them', bid: 'x6', f_a: 1 }, { side: 'them', bid: 'x3', f_po: 1 }])]);
  const [{ id: ev }] = await t.as<{ id: number }>('owner', `select id from game_events where game_id = $1`, [g3]);
  const before = (await t.as<{ b_pa: number }>(null, `select b_pa from season_stats where season_id = $1 and player_id = $2`, [season, p12]))[0]?.b_pa ?? 0;

  // Media cannot; a stranger cannot.
  await fails(t.as('media', `select edit_play_credit($1, $2, 'us', $3, $4)`, [g3, ev, p7, p12]), /cannot edit/);
  await fails(t.as('stranger', `select edit_play_credit($1, $2, 'us', $3, $4)`, [g3, ev, p7, p12]), /cannot edit/);
  // The scorer moves the at-bat to p12: the row, its player, and the season with it.
  const [{ edit_play_credit: moved }] = await t.as<{ edit_play_credit: number }>('scorer', `select edit_play_credit($1, $2, 'us', $3, $4)`, [g3, ev, p7, p12]);
  assert.equal(moved, 1);
  const [row] = await t.as(null, `select bid, player_id, b_pa from game_stats where event_id = $1 and side = 'us'`, [ev]);
  assert.deepEqual(row, { bid: p12, player_id: p12, b_pa: 1 });
  const [after] = await t.as<{ b_pa: number }>(null, `select b_pa from season_stats where season_id = $1 and player_id = $2`, [season, p12]);
  assert.equal(after.b_pa, before + 1);
  // A kid already in the play cannot take another's part; nobody can be moved who is not in it.
  await fails(t.as('scorer', `select edit_play_credit($1, $2, 'them', 'x9', 'x6')`, [g3, ev]), /already has a part/);
  await fails(t.as('scorer', `select edit_play_credit($1, $2, 'them', 'nobody', 'x7')`, [g3, ev]), /Nobody by that name/);

  // The fielders: it was 5-3, not 6-3. The shortstop's assist goes, the third baseman gets one, the code changes.
  await t.as('scorer', `select edit_play_fielding($1, $2, 'them', '5-3', $3::jsonb)`, [g3, ev,
    JSON.stringify([{ bid: 'x5', f_a: 1 }, { bid: 'x3', f_po: 1 }])]);
  const field = await t.as(null, `select bid, f_po, f_a from game_stats where event_id = $1 and side = 'them' and (f_po > 0 or f_a > 0) order by bid`, [ev]);
  assert.deepEqual(field, [{ bid: 'x3', f_po: 1, f_a: 0 }, { bid: 'x5', f_po: 0, f_a: 1 }]);
  const [{ code }] = await t.as<{ code: string }>('owner', `select payload->'play'->>'code' code from game_events where id = $1`, [ev]);
  assert.equal(code, '5-3');
  // The game itself did not move: no new seq, nobody else's phone stopped.
  const [{ seq }] = await t.as<{ seq: number }>(null, `select seq from games where id = $1`, [g3]);
  assert.equal(seq, 1);
});
