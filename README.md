# Broadcast Scoreboard

A live, phone-controlled **multi-sport** scoreboard overlay suite for OBS. Two static pages backed by Supabase (Postgres + Realtime + Auth), no build step.

- **`/overlay`** — transparent OBS Browser Source (1920×1080). Display-only.
- **`/control`** — phone-first control panel. Username + PIN login. Writes game state.

**Install on your phone:** open `/control` in Safari → Share → **Add to Home Screen**. It launches full-screen like a native app (no browser chrome, no accidental pull-to-refresh). On an iPad it lays out as two columns: live controls left, panels right.

State syncs control → Postgres → Realtime → overlay in ~250 ms. The overlay auto-reconnects and keeps last-known state on flaky networks (it never blanks mid-broadcast).

## Sports

Pick the sport when you create a game; the control panel and overlay both swap to that sport's controls and layout.

- **Baseball** — inning + ▲/▼, balls/strikes, outs, base diamond, R/H/E, line score. Smart logic: 4th ball auto-walks (force-advance confirm sheet), 3rd strike auto-outs, 3rd out rolls the half-inning. Multi-level **undo** backed by a Postgres event log (survives reloads/disconnects).
- **Football** — quarter clock, down & distance (incl. *& Goal* / *1st & 10*), possession, timeouts. Scoring: TD +6, XP +1, 2-PT +2, FG +3, Safety +2, plus manual ± — score buttons credit the possession team and fire their stinger automatically.
- **Soccer** — count-up match clock + stoppage time, halves, goals (auto GOAL! celebration), yellow/red cards.
- **Volleyball** — rally scoring with serve tracking (serve follows the scorer), set targets 25/21/15 with auto set-win at target + 2-point lead, sets won + set number on the bug, ACE moment that scores for the serving team, manual End Set for time-capped sets.
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

## Broadcast cards

Persistent cards that stay up until cleared: pre-game **Matchup** (logos + VS + subtitle), post-game **Final** (score + baseball line-score table), **Due Up** lower-third, and a **Sponsor** bumper.

**Takeover cards** own the whole 1920×1080 frame instead of floating over the video — opaque backdrop tinted with both team colors, scorebug hidden underneath. The camera keeps running behind them, so crowd noise carries through and you never touch an OBS scene.

They breathe: a slow accent-tinted flare drifts across on a 38s cycle with a faint sheen crossing every 20s, so a slate that sits up for minutes never reads as a frozen stream. Both live on `#card`'s pseudo-elements and animate only transform and opacity — GPU work that survives a card rebuilding its contents, and it honors `prefers-reduced-motion`.

- **🔁 Mid-Inning** — the full scoreboard while the teams change over: logos, big score, and the baseball line score. The header reads the game state, so raising it after the top of the 3rd says "Middle of the 3rd" and after the bottom says "End of the 3rd" (football/basketball get "End of Q2", soccer "Halftime"). It stays **live** while it's up — fix a score or roll the inning behind it and the card follows without re-animating.
- **🏁 Final (full)** — the same slab with a Final header. The corner Final card is unchanged; this is the full-frame version for the end of the broadcast.
- **🕐 Starting Soon** — both logos, VS, and a live countdown to first pitch. Set **First pitch** in Setup to get the countdown (leave it empty and the card just shows the matchup); at zero it flips to "STARTING NOW" and stays up until you clear it or raise another card. The subtitle field retitles it — "Varsity Baseball", "Game 2 of 3".

## Game management

- **Game / time-limit clock:** start / pause / reset from the control panel (countdown for baseball/football, count-up for soccer).
- **Extras (toggle per game):** batter name/number, pitcher, pitch count, run-rule watch.
- **New game:** choose sport, then scorebug style.
- **Delete** a game (lobby trash button or Setup) and **Reset** a game to 0 (Setup — sport-aware; clears score/situation/clock/cards/undo, keeps teams + look).
- **Practice / Demo mode:** simulate a game and preview every animation + sound without going live.

## Stack

- Vanilla HTML/CSS/JS (ES modules), `@supabase/supabase-js` via ESM CDN — nothing to compile.
- Supabase project `PickEm` (`yeykyutsbeqjcgdxlucn`), schema **`scoreboard`** (tables `games`, `events`, `presets`; RPCs `apply_event`, `undo`; edge function `signup`).
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

The control panel carries its own copy of all of this — **Help &amp; setup** on the lobby screen, under the games list: quick start, browser source settings, replay-clip setup, cards, and troubleshooting. Keep it and this section in step.

1. **Sources → + → Browser.** Name it "Scorebug".
2. **URL:** `https://<your-app>.vercel.app/overlay?game=YOUR_GAME_ID`
   (Copy the exact URL from the control panel's Copy button after you open a game.)
3. **Width `1920`, Height `1080`**, FPS 30 (or 60).
4. Leave the default Custom CSS (the page is already transparent).
5. **Uncheck "Shutdown source when not visible"** — keeps the realtime connection alive between scenes.
6. **Page permissions: "Basic access to OBS"** — required for the 🎞️ Clip button to save the replay buffer. Leave it at the default if you don't want the overlay touching OBS.
7. **Audio:** check **"Control audio via OBS"** so the overlay's sounds go into your stream mix. Then in the Audio Mixer, set the source's Audio Monitoring to "Monitor and Output" if you also want to hear it in your headphones.
8. Position/scale the source in your scene. The bug also has its own 3×3 position grid and scale slider in the control panel — use whichever is easier per field.

## Platforms

The control panel is one responsive page tuned for three places it actually gets used:

- **iPhone** — one column, big targets, safe-area insets on all four edges (landscape included), no pull-to-refresh, no double-tap zoom, no text inflation in landscape. Add to Home Screen runs it full-screen.
- **iPad** — two columns from 700px: scoring pad left, panels right, in either orientation. Split View falls back to one column on its own.
- **Desktop** — same two columns, wider from 1280px, with hover feedback gated behind `(hover: hover)` so a tap never leaves a stuck highlight on touch. Keyboard scoring: `B S F O` · `1 2 3 H` · `R` `E` `A` `C` `N` `U`.

Sheets centre and round on tablet and desktop instead of sitting on the bottom edge, and their Save/Close row is sticky — a phone in landscape has ~390pt of height, so the actions can never be something you scroll to find.

## Checks

`node scripts/check.mjs` — syntax on every module, every `$('id')` against the markup it belongs to, a manifest of handlers that must stay wired, and calls to functions defined nowhere. It runs on push via `.github/workflows/check.yml`.

It exists because v3.23 shipped with the entire Game setup section deleted — a text-range replacement whose end marker sat past the intended block. Syntax was valid, the deploy was green, and Setup, Save, Delete game and Reset game were dead in production for four versions. Re-run against that commit and it names all five dead controls plus the orphaned `fillSetup()` call.

## Offline scoring

The pad's writes go through a queue. A failed write no longer rolls the score back with a toast — the optimistic state stands, the write joins a FIFO, and the queue drains in order when the network returns (on `online`, on tab focus, on realtime resubscribe, and on a 4s retry). A badge in the game header shows how many changes are waiting.

While anything is queued the pad ignores incoming realtime rows and skips the heal-on-reconnect refetch: the server is behind the pad at that moment, and adopting its row would rewind a score you've already moved past. The authoritative row is taken only once the queue empties. Closing the tab with unsaved scoring warns first — the queue is deliberately memory-only, since replaying stale absolute patches over a reloaded state is worse than losing them.

## Deploy (Vercel)

Push to `main` → Vercel auto-deploys. Framework preset **Other**, no build command, root output. `js/config.js` holds the Supabase URL + publishable key (safe in client code — RLS protects the data).

## Auth (username + PIN)

Usernames map to an internal synthetic email; the PIN is the password. Signup goes through the `signup` Edge Function (creates a pre-confirmed account with the service role), so there's no email verification and no secret in the browser. Each user owns and only sees their own games and presets.
