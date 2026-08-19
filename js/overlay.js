import { supabase, db } from './supabase.js';
import { safeBases, currentBatter, currentPitcher, pitchCount, fieldingSide, battingSide, fielderAt, FIELD_POSITIONS, battingOrderCard } from './logic.js';
import { playAnimation, setRally } from './anim.js';
import * as audio from './audio.js';

const params = new URLSearchParams(location.search);
const gameId = params.get('game');
if (params.get('debug')) { document.body.classList.add('debug'); window.__audio = audio; }
// The OBS replay relay is on by default. Add &replay=0 to any EXTRA copy of the
// overlay (a second scene, a preview tab) so one press doesn't save two clips.
const replayEnabled = !/^(0|off|no|false)$/i.test(params.get('replay') || '');

const el = {
  bug: document.getElementById('bug'),
  awayAbbr: document.getElementById('away-abbr'),
  homeAbbr: document.getElementById('home-abbr'),
  awayRuns: document.getElementById('away-runs'),
  homeRuns: document.getElementById('home-runs'),
  inning: document.getElementById('inning'),
  balls: document.getElementById('balls'),
  strikes: document.getElementById('strikes'),
  outs: document.getElementById('outs'),
};

let last = null; // keep last-known state; never blank on disconnect
let lastAnimNonce = 0; // only play strictly-newer triggers (reload/undo never replay)
let animPrimed = false; // set on the first render, so a game whose trigger is still
                        // null doesn't swallow its very first stinger

function showSituation(sport) {
  document.querySelectorAll('.situation').forEach((n) => { n.hidden = !n.classList.contains('sit-' + sport); });
}
function setDots(id, n) {
  const c = document.getElementById(id);
  if (c) c.querySelectorAll('.d').forEach((d, i) => d.classList.toggle('on', i < (n | 0)));
}
function renderBaseball(s) {
  el.inning.textContent = `${s.half === 'top' ? '▲' : '▼'}${s.inning}`;
  el.balls.textContent = s.balls;
  el.strikes.textContent = s.strikes;
  el.outs.querySelectorAll('.dot').forEach((d, i) => d.classList.toggle('on', i < (s.outs | 0)));
  setDots('bso-b', s.balls); setDots('bso-s', s.strikes); setDots('bso-o', s.outs);
  const b = safeBases(s.bases);
  document.getElementById('b1').classList.toggle('on', b.first);
  document.getElementById('b2').classList.toggle('on', b.second);
  document.getElementById('b3').classList.toggle('on', b.third);
}
function renderFootball(s) {
  const st = s.state || {};
  document.getElementById('fb-quarter').textContent = 'Q' + (st.quarter || 1);
  const down = st.down || 1, dist = st.distance;
  const ord = { 1: '1ST', 2: '2ND', 3: '3RD', 4: '4TH' }[down] || down + 'TH';
  document.getElementById('fb-dd').textContent = dist === 'goal' ? `${ord} & GOAL` : `${ord} & ${dist == null ? 10 : dist}`;
  const poss = st.possession;
  document.getElementById('fb-poss').textContent = poss === 'away' ? `🏈 ${s.away_abbr || ''}` : poss === 'home' ? `${s.home_abbr || ''} 🏈` : '';
}

function renderVolleyball(s) {
  const st = s.state || {};
  const sets = st.sets || {};
  document.getElementById('vb-set').textContent = 'SET ' + (st.set || 1);
  document.getElementById('vb-sets').textContent = `Sets ${sets.away || 0}–${sets.home || 0}`;
  const abbr = st.serve === 'away' ? (s.away_abbr || 'AWAY') : st.serve === 'home' ? (s.home_abbr || 'HOME') : '';
  document.getElementById('vb-serve').textContent = abbr ? `● ${abbr}` : '';
}

function renderBasketball(s) {
  const st = s.state || {};
  const f = st.fouls || {};
  document.getElementById('bk-q').textContent = 'Q' + (st.period || 1);
  document.getElementById('bk-fouls').textContent = `FOULS ${f.away | 0}·${f.home | 0}`;
}

function ordinalHalf(h) { return h === 2 ? '2nd' : h === 1 ? '1st' : String(h); }
function soccerElapsed(s) {
  const c = (s.state && s.state.clock) || {};
  return c.running && c.since ? (c.base || 0) + (Date.now() - new Date(c.since).getTime()) / 1000 : (c.base || 0);
}
function renderSoccer(s) {
  const st = s.state || {};
  document.getElementById('sc-half').textContent = ordinalHalf(st.half || 1);
  document.getElementById('sc-stoppage').textContent = st.stoppage ? `+${st.stoppage}` : '';
}

function render(s) {
  if (!s) return;
  last = s;
  const sport = s.sport || 'baseball';
  el.awayAbbr.textContent = s.away_abbr || s.away_name;
  el.homeAbbr.textContent = s.home_abbr || s.home_name;
  el.awayRuns.textContent = s.away_score;
  el.homeRuns.textContent = s.home_score;
  popOnScore('away', s.away_score);
  popOnScore('home', s.home_score);
  setLogo('away-logo', s.away_logo_url);
  setLogo('home-logo', s.home_logo_url);

  // Compact live H/E next to each team's runs (baseball only, opt-in toggle).
  const rheOn = !!s.show_rhe && sport === 'baseball';
  document.body.classList.toggle('rhe', rheOn);
  if (rheOn) {
    document.getElementById('away-h').textContent = s.away_hits | 0;
    document.getElementById('away-e').textContent = s.away_errors | 0;
    document.getElementById('home-h').textContent = s.home_hits | 0;
    document.getElementById('home-e').textContent = s.home_errors | 0;
  }

  showSituation(sport);
  if (sport === 'football') renderFootball(s);
  else if (sport === 'soccer') renderSoccer(s);
  else if (sport === 'volleyball') renderVolleyball(s);
  else if (sport === 'basketball') renderBasketball(s);
  else renderBaseball(s);

  updateClock();
  updateDetail(s);
  renderCard(s);
  el.bug.dataset.ready = '1';

  // Sport, theme, position, and scale (live).
  document.body.dataset.sport = sport;
  document.body.dataset.style = s.style || 'bar';
  document.body.dataset.theme = s.theme || 'nightgame';
  document.body.dataset.pos = s.scorebug_position || 'bottom-bar';
  document.body.style.setProperty('--scale', s.scorebug_scale || 1);
  applyLook(s);

  // Ambient rally state (persistent) + audio settings/pack.
  setRally(s.rally_mode);
  audio.setPack(s.sound_pack);
  audio.setSettings(s.audio);

  // Transient animation trigger: play only if the nonce is strictly newer than
  // the last one we saw. On first paint we just record it (no replay on load),
  // and because nonces are timestamps, an undo restoring an older one won't fire.
  const a = s.current_animation;
  const nonce = (a && Number(a.nonce)) || 0;
  if (!animPrimed) { animPrimed = true; lastAnimNonce = nonce; } // first paint: adopt, don't play
  else if (nonce > lastAnimNonce) { lastAnimNonce = nonce; playAnimation(a); audio.play(a.type); }

  replayHello();
  handleReplay(s.replay_cmd);
}

// Audio needs one gesture in a normal browser; OBS browser sources autoplay.
audio.resume();
document.addEventListener('pointerdown', () => { audio.resume(); setTimeout(refreshSoundHint, 60); });
function refreshSoundHint() { const h = document.getElementById('sound-hint'); if (h) h.hidden = !audio.isSuspended(); }
window.setTimeout(refreshSoundHint, 600);
document.getElementById('sound-hint')?.addEventListener('click', () => { Promise.resolve(audio.resume()).then(() => setTimeout(refreshSoundHint, 60)); });

const LOOK_FONTS = {
  condensed: '"Roboto Condensed", "Arial Narrow", system-ui, sans-serif',
  clean: '"Helvetica Neue", Arial, system-ui, sans-serif',
  mono: 'ui-monospace, Menlo, Consolas, monospace',
  serif: '"Times New Roman", Georgia, serif',
  system: 'system-ui, -apple-system, "Segoe UI", sans-serif',
};
function setVar(el, name, val) { if (val) el.style.setProperty(name, val); else el.style.removeProperty(name); }
const LOGO_SIZES = { sm: '22px', lg: '40px' };
function fillOf(el, type, c1, c2, angle) {
  if (!el) return;
  if (type === 'gradient' && c1 && c2) el.style.background = `linear-gradient(${angle ?? 180}deg, ${c1}, ${c2})`;
  else if (type === 'solid' && c1) el.style.background = c1;
  else el.style.background = '';
}
function applyLook(s) {
  const b = document.body;
  // Customizations apply ONLY to the Custom theme; built-in themes stay as designed.
  const L = (s.theme === 'custom') ? (s.look || {}) : {};
  const bugEl = document.getElementById('bug');
  const aw = document.querySelector('.team.away'), hm = document.querySelector('.team.home');

  setVar(b, '--accent', L.accent);
  setVar(b, '--chalk', L.text);
  setVar(b, '--steel', L.steel);
  setVar(b, '--line', L.line);
  setVar(b, '--disp', L.font ? LOOK_FONTS[L.font] : '');
  setVar(b, '--radius', (L.radius != null && L.radius !== '') ? parseInt(L.radius, 10) + 'px' : '');
  setVar(b, '--logo-size', L.logoSize ? LOGO_SIZES[L.logoSize] : '');
  setVar(b, '--bd-width', (L.border != null && L.border !== '') ? parseInt(L.border, 10) + 'px' : '');

  // Per-row / panel fills (shared gradient angle).
  fillOf(bugEl, L.panelType, L.panelC1, L.panelC2, L.angle);
  fillOf(aw, L.awayType, L.awayC1, L.awayC2, L.angle);
  fillOf(hm, L.homeType, L.homeC1, L.homeC2, L.angle);
  document.querySelectorAll('.situation').forEach((sit) => fillOf(sit, L.sitType, L.sitC1, L.sitC2, L.angle));

  b.classList.toggle('team-fill', !!L.teamFill);
  b.classList.toggle('no-logos', !!L.hideLogos);
  b.classList.toggle('no-detail', !!L.hideDetail);
  b.classList.toggle('no-shadow', !!L.noShadow);
  b.classList.toggle('uppercase', !!L.uppercase);
  b.classList.toggle('team-bars', !!L.teamBars);
  // Team colors (for team-bars / team-fill) always come from the game, not the look.
  if (aw) aw.style.setProperty('--tc', s.away_color || '#888');
  if (hm) hm.style.setProperty('--tc', s.home_color || '#888');
}

// Pop a team's runs when the score goes UP (a run scored). Skips the first paint
// and reconnects (prev is null) and manual decrements.
const prevScore = { away: null, home: null };
function popOnScore(side, val) {
  const el2 = document.getElementById(side + '-runs');
  if (el2 && prevScore[side] != null && val > prevScore[side]) {
    el2.classList.remove('scored'); void el2.offsetWidth; el2.classList.add('scored');
  }
  prevScore[side] = val;
}

const failedLogos = new Set();
function setLogo(id, url) {
  const img = document.getElementById(id);
  if (url && !failedLogos.has(url)) {
    if (img.getAttribute('src') !== url) img.src = url;
    img.onerror = () => { failedLogos.add(url); img.hidden = true; img.removeAttribute('src'); };
    img.hidden = false;
  } else { img.hidden = true; img.removeAttribute('src'); }
}

function fmtClock(sec) {
  sec = Math.max(0, Math.round(sec));
  return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0');
}
function remainingSeconds(s) {
  if (!s || !s.time_limit_seconds) return null;
  if (s.clock_running && s.clock_ends_at) return (new Date(s.clock_ends_at).getTime() - Date.now()) / 1000;
  return s.clock_remaining_seconds ?? s.time_limit_seconds;
}
// The clock elements are static; cache them and skip DOM writes when nothing
// changed — this ticks at 4 Hz forever inside OBS, so idle ticks must be free.
const clockEls = [...document.querySelectorAll('.js-clock')];
let clockPainted = null;
function paintClock(hidden, text, low, zero) {
  const key = `${hidden}|${text}|${low}|${zero}`;
  if (key === clockPainted) return;
  clockPainted = key;
  for (const c of clockEls) {
    c.hidden = hidden;
    if (hidden) continue;
    c.textContent = text;
    c.classList.toggle('low', low);
    c.classList.toggle('zero', zero);
  }
}
function updateClock() {
  const s = last;
  if (!s) return;
  const sport = s.sport || 'baseball';
  if (sport === 'soccer') return paintClock(false, fmtClock(soccerElapsed(s)), false, false);
  const rem = remainingSeconds(s);
  // Football/soccer clock is core (shows whenever a length is set); baseball's is
  // an optional time limit gated by show_clock.
  const showable = rem !== null && (sport !== 'baseball' || s.show_clock);
  if (!showable) return paintClock(true, '', false, false);
  paintClock(false, fmtClock(rem), rem <= 60 && rem > 0, rem <= 0);
}
// Local 4Hz tick so the countdown is smooth without hammering the DB.
setInterval(updateClock, 250);

function toDots(n, max = 3) { let out = ''; for (let i = 0; i < max; i++) out += i < (n | 0) ? '●' : '○'; return out; }
function updateDetail(s) {
  const el2 = document.getElementById('detail');
  const parts = [];
  const sport = s.sport || 'baseball';
  if (sport === 'football') {
    const st = s.state || {};
    parts.push(`<span><span class="k">${escapeHtml(s.away_abbr || 'AWAY')} TO</span>${toDots(st.away_timeouts ?? 3)}</span>`);
    parts.push(`<span><span class="k">${escapeHtml(s.home_abbr || 'HOME')} TO</span>${toDots(st.home_timeouts ?? 3)}</span>`);
    el2.innerHTML = parts.join(''); el2.hidden = false;
    return;
  }
  if (sport === 'volleyball') {
    const st = s.state || {};
    if (st.target && st.target !== 25) parts.push(`<span><span class="k">SET TO</span>${st.target | 0}</span>`);
    if (parts.length) { el2.innerHTML = parts.join(''); el2.hidden = false; } else el2.hidden = true;
    return;
  }
  if (sport === 'basketball') {
    const st = s.state || {};
    const to = st.timeouts || {};
    const f = st.fouls || {};
    parts.push(`<span><span class="k">${escapeHtml(s.away_abbr || 'AWAY')} TO</span>${toDots(to.away ?? 4, 4)}</span>`);
    parts.push(`<span><span class="k">${escapeHtml(s.home_abbr || 'HOME')} TO</span>${toDots(to.home ?? 4, 4)}</span>`);
    // Bonus: opponent team fouls put you in it (7 = one-and-one, 10 = double).
    const bonus = (team) => { const opp = team === 'home' ? (f.away | 0) : (f.home | 0); return opp >= 10 ? 'BONUS+' : opp >= 7 ? 'BONUS' : ''; };
    const ab = bonus('away'), hb = bonus('home');
    if (ab) parts.push(`<span class="runrule">${escapeHtml(s.away_abbr || 'AWAY')} ${ab}</span>`);
    if (hb) parts.push(`<span class="runrule">${escapeHtml(s.home_abbr || 'HOME')} ${hb}</span>`);
    el2.innerHTML = parts.join(''); el2.hidden = false;
    return;
  }
  if (sport === 'soccer') {
    const c = (s.state && s.state.cards) || { home: {}, away: {} };
    const cardStr = (t) => `${'🟨'.repeat(c[t]?.y || 0)}${'🟥'.repeat(c[t]?.r || 0)}` || '';
    const a = cardStr('away'), h = cardStr('home');
    if (a) parts.push(`<span><span class="k">${escapeHtml(s.away_abbr || 'AWAY')}</span>${a}</span>`);
    if (h) parts.push(`<span><span class="k">${escapeHtml(s.home_abbr || 'HOME')}</span>${h}</span>`);
    if (parts.length) { el2.innerHTML = parts.join(''); el2.hidden = false; } else el2.hidden = true;
    return;
  }
  // Batter/pitcher prefer the live lineup (at-bat hitter, fielding-team pitcher),
  // falling back to the hand-typed fields when a team has no lineup entered.
  const lb = currentBatter(s);
  const batName = lb ? lb.name : s.batter_name, batNum = lb ? lb.num : s.batter_number;
  if (s.show_batter && (batName || batNum)) {
    const num = batNum ? `#${batNum} ` : '';
    parts.push(`<span><span class="k">AB</span>${num}${escapeHtml(batName || '')}</span>`);
  }
  const lp = currentPitcher(s);
  const pitName = lp ? lp.name : s.pitcher_name, pitNum = lp ? lp.num : '';
  if (s.show_pitcher && (pitName || pitNum)) {
    const num = pitNum ? `#${pitNum} ` : '';
    parts.push(`<span><span class="k">P</span>${num}${escapeHtml(pitName || '')}</span>`);
  }
  if (s.show_pitchcount) parts.push(`<span><span class="k">PC</span>${pitchCount(s)}</span>`);
  if (s.show_runrule && s.run_rule_diff && Math.abs((s.home_score | 0) - (s.away_score | 0)) >= s.run_rule_diff) {
    parts.push('<span class="runrule">RUN RULE</span>');
  }
  if (parts.length) { el2.innerHTML = parts.join(''); el2.hidden = false; }
  else el2.hidden = true;
}
const escapeHtml = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ---- Persistent broadcast cards (matchup / final / due-up / sponsor) -------
// Snapshot cards rebuild only on a new nonce. Lineup/defense cards also carry a
// live "signature" (batting side + current hitter + roster) so the on-air
// highlight and fielders track the game while the card stays up — refreshed in
// place so the entrance animation doesn't replay each update.
let lastCardKey = null, lastCardSig = null;
function cardSig(c, s) {
  if (c.type === 'lineup') {
    const side = (c.meta && c.meta.auto) ? battingSide(s) : ((c.meta && c.meta.side) || battingSide(s));
    const idx = ((s.state && s.state.batIdx) || {})[side] | 0;
    return `${side}:${idx}:${JSON.stringify((s.lineups || {})[side] || {})}`;
  }
  if (c.type === 'defense') {
    const side = fieldingSide(s);
    return `${side}:${JSON.stringify((s.lineups || {})[side] || {})}`;
  }
  return null; // other cards are pure snapshots
}
function renderCard(s) {
  const layer = document.getElementById('card');
  const c = s.card;
  const key = c && c.type ? `${c.type}:${c.nonce || 0}` : null;
  const sig = key ? cardSig(c, s) : null;
  if (key === lastCardKey && sig === lastCardSig) return;
  const remount = key !== lastCardKey;
  lastCardKey = key; lastCardSig = sig;
  if (!key) { layer.hidden = true; layer.innerHTML = ''; layer.classList.remove('lower'); return; }
  const html = buildCard(c, s);
  const cur = layer.querySelector('.card');
  if (remount || !cur) {
    layer.classList.toggle('lower', c.type === 'dueup');
    layer.innerHTML = html; // fresh card → play the entrance animation
  } else {
    const tmp = document.createElement('div'); tmp.innerHTML = html;
    const next = tmp.firstElementChild;
    if (next) cur.replaceChildren(...next.childNodes); // live refresh, no re-animation
    else layer.innerHTML = html;
  }
  layer.hidden = false;
}
function logoHtml(url) { return url ? `<img src="${escapeAttr(url)}" alt="">` : ''; }
const escapeAttr = (t) => String(t).replace(/"/g, '&quot;');
function buildCard(c, s) {
  const meta = c.meta || {};
  const aAbbr = escapeHtml(s.away_abbr || s.away_name || 'AWAY');
  const hAbbr = escapeHtml(s.home_abbr || s.home_name || 'HOME');
  if (c.type === 'matchup') {
    return `<div class="card matchup"><div class="card-vs">
      <div class="side">${logoHtml(s.away_logo_url)}<div class="cname">${escapeHtml(s.away_name || 'Visitor')}</div></div>
      <div class="vs">VS</div>
      <div class="side">${logoHtml(s.home_logo_url)}<div class="cname">${escapeHtml(s.home_name || 'Home')}</div></div>
    </div>${meta.text ? `<div class="card-meta">${escapeHtml(meta.text)}</div>` : ''}</div>`;
  }
  if (c.type === 'final') {
    let ls = '';
    if ((s.sport || 'baseball') === 'baseball' && Array.isArray(s.line_score) && s.line_score.length) {
      const cells = (side) => s.line_score.map((x) => `<td>${x?.[side] ?? 0}</td>`).join('');
      const heads = s.line_score.map((_, i) => `<th>${i + 1}</th>`).join('');
      ls = `<table class="linescore"><tr><th></th>${heads}<th class="rhe">R</th><th class="rhe">H</th><th class="rhe">E</th></tr>
        <tr><th>${aAbbr}</th>${cells('top')}<td class="rhe">${s.away_score | 0}</td><td class="rhe">${s.away_hits | 0}</td><td class="rhe">${s.away_errors | 0}</td></tr>
        <tr><th>${hAbbr}</th>${cells('bottom')}<td class="rhe">${s.home_score | 0}</td><td class="rhe">${s.home_hits | 0}</td><td class="rhe">${s.home_errors | 0}</td></tr></table>`;
    }
    return `<div class="card final"><div class="card-sub">Final</div>
      <div class="card-scoreline">
        <div class="side"><span class="n">${aAbbr}</span><span class="r">${s.away_score | 0}</span></div>
        <div class="side"><span class="n">${hAbbr}</span><span class="r">${s.home_score | 0}</span></div>
      </div>${ls}</div>`;
  }
  if (c.type === 'dueup') {
    // Prefer the auto-snapshot of the next 3 hitters; fall back to typed text.
    const body = Array.isArray(meta.lines) && meta.lines.length
      ? `<div class="du-list">${meta.lines.map((n) => `<span>${escapeHtml(n)}</span>`).join('')}</div>`
      : `<span>${escapeHtml(meta.text || '')}</span>`;
    return `<div class="card lower-card"><b>Due Up</b>${body}</div>`;
  }
  if (c.type === 'lineup') {
    const side = meta.auto ? battingSide(s) : (meta.side || battingSide(s));
    const teamName = escapeHtml(side === 'home' ? (s.home_name || 'Home') : (s.away_name || 'Visitor'));
    const rows = battingOrderCard(s, side).map((r) =>
      `<tr class="${r.current ? 'lc-cur' : ''}"><td class="lc-ord">${r.order}</td><td class="lc-num">${r.num ? escapeHtml(r.num) : ''}</td><td class="lc-name">${escapeHtml(r.name)}</td><td class="lc-pos">${escapeHtml(r.pos)}</td></tr>`
    ).join('');
    return `<div class="card lineupcard"><div class="card-sub">Lineup — ${teamName}</div><table class="lc-table">${rows || '<tr><td class="lc-name">No lineup set</td></tr>'}</table></div>`;
  }
  if (c.type === 'defense') {
    const side = fieldingSide(s); // defense always tracks the team in the field
    const teamName = escapeHtml(side === 'home' ? (s.home_name || 'Home') : (s.away_name || 'Visitor'));
    const spot = (pos) => {
      const f = fielderAt(s, side, pos);
      const who = f
        ? `${f.num ? `<span class="dc-num">${escapeHtml(f.num)}</span>` : ''}<span class="dc-name">${escapeHtml(f.name || '')}</span>`
        : '<span class="dc-empty">—</span>';
      return `<div class="dc-pos" data-pos="${pos}"><span class="dc-lab">${pos}</span>${who}</div>`;
    };
    return `<div class="card defense"><div class="card-sub">Defense — ${teamName}</div>
      <div class="dc-field">${FIELD_POSITIONS.map(spot).join('')}</div></div>`;
  }
  if (c.type === 'sponsor') {
    return `<div class="card sponsor"><div class="card-sub">Brought to you by</div><div class="card-title">${escapeHtml(meta.text || 'Sponsor')}</div></div>`;
  }
  return '';
}

// ---- OBS replay buffer ----------------------------------------------------
// OBS injects window.obsstudio into every browser source. saveReplayBuffer()
// needs the source's Page permissions at BASIC (level 3) or higher. The control
// pad can't call it — there's no obsstudio outside OBS — so it stamps
// replay_cmd.nonce and we relay it here, then ack back so the pad can say what
// actually happened. The overlay is anonymous, hence the definer RPC.
const REPLAY_TIMEOUT = 700; // obsstudio callbacks are local; this is just a guard

function obsAsk(fn, fallback) {
  return new Promise((resolve) => {
    const o = window.obsstudio;
    if (!o || typeof o[fn] !== 'function') return resolve(fallback);
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    try { o[fn]((v) => finish(v)); } catch { return finish(fallback); }
    setTimeout(() => finish(fallback), REPLAY_TIMEOUT);
  });
}
// -1 = not running inside OBS at all. getControlLevel needs no permission, so a
// missing answer means an old obs-browser: infer from saveReplayBuffer itself.
async function obsControlLevel() {
  const o = window.obsstudio;
  if (!o) return -1;
  const guess = typeof o.saveReplayBuffer === 'function' ? 3 : 0;
  const lvl = await obsAsk('getControlLevel', null);
  return lvl == null ? guess : (lvl | 0);
}
const canSaveReplay = (level) => level >= 3 && typeof window.obsstudio?.saveReplayBuffer === 'function';

function ackReplay(nonce, ok, code, level, buffering) {
  return db.rpc('ack_replay', {
    p_game: gameId, p_nonce: nonce, p_ok: ok, p_code: code,
    p_level: level ?? null, p_buffering: buffering ?? null,
  }).then(({ error }) => { if (error) console.warn('replay ack failed', error.message); });
}

// One capability report per load, so the pad knows the link is alive before the
// first press. Stays silent outside OBS — a preview tab must not clobber the
// real source's status.
let helloSent = false;
async function replayHello() {
  if (helloSent || !replayEnabled || !gameId) return;
  helloSent = true;
  const level = await obsControlLevel();
  if (level < 0) return;
  const st = await obsAsk('getStatus', null);
  await ackReplay(0, canSaveReplay(level), 'hello', level, st ? !!st.replaybuffer : null);
}

let lastReplayNonce = 0;
let replayPrimed = false;
async function handleReplay(cmd) {
  if (!replayEnabled || !gameId) return;
  const nonce = (cmd && Number(cmd.nonce)) || 0;
  // Adopt whatever is on the row at first paint (usually nothing) so a reload
  // never re-clips, then fire on anything strictly newer.
  if (!replayPrimed) { replayPrimed = true; lastReplayNonce = nonce; return; }
  if (!nonce || nonce <= lastReplayNonce) return;
  lastReplayNonce = nonce;

  const level = await obsControlLevel();
  if (level < 0) return; // plain browser tab: stay silent so it can't clobber the real source's ack
  if (!canSaveReplay(level)) return ackReplay(nonce, false, 'noperm', level, null);
  const st = await obsAsk('getStatus', null);
  const buffering = st ? !!st.replaybuffer : null;
  if (buffering === false) return ackReplay(nonce, false, 'nobuffer', level, false);
  try { window.obsstudio.saveReplayBuffer(); }
  catch (e) { return ackReplay(nonce, false, 'failed', level, buffering); }
  return ackReplay(nonce, true, 'saved', level, buffering);
}

async function fetchState() {
  if (!gameId) return;
  const { data, error } = await db.from('games').select('*').eq('id', gameId).maybeSingle();
  if (!error && data) render(data);
}

// ---- Realtime with auto-reconnect + exponential backoff -------------------
// Robust against flaky LTE: each attempt uses a UNIQUE channel name (so a not-yet
// removed channel can't collide and throw), callbacks from stale channels are
// ignored, and only one reconnect is ever pending at a time.
let channel = null;
let backoff = 1000;
let reconnectTimer = null;
let subGen = 0;

function teardown() {
  if (channel) { const c = channel; channel = null; supabase.removeChannel(c); }
}

function subscribe() {
  if (!gameId) return;
  teardown();
  const myGen = ++subGen;
  channel = supabase.channel(`overlay:${gameId}:${myGen}`);
  channel
    .on('postgres_changes', { event: 'UPDATE', schema: 'scoreboard', table: 'games', filter: `id=eq.${gameId}` },
      (payload) => render(payload.new))
    .subscribe((status) => {
      if (myGen !== subGen) return; // ignore callbacks from a superseded channel
      if (status === 'SUBSCRIBED') { backoff = 1000; fetchState(); }
      else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') scheduleReconnect();
    });
}

function scheduleReconnect() {
  if (reconnectTimer) return; // one pending reconnect only
  teardown();
  reconnectTimer = window.setTimeout(() => { reconnectTimer = null; subscribe(); }, backoff);
  backoff = Math.min(backoff * 2, 15000);
}

// Flaky-LTE guards: re-pull fresh state when the network or tab comes back.
addEventListener('online', fetchState);
document.addEventListener('visibilitychange', () => { if (!document.hidden) fetchState(); });

if (!gameId) {
  el.bug.innerHTML = '<div class="err">Add ?game=&lt;id&gt; to the URL</div>';
  el.bug.dataset.ready = '1';
} else {
  fetchState();
  subscribe();
}
