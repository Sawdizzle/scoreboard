// The team's name format: the rule in the browser (lib/format.ts) and the same
// rule in the database (format_name, player_public_name, public_roster), and
// how each player's own public-name setting caps it on public screens.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { makeDb } from './db.ts';
import { formatName, publicName, shortName, staffName } from '../lib/format.ts';
import { lineupFromRoster, withRosterNames } from '../lib/lineup.ts';
import { NAME_FORMATS, type Player } from '../lib/types.ts';

const alex = { first_name: 'Alex', last_name: 'Raney', number: '12' };

test('each format names Alex Raney the way the Team screen shows it', () => {
  assert.deepEqual(NAME_FORMATS.map((f) => formatName(alex, f)), ['Alex Raney', 'A. Raney', 'Raney', 'Alex', 'Alex R.']);
});

test('a missing part falls back to the part there is', () => {
  const firstOnly = { first_name: 'Alex', last_name: '' }, lastOnly = { first_name: '', last_name: 'Raney' };
  assert.deepEqual(NAME_FORMATS.map((f) => formatName(firstOnly, f)), ['Alex', 'Alex', 'Alex', 'Alex', 'Alex']);
  assert.deepEqual(NAME_FORMATS.map((f) => formatName(lastOnly, f)), ['Raney', 'Raney', 'Raney', 'Raney', 'R.']);
  assert.equal(staffName({ first_name: '', last_name: '', number: '7' }, 'last'), 'No. 7');
});

test('a player\'s public setting caps the team format', () => {
  // Full: the team format as chosen.
  assert.deepEqual(NAME_FORMATS.map((f) => publicName(alex, 'full', f)), ['Alex Raney', 'A. Raney', 'Raney', 'Alex', 'Alex R.']);
  // First name, last initial: never more of the last name than its initial.
  assert.deepEqual(NAME_FORMATS.map((f) => publicName(alex, 'first_initial', f)), ['Alex R.', 'Alex R.', 'Alex R.', 'Alex', 'Alex R.']);
  // Number only, whatever the team picks.
  assert.deepEqual(NAME_FORMATS.map((f) => publicName(alex, 'number', f)), Array(5).fill('No. 12'));
});

test('the short form keeps a name that ends in an initial whole', () => {
  assert.equal(shortName('Alex Raney'), 'Raney');
  assert.equal(shortName('A. Raney'), 'Raney');
  assert.equal(shortName('Alex R.'), 'Alex R.');
  assert.equal(shortName('Alex'), 'Alex');
  assert.equal(shortName('  '), '');
});

const P = (id: string, number: string, first: string, last: string): Player =>
  ({ id, team_id: 't', number, first_name: first, last_name: last, positions: id === 'a' ? ['P'] : [], bats: null, throws: null, public_name: 'full', active: true });

test('lineups name our players in the team format, and a saved one is renamed', () => {
  const roster = [P('a', '12', 'Alex', 'Raney'), P('b', '7', 'Cy', 'Park')];
  assert.deepEqual(lineupFromRoster(roster, 'initial_last').batters.map((b) => b.name), ['C. Park', 'A. Raney']);
  const saved = { batters: [{ bid: 'a', num: '12', name: 'Alex Raney' }, { bid: 'guest', num: '99', name: 'Typed In' }], positions: { P: 'a' } };
  const l = withRosterNames(saved, roster, 'first_initial');
  assert.deepEqual(l.batters, [{ bid: 'a', num: '12', name: 'Alex R.' }, { bid: 'guest', num: '99', name: 'Typed In' }]);
  assert.deepEqual(l.pitcher, { num: '12', name: 'Alex R.' });
});

// ---------------------------------------------------------------- database ----
type Db = Awaited<ReturnType<typeof makeDb>>;
let t: Db;
let team = '';

before(async () => {
  t = await makeDb();
  for (const [k, n] of [['owner', 'Olive'], ['coach', 'Cora'], ['stranger', 'Stan']]) await t.signUp(k, n);
  [{ id: team }] = await t.as<{ id: string }>('owner', `select id from create_team('Blue Steel', 'STEEL', '#2f63cc', '14U', 'Fall 2026')`);
  const [{ token }] = await t.as<{ token: string }>('owner', `insert into staff_invites (team_id, role) values ($1, 'coach') returning token`, [team]);
  await t.as('coach', `select accept_invite($1)`, [token]);
  await t.as('owner', `insert into players (team_id, first_name, last_name, number, public_name) values
    ($1, 'Alex', 'Raney', '12', 'full'), ($1, 'Cy', 'Park', '3', 'first_initial'), ($1, 'Finn', 'Moore', '21', 'number')`, [team]);
});

test('a team starts on first name and last initial; only a team lead changes the format', async () => {
  assert.deepEqual(await t.as(null, `select name_format from teams where id = $1`, [team]), [{ name_format: 'first_initial' }]);
  await assert.rejects(t.as('owner', `update teams set name_format = 'nickname' where id = $1`, [team]), /name_format_check/);
  assert.equal((await t.as('coach', `update teams set name_format = 'last' where id = $1 returning id`, [team])).length, 0);
  assert.equal((await t.as('stranger', `update teams set name_format = 'last' where id = $1 returning id`, [team])).length, 0);
  assert.equal((await t.as('owner', `update teams set name_format = 'last' where id = $1 returning id`, [team])).length, 1);
  await t.as('owner', `update teams set name_format = 'full' where id = $1`, [team]);
});

test('format_name in the database is formatName in the browser', async () => {
  const people = [['Alex', 'Raney'], ['Alex', ''], ['', 'Raney'], ['', ''], [' Mary Ann ', ' de la Cruz '], ['Émile', 'Østby']];
  for (const [first_name, last_name] of people) {
    for (const f of NAME_FORMATS) {
      const [{ name }] = await t.db.query<{ name: string | null }>(`select format_name($1, $2, $3) as name`, [first_name, last_name, f]).then((r) => r.rows);
      assert.equal(name ?? '', formatName({ first_name, last_name }, f), `${f}: "${first_name}" "${last_name}"`);
    }
  }
});

test('public_roster and the stream follow the format, capped by each player', async () => {
  for (const f of NAME_FORMATS) {
    await t.as('owner', `update teams set name_format = $2 where id = $1`, [team, f]);
    const rows = await t.as<{ number: string; display_name: string | null }>(null, `select number, display_name from public_roster($1)`, [team]);
    const players = [{ ...alex, public_name: 'full' }, { first_name: 'Cy', last_name: 'Park', number: '3', public_name: 'first_initial' }, { first_name: 'Finn', last_name: 'Moore', number: '21', public_name: 'number' }] as const;
    const want = (n: string) => players.find((p) => p.number === n)!;
    for (const r of rows) {
      const p = want(r.number);
      assert.equal(r.display_name ?? `No. ${r.number}`, publicName(p, p.public_name, f), `${f}: #${r.number}`);
    }
    // The stream's lineup reads the same rule (player_public_name).
    const [{ l }] = await t.db.query<{ l: { batters: { name: string }[] } }>(
      `select lineup_public(jsonb_build_object('batters', (select jsonb_agg(jsonb_build_object('bid', id, 'num', number, 'name', 'stale')) from players where team_id = $1 and number = '12')), $1) as l`, [team]).then((r) => r.rows);
    assert.equal(l.batters[0].name, formatName(alex, f));
  }
  await t.as('owner', `update teams set name_format = 'full' where id = $1`, [team]);
});
