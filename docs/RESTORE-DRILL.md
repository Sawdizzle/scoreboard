# Backups and the restore drill

What protects the league's data, and the drill that proves a restore works.
Run the drill once before the league pilot, then once a season.

## What is in place

- **Point-in-time recovery (PITR)** on the Supabase project (Database →
  Backups → Point in time). It needs a paid plan and the PITR add-on. With it,
  the database can be put back to any second in the retention window.
- **Daily backups** come with every paid Supabase plan (Database → Backups →
  Scheduled backups).
- **Audit trail for wiped games**: `game_audit` keeps who reset or deleted a
  game, when, and its state at the time, so you know what time to restore to.
- **Error logs**: server errors (`instrumentation.ts`) and crashes on the pad
  or the overlay (`app/api/client-error`) are single JSON lines tagged
  `server-error` and `client-error` in the Vercel logs. Point a Vercel log
  drain (or an alert on those tags) at them.

## The drill (about 30 minutes, on a day with no game)

1. **Pick a target time.** Note the current time (UTC). Score a few practice
   plays on a throwaway game, then delete that game. `game_audit` now has a
   `delete` row for it.
2. **Restore to a new project, not prod.** In Supabase, Database → Backups →
   Point in time → *Restore to a new project* (or, without PITR, restore the
   latest daily backup to a new project). Choose the time from step 1.
3. **Check the copy.** In the new project's SQL editor:
   ```sql
   select count(*) from public.games;
   select count(*) from public.game_events;
   select id, opponent_name, status from public.games order by updated_at desc limit 5;
   ```
   The deleted practice game is back, with its plays.
4. **Check the app against it.** Run the app locally with `.env.local`
   pointed at the new project's URL and publishable key. Open a team, a game
   and the public team page.
5. **Write it down.** Date, who ran it, how long the restore took, anything
   that went wrong. Add a line to the table below.
6. **Clean up.** Delete the restored project (it bills while it runs).

## If you need it for real

1. Stop scoring: tell every scorer to stop tapping until you say so.
2. Find the time to restore to (`game_audit`, or the last good play in
   `game_events.created_at`).
3. Restore to a **new** project first and check it (steps 3-4 above).
4. Then either restore prod in place to that time, or copy the missing rows
   from the restored project into prod. In-place restore loses everything
   after the restore time, so prefer copying rows when only one game was hit.

## Drill log

| Date | Who | Restore time | Notes |
|------|-----|--------------|-------|
|      |     |              |       |
