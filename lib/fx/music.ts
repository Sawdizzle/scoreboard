// The music bed: one track at a time, looped with a crossfade so no track
// needs a seamless loop point, faded in and out so it never cuts. Its own
// AudioContext and volume, apart from the moments' sounds (audio.js); OBS
// captures both from the Browser Source.

const FADE_IN = 2.5, FADE_OUT = 2, LOOP_XF = 6;

let ctx: AudioContext | null = null;
let bed: GainNode | null = null;
const buffers = new Map<string, Promise<AudioBuffer | null>>();
// What plays now: its file, the gain it fades through, and the timer that queues the next pass.
let now: { src: string; gain: GainNode; voices: AudioBufferSourceNode[]; timer: number } | null = null;
let token = 0;

function ensure() {
  if (ctx) return ctx;
  const AC = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext!;
  ctx = new AC();
  bed = ctx.createGain();
  bed.connect(ctx.destination);
  return ctx;
}
const load = (src: string) => {
  let p = buffers.get(src);
  if (!p) {
    p = fetch(src).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject())).then((a) => ensure().decodeAudioData(a)).catch(() => { buffers.delete(src); return null; });
    buffers.set(src, p);
  }
  return p;
};

export const resume = () => { try { const c = ensure(); if (c.state !== 'running') void c.resume(); } catch { /* no audio here */ } };
export const isSuspended = () => !ctx || ctx.state === 'suspended';

export function setVolume(v: number) {
  ensure();
  bed!.gain.setTargetAtTime(Math.max(0, Math.min(1, v)), ctx!.currentTime, 0.3);
}

function fadeOut(p: NonNullable<typeof now>, secs: number) {
  const t = ctx!.currentTime;
  window.clearTimeout(p.timer);
  p.gain.gain.cancelScheduledValues(t);
  p.gain.gain.setValueAtTime(p.gain.gain.value, t);
  p.gain.gain.linearRampToValueAtTime(0, t + secs);
  for (const v of p.voices) { try { v.stop(t + secs + 0.05); } catch { /* already stopped */ } }
  window.setTimeout(() => p.gain.disconnect(), (secs + 0.5) * 1000);
}

// Play a track, crossfading from whatever plays now; the same track again keeps playing.
export async function play(src: string) {
  if (now?.src === src) return;
  const mine = ++token;
  const c = ensure();
  if (c.state !== 'running') void c.resume();
  const buf = await load(src);
  if (mine !== token || !buf) return;
  if (now) fadeOut(now, FADE_OUT);
  const gain = c.createGain();
  gain.connect(bed!);
  gain.gain.setValueAtTime(0, c.currentTime);
  gain.gain.linearRampToValueAtTime(1, c.currentTime + FADE_IN);
  const p: NonNullable<typeof now> = { src, gain, voices: [], timer: 0 };
  now = p;
  // Each pass fades in over the last LOOP_XF seconds of the one before.
  const xf = Math.min(LOOP_XF, buf.duration / 4);
  const pass = (at: number, first: boolean) => {
    const v = c.createBufferSource(), g = c.createGain();
    v.buffer = buf;
    v.connect(g).connect(gain);
    g.gain.setValueAtTime(first ? 1 : 0, at);
    if (!first) g.gain.linearRampToValueAtTime(1, at + xf);
    const end = at + buf.duration;
    g.gain.setValueAtTime(1, end - xf);
    g.gain.linearRampToValueAtTime(0, end);
    v.start(at);
    v.stop(end + 0.05);
    p.voices = [...p.voices.filter((x) => x !== v).slice(-1), v];
    const next = end - xf;
    p.timer = window.setTimeout(() => { if (now === p) pass(next, false); }, Math.max(0, (next - c.currentTime - 2) * 1000));
  };
  pass(c.currentTime + 0.05, true);
}

export function stop() {
  token++;
  if (!now) return;
  fadeOut(now, FADE_OUT);
  now = null;
}

// Fetch and decode ahead, so a break's music starts on time.
export const preload = (srcs: string[]) => { for (const s of srcs) void load(s); };
