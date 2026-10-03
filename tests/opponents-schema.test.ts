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
  await fails(t.as(null, `select 1 from opponents`), /permission denied/);
  await fails(t.as('stranger', `insert into opponents (team_id, name, abbr) values ($1, 'Krum', 'KRUM')`, [team]), /row-level security/);
  await fails(t.as('owner', `update opponents set name = 'Other' where team_id = $1`, [team]), /permission denied/);
});
