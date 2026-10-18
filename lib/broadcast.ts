// How the stream looks and sounds beyond the scorebug itself, and the one-shot
// commands the pad sends it. Stored on the channel (broadcast, cmd) and the
// game (clock, settings); see supabase/migrations/*_v5_broadcast.sql. Every
// reader takes these defensively: any key may be missing.

// What the pad reads of the team's stream channel. Here, not beside the pad's
// components: those are client modules, and a server page that imports a
// value from one gets a reference to it, not the value.
export const CHANNEL_COLS = 'token, game_id, show_line, auto_card, auto_mid, card, sponsor_name, bug_url, qr, broadcast, look';

// The game clock. A countdown runs to ends_at while running and holds
// `remaining` while stopped; a count-up (soccer) is base seconds plus the time
// since `since` while running.
export type Clock = {
  mode: 'down' | 'up';
  running: boolean;
  ends_at?: string | null;
  remaining?: number | null;
  base?: number;
  since?: string | null;
};

// Per-game rules the pad and the stream read.
export type GameSettings = {
  time_limit?: number | null;  // baseball: seconds, the drop-dead clock
  run_rule?: number | null;    // baseball: a lead this big ends the game
  regulation?: number | null;  // baseball: innings
  period_minutes?: number | null; // football, basketball, soccer half
};

export type Scene = {
  kind: 'starting' | 'final' | 'paused';
  title?: string;          // Starting Soon's line ("Game starting soon"), or the Final's
  reason?: 'lightning' | 'rain' | 'weather' | 'suspended' | 'called'; // why play is paused
  at?: string | null;      // what a countdown runs to: a restart time (paused)
  since?: string | null;   // when that countdown was set, so the stream can show how much of it is left
};

export type Broadcast = {
  theme?: string;          // v4 themes, plus 'custom'
  style?: string;          // scorebox, bar, bug, minimal ... (the classic layouts)
  custom?: Record<string, string | number | boolean>;
  sound?: { pack?: string; muted?: boolean; master?: number; moments?: number; organ?: number };
  show?: { clock?: boolean; batter?: boolean; pitcher?: boolean; pitchcount?: boolean; rhe?: boolean; runrule?: boolean };
  rally?: boolean;         // the ambient rally glow
  scene?: Scene | null;    // a full-screen scene up now
  scene_style?: 'standard' | 'elevated';
  ticker?: { on?: boolean; text?: string; tone?: 'notice' | 'alert' };
  sponsors?: { on?: boolean; items?: { name: string; logo?: string | null }[]; every?: number };
  // clip_kinds: which moments auto-clip saves (lib/clips.ts); unset is the default set.
  obs?: { auto_clip?: boolean; clip_kinds?: string[]; replay_seconds?: number; cameras?: string[] };
  // A pregame blurb on Starting Soon: written on request (app/api/ai/blurb),
  // put up only when the operator taps Use, and shown only for its own game.
  blurb?: Blurb;
  // The mid-inning board taken down by hand ("Back to scorebug" on the pad):
  // the game and the play it stood for. It stays down until the next half ends.
  mid_off?: { game: string; seq: number };
};
export type Blurb = { game_id: string; line1: string; line2: string; storyline: string };

// A change to the broadcast settings: keys merge in, a key set to null goes.
export type BroadcastPatch = { [K in keyof Broadcast]?: Broadcast[K] | null };
// The same merge set_broadcast does, for showing a change before it is saved.
export const mergeBroadcast = (b: Broadcast | null | undefined, patch: BroadcastPatch): Broadcast =>
  Object.fromEntries(Object.entries({ ...(b ?? {}), ...patch }).filter(([, v]) => v !== null && v !== undefined)) as Broadcast;

// A one-shot command. `n` is the server's stamp: the stream acts once per n.
export type Cmd = { type: string; kind?: string; n: number } & Record<string, unknown>;

export const clockSeconds = (c: Clock | null | undefined, now = Date.now()): number | null => {
  if (!c) return null;
  if (c.mode === 'up') {
    const since = c.running && c.since ? (now - Date.parse(c.since)) / 1000 : 0;
    return Math.max(0, Math.floor((c.base ?? 0) + since));
  }
  if (c.running && c.ends_at) return Math.max(0, Math.ceil((Date.parse(c.ends_at) - now) / 1000));
  return Math.max(0, Math.round(c.remaining ?? 0));
};

export const clockText = (s: number | null) => {
  if (s == null) return '';
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
};

// Start, stop and set, returning the clock to store.
export function clockStart(c: Clock, now = Date.now()): Clock {
  if (c.running) return c;
  if (c.mode === 'up') return { ...c, running: true, since: new Date(now).toISOString() };
  return { ...c, running: true, ends_at: new Date(now + (c.remaining ?? 0) * 1000).toISOString() };
}
export function clockStop(c: Clock, now = Date.now()): Clock {
  if (!c.running) return c;
  const s = clockSeconds(c, now) ?? 0;
  return c.mode === 'up' ? { ...c, running: false, base: s, since: null } : { ...c, running: false, remaining: s, ends_at: null };
}
export const clockSet = (mode: Clock['mode'], seconds: number): Clock =>
  mode === 'up' ? { mode, running: false, base: seconds, since: null } : { mode, running: false, remaining: seconds, ends_at: null };
