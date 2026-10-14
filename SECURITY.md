# Security policy

## Reporting a vulnerability

Please do not open a public issue for a security problem. Use GitHub's private
reporting instead: **Security → Report a vulnerability** on this repository.
Expect a first reply within a week.

Useful things to include: what an attacker can reach, the request or steps that
show it, and whether it needs an account or a staff seat.

## What this project protects

Scoreboard is a Next.js front end on a Supabase project. Every rule that
matters is in the database, in `supabase/migrations/`, and tested in `tests/`
as the role a real request arrives as.

- **Row level security on every table.** Teams, seasons, games, stat rows and
  season stats are public: they carry ids and numbers, never names. Players,
  lineups, the play log, opponents, invites and the stream channel are for the
  team's staff only, and what each seat may change is narrower still.
- **Names follow the staff's choice.** The public reaches a roster or a game
  only through `public_roster()` and `public_game()`, which apply each player's
  public-name setting; a player typed in at the field shows by number only.
- **Five seats per team**, enforced in the database, filled only by one-use,
  expiring invite links (`accept_invite`); a team always keeps an organizer.
- **Anonymous functions, by design.** `overlay_feed` and `obs_report` serve the
  stream page, which runs in OBS with no login; both require the team's stream
  token, which an organizer or head coach can replace (Stream → Make a new
  link). Treat that link like a password: it shows lineups under their public
  names. `invite_preview`, `public_roster`, `public_game` and
  `signup_needs_code` are the public's other ways in. The Supabase advisors
  flag these `SECURITY DEFINER` functions; that is intended.
- **The publishable key is meant to be public.** It identifies the project; it
  grants nothing RLS does not. Give the app a project of its own.
- **Sign-up** is open by default; an optional invite code is enforced by a
  "before user created" auth hook (`hook_before_user_created`).

## Scope

In scope: anything that reads or writes another team's private data, escapes
RLS, leaks a player name the staff chose to hide, fills a sixth seat, or lets
an unauthenticated caller reach a staff-only write.

Out of scope: findings that need the stream token, which is a secret the staff
hold; the public tables and pages, which are public by design; and the advisor
warnings about the functions listed above.
