// SpotKit: the shared half of every app spot in /ads (Run the Play, Baseball
// Time, ...). A spot page supplies how its two cuts LOOK and MOVE; the kit
// owns timing, text reveals, the player, the overlay's messages and the demo
// panel. The overlay drives the pages through js/app-spots.js.
//
//   startSpot({
//     topics: [{ id, label, ... }],              // what the spot rotates through
//     build: { pitch(topic) -> seconds, inning(topic) -> seconds },
//     frame(cut, t) {},                           // optional: paint a canvas each frame
//     clear() {},                                 // optional: wipe it when a spot stops
//     fonts: ["600 40px Teko", ...],              // wait for these before the first spot
//   });
//
//   pitch   the ~7s banner, between pitches
//   inning  the ~13s full-screen spot, between innings
//
// Timing: each build keys ONE Web Animation per element, in seconds, with K().
// The first animation a build makes is its clock: clockTime() reads it, so a
// canvas drawn from clockTime() stays in step, and seeking every animation
// (document.getAnimations()) seeks the whole spot, canvas included.
//
// URL params: ?spot=pitch|inning  plays it once on load
//             ?topic=<id>         one topic
//             ?auto=1             loops (both cuts if no spot)
//             ?pos=bl|bc|br|tl|tc|tr   where the banner sits
//             ?obs=1              transparent, no demo panel
//             ?embed=1            inside the live overlay
// API:  Spot.play("pitch", { pos: "tr", lift: 60, topic: "<id>" })
//       postMessage({ type: "spot:play", cut, topic, pos, lift })   (from the parent only)
//       -> the parent gets { type: "spot:ready" } once fonts and images are in,
//          and { type: "spot:done", cut } when a spot clears.

export const $ = (id) => document.getElementById(id);
export const all = (root, sel) => [...root.querySelectorAll(sel)];
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// ---- eases: CSS strings for Web Animations, and the same curves in JS for canvases
export const CB = {
  out: [.16, 1, .3, 1],        // expo out: arrivals
  in: [.7, 0, .84, 0],         // expo in: departures
  io: [.65, 0, .35, 1],        // moves across the frame
  cam: [.45, 0, .2, 1],        // cameras: slow start, long settle
  wipe: [.77, 0, .18, 1],      // wipes
  back: [.34, 1.56, .64, 1],   // pops
  soft: [.33, 1, .68, 1],
};
export const css = (k) => `cubic-bezier(${CB[k].join(",")})`;
export const OUT = css("out"), IN = css("in"), IO = css("io"), WIPE = css("wipe"), BACK = css("back"), LIN = "linear";
function bez([x1, y1, x2, y2]) {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx, cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const sx = (t) => ((ax * t + bx) * t + cx) * t, sy = (t) => ((ay * t + by) * t + cy) * t, dx = (t) => (3 * ax * t + 2 * bx) * t + cx;
  return (x) => {
    if (x <= 0) return 0; if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 8; i++) { const e = sx(t) - x; if (Math.abs(e) < 1e-5) break; const d = dx(t); if (Math.abs(d) < 1e-6) break; t -= e / d; }
    return sy(Math.min(1, Math.max(0, t)));
  };
}
export const E = Object.fromEntries(Object.entries(CB).map(([k, v]) => [k, bez(v)]));
E.lin = (x) => Math.min(1, Math.max(0, x));

// ---- K(): one Web Animation per element, keyed in seconds -------------------
// steps: [[t, {props}, easeInto], ...]. The first step holds from 0 and the
// last holds to the end, so nothing ever snaps between keys.
let anims = [];
export function K(el, D, steps) {
  if (!el) return null;
  const frames = steps.map(([t, p]) => ({ ...p, offset: Math.min(1, Math.max(0, t / D)) }));
  for (let i = 1; i < steps.length; i++) frames[i - 1].easing = steps[i][2] || LIN;
  if (frames[0].offset > 0) frames.unshift({ ...steps[0][1], offset: 0 });
  if (frames[frames.length - 1].offset < 1) frames.push({ ...steps[steps.length - 1][1], offset: 1 });
  const a = el.animate(frames, { duration: D * 1000, fill: "forwards" });
  anims.push(a);
  return a;
}
export const clockTime = () => (anims[0] ? anims[0].currentTime / 1000 : 0);
// Words rise out of their masks, staggered; optionally leave upward later.
export function rise(root, D, t0, { stagger = 0.045, dur = 0.6, out = null, outDur = 0.34, from = 105 } = {}) {
  all(root, ".w").forEach((w, i) => {
    const s = [[t0 + i * stagger, { transform: `translateY(${from}%)` }], [t0 + i * stagger + dur, { transform: "translateY(0%)" }, OUT]];
    if (out != null) s.push([out + i * 0.025, { transform: "translateY(0%)" }], [out + i * 0.025 + outDur, { transform: "translateY(-110%)" }, IN]);
    K(w, D, s);
  });
}
// A clip-path polygon for a 12-degree diagonal wipe; a and b are the top edge, in %.
export const poly = (a, b) => `polygon(${a}% 0%, ${b}% 0%, ${b - 12}% 100%, ${a - 12}% 100%)`;
export const edgeX = (b) => (b - 6) / 100 * 1920; // that wipe's edge at mid-height

// keyed values for canvases: [[t, value, easeName], ...]
const mix = (a, b, u) => Array.isArray(a) ? a.map((v, i) => v + (b[i] - v) * u) : a + (b - a) * u;
export function kv(keys, t) {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    if (t <= keys[i][0]) {
      const [t0, v0] = keys[i - 1], [t1, v1, e] = keys[i];
      return mix(v0, v1, E[e || "lin"]((t - t0) / (t1 - t0 || 1)));
    }
  }
  return keys[keys.length - 1][1];
}
export const seg = (t, a, b, e = "lin") => E[e]((t - a) / (b - a));

// ---- text -----------------------------------------------------------------
// A line of words that rise one by one: parts = [[text, highlighted?], ...].
export const words = (parts) => `<span class="mask">${parts.flatMap(([text, hl]) =>
  text.split(" ").filter(Boolean).map((wd) => `<span class="w${hl ? " hl" : ""}">${wd}</span>`)).join(" ")}</span>`;
// A line that rises as one piece (it carries its own markup).
export const whole = (html) => `<span class="mask"><span class="w">${html}</span></span>`;
// Shrink a one-line, no-wrap element until it fits the width it has.
export function fitTo(el, maxW) {
  el.style.fontSize = "";
  const m = el.querySelector(".mask") || el, wd = m.scrollWidth;
  if (wd > maxW) el.style.fontSize = `${parseFloat(getComputedStyle(el).fontSize) * maxW / wd}px`;
}

// ---- the player -------------------------------------------------------------
export function startSpot({ topics, build, frame = null, clear = null, fonts = [] }) {
  const P = new URLSearchParams(location.search);
  if (P.get("embed") === "1" || P.get("obs") === "1" || window.obsstudio) document.body.classList.add("obs");
  const stage = $("stage");
  const fit = () => { stage.style.transform = `scale(${Math.min(innerWidth / 1920, innerHeight / 1080)})`; };
  addEventListener("resize", fit); fit();

  let timer = null, current = null, raf = 0, turn = 0;
  // The topic: the one asked for, else the next in the list.
  const pick = (id) => topics.find((q) => q.id === id) || topics[turn++ % topics.length];
  function tick() {
    raf = requestAnimationFrame(tick);
    if (current && frame) frame(current, clockTime());
  }
  function stop() {
    clearTimeout(timer); timer = null;
    cancelAnimationFrame(raf); raf = 0;
    anims.forEach((a) => a.cancel()); anims = [];
    document.querySelectorAll(".spot.on").forEach((s) => s.classList.remove("on"));
    if (clear) clear();
    current = null;
  }
  // Wait for the type and the images, but never hold a spot back more than 2s.
  const capWait = (p) => Promise.race([p, new Promise((r) => setTimeout(r, 2000))]);
  const ready = capWait(Promise.all([
    ...(document.fonts ? fonts.map((f) => document.fonts.load(f)) : []),
    ...[...document.images].map((i) => (i.decode ? i.decode() : Promise.resolve()).catch(() => {})),
  ]).catch(() => {}));

  async function play(cut, opts = {}) {
    if (!build[cut]) return;
    await ready;
    stop();
    const pitch = $("pitch");
    if (opts.pos && /^(bl|bc|br|tl|tc|tr)$/.test(opts.pos)) pitch.dataset.pos = opts.pos;
    pitch.style.setProperty("--lift", `${clamp(+opts.lift || 0, 0, 200)}px`);
    $(cut).classList.add("on");   // on before building, so the words can be measured
    const D = build[cut](pick(opts.topic));
    current = cut;
    tick();
    timer = setTimeout(() => {
      stop();
      if (window.parent !== window) window.parent.postMessage({ type: "spot:done", cut }, location.origin);
      if (opts.onDone) opts.onDone();
    }, D * 1000 + 50);
  }
  window.Spot = { play, stop, get playing() { return current; }, topics: topics.map((q) => q.id) };
  if (window.parent !== window) ready.then(() => window.parent.postMessage({ type: "spot:ready" }, location.origin));
  addEventListener("message", (e) => {
    if (e.source !== window.parent || e.origin !== location.origin) return;
    const m = e.data || {};
    if (m.type === "spot:play") play(m.cut, { pos: m.pos, lift: m.lift, topic: m.topic });
    if (m.type === "spot:stop") stop();
  });

  // ---- demo panel / URL ----
  const posSel = $("pos"), loopBox = $("loop"), topicSel = $("topic");
  topicSel.insertAdjacentHTML("beforeend", topics.map((q) => `<option value="${q.id}">${q.label}</option>`).join(""));
  if (P.get("pos")) posSel.value = P.get("pos");
  if (P.get("topic")) topicSel.value = P.get("topic");
  if (P.get("auto") === "1") loopBox.checked = true;
  const go = (cut) => play(cut, { pos: posSel.value, topic: topicSel.value || null, onDone: () => {
    if (loopBox.checked) setTimeout(() => go(P.get("spot") ? cut : cut === "pitch" ? "inning" : "pitch"), 900);
  } });
  document.querySelectorAll("[data-play]").forEach((b) => b.addEventListener("click", () => go(b.dataset.play)));
  posSel.addEventListener("change", () => { if (current === "pitch") go("pitch"); });
  if (P.get("spot")) go(P.get("spot"));
  else if (P.get("auto") === "1") go("pitch");
  return { play, stop };
}
