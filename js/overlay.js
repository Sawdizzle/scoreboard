import { supabase, db } from './supabase.js';
import { safeBases, currentBatter, currentPitcher, pitchCount, fieldingSide, battingSide, fielderAt, FIELD_POSITIONS, battingOrderCard, teamLineup, normalizeRoster, dueUpCard, halfRecap, finishedHalf, finalStory } from './logic.js';
import { playAnimation, setRally } from './anim.js';
import * as audio from './audio.js';
import { startingCard, fitStartingNames, weatherHtml } from './starting.js';
import { fetchWeather } from './weather.js';
import { serverNow, syncClock, clockSkewMs } from './clock.js';

const params = new URLSearchParams(location.search);
const gameId = params.get('game');
if (params.get('debug')) {
  document.body.classList.add('debug'); window.__audio = audio;
  // Paint a local what-if over the live row (card, ticker, venue…) without writing it.
  window.__sb = { render: (patch) => render({ ...last, ...patch }) };
}
// The roster lives in an owner-only table (it has kids' names in it), so the
// overlay reads it through a token that travels only in this URL. No token, no
// lineup or defense cards — everything else still runs.
const rosterToken = params.get('t');
// Writing back to the game row -- the OBS status, scene and clip-ack relay --
// is gated on that same token, so a link someone found can't drive the pad's
// OBS panel. A URL without &t= still runs the whole overlay; it just can't
// report. Say so once rather than failing silently on every OBS event.
let relayWarned = false;
function relayReady() {
  if (rosterToken) return true;
  if (!relayWarned) {
    relayWarned = true;
    console.warn('Scoreboard: this overlay URL has no &t= token, so OBS status, ' +
      'camera list and replay clips stay off. Re-copy the overlay link from the ' +
      'control panel and paste it into the Browser Source to enable them.');
  }
  return false;
}
let roster = {};
let rosterRev = -1;
let rosterRetry = null;
let rosterBackoff = 2000;
// Bumped whenever `roster` is replaced. cardSig keys off this instead of
// stringifying two full rosters on every pitch — and it has to be this rather
// than roster_rev, because the row carries the new revision before the fetch
// that satisfies it has landed.
let rosterGen = 0;
let rosterAsk = 0;
// No token, or one that isn't this game's (a link copied from another game with
// only the game id changed): the lineup and defense cards say so instead of
// showing a team name over an empty list. get_roster answers null for a token
// that doesn't match, and {} for a real roster nobody has filled in yet.
let rosterBad = !rosterToken;
const LINK_STALE = 'Overlay link is out of date — copy it again from the pad';
async function pullRoster(rev) {
  rosterRev = rev; // claim it first: a slow fetch must not re-trigger on every paint
  const ask = ++rosterAsk;
  const { data, error } = await db.rpc('get_roster', { p_game: gameId, p_token: rosterToken });
  // Two edits close together start two fetches; the older can answer last.
  // Only the newest request gets to set the roster.
  if (ask !== rosterAsk) return;
  if (error) {
    // Claiming the revision and then failing left the overlay believing it
    // already had this roster, so it never asked again and the lineup and
    // defense cards stayed empty for the whole game. One bad request as OBS
    // starts the source — on the same venue network everything else here is
    // hardened against — was enough. Give the revision back and try again,
    // backing off like the realtime reconnect does.
    console.warn('roster fetch failed, retrying', error.message);
    clearTimeout(rosterRetry);
    rosterRetry = setTimeout(() => { rosterRev = -1; if (last) render(last); }, rosterBackoff);
    rosterBackoff = Math.min(rosterBackoff * 2, 30000);
    return;
  }
  rosterBackoff = 2000;
  const bad = data === null;
  if (bad && !rosterBad) console.warn('Scoreboard: this overlay link\'s &t= token is not this game\'s. ' + LINK_STALE + '.');
  rosterBad = bad;
  // Older pads wrote the defense as batting-order slots; the cards read player ids.
  roster = normalizeRoster(data || {});
  rosterGen++;
  if (last) render(last);
}

// OBS control (replay clips + camera switching) is on by default. Add &obs=0 to
// any EXTRA copy of the overlay — a preview tab, or a second browser source —
// so one press doesn't save two clips. &replay=0 is the older spelling.
const obsEnabled = !/^(0|off|no|false)$/i.test(params.get('obs') || params.get('replay') || '');

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
  return c.running && c.since ? (c.base || 0) + (serverNow() - new Date(c.since).getTime()) / 1000 : (c.base || 0);
}
function renderSoccer(s) {
  const st = s.state || {};
  document.getElementById('sc-half').textContent = ordinalHalf(st.half || 1);
  document.getElementById('sc-stoppage').textContent = st.stoppage ? `+${st.stoppage}` : '';
}

function render(s) {
  if (!s) return;
  if (rosterToken && (s.roster_rev | 0) !== rosterRev) pullRoster(s.roster_rev | 0);
  s = { ...s, lineups: roster }; // the roster arrives by RPC, not on the row (normalized in pullRoster)
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
  document.body.style.setProperty('--away-tc', s.away_color || '#5b6472');
  document.body.style.setProperty('--home-tc', s.home_color || '#5b6472');
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
  else if (nonce > lastAnimNonce) { lastAnimNonce = nonce; playAnimation(withBatterName(a, s)); audio.play(soundFor(a)); }

  syncWeather(s);
  syncTicker(s);
  syncSponsors(s);
  replayHello();
  handleReplay(s.replay_cmd);
  if (!scenesSent) { scenesSent = true; reportScenes(); reportStatus(); }
  handleScene(s.scene_cmd);
  handleObsCmd(s.obs_cmd);
}

// A play's stinger names the hitter. The row is public, so the pad sends only
// the lineup slot (side + index) and the name is looked up here, in the roster
// this overlay fetched by token. Without the token there is no name, and the
// play still shows.
function withBatterName(a, s) {
  const m = a && a.meta;
  if (!m || !m.side || m.idx == null) return a;
  const b = teamLineup(s, m.side).batters[m.idx | 0];
  const sub = b ? [b.num ? `#${b.num}` : '', b.name || ''].filter(Boolean).join(' ') : '';
  return sub ? { ...a, meta: { ...m, sub } } : a;
}
// A play plays the run sound when a run scored on it, and is quiet otherwise —
// outs happen every inning and the stream doesn't need a sting for each.
const soundFor = (a) => (a.type === 'play' ? (a.meta && a.meta.runs ? 'run' : null) : a.type);

// Audio needs one gesture in a normal browser; OBS browser sources autoplay.
audio.resume();
document.addEventListener('pointerdown', () => { audio.resume(); setTimeout(refreshSoundHint, 60); });
function refreshSoundHint() { const h = document.getElementById('sound-hint'); if (h) h.hidden = !audio.isSuspended(); }
window.setTimeout(refreshSoundHint, 600);
document.getElementById('sound-hint')?.addEventListener('click', () => { Promise.resolve(audio.resume()).then(() => setTimeout(refreshSoundHint, 60)); });

const LOOK_FONTS = {
  condensed: '"Barlow Condensed", "Arial Narrow", system-ui, sans-serif',
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

// A logo that 404s is suppressed so the browser is not asked for it on every
// render. "Failed once" must not mean "failed all night", though: upload the
// missing file, or the host comes back, and the overlay would go on hiding it
// with no way to retry short of reloading the source — which the OBS setup
// notes tell you not to do.
const failedLogos = new Map();   // url -> when it last failed
const LOGO_RETRY_MS = 60000;
function logoBlocked(url) {
  const at = failedLogos.get(url);
  if (at == null) return false;
  if (Date.now() - at < LOGO_RETRY_MS) return true;
  failedLogos.delete(url);       // long enough — give it another go
  return false;
}
function setLogo(id, url) {
  const img = document.getElementById(id);
  if (!img) return;
  if (!url || logoBlocked(url)) { img.hidden = true; img.removeAttribute('src'); return; }
  // src was cleared by the failure, so this re-assigns and genuinely retries.
  if (img.getAttribute('src') !== url) {
    img.onerror = () => { failedLogos.set(url, Date.now()); img.hidden = true; img.removeAttribute('src'); };
    img.src = url;
  }
  img.hidden = false;
}

function fmtClock(sec) {
  sec = Math.max(0, Math.round(sec));
  return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0');
}
function remainingSeconds(s) {
  if (!s || !s.time_limit_seconds) return null;
  if (s.clock_running && s.clock_ends_at) return (new Date(s.clock_ends_at).getTime() - serverNow()) / 1000;
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
setInterval(() => { updateClock(); updateCardCountdown(); }, 250);

function toDots(n, max = 3) { let out = ''; for (let i = 0; i < max; i++) out += i < (n | 0) ? '●' : '○'; return out; }
// The detail strip reads the same for most of an inning, but it was rebuilt
// from innerHTML on every render — a parse and a layout each pitch, forever,
// inside a browser source. Same guard the clock has had all along.
let detailPainted = null;
function paintDetail(html) {
  if (html === detailPainted) return;
  detailPainted = html;
  const el = document.getElementById('detail');
  el.innerHTML = html;
  el.hidden = !html;
}
function updateDetail(s) {
  const parts = [];
  const sport = s.sport || 'baseball';
  if (sport === 'football') {
    const st = s.state || {};
    parts.push(`<span><span class="k">${escapeHtml(s.away_abbr || 'AWAY')} TO</span>${toDots(st.away_timeouts ?? 3)}</span>`);
    parts.push(`<span><span class="k">${escapeHtml(s.home_abbr || 'HOME')} TO</span>${toDots(st.home_timeouts ?? 3)}</span>`);
    return paintDetail(parts.join(''));
  }
  if (sport === 'volleyball') {
    const st = s.state || {};
    if (st.target && st.target !== 25) parts.push(`<span><span class="k">SET TO</span>${st.target | 0}</span>`);
    return paintDetail(parts.join(''));
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
    return paintDetail(parts.join(''));
  }
  if (sport === 'soccer') {
    const c = (s.state && s.state.cards) || { home: {}, away: {} };
    const cardStr = (t) => `${'🟨'.repeat(c[t]?.y || 0)}${'🟥'.repeat(c[t]?.r || 0)}` || '';
    const a = cardStr('away'), h = cardStr('home');
    if (a) parts.push(`<span><span class="k">${escapeHtml(s.away_abbr || 'AWAY')}</span>${a}</span>`);
    if (h) parts.push(`<span><span class="k">${escapeHtml(s.home_abbr || 'HOME')}</span>${h}</span>`);
    return paintDetail(parts.join(''));
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
  paintDetail(parts.join(''));
}
const escapeHtml = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ---- Persistent broadcast cards (matchup / final / due-up / sponsor) -------
// Snapshot cards rebuild only on a new nonce. Lineup/defense cards also carry a
// live "signature" (batting side + current hitter + roster) so the on-air
// highlight and fielders track the game while the card stays up — refreshed in
// place so the entrance animation doesn't replay each update.
// ---- The half, replayed ------------------------------------------------------
// Mid-Inning fetches the public play-by-play when it goes up and replays the
// half that just ended under the score. The same name-free rows the recap page
// reads, through the same get_plays() — nothing here needs the roster token.
let recapPlays = null;        // the rows for the game, as last fetched
let recapFor = null;          // the card key they were fetched for
let recapPlayed = null;       // the card key whose strip has already animated
let recapRetry = null;
let finalPlayed = null;       // the Final card key that has already run its entrance
async function loadRecap(key, again = true) {
  const { data, error } = await db.rpc('get_plays', { p_game: gameId });
  if (key !== lastCardKey) return;                    // the card came down meanwhile
  if (!error && Array.isArray(data)) { recapPlays = data; recapFor = key; }
  lastCardSig = null;                                 // repaint with them
  if (last) render(last);
  // The card can go up in the same breath as the third out's row is written.
  // If the half that just ended does not add up to three outs yet, look once
  // more — never in a loop.
  if (again && last && halfRecap(recapPlays, last).outs < 3) {
    clearTimeout(recapRetry);
    recapRetry = setTimeout(() => loadRecap(key, false), 1600);
  }
}
// Due Up, on Mid-Inning: the team coming to bat, leadoff first. Built here from
// the roster this overlay holds privately, exactly as the Due Up card is since
// v3.93 — the break is when a viewer wants to know who is up, and until now the
// operator had to raise a second card to say so.
function midDueUpHtml(s) {
  if (rosterBad) return '';
  const side = battingSide(s);
  const up = dueUpCard(s, side, 3);
  if (!up.length) return '';
  const team = escapeHtml(side === 'home' ? (s.home_abbr || s.home_name || 'Home') : (s.away_abbr || s.away_name || 'Visitor'));
  return `<div class="md-due"><span class="md-lab">Due up · ${team}</span>${up.map((b) =>
    `<span class="md-who${b.current ? ' lead' : ''}">${b.num ? `<i>#${escapeHtml(b.num)}</i> ` : ''}${escapeHtml(b.name || '')}</span>`).join('')}</div>`;
}
function recapStripHtml(s) {
  const r = halfRecap(recapPlays, s);
  if (!r.rows.length) return '';
  const who = r.half === 'bottom' ? (s.home_name || 'Home') : (s.away_name || 'Visitor');
  const ord = (n) => n + (['th', 'st', 'nd', 'rd'][(n % 100 > 10 && n % 100 < 14) ? 0 : (n % 10 < 4 ? n % 10 : 0)]);
  const bits = r.oneTwoThree
    ? '<span class="rp-tag">1-2-3 inning</span>'
    : [r.runs ? `<span class="rp-runs">${r.runs} run${r.runs > 1 ? 's' : ''}</span>` : '<span>No runs</span>',
       `<span>${r.hits} hit${r.hits === 1 ? '' : 's'}</span>`,
       r.walks ? `<span>${r.walks} walk${r.walks > 1 ? 's' : ''}</span>` : ''].join('');
  const chips = r.rows.map((p, i) =>
    `<span class="rp-chip${p.runs ? ' scored' : ''}" style="--i:${i}">` +
      (p.k ? `<i class="rp-k${p.backwards ? ' back' : ''}" aria-hidden="true">K</i>` : '') +
      `<b>${escapeHtml(p.label)}</b>` +
      (p.code ? `<em>${escapeHtml(p.code)}</em>` : '') +
      (p.runs ? `<span class="rp-plus">+${p.runs} run${p.runs > 1 ? 's' : ''}</span>` : '') +
      (p.outs ? '<span class="rp-outs">' + '<i></i>'.repeat(Math.min(3, p.outs)) + '</span>' : '') +
    '</span>').join('');
  return `<div class="rp-strip" style="--n:${r.rows.length}">
    <div class="rp-sum"><span class="rp-who">${r.half === 'bottom' ? 'Bottom' : 'Top'} ${ord(r.inning)} · ${escapeHtml(who)}</span><span class="rp-dot"></span>${bits}</div>
    <div class="rp-chips">${chips}</div></div>`;
}

let lastCardKey = null, lastCardSig = null;
function cardSig(c, s) {
  if (c.type === 'lineup') {
    const side = (c.meta && c.meta.auto) ? battingSide(s) : ((c.meta && c.meta.side) || battingSide(s));
    const idx = ((s.state && s.state.batIdx) || {})[side] | 0;
    return `${side}:${idx}:${rosterGen}`;
  }
  if (c.type === 'defense') {
    const side = fieldingSide(s);
    return `${side}:${rosterGen}`;
  }
  // Due Up follows the order while it is up: a new hitter at bat, the half
  // rolling to the other team, or the roster being re-pulled all repaint it.
  if (c.type === 'dueup') {
    const side = battingSide(s);
    const idx = ((s.state && s.state.batIdx) || {})[side] | 0;
    return `${side}:${idx}:${rosterGen}:${s.away_abbr}:${s.home_abbr}`;
  }
  // A break card can be up while you fix a score or roll the inning — keep it live.
  if (c.type === 'midinning') {
    return `${s.away_score}:${s.home_score}:${s.inning}:${s.half}:${JSON.stringify(s.line_score || [])}:${JSON.stringify(s.state || {})}:${recapPlays ? recapPlays.length : '-'}:${rosterGen}`;
  }
  // Final stays live too. It used to be a snapshot, so a score fixed after the
  // card went up — the most likely moment to notice one is wrong — never reached
  // the screen. It refreshes in place and does not replay its entrance; if the
  // fix hands the game to the other side, the winner treatment follows.
  if (c.type === 'finalfull') {
    return `${s.away_score}:${s.home_score}:${s.away_hits}:${s.home_hits}:${s.away_errors}:${s.home_errors}:${s.inning}:${s.half}:${JSON.stringify(s.line_score || [])}`;
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
  // Takeover cards own the whole frame: opaque backdrop, scorebug hidden.
  const full = !!c && TAKEOVER.has(c.type);
  layer.classList.toggle('takeover', full);
  document.body.classList.toggle('takeover', full);
  if (remount) cdPainted = null; // a rebuilt card starts with placeholder text
  if (!key) { layer.hidden = true; layer.innerHTML = ''; layer.classList.remove('lower'); return; }
  const html = buildCard(c, s);
  const cur = layer.querySelector('.card');
  if (remount || !cur) {
    layer.classList.toggle('lower', c.type === 'dueup');
    layer.innerHTML = html; // fresh card → play the entrance animation
    fitStartingNames(layer);
    paintWeather();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => fitStartingNames(layer));
    const fresh = layer.querySelector('.takeover-card');
    if (fresh) {
      fresh.classList.add('enter');
      // Drop it once it's played, so a later live refresh of the card's children
      // (mid-inning tracking the score) doesn't re-run the stagger.
      setTimeout(() => fresh.classList.remove('enter'), 1200);
    }
  } else {
    const tmp = document.createElement('div'); tmp.innerHTML = html;
    const next = tmp.firstElementChild;
    if (next) {
      // The card's own class and style can change with the game too — Final's
      // winner is a class and its colour a property on the card itself, and a
      // score fixed behind it can hand the game to the other side. Carry them
      // across; keep the entrance class if it is still running.
      const entering = cur.classList.contains('enter');
      cur.className = next.className;
      if (entering) cur.classList.add('enter');
      const st = next.getAttribute('style');
      if (st) cur.setAttribute('style', st); else cur.removeAttribute('style');
      cur.replaceChildren(...next.childNodes); // live refresh, no re-animation
    } else layer.innerHTML = html;
  }
  layer.hidden = false;
  // Final's winner treatment is on the whole frame, not inside the card: the
  // winner's side of the backdrop glows in their colour and the other side goes
  // dark. The card itself is centred, so a wash drawn inside it was clipped to a
  // box and left the loser's half still tinted in their colour.
  const finCard = c.type === 'finalfull' ? layer.querySelector('.slab.fin.has-win') : null;
  let wash = layer.querySelector(':scope > .fin-wash');
  if (finCard) {
    const side = finCard.classList.contains('win-home') ? 'home' : 'away';
    if (!wash) { wash = document.createElement('div'); wash.setAttribute('aria-hidden', 'true'); layer.prepend(wash); }
    wash.className = `fin-wash wash-${side}`;
    wash.style.setProperty('--win', finCard.dataset.winColor || '#e0a92a');
  } else if (wash) wash.remove();
  if (c.type === 'finalfull' && finalPlayed !== key) {
    // Once per card, for the same reason as the Mid-Inning strip: a score fixed
    // behind it rebuilds these elements without the class and does not replay.
    finalPlayed = key;
    const card = layer.querySelector('.slab.fin');
    if (card) {
      const cells = card.querySelectorAll('.linescore td').length;
      card.style.setProperty('--cells', cells);
      card.querySelectorAll('.linescore, .slab-line .r, .fin-tag').forEach((e) => e.classList.add('fin-go'));
      const w2 = layer.querySelector(':scope > .fin-wash');
      if (w2) w2.classList.add('fin-go');
    }
  }
  if (c.type === 'midinning') {
    if (remount) { const du = layer.querySelector('.md-due'); if (du) du.classList.add('rp-go'); }
    if (remount && recapFor !== key) { recapPlays = null; loadRecap(key); }
    // The replay runs once, the first time the strip has something in it. A live
    // refresh rebuilds these elements without the class, so fixing a score
    // behind the card updates it in place instead of replaying the half.
    const strip = layer.querySelector('.rp-strip');
    if (strip && recapPlayed !== key) {
      recapPlayed = key;
      strip.classList.add('rp-go');
      const cell = layer.querySelector('.ls-new');
      const n = layer.querySelectorAll('.rp-chip').length;
      // After the last play has landed, so the eye ends on what changed.
      if (cell) { cell.style.animationDelay = `${(0.5 + n * 0.32 + 0.25).toFixed(2)}s`; cell.classList.add('rp-go'); }
    }
  }
}
// ---- Announcement ticker ----------------------------------------------------
// One pass = the strip slides left by exactly one copy of the message, which
// puts the next copy where the first began, so passes join without a seam. An
// edit made while it runs waits for the pass to end, then enters behind the
// message still on screen, so the text never jumps under the viewer's eyes.
const TK_SPEED = 120;   // px per second
const tk = { text: null, next: null, anim: null, hideTimer: null };
function syncTicker(s) {
  const box = document.getElementById('ticker');
  const t = s.ticker;
  const text = t && t.on && typeof t.text === 'string' ? t.text.trim() : '';
  if (!text) {
    if (tk.text === null) return;
    tk.text = tk.next = null;
    box.classList.remove('up');
    document.body.classList.remove('ticker-on');
    clearTimeout(tk.hideTimer);
    tk.hideTimer = setTimeout(() => {
      if (tk.text !== null) return;
      if (tk.anim) { tk.anim.cancel(); tk.anim = null; }
      box.hidden = true;
      document.getElementById('tk-run').innerHTML = '';
    }, 500);
    return;
  }
  const alert = t.tone === 'alert';
  box.classList.toggle('alert', alert);
  const lab = alert ? '⚠ Alert' : 'Notice';
  const labEl = document.getElementById('tk-lab');
  if (labEl.textContent !== lab) labEl.textContent = lab;
  if (tk.text === null) {
    clearTimeout(tk.hideTimer);
    tk.text = text; tk.next = null;
    box.hidden = false;
    tickerPass(null);
    void box.offsetWidth;   // commit the off-screen position so the slide-up runs
    box.classList.add('up');
    document.body.classList.add('ticker-on');
  } else if (text !== tk.text) tk.next = text;
  else tk.next = null;
}
function tickerPass(lead) {
  const run = document.getElementById('tk-run');
  const track = run.parentElement;
  if (tk.anim) { tk.anim.cancel(); tk.anim = null; }
  if (tk.text === null) return;
  const item = (t) => `<span class="tk-item">${escapeHtml(t)}</span>`;
  // `lead` is the old message still on screen: it goes first and scrolls off.
  run.innerHTML = (lead ? item(lead) : '') + item(tk.text);
  const first = run.firstElementChild;
  const unit = first.offsetWidth || 1;
  const W = track.clientWidth || 1600;
  const copy = run.lastElementChild.offsetWidth || 1;
  const copies = Math.max(1, Math.ceil(W / copy) + 1);
  run.innerHTML = (lead ? item(lead) : '') + item(tk.text).repeat(copies);
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  tk.anim = run.animate([{ transform: 'translateX(0)' }, { transform: `translateX(${-unit}px)` }],
    { duration: (unit / TK_SPEED) * 1000, easing: 'linear' });
  tk.anim.onfinish = () => {
    if (tk.text === null) return;
    let prev = null;
    if (tk.next) { prev = tk.text; tk.text = tk.next; tk.next = null; }
    // After a lead pass the strip starts on the new message; after a plain
    // pass it starts on the next copy, which looks the same as the first.
    tickerPass(prev);
  };
}

// ---- Venue weather --------------------------------------------------------
// Fetched here, straight from Open-Meteo, every 10 minutes while the game has a
// venue. A failed fetch keeps the last reading on screen (venue LTE drops out)
// and tries again sooner; a reading older than 90 minutes is dropped rather
// than shown as if it were now.
const WX_EVERY = 10 * 60 * 1000;
let wx = null;          // last good reading
let wxKey = null;       // venue + first pitch it was fetched for
let wxTimer = null;
function syncWeather(s) {
  const v = s.venue && s.venue.lat != null ? s.venue : null;
  const key = v ? `${v.lat},${v.lon}|${s.starts_at || ''}` : null;
  if (key === wxKey) return;
  wxKey = key;
  clearTimeout(wxTimer);
  if (!key) { wx = null; paintWeather(); return; }
  if (wx && wx.key !== key.split('|')[0]) wx = null;   // a different place, not a new first pitch
  pullWeather();
}
async function pullWeather() {
  clearTimeout(wxTimer);
  const key = wxKey;
  if (!key || !last) return;
  let next = WX_EVERY;
  try {
    const w = await fetchWeather(last.venue, last.starts_at);
    if (key !== wxKey) return;
    if (w) wx = { ...w, key: key.split('|')[0] };
  } catch (e) {
    console.warn('weather fetch failed', e.message);
    next = 2 * 60 * 1000;
  }
  if (wx && Date.now() - wx.at > 90 * 60 * 1000) wx = null;
  paintWeather();
  wxTimer = setTimeout(pullWeather, next);
}
function paintWeather() {
  document.querySelectorAll('#card .ss-wx, #card .pz-wx').forEach((n) => {
    const html = wx ? weatherHtml(wx, last && last.venue) : '';
    if (n.innerHTML !== html) n.innerHTML = html;
    n.hidden = !html;
  });
}

// Cards that cover the whole 1920×1080 frame instead of floating over the video.
const TAKEOVER = new Set(['starting', 'midinning', 'finalfull']);

// Countdown to first pitch, repainted on the shared tick. Only the number is
// rewritten — the card around it stays put, so nothing re-animates.
let cdPainted = null;
function fmtCountdown(sec) {
  sec = Math.max(0, Math.round(sec));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), ss = sec % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
           : `${m}:${String(ss).padStart(2, '0')}`;
}
function updateCardCountdown() {
  const el2 = document.getElementById('card-cd');
  if (!el2 || !last || !last.starts_at) return;
  const ms = new Date(last.starts_at).getTime() - serverNow();
  const txt = ms <= 0 ? 'STARTING NOW' : fmtCountdown(ms / 1000);
  if (txt === cdPainted) return;
  cdPainted = txt;
  el2.textContent = txt;
  el2.classList.toggle('now', ms <= 0);
  el2.classList.toggle('soon', ms > 0 && ms <= 60000);
}

// Where the game stands during a break. Baseball reads its own half: raising the
// card after ending the top of the 3rd leaves the game in the bottom of the 3rd,
// which is exactly "middle of the 3rd" in broadcast terms.
const ORD = ['0th', '1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th'];
const ordinal = (n) => ORD[n] || `${n}th`;
function breakLabel(s) {
  const st = s.state || {};
  const sport = s.sport || 'baseball';
  if (sport === 'baseball') {
    const inn = s.inning | 0;
    if (s.half === 'bottom') return `Middle of the ${ordinal(inn)}`;
    return inn > 1 ? `End of the ${ordinal(inn - 1)}` : `Top of the ${ordinal(inn || 1)}`;
  }
  if (sport === 'football') return `End of Q${st.quarter || 1}`;
  if (sport === 'basketball') return `End of Q${st.period || 1}`;
  if (sport === 'soccer') return (st.half || 1) === 1 ? 'Halftime' : 'End of the 2nd half';
  if (sport === 'volleyball') return `Set ${st.set || 1}`;
  return 'Scoreboard';
}
function lineScoreHtml(s, fresh = null, replay = false) {
  if ((s.sport || 'baseball') !== 'baseball' || !Array.isArray(s.line_score) || !s.line_score.length) return '';
  const aAbbr = escapeHtml(s.away_abbr || s.away_name || 'AWAY');
  const hAbbr = escapeHtml(s.home_abbr || s.home_name || 'HOME');
  // `fresh`, on Mid-Inning: the cell of the half that just ended, which pulses
  // last so the eye ends on what changed.
  // `replay`, on Final: every cell carries its place in the game, so the whole
  // line score can fill in inning by inning, top then bottom, and land on R/H/E.
  const cells = (side) => s.line_score.map((x, i) => {
    const cls = fresh && fresh.half === side && fresh.inning === i + 1 ? ' class="ls-new"' : '';
    const order = replay ? ` style="--c:${i * 2 + (side === 'bottom' ? 1 : 0)}"` : '';
    return `<td${cls}${order}>${x?.[side] ?? 0}</td>`;
  }).join('');
  const heads = s.line_score.map((_, i) => `<th>${i + 1}</th>`).join('');
  return `<table class="linescore"><tr><th></th>${heads}<th class="rhe">R</th><th class="rhe">H</th><th class="rhe">E</th></tr>
    <tr><th>${aAbbr}</th>${cells('top')}<td class="rhe">${s.away_score | 0}</td><td class="rhe">${s.away_hits | 0}</td><td class="rhe">${s.away_errors | 0}</td></tr>
    <tr><th>${hAbbr}</th>${cells('bottom')}<td class="rhe">${s.home_score | 0}</td><td class="rhe">${s.home_hits | 0}</td><td class="rhe">${s.home_errors | 0}</td></tr></table>`;
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
  if (c.type === 'starting') return startingCard(meta, s);
  if (c.type === 'midinning' || c.type === 'finalfull') {
    const fin = c.type === 'finalfull';
    // Final says who won: the winner's colour washes in from their side, their
    // score grows a touch, the other side steps back. A tie gets neither. No
    // confetti — both dugouts are children.
    const story = fin ? finalStory(s) : null;
    const w = story && story.winner;
    const sideCls = (side) => (w ? (w === side ? ' win' : ' lose') : '');
    const winColor = w ? (s[w + '_color'] || (w === 'home' ? '#1b2a41' : '#7a8794')) : '';
    const tag = story && (story.walkoff ? 'Walk-off' : story.runRule ? `Run rule · ${story.innings} inn` : '');
    return `<div class="card takeover-card slab${fin ? ' fin' : ''}${w ? ' has-win win-' + w : ''}"${w ? ` data-win-color="${escapeAttr(winColor)}"` : ''}>
      <div class="card-sub">${escapeHtml(meta.text || (fin ? 'Final' : breakLabel(s)))}${tag ? `<span class="fin-tag">${escapeHtml(tag)}</span>` : ''}</div>
      <div class="slab-line">
        <div class="side${sideCls('away')}">${logoHtml(s.away_logo_url)}<div class="cname">${escapeHtml(s.away_name || 'Visitor')}</div></div>
        <div class="r${sideCls('away')}">${s.away_score | 0}</div>
        <div class="dash">–</div>
        <div class="r${sideCls('home')}">${s.home_score | 0}</div>
        <div class="side${sideCls('home')}">${logoHtml(s.home_logo_url)}<div class="cname">${escapeHtml(s.home_name || 'Home')}</div></div>
      </div>
      ${!fin && (s.sport || 'baseball') === 'baseball' ? recapStripHtml(s) : ''}
      ${lineScoreHtml(s, !fin ? finishedHalf(s) : null, fin)}
      ${!fin && (s.sport || 'baseball') === 'baseball' ? midDueUpHtml(s) : ''}</div>`;
  }
  if (c.type === 'final') {
    const ls = lineScoreHtml(s);
    return `<div class="card final"><div class="card-sub">Final</div>
      <div class="card-scoreline">
        <div class="side"><span class="n">${aAbbr}</span><span class="r">${s.away_score | 0}</span></div>
        <div class="side"><span class="n">${hAbbr}</span><span class="r">${s.home_score | 0}</span></div>
      </div>${ls}</div>`;
  }
  if (c.type === 'dueup') {
    // Live from the roster: the hitter at bat, then who follows. Typed text still
    // wins when the operator wrote the card by hand, and an old card that carried
    // its own snapshot still shows it.
    let body;
    if (meta.text) body = `<span>${escapeHtml(meta.text)}</span>`;
    else if (Array.isArray(meta.lines) && meta.lines.length) {
      body = `<div class="du-list">${meta.lines.map((n) => `<span>${escapeHtml(n)}</span>`).join('')}</div>`;
    } else if (rosterBad) body = `<span class="du-empty">${LINK_STALE}</span>`;
    else {
      const up = dueUpCard(s, battingSide(s), 3);
      body = up.length
        ? `<div class="du-list">${up.map((b) =>
            `<span class="${b.current ? 'du-cur' : ''}">${b.num ? `<i>#${escapeHtml(b.num)}</i> ` : ''}${escapeHtml(b.name || '')}</span>`).join('')}</div>`
        : '<span class="du-empty">No lineup set</span>';
    }
    const team = escapeHtml(battingSide(s) === 'home' ? (s.home_abbr || s.home_name || 'Home') : (s.away_abbr || s.away_name || 'Visitor'));
    return `<div class="card lower-card"><b>Due Up · ${team}</b>${body}</div>`;
  }
  if (c.type === 'lineup') {
    const side = meta.auto ? battingSide(s) : (meta.side || battingSide(s));
    const teamName = escapeHtml(side === 'home' ? (s.home_name || 'Home') : (s.away_name || 'Visitor'));
    if (rosterBad) return `<div class="card lineupcard"><div class="card-sub">Lineup — ${teamName}</div><table class="lc-table"><tr><td class="lc-name">${LINK_STALE}</td></tr></table></div>`;
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
    if (rosterBad) return `<div class="card defense"><div class="card-sub">Defense — ${teamName}</div><div class="card-title">${LINK_STALE}</div></div>`;
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
  if (!relayReady()) return Promise.resolve();
  return db.rpc('ack_replay', {
    p_game: gameId, p_token: rosterToken, p_nonce: nonce, p_ok: ok, p_code: code,
    p_level: level ?? null, p_buffering: buffering ?? null,
  }).then(({ error }) => { if (error) console.warn('replay ack failed', error.message); });
}

// Capability + buffer status, pushed to the pad whenever either changes: once at
// load, then on OBS's own replay-buffer events. This is what puts "buffer isn't
// running" in front of you BEFORE first pitch instead of after the play.
let helloSent = false;
let obsLevel = null;      // cached control level (a source reloads if you change it)
let bufferOn = null;      // null = unknown
async function sendStatus() {
  if (!obsEnabled || !gameId) return;
  if (obsLevel === null) obsLevel = await obsControlLevel();
  if (obsLevel < 0) return; // not in OBS: stay silent, a preview tab must not speak for the source
  if (!relayReady()) return;
  await ackReplay(0, canSaveReplay(obsLevel), 'hello', obsLevel, bufferOn);
}
async function replayHello() {
  if (helloSent) return;
  helloSent = true;
  obsLevel = await obsControlLevel();
  if (obsLevel < 0) return;
  const st = await obsAsk('getStatus', null);
  bufferOn = st ? !!st.replaybuffer : null;
  await sendStatus();
}
// OBS pushes these into the page; they're also how we learn a clip really landed.
addEventListener('obsReplaybufferStarted', () => { bufferOn = true; sendStatus(); });
addEventListener('obsReplaybufferStopped', () => { bufferOn = false; sendStatus(); });
// (reportStatus() is wired to the same events below, for the pad's OBS panel.)

// Saves waiting to happen. The buffer only reaches BACKWARD, so a home-run clip
// taken at the swing would end while he's rounding second — the pad tells us how
// long to wait so the save catches the trot and the celebration too, and the
// buffer still reaches back past the pitch.
const scheduled = new Map();   // nonce -> timeout id
const awaiting = [];           // FIFO of saves called but not yet confirmed by OBS
const SAVE_CONFIRM_MS = 4000;
const MAX_DELAY_MS = 180000;

function settleEntry(entry, ok, code) {
  const i = awaiting.indexOf(entry);
  if (i < 0) return;
  awaiting.splice(i, 1);
  clearTimeout(entry.timer);
  ackReplay(entry.nonce, ok, code, entry.level, bufferOn);
}
// One global event, so it settles the oldest outstanding save. saveReplayBuffer()
// returns nothing and no-ops if OBS declines — "saved" means OBS said so.
addEventListener('obsReplaybufferSaved', () => { if (awaiting.length) settleEntry(awaiting[0], true, 'saved'); });

async function doSave(nonce) {
  scheduled.delete(nonce);
  if (!canSaveReplay(obsLevel)) return ackReplay(nonce, false, 'noperm', obsLevel, null);
  const st = await obsAsk('getStatus', null);
  if (st) bufferOn = !!st.replaybuffer;
  if (bufferOn === false) return ackReplay(nonce, false, 'nobuffer', obsLevel, false);
  const entry = { nonce, level: obsLevel };
  entry.timer = setTimeout(() => settleEntry(entry, false, 'noconfirm'), SAVE_CONFIRM_MS);
  awaiting.push(entry);
  try { window.obsstudio.saveReplayBuffer(); }
  catch (e) { settleEntry(entry, false, 'failed'); }
}
function flushScheduled() {
  for (const [nonce, timer] of [...scheduled]) { clearTimeout(timer); scheduled.delete(nonce); doSave(nonce); }
}

// ---- Sponsor rotation -----------------------------------------------------
// A corner bug that comes up every few minutes and leaves again. It yields to
// takeover cards, which own the whole frame.
let spTimer = null, spHideTimer = null, spIndex = 0, spKey = '';
function sponsorCfg(s) {
  const c = (s && s.sponsors) || {};
  const list = (Array.isArray(c.list) ? c.list : []).filter((x) => x && (x.name || x.logo));
  return { list, rotate: !!c.rotate, every: Math.max(15, c.every || 180), secs: Math.max(3, c.secs || 8) };
}
function showSponsor() {
  const el = document.getElementById('sponsor-bug');
  const c = sponsorCfg(last);
  if (!el || !c.list.length || document.body.classList.contains('takeover')) return;
  const sp = c.list[spIndex % c.list.length];
  spIndex++;
  el.innerHTML = '<span class="sp-kicker">Brought to you by</span>' +
    (sp.logo ? `<img src="${escapeAttr(sp.logo)}" alt="">` : '') +
    (sp.name ? `<span class="sp-name">${escapeHtml(sp.name)}</span>` : '');
  el.hidden = false;
  requestAnimationFrame(() => el.classList.add('on'));
  clearTimeout(spHideTimer);
  spHideTimer = setTimeout(() => {
    el.classList.remove('on');
    setTimeout(() => { el.hidden = true; }, 700); // after the fade
  }, c.secs * 1000);
}
function syncSponsors(s) {
  const c = sponsorCfg(s);
  const key = `${c.rotate}|${c.every}|${c.secs}|${c.list.length}`;
  if (key === spKey) return; // nothing timing-related changed
  spKey = key;
  clearInterval(spTimer); spTimer = null;
  const el = document.getElementById('sponsor-bug');
  if (!c.rotate || !c.list.length) { if (el) { el.classList.remove('on'); el.hidden = true; } return; }
  spTimer = setInterval(showSponsor, c.every * 1000);
  setTimeout(showSponsor, 4000); // one early, so you can see it's working
}

// ---- OBS scenes (camera switching) ----------------------------------------
// obs-browser can't show or hide an individual source, so a camera change is a
// scene change: one scene per camera with the scorebug shared into each.
// setCurrentScene needs ADVANCED (4); reading the list needs only READ_USER (2),
// so a Basic-permission source still reports what it sees and the pad can say
// exactly which setting to raise.
const sceneName = (v) => (typeof v === 'string' ? v : v && v.name) || '';
let scenesSent = false;
async function reportScenes() {
  if (!obsEnabled || !gameId) return;
  if (obsLevel === null) obsLevel = await obsControlLevel();
  if (obsLevel < 0) return; // not in OBS: stay silent
  if (!relayReady()) return;
  const [list, cur] = await Promise.all([obsAsk('getScenes', null), obsAsk('getCurrentScene', null)]);
  const names = Array.isArray(list) ? list.map(sceneName).filter(Boolean).slice(0, 60) : [];
  const { error } = await db.rpc('set_obs_scenes', {
    p_game: gameId, p_token: rosterToken, p_level: obsLevel, p_current: sceneName(cur), p_scenes: names,
  });
  if (error) console.warn('scene report failed', error.message);
}
// OBS tells us when either changes, so the pad's camera list needs no polling —
// and a switch made at the OBS machine shows up on the pad too.
addEventListener('obsSceneChanged', reportScenes);
addEventListener('obsSceneListChanged', reportScenes);

// ---- OBS stream / record / buffer -----------------------------------------
// Streaming and recording are ALL (5); the replay buffer's start/stop are
// ADVANCED (4). We never guess at the result: OBS emits an event for every one
// of these transitions, and that event is what the pad reads.
const OBS_ACTIONS = {
  stream_start: { fn: 'startStreaming', need: 5 },
  stream_stop: { fn: 'stopStreaming', need: 5 },
  record_start: { fn: 'startRecording', need: 5 },
  record_stop: { fn: 'stopRecording', need: 5 },
  buffer_start: { fn: 'startReplayBuffer', need: 4 },
  buffer_stop: { fn: 'stopReplayBuffer', need: 4 },
};
async function reportStatus() {
  if (!obsEnabled || !gameId) return;
  if (obsLevel === null) obsLevel = await obsControlLevel();
  if (obsLevel < 0) return; // not in OBS: stay silent
  if (!relayReady()) return;
  const st = await obsAsk('getStatus', null);
  if (st) bufferOn = !!st.replaybuffer; // keep the clip path's view in step
  const { error } = await db.rpc('set_obs_status', {
    p_game: gameId, p_token: rosterToken, p_level: obsLevel,
    p_streaming: st ? !!st.streaming : null,
    p_recording: st ? !!st.recording : null,
    p_paused: st ? !!st.recordingPaused : null,
    p_buffer: st ? !!st.replaybuffer : null,
  });
  if (error) console.warn('status report failed', error.message);
}
for (const ev of ['obsStreamingStarted', 'obsStreamingStopped', 'obsRecordingStarted', 'obsRecordingStopped',
                  'obsRecordingPaused', 'obsRecordingUnpaused', 'obsReplaybufferStarted', 'obsReplaybufferStopped']) {
  addEventListener(ev, reportStatus);
}

let lastObsNonce = 0;
let obsPrimed = false;
async function handleObsCmd(cmd) {
  if (!obsEnabled || !gameId) return;
  const nonce = (cmd && Number(cmd.nonce)) || 0;
  if (!obsPrimed) { obsPrimed = true; lastObsNonce = nonce; return; } // a reload must never re-fire "go live"
  if (!nonce || nonce <= lastObsNonce) return;
  lastObsNonce = nonce;
  const act = OBS_ACTIONS[cmd.action];
  if (!act) return;
  if (obsLevel === null) obsLevel = await obsControlLevel();
  if (obsLevel < act.need || typeof window.obsstudio?.[act.fn] !== 'function') return reportStatus();
  try { window.obsstudio[act.fn](); }
  catch (e) { console.warn('obs action failed', cmd.action, e); }
  reportStatus(); // the matching OBS event also fires; this covers builds that don't send it
}

let lastSceneNonce = 0;
let scenePrimed = false;
async function handleScene(cmd) {
  if (!obsEnabled || !gameId) return;
  const nonce = (cmd && Number(cmd.nonce)) || 0;
  if (!scenePrimed) { scenePrimed = true; lastSceneNonce = nonce; return; } // never re-switch on reload
  if (!nonce || nonce <= lastSceneNonce) return;
  lastSceneNonce = nonce;
  if (obsLevel === null) obsLevel = await obsControlLevel();
  if (obsLevel < 4 || typeof window.obsstudio?.setCurrentScene !== 'function') return reportScenes();
  const name = String(cmd.name || '');
  if (!name) return;
  try { window.obsstudio.setCurrentScene(name); }
  catch (e) { console.warn('scene switch failed', e); }
  reportScenes(); // obsSceneChanged also fires; this covers OBS builds that don't send it
}

let lastReplayNonce = 0;
let replayPrimed = false;
async function handleReplay(cmd) {
  if (!obsEnabled || !gameId) return;
  const nonce = (cmd && Number(cmd.nonce)) || 0;
  // Adopt whatever is on the row at first paint (usually nothing) so a reload
  // never re-clips, then fire on anything strictly newer.
  if (!replayPrimed) { replayPrimed = true; lastReplayNonce = nonce; return; }
  if (!nonce || nonce <= lastReplayNonce) return;
  lastReplayNonce = nonce;

  if (obsLevel === null) obsLevel = await obsControlLevel();
  if (obsLevel < 0) return; // plain browser tab: silent, so it can't clobber the real source's ack
  if (cmd.flush) return flushScheduled(); // "take it now" — no clip of its own, so no ack
  if (!canSaveReplay(obsLevel)) return ackReplay(nonce, false, 'noperm', obsLevel, null);

  const delay = Math.min(Math.max(Number(cmd.delay_ms) || 0, 0), MAX_DELAY_MS);
  if (!delay) return doSave(nonce);
  // "armed" is a receipt, not an outcome: the pad keeps its countdown running
  // and waits for the real verdict when the timer fires.
  ackReplay(nonce, true, 'armed', obsLevel, bufferOn);
  scheduled.set(nonce, setTimeout(() => doSave(nonce), delay));
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
addEventListener('online', () => { syncClock(); fetchState(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden) { syncClock(); fetchState(); } });

if (!gameId) {
  el.bug.innerHTML = '<div class="err">Add ?game=&lt;id&gt; to the URL</div>';
  el.bug.dataset.ready = '1';
} else {
  // Not awaited: the clock repaints at 4Hz so it corrects itself the moment
  // this lands, and the bug should paint without waiting on it.
  syncClock().then(() => {
    if (params.get('debug')) console.log('Scoreboard: clock offset from server', Math.round(clockSkewMs()), 'ms');
  });
  fetchState();
  subscribe();
}

