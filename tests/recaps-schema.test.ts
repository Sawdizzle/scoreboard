// AI recaps: drafts are staff only; a published recap is public; only
// organizers and coaches write one; usage rows stay with their team.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { makeDb } from './db.ts';

type Db = Awaited<ReturnType<typeof makeDb>>;
let t: Db;
let team = '', other = '', game = '', otherGame = '';
const content = JSON.stringify({ headline: 'Steel win', recap: 'They won.' });

before(async () => {
  t = await makeDb();
  await t.signUp('owner', 'Olive');
  await t.signUp('stranger', 'Sam');
  await t.signUp('rival', 'Rita');
  [{ id: team }] = await t.as<{ id: string }>('owner', `select id from create_team('Blue Steel', 'STEEL', '#2f63cc', '14U', 'Fall 2026')`);
  [{ id: other }] = await t.as<{ id: string }>('rival', `select id from create_team('Hawks', 'HAWKS', '#cc2f2f', '14U', 'Fall 2026')`);
  [{ id: game }] = await t.as<{ id: string }>('owner', `insert into games (team_id, opponent_name, opponent_abbr) values ($1, 'Hawks', 'HAWKS') returning id`, [team]);
  [{ id: otherGame }] = await t.as<{ id: string }>('rival', `insert into games (team_id, opponent_name, opponent_abbr) values ($1, 'Steel', 'STEEL') returning id`, [other]);
});

test('staff write a draft; nobody else sees it until it is published', async () => {
  await t.as('owner', `insert into game_recaps (game_id, team_id, content, facts, model) values ($1, $2, $3, '{}', 'claude-sonnet-5-5')`, [game, team, content]);
  assert.equal((await t.as('owner', `select 1 from game_recaps where game_id = $1`, [game])).length, 1);
  assert.equal((await t.as(null, `select 1 from game_recaps where game_id = $1`, [game])).length, 0);
  assert.equal((await t.as('stranger', `select 1 from game_recaps where game_id = $1`, [game])).length, 0);
  await t.as('owner', `update game_recaps set status = 'published', published_at = now() where game_id = $1`, [game]);
  assert.equal((await t.as(null, `select 1 from game_recaps where game_id = $1`, [game])).length, 1);
});

test('a recap belongs to its game’s team, and only that team’s staff write it', async () => {
  // Another team's staff cannot file a recap under our game, nor theirs under ours.
  await assert.rejects(t.as('rival', `insert into game_recaps (game_id, team_id, content, facts) values ($1, $2, $3, '{}')`, [otherGame, team, content]));
  await assert.rejects(t.as('rival', `insert into game_recaps (game_id, team_id, content, facts) values ($1, $2, $3, '{}')`, [game, other, content]));
  await assert.rejects(t.as('stranger', `insert into game_recaps (game_id, team_id, content, facts) values ($1, $2, $3, '{}')`, [otherGame, other, content]));
  const changed = await t.as('rival', `update game_recaps set content = '{"headline":"x"}' where game_id = $1 returning 1`, [game]);
  assert.equal(changed.length, 0);
});

test('usage rows: staff add their own team’s, and only they read them', async () => {
  await t.as('owner', `insert into ai_usage (team_id, game_id, kind, model, input_tokens, output_tokens, ok) values ($1, $2, 'recap', 'claude-sonnet-5-5', 1200, 800, true)`, [team, game]);
  await assert.rejects(t.as('rival', `insert into ai_usage (team_id, game_id, kind, model, ok) values ($1, $2, 'recap', 'm', true)`, [other, game]));
  await assert.rejects(t.as('stranger', `insert into ai_usage (team_id, kind, model, ok) values ($1, 'recap', 'm', true)`, [team]));
  assert.equal((await t.as('owner', `select 1 from ai_usage where team_id = $1`, [team])).length, 1);
  assert.equal((await t.as('rival', `select 1 from ai_usage where team_id = $1`, [team])).length, 0);
  await assert.rejects(t.as(null, `select 1 from ai_usage`));
});

test('AI limits: off by default, staff cannot raise it, and the allowance counts this month’s calls that worked', async () => {
  assert.deepEqual((await t.as<{ a: { limit: number; used: number; remaining: number } }>('owner', `select ai_allowance($1) a`, [team]))[0].a.limit, 0);
  await assert.rejects(t.as('owner', `update teams set ai_monthly_limit = 999 where id = $1`, [team]));
  await t.db.query(`update teams set ai_monthly_limit = 5 where id = $1`, [team]);
  // One worked earlier in this file; add one that failed and one from last month.
  await t.as('owner', `insert into ai_usage (team_id, kind, model, ok) values ($1, 'blurb', 'claude-haiku-5-5', false)`, [team]);
  await t.db.query(`insert into ai_usage (team_id, kind, model, ok, created_at) values ($1, 'recap', 'm', true, now() - interval '40 days')`, [team]);
  const [{ a }] = await t.as<{ a: { limit: number; used: number; remaining: number; resets: string } }>('owner', `select ai_allowance($1) a`, [team]);
  assert.deepEqual([a.limit, a.used, a.remaining], [5, 1, 4]);
  assert.ok(Date.parse(a.resets) > Date.now());
  await assert.rejects(t.as('stranger', `select ai_allowance($1)`, [team]));
  await assert.rejects(t.as(null, `select ai_allowance($1)`, [team]));
});

test('AI writes are reserved under the limit, one at a time, and settled by whoever reserved them', async () => {
  await t.db.query(`update teams set ai_monthly_limit = 3 where id = $1`, [team]);
  const reserve = () => t.as<{ r: { id: number | null } }>('owner', `select ai_reserve($1, $2, 'recap', 'm') r`, [team, game]).then((x) => x[0].r);
  const a = await reserve();
  assert.ok(a.id);
  // Earlier in this file one call worked; with this reservation the month holds 2 of 3, so one more fits.
  assert.ok((await reserve()).id);
  assert.equal((await reserve()).id, null);
  // A failed call gives its write back.
  await t.as('owner', `select ai_settle($1, 'claude-sonnet-5-5', 1000, 500, false)`, [a.id]);
  assert.ok((await reserve()).id);
  // Nobody else can settle it, nor reserve against another team's game.
  await t.as('rival', `select ai_settle($1, 'x', 0, 0, true)`, [a.id]);
  const [{ ok }] = await t.db.query<{ ok: boolean }>(`select ok from ai_usage where id = $1`, [a.id]).then((r) => r.rows);
  assert.equal(ok, false);
  await assert.rejects(t.as('rival', `select ai_reserve($1, $2, 'recap', 'm')`, [other, game]));
  await assert.rejects(t.as('stranger', `select ai_reserve($1, null, 'recap', 'm')`, [team]));
});

test('stream sessions: OBS going live opens one, stopping closes it, an unknown status changes nothing', async () => {
  const [{ token }] = await t.db.query<{ token: string }>(`select token from channels where team_id = $1`, [team]).then((r) => r.rows);
  const report = (streaming: boolean | null) => t.as(null, `select obs_report($1, $2::jsonb)`, [token, JSON.stringify({ streaming })]);
  await report(false); await report(true); await report(true); await report(null); await report(false); await report(true);
  const rows = await t.as<{ open: boolean }>('owner', `select ended_at is null as open from stream_sessions where team_id = $1 order by id`, [team]);
  // Live, live again (same session), unknown, stopped (closes it), live (a new one).
  assert.deepEqual(rows.map((r) => r.open), [false, true]);
  assert.equal((await t.as('stranger', `select 1 from stream_sessions where team_id = $1`, [team])).length, 0);
});

test('a stream OBS never reported stopping is closed at its last report, and the next one opens', async () => {
  const [{ token }] = await t.db.query<{ token: string }>(`select token from channels where team_id = $1`, [team]).then((r) => r.rows);
  // One is open from the test above. OBS dies; an hour later it comes back live.
  await t.db.query(`update channel_obs set at = now() - interval '1 hour' where team_id = $1`, [team]);
  await t.as(null, `select obs_report($1, '{"streaming": true}'::jsonb)`, [token]);
  const rows = await t.db.query<{ open: boolean; ended: boolean }>(
    `select ended_at is null as open, ended_at < now() - interval '50 minutes' as ended from stream_sessions where team_id = $1 order by id`, [team]).then((r) => r.rows);
  assert.deepEqual(rows.map((r) => r.open), [false, false, true]);
  assert.equal(rows[1].ended, true);
});

test('clips: the stream logs each save by token, rows only move forward, staff alone read them', async () => {
  const [{ token }] = await t.db.query<{ token: string }>(`select token from channels where team_id = $1`, [team]).then((r) => r.rows);
  const n = Date.now();
  const report = (c: Record<string, unknown>) => t.as(null, `select clip_report($1, $2::jsonb)`, [token, JSON.stringify({ n, ...c })]);
  await report({ status: 'armed', kind: 'homerun', kinds: ['homerun'], game_id: game, seq: 7, inning: 3, half: 'bottom', away: 2, home: 4 });
  await report({ status: 'asked' });
  await report({ status: 'saved' });
  await report({ status: 'armed', kind: 'run' });
  const [c] = await t.as<{ kind: string; status: string; game_id: string; inning: number; saved: boolean }>('owner',
    `select kind, status, game_id, inning, saved_at is not null as saved from game_clips where team_id = $1 and n = $2`, [team, n]);
  assert.deepEqual(c, { kind: 'homerun', status: 'saved', game_id: game, inning: 3, saved: true });
  // An undo after the save discards it.
  await report({ status: 'discarded', code: 'undone' });
  assert.equal((await t.as<{ status: string }>('owner', `select status from game_clips where n = $1`, [n]))[0].status, 'discarded');
  // Another team's game is not attached; a wrong token writes nothing; strangers read nothing.
  await t.as(null, `select clip_report($1, $2::jsonb)`, [token, JSON.stringify({ n: n + 1, status: 'armed', kind: 'homerun', game_id: otherGame })]);
  assert.equal((await t.as<{ game_id: string | null }>('owner', `select game_id from game_clips where n = $1`, [n + 1]))[0].game_id, null);
  await t.as(null, `select clip_report('00000000-0000-0000-0000-000000000000', $1::jsonb)`, [JSON.stringify({ n: n + 2, status: 'armed', kind: 'x' })]);
  assert.equal((await t.db.query(`select 1 from game_clips where n = $1`, [n + 2])).rows.length, 0);
  assert.equal((await t.as('stranger', `select 1 from game_clips where team_id = $1`, [team])).length, 0);
  await assert.rejects(t.as(null, `insert into game_clips (team_id, n, kind) values ($1, 1, 'x')`, [team]));
});
