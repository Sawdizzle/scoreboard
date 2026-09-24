/* ============================================================
   BugKit — the shared half of every animated scorebug prototype.

   It owns the game state, the 1920x1080 stage, the public API,
   the preview demo panel and the demo game logic. Each bug page
   only supplies how things LOOK and MOVE:

     BugKit.start({
       name: "Classic Green",
       hrDelay: 1800,               // ms before a home run's runs land
       render(S, prev, first) {},   // paint state; prev = last painted state
       fx: { hr(o){}, k(o){}, run(o){}, ... }   // one-shot moments
     });

   Moments a bug may handle (all optional):
     ball  strike  foul  out  walk  error
     hit   {bases:1|2|3, batter}
     run   {team, runs, hr?}
     hr    {team, runs, batter}
     k     {looking, batter}
     half  {inning, half}
     reset
   Order: a play's moments fire BEFORE render() paints the new state,
   so a moment sees the old DOM and the new S (passed as 2nd arg).

   Public API (same on every bug, so the live overlay needs one adapter):
     Scoreboard.set({ home:{ r:3 }, outs:2 })
     Scoreboard.fire("hr", { runs:2, batter:"Name" })
     postMessage({type:"scoreboard:set", state:{...}})
     postMessage({type:"scoreboard:fire", name:"hr", opts:{...}})

   Live overlay (the app's /overlay, which loads a bug with ?embed=1):
     postMessage({type:"scoreboard:live", state:{...}, anim:{type, meta}|null,
                  view:{pos:"bc", scale:1, lift:60}})
   live() turns each new game row into the right moments: a home run holds
   the runs back until the bug's banner lands (hrDelay), and a third out
   shows three outs before the half rolls.

   Positions: tl tc tr / ml mc mr / bl bc br. A bug's own moments only
   know corners, so place() and body[data-pos] get the nearest corner
   (a middle row reads as top, a centre column as left).

   URL params: ?obs=1 (no panel, transparent)  ?panel=0 (no panel)
               ?embed=1 (inside the live overlay: waits for live messages)
               ?pos=tl|tc|…|br  ?scale=1.2
               ?auto=1 (plays a game by itself)
               ?play=single,double,hr&gap=900 (scripted, for screenshots)
   ============================================================ */
(() => {
  const DEFAULT = {
    away: { name: "Lakeside Hawks", abbr: "HAWKS", color: "#C8102E", r: 0, h: 0, e: 0, line: [] },
    home: { name: "Blue Steel", abbr: "STEEL", color: "#5B8FC9", r: 0, h: 0, e: 0, line: [] },
    inning: 1, half: "top", balls: 0, strikes: 0, outs: 0,
    bases: [false, false, false], batter: "Carter Hayes", pitcher: "Wes Moreno", pitchCount: 0
  };
  const PITCHERS = { home: "Wes Moreno", away: "Dale Ruiz" }; // keyed by fielding team
  const HITTERS = ["Carter Hayes", "Mason Pruitt", "Eli Navarro", "Jace Whitfield", "Rowan Diaz", "Luke Tran", "Theo Banks", "Cruz Molina", "Nate Oduya"];

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const params = new URLSearchParams(location.search);
  const clone = (o) => structuredClone(o);
  const restart = (el, cls) => { el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); };
  const battingTeam = (S) => (S.half === "top" ? "away" : "home");
  const fieldingTeam = (S) => (S.half === "top" ? "home" : "away");

  const BASE_CSS = `
    *{box-sizing:border-box;margin:0;padding:0}
    html,body{width:100%;height:100%;overflow:hidden;background:transparent}
    body.preview{background:
      radial-gradient(ellipse at 50% 130%,#6f5236 0%,#4b3a28 18%,transparent 19%),
      repeating-linear-gradient(115deg,rgba(255,255,255,.035) 0 90px,transparent 90px 180px),
      radial-gradient(ellipse at 50% 110%,#3f7a3c 0%,#23462a 50%,#0f1d12 100%)}
    #stage{position:absolute;left:0;top:0;width:1920px;height:1080px;transform-origin:0 0;overflow:hidden}
    #bug{position:absolute;--lift:0px}
    #bug.pos-tl{left:48px;top:44px;transform-origin:0 0}
    #bug.pos-tc{left:50%;top:44px;translate:-50% 0;transform-origin:50% 0}
    #bug.pos-tr{right:48px;top:44px;transform-origin:100% 0}
    #bug.pos-ml{left:48px;top:50%;translate:0 -50%;transform-origin:0 50%}
    #bug.pos-mc{left:50%;top:50%;translate:-50% -50%;transform-origin:50% 50%}
    #bug.pos-mr{right:48px;top:50%;translate:0 -50%;transform-origin:100% 50%}
    #bug.pos-bl{left:48px;bottom:calc(44px + var(--lift));transform-origin:0 100%}
    #bug.pos-bc{left:50%;bottom:calc(44px + var(--lift));translate:-50% 0;transform-origin:50% 100%}
    #bug.pos-br{right:48px;bottom:calc(44px + var(--lift));transform-origin:100% 100%}
    #demo{position:fixed;right:16px;bottom:16px;z-index:50;display:none;width:min(360px,calc(100vw - 32px));padding:14px;border-radius:12px;
      background:rgba(18,18,20,.93);border:1px solid rgba(255,255,255,.12);font:600 14px/1.3 system-ui,sans-serif;color:#eee;
      box-shadow:0 10px 30px rgba(0,0,0,.5);backdrop-filter:blur(8px)}
    body.preview.panel #demo{display:block}
    #demo h2{font:800 15px/1 system-ui,sans-serif;margin-bottom:10px;color:var(--demo-accent,#ffb23e);display:flex;justify-content:space-between;align-items:center;gap:8px}
    #demo h2 a{font:600 12px system-ui,sans-serif;color:#aaa;text-decoration:none}
    #demo h2 a:hover{color:#fff}
    #demo .row{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:6px}
    #demo button{flex:1 1 auto;min-width:64px;padding:9px 8px;border:0;border-radius:7px;background:#2c2c30;color:#f2f2f2;font:700 13px system-ui,sans-serif;cursor:pointer}
    #demo button:hover{background:#3d3d44}
    #demo button:focus-visible{outline:2px solid var(--demo-accent,#ffb23e);outline-offset:2px}
    #demo button.hot{background:color-mix(in srgb,var(--demo-accent,#ffb23e) 45%,#222);color:#fff}
    #demo button[aria-pressed="true"]{background:var(--demo-accent,#ffb23e);color:#111}
    #demo p{font-weight:400;font-size:12px;color:#999;margin-top:6px}
    #demo.min .row,#demo.min p{display:none}
    #demo.min h2{margin:0}
  `;

  const DEMO_HTML = (name) => `
    <h2><span>${name}</span><span><a href="/bugs">All bugs</a> · <a href="#" data-a="min">hide</a></span></h2>
    <div class="row"><button data-a="ball">Ball</button><button data-a="strike">Strike</button><button data-a="foul">Foul</button><button data-a="out">Out</button></div>
    <div class="row"><button data-a="single">Single</button><button data-a="double">Double</button><button data-a="triple">Triple</button><button data-a="error">Error</button></div>
    <div class="row"><button class="hot" data-a="hr">Home run</button><button class="hot" data-a="kswing">K swinging</button><button class="hot" data-a="klook">K looking</button><button data-a="walk">Walk</button></div>
    <div class="row"><button data-a="run">+1 Run</button><button data-a="half">Next half</button><button data-a="pos">Move bug</button><button data-a="reset">Reset</button></div>
    <div class="row"><button data-a="auto" aria-pressed="false">Auto-play a game</button></div>
    <p>Add <b>?obs=1</b> to hide this panel for OBS. <b>?auto=1</b> plays a game by itself.</p>`;

  function merge(target, src) {
    for (const k in src) {
      if (src[k] && typeof src[k] === "object" && !Array.isArray(src[k])) merge(target[k] ??= {}, src[k]);
      else target[k] = src[k];
    }
  }

  function start(theme) {
    let S = clone(DEFAULT);
    let painted = null;
    const style = document.createElement("style");
    style.textContent = BASE_CSS;
    document.head.prepend(style);

    /* ---------- Stage fit + preview mode ---------- */
    const stage = $("#stage"), bug = $("#bug");
    const embed = params.get("embed") === "1";
    const inOBS = embed || !!window.obsstudio || params.get("obs") === "1";
    if (!inOBS) document.body.classList.add("preview");
    if (!inOBS && params.get("panel") !== "0") document.body.classList.add("panel");
    const fit = () => { stage.style.transform = `scale(${Math.min(innerWidth / 1920, innerHeight / 1080)})`; };
    addEventListener("resize", fit); fit();

    const POS = ["tl", "tc", "tr", "ml", "mc", "mr", "bl", "bc", "br"];
    const DEMO_POS = ["tl", "tr", "bl", "br"];
    let pos = POS.includes(params.get("pos")) ? params.get("pos") : "tl";
    let scale = parseFloat(params.get("scale")) || 1;
    const corner = (p) => (p[0] === "b" ? "b" : "t") + (p[1] === "r" ? "r" : "l");
    const place = () => {
      POS.forEach((p) => bug.classList.remove("pos-" + p));
      bug.classList.add("pos-" + pos);
      bug.style.scale = scale;
      document.body.dataset.pos = corner(pos);
      theme.place?.(corner(pos));
    };
    place();

    /* ---------- Render + moments ---------- */
    function render() {
      const first = painted === null;
      theme.render(S, painted || S, first);
      painted = clone(S);
    }
    function emit(name, opts = {}) { theme.fx?.[name]?.(opts, S); }

    /* ---------- Public API ---------- */
    window.Scoreboard = {
      set(partial) { merge(S, partial); render(); },
      fire(name, opts) { emit(name, opts); },
      get() { return clone(S); }
    };
    addEventListener("message", (e) => {
      const d = e.data || {};
      if (d.type === "scoreboard:set") Scoreboard.set(d.state || {});
      if (d.type === "scoreboard:fire") Scoreboard.fire(d.name, d.opts);
      if (d.type === "scoreboard:live") live(d.state, d.anim, d.view);
    });

    /* ---------- Live: a new game row, and the stinger that came with it ----------
       The row already holds the result of the play, so the moment is worked out
       by comparing it with what is on screen now. */
    let hold = null;   // {team, runs}: home run runs kept off the board until the banner lands
    let roll = null;   // the half-roll waiting behind a third out
    let liveTimer = null;
    const PLAY_MOMENT = [
      [/^single/i, "hit", { bases: 1 }], [/^double(?! play)/i, "hit", { bases: 2 }], [/^triple/i, "hit", { bases: 3 }],
      [/walk|hit by pitch|catcher/i, "walk"], [/error/i, "error"], [/dropped 3rd/i, "k"],
      [/out|pop-up|choice|double play|sac |caught|picked/i, "out"]
    ];
    const forward = (a, b) => b.inning > a.inning || (b.inning === a.inning && a.half === "top" && b.half !== "top");

    function momentFor(prev, next, anim) {
      const t = anim && anim.type, bt = battingTeam(prev), ft = fieldingTeam(prev);
      const batter = prev.batter;
      if (t === "strikeout" || t === "strikeoutlooking") return ["k", { looking: t === "strikeoutlooking", batter }];
      if (t === "doubleplay") return ["out", { batter }];
      if (t === "bigplay" && next[bt].h > prev[bt].h) return ["hit", { bases: 3, batter }];
      if (t === "play" || t === "bigplay") {
        const text = (anim.meta && anim.meta.text) || "";
        for (const [re, name, extra] of PLAY_MOMENT) if (re.test(text)) return [name, { ...extra, batter, team: ft }];
        return null;
      }
      if (t && t !== "run" && t !== "walkoff") return null;
      // No stinger (or just "a run scored"): read the play off the row.
      if (forward(next, prev)) return null;                   // an undo across the half
      const rolled = forward(prev, next);
      const onBase = (x) => x.bases.filter(Boolean).length;
      if (next[bt].h > prev[bt].h) return ["hit", { bases: 1, batter }];
      if (next[ft].e > prev[ft].e) return ["error", { team: ft }];
      if (rolled || next.outs > prev.outs) return ["out", { batter }];
      if (prev.balls === 3 && next.balls === 0 && next.strikes === 0 && next.bases[0] &&
          (onBase(next) > onBase(prev) || next[bt].r > prev[bt].r)) return ["walk", { batter }];
      if (rolled) return null;
      if (next.balls > prev.balls) return ["ball", {}];
      if (next.strikes > prev.strikes) return ["strike", {}];
      return null;
    }

    function flushRoll() {
      if (!roll) return;
      clearTimeout(liveTimer);
      const r = roll; roll = null;
      S = r.next; emit("half", { inning: S.inning, half: S.half }); render();
    }
    function flushHold() {
      if (!hold) return;
      const h = hold; hold = null;
      clearTimeout(h.timer);
      S[h.team].r += h.runs; emit("run", { team: h.team, runs: h.runs, hr: true }); render();
    }

    function live(next, anim, view) {
      if (view) {
        if (POS.includes(view.pos)) pos = view.pos;
        scale = +view.scale || 1;
        bug.style.setProperty("--lift", (parseFloat(view.lift) || 0) + "px");
        place();
      }
      if (!next) return;
      next = clone(next);
      if (painted === null) { S = next; render(); return; }   // first paint: no moments
      flushRoll();
      if (hold && anim && anim.type === "homerun") flushHold();   // back-to-back homers
      const prev = S, bt = battingTeam(prev);
      if (hold) next[hold.team].r -= hold.runs;               // still behind the banner
      const runs = Math.max(0, next[bt].r - prev[bt].r);

      if (anim && anim.type === "homerun") {
        const n = runs || 1;
        next[bt].r -= runs;
        S = next;
        emit("hr", { runs: n, batter: prev.batter, team: bt });
        render();
        hold = { team: bt, runs, timer: setTimeout(flushHold, theme.hrDelay ?? 1800) };
        return;
      }

      const m = momentFor(prev, next, anim);
      if (forward(prev, next) && m && (m[0] === "out" || m[0] === "k")) {
        // Show the third out on the old half, then roll.
        S = { ...clone(prev), outs: 3, balls: 0, strikes: 0, away: next.away, home: next.home };
        emit(m[0], m[1]);
        if (runs) emit("run", { team: bt, runs });
        render();
        roll = { next };
        liveTimer = setTimeout(() => { flushRoll(); }, 1100);
        return;
      }
      S = next;
      if (m) emit(m[0], m[1]);
      if (runs) emit("run", { team: bt, runs });
      if (!m && forward(prev, next)) emit("half", { inning: S.inning, half: S.half });
      render();
    }

    /* ---------- Demo game logic (preview only) ---------- */
    let hi = 0, rolling = false;
    const timers = new Set(); // pending demo follow-ups; reset cancels them
    const later = (ms, fn) => { const t = setTimeout(() => { timers.delete(t); fn(); render(); }, ms); timers.add(t); };
    function nextBatter() { S.balls = 0; S.strikes = 0; hi = (hi + 1) % HITTERS.length; S.batter = HITTERS[hi]; }
    function score(n, extra = {}) {
      if (!n) return;
      const t = battingTeam(S);
      S[t].r += n;
      S[t].line[S.inning - 1] = (S[t].line[S.inning - 1] || 0) + n;
      emit("run", { team: t, runs: n, ...extra });
    }
    function addOut() {
      S.outs++;
      if (S.outs >= 3 && !rolling) { rolling = true; later(1100, () => { rolling = false; nextHalf(); }); }
    }
    const pitches = { home: 0, away: 0 };
    function nextHalf() {
      pitches[fieldingTeam(S)] = S.pitchCount;
      S.outs = 0; S.balls = 0; S.strikes = 0; S.bases = [false, false, false];
      if (S.half === "top") S.half = "bot"; else { S.half = "top"; S.inning++; }
      S.pitcher = PITCHERS[fieldingTeam(S)]; S.pitchCount = pitches[fieldingTeam(S)];
      const t = battingTeam(S);
      if (S[t].line[S.inning - 1] == null) S[t].line[S.inning - 1] = 0;
      emit("half", { inning: S.inning, half: S.half });
    }
    function advance(k) { // batter to base k (1..4), everyone moves k bases
      let runs = 0; const b = [false, false, false];
      S.bases.forEach((on, i) => { if (!on) return; const t = i + k; t >= 3 ? runs++ : (b[t] = true); });
      if (k >= 4) runs++; else b[k - 1] = true;
      S.bases = b; return runs;
    }
    function walk() {
      const b = S.bases.slice(); let runs = 0;
      if (b[0]) { if (b[1]) { if (b[2]) runs++; b[2] = true; } b[1] = true; }
      b[0] = true; S.bases = b;
      emit("walk", { batter: S.batter });
      score(runs);
    }
    function hit(k) {
      S.pitchCount++; S[battingTeam(S)].h++;
      const runs = advance(k);
      emit("hit", { bases: k, batter: S.batter });
      score(runs); nextBatter();
    }
    function strikeout(looking) {
      S.strikes = 3;
      emit("k", { looking, batter: S.batter });
      addOut(); later(900, nextBatter);
    }

    const ACT = {
      ball() { S.pitchCount++; if (++S.balls >= 4) { walk(); nextBatter(); } else emit("ball"); },
      strike() { S.pitchCount++; if (S.strikes >= 2) strikeout(false); else { S.strikes++; emit("strike"); } },
      foul() { S.pitchCount++; if (S.strikes < 2) S.strikes++; emit("foul"); },
      out() { S.pitchCount++; emit("out", { batter: S.batter }); addOut(); nextBatter(); },
      single() { hit(1); }, double() { hit(2); }, triple() { hit(3); },
      walk() { S.pitchCount++; S.balls = 4; walk(); nextBatter(); },
      error() {
        S.pitchCount++; S[fieldingTeam(S)].e++;
        emit("error", { team: fieldingTeam(S) });
        score(advance(1)); nextBatter();
      },
      run() { score(1); },
      hr() {
        S.pitchCount++;
        const n = 1 + S.bases.filter(Boolean).length, who = S.batter, team = battingTeam(S);
        S.bases = [false, false, false]; S[team].h++;
        emit("hr", { runs: n, batter: who, team });
        later(theme.hrDelay ?? 1800, () => { score(n, { hr: true }); nextBatter(); });
      },
      kswing() { S.pitchCount++; strikeout(false); },
      klook() { S.pitchCount++; strikeout(true); },
      half() { nextHalf(); },
      pos() { pos = DEMO_POS[(DEMO_POS.indexOf(pos) + 1) % DEMO_POS.length]; place(); },
      reset() { timers.forEach(clearTimeout); timers.clear(); rolling = false; S = clone(DEFAULT); hi = 0; pitches.home = pitches.away = 0; emit("reset"); }
    };
    function act(a) { if (ACT[a]) { ACT[a](); render(); } }

    /* ---------- Auto-play: a believable game, with the big moments a bit more often ---------- */
    const WEIGHTS = { ball: 30, strike: 20, foul: 11, out: 15, single: 8, double: 3, triple: 1, hr: 3, error: 2, klook: 2 };
    const bag = Object.entries(WEIGHTS).flatMap(([k, w]) => Array(w).fill(k));
    let autoTimer = null;
    function tick() {
      if (S.outs >= 3) return; // wait for the half to roll
      let a = bag[Math.floor(Math.random() * bag.length)];
      if (a === "klook" && S.strikes < 2) a = "strike";
      act(a);
      if (S.inning > 9) act("reset");
    }
    function setAuto(on) {
      clearInterval(autoTimer); autoTimer = null;
      if (on) { autoTimer = setInterval(tick, 1700); }
      const b = $('#demo [data-a="auto"]');
      if (b) b.setAttribute("aria-pressed", String(!!on));
    }

    /* ---------- Demo panel ---------- */
    const demo = document.createElement("div");
    demo.id = "demo"; demo.setAttribute("role", "region"); demo.setAttribute("aria-label", "Demo controls");
    demo.innerHTML = DEMO_HTML(theme.name);
    document.body.appendChild(demo);
    demo.addEventListener("click", (e) => {
      const el = e.target.closest("[data-a]");
      if (!el) return;
      const a = el.dataset.a;
      if (a === "min") { e.preventDefault(); demo.classList.toggle("min"); el.textContent = demo.classList.contains("min") ? "show" : "hide"; return; }
      if (a === "auto") { setAuto(!autoTimer); return; }
      act(a);
    });

    if (embed) { demo.remove(); return; }   // the live overlay drives it; the first row paints it
    render();
    if (params.get("auto") === "1") setAuto(true);
    const script = (params.get("play") || "").split(",").filter(Boolean);
    const gap = parseInt(params.get("gap")) || 900;
    script.forEach((a, i) => setTimeout(() => act(a), 400 + i * gap));
  }

  window.BugKit = { start, $, $$, restart, battingTeam, fieldingTeam, params };
})();
