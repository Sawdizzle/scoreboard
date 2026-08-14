import { supabase, db } from './supabase.js';
import { safeBases, currentBatter, currentPitcher, pitchCount, fieldingSide, battingSide, fielderAt, FIELD_POSITIONS, battingOrderCard } from './logic.js';
import { playAnimation, setRally } from './anim.js';
import * as audio from './audio.js';

const params = new URLSearchParams(location.search);
const gameId = params.get('game');
if (params.get('debug')) { document.body.classList.add('debug'); window.__audio = audio; }

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
  const nonce = a && Number(a.nonce);
  if (nonce) {
    if (lastAnimNonce === 0) lastAnimNonce = nonce;      // first paint: adopt, don't play
    else if (nonce > lastAnimNonce) { lastAnimNonce = nonce; playAnimation(a); audio.play(a.type); }
  }
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

function setLogo(id, url) {
  const img = document.getElementById(id);
  if (url) { if (img.getAttribute('src') !== url) img.src = url; img.hidden = false; }
  else { img.hidden = true; img.removeAttribute('src'); }
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
function updateClock() {
  const s = last;
  if (!s) return;
  const sport = s.sport || 'baseball';
  if (sport === 'soccer') {
    const e = fmtClock(soccerElapsed(s));
    document.querySelectorAll('.js-clock').forEach((c) => { c.hidden = false; c.textContent = e; c.classList.remove('low', 'zero'); });
    return;
  }
  const rem = remainingSeconds(s);
  // Football/soccer clock is core (shows whenever a length is set); baseball's is
  // an optional time limit gated by show_clock.
  const showable = rem !== null && (sport !== 'baseball' || s.show_clock);
  document.querySelectorAll('.js-clock').forEach((c) => {
    c.hidden = !showable;
    if (!showable) return;
    c.textContent = fmtClock(rem);
    c.classList.toggle('low', rem <= 60 && rem > 0);
    c.classList.toggle('zero', rem <= 0);
  });
}
// Local 4Hz tick so the countdown is smooth without hammering the DB.
setInterval(updateClock, 250);

function toDots(n) { let out = ''; for (let i = 0; i < 3; i++) out += i < (n | 0) ? '●' : '○'; return out; }
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
let lastCardKey = null;
function renderCard(s) {
  const layer = document.getElementById('card');
  const c = s.card;
  const key = c && c.type ? `${c.type}:${c.nonce || 0}` : null;
  if (key === lastCardKey) return; // only rebuild when the card actually changes
  lastCardKey = key;
  if (!key) { layer.hidden = true; layer.innerHTML = ''; layer.classList.remove('lower'); return; }
  layer.classList.toggle('lower', c.type === 'dueup');
  layer.innerHTML = buildCard(c, s);
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
    const side = meta.side || battingSide(s);
    const teamName = escapeHtml(side === 'home' ? (s.home_name || 'Home') : (s.away_name || 'Visitor'));
    const rows = battingOrderCard(s, side).map((r) =>
      `<tr class="${r.current ? 'lc-cur' : ''}"><td class="lc-ord">${r.order}</td><td class="lc-num">${r.num ? escapeHtml(r.num) : ''}</td><td class="lc-name">${escapeHtml(r.name)}</td><td class="lc-pos">${escapeHtml(r.pos)}</td></tr>`
    ).join('');
    return `<div class="card lineupcard"><div class="card-sub">Lineup — ${teamName}</div><table class="lc-table">${rows || '<tr><td class="lc-name">No lineup set</td></tr>'}</table></div>`;
  }
  if (c.type === 'defense') {
    const side = meta.side || fieldingSide(s);
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
