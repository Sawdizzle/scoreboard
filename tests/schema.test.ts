// The Stage 1 schema, run for real: the migration is applied to an in-process
// Postgres (PGlite) with the few Supabase pieces it leans on stubbed in, and
// every rule the app depends on is exercised as the role that would hit it.
//
// Not covered here: PostgREST itself. Grants and policies are, because a
// request arrives as `anon` or `authenticated` and Postgres decides the rest.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { makeDb } from './db.ts';

type Db = Awaited<ReturnType<typeof makeDb>>;
let db: Db['db'];
let as: Db['as'];
let signUp: Db['signUp'];
let users: Db['users'];
const fails = (p: Promise<unknown>, re: RegExp) => assert.rejects(p, re);

let teamId = '';

before(async () => {
  ({ db, as, signUp, users } = await makeDb());
  for (const [k, n] of [['owner', 'Olive Owner'], ['head', 'Hank Head'], ['coach', 'Cora Coach'],
    ['scorer', 'Sam Scorer'], ['media', 'Mel Media'], ['sixth', 'Sid Sixth'], ['stranger', 'Stan Stranger']]) {
    await signUp(k, n);
  }
});

test('sign-up makes a profile with the name from the form', async () => {
  const rows = await as(null, `select display_name from profiles where id = $1`, [users.owner]);
  assert.equal(rows[0].display_name, 'Olive Owner');
});

test('create_team makes the team, the organizer seat and the current season', async () => {
  const [team] = await as<{ id: string; slug: string; abbr: string }>('owner',
    `select * from create_team('Blue Steel', 'steel', '#2f63cc', '14U', 'Fall 2026')`);
  teamId = team.id;
  assert.equal(team.slug, 'blue-steel-14u');
  assert.equal(team.abbr, 'STEEL');
  const staff = await as(null, `select role from team_staff where team_id = $1`, [teamId]);
  assert.deepEqual(staff.map((r) => r.role), ['organizer']);
  const seasons = await as(null, `select name, is_current from seasons where team_id = $1`, [teamId]);
  assert.deepEqual(seasons, [{ name: 'Fall 2026', is_current: true }]);
});

test('a second team with the same name gets its own slug', async () => {
  const [team] = await as<{ slug: string }>('stranger', `select * from create_team('Blue Steel', 'BS', '#112233', '14U', null)`);
  assert.match(team.slug, /^blue-steel-14u-[0-9a-f]{4}$/);
});

test('anon cannot create a team, and nobody inserts one directly', async () => {
  await fails(as(null, `select * from create_team('X Team', 'X')`), /permission denied/);
  await fails(as('owner', `insert into teams (slug, name, abbr, created_by) values ('zz', 'Z', 'Z', $1)`, [users.owner]), /permission denied/);
  await fails(as('stranger', `insert into team_staff (team_id, user_id, role) values ($1, $2, 'organizer')`, [teamId, users.stranger]), /permission denied/);
});

test('only an organizer makes invite links; the preview is public and says little', async () => {
  await fails(as('stranger', `insert into staff_invites (team_id, role) values ($1, 'coach')`, [teamId]), /row-level security/);
  const [inv] = await as<{ token: string }>('owner', `insert into staff_invites (team_id, role) values ($1, 'head_coach') returning token`, [teamId]);
  const [pv] = await as(null, `select * from invite_preview($1)`, [inv.token]);
  assert.deepEqual(pv, { team_name: 'Blue Steel', display_name: 'Blue Steel', team_color: '#2f63cc', team_color2: '#f2f6fc', logo_url: null, age_group: '14U', role: 'head_coach', state: 'open' });
  assert.equal((await as(null, `select * from invite_preview(gen_random_uuid())`)).length, 0);
  await fails(as(null, `select * from staff_invites`), /permission denied/);
  assert.equal((await as('stranger', `select * from staff_invites`)).length, 0);

  const [slug] = await as<{ accept_invite: string }>('head', `select accept_invite($1)`, [inv.token]);
  assert.equal(slug.accept_invite, 'blue-steel-14u');
  await fails(as('coach', `select accept_invite($1)`, [inv.token]), /already used/);
});

test('five seats: links hold seats, and the sixth person is refused', async () => {
  const link = async (role: string) =>
    (await as<{ token: string }>('owner', `insert into staff_invites (team_id, role) values ($1, $2) returning token`, [teamId, role]))[0].token;
  const tCoach = await link('coach'), tScorer = await link('scorer'), tMedia = await link('media');
  // 2 seated + 3 links out = 5: no sixth link.
  await fails(link('coach'), /five seats/i);
  await as('coach', `select accept_invite($1)`, [tCoach]);
  await as('scorer', `select accept_invite($1)`, [tScorer]);
  await fails(as('scorer', `select accept_invite($1)`, [tMedia]), /already on this team/);
  await as('media', `select accept_invite($1)`, [tMedia]);
  assert.equal((await as(null, `select 1 from team_staff where team_id = $1`, [teamId])).length, 5);

  // Past the link check, the way a race would arrive: the seat trigger still refuses.
  await fails(db.query(`insert into team_staff (team_id, user_id, role) values ($1, $2, 'coach')`, [teamId, users.sixth]), /five staff/);
});

test('roles: who can touch the roster', async () => {
  const add = (who: string) => as(who, `insert into players (team_id, first_name, last_name, number) values ($1, 'Test', 'Kid', '7') returning id`, [teamId]);
  const [{ id }] = await add('owner') as { id: string }[];
  await add('head');
  for (const who of ['coach', 'scorer', 'media', 'stranger']) await fails(add(who), /row-level security/);

  // Any seat reads the roster; a stranger and the public read nothing from the table.
  for (const who of ['coach', 'scorer', 'media']) assert.equal((await as(who, `select 1 from players where team_id = $1`, [teamId])).length, 2);
  assert.equal((await as('stranger', `select 1 from players where team_id = $1`, [teamId])).length, 0);
  await fails(as(null, `select 1 from players`), /permission denied/);

  // A coach's update matches no rows; a team id cannot be rewritten by anyone.
  assert.equal((await as('coach', `update players set number = '99' where id = $1 returning id`, [id])).length, 0);
  await fails(as('owner', `update players set team_id = gen_random_uuid() where id = $1`, [id]), /permission denied/);
  await as('head', `delete from players where team_id = $1`, [teamId]);
});

test('public_roster applies each player\'s public name', async () => {
  await as('owner', `insert into players (team_id, first_name, last_name, number, public_name, positions, active) values
    ($1, 'Johnny', 'Vance', '7', 'full', '{SS,2B}', true),
    ($1, 'Cy', 'Park', '3', 'first_initial', '{CF}', true),
    ($1, 'Finn', 'Moore', '21', 'number', '{C}', true),
    ($1, 'Old', 'Player', '50', 'full', '{}', false)`, [teamId]);
  const rows = await as(null, `select number, display_name from public_roster($1)`, [teamId]);
  assert.deepEqual(rows, [
    { number: '3', display_name: 'Cy P.' },
    { number: '7', display_name: 'Johnny Vance' },
    { number: '21', display_name: null },
  ]);
});

test('a player needs a name or a number, and a number is digits', async () => {
  await fails(as('owner', `insert into players (team_id) values ($1)`, [teamId]), /players_somebody/);
  await fails(as('owner', `insert into players (team_id, number) values ($1, '7a')`, [teamId]), /players_number_check/);
});

test('seasons: one current at a time, written by organizer or head coach only', async () => {
  await as('head', `insert into seasons (team_id, name, is_current) values ($1, 'Spring 2027', true)`, [teamId]);
  const rows = await as(null, `select name, is_current from seasons where team_id = $1 order by name`, [teamId]);
  assert.deepEqual(rows, [{ name: 'Fall 2026', is_current: false }, { name: 'Spring 2027', is_current: true }]);
  await as('owner', `update seasons set is_current = true where team_id = $1 and name = 'Fall 2026'`, [teamId]);
  const cur = await as(null, `select name from seasons where team_id = $1 and is_current`, [teamId]);
  assert.deepEqual(cur, [{ name: 'Fall 2026' }]);
  await fails(as('coach', `insert into seasons (team_id, name) values ($1, 'Nope')`, [teamId]), /row-level security/);
  await fails(as('owner', `insert into seasons (team_id, name) values ($1, 'fall 2026')`, [teamId]), /seasons_team_name/);
});

test('seats: only an organizer changes a role or removes someone; anyone may leave', async () => {
  assert.equal((await as('head', `update team_staff set role = 'organizer' where team_id = $1 and user_id = $2 returning role`, [teamId, users.head])).length, 0);
  assert.equal((await as('head', `delete from team_staff where team_id = $1 and user_id = $2 returning role`, [teamId, users.coach])).length, 0);
  await as('owner', `update team_staff set role = 'coach' where team_id = $1 and user_id = $2`, [teamId, users.scorer]);
  assert.equal((await as('media', `delete from team_staff where team_id = $1 and user_id = $2 returning role`, [teamId, users.media])).length, 1);
  assert.equal((await as('owner', `delete from team_staff where team_id = $1 and user_id = $2 returning role`, [teamId, users.scorer])).length, 1);
});

test('the last organizer cannot leave or step down, until there is another', async () => {
  await fails(as('owner', `delete from team_staff where team_id = $1 and user_id = $2`, [teamId, users.owner]), /needs an organizer/);
  await fails(as('owner', `update team_staff set role = 'coach' where team_id = $1 and user_id = $2`, [teamId, users.owner]), /needs an organizer/);
  await as('owner', `update team_staff set role = 'organizer' where team_id = $1 and user_id = $2`, [teamId, users.head]);
  await as('owner', `update team_staff set role = 'coach' where team_id = $1 and user_id = $2`, [teamId, users.owner]);
  const rows = await as(null, `select role from team_staff where team_id = $1 and user_id = $2`, [teamId, users.owner]);
  assert.equal(rows[0].role, 'coach');
});

test('team identity: organizer and head coach edit it, the slug stays put, only an organizer deletes', async () => {
  // owner is a coach now, head is the organizer.
  assert.equal((await as('owner', `update teams set name = 'Nope' where id = $1 returning id`, [teamId])).length, 0);
  await as('head', `update teams set name = 'Blue Steel Baseball', color = '#123456' where id = $1`, [teamId]);
  await fails(as('head', `update teams set slug = 'taken' where id = $1`, [teamId]), /permission denied/);
  assert.equal((await as('owner', `delete from teams where id = $1 returning id`, [teamId])).length, 0);
  assert.equal((await as('head', `delete from teams where id = $1 returning id`, [teamId])).length, 1);
  // The cascade took the seats, the roster, the seasons and the links with it.
  for (const t of ['team_staff', 'players', 'seasons', 'staff_invites']) {
    assert.equal((await db.query(`select 1 from ${t} where team_id = $1`, [teamId])).rows.length, 0, t);
  }
});

test('deleting an account that is a team\'s only organizer is not blocked', async () => {
  const [team] = await as<{ id: string }>('sixth', `select * from create_team('Solo', 'SOLO')`);
  await db.query(`delete from auth.users where id = $1`, [users.sixth]);
  assert.equal((await db.query(`select 1 from team_staff where team_id = $1`, [team.id])).rows.length, 0);
});
