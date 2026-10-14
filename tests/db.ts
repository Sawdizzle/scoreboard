// An in-process Postgres (PGlite) with every migration applied and the few
// Supabase pieces they lean on stubbed in: auth.users, auth.uid(), and the
// anon / authenticated roles. `as(who, sql)` runs a query the way a request
// from that signed-in user (or anon, for null) would arrive.
import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const SUPABASE_STUB = `
  create role anon nologin;
  create role authenticated nologin;
  create schema auth;
  create table auth.users (
    id uuid primary key default gen_random_uuid(),
    email text,
    raw_user_meta_data jsonb not null default '{}'
  );
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to anon, authenticated;
  grant usage on schema public to anon, authenticated;

  -- Storage, as far as policies need it: buckets, and objects with RLS on and
  -- the table grants Supabase gives every project.
  create schema storage;
  create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id), name text, owner uuid default auth.uid());
  alter table storage.objects enable row level security;
  grant usage on schema storage to anon, authenticated;
  grant select, insert, update, delete on storage.objects to anon, authenticated;
`;

export async function makeDb() {
  const db = new PGlite();
  await db.exec(SUPABASE_STUB);
  const dir = new URL('../supabase/migrations/', import.meta.url);
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.sql')).sort()) {
    await db.exec(readFileSync(new URL(f, dir), 'utf8'));
  }
  const users: Record<string, string> = {};
  async function as<T = Record<string, unknown>>(who: string | null, sql: string, params: unknown[] = []) {
    await db.exec(`set role ${who ? 'authenticated' : 'anon'}; select set_config('request.jwt.claim.sub', '${who ? users[who] : ''}', false);`);
    try {
      return (await db.query<T>(sql, params)).rows;
    } finally {
      await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`);
    }
  }
  async function signUp(key: string, name: string) {
    const { rows } = await db.query<{ id: string }>(
      `insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id`,
      [`${key}@example.test`, JSON.stringify({ display_name: name })]);
    users[key] = rows[0].id;
  }
  return { db, as, signUp, users };
}
