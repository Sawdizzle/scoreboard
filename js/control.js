import { supabase, db } from './supabase.js';
import { SUPABASE_URL, SUPABASE_ANON_KEY, USER_EMAIL_DOMAIN } from './config.js';
import * as L from './logic.js';
import * as F from './football.js';
import * as S from './soccer.js';

const $ = (id) => document.getElementById(id);
const views = { auth: $('auth-view'), lobby: $('lobby-view'), game: $('game-view') };
const show = (view) => { for (const k in views) views[k].hidden = (k !== view); };
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const emailFor = (u) => `${u.trim().toLowerCase()}@${USER_EMAIL_DOMAIN}`;

let user = null;
let game = null;
let channel = null;

// ---------------------------------------------------------------- Auth
async function refreshSession() {
  const { data } = await supabase.auth.getSession();
  user = data.session?.user ?? null;
  if (user) { $('who').textContent = user.user_metadata?.username || 'signed in'; show('lobby'); await loadGames(); }
  else show('auth');
}
const setAuthMsg = (m) => { $('auth-msg').textContent = m; };

$('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  setAuthMsg('Signing in…');
  const { error } = await supabase.auth.signInWithPassword({ email: emailFor($('username').value), password: $('pin').value });
  if (error) return setAuthMsg(/invalid/i.test(error.message) ? 'Wrong username or PIN.' : error.message);
  await refreshSession();
});

$('signup-btn').addEventListener('click', async () => {
  const username = $('username').value, pin = $('pin').value;
  setAuthMsg('Creating account…');
  let res, body;
  try {
    res = await fetch(`${SUPABASE_URL}/functions/v1/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
      body: JSON.stringify({ username, pin }),
    });
    body = await res.json();
  } catch { return setAuthMsg('Network error reaching signup.'); }
  if (!res.ok) return setAuthMsg(body.error || 'Could not create account.');
  const { error } = await supabase.auth.signInWithPassword({ email: emailFor(username), password: pin });
  if (error) return setAuthMsg('Account created — tap Log In.');
  await refreshSession();
});

$('logout-btn').addEventListener('click', async () => {
  await teardownChannel(); await supabase.auth.signOut();
  user = null; game = null; await refreshSession();
});

// ---------------------------------------------------------------- Lobby
async function loadGames() {
  const { data, error } = await db.from('games')
    .select('id,home_name,away_name,home_score,away_score,status')
    .eq('owner_id', user.id).order('updated_at', { ascending: false });
  const list = $('games-list'); list.innerHTML = '';
  if (error) { list.textContent = error.message; return; }
  if (!data.length) { list.innerHTML = '<p class="muted">No games yet — create one.</p>'; return; }
  for (const g of data) {
    const b = document.createElement('button');
    b.className = 'game-row';
    b.innerHTML = `<strong>${esc(g.away_name)} @ ${esc(g.home_name)}</strong><span>${g.away_score}–${g.home_score} · ${g.status}</span>`;
    b.onclick = () => openGame(g.id);
    list.appendChild(b);
  }
}
$('new-game-btn').addEventListener('click', async () => {
  const { data, error } = await db.from('games').insert({ status: 'live' }).select().single();
  if (error) return alert(error.message);
  openGame(data.id);
});

// ---------------------------------------------------------------- Game
async function openGame(id) {
  const { data, error } = await db.from('games').select('*').eq('id', id).single();
  if (error) return alert(error.message);
  game = data; show('game'); renderGame();
  $('overlay-url').value = `${location.origin}/overlay?game=${id}`;
  await subscribe(id);
}
$('back-btn').addEventListener('click', async () => {
  await teardownChannel(); game = null; show('lobby'); await loadGames();
});

async function subscribe(id) {
  await teardownChannel();
  channel = supabase.channel(`ctrl:${id}`)
    .on('postgres_changes', { event: 'UPDATE', schema: 'scoreboard', table: 'games', filter: `id=eq.${id}` },
      (payload) => { game = payload.new; renderGame(); })
    .subscribe();
}
async function teardownChannel() { if (channel) { await supabase.removeChannel(channel); channel = null; } }

// Atomic apply via RPC (snapshots prev_state for undo). Optimistic UI.
async function commit(res) {
  if (!res || !res.patch || Object.keys(res.patch).length === 0) return;
  const prev = game;
  game = { ...game, ...res.patch };
  renderGame();
  const { data, error } = await db.rpc('apply_event', { p_game: game.id, p_type: res.type, p_new: res.patch, p_payload: res.payload || {} });
  if (error) { game = prev; renderGame(); return alert(error.message); }
  game = data; renderGame();
  // Auto-fire the matching stinger.
  if (res.anim) fireAnim(res.anim);
  else if (res.type === 'run' || (res.type === 'walk' && res.payload?.runs)) fireAnim('run');
  else if (res.type === 'strikeout') fireAnim('strikeout');
}

// Fire a transient overlay stinger (not an undoable action — a plain trigger write).
async function fireAnim(type, meta = {}) {
  if (!game) return;
  const current_animation = { type, nonce: Date.now(), meta };
  game = { ...game, current_animation };
  const { error } = await db.from('games').update({ current_animation }).eq('id', game.id);
  if (error) console.warn('anim failed', error.message);
}

async function doUndo() {
  const { data, error } = await db.rpc('undo', { p_game: game.id });
  if (error) return alert(error.message);
  if (data) { game = data; renderGame(); }
}

// Buttons
$('btn-ball').onclick    = () => { const r = L.onBall(game); r.sheet === 'walk' ? openWalkSheet(r) : commit(r); };
$('btn-strike').onclick  = () => commit(L.onStrike(game));
$('btn-foul').onclick    = () => commit(L.onFoul(game));
$('btn-out').onclick     = () => commit(L.onOut(game));
$('btn-run').onclick     = () => commit(L.onRun(game));
$('btn-batter').onclick  = () => commit(L.onNextBatter(game));
$('btn-reset').onclick   = () => commit(L.onResetCount(game));
$('btn-endhalf').onclick = () => commit(L.onEndHalf(game));
$('btn-advance').onclick = () => commit(L.onAdvance(game));
$('btn-clear').onclick   = () => commit(L.onClearBases(game));
$('base-1').onclick      = () => commit(L.toggleBase(game, 'first'));
$('base-2').onclick      = () => commit(L.toggleBase(game, 'second'));
$('base-3').onclick      = () => commit(L.toggleBase(game, 'third'));
$('undo-btn').onclick    = doUndo;

// Football buttons
$('fb-poss-away').onclick = () => commit(F.setPossession(game, 'away'));
$('fb-poss-home').onclick = () => commit(F.setPossession(game, 'home'));
$('fb-down-1').onclick = () => commit(F.setDown(game, 1));
$('fb-down-2').onclick = () => commit(F.setDown(game, 2));
$('fb-down-3').onclick = () => commit(F.setDown(game, 3));
$('fb-down-4').onclick = () => commit(F.setDown(game, 4));
$('fb-dist-dn').onclick = () => commit(F.distanceDelta(game, -1));
$('fb-dist-up').onclick = () => commit(F.distanceDelta(game, 1));
$('fb-goal').onclick = () => commit(F.setGoal(game));
$('fb-firstdown').onclick = () => commit(F.firstDown(game));
$('fb-td').onclick = () => commit(F.touchdown(game));
$('fb-fg').onclick = () => commit(F.fieldGoal(game));
$('fb-xp').onclick = () => commit(F.extraPoint(game));
$('fb-2pt').onclick = () => commit(F.twoPoint(game));
$('fb-safety').onclick = () => commit(F.safety(game));
$('fb-nextq').onclick = () => commit(F.nextQuarter(game));
$('fb-away-dn').onclick = () => commit(F.manualScore(game, 'away', -1));
$('fb-away-up').onclick = () => commit(F.manualScore(game, 'away', 1));
$('fb-home-dn').onclick = () => commit(F.manualScore(game, 'home', -1));
$('fb-home-up').onclick = () => commit(F.manualScore(game, 'home', 1));
$('fb-to-away').onclick = () => commit(F.timeout(game, 'away'));
$('fb-to-home').onclick = () => commit(F.timeout(game, 'home'));
$('fb-to-reset').onclick = () => commit(F.resetTimeouts(game));
$('fx-touchdown').onclick = () => fireAnim('touchdown');
$('fx-fieldgoal').onclick = () => fireAnim('fieldgoal');
$('fx-turnover').onclick = () => fireAnim('turnover');
$('fx-bigplay').onclick = () => fireAnim('bigplay');

// Soccer buttons
$('sc-goal-away').onclick = () => commit(S.goal(game, 'away'));
$('sc-goal-home').onclick = () => commit(S.goal(game, 'home'));
$('sc-half-1').onclick = () => commit(S.setHalf(game, 1));
$('sc-half-2').onclick = () => commit(S.setHalf(game, 2));
$('sc-stop-dn').onclick = () => commit(S.stoppageDelta(game, -1));
$('sc-stop-up').onclick = () => commit(S.stoppageDelta(game, 1));
$('sc-yc-away').onclick = () => commit(S.card(game, 'away', 'y'));
$('sc-rc-away').onclick = () => commit(S.card(game, 'away', 'r'));
$('sc-yc-home').onclick = () => commit(S.card(game, 'home', 'y'));
$('sc-rc-home').onclick = () => commit(S.card(game, 'home', 'r'));
$('sc-away-dn').onclick = () => commit(S.manualScore(game, 'away', -1));
$('sc-away-up').onclick = () => commit(S.manualScore(game, 'away', 1));
$('sc-home-dn').onclick = () => commit(S.manualScore(game, 'home', -1));
$('sc-home-up').onclick = () => commit(S.manualScore(game, 'home', 1));
$('fx-goal').onclick = () => fireAnim('goal');

// Moments / FX
$('fx-homerun').onclick = () => fireAnim('homerun');
$('fx-k').onclick       = () => fireAnim('strikeout');
$('fx-dp').onclick      = () => fireAnim('doubleplay');
$('fx-gem').onclick     = () => fireAnim('webgem');
$('fx-sb').onclick      = () => fireAnim('stolenbase');
$('fx-walkoff').onclick = () => fireAnim('walkoff');
$('fx-rally').onclick   = async () => {
  const rally_mode = !game.rally_mode;
  game = { ...game, rally_mode };
  renderRally();
  const { error } = await db.from('games').update({ rally_mode }).eq('id', game.id);
  if (error) console.warn('rally failed', error.message);
};
function renderRally() {
  const b = $('fx-rally');
  b.textContent = `Rally: ${game.rally_mode ? 'ON' : 'OFF'}`;
  b.classList.toggle('on', !!game.rally_mode);
}

// ---- Game setup sheet -----------------------------------------------------
const suVal = (id) => $(id).value.trim();
$('setup-btn').onclick = () => { fillSetup(); $('setup-sheet').hidden = false; };
$('setup-cancel').onclick = () => { $('setup-sheet').hidden = true; };
function fillSetup() {
  $('su-sport').value = game.sport || 'baseball';
  $('su-style').value = game.style || 'bar';
  $('su-away-name').value = game.away_name || '';
  $('su-away-abbr').value = game.away_abbr || '';
  $('su-away-logo').value = game.away_logo_url || '';
  $('su-away-color').value = game.away_color || '#7a8794';
  $('su-home-name').value = game.home_name || '';
  $('su-home-abbr').value = game.home_abbr || '';
  $('su-home-logo').value = game.home_logo_url || '';
  $('su-home-color').value = game.home_color || '#1b2a41';
  $('su-time').value = game.time_limit_seconds ? Math.round(game.time_limit_seconds / 60) : '';
  $('su-show-clock').checked = !!game.show_clock;
  $('su-show-batter').checked = !!game.show_batter;
  $('su-show-pitcher').checked = !!game.show_pitcher;
  $('su-show-pitchcount').checked = !!game.show_pitchcount;
  $('su-show-runrule').checked = !!game.show_runrule;
  $('su-batter-name').value = game.batter_name || '';
  $('su-batter-num').value = game.batter_number || '';
  $('su-pitcher-name').value = game.pitcher_name || '';
  $('su-pitch-count').value = game.pitch_count || '';
}
$('setup-save').onclick = async () => {
  const mins = parseInt($('su-time').value, 10);
  const time_limit_seconds = Number.isFinite(mins) && mins > 0 ? mins * 60 : null;
  const sport = $('su-sport').value;
  const patch = {
    sport, style: $('su-style').value,
    away_name: suVal('su-away-name') || 'Visitor', away_abbr: (suVal('su-away-abbr') || 'VIS').toUpperCase(),
    away_logo_url: suVal('su-away-logo') || null, away_color: $('su-away-color').value,
    home_name: suVal('su-home-name') || 'Home', home_abbr: (suVal('su-home-abbr') || 'HOME').toUpperCase(),
    home_logo_url: suVal('su-home-logo') || null, home_color: $('su-home-color').value,
    time_limit_seconds,
    show_clock: $('su-show-clock').checked, show_batter: $('su-show-batter').checked,
    show_pitcher: $('su-show-pitcher').checked, show_pitchcount: $('su-show-pitchcount').checked,
    show_runrule: $('su-show-runrule').checked,
    batter_name: suVal('su-batter-name') || null, batter_number: suVal('su-batter-num') || null,
    pitcher_name: suVal('su-pitcher-name') || null, pitch_count: parseInt($('su-pitch-count').value, 10) || 0,
  };
  // Reset the clock's remaining time if the limit changed and it isn't running.
  if (time_limit_seconds && !game.clock_running) patch.clock_remaining_seconds = time_limit_seconds;
  // Initialize sport-specific situation the first time a game switches sport.
  if (sport === 'football' && !(game.state && game.state.quarter)) patch.state = F.fbState(game);
  if (sport === 'soccer' && !(game.state && game.state.half)) patch.state = S.scState(game);
  $('setup-sheet').hidden = true;
  await writeField(patch);
};

// ---- Time-limit clock -----------------------------------------------------
function clockRemaining(g) {
  if (!g || !g.time_limit_seconds) return 0;
  if (g.clock_running && g.clock_ends_at) return (new Date(g.clock_ends_at).getTime() - Date.now()) / 1000;
  return g.clock_remaining_seconds ?? g.time_limit_seconds;
}
$('clock-start').onclick = () => {
  if ((game.sport || 'baseball') === 'soccer') return commit(S.clockStart(game, new Date().toISOString()));
  if (!game.time_limit_seconds) return;
  const rem = game.clock_remaining_seconds ?? game.time_limit_seconds;
  writeField({ clock_running: true, clock_ends_at: new Date(Date.now() + rem * 1000).toISOString(), clock_remaining_seconds: rem });
};
$('clock-pause').onclick = () => {
  if ((game.sport || 'baseball') === 'soccer') return commit(S.clockPause(game, Date.now()));
  writeField({ clock_running: false, clock_ends_at: null, clock_remaining_seconds: Math.max(0, Math.round(clockRemaining(game))) });
};
$('clock-reset').onclick = () => {
  if ((game.sport || 'baseball') === 'soccer') return commit(S.clockReset(game));
  writeField({ clock_running: false, clock_ends_at: null, clock_remaining_seconds: game.time_limit_seconds });
};
function renderClock() {
  const row = $('clock-row');
  const sport = game.sport || 'baseball';
  if (sport === 'soccer') {
    row.hidden = false;
    const e = S.elapsedSeconds(game, Date.now());
    const st = S.scState(game);
    $('clock-display').textContent = Math.floor(e / 60) + ':' + String(Math.max(0, Math.round(e % 60))).padStart(2, '0') + (st.stoppage ? ` +${st.stoppage}` : '');
    $('clock-display').classList.remove('low');
    return;
  }
  if (!game || !game.time_limit_seconds) { row.hidden = true; return; }
  row.hidden = false;
  const rem = Math.max(0, Math.round(clockRemaining(game)));
  $('clock-display').textContent = Math.floor(rem / 60) + ':' + String(rem % 60).padStart(2, '0');
  $('clock-display').classList.toggle('low', rem <= 60);
}
setInterval(() => { if (game) renderClock(); }, 250);

// ---- Practice / demo mode -------------------------------------------------
let demoTimer = null;
$('demo-btn').onclick = () => {
  if (demoTimer) { clearInterval(demoTimer); demoTimer = null; }
  else demoTimer = setInterval(demoStep, 1800);
  $('demo-btn').classList.toggle('on', !!demoTimer);
  $('demo-btn').textContent = demoTimer ? '■ Stop Demo' : '▶ Demo Mode';
};
function demoStep() {
  const sport = game.sport || 'baseball';
  if (sport === 'football') return demoStepFootball();
  if (sport === 'soccer') return demoStepSoccer();
  const r = Math.random();
  if (r < 0.10) return fireAnim(['homerun', 'strikeout', 'doubleplay', 'webgem', 'stolenbase'][Math.floor(Math.random() * 5)]);
  if (r < 0.34) { // ball, but auto-resolve a walk instead of opening the sheet
    if ((game.balls | 0) >= 3) { const w = L.computeWalk(game.bases); commit({ type: 'walk', patch: { balls: 0, strikes: 0, bases: w.bases, ...L.runsPatch(game, w.runs) }, payload: { runs: w.runs } }); }
    else commit({ type: 'ball', patch: { balls: (game.balls | 0) + 1 } });
    return;
  }
  if (r < 0.54) return commit(L.onStrike(game));
  if (r < 0.66) return commit(L.onFoul(game));
  if (r < 0.80) return commit(L.onOut(game));
  if (r < 0.90) return commit(L.onRun(game));
  return commit(L.onAdvance(game));
}

function demoStepFootball() {
  const r = Math.random();
  if (r < 0.14) return fireAnim(['touchdown', 'fieldgoal', 'turnover', 'bigplay'][Math.floor(Math.random() * 4)]);
  if (r < 0.28) return commit(F.touchdown(game));
  if (r < 0.38) return commit(F.fieldGoal(game));
  if (r < 0.54) return commit(F.setDown(game, (F.fbState(game).down % 4) + 1));
  if (r < 0.70) return commit(F.distanceDelta(game, Math.random() < 0.5 ? -3 : 3));
  if (r < 0.82) return commit(F.firstDown(game));
  if (r < 0.93) return commit(F.setPossession(game, Math.random() < 0.5 ? 'home' : 'away'));
  return commit(F.nextQuarter(game));
}

function demoStepSoccer() {
  const r = Math.random();
  const team = () => (Math.random() < 0.5 ? 'home' : 'away');
  if (r < 0.14) return fireAnim('goal');
  if (r < 0.22) return commit(S.goal(game, team()));
  if (r < 0.36) return commit(S.card(game, team(), Math.random() < 0.85 ? 'y' : 'r'));
  if (r < 0.52) return commit(S.stoppageDelta(game, Math.random() < 0.5 ? -1 : 1));
  if (r < 0.58) return commit(S.setHalf(game, S.scState(game).half === 1 ? 2 : 1));
  // otherwise idle; the match clock keeps ticking if running
}

$('preview-fx-btn').onclick = async () => {
  const sets = {
    baseball: ['run', 'homerun', 'strikeout', 'doubleplay', 'webgem', 'stolenbase', 'walkoff', 'charge'],
    football: ['touchdown', 'fieldgoal', 'turnover', 'bigplay', 'charge'],
    soccer: ['goal', 'charge'],
  };
  const types = sets[game.sport || 'baseball'] || sets.baseball;
  for (const t of types) { fireAnim(t); await new Promise((r) => setTimeout(r, 2600)); }
};

// ---- Look settings (theme / position / scale)
async function writeField(patch) {
  game = { ...game, ...patch };
  renderLook();
  const { error } = await db.from('games').update(patch).eq('id', game.id);
  if (error) console.warn('look write failed', error.message);
}
$('theme-sel').addEventListener('change', (e) => writeField({ theme: e.target.value }));
$('pos-sel').addEventListener('change', (e) => writeField({ scorebug_position: e.target.value }));
$('scale-sel').addEventListener('input', (e) => { $('scale-val').textContent = (+e.target.value).toFixed(2) + '×'; });
$('scale-sel').addEventListener('change', (e) => writeField({ scorebug_scale: +e.target.value }));
function renderLook() {
  $('theme-sel').value = game.theme || 'nightgame';
  $('pos-sel').value = game.scorebug_position || 'bottom-bar';
  const sc = game.scorebug_scale || 1;
  $('scale-sel').value = sc;
  $('scale-val').textContent = (+sc).toFixed(2) + '×';
}

// ---- Sound settings (written to game.audio / game.sound_pack, synced to overlay)
$('fx-charge').onclick = () => fireAnim('charge');

const audioOf = () => game.audio || { muted: false, master: 0.8, cats: { moments: 1, organ: 1 } };
async function writeAudio(patch) {
  const cur = audioOf();
  const audio = { ...cur, ...patch, cats: { ...cur.cats, ...(patch.cats || {}) } };
  game = { ...game, audio };
  renderAudio();
  const { error } = await db.from('games').update({ audio }).eq('id', game.id);
  if (error) console.warn('audio write failed', error.message);
}
$('mute-btn').onclick = () => writeAudio({ muted: !audioOf().muted });
$('vol-master').addEventListener('change', (e) => writeAudio({ master: +e.target.value }));
$('vol-moments').addEventListener('change', (e) => writeAudio({ cats: { moments: +e.target.value } }));
$('vol-organ').addEventListener('change', (e) => writeAudio({ cats: { organ: +e.target.value } }));
$('sound-pack').addEventListener('change', async (e) => {
  game = { ...game, sound_pack: e.target.value };
  const { error } = await db.from('games').update({ sound_pack: e.target.value }).eq('id', game.id);
  if (error) console.warn('pack write failed', error.message);
});

function renderAudio() {
  const a = audioOf();
  $('vol-master').value = a.master ?? 0.8;
  $('vol-moments').value = a.cats?.moments ?? 1;
  $('vol-organ').value = a.cats?.organ ?? 1;
  $('mute-btn').classList.toggle('on', !!a.muted);
  $('mute-btn').textContent = a.muted ? 'Muted' : 'Mute';
  $('sound-pack').value = game.sound_pack || 'bigleague';
}

// Walk sheet ----------------------------------------------------------------
let wState = { first: false, second: false, third: false, runs: 0 };
function paintWalk() {
  $('w1').classList.toggle('on', wState.first);
  $('w2').classList.toggle('on', wState.second);
  $('w3').classList.toggle('on', wState.third);
  $('w-runs').textContent = wState.runs;
}
function openWalkSheet(r) {
  const b = r.patch.bases;
  wState = { first: b.first, second: b.second, third: b.third, runs: r.payload.runs | 0 };
  paintWalk(); $('walk-sheet').hidden = false;
}
$('w1').onclick = () => { wState.first = !wState.first; paintWalk(); };
$('w2').onclick = () => { wState.second = !wState.second; paintWalk(); };
$('w3').onclick = () => { wState.third = !wState.third; paintWalk(); };
$('w-runs-up').onclick = () => { wState.runs = Math.min(wState.runs + 1, 4); paintWalk(); };
$('w-runs-dn').onclick = () => { wState.runs = Math.max(wState.runs - 1, 0); paintWalk(); };
$('walk-cancel').onclick = () => { $('walk-sheet').hidden = true; };
$('walk-confirm').onclick = () => {
  $('walk-sheet').hidden = true;
  const bases = { first: wState.first, second: wState.second, third: wState.third };
  commit({ type: 'walk', patch: { balls: 0, strikes: 0, bases, ...L.runsPatch(game, wState.runs) }, payload: { runs: wState.runs } });
};

// Render --------------------------------------------------------------------
const ordinal = (n) => ({ 1: '1st', 2: '2nd', 3: '3rd', 4: '4th' }[n] || n + 'th');
function showSport(sport) {
  document.querySelectorAll('.sport-only').forEach((el) => { el.hidden = el.dataset.sport !== sport; });
}
function renderGame() {
  if (!game) return;
  const sport = game.sport || 'baseball';
  showSport(sport);
  $('g-away-name').textContent = game.away_name;
  $('g-home-name').textContent = game.home_name;
  $('g-away-runs').textContent = game.away_score;
  $('g-home-runs').textContent = game.home_score;
  if (sport === 'football') renderFootballControl();
  else if (sport === 'soccer') renderSoccerControl();
  else renderBaseballControl();
  renderRally();
  renderAudio();
  renderLook();
  renderClock();
}
function renderBaseballControl() {
  const b = L.safeBases(game.bases);
  $('sc-mid').innerHTML = `<span class="sc-inning">${game.half === 'top' ? '▲' : '▼'} ${game.inning}</span>` +
    `<span class="sc-count">${game.balls} - ${game.strikes}</span><span class="sc-outs">${game.outs} out</span>`;
  $('g-batting').textContent = `Batting: ${game.half === 'bottom' ? game.home_name : game.away_name}`;
  $('base-1').classList.toggle('on', b.first);
  $('base-2').classList.toggle('on', b.second);
  $('base-3').classList.toggle('on', b.third);
}
function renderFootballControl() {
  const st = F.fbState(game);
  const dd = st.distance === 'goal' ? `${ordinal(st.down)} & Goal` : `${ordinal(st.down)} & ${st.distance}`;
  const poss = st.possession === 'away' ? '🏈 ◄' : st.possession === 'home' ? '► 🏈' : '—';
  $('sc-mid').innerHTML = `<span class="sc-inning">Q${st.quarter}</span><span class="sc-count">${dd}</span><span class="sc-outs">${poss}</span>`;
  $('g-batting').textContent = st.possession ? `Ball: ${st.possession === 'home' ? game.home_name : game.away_name}` : 'Possession: —';
  $('fb-dist-val').textContent = st.distance === 'goal' ? 'Gl' : st.distance;
  $('fb-poss-away').classList.toggle('on', st.possession === 'away');
  $('fb-poss-home').classList.toggle('on', st.possession === 'home');
  for (const d of [1, 2, 3, 4]) $('fb-down-' + d).classList.toggle('on', st.down === d);
}
function renderSoccerControl() {
  const st = S.scState(game);
  $('sc-mid').innerHTML = `<span class="sc-inning">${st.half === 2 ? '2nd' : '1st'} Half</span>` +
    `<span class="sc-count">⚽</span><span class="sc-outs">${st.stoppage ? '+' + st.stoppage : ''}</span>`;
  $('g-batting').textContent = 'Soccer';
  $('sc-stop-val').textContent = '+' + st.stoppage;
  $('sc-half-1').classList.toggle('on', st.half === 1);
  $('sc-half-2').classList.toggle('on', st.half === 2);
}

$('copy-url-btn').onclick = async () => {
  try { await navigator.clipboard.writeText($('overlay-url').value); $('copy-url-btn').textContent = 'Copied!'; setTimeout(() => ($('copy-url-btn').textContent = 'Copy'), 1200); } catch {}
};

refreshSession();
