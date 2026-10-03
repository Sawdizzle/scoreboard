// Stage 3a: the stream channel and the feed the scorebug page reads.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { makeDb } from './db.ts';

type Db = Awaited<ReturnType<typeof makeDb>>;
let t: Db;
let team = '', season = '', game = '', later = '', token = '', p7 = '', p12 = '', p3 = '';
const fails = (p: Promise<unknown>, re: RegExp) => assert.rejects(p, re);
type Feed = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const feed = (tok: string, have: string | null = null) =>
  t.as<{ f: Feed | null }>(null, `select overlay_feed($1, $2) f`, [tok, have]).then((r) => r[0].f);

before(async () => {
  t = await makeDb();
  for (const [k, n] of [['owner', 'Olive'], ['scorer', 'Sam'], ['media', 'Mel'], ['stranger', 'Stan']]) await t.signUp(k, n);
  [{ id: team }] = await t.as<{ id: string }>('owner', `select id from create_team('Blue Steel', 'STEEL', '#2f63cc', '14U', 'Fall 2026')`);
  [{ id: season }] = await t.as<{ id: string }>(null, `select id from seasons where team_id = $1`, [team]);
  for (const role of ['scorer', 'media']) {
    const [{ token: inv }] = await t.as<{ token: string }>('owner', `insert into staff_invites (team_id, role) values ($1, $2) returning token`, [team, role]);
    await t.as(role, `select accept_invite($1)`, [inv]);
  }
  const add = (first: string, last: string, num: string, pub: string) => t.as<{ id: string }>('owner',
    `insert into players (team_id, first_name, last_name, number, public_name) values ($1, $2, $3, $4, $5) returning id`, [team, first, last, num, pub]).then((r) => r[0].id);
  p7 = await add('Johnny', 'Vance', '7', 'full');
  p12 = await add('Ben', 'Ortiz', '12', 'first_initial');
  p3 = await add('Cy', 'Park', '3', 'number');
  const mk = (opp: string, at: string) => t.as<{ id: string }>('owner',
    `insert into games (team_id, season_id, opponent_name, opponent_abbr, starts_at) values ($1, $2, $3, 'OPP', $4) returning id`, [team, season, opp, at]).then((r) => r[0].id);
  later = await mk('Later', '2026-10-10T18:00:00Z');
  game = await mk('Hawks', '2026-10-04T18:00:00Z');
  // The staff's lineup holds full names; the guests were typed in at the field.
  const us = { batters: [{ bid: p7, num: '7', name: 'Johnny Vance' }, { bid: p12, num: '12', name: 'Ben Ortiz' }, { bid: p3, num: '3', name: 'Cy Park' }], positions: { P: p12, SS: p7 }, secret: 'x' };
  const them = { batters: [{ bid: 'x1', num: '19', name: 'Dane Kell' }], positions: { P: 'x1' } };
  await t.as('owner', `insert into game_lineups (game_id, side, data) values ($1, 'us', $2::jsonb), ($1, 'them', $3::jsonb)`, [game, JSON.stringify(us), JSON.stringify(them)]);
});

test('every team has a channel; only its staff can read the link', async () => {
  const rows = await t.as<{ token: string; show_line: boolean; auto_card: boolean; card: string | null }>('media', `select token, show_line, auto_card, card from channels where team_id = $1`, [team]);
  assert.equal(rows.length, 1);
  assert.deepEqual({ ...rows[0], token: '' }, { token: '', show_line: true, auto_card: false, card: null });
  token = rows[0].token;
  assert.equal((await t.as('stranger', `select 1 from channels`)).length, 0);
  await fails(t.as(null, `select 1 from channels`), /permission denied/);
});

test('any seat runs the stream; nobody rewrites the link or points it at another team\'s game', async () => {
  await t.as('media', `update channels set card = 'batter', auto_card = true where team_id = $1`, [team]);
  const [row] = await t.as('scorer', `select card, auto_card from channels where team_id = $1`, [team]);
  assert.deepEqual(row, { card: 'batter', auto_card: true });
  await fails(t.as('owner', `update channels set token = gen_random_uuid() where team_id = $1`, [team]), /permission denied/);
  await fails(t.as('owner', `update channels set card = 'fireworks' where team_id = $1`, [team]), /check constraint/);
  await t.as('stranger', `update channels set card = null`);
  assert.equal((await t.as('owner', `select card from channels where team_id = $1`, [team]))[0].card, 'batter');
  const [{ id: other }] = await t.as<{ id: string }>('stranger', `select id from create_team('Hawks', 'HAWKS', '#aa2222', null, 'Fall')`);
  const [{ id: theirs }] = await t.as<{ id: string }>('stranger', `insert into games (team_id, opponent_name, opponent_abbr) values ($1, 'X', 'X') returning id`, [other]);
  await fails(t.as('owner', `update channels set game_id = $2 where team_id = $1`, [team, theirs]), /not this team/);
  await t.as('media', `update channels set card = null, auto_card = false where team_id = $1`, [team]);
});

test('a wrong link shows nothing; before any play the feed is the next game up', async () => {
  assert.equal(await feed('00000000-0000-4000-8000-000000000000'), null);
  const f = (await feed(token))!;
  assert.equal(f.game.id, game);
  assert.equal(f.game.status, 'scheduled');
  assert.equal(f.team.display_name, 'Blue Steel');
  assert.equal(f.opponent.display_name, 'Hawks');
  assert.equal(f.season.name, 'Fall 2026');
});

test('the feed names our players as the public may see them, and guests as typed', async () => {
  const f = (await feed(token))!;
  assert.deepEqual(f.lineups.us.batters, [
    { bid: p7, num: '7', name: 'Johnny Vance' }, { bid: p12, num: '12', name: 'Ben O.' }, { bid: p3, num: '3', name: '' }]);
  assert.deepEqual(f.lineups.us.positions, { P: p12, SS: p7 });
  assert.equal('secret' in f.lineups.us, false);
  assert.deepEqual(f.lineups.them.batters, [{ bid: 'x1', num: '19', name: 'Dane Kell' }]);
});

test('scoring a play puts that game on the stream, with tonight, the at-bats and the season', async () => {
  await t.as('owner', `select import_season_stats($1, $2::jsonb)`, [season, JSON.stringify([{ player_id: p7, b_g: 10, b_pa: 30, b_ab: 27, b_h: 9 }])]);
  const play = (g: string, seq: number, type: string, payload: object, stats: object[]) =>
    t.as('scorer', `select apply_play($1, $2, $3, '{"balls":0}'::jsonb, $4::jsonb, $5::jsonb, null)`, [g, seq, type, JSON.stringify(payload), JSON.stringify(stats)]);
  // A pitch in the later game first: the stream goes there, then follows back.
  await play(later, 0, 'ball', {}, [{ side: 'them', bid: 'z', p_pitches: 1 }]);
  assert.equal((await feed(token))!.game.id, later);
  await play(game, 0, 'ball', {}, [{ side: 'them', bid: 'x1', p_pitches: 1 }]);
  await play(game, 1, 'play', { play: { kind: 'H2', code: '', inning: 1, half: 'bottom' } },
    [{ side: 'us', bid: p7, b_pa: 1, b_ab: 1, b_h: 1, b_2b: 1 }, { side: 'them', bid: 'x1', p_bf: 1, p_h: 1, p_pitches: 1 }]);
  const f = (await feed(token))!;
  assert.equal(f.game.id, game);
  assert.equal(f.game.status, 'live');
  assert.equal(f.game.seq, 2);
  const mine = f.tonight.find((r: Feed) => r.bid === p7);
  assert.deepEqual([mine.side, mine.b_pa, mine.b_h, mine.b_2b], ['us', 1, 1, 1]);
  assert.equal(f.tonight.find((r: Feed) => r.bid === 'x1').p_pitches, 2);
  assert.deepEqual(f.pas, [{ side: 'us', bid: p7, inning: 1, kind: 'H2', code: '' }]);
  const line = f.season_stats.find((r: Feed) => r.player_id === p7);
  assert.deepEqual([line.b_g, line.b_ab, line.b_h], [11, 28, 10]);
});

test('a page that is up to date gets only the version back; any change sends the whole feed again', async () => {
  const f = (await feed(token))!;
  assert.deepEqual(await feed(token, f.v), { v: f.v });
  await t.as('media', `update channels set card = 'pitcher' where team_id = $1`, [team]);
  const g = (await feed(token, f.v))!;
  assert.notEqual(g.v, f.v);
  assert.equal(g.card, 'pitcher');
  // A lineup change counts too.
  await t.as('owner', `update game_lineups set data = data || '{"note":1}'::jsonb where game_id = $1 and side = 'them'`, [game]);
  assert.notEqual((await feed(token, g.v))!.v, g.v);
});

test('staff can put a game on the stream by hand; a new team gets its own channel', async () => {
  await t.as('media', `update channels set game_id = $2 where team_id = $1`, [team, later]);
  assert.equal((await feed(token))!.game.id, later);
  const n = await t.as(null, `select count(*)::int n from teams`);
  const c = await t.db.query<{ n: number }>(`select count(*)::int n from channels`);
  assert.equal(c.rows[0].n, n[0].n);
});

test('a look and the two new cards; only a known look is taken', async () => {
  assert.equal((await feed(token))!.look, 'pressbox');
  await t.as('media', `update channels set look = 'primetime', card = 'box' where team_id = $1`, [team]);
  const f = (await feed(token))!;
  assert.deepEqual([f.look, f.card], ['primetime', 'box']);
  await t.as('media', `update channels set card = 'leaders' where team_id = $1`, [team]);
  await fails(t.as('owner', `update channels set look = 'my-own-page' where team_id = $1`, [team]), /check constraint/);
});

test('the feed carries short codes, our public roster, and the newest play until it is undone', async () => {
  await t.as('media', `update channels set game_id = $2 where team_id = $1`, [team, game]);
  const f = (await feed(token))!;
  assert.deepEqual([f.team.abbr, f.opponent.abbr], ['STEEL', 'OPP']);
  assert.deepEqual(f.roster.map((r: Feed) => [r.num, r.name]), [['3', ''], ['7', 'Johnny Vance'], ['12', 'Ben O.']]);
  assert.deepEqual(f.last, { seq: 2, type: 'play', kind: 'H2', rolled: false });
  await t.as('scorer', `select undo_play($1, 2)`, [game]);
  assert.equal((await feed(token))!.last, null);
});

test('the public game: our players under their public names, typed-in guests by number only', async () => {
  const pg = (have: string | null = null) => t.as<{ f: Feed | null }>(null, `select public_game($1, $2) f`, [game, have]).then((r) => r[0].f!);
  const f = await pg();
  assert.deepEqual(f.lineups.us.batters.map((b: Feed) => b.name), ['Johnny Vance', 'Ben O.', '']);
  assert.deepEqual(f.lineups.them.batters, [{ bid: 'x1', num: '19', name: '' }]);
  assert.equal(f.team.slug.startsWith('blue-steel'), true);
  assert.equal(f.opponent.slug, null);
  assert.equal(f.game.id, game);
  assert.deepEqual(await pg(f.v), { v: f.v });
  // The stream still names the guest: the scorer put him on it.
  assert.equal((await feed(token))!.lineups.them.batters[0].name, 'Dane Kell');
  assert.equal((await t.as(null, `select public_game('00000000-0000-4000-8000-000000000000') f`))[0].f, null);
});

test('the sponsor and a new link are for the team\'s leads; the old link dies at once', async () => {
  await fails(t.as('media', `select set_sponsor($1, 'Dairy Barn', 'Cold treats', null)`, [team]), /organizer or head coach/);
  await t.as('owner', `select set_sponsor($1, ' Dairy Barn ', 'Cold treats on Elm', 'https://example.test/logo.png')`, [team]);
  await t.as('media', `update channels set card = 'sponsor', auto_mid = true where team_id = $1`, [team]);
  const f = (await feed(token))!;
  assert.deepEqual(f.sponsor, { name: 'Dairy Barn', line: 'Cold treats on Elm', logo: 'https://example.test/logo.png' });
  assert.deepEqual([f.card, f.auto_mid, f.game.sport], ['sponsor', true, 'baseball']);
  // Taking the sponsor away takes its card off air.
  await t.as('owner', `select set_sponsor($1, '', '', '')`, [team]);
  const g = (await feed(token))!;
  assert.deepEqual([g.sponsor, g.card], [null, null]);
  await fails(t.as('scorer', `select reset_stream_link($1)`, [team]), /organizer or head coach/);
  const [{ reset_stream_link: fresh }] = await t.as<{ reset_stream_link: string }>('owner', `select reset_stream_link($1)`, [team]);
  assert.equal(await feed(token), null);
  assert.equal((await feed(fresh))!.game.id, game);
  token = fresh;
});

test('the newest play says whether it ended a half', async () => {
  const [{ seq }] = await t.as<{ seq: number }>(null, `select seq from games where id = $1`, [game]);
  await t.as('scorer', `select apply_play($1, $2, 'out', '{"outs":1}'::jsonb, '{}'::jsonb, '[]'::jsonb, null)`, [game, seq]);
  assert.equal((await feed(token))!.last.rolled, false);
  await t.as('scorer', `select apply_play($1, $2, 'out', '{"outs":0,"half":"bottom"}'::jsonb, '{}'::jsonb, '[]'::jsonb, null)`, [game, seq + 1]);
  assert.equal((await feed(token))!.last.rolled, true);
});
