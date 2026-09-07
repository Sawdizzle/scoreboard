# Migrations

The Supabase project (`yeykyutsbeqjcgdxlucn`) has always tracked migrations
remotely; this directory is where the `scoreboard` schema's own migrations are
kept from now on, so the data layer is reproducible from the repo rather than
only from the hosted project.

Earlier scoreboard migrations (`20260812225438_live_scoreboard` through
`20260820040959_move_overlay_token_off_public_row`) exist only in the remote
history. To backfill them:

```bash
supabase link --project-ref yeykyutsbeqjcgdxlucn
supabase db pull --schema scoreboard
```
