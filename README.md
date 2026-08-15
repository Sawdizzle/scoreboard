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

## Broadcast cards

Persistent cards that stay up until cleared: pre-game **Matchup** (logos + VS + subtitle), post-game **Final** (score + baseball line-score table), **Due Up** lower-third, and a **Sponsor** bumper.

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

1. **Sources → + → Browser.** Name it "Scorebug".
2. **URL:** `https://<your-app>.vercel.app/overlay?game=YOUR_GAME_ID`
   (Copy the exact URL from the control panel's Copy button after you open a game.)
3. **Width `1920`, Height `1080`**, FPS 30 (or 60).
4. Leave the default Custom CSS (the page is already transparent).
5. **Uncheck "Shutdown source when not visible"** — keeps the realtime connection alive between scenes.
6. **Audio:** check **"Control audio via OBS"** so the overlay's sounds go into your stream mix. Then in the Audio Mixer, set the source's Audio Monitoring to "Monitor and Output" if you also want to hear it in your headphones.
7. Position/scale the source in your scene. The bug also has its own 3×3 position grid and scale slider in the control panel — use whichever is easier per field.

## Deploy (Vercel)

Push to `main` → Vercel auto-deploys. Framework preset **Other**, no build command, root output. `js/config.js` holds the Supabase URL + publishable key (safe in client code — RLS protects the data).

## Auth (username + PIN)

Usernames map to an internal synthetic email; the PIN is the password. Signup goes through the `signup` Edge Function (creates a pre-confirmed account with the service role), so there's no email verification and no secret in the browser. Each user owns and only sees their own games and presets.
