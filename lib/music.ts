import type { BreakKind } from './broadcast.ts';
import { autoMid, type Feed } from './onair.ts';

// The music bed for breaks in play: lo-fi tracks by Sascha Ende (ende.app),
// CC BY 4.0, so the stream's description credits them (CREDIT). Each file in
// public/music is loudness-matched (-16 LUFS integrated, -1.5 dBTP) so the
// tracks sit at the same level and one volume suits them all.
export type Track = { id: string; title: string; src: string; url: string };
export const TRACKS: Track[] = [
  { id: 'tessera', title: 'Relaxing Lofi - Tessera', src: '/music/lofi-tessera.mp3', url: 'https://ende.app/en/song/12257-relaxing-lofi-tessera' },
  { id: 'dyo', title: 'Relaxing Lofi - Dyo', src: '/music/lofi-dyo.mp3', url: 'https://ende.app/en/song/12225-relaxing-lofi-dyo' },
  { id: 'hexakaideca', title: 'Relaxing Lofi - Hexakaideca', src: '/music/lofi-hexakaideca.mp3', url: 'https://ende.app/en/song/13282-relaxing-lofi-hexakaideca' },
];
export const DEFAULT_TRACK: Record<BreakKind, string> = { starting: 'tessera', mid: 'dyo', paused: 'dyo', final: 'hexakaideca' };
export const MUSIC_VOLUME = 0.6;
export const BREAKS: [BreakKind, string][] = [['starting', 'Starting soon'], ['mid', 'Mid-inning'], ['paused', 'Game paused'], ['final', 'Final']];
export const CREDIT = (ids: string[]) => TRACKS.filter((t) => ids.includes(t.id))
  .map((t) => `"${t.title}" by Sascha Ende (${t.url}), licensed under CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/)`).join('\n');

export const trackOf = (id: string | null | undefined) => TRACKS.find((t) => t.id === id) ?? null;

// Which break is on the stream now, if any: a full-frame scene, or the
// mid-inning board (held from the pad, or up by itself between halves).
export function breakOf(feed: Feed | null): BreakKind | null {
  if (!feed?.game) return null;
  const scene = feed.broadcast?.scene?.kind;
  if (scene) return scene;
  if ((feed.game.sport ?? 'baseball') !== 'baseball' || feed.game.status !== 'live') return null;
  return feed.card === 'mid' || (!feed.card && autoMid(feed)) ? 'mid' : null;
}
