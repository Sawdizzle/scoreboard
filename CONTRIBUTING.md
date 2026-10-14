# Contributing

This is a small project that runs a real broadcast most weekends, so changes
are judged on whether they hold up live. Bug reports and pull requests are
welcome.

## Ground rules

- **Rules live in `lib/rules/`, and they are v4's.** Baseball (`logic.js`,
  `roster.js`) and the other sports came over unchanged with their tests. They
  are pure: a game in, a patch out, no DOM, no network, no clock. A rule change
  goes there and gets a test in `tests/rules/`.
- **The database decides.** Every write runs as the signed-in user through
  `app/actions.ts` or an RPC, and Postgres policies say yes or no. A check in
  the app only turns bad input into a sentence.
- **One home per control.** Game flow on the pad, corrections in Fix the
  situation, what is on air now in On Air, how the stream looks on the Stream
  screen. Do not add a second button for something that already has a place.
- **Looks are scoped.** A look is one component and one stylesheet; every
  selector sits under its root class, and no class name is generic enough to
  match another look's.

## Before you open a pull request

```
npm test
npm run typecheck
npm run lint
npm run build
```

All four run in CI on every pull request. Anything that changes what goes on
screen needs a look at it, not only a passing test: `/dev/kit?v=overlay` draws
the stream over a stand-in camera, and the Stream screen's **Play every moment
on the stream** fires every stinger at a real overlay.

## Database changes

Schema changes are SQL files in `supabase/migrations/`, applied in filename
order and named by the version the project records when it is applied. Write
each so it can run against a project that already has data, and add a test in
`tests/` that exercises it as `anon` and `authenticated` (see `tests/db.ts`).

Never widen RLS or expose a new anonymous RPC without saying why in the pull
request. See `SECURITY.md` for what the rules are protecting.

## Style

Match the file you are in: naming, comment density, idiom. Comments explain
why, not what. Commit messages are a plain sentence, with the version on
release merges, for example `v5.1: the pad keeps the last pitch on a reload`.
