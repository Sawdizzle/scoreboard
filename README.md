# Pressbox (working name)

Scoreboard's next generation: teams with five staff seats, rosters, seasons and
player stats, feeding the same Browser Source scorebug. See [PLAN.md](PLAN.md)
for the stages; this is Stage 1, Team HQ.

## Run it

```
npm install
cp .env.example .env.local   # the project URL and publishable key
npm run dev                  # http://localhost:3000
```

`/dev/kit?v=today` (also `today-empty`, `roster`, `empty`, `player`, `pitcher`,
`staff`, `staff-link`, `season`, `season-empty`, `settings`, `import`, `game`,
`lineup`, `lineup-them`, `pad`; add `&role=coach` for a seat that cannot edit) draws every
team screen from made-up data with no database. `?v=overlay` draws the stream's
scorebug over a stand-in camera (`&card=batter`, `pitcher` or `dueup`; `&line=0`;
`&status=final`). It is for checking layout at
phone width, and returns 404 in a production build.

## Check it

```
npm test            # schema (in-process Postgres) and roster parsing
npm run typecheck
npm run lint
npm run build
```

`tests/schema.test.ts` applies every file in `supabase/migrations/` to PGlite,
with `auth.users`, `auth.uid()` and the `anon` / `authenticated` roles stubbed
in, and checks each rule as the role a real request would arrive as: who can
create, read and change what, the five-seat limit, the last-organizer guard,
one current season, and the public roster's name masking.

## Where things are

| Path | What it is |
| --- | --- |
| `supabase/migrations/` | The schema. Each file is named by the version the live project recorded when it was applied |
| `app/actions.ts` | Every write. Each runs as the signed-in user; Postgres policies decide |
| `lib/data.ts` | Reads, and `loadTeam()`, which every team page goes through |
| `lib/roster-parse.ts` | Pasted rosters, carried over from Scoreboard's `js/roster.js` |
| `lib/rules/` | Scoreboard's rules engine (`logic.js`, `roster.js`), copied unchanged; not linted here |
| `lib/lineup.ts` | Lineups built from a roster or last game, and checked before they are stored |
| `lib/gamechanger.ts`, `lib/stats.ts` | GameChanger export parsing, and every rate (AVG, ERA ...) from counts |
| `lib/onair.ts` | What the stream says about the batter, the pitcher and who is due up; shared by the pad's On Air and the scorebug page |
| `components/overlay/` | The Browser Source page (`/overlay/<token>`): `Stage` draws a feed, `Overlay` fetches it |
| `components/views/` | The team screens, data in, markup out, so `/dev/kit` can draw them |
| `proxy.ts` | Refreshes the session cookie and sends signed-out visitors to sign in |

## Database

Supabase project `ntdslnchefusqvzgeevv` ("Pressbox", us-east-1), in the same
organization as Scoreboard's project. Tables live in `public`, so no schema has
to be exposed by hand.

Security advisors flag the `SECURITY DEFINER` functions as callable. That is
intended: `invite_preview`, `public_roster` and `overlay_feed` (the stream page,
by its secret token) are the public's only way in,
`create_team` and `accept_invite` are the only way to make a team or fill a
seat, and `has_team_role` / `is_team_staff` only answer "am I on this team".
