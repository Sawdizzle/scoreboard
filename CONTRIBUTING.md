# Contributing

This is a small, personal project that runs a real broadcast most weekends, so
changes are judged on whether they hold up live. Bug reports and pull requests
are welcome.

## Ground rules

- **No build step, and it stays that way.** Vanilla ES modules, no bundler, no
  framework, no `package.json`. Dependencies are vendored under `js/vendor/`.
  A pull request that adds a toolchain will not be merged.
- **Rules live in `js/logic.js`.** It is pure: no DOM, no network, no clock.
  Game rules go there and get a test. `js/control.js` wires the pad,
  `js/overlay.js` draws the broadcast.
- **The model is the source of truth, never the DOM.** Reading state back out of
  inputs is how the lineup bugs happened.
- **One home per control.** Game flow on the main pad, corrections in the
  Situation sheet, on-air cards in Broadcast. Do not add a second button for
  something that already has a place.

## Before you open a pull request

```
node scripts/check.mjs
node --test scripts/*.test.mjs
```

`check.mjs` is the safety net a no-build app otherwise lacks: it catches a
handler that no longer exists, a control wired to nothing, and a Supabase URL
that disagrees between `js/config.js` and the `preconnect` lines. Both commands
also run in CI on every pull request.

Anything that changes what goes on screen needs a look at a real overlay, not
only a passing test. `/control` → Setup → Overlay link → **Preview All FX**
fires every animation, and **▶ Demo Mode** plays a fake game in a throwaway
game.

## Database changes

Schema changes are SQL files in `supabase/migrations/`, applied in filename
order; `supabase/migrations/README.md` explains the naming. Write the migration
so it can run against a project that already has data. If a change cannot be
applied yet, it goes in `supabase/pending/` with a note saying what has to be
true first.

Never widen RLS or expose a new anonymous RPC without saying why in the pull
request. See `SECURITY.md` for what the rules are protecting.

## Style

Match the file you are in: tabs or spaces, naming, comment density. Comments
explain why, not what. Commit messages are a version bump and a plain sentence,
for example `v4.11: back out the analytics tag`.
