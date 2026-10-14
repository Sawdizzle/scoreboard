// Extras: wins, losses, saves and starts from a final game's own plays.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { makeDb } from './db.ts';

type Db = Awaited<ReturnType<typeof makeDb>>;
let t: Db;
let team = '', season = '', a = '', b = '', c = '';

before(async () => {
  t = await makeDb();
  await t.signUp('owner', 'Olive');
  [{ id: team }] = await t.as<{ id: string }>('owner', `select id from create_team('Blue Steel', 'STEEL', '#2f63cc', '14U', 'Fall 2026')`);
  [{ id: season }] = await t.as<{ id: string }>(null, `select id from seasons where team_id = $1`, [team]);
  const add = (n: string) => t.as<{ id: string }>('owner', `insert into players (team_id, first_name) values ($1, $2) returning id`, [team, n]).then((r) => r[0].id);
  a = await add('Starter'); b = await add('Middle'); c = await add('Closer');
});

// A game, us at home: each step is [our pitcher throwing | null, home score, away score, outs he got].
async function game(steps: [string | null, number, number, number][], final = true) {
  const [{ id }] = await t.as<{ id: string }>('owner', `insert into games (team_id, season_id, opponent_name, opponent_abbr) values ($1, $2, 'Hawks', 'HAWKS') returning id`, [team, season]);
  let seq = 0;
  for (const [bid, home, away, outs] of steps) {
    const stats = bid ? [{ side: 'us', bid, p_bf: 1, p_outs: outs, p_pitches: 1 }] : [{ side: 'them', bid: 'x', p_bf: 1, p_pitches: 1 }];
    await t.as('owner', `select apply_play($1, $2, 'play', $3::jsonb, '{}'::jsonb, $4::jsonb, null)`, [id, seq++, JSON.stringify({ home_score: home, away_score: away }), JSON.stringify(stats)]);
  }
  if (final) await t.as('owner', `select apply_play($1, $2, 'end_game', '{}'::jsonb, '{}'::jsonb, '[]'::jsonb, 'final')`, [id, seq]);
  return id;
}
// Names come from the roster, which the public cannot read: ask as the database.
const decisions = (id: string) => t.db.query(`select p.first_name who, d.p_gs, d.p_w, d.p_l, d.p_sv from game_decisions d join players p on p.id = d.player_id where d.game_id = $1 order by p.first_name`, [id]).then((r) => r.rows);

test('the starter wins a game we led from the first inning; a closer who holds a small lead saves it', async () => {
  const id = await game([[a, 0, 0, 3], [null, 2, 0, 0], [a, 2, 1, 3], [c, 2, 1, 3]]);
  assert.deepEqual(await decisions(id), [
    { who: 'Closer', p_gs: 0, p_w: 0, p_l: 0, p_sv: 1 }, { who: 'Starter', p_gs: 1, p_w: 1, p_l: 0, p_sv: 0 }]);
});

test('the win goes to whoever had last thrown when we took the lead for good', async () => {
  // Starter leaves down 0-1; Middle is our pitcher when we go ahead 2-1.
  const id = await game([[a, 0, 1, 3], [b, 0, 1, 3], [null, 2, 1, 0], [b, 2, 1, 3]]);
  assert.deepEqual(await decisions(id), [
    { who: 'Middle', p_gs: 0, p_w: 1, p_l: 0, p_sv: 0 }, { who: 'Starter', p_gs: 1, p_w: 0, p_l: 0, p_sv: 0 }]);
});

test('the loss goes to our pitcher on the mound when they went ahead for good', async () => {
  const id = await game([[a, 0, 0, 3], [null, 1, 0, 0], [b, 1, 2, 1], [b, 1, 2, 2]]);
  assert.deepEqual(await decisions(id), [
    { who: 'Middle', p_gs: 0, p_w: 0, p_l: 1, p_sv: 0 }, { who: 'Starter', p_gs: 1, p_w: 0, p_l: 0, p_sv: 0 }]);
});

test('no decisions until the game is final; reopening takes them away; season stats add them', async () => {
  const live = await game([[a, 0, 0, 3], [null, 1, 0, 0]], false);
  assert.deepEqual(await decisions(live), []);
  const [{ seq }] = await t.as<{ seq: number }>(null, `select seq from games where id = $1`, [live]);
  await t.as('owner', `select apply_play($1, $2, 'end_game', '{}'::jsonb, '{}'::jsonb, '[]'::jsonb, 'final')`, [live, seq]);
  assert.equal((await decisions(live)).length, 1);
  await t.as('owner', `select apply_play($1, $2, 'reopen_game', '{}'::jsonb, '{}'::jsonb, '[]'::jsonb, 'live')`, [live, seq + 1]);
  assert.deepEqual(await decisions(live), []);
  const [s] = await t.as(null, `select p_g, p_gs, p_w, p_l, p_sv from season_stats where player_id = $1`, [a]);
  // Starter: four games pitched and started, two wins (one now reopened does not count).
  assert.deepEqual(s, { p_g: 4, p_gs: 3, p_w: 1, p_l: 0, p_sv: 0 });
});

test('a tie has no winner or loser', async () => {
  const id = await game([[a, 0, 0, 3], [null, 1, 0, 0], [a, 1, 1, 3]]);
  assert.deepEqual(await decisions(id), [{ who: 'Starter', p_gs: 1, p_w: 0, p_l: 0, p_sv: 0 }]);
});
