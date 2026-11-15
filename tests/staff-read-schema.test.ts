// game_events_read and game_lineups_read, rewritten as inline joins
// (20261114120000_v5_staff_read_inline.sql): the same people read the same
// rows as with is_team_staff(game_team(game_id)), the check they replace.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { makeDb } from './db.ts';

type Db = Awaited<ReturnType<typeof makeDb>>;
let t: Db;
let mine = '', theirs = '', gMine = '', gTheirs = '';
const PEOPLE = ['owner', 'coach', 'scorer', 'media', 'league', 'otherOwner', 'mom', 'stranger'];

before(async () => {
  t = await makeDb();
  for (const k of PEOPLE) await t.signUp(k, k);
  [{ id: mine }] = await t.as<{ id: string }>('owner', `select id from create_team('Blue Steel', 'STEEL', '#2f63cc', '14U', 'Fall 2026')`);
  [{ id: theirs }] = await t.as<{ id: string }>('otherOwner', `select id from create_team('Hawks', 'HAWKS', '#aa2222', '14U', 'Fall 2026')`);
  for (const role of ['coach', 'scorer', 'media']) {
    const [{ token }] = await t.as<{ token: string }>('owner', `insert into staff_invites (team_id, role) values ($1, $2) returning token`, [mine, role]);
    await t.as(role, `select accept_invite($1)`, [token]);
  }
  // A league admin over our team only.
  await t.as('league', `select create_org('Sanger Spring League', 'ssl')`);
  const [{ id: org }] = await t.as<{ id: string }>('league', `select id from organizations where slug = 'ssl'`);
  const [{ token: link }] = await t.as<{ token: string }>('league', `insert into org_invites (org_id, kind) values ($1, 'team') returning token`, [org]);
  await t.as('owner', `select accept_org_invite($1, $2)`, [link, mine]);
  // An approved parent on our team: family, not staff.
  const [{ token: fam }] = await t.as<{ token: string }>('owner', `select token from team_family_links where team_id = $1`, [mine]);
  const [{ id: kid }] = await t.as<{ id: string }>('owner', `insert into players (team_id, first_name) values ($1, 'Ava') returning id`, [mine]);
  await t.as('mom', `select join_family($1, $2)`, [fam, [kid]]);
  await t.as('coach', `update team_members set status = 'active' where team_id = $1 and user_id = $2`, [mine, t.users.mom]);

  for (const [who, team] of [['owner', mine], ['otherOwner', theirs]] as const) {
    const [{ id }] = await t.as<{ id: string }>(who, `insert into games (team_id, opponent_name, opponent_abbr) values ($1, 'X', 'X') returning id`, [team]);
    if (team === mine) gMine = id; else gTheirs = id;
    await t.as(who, `insert into game_lineups (game_id, side, data) values ($1, 'us', '{"batters":[]}'::jsonb)`, [id]);
    await t.as(who, `select apply_play($1, 0, 'ball', '{"balls":1}'::jsonb)`, [id]);
  }
});

const count = async (who: string, table: string, game: string) =>
  (await t.as(who, `select 1 from ${table} where game_id = $1`, [game])).length;
const oldCheck = async (who: string, game: string) =>
  (await t.as<{ ok: boolean }>(who, `select public.is_team_staff(public.game_team($1)) ok`, [game]))[0].ok;

test('every person reads exactly what the old staff check allowed', async () => {
  for (const who of PEOPLE) {
    for (const game of [gMine, gTheirs]) {
      const allowed = await oldCheck(who, game);
      for (const table of ['game_events', 'game_lineups']) {
        assert.equal(await count(who, table, game), allowed ? 1 : 0, `${who} on ${game === gMine ? 'our' : 'their'} ${table}`);
      }
    }
  }
});

test('who that is: our staff and our league admin, not their team, a parent or a stranger', async () => {
  const reads = async (who: string) => (await count(who, 'game_events', gMine)) === 1 && (await count(who, 'game_lineups', gMine)) === 1;
  for (const who of ['owner', 'coach', 'scorer', 'media', 'league']) assert.equal(await reads(who), true, who);
  for (const who of ['otherOwner', 'mom', 'stranger']) assert.equal(await reads(who), false, who);
  assert.equal(await count('league', 'game_events', gTheirs), 0);
});

test('signed out: still no access at all', async () => {
  await assert.rejects(t.as(null, `select 1 from game_events`), /permission denied/);
  await assert.rejects(t.as(null, `select 1 from game_lineups`), /permission denied/);
});

test('the policies no longer call the SECURITY DEFINER helpers', async () => {
  const rows = (await t.db.query<{ policyname: string; qual: string }>(
    `select policyname, qual from pg_policies where policyname in ('game_events_read', 'game_lineups_read')`)).rows;
  assert.equal(rows.length, 2);
  for (const r of rows) assert.doesNotMatch(r.qual, /is_team_staff|game_team/, r.policyname);
});
