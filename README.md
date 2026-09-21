# Broadcast Scoreboard

A live, phone-controlled **multi-sport** scoreboard overlay suite for OBS. Two static pages backed by Supabase (Postgres + Realtime + Auth), no build step.

- **`/overlay`** — transparent OBS Browser Source (1920×1080). Display-only.
- **`/control`** — phone-first control panel. Username + PIN login. Writes game state.

**Install on your phone:** open `/control` in Safari → Share → **Add to Home Screen**. It launches full-screen like a native app (no browser chrome, no accidental pull-to-refresh). On an iPad it lays out as two columns: live controls left, panels right.

## The control panel

Two rules shape it. **Everything pressed during a live at-bat is in the bottom two thirds and never moves** — on a phone the live screen is a fixed shell (score header, situation bar, batter line, pad, bottom row) and nothing between the header and the bottom row scrolls, so STRIKE is in the same place on the tenth pitch as the first. The pad takes whatever height is left, so a taller phone gets bigger keys rather than dead space. **Everything set once gets out of the way** — the config panels live in a pull-up drawer on three tabs (Teams · Look · OBS) behind `⚙ Setup`. What goes on air mid-play is not config, so it is not in the drawer: every card, takeover and moment is in the **🎬 On Air** sheet, one tap from the pad.

- **Situation bar** — inning, the count as dots (three balls, two strikes, two outs) and a mini diamond, live on every commit including rows from another device. Tapping it opens the **Situation sheet**: the bases as a diamond you tap, Advance all / Clear, steppers for balls, strikes, outs and inning, pitch count, and runs/hits/errors folded away. Every edit goes through the same `commit()` path, so all of it stays undoable.
- **The pad** — BALL · STRIKE, FOUL · OUT, RUN · NEXT BATTER, then one bar reading `1B | 2B | 3B | HR`. HR and a fourth ball open confirm sheets; nothing else asks.
- **Bottom row** — `↶ Undo`, `🎞️ Replay`, `🎥 Cameras`, `🎬 On Air`, `⚙ Setup`, fixed, icon over label. Cameras shows once OBS reports scenes and opens a sheet of scene cuts. Undo is what you reach for when something has already gone wrong, so it never scrolls away. Replay and On Air were each three or four taps deep in the drawer, which is too slow for a play that has just happened. A card that is up shows as a red chip in the header, and its ✕ takes it down. `End ½` moved into the Situation sheet — the third out already ends the half.
- **Ball in play** — `OUT` asks who fielded it on a drawn ballfield with your fielders' names on it. Tap SS and it records *Groundout 6-3*; an outfielder records a flyout (*F8*). Chips pick anything else: line drive, pop-up, fielder's choice, double play (*6-4-3*, two outs), sac fly — a chip that can't have happened with these bases says why when tapped. With runners on, a second step shows every runner and the batter against Out · 1st · 2nd · 3rd · Home, pre-filled with the likely result (forced runners up on a groundout, holding on a fly, everyone up on an error), so a routine play is one more tap. `1B/2B/3B` open the same step when anyone is on, and stay one tap when nobody is. `STRIKE` on two strikes asks how: **K Swinging**, **Looking** (backwards-K stinger, *Strikeout looking* in the play-by-play) or **Dropped 3rd** (greyed out with the reason when the batter can't run: 1st taken with fewer than two outs). The **batter strip** leads with the hitter's jersey number, then the name, where they are in the order and who follows, with the pitcher's number and pitch count on the right. A **last-play line** under it says what the last tap recorded (*#12 · Strikeout looking*, *Ball · 2-1*) and turns grey with *Undone* after an Undo. The **Lineup** screen is the batting order; positions show read-only and open the Field screen, and its header says *Saving… / ✓ Saved / Not saved yet — retrying* (a failed save retries on its own). **Mid-Inning goes up on its own** at the third out (not when that half ended the game), with a *Set field* shortcut; the next half's first pitch or play takes it down. **🧢 Field** on the bottom bar is a full-screen field of jersey numbers: tap a spot, tap the number playing there, and if that kid was somewhere else the two trade (a kid off the bench sends the one he replaces to the bench). **RUNNERS** (where Next batter was; Next batter moved to the Situation sheet) lists each runner with *Stole 2nd/3rd/home*, *Caught stealing*, *Picked off* and *To next · WP/PB*: the count and the batter stay — this, not OUT, is where a runner thrown out stealing goes, and the play sheet says so when anyone is on. If an out did push the order on when it shouldn't have, **◂ Previous batter** in the Situation sheet steps it back (the Situation sheet holds both arrows; they move the at-bat marker and record nothing). A third out here ends the half with the same batter leading off next inning, and the sheet stays open for a double steal. The bar under the keys is `1B | 2B | 3B | HR | HBP | E`: **HBP** is one tap (batter to 1st, forced runners up, the pitch counts); **E** asks which fielder made the error (*E6*, charged to the fielding team) and then where the runners ended up. Runs don't count on a third out made on the batter or by a force. Every play is one undoable event, and the overlay slides the play out from behind the bug with the hitter's name under it — the name looked up from the roster by lineup slot, since the row that triggers it is public.
- **Lineup screen** — tap the batter line under the count (it reads *No lineup yet — tap to set it* until there is one). One team at a time behind an Away/Home switch, opening on the team at bat. Every row is ◎ at-bat marker · ⋮⋮ order grip · # · name · the position that player is playing, read-only — tapping it opens the **🧢 Field** screen, which is the one place a defense is set. A field check above the list names the empty spots. Pitchers bat, so **P** is a spot on the diamond like the other eight, and editing the pitcher's row carries the pitcher with it. Saved teams load and save from the top of the screen.
- **A badge in the header says whether the pad agrees with its own event log** — green ✓ while the game rebuilt from its events matches what is on screen, ⚠ with the fields when it does not. Ignore it mid-game; it scores nothing and nothing depends on it. [What it is and why](#the-pad-checks-itself-against-its-own-log).
- **The lineup is held as data, not as what is on the screen.** A keystroke patches one field on one row, and the write follows a moment later (the header reads *Saving… / ✓ Saved / Not saved yet — retrying*, and a failed save retries on its own). The sheet is a view of that data and is always refilled, except for the one input under your finger. Each player carries an id, and the defense points at ids — so dragging someone from 7th to 2nd moves nobody on the field. Nothing an ordinary edit can do empties a team, so a write that would is refused with a warning and never sent; replacing a side means loading a saved team over it on purpose. Together these are why a lineup no longer scrambles or empties itself mid-game.
- The other sports use the same shell and keep their own scrolling pads until they get key sets of their own.
- **Support** — a Buy Me a Coffee button sits at the foot of the lobby, under Help & setup. It is the only place it appears; nothing on the live screen or in the drawer asks for anything.

State syncs control → Postgres → Realtime → overlay in ~250 ms. The overlay auto-reconnects and keeps last-known state on flaky networks (it never blanks mid-broadcast).

## Sports

Pick the sport when you create a game; the control panel and overlay both swap to that sport's controls and layout.

Every sport's pad follows the same split: the pad holds only what you tap during play and fits one phone screen; every correction (score ±, quarter/set ±, timeouts left, fouls ±, set target) and **🏁 End game** live in the **Situation** sheet, opened by tapping the bar under the score.

- **Baseball** — inning + ▲/▼, balls/strikes, outs, base diamond, R/H/E, line score. Smart logic: 4th ball auto-walks (force-advance confirm sheet), 3rd strike auto-outs, 3rd out rolls the half-inning. Multi-level **undo** backed by a Postgres event log (survives reloads/disconnects), capped at the newest 200 plays per game and snapshotting only the columns undo restores — the log used to grow for the life of the season.
- **Football** — quarter clock, down & distance (incl. *& Goal* / *1st & 10*), possession, timeouts. Scoring: TD +6, XP +1, 2-PT +2, FG +3, Safety +2, plus manual ± — score buttons credit the possession team and fire their stinger automatically. With nobody set they refuse and say so rather than picking a team: **Kickoff ⇄** or a possession button is how you tell the pad who has the ball.
- **Soccer** — count-up match clock + stoppage time, halves, goals (auto GOAL! celebration), yellow/red cards. **Half length** is the game's period length (Setup → Times & rules), so the second half starts at the right number — youth halves run 25, 30 or 35 minutes, and it used to be hardcoded to 45.
- **Volleyball** — rally scoring with serve tracking (serve follows the scorer), set targets 25/21/15 with auto set-win at target + 2-point lead, sets won + set number on the bug, ACE moment that scores for the serving team, manual End Set for time-capped sets. Winning a set resets the score for the next one in the same write, so the point that won it would never have reached the screen — the **SET WON 25–23** stinger calls it out instead.
- **Basketball** — +1/+2/+3 per team (+3 fires a THREE! stinger), period tracking, team fouls with NFHS bonus/double-bonus indicators (7/10), timeouts, countdown game clock per period.

## Scorebug styles

Selectable per game (default **Scorebox**):

- **Scorebox** — traditional full broadcast box: teams stacked with logo + runs, a large bases diamond, inning, and labeled **B / S / O** dot counts.
- **Bar** (wide strip) · **Bug** (stacked) · **Minimal** (slim) · **Lower-third** (accent tab) · **Ticker** (thin).

## Themes & customization

- **32 themes** (plus fully-custom): Midnight, Broadcast Minimal, Retro 8-bit, Classic Green, Neon, Sunset, Ice, Newsprint, Gold, Carbon, Vaporwave, Royal, Volt, Ember, Blueprint, Bubblegum, Cosmic, Sunrise, Jumbotron, CRT, Neon Sign, Chrome, Ticker, Outline, Stack — and the creative drop: **Chalkboard** (sandlot chalk), **Green Monster** (hand-painted manual board), **Marquee** (incandescent bulb ring), **Comic** (pop-art halftone), **Americana** (bunting ribbon), **Holo Foil** (refractor card), **Dugout** (vintage woodgrain).
- **Customize** (per game, on top of any theme): accent color, font, corner radius, logo size, border width, team color bars, and toggles for hide-logos / hide-detail / no-shadow / uppercase.
- **Position:** full 3×3 grid — {top, middle, bottom} × {left, center, right} — plus a scale slider.
- **Look presets:** save an entire look (theme + style + position + scale + sound + customize) under a name and one-tap apply it to any game.

## Moments & sound

- **Animations** fired from the control panel: run flash, full-screen **home run**, **K** stamp, double play, stolen base, walk-off, **touchdown**, field goal, turnover, big play, **GOAL!**, rally mode, and a manual bugle **Charge!**. Runs, strikeouts, and walks fire their stinger automatically when committed. GPU-friendly, alpha-transparent, safe mid-play; each auto-plays its matching sound.
- **Sound:** three synthesized packs (Big League / Modern / Sandlot — nothing sampled) played in the overlay so OBS captures them; master mute + per-category volume.

## Instant replay (OBS replay buffer)

A **🎞️ Clip** button on the control pad saves the OBS replay buffer, so a great play is on disk before anyone asks for it. **Auto-clip big plays** (opt-in per game) does it for you on a home run, walk-off, double play, big play, touchdown, or goal — the buffer is retroactive, so the clip covers the play you just watched while both thumbs were still on the scoring pad.

The pad can't talk to OBS directly (it runs on your phone), so it stamps `replay_cmd` on the game row; the overlay — which *is* a browser source inside OBS — sees it over Realtime and calls `window.obsstudio.saveReplayBuffer()`, then acks back. ✓ *Clip saved* means OBS fired its own `obsReplaybufferSaved` event, not merely that we asked — anything else says what actually went wrong.

**The clip waits for the celebration.** The buffer only reaches backward — a save at the swing ends while he's rounding second. So an auto-clip holds, then saves, and the buffer reaches back past the pitch: home run 40s, walk-off 60s, touchdown/goal 30s, big play 12s, double play 10s. The manual button is immediate; while a clip is counting down the button reads *Clip in 38s* and tapping it takes the clip right now. **Set your OBS replay buffer to 90 seconds** (Settings → Output) — it needs to cover the longest delay plus lead-in.

The wait lives in the overlay, not the pad: iOS throttles timers in a backgrounded browser, and OBS's browser source never sleeps.

The status line under the button is live: the overlay reports its permissions at load and pushes an update whenever OBS starts or stops the buffer, so **"replay buffer isn't running" shows up before first pitch**, not after the play you wanted.

Requires, in OBS: the replay buffer **enabled** (Settings → Output; Simple mode has an "Enable Replay Buffer" checkbox, Advanced mode a Replay Buffer tab) and **started**, plus the Scorebug source's **Page permissions** set to at least **"Basic access to OBS"** (they default to none). Settings → General → Output has "Automatically start replay buffer when streaming" so you never forget.

If the overlay runs as a browser source in more than one scene, add **`&replay=0`** to the extra copies — otherwise one press saves one clip per source.

## Recommended OBS settings

| Setting | Value | Why |
| --- | --- | --- |
| Video: base + output | 1920×1080 | The overlay is authored at 1080p |
| Video: FPS | **30** | Baseball is nearly still between pitches; 60 doubles encode + render work for little gain, and throttles fanless laptops |
| Stream encoder | **Hardware** (Apple VT / NVENC) | x264 is pure CPU and heat |
| Rate control | CBR, 6000 kbps, 2s keyframes | YouTube's 1080p30 range is 4500–9000 |
| **Recording encoder** | **"Same as stream"** | Anything else encodes the whole game a second time, continuously |
| Recording format | Hybrid MP4 or MKV | A crash won't corrupt the file |
| Replay buffer | **90 seconds** | Auto-clips wait up to 60s before saving and must still reach back past the pitch. ~70 MB of RAM at 6000 kbps |
| Browser source | 1920×1080, **FPS 30** | A browser source at 60 doubles the cost of every overlay animation |

**What actually costs performance,** largest first: each additional camera (a capture device decodes continuously whether or not its scene is on air — bigger than everything else combined); a software encoder; a separate recording encoder; 60 FPS anywhere; full-screen takeover cards *while one is on screen* (they animate continuously, so the source repaints every frame — they're up during breaks, never during live play). Everything else here — clips, scene switches, stream control, status — is idle until pressed, with no polling anywhere.

If a laptop struggles with two cameras, "Deactivate when not showing" on the capture devices means only the on-air camera decodes, at the cost of a visible beat on each cut. On a fanless machine, heat throttles before compute runs out: shade, airflow, wall power. Verify with OBS's Stats dock — watch frames missed due to **rendering** lag (the overlay) and **encoding** lag (the encoder).

## Not using OBS

An **OBS controls** switch at the top of the drawer's **OBS** tab hides `📡 Stream & record`, `🎥 Cameras`, the `🎞️ Replay` button on the bottom bar, and the auto-clip row. Scoring, cards, takeovers, moments, sound, sponsors, the overlay link and the recap are untouched — the overlay is a plain web page, so it works as a browser source in any streaming software or on a laptop wired to a screen.

Stored per device (`localStorage`), not per game: the same game may be run from an OBS laptop one night and a phone that has never seen OBS the next. Defaults to on, so nothing moves for anyone already set up.

## OBS access tiers

One dropdown — the overlay source's **Page permissions** — decides how much of OBS the pad may drive, and the app degrades cleanly across all four settings:

| Page permissions | Unlocks |
| --- | --- |
| **No access** (default) | Scorebug, cards, takeovers, moments, sound — the entire overlay |
| **Basic** | …plus 🎞️ Clip and auto-clip |
| **Advanced** | …plus 🎥 Cameras and starting/stopping the replay buffer |
| **Full** | …plus 📡 go live, end stream, and record |

The pad reads the level the overlay reports and adapts: a panel above your level gets a muted `needs advanced` tag, disabled buttons, and one line naming the setting to raise. **A locked feature reads as muted, never as a warning** — amber and red are reserved for things that are genuinely misconfigured, like a replay buffer that isn't running when you press Clip. Someone who only wants a scorebug should never see a complaint.

## Running the broadcast from the pad

**📡 Stream &amp; record** starts and stops the stream, the local recording, and the replay buffer. Every button reflects what OBS is actually doing rather than what was last pressed — the overlay reports on OBS's own streaming/recording/replay-buffer events, so a recording started at the machine lights up on the pad.

Stopping the stream or the recording **arms on the first tap and fires on the second** (auto-disarming after five seconds). No modal: a dialog would freeze the pad mid-broadcast, which is the same reason `commit()` toasts instead of alerting.

Needs **Page permissions: "Full access to OBS"** — `startStreaming` / `startRecording` are ALL. The buffer's start/stop are only ADVANCED, so at Advanced you get the buffer button and a note about the rest. A stale command can never re-fire on a source refresh: the overlay adopts whatever nonce is on the row at first paint and only acts on a strictly newer one.

## Camera switching

**🎥 Cameras** on the game screen lists your OBS scenes, highlights the one on air, and cuts to whichever you tap — through whatever transition OBS is set to. Switch at the OBS machine instead and the pad follows, because the overlay reports on OBS's own `obsSceneChanged` / `obsSceneListChanged` events rather than polling.

obs-browser has no show/hide for an individual source, so a camera change is a scene change: one scene per camera, and the **same** scorebug source shared into each via "Add Existing" (a duplicate browser source means two overlays — doubled audio and two files per clip; add `&obs=0` to any extra copy). Needs **Page permissions: "Advanced access to OBS"** — `setCurrentScene` is ADVANCED, one tier above the BASIC that clips need. At Basic the pad still lists the scenes (reading them is READ_USER) and tells you which setting to raise.

## Rosters are private

`games` has a public SELECT policy because the anonymous OBS browser source needs one — Realtime evaluates RLS for the subscriber, so locking reads down kills the overlay. That made every roster world-readable to anyone who had ever seen an overlay URL, permanently and unrevocably. Rosters are children's names.

So rosters moved to `scoreboard.rosters`, owner-only, with the roster's `token` stored **on that private row** — not on `games`, where anyone could read the key to the lock. The overlay reads through `get_roster(game, token)`, a `SECURITY DEFINER` function that returns `{}` for a wrong token; `rotate_overlay_token()` invalidates every link ever shared. `roster_rev` on `games` rides Realtime so the overlay knows when to re-pull what it can't subscribe to. The roster write and that bump are one RPC in one transaction, with the increment computed in the database — two devices editing lineups between innings used to compute the same number and lose one of them. And an overlay whose pull fails gives the revision back and retries with backoff, rather than recording it as fetched and leaving the lineup and defense cards empty for the rest of the game.

The token also gates the overlay's three write-backs — OBS status, the camera list, and the clip ack — because those are keyed on the game id, which is public: without the gate, anyone holding a recap link could spoof the pad's OBS panel mid-broadcast. Without `&t=` the overlay still runs the scorebug, cards, takeovers, moments and sound; what it loses is the lineup and defense cards (they show the out-of-date notice) plus everything under **OBS access tiers** below. Re-copy the overlay link from the control panel if an old URL is still in your Browser Source. `rotate_overlay_token()` revokes both at once. Verified: correct token returns the roster, wrong token returns `null` (and the lineup and defense cards then read *Overlay link is out of date — copy it again from the pad* instead of a team name over an empty list), the anon role cannot read `scoreboard.rosters` at all, and no roster names appear anywhere in the public `games` row.

What that public policy still costs, accepted deliberately: anyone can list every row in `games` — team names, abbreviations, logos, colours, scores, scheduled start times, sport, and the owner's user id. There is no way to close that at this shape, because Realtime's `postgres_changes` evaluates the policy as the anonymous subscriber and carries no header the overlay could prove itself with. The fix, if it ever becomes worth it, is to stop reading `games` anonymously at all: a `SECURITY DEFINER get_game(id)` for the initial paint, an `AFTER UPDATE` trigger re-streaming the row over a public Broadcast topic named for the game, and `games` dropped from the publication with the read policy narrowed to the owner. That is about a day, and it is a breaking change — every overlay already running in OBS goes dark until its Browser Source is reloaded, so it ships between games, never during one. Do it when something lands on the `games` row that you would not publish, or when enough overlays run at once that per-subscriber RLS evaluation starts costing real money. Until then the game id is the capability, and it is already handed to every parent with a recap link.

## Public recap page

`/recap?game=<id>` — a read-only scoreboard for parents: status, logos, score, line score, date. It updates live over the same Realtime channel while the game is on. It reads only the public row, so there is nothing private on it to leak.

Baseball games also get a **play-by-play**, one card per half-inning with the newest on top: *Groundout 6-3*, *Sac fly SF8 +1 run*, *Strikeout*, *Walk*. Every at-bat the pad records leaves a name-free note in its event payload, and `apply_event` copies it into `scoreboard.plays` in the same transaction; `undo` deletes it again, and Reset game clears them. The page reads them through `get_plays(game)` — a `SECURITY DEFINER` function in the `get_roster` mould, since the table has no public policy. The event log itself can't serve this: it is owner-only (every row holds a full games-row snapshot) and keeps only the newest 200 events, one per pitch. A play row holds the position and scorebook code and never who batted, so the public page shows what happened without naming a child.

## Sponsors

`💵 Sponsors` in the drawer's Look tab holds a list (name + optional logo) plus timing. With rotation on, the overlay shows a corner "brought to you by" bug every `every` seconds for `secs` seconds, cycling the list, and hides it whenever a takeover card is up.

## Broadcast cards

All of them live in **🎬 On Air** on the bottom bar: tap a card to raise it (the sheet closes behind it), tap it again or the header chip's ✕ to take it down. When the game is baseball the sheet outlines the likely card — Mid-Inning and Due Up at the top of a half, Starting Soon before first pitch.

Persistent cards that stay up until cleared: pre-game **Matchup** (logos + VS + subtitle), post-game **Final** (score + baseball line-score table), **Due Up** lower-third, and a **Sponsor** bumper.

**Takeover cards** own the whole 1920×1080 frame instead of floating over the video — opaque backdrop tinted with both team colors, scorebug hidden underneath. The camera keeps running behind them, so crowd noise carries through and you never touch an OBS scene.

They breathe: a slow accent-tinted flare drifts across on a 38s cycle with a faint sheen crossing every 20s, so a slate that sits up for minutes never reads as a frozen stream. Both live on `#card`'s pseudo-elements and animate only transform and opacity — GPU work that survives a card rebuilding its contents, and it honors `prefers-reduced-motion`.

- **🔁 Mid-Inning** — the full scoreboard while the teams change over: logos, big score, and the baseball line score. The header reads the game state, so raising it after the top of the 3rd says "Middle of the 3rd" and after the bottom says "End of the 3rd" (football/basketball get "End of Q2", soccer "Halftime"). It stays **live** while it's up — fix a score or roll the inning behind it and the card follows without re-animating.
- **🏁 Final (full)** — the same slab with a Final header. The corner Final card is unchanged; this is the full-frame version for the end of the broadcast.
- **🕐 Starting Soon** — both logos, VS, and a live countdown to first pitch. Set **Start time** in Setup to get the countdown (leave it empty and the card just shows the matchup); at zero it flips to "STARTING NOW". **Every new (or reset) game opens with it on air**, and it stays up until the game starts: starting the game clock or scoring the first play makes the game live and takes it down. Clear it by hand from On Air like any other card. Each sport gets its own scene — the field (diamond, gridiron, pitch, court, net) draws itself in behind, the ball turns behind VS, team colours sweep in from each side, and the countdown reads First pitch / Kickoff / Tip-off / First serve. Teams without a logo get a monogram in their colour; long names shrink to fit two lines so VS stays centred. The subtitle field retitles it — "Varsity Baseball", "Game 2 of 3".

## Game management

- **Game / time-limit clock:** start / pause / reset from the control panel (countdown for baseball/football, count-up for soccer).
- **Extras (toggle per game):** batter name/number, pitcher, pitch count, run-rule watch.
- **New game:** choose sport, then scorebug style.
- **Delete** a game (Setup — not the lobby list; a bin next to a row you scroll one-handed is one mis-tap from a permanent delete) and **Reset** a game to 0 (Setup — sport-aware; clears score/situation/clock/cards/undo, keeps teams + look).
- **Practice / Demo mode:** simulate a game and preview every animation + sound without going live.

## Stack

- Vanilla HTML/CSS/JS (ES modules) — nothing to compile, and **no runtime CDN**. `@supabase/supabase-js` is vendored at a pinned version under `js/vendor/`: it used to be imported from esm.sh, which put six third-party requests on the critical path of a browser source OBS starts at first pitch, and let a floating `@2` change mid-season. Upgrading is dropping in a new file (see that file's header) — still no build step and no lockfile.
- One font dependency: **Barlow Condensed** 500/600/700 for scores, counts and jersey numbers, self-hosted under `/fonts` (latin subset, ~22KB a weight, [SIL OFL 1.1](fonts/OFL.txt)). Self-hosted rather than hot-linked because the pad cold-loads on field LTE. Together with the vendored client, **every byte the app needs comes from its own origin** — the only network dependency at load is your Supabase project.
- Supabase project `PickEm` (`yeykyutsbeqjcgdxlucn`), schema **`scoreboard`** (tables `games`, `events`, `presets`; RPCs `apply_event`, `undo`, `server_now`; edge function `signup`).
- **One clock.** Nonces and both game clocks are instants one device writes and another reads, so they run on server time, not the writing device's: each page measures its offset from `server_now()` at load and corrects. Without it a phone 40s fast hands the overlay nonces from the future — a second pad's stingers and clips are then dropped in silence — and the same offset shows up on air as that much wrong game clock.
- **The write queue is its own module.** `js/sync.js` holds every durable write the pad makes — plays through `apply_event`, and direct row updates for setup, look, audio, sponsors and cards — in one FIFO that retries until the server takes it. It has no imports, touches no DOM and knows nothing about Supabase: everything arrives through an injected `io`, and `control.js` supplies it. That is what makes the path every score travels testable at all, since driving it in a browser needs a signed-in session and a dead network at the same moment. It is also where the cross-game bug lived — a write addressed to whatever game happened to be open when the network returned, rather than to the game it was made in.
- Per-user ownership via RLS; public read for overlays, owner-only writes. Presentation (theme/style/look/audio/card) syncs to the overlay via Realtime.
- Deploys as static files on Vercel (`cleanUrls` gives `/control` and `/overlay`).

## Run locally

No Node needed. Serve the folder over HTTP (ES modules won't load from `file://`):

```bash
python3 -m http.server 5173
```

- Control: <http://localhost:5173/control.html>
- Overlay preview: <http://localhost:5173/overlay.html?game=GAME_ID&debug=1>

`?debug=1` paints a checkerboard so you can see the transparent bug. The overlay is a **1920×1080** canvas — maximize the browser window (or it'll show only a corner). Locally, use the `.html` paths; on Vercel the clean `/overlay?game=…` works directly.

**Testing transparency locally:** open the overlay with `?debug=1` — anything drawn sits on a checkerboard, everything else is truly transparent. In OBS the checker is gone and only the bug/effects show over your camera.

**Testing audio locally:** browsers block autoplay until one click — click the overlay once (a "🔊 enable sound" chip appears) to unlock. OBS browser sources autoplay, so this isn't needed on the broadcast.

## OBS setup

The control panel carries its own copy of all of this — **Help &amp; setup** on the lobby screen, under the games list: four tiles for the topics people actually open (quick start, OBS setup, replay clips, troubleshooting) over the full fourteen. Keep it and this section in step.

1. **Sources → + → Browser.** Name it "Scorebug".
2. **URL:** `https://<your-app>.vercel.app/overlay?game=YOUR_GAME_ID`
   (Copy the exact URL from the control panel's Copy button after you open a game.)
3. **Width `1920`, Height `1080`**, FPS 30 (or 60).
4. Leave the default Custom CSS (the page is already transparent).
5. **Uncheck "Shutdown source when not visible"** — keeps the realtime connection alive between scenes.
6. **Page permissions: "Basic access to OBS"** — required for the 🎞️ Clip button to save the replay buffer. Leave it at the default if you don't want the overlay touching OBS.
7. **Audio:** check **"Control audio via OBS"** so the overlay's sounds go into your stream mix. Then in the Audio Mixer, set the source's Audio Monitoring to "Monitor and Output" if you also want to hear it in your headphones.
8. Position/scale the source in your scene. The bug also has its own 3×3 position grid and scale slider in the control panel, with a live preview showing where it lands on the frame — use whichever is easier per field.

## Platforms

The control panel is one responsive page tuned for three places it actually gets used:

- **iPhone** — the fixed shell above, big targets, safe-area insets on all four edges, no pull-to-refresh, no double-tap zoom, no text inflation in landscape. Add to Home Screen runs it full-screen. Held sideways the pad goes three keys across and two down and the drawer arrives from the right, keeping the keys visible behind it.
- **iPad** — two columns from 700px: scoring pad left, panels right, in either orientation. The drawer drops its sheet chrome here and is simply that panel column — same panel bodies, no fork. Split View falls back to one column on its own.
- **Desktop** — same two columns, wider from 1280px, with hover feedback gated behind `(hover: hover)` so a tap never leaves a stuck highlight on touch. Keyboard scoring: `B S F O` · `1 2 3 H` · `R` `E` `A` `C` `N` `U` — paused while a sheet is open, so a key never scores something the scrim is hiding.

Breakpoints are height-aware, not width-only: a phone on its side is 844 wide and 390 tall, so "phone" means short **or** narrow. Sheets centre and round on tablet and desktop instead of sitting on the bottom edge, and their Save/Close row is sticky — with ~390pt of height the actions can never be something you scroll to find. `prefers-reduced-motion` cross-fades the drawer and sheets instead of sliding them.

**It says what it does.** The toast is the app's only channel for `↶ Undone`, `🎞️ Clip saved` and every error — it deliberately never alerts — so it is mirrored into a live region and announced. The score header reads as a sentence ("Sanger 3, Blue Steel 2") rather than four adjacent numbers, and says itself when it changes, which is the confirmation a tap landed for an operator who cannot see the number move. The situation bar is dots and a diamond, which is shape rather than text, so the button around it carries the words: "Bottom of the 9th, 3 balls, 2 strikes, 2 outs, runners on first and third."

**Sheets behave like dialogs.** Focus moves into one when it opens and back to whatever opened it when it closes, Tab cycles inside and cannot leave, Escape and a tap on the scrim close it, and the scoring shortcuts pause while one is up — the HR and Walk sheets appear during a live at-bat, and a key that fired through the scrim scored a play you could not see. Escape on a sheet that has unsaved edits asks the same question Cancel does. They are `role="dialog"` divs rather than `<dialog>`: `showModal()` is iOS 15.4+, the same floor the layout declines to build on for `:has()`, and an unsupported `showModal` leaves a sheet unopenable rather than merely unpolished.

## Checks

`node scripts/check.mjs` — syntax on every module, every `$('id')` against the markup it belongs to, a manifest of handlers that must stay wired, and calls to functions defined nowhere.

`node --test scripts/*.test.mjs` — **232 tests**, no dependencies, since `node --test` is built in like everything else here.

**The rules** (`logic.test.mjs`, `sports.test.mjs`): runner advancement on every kind of hit, the batting order wrapping and skipping empty slots, which pitcher a pitch is charged to, the line-score cell a run lands in, the half-inning rolling, the walk force-advance table, walk-offs, the offline-undo replay, and all four other sports (drive flips and safeties, the soccer clock pausing and resuming, volleyball deuce and set targets, the basketball bonus reading the *opponent's* fouls).

**The event log** (`subject.test.mjs`, `replay.test.mjs`): that every event names who it was about, and that a game rebuilt from its own log comes back identical to the one the pad played. The first suite walks *every* exported action and fails if any of them produces an event belonging to nobody — the guard against the next key forgetting, which is how an out on a runner and an out on the batter became the same row in the first place. The second plays half-innings through the actions, folds the events back, and asserts the two agree field by field; it also asserts every event type the pad can write has a rebuild, so the badge below cannot quietly read *partial* forever.

**The write queue** (`sync.test.mjs`): the path every score travels, and until it moved into `js/sync.js` the least covered code here — exercising it in a browser needs a signed-in session and a dead network at the same time. The queue takes all of its effects through an injected `io`, so the suite drives what a field connection actually does to it: writes draining in order, each addressed to its own game rather than to whatever is open when the network returns, a stinger dropped once it is older than the play it belonged to, a rejection that holds the queue and says so once rather than on every retry, the baseline a local undo replays from advancing on each accepted write, and a drain that is safe to call from the four different places that call it.

Both run on push via `.github/workflows/check.yml`.

It exists because v3.23 shipped with the entire Game setup section deleted — a text-range replacement whose end marker sat past the intended block. Syntax was valid, the deploy was green, and Setup, Save, Delete game and Reset game were dead in production for four versions. Re-run against that commit and it names all five dead controls plus the orphaned `fillSetup()` call.

## The pad checks itself against its own log

Every event the pad writes now names **who it was about** — `batter`, `runner@first/second/third`, `runners`, or `game` for a correction or an inning move. It is attached in one place, in `commit()`, so a key added later cannot write an event that belongs to nobody, and a test walks every action to keep it that way.

That field is the fix for the bug this suite kept having. An out on a runner and an out on the batter were the same row in `events` all season: both said *an out happened* and neither said *to whom*. Only a terminal **batter** event ends a plate appearance, so a caught stealing recorded through `OUT` took the hitter's at-bat away and left the batting order a spot ahead for the rest of the game. The pad learned the difference in v3.86 by routing the tap; v3.89 writes it down, where something other than the operator's memory can enforce it.

**The badge** in the game header is the second half. The pad rebuilds the game from its own event log — `L.replay` folds the events, re-running the same actions with the arguments each one recorded — and `L.compareGames` reports where that answer differs from the row on screen:

- **✓** the rebuild of every event matches the pad exactly
- **≈** it matches everything it could replay, and says what it could not
- **⚠ n** it disagrees, naming the fields; tap for the first one, or read the console for all of them

It writes nothing, the scorebug takes nothing from it, and a failure inside it goes grey and stays quiet — it is a check on the model, not a scoring control. It runs when a game opens and once about twenty seconds after the taps stop, so it costs one query rather than one per pitch on venue LTE.

Two deliberate properties. The fold **does not reimplement the rules**: it re-runs the actions in `js/logic.js`, so there is one set of baseball rules here and both callers use it — a second implementation would only be a second place to be wrong. And it **starts from a snapshot, not from the first pitch**: the log keeps the newest 200 events per game, but every event stores the row as it was before it, so the fold starts at the oldest snapshot still held and folds forward. Rosters never ride in a snapshot, so the lineups are handed in separately.

An event it cannot rebuild is counted and skipped, never guessed — a fold that quietly ignored a third of a game would agree with anything. Games played before v3.89 read ⚠ or ≈ forever, because their events predate the arguments the fold needs; that is the honest answer rather than a bug.

The badge is evidence being gathered, not a feature. If it stays ✓ through real games, the fold can become the record: corrections become edits to the log that everything after re-derives from, and the hand-written inverses — *Previous batter*, the count and outs steppers, the half flip, the R/H/E nudges — stop needing to exist.

## Offline scoring

The pad's writes go through a queue. A failed write no longer rolls the score back with a toast — the optimistic state stands, the write joins a FIFO, and the queue drains in order when the network returns (on `online`, on tab focus, on realtime resubscribe, and on a 4s retry). A badge in the game header shows how many changes are waiting.

While anything is queued the pad ignores incoming realtime rows and skips the heal-on-reconnect refetch: the server is behind the pad at that moment, and adopting its row would rewind a score you've already moved past. The authoritative row is taken only once the queue empties. Closing the tab with unsaved scoring warns first — the queue is deliberately memory-only, since replaying stale absolute patches over a reloaded state is worse than losing them. Backing out to the lobby and logging out ask the same question.

**If the login expires**, every write becomes a 401 and no amount of retrying will help. The pad used to keep trying every four seconds forever, with a `⏳` badge counting up as the only sign anything was wrong. Now the queue stops, a banner says so and does not go away, and logging back in returns you to the same game and sends what was waiting — the optimistic state and the queue are both kept, so nothing scored is lost.

## Deploy (Vercel)

Push to `main` → Vercel auto-deploys. Framework preset **Other**, no build command, root output. `js/config.js` holds the Supabase URL + publishable key (safe in client code — RLS protects the data).

## Auth (username + PIN)

Usernames map to an internal synthetic email; the PIN is the password. Signup goes through the `signup` Edge Function (creates a pre-confirmed account with the service role), so there's no email verification and no secret in the browser. Each user owns and only sees their own games and presets.

**PINs are 6–8 digits.** Four was 10,000 combinations against a short, guessable username, for an app holding children's rosters. Accounts created with a four-digit PIN still log in — only creation is checked. The endpoint is `verify_jwt=false` with open CORS by necessity (a new user has no JWT), which also made it a free account-creation endpoint for anyone who found it, so it now counts attempts per address and refuses more than five an hour.
