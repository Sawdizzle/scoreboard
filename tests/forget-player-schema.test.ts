// Deleting a player takes their name out of everything it was copied into:
// lineups, plays, saved opponent rosters, recaps and the stream's feed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeDb } from './db.ts';

test('forget_player scrubs the name everywhere, then deletes the player', async () => {
  const t = await makeDb();
  for (const [k, n] of [['owner', 'Olive'], ['rival', 'Rita'], ['scorer', 'Sam']]) await t.signUp(k, n);
  const [{ id: team }] = await t.as<{ id: string }>('owner', `select id from create_team('Blue Steel', 'STEEL', '#2f63cc', '14U', 'Fall 2026')`);
  const [{ id: rival }] = await t.as<{ id: string }>('rival', `select id from create_team('Hawks', 'HAWKS', '#cc2f2f', '14U', 'Fall 2026')`);
  const [{ token: inv }] = await t.as<{ token: string }>('owner', `insert into staff_invites (team_id, role) values ($1, 'scorer') returning token`, [team]);
  await t.as('scorer', `select accept_invite($1)`, [inv]);
  const [{ id: kid }] = await t.as<{ id: string }>('owner', `insert into players (team_id, first_name, last_name, number, public_name) values ($1, 'Alex', 'Raney', '12', 'full') returning id`, [team]);
  const [{ id: game }] = await t.as<{ id: string }>('owner', `insert into games (team_id, opponent_team_id, opponent_name, opponent_abbr) values ($1, $2, 'Hawks', 'HAWKS') returning id`, [team, rival]);
  const [{ id: theirs }] = await t.as<{ id: string }>('rival', `insert into games (team_id, opponent_name, opponent_abbr) values ($1, 'Blue Steel', 'STEEL') returning id`, [rival]);
  const lineup = { batters: [{ bid: kid, num: '12', name: 'Alex Raney' }, { bid: 'g1', num: '4', name: 'Jo Bell' }], positions: { SS: kid } };
  await t.as('owner', `insert into game_lineups (game_id, side, data) values ($1, 'us', $2::jsonb)`, [game, JSON.stringify(lineup)]);
  await t.as('rival', `insert into game_lineups (game_id, side, data) values ($1, 'them', $2::jsonb)`, [theirs, JSON.stringify(lineup)]);
  await t.as('rival', `insert into opponents (team_id, name, abbr, roster) values ($1, 'Blue Steel', 'STEEL', $2::jsonb)`, [rival, JSON.stringify(lineup)]);
  await t.db.query(`insert into game_events (game_id, seq, type, payload, prev_live, prev_status) values ($1, 1, 'batidx', $2::jsonb, '{}', 'live')`,
    [game, JSON.stringify({ text: 'At the plate: #12 Alex Raney', side: 'us', i: 0 })]);
  await t.as('owner', `insert into game_recaps (game_id, team_id, status, content, facts, published_at) values ($1, $2, 'published', $3::jsonb, $4::jsonb, now())`,
    [game, team, JSON.stringify({ headline: 'Raney walks it off', recap: 'Alex Raney (A. Raney to the scorer, Alex R. to the stream) homered. Alexandra Bell scored.' }),
     JSON.stringify({ batters: [{ bid: kid, name: 'Alex Raney', hr: 1 }] })]);

  await assert.rejects(t.as('scorer', `select forget_player($1)`, [kid]), /organizer or head coach/);
  await assert.rejects(t.as('rival', `select forget_player($1)`, [kid]), /organizer or head coach/);
  await t.as('owner', `select forget_player($1)`, [kid]);

  assert.equal((await t.db.query(`select 1 from players where id = $1`, [kid])).rows.length, 0);
  const dump = async (sql: string) => (await t.db.query<{ j: string }>(sql)).rows.map((r) => r.j).join('\n');
  const all = [
    await dump(`select data::text j from game_lineups`),
    await dump(`select payload::text j from game_events`),
    await dump(`select live::text j from games`),
    await dump(`select roster::text j from opponents`),
    await dump(`select content::text || facts::text j from game_recaps`),
  ].join('\n');
  for (const n of ['Alex', 'Raney', 'A. Raney', 'Alex R.']) assert.ok(!new RegExp(`(?<![A-Za-z])${n.replace('.', '\\.')}(?![A-Za-z])`).test(all), `${n} survived:\n${all}`);
  assert.match(all, /Jo Bell/, 'other players are untouched');
  assert.match(all, /Alexandra Bell/, 'a longer name containing the first name is untouched');
  assert.match(all, /No\. 12 walks it off/);

  const [{ token }] = await t.as<{ token: string }>('owner', `select token from channels where team_id = $1`, [team]);
  const [{ f }] = await t.as<{ f: unknown }>(null, `select overlay_feed($1) f`, [token]);
  assert.ok(!JSON.stringify(f).includes('Raney'), 'overlay feed');
  const [{ f: pg }] = await t.as<{ f: unknown }>(null, `select public_game($1) f`, [game]);
  assert.ok(!JSON.stringify(pg).includes('Raney'), 'public game');
});
