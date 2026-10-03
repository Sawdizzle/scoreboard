// Copied from the Two-Way Lab landing page (Sawdizzle/swinglab, landing/skeleton.js) for the on-air spot; keep in step with it.
// Skeleton cleanup for drawing: the dashboard's cleanSkeleton (a port of SkeletonCleaner.cs), plus decode and frameIndex.
  function decode(f) {
    const idx = {};
    f.joints.forEach((n, i) => { idx[n] = i; });
    return { t: f.t, p: f.p, s: f.s, idx, n: f.t.length, end: f.t[f.t.length - 1] };
  }

  // ---- Skeleton cleanup for drawing (a port of SkeletonCleaner.cs; keep the two the same) ----
  // The Kinect's hands shake 11-24 mm a frame and limbs change length 8-12%. For the replay only (no number
  // on the page comes from this): spikes dropped and filled, the hands as one grip point, smoothing that
  // follows speed (strong when still, light in the swing), and steady bone lengths with the grip and ankles
  // kept where they were seen.
  const CLEAN_BODY = ["SpineBase", "SpineMid", "SpineShoulder", "Neck", "Head",
    "ShoulderLeft", "ElbowLeft", "WristLeft", "HandLeft", "HandTipLeft", "ThumbLeft",
    "ShoulderRight", "ElbowRight", "WristRight", "HandRight", "HandTipRight", "ThumbRight",
    "HipLeft", "KneeLeft", "AnkleLeft", "FootLeft", "HipRight", "KneeRight", "AnkleRight", "FootRight"];
  const CLEAN_HANDS = new Set(["WristLeft", "HandLeft", "HandTipLeft", "ThumbLeft", "WristRight", "HandRight", "HandTipRight", "ThumbRight"]);
  const cleanCache = new WeakMap();

  function cleanSkeleton(d, pitching) {
    const key = pitching ? "p" : "h";
    const cached = cleanCache.get(d);
    if (cached && cached[key]) return cached[key];
    const n = d.n, t = d.t, FRAME = 1000 / 30;
    if (n < 3) return d;
    const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
    const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
    const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
    const len = a => Math.hypot(a[0], a[1], a[2]);
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

    // Step 1: each joint's track (meters) and quality (2 tracked, 1 guessed, 0 missing); spikes dropped, gaps filled
    const raw = {};
    for (const name of CLEAN_BODY) {
      const ji = d.idx[name];
      if (ji == null) return d;
      const P = new Array(n), Q = new Array(n).fill(0);
      for (let i = 0; i < n; i++) {
        const a = d.p[i], st = d.s[i][ji], x = a[ji * 3], y = a[ji * 3 + 1], z = a[ji * 3 + 2];
        P[i] = [x / 1000, y / 1000, z / 1000];
        if (st !== "N" && !(x === 0 && y === 0 && z === 0)) Q[i] = st === "T" ? 2 : 1;
      }
      const guess = CLEAN_HANDS.has(name) ? 0.15 : 0.10, drop = [];
      for (let i = 1; i < n - 1; i++) {
        if (!Q[i] || !Q[i - 1] || !Q[i + 1]) continue;
        const f = (t[i] - t[i - 1]) / Math.max(1e-6, t[i + 1] - t[i - 1]);
        const off = len(sub(P[i], add(P[i - 1], mul(sub(P[i + 1], P[i - 1]), f))));
        if (off > 0.35 || (Q[i] === 1 && off > guess)) drop.push(i);
      }
      drop.forEach(i => { Q[i] = 0; });
      const first = Q.findIndex(q => q > 0);
      if (first < 0) return d;
      let last = first;
      for (let i = first + 1; i < n; i++) {
        if (!Q[i]) continue;
        for (let k = last + 1; k < i; k++) P[k] = add(P[last], mul(sub(P[i], P[last]), (t[k] - t[last]) / Math.max(1e-6, t[i] - t[last])));
        last = i;
      }
      for (let k = 0; k < first; k++) P[k] = P[first];
      for (let k = last + 1; k < n; k++) P[k] = P[last];
      raw[name] = { P, Q };
    }

    // Step 2: hands as the grip (both hands, hitting) or one point per hand (pitching)
    const average = names => {
      const P = new Array(n), Q = new Array(n);
      for (let i = 0; i < n; i++) {
        let s = [0, 0, 0], q = 0;
        names.forEach(nm => { s = add(s, raw[nm].P[i]); q = Math.max(q, raw[nm].Q[i]); });
        P[i] = mul(s, 1 / names.length); Q[i] = q;
      }
      return { P, Q };
    };
    const both = average(["WristLeft", "WristRight", "HandLeft", "HandRight"]);
    const tL = pitching ? average(["WristLeft", "HandLeft"]) : both, tR = pitching ? average(["WristRight", "HandRight"]) : both;

    // Step 3: centered Gaussian whose width follows speed (sigma 2.5 frames still, 0.6 above 2.5 m/s)
    const gauss = (P, sigmaAt) => P.map((_, i) => {
      const sig = sigmaAt(i) * FRAME, reach = 3 * sig;
      let s = [0, 0, 0], sw = 0;
      for (let k = i; k >= 0 && t[i] - t[k] <= reach; k--) { const w = Math.exp(-0.5 * ((t[i] - t[k]) / sig) ** 2); s = add(s, mul(P[k], w)); sw += w; }
      for (let k = i + 1; k < n && t[k] - t[i] <= reach; k++) { const w = Math.exp(-0.5 * ((t[k] - t[i]) / sig) ** 2); s = add(s, mul(P[k], w)); sw += w; }
      return mul(s, 1 / sw);
    });
    const smooth = P => {
      const steady = gauss(P, () => 2.0);
      const sigma = steady.map((_, i) => {
        const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
        const v = len(sub(steady[b], steady[a])) / Math.max(1e-3, (t[b] - t[a]) / 1000);
        const k = Math.max(0, Math.min(1, (v - 0.3) / (2.5 - 0.3)));
        return 2.5 + (0.6 - 2.5) * k;
      });
      return gauss(P, i => sigma[i]);
    };
    const s = {};
    CLEAN_BODY.forEach(nm => { if (!CLEAN_HANDS.has(nm)) s[nm] = smooth(raw[nm].P); });
    const gl = smooth(tL.P), gr = pitching ? smooth(tR.P) : gl;

    // Step 4: steady proportions (median bone lengths; arms and legs bend to reach the grip and the ankles)
    const median = xs => { const v = xs.slice().sort((a, b) => a - b); return v[Math.floor(v.length / 2)]; };
    const L = (a, b) => median(a.map((_, i) => len(sub(a[i], b[i]))));
    const out = (from, childSeen, length, parentSeen) => {
      const dd = sub(childSeen, parentSeen), l = len(dd);
      return l < 1e-6 ? childSeen : add(from, mul(dd, length / l));
    };
    // Two-bone limb: returns [middle joint, where the end is drawn]. Just out of reach the limb stretches up to 8%
    // to keep the end where it was seen; further out it's straight and the end is where it reaches.
    const MAX_STRETCH = 1.08;
    const bend = (root, end, a, b, midSeen) => {
      const dd = sub(end, root);
      let dist = len(dd);
      if (dist < 1e-6 || a < 1e-6 || b < 1e-6) return [midSeen, end];
      const u = mul(dd, 1 / dist);
      if (dist >= a + b) {
        const reach = Math.min(dist, (a + b) * MAX_STRETCH);
        return [add(root, mul(u, reach * a / (a + b))), add(root, mul(u, reach))];
      }
      dist = Math.max(dist, Math.abs(a - b) + 1e-4);
      const along = (a * a + dist * dist - b * b) / (2 * dist), up = Math.sqrt(Math.max(0, a * a - along * along));
      const m = sub(midSeen, root), w = sub(m, mul(u, dot(m, u))), wl = len(w);
      return [wl < 1e-6 ? add(root, mul(u, along)) : add(add(root, mul(u, along)), mul(w, up / wl)), end];
    };
    const lens = {
      spineLow: L(s.SpineMid, s.SpineBase), spineHigh: L(s.SpineShoulder, s.SpineMid), neck: L(s.Neck, s.SpineShoulder), head: L(s.Head, s.Neck),
      shL: L(s.ShoulderLeft, s.SpineShoulder), shR: L(s.ShoulderRight, s.SpineShoulder), hipL: L(s.HipLeft, s.SpineBase), hipR: L(s.HipRight, s.SpineBase),
      upL: L(s.ElbowLeft, s.ShoulderLeft), upR: L(s.ElbowRight, s.ShoulderRight), foL: L(gl, s.ElbowLeft), foR: L(gr, s.ElbowRight),
      thL: L(s.KneeLeft, s.HipLeft), thR: L(s.KneeRight, s.HipRight), shinL: L(s.AnkleLeft, s.KneeLeft), shinR: L(s.AnkleRight, s.KneeRight),
      ftL: L(s.FootLeft, s.AnkleLeft), ftR: L(s.FootRight, s.AnkleRight)
    };
    const joints = CLEAN_BODY.slice(), idx = {};
    joints.forEach((nm, i) => { idx[nm] = i; });
    const p = [], st = [];
    for (let i = 0; i < n; i++) {
      const o = {};
      o.SpineBase = s.SpineBase[i];
      o.SpineMid = out(o.SpineBase, s.SpineMid[i], lens.spineLow, s.SpineBase[i]);
      o.SpineShoulder = out(o.SpineMid, s.SpineShoulder[i], lens.spineHigh, s.SpineMid[i]);
      o.Neck = out(o.SpineShoulder, s.Neck[i], lens.neck, s.SpineShoulder[i]);
      o.Head = out(o.Neck, s.Head[i], lens.head, s.Neck[i]);
      o.ShoulderLeft = out(o.SpineShoulder, s.ShoulderLeft[i], lens.shL, s.SpineShoulder[i]);
      o.ShoulderRight = out(o.SpineShoulder, s.ShoulderRight[i], lens.shR, s.SpineShoulder[i]);
      o.HipLeft = out(o.SpineBase, s.HipLeft[i], lens.hipL, s.SpineBase[i]);
      o.HipRight = out(o.SpineBase, s.HipRight[i], lens.hipR, s.SpineBase[i]);
      let [eL, hL] = bend(o.ShoulderLeft, gl[i], lens.upL, lens.foL, s.ElbowLeft[i]);
      let [eR, hR] = bend(o.ShoulderRight, gr[i], lens.upR, lens.foR, s.ElbowRight[i]);
      if (!pitching) {
        // One grip for both hands: if an arm can't reach it, use where that arm's reach ends, then fit both arms to it
        const g = len(sub(hL, gl[i])) >= len(sub(hR, gr[i])) ? hL : hR;
        [eR, hR] = bend(o.ShoulderRight, g, lens.upR, lens.foR, s.ElbowRight[i]);
        [eL, hL] = bend(o.ShoulderLeft, hR, lens.upL, lens.foL, s.ElbowLeft[i]);
        [eR] = bend(o.ShoulderRight, hL, lens.upR, lens.foR, s.ElbowRight[i]);
        hR = hL;
      }
      o.ElbowLeft = eL; o.ElbowRight = eR;
      ["WristLeft", "HandLeft", "HandTipLeft", "ThumbLeft"].forEach(h => { o[h] = hL; });
      ["WristRight", "HandRight", "HandTipRight", "ThumbRight"].forEach(h => { o[h] = hR; });
      [o.KneeLeft, o.AnkleLeft] = bend(o.HipLeft, s.AnkleLeft[i], lens.thL, lens.shinL, s.KneeLeft[i]);
      [o.KneeRight, o.AnkleRight] = bend(o.HipRight, s.AnkleRight[i], lens.thR, lens.shinR, s.KneeRight[i]);
      o.FootLeft = out(o.AnkleLeft, s.FootLeft[i], lens.ftL, s.AnkleLeft[i]);
      o.FootRight = out(o.AnkleRight, s.FootRight[i], lens.ftR, s.AnkleRight[i]);
      const row = [];
      let states = "";
      joints.forEach(nm => {
        row.push(o[nm][0] * 1000, o[nm][1] * 1000, o[nm][2] * 1000);
        const q = CLEAN_HANDS.has(nm) ? (nm.endsWith("Left") ? tL.Q[i] : tR.Q[i]) : raw[nm].Q[i];
        states += q === 2 ? "T" : "I";
      });
      p.push(row); st.push(states);
    }
    const cleaned = { t, p, s: st, idx, n, end: d.end, cleaned: true };
    cleanCache.set(d, Object.assign(cached || {}, { [key]: cleaned }));
    return cleaned;
  }

  function frameIndex(d, ms) {
    let lo = 0, hi = d.n - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (d.t[mid] <= ms) lo = mid; else hi = mid - 1; }
    return lo;
  }
