// Auto-clips: which moments save OBS's replay buffer, how long after the moment
// the save waits (the buffer only holds the past, so it waits for the trot and
// the celebration), and how moments close together become one clip. The
// overlay (components/overlay/ObsBridge.tsx) runs this; the pad picks the
// kinds; the game page lists what was saved.
import { ordinal } from './onair.ts';

export type ClipKind = { key: string; label: string; delay: number; on: boolean; sports?: string[] };

// `on` is the default for a team that never picked. These were the kinds
// auto-clip always saved; the rest are new and start off.
export const CLIP_KINDS: ClipKind[] = [
  { key: 'homerun', label: 'Home runs', delay: 40000, on: true, sports: ['baseball'] },
  { key: 'walkoff', label: 'Walk-offs', delay: 60000, on: true, sports: ['baseball'] },
  { key: 'doubleplay', label: 'Double plays', delay: 10000, on: true, sports: ['baseball'] },
  { key: 'bigplay', label: 'Big plays', delay: 12000, on: true },
  { key: 'run', label: 'Runs scored', delay: 12000, on: false, sports: ['baseball'] },
  { key: 'strikeout', label: 'Strikeouts', delay: 6000, on: false, sports: ['baseball'] },
  { key: 'stolenbase', label: 'Stolen bases', delay: 8000, on: false, sports: ['baseball'] },
  { key: 'touchdown', label: 'Touchdowns', delay: 30000, on: true, sports: ['football'] },
  { key: 'goal', label: 'Goals', delay: 30000, on: true, sports: ['soccer'] },
];
const BY_KEY = new Map(CLIP_KINDS.map((k) => [k.key, k]));
// The kinds a sport's pad can pick from (big plays are tapped in On Air, any sport).
export const kindsFor = (sport: string) => CLIP_KINDS.filter((k) => !k.sports || k.sports.includes(sport));
export const DEFAULT_CLIP_KINDS = CLIP_KINDS.filter((k) => k.on).map((k) => k.key);

// Moments heard within this long of the first one in a clip join it.
export const MERGE_MS = 8000;
// The longest a save may wait, whatever the kinds say.
export const MAX_DELAY_MS = 180000;

export const clipDelay = (kind: string) => BY_KEY.get(kind)?.delay ?? 0;
export const clipLabel = (kind: string) => (kind === 'manual' ? 'Saved from the pad' : BY_KEY.get(kind)?.label.replace(/s$/, '') ?? kind);
export const wantClip = (kind: string, picked: string[] | undefined) => BY_KEY.has(kind) && (picked ?? DEFAULT_CLIP_KINDS).includes(kind);

// A clip waiting to be saved: when its first moment was heard, when it saves,
// and every kind it holds (the main one is the one that waits longest).
export type Pending = { n: number; first: number; fireAt: number; kinds: string[] };

// A new moment at `at`: join the pending clip when it is close enough to that
// clip's first moment (the save then waits for whichever ends later), or start
// a new one. Returns the clip to arm and whether it is the same one.
export function joinClip(pending: Pending | null, kind: string, at: number): { clip: Pending; merged: boolean } {
  const fireAt = at + Math.min(clipDelay(kind), MAX_DELAY_MS);
  if (pending && at - pending.first <= MERGE_MS && at <= pending.fireAt) {
    const kinds = pending.kinds.includes(kind) ? pending.kinds : [...pending.kinds, kind];
    return { clip: { ...pending, fireAt: Math.max(pending.fireAt, fireAt), kinds }, merged: true };
  }
  return { clip: { n: at, first: at, fireAt, kinds: [kind] }, merged: false };
}
export const mainKind = (kinds: string[]) => [...kinds].sort((a, b) => clipDelay(b) - clipDelay(a))[0] ?? 'clip';

// "Top 3rd · Home run · 4-2" (away first, as a scorebug reads).
export function clipText(c: Pick<ClipRow, 'kind' | 'inning' | 'half' | 'away_score' | 'home_score'>) {
  const when = c.inning ? `${c.half === 'bottom' ? 'Bottom' : 'Top'} ${ordinal(c.inning)}` : null;
  const score = c.away_score != null && c.home_score != null ? `${c.away_score}-${c.home_score}` : null;
  return [when, clipLabel(c.kind), score].filter(Boolean).join(' · ');
}
// Saved clips as YouTube marks, when each moment happened. Runs are left out:
// the description already lists every scoring play.
export const clipMarks = (rows: ClipRow[]) => rows.filter((r) => r.status === 'saved' && r.kind !== 'run')
  .map((r) => ({ at: r.moment_at, label: clipText(r) }));

// A clip as the game page shows it, placed in the stream that carried it.
export type ClipRow = { id: number; n: number; kind: string; kinds: string[]; source: 'auto' | 'manual'; seq: number | null;
  inning: number | null; half: 'top' | 'bottom' | null; away_score: number | null; home_score: number | null;
  moment_at: string; status: 'armed' | 'asked' | 'saved' | 'missed' | 'discarded'; code: string | null };
export type ClipView = ClipRow & { shown: 'saved' | 'missed' | 'discarded' | 'pending'; offset: number | null };

// `streamStart`: when the stream went live, for each clip's place in it. A
// clip still armed or asked long after its moment never heard back from OBS.
export function viewClips(rows: ClipRow[], streamStart: string | null, now = Date.now()): ClipView[] {
  const t0 = streamStart ? Date.parse(streamStart) : NaN;
  return [...rows].sort((a, b) => Date.parse(a.moment_at) - Date.parse(b.moment_at)).map((r) => {
    const at = Date.parse(r.moment_at);
    const late = now - at > MAX_DELAY_MS + 60000;
    const shown: ClipView['shown'] = r.status === 'discarded' ? 'discarded'
      : r.status === 'saved' ? 'saved' : r.status === 'missed' || late ? 'missed' : 'pending';
    const offset = Number.isFinite(t0) && at >= t0 ? Math.round((at - t0) / 1000) : null;
    return { ...r, shown, offset };
  });
}
