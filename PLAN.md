# Pressbox (working name) — plan

Scoreboard grows from a scorebug into the whole thing: build a team once, score the
game once, and the roster, the season stats and the broadcast all read from the same
plays. Design canvas: https://claude.ai/artifact/NcTdvruT6Qs1SdQNvyXs8v

Status: **Stage 1 (Team HQ) is built and on its database, awaiting Shawn's checklist run.**
Stage 0 design approved 2026-10-02 ("your proposals are fine"), including the open
questions below as proposed.

## Decisions made (2026-10-02)

- **Look**: Scoreboard's own navy / chalk / steel, pushed further. Barlow Condensed
  numerals, the Prime Time team-colour hatch as the signature, gold for live stats.
- **Foundation**: rebuild on a framework. The scorebug stays a plain transparent page
  that drops into OBS (or any streaming software) as a Browser / HTML source.
- **Visibility**: public team pages. Roster, schedule, live game and season stats are
  readable without an account. Each player has a "shown publicly as" setting.

## Proposed stack

- Next.js (App Router) + TypeScript on Vercel.
- Supabase project `ntdslnchefusqvzgeevv` ("Pressbox"), created 2026-10-02 in the same
  org as Scoreboard's. The current Scoreboard keeps running on its own project until
  this replaces it.
- Accounts: email and password (Supabase Auth). Scoreboard's username + PIN is not
  carried over: staff invites and password resets want a real address.
- Carried over from Scoreboard unchanged: `js/logic.js` and `js/roster.js` (the rules,
  pure functions, 300+ tests), `js/sync.js` (the write queue), and the eleven animated
  scorebugs in `bugs/` on `bugs/kit.js`. The bugs are standalone pages fed by
  `postMessage`, so they are served as static files and need no rewrite.

## Data model (to be reviewed as SQL before anything is applied)

| Table | Holds |
| --- | --- |
| `teams` | name, abbreviation, colour, logo, age group, public slug |
| `team_staff` | team, user, role (organizer, head coach, coach, scorer, media). Five rows per team at most, enforced in the database |
| `staff_invites` | one-use link: team, role, expiry |
| `players` | team, name, number, bats/throws, positions, public-name setting |
| `seasons` | team, name (Fall 2026), dates, which one is current |
| `games` | today's row, plus home and away team ids, and per side: season and "counts for stats" |
| `game_lineups` | game, side, batting slot, player, position. Replaces the per-game roster blob |
| `plate_appearances` | game, inning, half, batter, pitcher, result, RBI, pitches. Written in the same transaction as the play; undo removes it |
| `runner_events` | steals, caught stealing, runs scored, by player |
| `channels` | the account's overlay link, as today |

Season lines (AVG, OBP, SLG, ERA, ...) are views over `plate_appearances` and
`runner_events`, filtered by season. Nothing is typed in twice and nothing is stored
that can be recomputed.

The one structural change from Scoreboard: a play has to name **who** batted and who
pitched. Today's event log is name-free on purpose (the public recap), and lineup rows
carry a `bid` that lives only inside one game. Here the `bid` becomes the player's id.

## Stages

Each stage ends with a checklist to run before the next one starts.

0. **Design** — the canvas above. Approved.
1. **Team HQ** — app shell, accounts, the schema, teams, five staff seats with invite
   links, roster, seasons. No scoring yet. **Built.**
2. **Game night**, in three parts:
   - **2a, built:** GameChanger season import, season stats, stats on Player, Season, Roster and Today.
   - **2b, built:** games (Pressbox opponents or typed names), schedule, Today's next game, lineup editor
     (batting order, field positions that trade on a clash, bench, players typed in at the field).
   - **Team brand, built** (asked for before 2c): logo upload to Storage, palette read from the logo,
     primary and accent colours, a display name of up to 24 characters, one look for teams everywhere.
   - **2c:** the pad; every play adds to the same season stats.

   Original scope — New Game picks two teams and their rosters load; lineup and field
   screen; the pad on the ported rules; every play writes a plate appearance; player
   and season screens show real numbers.
3. **On stream** — the Browser Source page, the eleven bugs, the batter's season line
   on the bug, and the stat cards (batter, pitcher, due up) raised from On Air or
   popped automatically for each new batter.
4. **Public** — team page, live game page, box score.
5. **Bring it over** — the nine saved teams from Scoreboard. (The GameChanger CSV
   import moved up into 2a.)

## Open questions

1. **Name.** "Pressbox" is a placeholder.
2. **Whose stats does a game change?** When Blue Steel's scorer scores a game against
   River, and River is also on the platform: does River's season change? Proposed: no.
   A game counts only for the team whose staff scored it. River's season numbers on
   the stream come from River's own games; "today" comes from this game.
3. **Opponents not on the platform.** Proposed: a private guest team owned by the
   scorer, entered by jersey number as today, never public.
4. **Other sports.** Scoreboard also scores football, soccer, volleyball and
   basketball. Proposed: keep those pads as they are (score only) and build teams,
   seasons and stats for baseball first.
