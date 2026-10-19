// Stage 2b: games and lineups, as each role would reach them.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { makeDb } from './db.ts';

type Db = Awaited<ReturnType<typeof makeDb>>;
let t: Db;
let team = '', season = '', hawks = '', hawksSeason = '', game = '';
const fails = (p: Promise<unknown>, re: RegExp) => assert.rejects(p, re);

before(async () => {
  t = await makeDb();
  for (const [k, n] of [['owner', 'Olive'], ['coach', 'Cora'], ['scorer', 'Sam'], ['media', 'Mel'], ['stranger', 'Stan']]) await t.signUp(k, n);
  [{ id: team }] = await t.as<{ id: string }>('owner', `select id from create_team('Blue Steel', 'STEEL', '#2f63cc', '14U', 'Fall 2026')`);
  [{ id: season }] = await t.as<{ id: string }>(null, `select id from seasons where team_id = $1`, [team]);
  for (const role of ['coach', 'scorer', 'media']) {
    const [{ token }] = await t.as<{ token: string }>('owner', `insert into staff_invites (team_id, role) values ($1, $2) returning token`, [team, role]);
    await t.as(role, `select accept_invite($1)`, [token]);
  }
  [{ id: hawks }] = await t.as<{ id: string }>('stranger', `select id from create_team('Hawks', 'HAWKS', '#aa2222', '14U', 'Fall 2026')`);
  [{ id: hawksSeason }] = await t.as<{ id: string }>(null, `select id from seasons where team_id = $1`, [hawks]);
});

const newGame = (who: string, extra = '') => t.as<{ id: string }>(who,
  `insert into games (team_id, season_id, opponent_team_id, opponent_name, opponent_abbr, opponent_color, is_home, starts_at, venue${extra ? ', ' + extra.split('=')[0] : ''})
   values ($1, $2, $3, 'Hawks', 'HAWKS', '#aa2222', true, now() + interval '1 day', 'Field 3'${extra ? ', ' + extra.split('=')[1] : ''}) returning id`,
  [team, season, hawks]);

test('coaches and scorers make games; media and strangers cannot', async () => {
  [{ id: game }] = await newGame('scorer');
  await newGame('coach');
  await fails(newGame('media'), /row-level security/);
  await fails(newGame('stranger'), /row-level security/);
  await fails(t.as(null, `insert into games (team_id, opponent_name, opponent_abbr) values ($1, 'X', 'X')`, [team]), /permission denied/);
});

test('a game is public; its lineups are staff only', async () => {
  assert.equal((await t.as(null, `select opponent_name from games where id = $1`, [game]))[0].opponent_name, 'Hawks');
  const data = JSON.stringify({ batters: [{ bid: 'b1', num: '7', name: 'Johnny Vance' }], positions: { SS: 'b1' } });
  await t.as('coach', `insert into game_lineups (game_id, side, data) values ($1, 'us', $2::jsonb)`, [game, data]);
  for (const who of ['owner', 'scorer', 'media']) assert.equal((await t.as(who, `select 1 from game_lineups where game_id = $1`, [game])).length, 1, who);
  assert.equal((await t.as('stranger', `select 1 from game_lineups where game_id = $1`, [game])).length, 0);
  await fails(t.as(null, `select 1 from game_lineups`), /permission denied/);
  await fails(t.as('media', `update game_lineups set data = '{}' where game_id = $1 returning 1`, [game]).then((r) => { if (!r.length) throw new Error('row-level security: no row'); }), /row-level security/);
  // The scorer types the other team's lineup at the field.
  await t.as('scorer', `insert into game_lineups (game_id, side, data) values ($1, 'them', '{"batters":[]}'::jsonb)`, [game]);
  await fails(t.as('scorer', `insert into game_lineups (game_id, side, data) values ($1, 'home', '{}'::jsonb)`, [game]), /check constraint/);
});

test('the live state and status are not plain edits', async () => {
  await fails(t.as('owner', `update games set live = '{"home_score": 9}' where id = $1`, [game]), /permission denied/);
  await fails(t.as('owner', `update games set status = 'final' where id = $1`, [game]), /permission denied/);
  await fails(t.as('owner', `update games set team_id = $2 where id = $1`, [game, hawks]), /permission denied/);
  await t.as('scorer', `update games set venue = 'Field 4', is_home = false where id = $1`, [game]);
});

test('a game counts toward its own team\'s season only, and never against itself', async () => {
  await fails(t.as('owner', `update games set season_id = $2 where id = $1`, [game, hawksSeason]), /not this team/);
  await fails(t.as('owner', `insert into games (team_id, opponent_team_id, opponent_name, opponent_abbr) values ($1, $1, 'Us', 'US')`, [team]), /games_not_yourself/);
});

test('only an organizer or head coach deletes a game, and its lineups go with it', async () => {
  assert.equal((await t.as('coach', `delete from games where id = $1 returning id`, [game])).length, 0);
  assert.equal((await t.as('owner', `delete from games where id = $1 returning id`, [game])).length, 1);
  assert.equal((await t.db.query(`select 1 from game_lineups where game_id = $1`, [game])).rows.length, 0);
});

test('deleting the opponent\'s team leaves the game, under the name it had', async () => {
  const [{ id }] = await newGame('owner');
  await t.as('stranger', `delete from teams where id = $1`, [hawks]);
  const [g] = await t.as(null, `select opponent_team_id, opponent_name from games where id = $1`, [id]);
  assert.deepEqual(g, { opponent_team_id: null, opponent_name: 'Hawks' });
});

test('home and away swap from the pad before the first pitch, and not after it', async () => {
  const [{ id: g }] = await t.as<{ id: string }>('coach', `insert into games (team_id, season_id, opponent_name, opponent_abbr, is_home) values ($1, $2, 'Owls', 'OWLS', true) returning id`, [team, season]);
  // The pad's swap: an update guarded by the game as the pad read it (scheduled, at its seq).
  const swap = (who: string) => t.as<{ is_home: boolean }>(who,
    `update games set is_home = not is_home where id = $1 and status = 'scheduled' and seq = 0 returning is_home`, [g]);
  assert.deepEqual(await swap('scorer'), [{ is_home: false }]);
  assert.deepEqual(await swap('media'), []);
  await t.as('scorer', `select apply_play($1, 0, 'ball', '{"balls":1}'::jsonb, '{}'::jsonb, '[]'::jsonb, null)`, [g]);
  assert.deepEqual(await swap('scorer'), []);
  assert.equal((await t.as<{ is_home: boolean }>(null, `select is_home from games where id = $1`, [g]))[0].is_home, false);
});
