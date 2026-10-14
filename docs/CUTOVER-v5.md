# Switching prod to v5.0

v5 is built and tested on the `v5` branch's preview. Prod
(scoreboard-ashen-rho.vercel.app) runs v4.47 until `v5` is merged into `main`.
Pick a day with no game; a switch mid-weekend means scoring a game on a pad
nobody has used live.

## Before the merge

1. **Score a practice game on the preview, end to end**, with OBS pointed at the
   preview's stream link: pitches, an in-play, Undo, a moment, Starting Soon, a
   pause, a replay save, the end of the game. Then Start over (or delete it).
2. **Logos**: re-upload the Blue Steel and Krum logos on Team look (they still
   point at the Pressbox project's Storage).
3. **v4 games played since the import**: in the Supabase SQL editor, run
   `supabase/data/v4-resync.sql`, then `supabase/data/2026-10-14-v4-games.sql`.
   Check the team page: every v4 game, with the right score.
4. **Supabase → Authentication → URL Configuration**: Site URL
   `https://scoreboard-ashen-rho.vercel.app`; Redirect URLs include
   `https://scoreboard-ashen-rho.vercel.app/**` (keep the preview's too).
5. **Vercel**: `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
   are set for Production (done 2026-10-14). The branch's `vercel.json` switches
   the build to Next.js; nothing to change in the project settings.

## The merge

```
git checkout main && git pull --ff-only
git merge --no-ff v5 -m "v5.0: Scoreboard, rebuilt around the team"
npm ci && npm test && npm run typecheck && npm run lint && npm run build
git push origin main
git tag -a v5.0.0 -m "v5.0.0" && git push origin v4.47 v5.0.0
```

## Right after

1. Open `https://scoreboard-ashen-rho.vercel.app/control`: it lands on your
   teams. OBS's Browser Source (the old `/overlay?ch=…` link) shows the Blue
   Steel stream without being touched.
2. GitHub: the release `v5.0.0` with `docs/release-notes-v5.0.md` as its body;
   the repo description and topics (no longer "static, no build"):
   ```
   gh repo edit Sawdizzle/scoreboard --description "Score youth games once on your phone: the live-stream scorebug, team stats and public game pages come from the same taps." --remove-topic no-build --remove-topic vanilla-javascript --remove-topic static-site --add-topic nextjs --add-topic supabase --add-topic obs --add-topic live-streaming
   gh release create v5.0.0 --title "v5.0" --notes-file docs/release-notes-v5.0.md
   ```
3. Archive the Pressbox repo (its history lives here now):
   `gh repo archive Sawdizzle/pressbox`, and pause the Pressbox Supabase project.
4. Optional: switch on the sign-up invite code (README, Get your own, step 5).

## If something goes wrong on game day

Roll back in Vercel (Deployments → the last v4.47 production build → Promote).
v4's tables are untouched by v5, so v4 picks up where it was; plays scored in
v5 in the meantime stay in v5.
