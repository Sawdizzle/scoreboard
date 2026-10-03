// Stage 2a: season stats and GameChanger imports, as each role would reach them.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { makeDb } from './db.ts';

type Db = Awaited<ReturnType<typeof makeDb>>;
let t: Db;
let team = '', season = '', other = '', p7 = '', p3 = '', strangerPlayer = '';
const fails = (p: Promise<unknown>, re: RegExp) => assert.rejects(p, re);

before(async () => {
  t = await makeDb();
  for (const [k, n] of [['owner', 'Olive'], ['coach', 'Cora'], ['stranger', 'Stan']]) await t.signUp(k, n);
  [{ id: team }] = await t.as<{ id: string }>('owner', `select id from create_team('Blue Steel', 'STEEL', '#2f63cc', '14U', 'Fall 2026')`);
  [{ id: season }] = await t.as<{ id: string }>(null, `select id from seasons where team_id = $1`, [team]);
  [{ id: other }] = await t.as<{ id: string }>('owner', `insert into seasons (team_id, name) values ($1, 'Spring 2026') returning id`, [team]);
  [{ id: p7 }] = await t.as<{ id: string }>('owner', `insert into players (team_id, first_name, last_name, number) values ($1, 'Johnny', 'Vance', '7') returning id`, [team]);
  [{ id: p3 }] = await t.as<{ id: string }>('owner', `insert into players (team_id, first_name, last_name, number) values ($1, 'Cy', 'Park', '3') returning id`, [team]);
  const [{ token }] = await t.as<{ token: string }>('owner', `insert into staff_invites (team_id, role) values ($1, 'coach') returning token`, [team]);
  await t.as('coach', `select accept_invite($1)`, [token]);
  const [{ id: st }] = await t.as<{ id: string }>('stranger', `select id from create_team('Hawks', 'HAWKS', '#aa2222', '14U', 'Fall 2026')`);
  [{ id: strangerPlayer }] = await t.as<{ id: string }>('stranger', `insert into players (team_id, first_name, number) values ($1, 'Hawk', '1') returning id`, [st]);
});

const rows = () => JSON.stringify([
  { player_id: p7, b_g: 11, b_pa: 40, b_ab: 33, b_h: 9, b_2b: 2, b_hr: 1, b_bb: 6, b_hbp: 1, p_outs: 29, p_er: 7, junk: 5 },
  { player_id: p3, b_g: 3, b_pa: 5, b_ab: 4, b_h: 1 },
]);

test('an organizer imports a season; the public reads the line by player id', async () => {
  const [{ import_season_stats: n }] = await t.as<{ import_season_stats: number }>('owner', `select import_season_stats($1, $2::jsonb)`, [season, rows()]);
  assert.equal(n, 2);
  const [line] = await t.as(null, `select b_ab, b_h, b_hr, p_outs, p_er from season_stats where player_id = $1 and season_id = $2`, [p7, season]);
  assert.deepEqual(line, { b_ab: 33, b_h: 9, b_hr: 1, p_outs: 29, p_er: 7 });
});

test('importing the season again replaces it, and leaves other seasons alone', async () => {
  await t.as('owner', `select import_season_stats($1, $2::jsonb)`, [other, JSON.stringify([{ player_id: p7, b_ab: 50, b_h: 20 }])]);
  await t.as('owner', `select import_season_stats($1, $2::jsonb)`, [season, JSON.stringify([{ player_id: p7, b_ab: 36, b_h: 10 }])]);
  const now = await t.as(null, `select season_id, b_ab, b_h from season_stats where player_id = $1 order by b_ab`, [p7]);
  assert.deepEqual(now.map((r) => [r.season_id, r.b_ab, r.b_h]), [[season, 36, 10], [other, 50, 20]]);
  assert.equal((await t.as(null, `select 1 from season_stats where player_id = $1`, [p3])).length, 0);
});

test('a coach, a stranger and the public cannot import', async () => {
  await fails(t.as('coach', `select import_season_stats($1, $2::jsonb)`, [season, rows()]), /organizer or head coach/);
  await fails(t.as('stranger', `select import_season_stats($1, $2::jsonb)`, [season, rows()]), /organizer or head coach/);
  await fails(t.as(null, `select import_season_stats($1, $2::jsonb)`, [season, rows()]), /permission denied/);
  await fails(t.as('coach', `delete from stat_imports where season_id = $1 returning id`, [season]).then((r) => { if (r.length) throw new Error('deleted'); throw new Error('row-level security: none deleted'); }), /row-level security/);
});

test('another team\'s player cannot be filed under this season', async () => {
  await fails(t.as('owner', `select import_season_stats($1, $2::jsonb)`, [season, JSON.stringify([{ player_id: strangerPlayer, b_ab: 1 }])]), /not on this team/);
  // The failed import changed nothing: the earlier one is still there.
  assert.equal((await t.as(null, `select 1 from season_stats where season_id = $1`, [season])).length, 1);
});

test('counts are never negative, and an import is at most 60 players', async () => {
  await fails(t.as('owner', `select import_season_stats($1, $2::jsonb)`, [season, JSON.stringify([{ player_id: p7, b_ab: -1 }])]), /check constraint/);
  const many = JSON.stringify(Array.from({ length: 61 }, () => ({ player_id: p7 })));
  await fails(t.as('owner', `select import_season_stats($1, $2::jsonb)`, [season, many]), /at most 60/);
});

test('a season knows its game length for ERA, 7 innings unless set', async () => {
  const [{ game_innings }] = await t.as(null, `select game_innings from seasons where id = $1`, [season]);
  assert.equal(game_innings, 7);
  await t.as('owner', `update seasons set game_innings = 6 where id = $1`, [season]);
  await fails(t.as('owner', `update seasons set game_innings = 12 where id = $1`, [season]), /check constraint/);
});
