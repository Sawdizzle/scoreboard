# Migrations

The database side of the app, in the repo rather than only in the hosted
project. Before this existed, the schema, the RLS policies and the RPCs
lived exclusively in Supabase — the one part of a deliberately no-build app that
could not be recovered from the files you can see.

- **`00000000000000_scoreboard_baseline.sql`** — the whole schema as one runnable
  file: tables, constraints, indexes, comments, functions, the trigger, RLS and
  its policies, grants, and the Realtime publication. Stand up a new project, a
  staging branch or a local stack from this and the app works.
- Everything after it is a single change, in order.

The baseline is **squashed from the live project**, not replayed from the fifteen
migrations that built it (`20260812225438_live_scoreboard` onward). Those exist
only in the remote history. To bring them down instead:

```bash
supabase link --project-ref <your-project-ref>
supabase db pull --schema scoreboard    # needs the database password
```

## The remote already has this schema

So the CLI has to be told the baseline is accounted for, or a `db push` will try
to run it against a database that already has everything:

```bash
supabase migration repair --status applied 00000000000000
```

Every file after the baseline is named with the version the remote history
recorded for it (`supabase_migrations.schema_migrations`), so `supabase
migration list` shows local and remote in step and a `db push` has nothing to
re-run. Migrations applied through the Supabase MCP get their version at apply
time: after applying one, rename the file to that version.

`supabase/pending/` holds migrations written but not yet applied. Each says
what has to be true first; once applied, it moves here under its recorded
version.

## How the baseline was checked

It was written from catalog introspection, then compared field by field against
the live schema as it stood then: all 92 columns (type, default, not-null), 19 constraints, 9
indexes, 20 policies, 5 RLS flags and 11 functions, with no extras. Function
bodies are verbatim `pg_get_functiondef` output, so the part that would be
hardest to reconstruct by hand cannot drift.

It has **not** been executed end to end against an empty database. Before
trusting it for a real restore, run it once somewhere disposable:

```bash
supabase start && supabase db reset     # applies every migration in order
```
