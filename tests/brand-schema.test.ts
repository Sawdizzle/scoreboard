// Team brand: display names, colors, and who may put a logo where.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { makeDb } from './db.ts';

type Db = Awaited<ReturnType<typeof makeDb>>;
let t: Db;
let team = '', other = '';
const fails = (p: Promise<unknown>, re: RegExp) => assert.rejects(p, re);
const noRows = (p: Promise<unknown[]>) => p.then((r) => assert.equal(r.length, 0));

before(async () => {
  t = await makeDb();
  for (const [k, n] of [['owner', 'Olive'], ['coach', 'Cora'], ['stranger', 'Stan']]) await t.signUp(k, n);
  [{ id: team }] = await t.as<{ id: string }>('owner', `select id from create_team('Blue Steel Baseball Club', 'STEEL', '#2f63cc', '14U', 'Fall 2026')`);
  [{ id: other }] = await t.as<{ id: string }>('stranger', `select id from create_team('Hawks', 'HAWKS', '#aa2222', null, null)`);
  const [{ token }] = await t.as<{ token: string }>('owner', `insert into staff_invites (team_id, role) values ($1, 'coach') returning token`, [team]);
  await t.as('coach', `select accept_invite($1)`, [token]);
});

test('a new team shows its name until it is given a display name', async () => {
  const [row] = await t.as(null, `select display_name, color2, palette from teams where id = $1`, [team]);
  assert.deepEqual(row, { display_name: 'Blue Steel Baseball Club', color2: '#f2f6fc', palette: [] });
  await t.as('owner', `update teams set display_name = 'Blue Steel', color2 = '#e0a92a', palette = '["#2f63cc","#e0a92a"]' where id = $1`, [team]);
  await fails(t.as('owner', `update teams set display_name = repeat('x', 25) where id = $1`, [team]), /teams_display_name_len/);
  await fails(t.as('owner', `update teams set palette = '[1,2,3,4,5,6,7,8,9]' where id = $1`, [team]), /palette_check/);
  await fails(t.as('owner', `update teams set logo_url = 'javascript:alert(1)' where id = $1`, [team]), /teams_logo_url_https/);
  await noRows(t.as('coach', `update teams set display_name = 'Nope' where id = $1 returning id`, [team]));
});

const put = (who: string | null, path: string) => t.as(who, `insert into storage.objects (bucket_id, name) values ('team-logos', $1) returning id`, [path]);

test('a team lead puts a logo in the team\'s own folder, and nowhere else', async () => {
  await put('owner', `${team}/logo-1.webp`);
  await fails(put('coach', `${team}/logo-2.webp`), /row-level security/);
  await fails(put('owner', `${other}/logo.webp`), /row-level security/);
  await fails(put('owner', `logo.webp`), /row-level security/);
  await fails(put('owner', `not-a-uuid/logo.webp`), /row-level security/);
  await fails(put(null, `${team}/x.webp`), /row-level security/);
});

test('anyone reads a logo; only the team lead removes it', async () => {
  assert.equal((await t.as(null, `select name from storage.objects where bucket_id = 'team-logos'`)).length, 1);
  await noRows(t.as('stranger', `delete from storage.objects where name = $1 returning id`, [`${team}/logo-1.webp`]));
  await noRows(t.as('coach', `delete from storage.objects where name = $1 returning id`, [`${team}/logo-1.webp`]));
  assert.equal((await t.as('owner', `delete from storage.objects where name = $1 returning id`, [`${team}/logo-1.webp`])).length, 1);
});
