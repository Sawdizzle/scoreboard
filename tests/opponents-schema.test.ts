// Stage 5: opponents a team has played, private to its staff.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { makeDb } from './db.ts';

type Db = Awaited<ReturnType<typeof makeDb>>;
let t: Db;
let team = '';
const fails = (p: Promise<unknown>, re: RegExp) => assert.rejects(p, re);

before(async () => {
  t = await makeDb();
  for (const [k, n] of [['owner', 'Olive'], ['scorer', 'Sam'], ['media', 'Mel'], ['stranger', 'Stan']]) await t.signUp(k, n);
  [{ id: team }] = await t.as<{ id: string }>('owner', `select id from create_team('Blue Steel', 'STEEL', '#2f63cc', '14U', 'Fall 2026')`);
  for (const role of ['scorer', 'media']) {
    const [{ token }] = await t.as<{ token: string }>('owner', `insert into staff_invites (team_id, role) values ($1, $2) returning token`, [team, role]);
    await t.as(role, `select accept_invite($1)`, [token]);
  }
});

test('a scorer saves an opponent and its lineup; one name once per team', async () => {
  await t.as('scorer', `insert into opponents (team_id, name, abbr, color, roster) values ($1, 'Sanger Wolf', 'SANGER', '#5d4ea6', '{"batters":[{"bid":"x1","num":"19","name":"Dane Kell"}]}')`, [team]);
  await fails(t.as('owner', `insert into opponents (team_id, name, abbr) values ($1, 'sanger wolf', 'SW')`, [team]), /duplicate key/);
  await t.as('scorer', `update opponents set roster = '{"batters":[]}' where team_id = $1`, [team]);
  const [row] = await t.as('media', `select name, abbr, roster from opponents where team_id = $1`, [team]);
  assert.deepEqual(row, { name: 'Sanger Wolf', abbr: 'SANGER', roster: { batters: [] } });
});

test('media reads but cannot change; outsiders and the public see nothing', async () => {
  await fails(t.as('media', `insert into opponents (team_id, name, abbr) values ($1, 'Krum', 'KRUM')`, [team]), /row-level security/);
  await t.as('media', `delete from opponents where team_id = $1`, [team]);
  assert.equal((await t.as('owner', `select 1 from opponents where team_id = $1`, [team])).length, 1);
  assert.equal((await t.as('stranger', `select 1 from opponents`)).length, 0);
  assert.equal((await t.as(null, `select 1 from opponents`)).length, 0);
  await fails(t.as(null, `select roster from opponents`), /permission denied/);
  await fails(t.as('stranger', `insert into opponents (team_id, name, abbr) values ($1, 'Krum', 'KRUM')`, [team]), /row-level security/);
  // An opponent can be renamed (the Opponents screen); a media seat cannot.
  await t.as('media', `update opponents set name = 'Other' where team_id = $1`, [team]);
  assert.equal((await t.as<{ name: string }>('owner', `select name from opponents where team_id = $1`, [team]))[0].name, 'Sanger Wolf');
  await t.as('owner', `update opponents set name = 'Sanger Wolves', color2 = '#000000' where team_id = $1`, [team]);
  assert.equal((await t.as<{ name: string }>('owner', `select name from opponents where team_id = $1`, [team]))[0].name, 'Sanger Wolves');
});

test('a game against a listed opponent shows its logo and colors on the stream', async () => {
  const [{ id: opp }] = await t.as<{ id: string }>('owner', `select id from opponents where team_id = $1`, [team]);
  await t.as('owner', `update opponents set logo_url = 'https://example.test/k.png', color2 = '#123456' where id = $1`, [opp]);
  const [{ id: game }] = await t.as<{ id: string }>('owner',
    `insert into games (team_id, opponent_name, opponent_abbr, opponent_id) values ($1, 'Sanger Wolves', 'SANGER', $2) returning id`, [team, opp]);
  const [{ token }] = await t.as<{ token: string }>('owner', `select token from channels where team_id = $1`, [team]);
  await t.as('owner', `update channels set game_id = $2 where team_id = $1`, [team, game]);
  const [{ f }] = await t.as<{ f: { opponent: { logo_url: string; color2: string } } }>(null, `select overlay_feed($1) f`, [token]);
  assert.equal(f.opponent.logo_url, 'https://example.test/k.png');
  assert.equal(f.opponent.color2, '#123456');
  const [{ p }] = await t.as<{ p: { opponent: { logo_url: string } } }>(null, `select public_game($1) p`, [game]);
  assert.equal(p.opponent.logo_url, 'https://example.test/k.png');
  // The public team page embeds a played opponent's brand on its games; the roster stays staff only.
  const [g] = await t.as<{ name: string; logo_url: string }>(null,
    `select o.name, o.logo_url from games g join opponents o on o.id = g.opponent_id where g.id = $1`, [game]);
  assert.deepEqual(g, { name: 'Sanger Wolves', logo_url: 'https://example.test/k.png' });
  await fails(t.as(null, `select roster from opponents`), /permission denied/);
  await fails(t.as(null, `select team_id from opponents`), /permission denied/);
  await t.as('owner', `insert into opponents (team_id, name, abbr) values ($1, 'Never Played', 'NP')`, [team]);
  assert.deepEqual((await t.as<{ name: string }>(null, `select name from opponents`)).map((r) => r.name), ['Sanger Wolves']);
  assert.equal((await t.as('stranger', `select 1 from opponents`)).length, 0);
  // Another team's opponent cannot be put on a game.
  const [{ id: other }] = await t.as<{ id: string }>('stranger', `select id from create_team('River', 'RIV', '#2f63cc', '14U', null)`);
  await fails(t.as('stranger', `insert into games (team_id, opponent_name, opponent_abbr, opponent_id) values ($1, 'X', 'X', $2)`, [other, opp]), /not on this team/);
});
