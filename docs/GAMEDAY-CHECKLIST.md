# Game-day checklist

What to check before and during a live game, from the 10/15 bug-squash reviews (PR #3 and v5.13). These are the gaps the code doesn't close.

## Before first pitch

- Lineups for both games are saved. Every change saves by itself; the bar at the bottom says **Saved**. A "Same as last game" fill is only a suggestion until you change something or tap **Use this lineup**.
- Handed a card: tap **# From the card** and type the numbers top to bottom, each with its position key (or **Next** to keep the spot). A number already in the order moves up; a number nobody has asks who it is and puts them on the roster. **Done** benches whoever was not on the card. **Undo** steps back through anything.
- Both of a doubleheader's games are on Today, each with its own Lineup button.
- Set Game 1's lineup before Game 2's.
- On the pad's On Air panel, tap **Put this game on the stream**, then raise Starting Soon. Until the first play, the stream shows whatever game it last pointed at.
- OBS:
  - Set the Browser Source's Page permissions to Basic or higher.
  - Turn the Replay Buffer on, with a max time of 70 s or more, if you want auto-clips.
- Don't deploy (merge to main) during a game. A new release reloads the stream page.

## During the game

- Score from **one** phone. Since PR #3, the pad's reload reads lineups fresh, but a pitching change made elsewhere is only noticed when the pad opens.
- Start the time-limit clock once. Since v5.13, reopening the Situation sheet shows the running clock, not 1:45:00.
- The pad is laid out like GameChanger: the field with both teams on it, the batter (AB) and pitcher (P) cards above it, the pitch keys below it (strike swinging and strike looking are separate keys), and **PITCH** on the mound for everything else: ball in play, hit by pitch, intentional walk, catcher's or batter's interference, batter out, a dropped 3rd strike (with two strikes), a balk. The Game Menu (☰) can switch this phone to **Big keys**.
- Ball in play: how it was hit, what happened, then tap the fielders in the order the ball went (6-4-3) and say where the runners ended up. Putouts, assists and errors are credited from that.
- Runners: drag one to a **SAFE** or **OUT** box (or tap him). Safe asks how (steal, wild pitch, passed ball, error, indifference, obstruction); out asks how (caught stealing, picked off, interference, appeal, other), then the throw: catcher then third baseman is a 2-5 pickoff.
- Pitching change: tap the P card (or the pitcher on the field). Sub: tap the AB card, then **Sub** on their row. Neither leaves the pad. After any change, glance at who's up anyway.
- Their lineup came late or not at all: on their lineup tap **Placeholders** and pick 9 to 12 batters, then fix each number on the pad (AB card › Edit) as he comes up.
- Undoing a pitcher change doesn't undo it in the lineup. Change the pitcher back from the pitch count too.
- **End game** is on the pad's bottom bar and in the Game Menu (☰ › Game over), and the pad offers it by itself when the score says the game is over (last inning, extra inning, or the game's run rule). A max-runs inning: ☰ › End half inning. A game left live from an earlier day shows on Today as **Never ended**.
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
