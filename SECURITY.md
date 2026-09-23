# Security policy

## Reporting a vulnerability

Please do not open a public issue for a security problem. Use GitHub's private
reporting instead: **Security → Report a vulnerability** on this repository.
Expect a first reply within a week.

Useful things to include: what an attacker can reach, the request or steps that
show it, and whether it needs an account.

## What this project protects

Scoreboard is a static front end on top of a Supabase project. Every rule that
matters is in the database, in `supabase/migrations/`:

- **Row level security** on every table. Rosters, events and plays are readable
  only by the account that owns the game. The `games` row is public on purpose:
  the overlay and the recap page read it without signing in.
- **Names are never public.** Lineups live in `rosters`, which is owner-only.
  The public `plays` table carries jersey numbers and outcomes, no names.
- **Token-gated RPCs.** `get_roster`, `resolve_channel`, `set_obs_status`,
  `set_obs_scenes` and `ack_replay` are `SECURITY DEFINER` and callable by
  anonymous clients by design: the overlay runs in OBS with no login. They all
  require the account's overlay token, which the owner can rotate from the pad
  (Setup → Overlay link → Rotate link). Treat that token like a password; it can
  read your lineups.
- **The publishable key in `js/config.js` is meant to be public.** It identifies
  the project, it does not grant access. If you self-host, make sure the project
  behind it serves only this app — an anon key shared with another app exposes
  that app's anon-writable tables to anyone who reads this repo.
- **Signup throttle.** The `signup` edge function allows five attempts per
  address per hour and creates pre-confirmed accounts with a 6–8 digit PIN.

## Scope

In scope: anything that reads or writes another account's data, escapes RLS,
leaks player names, or lets an unauthenticated caller reach an owner-only RPC.

Out of scope: findings that need the overlay token, which is a secret the owner
holds; the public `games` row and the recap page, which are public by design;
and the Supabase advisors' warnings about the `SECURITY DEFINER` functions
listed above, which are intentional and token-gated.
