// Web Audio engine for the overlay. All sounds are synthesized (no samples, nothing
// copyrighted). Runs in the overlay so OBS captures the browser-source audio.
// Categories: 'moments' (stingers) and 'organ' (charge riff). Master gain + mute.

let ctx = null, master = null;
const catGain = {};
let settings = { muted: false, master: 0.8, cats: { moments: 1, organ: 1 } };
let packName = 'bigleague';

function ensure() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  ctx = new AC();
  master = ctx.createGain();
  master.connect(ctx.destination);
  catGain.moments = ctx.createGain(); catGain.moments.connect(master);
  catGain.organ = ctx.createGain(); catGain.organ.connect(master);
  applyGains();
  return ctx;
}
function applyGains() {
  if (!master) return;
  master.gain.value = settings.muted ? 0 : settings.master;
  catGain.moments.gain.value = settings.cats?.moments ?? 1;
  catGain.organ.gain.value = settings.cats?.organ ?? 1;
}

export function resume() { try { ensure(); if (ctx.state !== 'running') return ctx.resume(); } catch {} }
export function isSuspended() { return !ctx || ctx.state === 'suspended'; }
export function setPack(p) { if (p) packName = p; }
export function setSettings(s) {
  if (!s) return;
  if (typeof s === 'string') { try { s = JSON.parse(s); } catch { return; } }
  settings = { ...settings, ...s, cats: { ...settings.cats, ...(s.cats || {}) } };
  applyGains();
}

// Football / volleyball / basketball moments reuse existing pack sounds.
const ALIAS = {
  touchdown: 'homerun', fieldgoal: 'webgem', turnover: 'strikeout', bigplay: 'webgem', goal: 'walkoff',
  ace: 'strikeout', setwin: 'walkoff', three: 'webgem',
};

export function play(type) {
  ensure();
  if (ctx.state !== 'running') ctx.resume();
  const pack = PACKS[packName] || PACKS.bigleague;
  const fn = pack[ALIAS[type] || type];
  if (!fn) return;
  const cat = type === 'charge' ? 'organ' : 'moments';
  fn(ctx, catGain[cat] || master, ctx.currentTime);
}

// Debug-only: render a sound offline and report peak amplitude (proves non-silence
// without needing speakers). Exposed on window.__audio when overlay ?debug=1.
export async function _debugRender(type, pack = 'bigleague') {
  const off = new OfflineAudioContext(1, 44100 * 2, 44100);
  const out = off.createGain(); out.connect(off.destination);
  const fn = (PACKS[pack] || PACKS.bigleague)[type];
  if (!fn) return { found: false, peak: 0 };
  fn(off, out, 0);
  const buf = await off.startRendering();
  const data = buf.getChannelData(0);
  let peak = 0;
  for (let i = 0; i < data.length; i++) { const v = Math.abs(data[i]); if (v > peak) peak = v; }
  return { found: true, peak: Math.round(peak * 1000) / 1000 };
}
export function _debugState() {
  return ctx ? { state: ctx.state, master: master.gain.value, moments: catGain.moments.gain.value, organ: catGain.organ.gain.value } : { state: 'none' };
}

// -- primitives -------------------------------------------------------------
function env(g, t, a, d, peak) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
}
function tone(c, out, t, { f = 440, type = 'sine', dur = 0.3, a = 0.005, d = 0.3, gain = 0.3, glideTo = null }) {
  const o = c.createOscillator(), g = c.createGain();
  o.type = type; o.frequency.setValueAtTime(f, t);
  if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, t + dur);
  o.connect(g); g.connect(out); env(g, t, a, d, gain);
  o.start(t); o.stop(t + a + d + 0.05);
}
function noise(c, out, t, { dur = 0.3, type = 'highpass', freq = 1000, gain = 0.3, a = 0.005, d = 0.3 }) {
  const b = c.createBuffer(1, Math.max(1, c.sampleRate * dur), c.sampleRate);
  const data = b.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource(); src.buffer = b;
  const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq;
  const g = c.createGain();
  src.connect(f); f.connect(g); g.connect(out); env(g, t, a, d, gain);
  src.start(t); src.stop(t + dur + 0.05);
}
function organ(c, out, t, f, dur, gain = 0.25) {
  const g = c.createGain(); g.connect(out); env(g, t, 0.02, dur, gain);
  [[1, 1], [2, 0.5], [3, 0.3], [4, 0.2]].forEach(([mult, amp]) => {
    const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = f * mult;
    const gg = c.createGain(); gg.gain.value = amp;
    o.connect(gg); gg.connect(g); o.start(t); o.stop(t + dur + 0.05);
  });
}
function blip(c, out, t, f, dur = 0.12, gain = 0.28, type = 'square') { tone(c, out, t, { f, type, dur, gain, a: 0.005, d: dur }); }
// Sub boom (pitch-drops), detuned brass stack, FM-ish bell, and a stadium air horn.
function boom(c, out, t, { f = 80, dur = 0.7, gain = 0.4 } = {}) {
  const o = c.createOscillator(), g = c.createGain(); o.type = 'sine';
  o.frequency.setValueAtTime(f * 2.4, t); o.frequency.exponentialRampToValueAtTime(f * 0.6, t + dur);
  o.connect(g); g.connect(out); env(g, t, 0.005, dur, gain); o.start(t); o.stop(t + dur + 0.05);
}
function brass(c, out, t, { f = 220, dur = 0.5, gain = 0.22, a = 0.02 } = {}) {
  const g = c.createGain(); const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = f * 6 + 400;
  g.connect(lp); lp.connect(out); env(g, t, a, dur, gain);
  [-7, 0, 7].forEach((det) => { const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f * Math.pow(2, det / 1200); o.connect(g); o.start(t); o.stop(t + dur + 0.05); });
}
function bell(c, out, t, f, dur = 0.6, gain = 0.3) {
  [[1, gain], [2.76, gain * 0.45], [5.4, gain * 0.2]].forEach(([m, gg]) => {
    const o = c.createOscillator(), g = c.createGain(); o.type = 'sine'; o.frequency.value = f * m;
    o.connect(g); g.connect(out); env(g, t, 0.002, dur, gg); o.start(t); o.stop(t + dur + 0.05);
  });
}
function horn(c, out, t, { f = 330, dur = 0.6, gain = 0.28 } = {}) {
  const g = c.createGain(); g.connect(out); env(g, t, 0.02, dur, gain);
  [0, 4, 7, 12].forEach((semi) => {
    const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f * Math.pow(2, semi / 12);
    const lfo = c.createOscillator(); lfo.frequency.value = 6; const lg = c.createGain(); lg.gain.value = 5;
    lfo.connect(lg); lg.connect(o.frequency); o.connect(g);
    o.start(t); o.stop(t + dur + 0.05); lfo.start(t); lfo.stop(t + dur + 0.05);
  });
}

// Supersaw stack (EDM), pitch riser + noise sweep, and a band-passed "radio" tone.
function supersaw(c, out, t, { f = 220, dur = 0.5, gain = 0.2, a = 0.02, detune = 14 } = {}) {
  const g = c.createGain(); const lp = c.createBiquadFilter(); lp.type = 'lowpass';
  lp.frequency.setValueAtTime(f * 4, t); lp.frequency.exponentialRampToValueAtTime(f * 12, t + dur * 0.6);
  g.connect(lp); lp.connect(out); env(g, t, a, dur, gain);
  for (let i = -3; i <= 3; i++) { const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f * Math.pow(2, i * detune / 1200); o.connect(g); o.start(t); o.stop(t + dur + 0.05); }
}
function riser(c, out, t, { f0 = 100, f1 = 1800, dur = 1, gain = 0.2 } = {}) {
  const o = c.createOscillator(), g = c.createGain(); o.type = 'sawtooth';
  o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
  o.connect(g); g.connect(out); env(g, t, dur * 0.7, dur * 0.3, gain); o.start(t); o.stop(t + dur + 0.05);
  noise(c, out, t, { dur, type: 'highpass', freq: 2500, gain: gain * 0.5, a: dur * 0.8, d: dur * 0.2 });
}
function ftone(c, out, t, { f, type = 'square', dur = 0.3, gain = 0.55, fc = 1700, q = 2.2 } = {}) {
  const o = c.createOscillator(), g = c.createGain(), bp = c.createBiquadFilter();
  bp.type = 'bandpass'; bp.frequency.value = fc; bp.Q.value = q;
  o.type = type; o.frequency.value = f; o.connect(bp); bp.connect(g); g.connect(out);
  env(g, t, 0.005, dur, gain); o.start(t); o.stop(t + dur + 0.05);
}
function crackle(c, out, t, dur = 0.4, gain = 0.06) { noise(c, out, t, { dur, type: 'bandpass', freq: 2200, gain, a: 0.01, d: dur }); }

// Bugle "Charge!" motif (public-domain cadence), voiced by whatever noteFn is passed.
function charge(c, out, t, noteFn) {
  const seq = [[392, 0.14], [523, 0.14], [659, 0.14], [784, 0.2], [659, 0.14], [784, 0.5]];
  let tt = t;
  for (const [f, d] of seq) { noteFn(c, out, tt, f, d + 0.02, 0.3); tt += d; }
}

// -- packs ------------------------------------------------------------------
const PACKS = {
  bigleague: {
    run: (c, o, t) => { organ(c, o, t, 392, 0.18); organ(c, o, t + 0.12, 523, 0.18); organ(c, o, t + 0.24, 659, 0.4, 0.28); },
    homerun: (c, o, t) => { [262, 330, 392, 523].forEach(f => organ(c, o, t, f, 1.6, 0.16)); noise(c, o, t, { dur: 1.4, type: 'lowpass', freq: 1200, gain: 0.15, a: 0.4, d: 1.0 }); organ(c, o, t + 1.4, 523, 0.6, 0.3); },
    strikeout: (c, o, t) => { organ(c, o, t, 349, 0.5, 0.3); tone(c, o, t, { f: 180, type: 'sawtooth', dur: 0.4, glideTo: 90, gain: 0.18, d: 0.4 }); },
    doubleplay: (c, o, t) => { organ(c, o, t, 392, 0.14); organ(c, o, t + 0.14, 523, 0.3); },
    webgem: (c, o, t) => { organ(c, o, t, 523, 0.2); organ(c, o, t + 0.18, 659, 0.2); organ(c, o, t + 0.34, 784, 0.5, 0.3); },
    stolenbase: (c, o, t) => { noise(c, o, t, { dur: 0.5, type: 'highpass', freq: 2000, gain: 0.25, d: 0.5 }); tone(c, o, t, { f: 300, glideTo: 900, type: 'sine', dur: 0.4, gain: 0.2, d: 0.4 }); },
    walkoff: (c, o, t) => { [262, 330, 392, 523, 659].forEach((f, i) => organ(c, o, t + i * 0.12, f, 1.4, 0.2)); noise(c, o, t, { dur: 2, type: 'lowpass', freq: 1500, gain: 0.12, a: 0.6, d: 1.4 }); },
    charge: (c, o, t) => charge(c, o, t, organ),
  },
  modern: {
    run: (c, o, t) => { noise(c, o, t, { dur: 0.25, type: 'highpass', freq: 3000, gain: 0.2, d: 0.25 }); tone(c, o, t + 0.05, { f: 600, glideTo: 1200, type: 'triangle', dur: 0.2, gain: 0.25, d: 0.2 }); },
    homerun: (c, o, t) => { tone(c, o, t, { f: 120, glideTo: 1400, type: 'sawtooth', dur: 1.2, gain: 0.2, a: 0.6, d: 0.8 }); noise(c, o, t + 1.1, { dur: 0.8, type: 'lowpass', freq: 800, gain: 0.35, a: 0.001, d: 0.8 }); [220, 330, 440].forEach(f => tone(c, o, t + 1.1, { f, type: 'square', dur: 0.6, gain: 0.14, d: 0.6 })); },
    strikeout: (c, o, t) => { tone(c, o, t, { f: 800, glideTo: 120, type: 'sawtooth', dur: 0.35, gain: 0.25, d: 0.35 }); noise(c, o, t, { dur: 0.15, type: 'bandpass', freq: 2000, gain: 0.2, d: 0.15 }); },
    doubleplay: (c, o, t) => { tone(c, o, t, { f: 400, type: 'square', dur: 0.1, gain: 0.2, d: 0.1 }); tone(c, o, t + 0.12, { f: 600, type: 'square', dur: 0.2, gain: 0.2, d: 0.2 }); },
    webgem: (c, o, t) => { tone(c, o, t, { f: 500, glideTo: 1500, type: 'triangle', dur: 0.5, gain: 0.25, d: 0.5 }); noise(c, o, t, { dur: 0.4, type: 'highpass', freq: 4000, gain: 0.12, d: 0.4 }); },
    stolenbase: (c, o, t) => { noise(c, o, t, { dur: 0.5, type: 'highpass', freq: 1500, gain: 0.28, d: 0.5 }); },
    walkoff: (c, o, t) => { tone(c, o, t, { f: 100, glideTo: 1600, type: 'sawtooth', dur: 1.4, gain: 0.2, a: 0.8, d: 0.6 }); noise(c, o, t + 1.3, { dur: 1, type: 'lowpass', freq: 900, gain: 0.3, d: 1 }); [262, 392, 523].forEach((f, i) => tone(c, o, t + 1.3 + i * 0.1, { f, type: 'square', dur: 0.8, gain: 0.14, d: 0.8 })); },
    charge: (c, o, t) => charge(c, o, t, (cx, ou, tt, f, d, g) => tone(cx, ou, tt, { f, type: 'square', dur: d, gain: g, d })),
  },
  sandlot: {
    run: (c, o, t) => { blip(c, o, t, 523, 0.1); blip(c, o, t + 0.1, 659, 0.1); blip(c, o, t + 0.2, 784, 0.15); },
    homerun: (c, o, t) => { [523, 659, 784, 1047].forEach((f, i) => blip(c, o, t + i * 0.12, f, 0.18, 0.3)); blip(c, o, t + 0.48, 1047, 0.6, 0.3); },
    strikeout: (c, o, t) => { blip(c, o, t, 330, 0.2, 0.3, 'sawtooth'); blip(c, o, t + 0.22, 247, 0.4, 0.3, 'sawtooth'); },
    doubleplay: (c, o, t) => { blip(c, o, t, 659, 0.1); blip(c, o, t + 0.1, 880, 0.2); },
    webgem: (c, o, t) => { [784, 988, 1319].forEach((f, i) => blip(c, o, t + i * 0.08, f, 0.12, 0.28)); },
    stolenbase: (c, o, t) => { tone(c, o, t, { f: 200, glideTo: 1000, type: 'square', dur: 0.3, gain: 0.25, d: 0.3 }); },
    walkoff: (c, o, t) => { [523, 659, 784, 1047, 1319].forEach((f, i) => blip(c, o, t + i * 0.12, f, 0.3, 0.3)); },
    charge: (c, o, t) => charge(c, o, t, (cx, ou, tt, f, d, g) => blip(cx, ou, tt, f, d, g)),
  },

  // Arcade — richer chiptune, triangle+square arpeggios.
  arcade: {
    run: (c, o, t) => { [659, 784, 988].forEach((f, i) => blip(c, o, t + i * 0.06, f, 0.09, 0.26, 'triangle')); },
    homerun: (c, o, t) => { [523, 659, 784, 1047, 1319, 1568].forEach((f, i) => blip(c, o, t + i * 0.09, f, 0.12, 0.28)); blip(c, o, t + 0.6, 1568, 0.5, 0.3, 'triangle'); },
    strikeout: (c, o, t) => { [440, 349, 262].forEach((f, i) => blip(c, o, t + i * 0.12, f, 0.16, 0.3, 'square')); },
    doubleplay: (c, o, t) => { blip(c, o, t, 784, 0.08); blip(c, o, t + 0.09, 988, 0.08); blip(c, o, t + 0.18, 1319, 0.18, 0.3); },
    webgem: (c, o, t) => { [988, 1319, 1568, 2093].forEach((f, i) => blip(c, o, t + i * 0.06, f, 0.1, 0.24, 'triangle')); },
    stolenbase: (c, o, t) => { tone(c, o, t, { f: 262, glideTo: 1568, type: 'square', dur: 0.28, gain: 0.24, d: 0.28 }); },
    walkoff: (c, o, t) => { [523, 659, 784, 1047, 1319, 1568, 2093].forEach((f, i) => blip(c, o, t + i * 0.1, f, 0.22, 0.28)); },
    charge: (c, o, t) => charge(c, o, t, (cx, ou, tt, f, d, g) => blip(cx, ou, tt, f, d, g, 'triangle')),
  },

  // Cinematic — orchestral hits, brass swells, sub booms.
  cinematic: {
    run: (c, o, t) => { brass(c, o, t, { f: 262, dur: 0.35, gain: 0.22 }); boom(c, o, t, { f: 70, dur: 0.4, gain: 0.3 }); },
    homerun: (c, o, t) => { boom(c, o, t, { f: 55, dur: 1.4, gain: 0.45 }); [131, 165, 196, 262].forEach((f) => brass(c, o, t + 0.1, { f, dur: 1.5, gain: 0.16, a: 0.25 })); noise(c, o, t, { dur: 1.2, type: 'lowpass', freq: 1400, gain: 0.14, a: 0.5, d: 0.8 }); brass(c, o, t + 1.3, { f: 262, dur: 0.7, gain: 0.24 }); },
    strikeout: (c, o, t) => { brass(c, o, t, { f: 175, dur: 0.4, gain: 0.24 }); boom(c, o, t, { f: 60, dur: 0.5, gain: 0.35 }); },
    doubleplay: (c, o, t) => { brass(c, o, t, { f: 196, dur: 0.22, gain: 0.22 }); brass(c, o, t + 0.24, { f: 262, dur: 0.4, gain: 0.24 }); },
    webgem: (c, o, t) => { [196, 262, 330].forEach((f, i) => brass(c, o, t + i * 0.1, { f, dur: 0.5, gain: 0.18 })); },
    stolenbase: (c, o, t) => { noise(c, o, t, { dur: 0.5, type: 'highpass', freq: 1200, gain: 0.2, d: 0.5 }); boom(c, o, t + 0.1, { f: 65, dur: 0.5, gain: 0.3 }); },
    walkoff: (c, o, t) => { boom(c, o, t, { f: 50, dur: 2, gain: 0.5 }); [131, 165, 196, 262, 330].forEach((f, i) => brass(c, o, t + 0.1 + i * 0.08, { f, dur: 1.6, gain: 0.14, a: 0.2 })); noise(c, o, t, { dur: 1.8, type: 'lowpass', freq: 1600, gain: 0.12, a: 0.7, d: 1.2 }); },
    charge: (c, o, t) => charge(c, o, t, (cx, ou, tt, f, d, g) => brass(cx, ou, tt, { f, dur: d, gain: g })),
  },

  // Stadium — air horns + bass drops.
  airhorn: {
    run: (c, o, t) => { horn(c, o, t, { f: 330, dur: 0.3, gain: 0.26 }); },
    homerun: (c, o, t) => { horn(c, o, t, { f: 294, dur: 1.4, gain: 0.3 }); boom(c, o, t + 1.2, { f: 55, dur: 0.7, gain: 0.4 }); },
    strikeout: (c, o, t) => { horn(c, o, t, { f: 262, dur: 0.5, gain: 0.28 }); },
    doubleplay: (c, o, t) => { horn(c, o, t, { f: 349, dur: 0.22, gain: 0.24 }); horn(c, o, t + 0.26, { f: 440, dur: 0.3, gain: 0.26 }); },
    webgem: (c, o, t) => { horn(c, o, t, { f: 392, dur: 0.5, gain: 0.26 }); },
    stolenbase: (c, o, t) => { horn(c, o, t, { f: 330, dur: 0.4, gain: 0.24 }); noise(c, o, t, { dur: 0.4, type: 'highpass', freq: 1800, gain: 0.15, d: 0.4 }); },
    walkoff: (c, o, t) => { horn(c, o, t, { f: 294, dur: 1.8, gain: 0.32 }); boom(c, o, t + 0.6, { f: 48, dur: 1.2, gain: 0.42 }); },
    charge: (c, o, t) => charge(c, o, t, (cx, ou, tt, f, d, g) => horn(cx, ou, tt, { f, dur: d, gain: g })),
  },

  // Chill — soft bells / marimba, pentatonic.
  chill: {
    run: (c, o, t) => { bell(c, o, t, 784, 0.5, 0.28); },
    homerun: (c, o, t) => { [523, 587, 784, 880, 1047].forEach((f, i) => bell(c, o, t + i * 0.13, f, 0.9, 0.24)); },
    strikeout: (c, o, t) => { bell(c, o, t, 440, 0.5, 0.26); bell(c, o, t + 0.18, 330, 0.7, 0.22); },
    doubleplay: (c, o, t) => { bell(c, o, t, 659, 0.4, 0.24); bell(c, o, t + 0.14, 988, 0.6, 0.24); },
    webgem: (c, o, t) => { [880, 1047, 1319].forEach((f, i) => bell(c, o, t + i * 0.1, f, 0.5, 0.22)); },
    stolenbase: (c, o, t) => { bell(c, o, t, 587, 0.4, 0.24); bell(c, o, t + 0.12, 784, 0.5, 0.22); },
    walkoff: (c, o, t) => { [523, 659, 784, 880, 1047, 1319].forEach((f, i) => bell(c, o, t + i * 0.14, f, 0.9, 0.22)); },
    charge: (c, o, t) => charge(c, o, t, (cx, ou, tt, f, d, g) => bell(cx, ou, tt, f, d, g)),
  },

  // Pipe organ — full church organ, big chords + pedal bass.
  organ: {
    run: (c, o, t) => { [392, 523, 659].forEach((f) => organ(c, o, t, f, 0.5, 0.16)); organ(c, o, t, 131, 0.5, 0.14); },
    homerun: (c, o, t) => { [131, 262, 330, 392, 523].forEach((f) => organ(c, o, t, f, 2.2, 0.085)); organ(c, o, t, 65, 2.2, 0.1); organ(c, o, t + 1.8, 523, 0.9, 0.16); },
    strikeout: (c, o, t) => { organ(c, o, t, 175, 0.6, 0.2); organ(c, o, t, 87, 0.6, 0.16); },
    doubleplay: (c, o, t) => { organ(c, o, t, 392, 0.2, 0.18); organ(c, o, t + 0.2, 523, 0.4, 0.2); },
    webgem: (c, o, t) => { [392, 523, 659, 784].forEach((f, i) => organ(c, o, t + i * 0.1, f, 0.4, 0.18)); },
    stolenbase: (c, o, t) => { organ(c, o, t, 262, 0.3, 0.18); organ(c, o, t + 0.15, 392, 0.4, 0.2); },
    walkoff: (c, o, t) => { [131, 165, 196, 262, 330, 392].forEach((f) => organ(c, o, t, f, 2.4, 0.08)); organ(c, o, t, 65, 2.4, 0.1); },
    charge: (c, o, t) => charge(c, o, t, (cx, ou, tt, f, d, g) => { organ(cx, ou, tt, f, d, g); organ(cx, ou, tt, f / 2, d, g * 0.7); }),
  },

  // Vintage radio — band-passed, lo-fi, with a little crackle.
  radio: {
    run: (c, o, t) => { ftone(c, o, t, { f: 660, dur: 0.2, gain: 0.6 }); crackle(c, o, t, 0.25); },
    homerun: (c, o, t) => { [523, 659, 784, 1047].forEach((f, i) => ftone(c, o, t + i * 0.12, { f, dur: 0.25, gain: 0.55 })); ftone(c, o, t + 0.5, { f: 1047, dur: 0.6, gain: 0.6 }); crackle(c, o, t, 1.1, 0.09); },
    strikeout: (c, o, t) => { ftone(c, o, t, { f: 440, dur: 0.3, gain: 0.55, type: 'sawtooth' }); ftone(c, o, t + 0.22, { f: 262, dur: 0.4, gain: 0.5, type: 'sawtooth' }); crackle(c, o, t, 0.5); },
    doubleplay: (c, o, t) => { ftone(c, o, t, { f: 659, dur: 0.14, gain: 0.5 }); ftone(c, o, t + 0.14, { f: 880, dur: 0.24, gain: 0.6 }); },
    webgem: (c, o, t) => { [784, 988, 1319].forEach((f, i) => ftone(c, o, t + i * 0.08, { f, dur: 0.12, gain: 0.5 })); crackle(c, o, t, 0.4); },
    stolenbase: (c, o, t) => { ftone(c, o, t, { f: 330, dur: 0.3, gain: 0.55, type: 'sawtooth' }); crackle(c, o, t, 0.4); },
    walkoff: (c, o, t) => { [523, 659, 784, 1047, 1319].forEach((f, i) => ftone(c, o, t + i * 0.12, { f, dur: 0.3, gain: 0.5 })); crackle(c, o, t, 1.4, 0.09); },
    charge: (c, o, t) => charge(c, o, t, (cx, ou, tt, f, d, g) => ftone(cx, ou, tt, { f, dur: d, gain: g + 0.25 })),
  },

  // EDM — supersaws, risers, and big drops.
  edm: {
    run: (c, o, t) => { supersaw(c, o, t, { f: 523, dur: 0.25, gain: 0.18 }); },
    homerun: (c, o, t) => { riser(c, o, t, { f0: 110, f1: 1600, dur: 0.9, gain: 0.16 }); boom(c, o, t + 0.9, { f: 55, dur: 0.9, gain: 0.32 }); [220, 277, 330].forEach((f) => supersaw(c, o, t + 0.9, { f, dur: 1.0, gain: 0.08 })); },
    strikeout: (c, o, t) => { supersaw(c, o, t, { f: 330, dur: 0.35, gain: 0.16 }); boom(c, o, t, { f: 60, dur: 0.4, gain: 0.28 }); },
    doubleplay: (c, o, t) => { supersaw(c, o, t, { f: 440, dur: 0.14, gain: 0.14 }); supersaw(c, o, t + 0.16, { f: 587, dur: 0.28, gain: 0.16 }); },
    webgem: (c, o, t) => { [587, 740, 880].forEach((f, i) => supersaw(c, o, t + i * 0.08, { f, dur: 0.3, gain: 0.13 })); },
    stolenbase: (c, o, t) => { riser(c, o, t, { f0: 200, f1: 1200, dur: 0.4, gain: 0.16 }); },
    walkoff: (c, o, t) => { riser(c, o, t, { f0: 90, f1: 1800, dur: 1.1, gain: 0.16 }); boom(c, o, t + 1.1, { f: 48, dur: 1.2, gain: 0.32 }); [196, 247, 294, 392].forEach((f) => supersaw(c, o, t + 1.1, { f, dur: 1.2, gain: 0.08 })); },
    charge: (c, o, t) => charge(c, o, t, (cx, ou, tt, f, d, g) => supersaw(cx, ou, tt, { f, dur: d, gain: g })),
  },
};
