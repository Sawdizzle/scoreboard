# Broadcast Scoreboard

Live, phone-controlled baseball scorebug overlays for OBS. Two static pages backed by Supabase (Postgres + Realtime + Auth), no build step.

- **`/overlay`** — transparent OBS Browser Source (1920×1080). Display-only.
- **`/control`** — phone-first control panel. Username + PIN login. Writes game state.

State syncs control → Postgres → Realtime → overlay in ~250ms. Overlay auto-reconnects and keeps last-known state on flaky networks.

## Stack

- Vanilla HTML/CSS/JS (ES modules), `@supabase/supabase-js` via ESM CDN — nothing to compile.
- Supabase project `PickEm` (`yeykyutsbeqjcgdxlucn`), schema **`scoreboard`** (tables `games`, `events`).
- Per-user ownership via RLS; public read for overlays, owner-only writes.
- Deploys as static files on Vercel (`cleanUrls` gives `/control` and `/overlay`).

## Run locally

No Node needed. Serve the folder over HTTP (ES modules won't load from `file://`):

```bash
python3 -m http.server 5173
```

Then open:

- Control: <http://localhost:5173/control.html>
- Overlay preview: <http://localhost:5173/overlay.html?debug=1>

`?debug=1` paints a backdrop so you can see the transparent bug locally. Real transparency is verified in OBS (Stage 7).

## Deploy (Vercel)

1. Push this folder to a GitHub repo.
2. Import the repo in Vercel. Framework preset: **Other**. No build command, output = repo root.
3. Deploy. You get `https://<project>.vercel.app/control` and `/overlay`.

## Config

`js/config.js` holds the Supabase URL and publishable key. The publishable key is safe in client code — Row Level Security protects the data.

## Auth (username + PIN)

Usernames map to an internal synthetic email; the PIN is the password. Signup goes through the `signup` Edge Function (creates a pre-confirmed account with the service role), so there's no email verification and no secret in the browser.
