# Broadcast Scoreboard

Live, phone-controlled baseball scorebug overlays for OBS. Two static pages backed by Supabase (Postgres + Realtime + Auth), no build step.

- **`/overlay`** — transparent OBS Browser Source (1920×1080). Display-only.
- **`/control`** — phone-first control panel. Username + PIN login. Writes game state.

State syncs control → Postgres → Realtime → overlay in ~250ms. The overlay auto-reconnects and keeps last-known state on flaky networks (it never blanks mid-broadcast).

## Features

- **Scorebug:** score, inning + top/bottom arrow, balls/strikes, outs, base diamond, team names/abbr/logos/colors, R line.
- **Smart control:** 4th ball auto-walks (with a force-advance confirm sheet), 3rd strike auto-outs, 3rd out rolls the half-inning. Multi-level **undo** backed by a Postgres event log (survives reloads/disconnects).
- **Moments:** run flash, full-screen **home run**, **K** stamp, double play, web gem, stolen base, walk-off, **rally mode**, and a manual bugle **Charge!**. Fired from the control panel, GPU-friendly, alpha-transparent, safe mid-play.
- **Sound:** three synthesized packs (Big League / Modern / Sandlot) played in the overlay so OBS captures them; master mute + per-category volume.
- **Themes:** Midnight (default), Broadcast Minimal, Retro 8-bit, Classic Green. Selectable per game. Scorebug position (bottom / top / top-left) and scale.
- **Time-limit clock:** countdown for select-ball time limits; start / pause / reset from the control panel.
- **Extras (toggle per game):** batter name/number, pitcher, pitch count, run-rule watch.
- **Practice / Demo mode:** simulate a game and preview every animation + sound without going live.

## Stack

- Vanilla HTML/CSS/JS (ES modules), `@supabase/supabase-js` via ESM CDN — nothing to compile.
- Supabase project `PickEm` (`yeykyutsbeqjcgdxlucn`), schema **`scoreboard`** (tables `games`, `events`; RPCs `apply_event`, `undo`; edge function `signup`).
- Per-user ownership via RLS; public read for overlays, owner-only writes.
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
7. Position/scale the source in your scene. The bug also has its own position (bottom/top/top-left) and scale slider in the control panel — use whichever is easier per field.

## Deploy (Vercel)

Push to `main` → Vercel auto-deploys. Framework preset **Other**, no build command, root output. `js/config.js` holds the Supabase URL + publishable key (safe in client code — RLS protects the data).

## Auth (username + PIN)

Usernames map to an internal synthetic email; the PIN is the password. Signup goes through the `signup` Edge Function (creates a pre-confirmed account with the service role), so there's no email verification and no secret in the browser.
