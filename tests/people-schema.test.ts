// Leagues, families, fans, scorers, the calendar, messages and push targets:
// every rule run as the person it is for.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { makeDb } from './db.ts';

type Db = Awaited<ReturnType<typeof makeDb>>;
let t: Db;
let team = '', player = '', other = '', game = '', family = '';
const fails = (p: Promise<unknown>, re: RegExp) => assert.rejects(p, re);
const n = async (who: string | null, sql: string, params: unknown[] = []) => (await t.as(who, sql, params)).length;

before(async () => {
  t = await makeDb();
  for (const [k, name] of [['owner', 'Olive'], ['coach', 'Cora'], ['mom', 'Maria'], ['dad', 'Dev'], ['fan', 'Fern'],
    ['league', 'Lee'], ['stranger', 'Stan'], ...Array.from({ length: 6 }, (_, i) => [`s${i}`, `Scorer ${i}`])]) await t.signUp(k, name);
  [{ id: team }] = await t.as<{ id: string }>('owner', `select id from create_team('Blue Steel', 'STEEL', '#2f63cc', '14U', 'Fall 2026')`);
  const [{ token }] = await t.as<{ token: string }>('owner', `insert into staff_invites (team_id, role) values ($1, 'coach') returning token`, [team]);
  await t.as('coach', `select accept_invite($1)`, [token]);
  [{ id: player }] = await t.as<{ id: string }>('owner', `insert into players (team_id, first_name, last_name, number) values ($1, 'Ava', 'Reyes', '7') returning id`, [team]);
  [{ id: other }] = await t.as<{ id: string }>('owner', `insert into players (team_id, first_name, last_name, number) values ($1, 'Ben', 'Ortiz', '9') returning id`, [team]);
  [{ id: game }] = await t.as<{ id: string }>('owner',
    `insert into games (team_id, opponent_name, opponent_abbr, starts_at, address) values ($1, 'River', 'RIV', now() + interval '2 days', '1 Field Rd') returning id`, [team]);
  [{ token: family }] = await t.as<{ token: string }>('owner', `select token from team_family_links where team_id = $1`, [team]);
});

test('scorer seats do not use the five coaching seats', async () => {
  for (let i = 0; i < 6; i++) {
    const [{ token }] = await t.as<{ token: string }>('owner', `insert into staff_invites (team_id, role) values ($1, 'scorer') returning token`, [team]);
    await t.as(`s${i}`, `select accept_invite($1)`, [token]);
  }
  assert.equal(await n('owner', `select 1 from team_staff where team_id = $1 and role = 'scorer'`, [team]), 6);
  // A coach puts a scorer on a game; a guardian or media seat cannot be put on one.
  await t.as('coach', `insert into game_scorers (game_id, user_id) values ($1, $2)`, [game, t.users.s0]);
  await fails(t.as('coach', `insert into game_scorers (game_id, user_id) values ($1, $2)`, [game, t.users.mom]), /scorer seat/);
  await fails(t.as('s1', `insert into game_scorers (game_id, user_id) values ($1, $2)`, [game, t.users.s1]), /row-level security/);
  assert.equal(await n('s0', `select 1 from game_scorers where game_id = $1`, [game]), 1);
});

test('a parent joins with the family link, waits, and is approved by a coach', async () => {
  const [{ p }] = await t.as<{ p: { name: string; players: { name: string }[] } }>(null, `select family_preview($1) p`, [family]);
  assert.equal(p.name, 'Blue Steel');
  assert.deepEqual(p.players.map((x) => x.name), ['Ava R.', 'Ben O.']);
  await fails(t.as('mom', `select join_family($1, $2)`, [family, [crypto.randomUUID()]]), /not on this team/);
  await t.as('mom', `select join_family($1, $2)`, [family, [player]]);
  const [row] = await t.as('mom', `select role, status from team_members where team_id = $1`, [team]);
  assert.deepEqual(row, { role: 'guardian', status: 'pending' });
  // Pending: nothing of the team's yet.
  assert.equal(await n('mom', `select 1 from players`), 0);
  assert.equal(await n('mom', `update team_members set status = 'active' where user_id = $1 returning 1`, [t.users.mom]), 0);
  await t.as('coach', `update team_members set status = 'active' where team_id = $1 and user_id = $2`, [team, t.users.mom]);
  // Approved: their own player, not the others; staff names, and their own row only.
  assert.deepEqual((await t.as<{ first_name: string }>('mom', `select first_name from players`)).map((r) => r.first_name), ['Ava']);
  assert.equal(await n('mom', `select 1 from profiles where id = $1`, [t.users.coach]), 1);
  assert.equal(await n('mom', `select 1 from team_members`), 1);
  assert.equal(await n('mom', `select 1 from team_family_links`), 0);
  // A new link stops the old one.
  await t.as('coach', `select rotate_family_link($1)`, [team]);
  await fails(t.as('dad', `select join_family($1, $2)`, [family, [player]]), /not valid/);
  [{ token: family }] = await t.as<{ token: string }>('owner', `select token from team_family_links where team_id = $1`, [team]);
  await fails(t.as('mom', `select rotate_family_link($1)`, [team]), /cannot do that/);
});

test('a fan follows a public team, and gets games but not the family side', async () => {
  await t.as('fan', `select follow_team($1)`, [team]);
  assert.equal(await n('fan', `select 1 from team_members where role = 'fan'`), 1);
  await t.as('coach', `insert into team_events (team_id, title, starts_at) values ($1, 'Practice', now() + interval '1 day')`, [team]);
  assert.equal(await n('mom', `select 1 from team_events`), 1);
  assert.equal(await n('fan', `select 1 from team_events`), 0);
  assert.equal(await n('fan', `select 1 from profiles where id = $1`, [t.users.coach]), 0);
  // A private team cannot be followed.
  await t.as('owner', `update teams set private = true where id = $1`, [team]);
  await fails(t.as('stranger', `select follow_team($1)`, [team]), /private/);
  // ...but its families still see its games.
  assert.equal(await n('mom', `select 1 from games where team_id = $1`, [team]), 1);
  assert.equal(await n('fan', `select 1 from games where team_id = $1`, [team]), 0);
  await t.as('owner', `update teams set private = false where id = $1`, [team]);
});

test('RSVP: a parent answers for their own player; the family sees the count', async () => {
  await t.as('mom', `select set_rsvp($1, null, $2, 'yes', 'Running late')`, [game, player]);
  await t.as('mom', `select set_rsvp($1, null, $2, 'maybe')`, [game, player]);
  await fails(t.as('mom', `select set_rsvp($1, null, $2, 'yes')`, [game, other]), /own player/);
  await fails(t.as('fan', `select set_rsvp($1, null, $2, 'yes')`, [game, player]), /own player/);
  await t.as('coach', `select set_rsvp($1, null, $2, 'no')`, [game, other]);
  assert.deepEqual((await t.as<{ status: string }>('mom', `select status from rsvps order by status`)).map((r) => r.status), ['maybe', 'no']);
  assert.equal(await n('fan', `select 1 from rsvps`), 0);
  await t.as('mom', `select set_rsvp($1, null, $2, null)`, [game, player]);
  assert.equal(await n('coach', `select 1 from rsvps`), 1);
});

test('calendar feed: games for a fan, practices and addresses for the family', async () => {
  const [{ tok: fanTok }] = await t.as<{ tok: string }>('fan', `select calendar_token($1) tok`, [team]);
  const [{ tok: momTok }] = await t.as<{ tok: string }>('mom', `select calendar_token($1) tok`, [team]);
  await fails(t.as('stranger', `select calendar_token($1)`, [team]), /Join the team/);
  type Feed = { games: { address: string | null }[]; events: unknown[] };
  const [{ f: fan }] = await t.as<{ f: Feed }>(null, `select calendar_feed($1) f`, [fanTok]);
  assert.equal(fan.games.length, 1);
  assert.equal(fan.games[0].address, null);
  assert.equal(fan.events.length, 0);
  const [{ f: mom }] = await t.as<{ f: Feed }>(null, `select calendar_feed($1) f`, [momTok]);
  assert.equal(mom.games[0].address, '1 Field Rd');
  assert.equal(mom.events.length, 1);
  // A new link retires the old; leaving the team empties the feed.
  const [{ tok: fresh }] = await t.as<{ tok: string }>('fan', `select calendar_token($1, true) tok`, [team]);
  assert.notEqual(fresh, fanTok);
  assert.equal((await t.as<{ f: Feed | null }>(null, `select calendar_feed($1) f`, [fanTok]))[0].f, null);
  await t.as('fan', `delete from team_members where team_id = $1 and user_id = $2`, [team, t.users.fan]);
  assert.equal((await t.as<{ f: Feed | null }>(null, `select calendar_feed($1) f`, [fresh]))[0].f, null);
  await t.as('fan', `select follow_team($1)`, [team]);
});

test('messages: coaches announce, families talk, staff talk apart; removed is gone', async () => {
  await t.as('coach', `insert into team_messages (team_id, channel, body) values ($1, 'announcements', 'Bring water')`, [team]);
  await fails(t.as('mom', `insert into team_messages (team_id, channel, body) values ($1, 'announcements', 'Hi')`, [team]), /row-level security/);
  const [{ id }] = await t.as<{ id: number }>('mom', `insert into team_messages (team_id, channel, body) values ($1, 'families', 'Carpool?') returning id`, [team]);
  await fails(t.as('mom', `insert into team_messages (team_id, channel, body) values ($1, 'staff', 'Hi')`, [team]), /row-level security/);
  await t.as('s0', `insert into team_messages (team_id, channel, body) values ($1, 'staff', 'Lineup?')`, [team]);
  await fails(t.as('fan', `insert into team_messages (team_id, channel, body) values ($1, 'families', 'Hi')`, [team]), /row-level security/);
  // Nobody posts as someone else.
  await fails(t.as('mom', `insert into team_messages (team_id, channel, body, user_id) values ($1, 'families', 'x', $2)`, [team, t.users.coach]), /permission denied/);
  assert.equal(await n('mom', `select 1 from team_messages`), 2);
  assert.equal(await n('coach', `select 1 from team_messages`), 3);
  assert.equal(await n('fan', `select 1 from team_messages`), 0);
  await fails(t.as('dad', `select remove_message($1)`, [id]), /cannot remove/);
  await t.as('coach', `select remove_message($1)`, [id]);
  assert.equal(await n('mom', `select 1 from team_messages where channel = 'families'`), 0);
  assert.equal((await t.db.query(`select 1 from team_messages where id = $1 and removed_at is not null`, [id])).rows.length, 1);
});

test('a league: its admin acts as team admin on its teams', async () => {
  const [{ slug }] = await t.as<{ slug: string }>('league', `select slug from create_org('Sanger Spring League', 'ssl')`);
  assert.equal(slug, 'ssl');
  const [{ id: org }] = await t.as<{ id: string }>('league', `select id from organizations where slug = 'ssl'`);
  assert.equal(await n('league', `select 1 from players where team_id = $1`, [team]), 0);
  const [{ token }] = await t.as<{ token: string }>('league', `insert into org_invites (org_id, kind) values ($1, 'team') returning token`, [org]);
  await fails(t.as('coach', `select accept_org_invite($1, $2)`, [token, team]), /team admin/);
  await t.as('owner', `select accept_org_invite($1, $2)`, [token, team]);
  // The league admin now runs the team: roster, staff names, the family link.
  assert.equal(await n('league', `select 1 from players where team_id = $1`, [team]), 2);
  assert.equal(await n('league', `select 1 from team_family_links where team_id = $1`, [team]), 1);
  await t.as('league', `insert into team_messages (team_id, channel, body) values ($1, 'announcements', 'Opening day Saturday')`, [team]);
  await t.as('league', `insert into org_announcements (org_id, body) values ($1, 'Fields closed for rain')`, [org]);
  assert.equal(await n('mom', `select 1 from org_announcements`), 1);
  assert.equal(await n('fan', `select 1 from org_announcements`), 0);
  await fails(t.as('owner', `insert into org_announcements (org_id, body) values ($1, 'x')`, [org]), /row-level security/);
  // One admin cannot leave alone; a second, by a one-use link, can be added.
  await fails(t.as('league', `delete from org_members where org_id = $1`, [org]), /needs an admin/);
  const [{ token: adm }] = await t.as<{ token: string }>('league', `insert into org_invites (org_id, kind) values ($1, 'admin') returning token`, [org]);
  await t.as('stranger', `select accept_org_invite($1)`, [adm]);
  await fails(t.as('dad', `select accept_org_invite($1)`, [adm]), /already used/);
  // The team leaves; the league's reach goes with it.
  await t.as('owner', `select leave_org($1)`, [team]);
  assert.equal(await n('league', `select 1 from players where team_id = $1`, [team]), 0);
});

test('push targets: by audience and setting, never the sender, for the server only', async () => {
  for (const who of ['coach', 'mom', 'fan', 's0']) {
    await t.as(who, `insert into push_subscriptions (endpoint, p256dh, auth) values ($1, 'k', 'a')`, [`https://push.example.test/${who}`]);
  }
  await fails(t.as('mom', `select * from push_targets($1, 'family', 'chat')`, [team]), /permission denied/);
  assert.equal(await n('mom', `select 1 from push_subscriptions`), 1);
  const targets = async (aud: string, kind: string, except: string | null = null) => {
    await t.db.exec('set role service_role');
    try {
      const { rows } = await t.db.query<{ endpoint: string }>(`select endpoint from push_targets($1, $2, $3, $4) order by 1`, [team, aud, kind, except]);
      return rows.map((r) => r.endpoint.split('/').pop());
    } finally { await t.db.exec('reset role'); }
  };
  assert.deepEqual(await targets('family', 'announcements'), ['coach', 'mom', 's0']);
  assert.deepEqual(await targets('followers', 'games'), ['coach', 'fan', 'mom', 's0']);
  assert.deepEqual(await targets('staff', 'chat', t.users.coach), ['s0']);
  await t.as('mom', `insert into notify_settings (team_id, chat) values ($1, false)`, [team]);
  assert.deepEqual(await targets('family', 'chat', t.users.coach), ['s0']);
});

test('a game going live and final is noted once each, for its push', async () => {
  await t.db.query(`update games set status = 'live' where id = $1`, [game]);
  await t.db.query(`update games set status = 'final' where id = $1`, [game]);
  await t.db.query(`update games set status = 'live' where id = $1`, [game]);
  await t.db.query(`update games set status = 'final' where id = $1`, [game]);
  const { rows } = await t.db.query<{ status: string }>(`select status from game_notices where game_id = $1 order by status`, [game]);
  assert.deepEqual(rows.map((r) => r.status), ['final', 'live']);
  await fails(t.as('owner', `select 1 from game_notices`), /permission denied/);
});
