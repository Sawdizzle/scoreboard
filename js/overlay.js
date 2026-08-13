import { supabase, db } from './supabase.js';
import { safeBases } from './logic.js';
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
function renderBaseball(s) {
  el.inning.textContent = `${s.half === 'top' ? '▲' : '▼'}${s.inning}`;
  el.balls.textContent = s.balls;
  el.strikes.textContent = s.strikes;
  el.outs.querySelectorAll('.dot').forEach((d, i) => d.classList.toggle('on', i < (s.outs | 0)));
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

  showSituation(sport);
  if (sport === 'football') renderFootball(s);
  else if (sport === 'soccer') renderSoccer(s);
  else renderBaseball(s);

  updateClock();
  updateDetail(s);
  el.bug.dataset.ready = '1';

  // Sport, theme, position, and scale (live).
  document.body.dataset.sport = sport;
  document.body.dataset.style = s.style || 'bar';
  document.body.dataset.theme = s.theme || 'nightgame';
  document.body.dataset.pos = s.scorebug_position || 'bottom-bar';
  document.body.style.setProperty('--scale', s.scorebug_scale || 1);

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
  if (s.show_batter && (s.batter_name || s.batter_number)) {
    const num = s.batter_number ? `#${s.batter_number} ` : '';
    parts.push(`<span><span class="k">AB</span>${num}${escapeHtml(s.batter_name || '')}</span>`);
  }
  if (s.show_pitcher && s.pitcher_name) parts.push(`<span><span class="k">P</span>${escapeHtml(s.pitcher_name)}</span>`);
  if (s.show_pitchcount) parts.push(`<span><span class="k">PC</span>${s.pitch_count | 0}</span>`);
  if (s.show_runrule && s.run_rule_diff && Math.abs((s.home_score | 0) - (s.away_score | 0)) >= s.run_rule_diff) {
    parts.push('<span class="runrule">RUN RULE</span>');
  }
  if (parts.length) { el2.innerHTML = parts.join(''); el2.hidden = false; }
  else el2.hidden = true;
}
const escapeHtml = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

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
