// What the public sees of a team's kids: first name and last initial by
// default, nothing at all for a private team, no game address before the
// final, and typed-in opponents by number only.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { makeDb } from './db.ts';

type Db = Awaited<ReturnType<typeof makeDb>>;
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
let t: Db;
let team = '', game = '', token = '', player = '';

before(async () => {
  t = await makeDb();
  await t.signUp('owner', 'Olive');
  await t.signUp('stranger', 'Sam');
  [{ id: team }] = await t.as<{ id: string }>('owner', `select id from create_team('Blue Steel', 'STEEL', '#2f63cc', '14U', 'Fall 2026')`);
  [{ id: player }] = await t.as<{ id: string }>('owner', `insert into players (team_id, first_name, last_name, number) values ($1, 'Alex', 'Raney', '12') returning id`, [team]);
  const [{ id: season }] = await t.as<{ id: string }>('owner', `select id from seasons where team_id = $1`, [team]);
  [{ id: game }] = await t.as<{ id: string }>('owner',
    `insert into games (team_id, season_id, opponent_name, opponent_abbr, starts_at, venue, address, venue_geo)
     values ($1, $2, 'Hawks', 'HAWK', now() + interval '2 days', 'Elm Park', '12 Elm St', '{"lat": 41.9, "lon": -87.6}') returning id`, [team, season]);
  const us = { batters: [{ bid: player, num: '12', name: 'Alex Raney' }], positions: {} };
  const them = { batters: [{ bid: 'x1', num: '19', name: 'Dane Kell' }], positions: {} };
  await t.as('owner', `insert into game_lineups (game_id, side, data) values ($1, 'us', $2::jsonb), ($1, 'them', $3::jsonb)`, [game, JSON.stringify(us), JSON.stringify(them)]);
  [{ token }] = await t.as<{ token: string }>('owner', `select token from channels where team_id = $1`, [team]);
});

test('a new player and a new team default to first name and last initial', async () => {
  const [p] = await t.as<{ public_name: string }>('owner', `select public_name from players where id = $1`, [player]);
  assert.equal(p.public_name, 'first_initial');
  const [tm] = await t.as<{ name_format: string; private: boolean }>(null, `select name_format, private from teams where id = $1`, [team]);
  assert.deepEqual(tm, { name_format: 'first_initial', private: false });
  const roster = await t.as<{ display_name: string }>(null, `select display_name from public_roster($1)`, [team]);
  assert.deepEqual(roster.map((r) => r.display_name), ['Alex R.']);
});

test('anon gets no address or coordinates for an upcoming game, and gets them once it is final', async () => {
  const pg = async (who: string | null) => (await t.as<{ f: Json }>(who, `select public_game($1) f`, [game]))[0].f;
  const g = (await pg(null)).game;
  assert.equal(g.address, null);
  assert.equal(g.venue_geo, null);
  assert.equal(g.venue, 'Elm Park');
  assert.equal((await pg('owner')).game.address, '12 Elm St', 'staff still see it');
  await assert.rejects(t.as(null, `select address from games where id = $1`, [game]), /permission denied/);
  await assert.rejects(t.as(null, `select venue_geo from games where id = $1`, [game]), /permission denied/);
  assert.equal((await t.as(null, `select venue from games where id = $1`, [game])).length, 1);
  await t.db.query(`update games set status = 'final' where id = $1`, [game]);
  assert.equal((await pg(null)).game.address, '12 Elm St');
  await t.db.query(`update games set status = 'scheduled' where id = $1`, [game]);
});

test('a typed-in opponent is numbers only on the stream and the public game', async () => {
  const [{ f }] = await t.as<{ f: Json }>(null, `select overlay_feed($1) f`, [token]);
  assert.deepEqual(f.lineups.them.batters, [{ bid: 'x1', num: '19', name: '' }]);
  const [{ f: pg }] = await t.as<{ f: Json }>(null, `select public_game($1) f`, [game]);
  assert.deepEqual(pg.lineups.them.batters, [{ bid: 'x1', num: '19', name: '' }]);
});

test('only a team lead makes a team private; then strangers get no roster, games or stats', async () => {
  assert.equal((await t.as('stranger', `update teams set private = true where id = $1 returning id`, [team])).length, 0);
  await t.as('owner', `update teams set private = true where id = $1`, [team]);
  await t.db.query(`with e as (insert into game_events (game_id, seq, type, prev_live, prev_status) values ($1, 1, 'play', '{}', 'live') returning id)
    insert into game_stats (event_id, game_id, side, bid, player_id, b_pa) select e.id, $1, 'us', $2, $3::uuid, 1 from e`, [game, player, player]);
  assert.equal((await t.as(null, `select 1 from game_stats where game_id = $1`, [game])).length, 0);
  for (const who of [null, 'stranger']) {
    assert.deepEqual(await t.as(who, `select * from public_roster($1)`, [team]), [], `${who}: roster`);
    assert.equal((await t.as<{ f: unknown }>(who, `select public_game($1) f`, [game]))[0].f, null, `${who}: public_game`);
    assert.equal((await t.as(who, `select 1 from games where team_id = $1`, [team])).length, 0, `${who}: games`);
    assert.equal((await t.as(who, `select 1 from seasons where team_id = $1`, [team])).length, 0, `${who}: seasons`);
    assert.equal((await t.as(who, `select 1 from game_stats where game_id = $1`, [game])).length, 0, `${who}: game_stats`);
    assert.equal((await t.as(who, `select 1 from season_stats where team_id = $1`, [team])).length, 0, `${who}: season_stats`);
  }
  // The team's own staff still see everything; the stream still names nobody.
  assert.equal((await t.as('owner', `select 1 from games where team_id = $1`, [team])).length, 1);
  const [{ f }] = await t.as<{ f: Json }>(null, `select overlay_feed($1) f`, [token]);
  assert.equal(f.lineups.us.batters[0].name, '');
  await t.as('owner', `update teams set private = false where id = $1`, [team]);
  assert.equal((await t.as(null, `select 1 from games where team_id = $1`, [team])).length, 1);
  assert.equal((await t.as(null, `select 1 from game_stats where game_id = $1`, [game])).length, 1);
});

test('anon reads no accounts or seats; a stranger sees only their own', async () => {
  await assert.rejects(t.as(null, `select 1 from profiles`), /permission denied/);
  await assert.rejects(t.as(null, `select 1 from team_staff`), /permission denied/);
  assert.deepEqual(await t.as('stranger', `select display_name from profiles order by 1`), [{ display_name: 'Sam' }]);
  assert.equal((await t.as('stranger', `select 1 from team_staff where team_id = $1`, [team])).length, 0);
  assert.equal((await t.as('owner', `select 1 from team_staff where team_id = $1`, [team])).length, 1);
  assert.deepEqual(await t.as('owner', `select display_name from profiles order by 1`), [{ display_name: 'Olive' }]);
});
