// A final game is the organizer's to reset or delete, and every reset or
// delete leaves a game_audit row behind.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeDb } from './db.ts';

test('final games: scorers and head coaches are refused; organizers leave an audit row', async () => {
  const t = await makeDb();
  for (const [k, n] of [['owner', 'Olive'], ['head', 'Hal'], ['scorer', 'Sam']]) await t.signUp(k, n);
  const [{ id: team }] = await t.as<{ id: string }>('owner', `select id from create_team('Blue Steel', 'STEEL', '#2f63cc', '14U', 'Fall 2026')`);
  for (const [who, role] of [['head', 'head_coach'], ['scorer', 'scorer']]) {
    const [{ token }] = await t.as<{ token: string }>('owner', `insert into staff_invites (team_id, role) values ($1, $2) returning token`, [team, role]);
    await t.as(who, `select accept_invite($1)`, [token]);
  }
  const mk = async () => (await t.as<{ id: string }>('owner', `insert into games (team_id, opponent_name, opponent_abbr) values ($1, 'Hawks', 'HAWK') returning id`, [team]))[0].id;
  const audit = (game: string) => t.as<{ action: string; actor: string }>('owner', `select action, actor from game_audit where game_id = $1 order by id`, [game]);

  // Before the final, a scorer may still reset; it is recorded.
  const early = await mk();
  await t.as('scorer', `select reset_game($1)`, [early]);
  assert.deepEqual(await audit(early), [{ action: 'reset', actor: t.users.scorer }]);

  const game = await mk();
  await t.db.query(`update games set status = 'final' where id = $1`, [game]);
  await assert.rejects(t.as('scorer', `select reset_game($1)`, [game]), /Only an organizer/);
  await assert.rejects(t.as('head', `select reset_game($1)`, [game]), /Only an organizer/);
  assert.equal((await t.as('head', `delete from games where id = $1 returning id`, [game])).length, 0);
  assert.deepEqual(await audit(game), []);

  await t.as('owner', `select reset_game($1)`, [game]);
  assert.deepEqual(await audit(game), [{ action: 'reset', actor: t.users.owner }]);
  await t.db.query(`update games set status = 'final' where id = $1`, [game]);
  assert.equal((await t.as('owner', `delete from games where id = $1 returning id`, [game])).length, 1);
  assert.deepEqual((await audit(game)).map((r) => r.action), ['reset', 'delete']);
  const [{ snapshot }] = await t.as<{ snapshot: { status: string } }>('owner', `select snapshot from game_audit where game_id = $1 and action = 'delete'`, [game]);
  assert.equal(snapshot.status, 'final');
  // Nobody writes the record by hand, and strangers don't read it.
  await assert.rejects(t.as('owner', `insert into game_audit (game_id, team_id, action) values ($1, $2, 'reset')`, [game, team]), /permission denied/);
  await assert.rejects(t.as(null, `select 1 from game_audit`), /permission denied/);
});
