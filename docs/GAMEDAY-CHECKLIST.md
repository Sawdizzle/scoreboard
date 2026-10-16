# Game-day checklist

What to check before and during a live game, from the 10/15 bug-squash reviews (PR #3 and v5.13). These are the gaps the code doesn't close.

## Before first pitch

- Lineups for both games are saved. Press **Save**: a "Same as last game" fill isn't stored until you do.
- Build the order with the jersey keypad or the bench chips. Since v5.13, pasting matches roster players by number, but check that every player shows as themselves.
- Set Game 1's lineup before Game 2's.
- On the pad's On Air panel, tap **Put this game on the stream**, then raise Starting Soon. Until the first play, the stream shows whatever game it last pointed at.
- OBS:
  - Set the Browser Source's Page permissions to Basic or higher.
  - Turn the Replay Buffer on, with a max time of 70 s or more, if you want auto-clips.
- Don't deploy (merge to main) during a game. A new release reloads the stream page.

## During the game

- Score from **one** phone. Since PR #3, the pad's reload reads lineups fresh, but a pitching change made elsewhere is only noticed when the pad opens.
- Start the time-limit clock once. Since v5.13, reopening the Situation sheet shows the running clock, not 1:45:00.
- Mid-game lineup edits keep the right batter up, since PR #3. With a player selected, tapping a bench player subs them in at the same spot. After any edit, glance at who's up anyway.
- Undoing a pitcher change doesn't undo it in the lineup. Fix the pitcher on the lineup screen too.
- Don't correct Game 1 while Game 2 is live. It flips the stream back to Game 1 until Game 2's next play. Corrections no longer fire sounds or stingers.
- A run on a third-out time play (e.g. a sac fly where the trail runner is out at 3rd) isn't counted. Fix the score in Situation.

## What v5.13 added on top of PR #3

- **Pad:**
  - Requests time out after 15 s and retry.
  - An undo whose reply was lost is recognised instead of clearing the queue.
  - A reload that read the game before a save landed is dropped.
  - A second Undo tap while one is still sending is ignored.
  - Reopening Situation shows the running time-limit clock, not 1:45:00.
- **Overlay:**
  - Each piece is wrapped so a crash takes only itself down, and it retries after a second.
  - The feed call times out after 6 s.
  - An error page no longer counts as a new release, so it can't trigger a reload.
  - A failed load after a reload starts empty and keeps polling, instead of showing a 404.
- **Lineups:**
  - Pasted lineups join roster players by name, or by number when the names agree.
  - "Same as last game" only looks at earlier games.
