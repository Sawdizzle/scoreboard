// The invite-code gate: open by default, closed once a code is set, and
// always open to a sign-up on its way to an open staff invite.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeDb } from './db.ts';

const event = (meta: Record<string, string>, email = 'new@example.test') =>
  JSON.stringify({ user: { email, user_metadata: meta } });

test('signup gate', async () => {
  const { db } = await makeDb();
  const hook = async (meta: Record<string, string>, email?: string) =>
    (await db.query<{ r: Record<string, unknown> }>('select public.hook_before_user_created($1::jsonb) r', [event(meta, email)])).rows[0].r;

  assert.deepEqual(await hook({}), {}, 'no code set: open');
  assert.equal((await db.query<{ r: boolean }>('select public.signup_needs_code() r')).rows[0].r, false);

  await db.exec(`insert into private.settings (key, value) values ('invite_code', 'steel')`);
  assert.equal((await db.query<{ r: boolean }>('select public.signup_needs_code() r')).rows[0].r, true);
  assert.ok('error' in await hook({}), 'no code: refused');
  assert.ok('error' in await hook({ invite_code: 'wrong' }), 'wrong code: refused');
  assert.deepEqual(await hook({ invite_code: 'steel' }), {}, 'right code: in');
  assert.ok('error' in await hook({}, 'anything@users.scoreboard.app'), 'old v4 domain, no code: refused');

  await db.exec(`
    insert into public.teams (id, slug, name, abbr) values ('00000000-0000-0000-0000-0000000000aa', 'gate-team', 'Gate', 'GT');
    insert into public.staff_invites (token, team_id, role) values ('00000000-0000-0000-0000-0000000000bb', '00000000-0000-0000-0000-0000000000aa', 'coach');
  `);
  assert.deepEqual(await hook({ staff_invite: '00000000-0000-0000-0000-0000000000bb' }), {}, 'open staff invite: in');
  await db.exec(`update public.staff_invites set used_at = now()`);
  assert.ok('error' in await hook({ staff_invite: '00000000-0000-0000-0000-0000000000bb' }), 'used invite: refused');
});
