// The per-pitch path, made lighter: apply_plays (every waiting play in one
// request) and overlay_season (season lines out of the scorebug's feed).
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { makeDb } from './db.ts';

type Db = Awaited<ReturnType<typeof makeDb>>;
let t: Db;
let team = '', season = '', game = '', token = '', p7 = '';
const fails = (p: Promise<unknown>, re: RegExp) => assert.rejects(p, re);

before(async () => {
  t = await makeDb();
  for (const [k, n] of [['owner', 'Olive'], ['scorer', 'Sam'], ['media', 'Mel'], ['stranger', 'Stan']]) await t.signUp(k, n);
  [{ id: team }] = await t.as<{ id: string }>('owner', `select id from create_team('Blue Steel', 'STEEL', '#2f63cc', '14U', 'Fall 2026')`);
  [{ id: season }] = await t.as<{ id: string }>(null, `select id from seasons where team_id = $1`, [team]);
  for (const role of ['scorer', 'media']) {
    const [{ token: inv }] = await t.as<{ token: string }>('owner', `insert into staff_invites (team_id, role) values ($1, $2) returning token`, [team, role]);
    await t.as(role, `select accept_invite($1)`, [inv]);
  }
  [{ id: p7 }] = await t.as<{ id: string }>('owner', `insert into players (team_id, first_name, number) values ($1, 'Johnny', '7') returning id`, [team]);
  [{ id: game }] = await t.as<{ id: string }>('owner', `insert into games (team_id, season_id, opponent_name, opponent_abbr) values ($1, $2, 'Hawks', 'HAWKS') returning id`, [team, season]);
  [{ token }] = await t.as<{ token: string }>('owner', `select token from channels where team_id = $1`, [team]);
});

type Res = { seq: number; live: Record<string, unknown>; status: string; results: { seq: number; event: number }[] };
const plays = (who: string | null, seq: number, items: object[]) =>
  t.as<{ r: Res }>(who, `select apply_plays($1, $2, $3::jsonb) r`, [game, seq, JSON.stringify(items)]).then((r) => r[0].r);
const seqNow = async () => (await t.as<{ seq: number }>(null, `select seq from games where id = $1`, [game]))[0].seq;
const cids = async () => (await t.as<{ cid: string }>('owner', `select payload->>'cid' cid from game_events where game_id = $1 order by seq`, [game])).map((r) => r.cid);

test('plays in one request: each its own event and seq, in order, with its stats', async () => {
  const r = await plays('scorer', 0, [
    { type: 'ball', patch: { balls: 1 }, payload: { cid: 'a' }, stats: [{ side: 'them', bid: 'x1', p_pitches: 1 }] },
    { type: 'hit', patch: { balls: 0, bases: { first: true }, home_hits: 1, junk: 1 }, payload: { cid: 'b' },
      stats: [{ side: 'us', bid: p7, b_pa: 1, b_ab: 1, b_h: 1 }], status: null },
  ]);
  assert.equal(r.seq, 2);
  assert.equal(r.status, 'live');
  assert.equal(r.live.home_hits, 1);
  assert.equal('junk' in r.live, false);
  assert.deepEqual(r.results.map((x) => x.seq), [1, 2]);
  assert.deepEqual(await cids(), ['a', 'b']);
  const stats = await t.as(null, `select bid, player_id, b_h, p_pitches from game_stats where game_id = $1 order by id`, [game]);
  assert.deepEqual(stats, [{ bid: 'x1', player_id: null, b_h: 0, p_pitches: 1 }, { bid: p7, player_id: p7, b_h: 1, p_pitches: 0 }]);
  // undo_play takes back the last of them, as after single plays.
  const [{ u }] = await t.as<{ u: { seq: number; undone: string } }>('scorer', `select undo_play($1, 2) u`, [game]);
  assert.equal(u.undone, 'hit');
  assert.deepEqual(await cids(), ['a']);
});

test('an old seq is refused with PB409 and nothing in the batch saves', async () => {
  const at = await seqNow();
  await fails(plays('scorer', at - 1, [{ type: 'ball', patch: { balls: 2 }, payload: { cid: 'c' } }]), /changed on another device/);
  assert.equal(await seqNow(), at);
});

test('one bad play takes the whole batch with it', async () => {
  const at = await seqNow();
  await fails(plays('scorer', at, [
    { type: 'ball', patch: { balls: 2 }, payload: { cid: 'd' } },
    { type: 'hit', patch: {}, payload: { cid: 'e' }, stats: [{ side: 'us', bid: p7, b_h: 2 }] },
  ]), /check constraint/);
  await fails(plays('scorer', at, [{ type: 'ball', patch: 'nope', payload: { cid: 'f' } }]), /could not be read/);
  await fails(plays('scorer', at, []), /could not be read/);
  assert.equal(await seqNow(), at);
  assert.deepEqual(await cids(), ['a']);
});

test('the same seats as apply_play: media, strangers and the public cannot score', async () => {
  const at = await seqNow();
  const one = [{ type: 'ball', patch: { balls: 1 }, payload: { cid: 'g' } }];
  await fails(plays('media', at, one), /cannot score/);
  await fails(plays('stranger', at, one), /cannot score/);
  await fails(plays(null, at, one), /permission denied/);
  assert.equal(await seqNow(), at);
});

test('the scorebug feed no longer builds season lines; overlay_season does', async () => {
  const [{ f }] = await t.as<{ f: { season_stats: unknown[]; game: { id: string } } }>(null, `select overlay_feed($1) f`, [token]);
  assert.equal(f.game.id, game);
  assert.deepEqual(f.season_stats, []);
  const [{ s }] = await t.as<{ s: { game: string; season_stats: { player_id: string; b_h: number }[] } }>(null, `select overlay_season($1) s`, [token]);
  assert.equal(s.game, game);
  // The game so far counts: Johnny's hit was undone, so no line for him yet.
  assert.deepEqual(s.season_stats, []);
  const at = await seqNow();
  await plays('scorer', at, [{ type: 'hit', patch: {}, payload: { cid: 'h' }, stats: [{ side: 'us', bid: p7, b_pa: 1, b_ab: 1, b_h: 1 }] }]);
  const [{ s: s2 }] = await t.as<{ s: { season_stats: { player_id: string; b_h: number }[] } }>(null, `select overlay_season($1) s`, [token]);
  assert.deepEqual(s2.season_stats.map((l) => [l.player_id, l.b_h]), [[p7, 1]]);
  // An unknown link: nothing, as with the feed.
  assert.equal((await t.as<{ s: null }>(null, `select overlay_season(gen_random_uuid()) s`))[0].s, null);
});
