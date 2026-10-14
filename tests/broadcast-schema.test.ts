// v5 broadcast: settings merged key by key, stamped commands, OBS reports by
// token, the game clock, and starting a game over.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { makeDb } from './db.ts';

type Db = Awaited<ReturnType<typeof makeDb>>;
let t: Db;
let team = '', game = '', token = '';
type Feed = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const feed = () => t.as<{ f: Feed }>(null, `select overlay_feed($1) f`, [token]).then((r) => r[0].f);

before(async () => {
  t = await makeDb();
  for (const [k, n] of [['owner', 'Olive'], ['media', 'Mel'], ['stranger', 'Stan']]) await t.signUp(k, n);
  [{ id: team }] = await t.as<{ id: string }>('owner', `select id from create_team('Blue Steel', 'STEEL', '#2f63cc', '14U', 'Fall 2026')`);
  const [{ token: inv }] = await t.as<{ token: string }>('owner', `insert into staff_invites (team_id, role) values ($1, 'media') returning token`, [team]);
  await t.as('media', `select accept_invite($1)`, [inv]);
  [{ id: game }] = await t.as<{ id: string }>('owner',
    `insert into games (team_id, opponent_name, opponent_abbr, starts_at, settings) values ($1, 'Hawks', 'HWK', now() + interval '1 hour', '{"time_limit": 5400}') returning id`, [team]);
  [{ token }] = await t.as<{ token: string }>('owner', `select token from channels where team_id = $1`, [team]);
});

test('broadcast settings merge, and null removes a key', async () => {
  await t.as('media', `select set_broadcast($1, '{"theme": "midnight", "sound": {"pack": "organ"}}')`, [team]);
  await t.as('media', `select set_broadcast($1, '{"style": "bar", "theme": null}')`, [team]);
  assert.deepEqual((await feed()).broadcast, { sound: { pack: 'organ' }, style: 'bar' });
  await assert.rejects(t.as('stranger', `select set_broadcast($1, '{"theme": "x"}')`, [team]), /cannot run this stream/);
  await assert.rejects(t.as(null, `select set_broadcast($1, '{}')`, [team]), /permission denied/);
});

test('a command is stamped, and only staff send one', async () => {
  await t.as('media', `select send_cmd($1, '{"type": "moment", "kind": "walkoff"}')`, [team]);
  const c = (await feed()).cmd;
  assert.equal(c.kind, 'walkoff');
  assert.ok(Number(c.n) > 1.7e12);
  await assert.rejects(t.as('stranger', `select send_cmd($1, '{"type": "moment"}')`, [team]), /cannot run this stream/);
});

test('OBS reports by token; the staff read it, the feed does not carry it', async () => {
  await t.as(null, `select obs_report($1, '{"streaming": true}')`, [token]);
  const [{ obs }] = await t.as<{ obs: Record<string, unknown> }>('media', `select obs from channel_obs where team_id = $1`, [team]);
  assert.equal(obs.streaming, true);
  assert.equal((await feed()).obs, undefined);
  await t.as(null, `select obs_report('00000000-0000-0000-0000-000000000000', '{"streaming": false}')`);
  assert.equal((await t.as<{ obs: Record<string, unknown> }>('media', `select obs from channel_obs where team_id = $1`, [team]))[0].obs.streaming, true);
});

test('the clock and settings are on the game the stream shows', async () => {
  await t.as('owner', `update games set clock = '{"mode": "down", "running": true, "remaining": 5400}' where id = $1`, [game]);
  const g = (await feed()).game;
  assert.equal(g.clock.mode, 'down');
  assert.equal(g.settings.time_limit, 5400);
  await t.as('stranger', `update games set clock = '{}' where id = $1`, [game]);
  assert.equal((await feed()).game.clock.mode, 'down');
});

test('reset_game takes every play back', async () => {
  await t.as('owner', `select apply_play($1, 0, 'ball', '{"balls": 1}', '{}', '[]')`, [game]);
  assert.equal((await feed()).game.status, 'live');
  await assert.rejects(t.as('media', `select reset_game($1)`, [game]), /cannot score/);
  await t.as('owner', `select reset_game($1)`, [game]);
  const g = (await feed()).game;
  assert.equal(g.status, 'scheduled');
  assert.deepEqual(g.live, {});
  assert.equal(g.clock, null);
  assert.equal((await t.as<{ n: number }>('owner', `select count(*)::int n from game_events where game_id = $1`, [game]))[0].n, 0);
});
