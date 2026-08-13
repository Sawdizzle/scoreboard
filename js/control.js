import { supabase, db } from './supabase.js';
import { SUPABASE_URL, SUPABASE_ANON_KEY, USER_EMAIL_DOMAIN } from './config.js';
import * as L from './logic.js';

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
    .select('id,home_name,away_name,home_runs,away_runs,status')
    .eq('owner_id', user.id).order('updated_at', { ascending: false });
  const list = $('games-list'); list.innerHTML = '';
  if (error) { list.textContent = error.message; return; }
  if (!data.length) { list.innerHTML = '<p class="muted">No games yet — create one.</p>'; return; }
  for (const g of data) {
    const b = document.createElement('button');
    b.className = 'game-row';
    b.innerHTML = `<strong>${esc(g.away_name)} @ ${esc(g.home_name)}</strong><span>${g.away_runs}–${g.home_runs} · ${g.status}</span>`;
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
  // Auto-fire the matching stinger for scoring / strikeout actions.
  if (res.type === 'run' || (res.type === 'walk' && res.payload?.runs)) fireAnim('run');
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
function renderGame() {
  if (!game) return;
  const b = L.safeBases(game.bases);
  $('g-away-name').textContent = game.away_name;
  $('g-home-name').textContent = game.home_name;
  $('g-away-runs').textContent = game.away_runs;
  $('g-home-runs').textContent = game.home_runs;
  $('g-inning').textContent = `${game.half === 'top' ? '▲' : '▼'} ${game.inning}`;
  $('g-count').textContent = `${game.balls} - ${game.strikes}`;
  $('g-outs').textContent = `${game.outs} out`;
  $('g-batting').textContent = `Batting: ${game.half === 'bottom' ? game.home_name : game.away_name}`;
  $('base-1').classList.toggle('on', b.first);
  $('base-2').classList.toggle('on', b.second);
  $('base-3').classList.toggle('on', b.third);
  renderRally();
  renderAudio();
  renderLook();
}

$('copy-url-btn').onclick = async () => {
  try { await navigator.clipboard.writeText($('overlay-url').value); $('copy-url-btn').textContent = 'Copied!'; setTimeout(() => ($('copy-url-btn').textContent = 'Copy'), 1200); } catch {}
};

refreshSession();
