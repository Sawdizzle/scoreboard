import { supabase, db } from './supabase.js';
import { SUPABASE_URL, SUPABASE_ANON_KEY, USER_EMAIL_DOMAIN } from './config.js';
import * as L from './logic.js';
import * as F from './football.js';
import * as S from './soccer.js';
import * as V from './volleyball.js';
import * as B from './basketball.js';

const $ = (id) => document.getElementById(id);
const views = { auth: $('auth-view'), lobby: $('lobby-view'), game: $('game-view') };
const show = (view) => { for (const k in views) views[k].hidden = (k !== view); };
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const emailFor = (u) => `${u.trim().toLowerCase()}@${USER_EMAIL_DOMAIN}`;

let toastTimer;
function showToast(msg, ms = 1600) {
  const t = $('toast'); if (!t) return;
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}
const haptic = () => { try { navigator.vibrate && navigator.vibrate(8); } catch {} };

let user = null;
let game = null;
let channel = null;

// ---------------------------------------------------------------- Auth
async function refreshSession() {
  const { data } = await supabase.auth.getSession();
  user = data.session?.user ?? null;
  if (user) { $('who').textContent = user.user_metadata?.username || 'signed in'; show('lobby'); await loadGames(); await loadPresets(); await loadTeams(); }
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
const SPORT_LABEL = { baseball: '⚾', football: '🏈', soccer: '⚽', volleyball: '🏐', basketball: '🏀' };
// Compact "how stale is this game" stamp for the lobby list.
function timeAgo(iso) {
  if (!iso) return '';
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 90) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  if (s < 7 * 86400) return Math.floor(s / 86400) + 'd ago';
  return new Date(iso).toLocaleDateString();
}
async function loadGames() {
  const list = $('games-list');
  list.innerHTML = '<p class="muted">Loading…</p>';
  const { data, error } = await db.from('games')
    .select('id,home_name,away_name,home_score,away_score,status,sport,updated_at')
    .eq('owner_id', user.id).order('updated_at', { ascending: false });
  list.innerHTML = '';
  if (error) { list.textContent = error.message; return; }
  if (!data.length) { list.innerHTML = '<p class="muted">No games yet — create one.</p>'; return; }
  for (const g of data) {
    const row = document.createElement('div');
    row.className = 'game-row';
    const open = document.createElement('button');
    open.className = 'game-open';
    open.innerHTML = `<strong>${SPORT_LABEL[g.sport] || '⚾'} ${esc(g.away_name)} @ ${esc(g.home_name)}</strong>` +
      `<span>${g.away_score}–${g.home_score} · ${esc(g.status)}<span class="ago">${timeAgo(g.updated_at)}</span></span>`;
    open.onclick = () => openGame(g.id);
    const del = document.createElement('button');
    del.className = 'game-del';
    del.textContent = '🗑';
    del.title = 'Delete game';
    del.setAttribute('aria-label', `Delete ${g.away_name} at ${g.home_name}`);
    del.onclick = async (e) => {
      e.stopPropagation();
      if (!confirm(`Delete "${g.away_name} @ ${g.home_name}"? This permanently removes the game and cannot be undone.`)) return;
      await deleteGame(g.id);
    };
    row.appendChild(open); row.appendChild(del);
    list.appendChild(row);
  }
}
async function deleteGame(id) {
  const { error } = await db.from('games').delete().eq('id', id);
  if (error) return alert(error.message);
  await loadGames();
}

// New game: pick sport + style first, then create with the right initial state.
$('new-game-btn').addEventListener('click', () => { $('newgame-sheet').hidden = false; });
$('ng-cancel').onclick = () => { $('newgame-sheet').hidden = true; };
$('ng-create').onclick = async () => {
  const sport = $('ng-sport').value, style = $('ng-style').value;
  const row = { status: 'live', sport, style };
  if (sport === 'football') row.state = F.fbState({});
  else if (sport === 'soccer') row.state = S.scState({});
  else if (sport === 'volleyball') row.state = V.vbState({});
  else if (sport === 'basketball') row.state = B.bkState({});
  const { data, error } = await db.from('games').insert(row).select().single();
  if (error) return alert(error.message);
  $('newgame-sheet').hidden = true;
  await openGame(data.id);
  openSetupGuide(); // fresh game → expand the checklist
};

// ---------------------------------------------------------------- Game
// Keep the phone awake while a game is open — a sleeping screen mid-inning
// kills the realtime feed and costs taps. Progressive enhancement only.
let wakeLock = null;
async function keepAwake(on) {
  try {
    if (on && !wakeLock && 'wakeLock' in navigator) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } else if (!on && wakeLock) { const w = wakeLock; wakeLock = null; await w.release(); }
  } catch {} // denied (low battery etc.) — not critical
}
async function openGame(id) {
  const { data, error } = await db.from('games').select('*').eq('id', id).single();
  if (error) return alert(error.message);
  game = data; overlayCopied = false; guideCollapsed = setupAllDone();
  resetReplayUi();
  show('game'); renderGame();
  $('overlay-url').value = `${location.origin}/overlay?game=${id}`;
  keepAwake(true);
  await subscribe(id);
}
async function closeGame() {
  stopDemo(); keepAwake(false); resetReplayUi(); disarmObs();
  await teardownChannel(); game = null; show('lobby'); await loadGames();
}
$('back-btn').addEventListener('click', closeGame);

let ctrlReconnect = null;
function setConn(state) {
  const d = $('conn-dot'); if (!d) return;
  d.dataset.state = state;
  d.title = state === 'live' ? 'Live — synced' : state === 'down' ? 'Offline — reconnecting…' : 'Connecting…';
}
// Re-pull the authoritative row (heals any updates missed while disconnected).
async function reloadGame(id) {
  const { data, error } = await db.from('games').select('*').eq('id', id).maybeSingle();
  if (!error && data) { game = data; renderGame(); }
}
async function subscribe(id) {
  await teardownChannel();
  setConn('connecting');
  channel = supabase.channel(`ctrl:${id}`)
    .on('postgres_changes', { event: 'UPDATE', schema: 'scoreboard', table: 'games', filter: `id=eq.${id}` },
      (payload) => { game = payload.new; renderGame(); })
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') { setConn('live'); reloadGame(id); }
      else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        setConn('down');
        if (!ctrlReconnect && game && game.id === id) {
          ctrlReconnect = setTimeout(() => { ctrlReconnect = null; if (game && game.id === id) subscribe(id); }, 2500);
        }
      }
    });
}
async function teardownChannel() {
  if (ctrlReconnect) { clearTimeout(ctrlReconnect); ctrlReconnect = null; }
  if (channel) { const c = channel; channel = null; await supabase.removeChannel(c); }
}
// Heal state when the network or tab comes back (flaky-LTE guard, like the overlay).
addEventListener('online', () => { if (game) reloadGame(game.id); });
addEventListener('offline', () => setConn('down'));
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && game) { reloadGame(game.id); keepAwake(true); } // the OS drops wake locks on hide
});

// Atomic apply via RPC (snapshots prev_state for undo). Optimistic UI.
async function commit(res) {
  if (!res || !res.patch || Object.keys(res.patch).length === 0) return;
  haptic();
  const prev = game;
  game = { ...game, ...res.patch };
  renderGame();
  const { data, error } = await db.rpc('apply_event', { p_game: game.id, p_type: res.type, p_new: res.patch, p_payload: res.payload || {} });
  // Non-blocking: an alert() here would freeze the pad mid-broadcast.
  if (error) { game = prev; renderGame(); return showToast(`⚠️ Didn't save — ${error.message}`, 3000); }
  game = data; renderGame();
  // Auto-fire the matching stinger. A walk-off supersedes everything (even a HR).
  if (maybeWalkoff(prev, game)) { /* walk-off fired */ }
  else if (res.anim) fireAnim(res.anim);
  else if (res.type === 'run' || res.payload?.runs) fireAnim('run');
  else if (res.type === 'strikeout') fireAnim('strikeout');
}

// Home takes the lead in the bottom of the final (regulation+) inning → walk-off.
// Opt-in: only when regulation_innings is set (> 0). Returns true if it fired.
function maybeWalkoff(before, after) {
  const reg = after.regulation_innings | 0;
  if ((after.sport || 'baseball') !== 'baseball' || !reg) return false;
  if (after.half === 'bottom' && (after.inning | 0) >= reg &&
      (after.home_score | 0) > (after.away_score | 0) &&
      (before.home_score | 0) <= (before.away_score | 0)) {
    fireAnim('walkoff');
    return true;
  }
  return false;
}

// Strictly-increasing nonce so two triggers in the same millisecond don't collide
// (the overlay only plays a stinger whose nonce is greater than the last one seen).
let lastNonce = 0;
const nextNonce = () => (lastNonce = Math.max(Date.now(), lastNonce + 1));

// Fire a transient overlay stinger (not an undoable action — a plain trigger write).
async function fireAnim(type, meta = {}) {
  if (!game) return;
  if (game.auto_clip && type in CLIP_DELAY_MS) saveReplay(true, CLIP_DELAY_MS[type]);
  const current_animation = { type, nonce: nextNonce(), meta };
  game = { ...game, current_animation };
  const { error } = await db.from('games').update({ current_animation }).eq('id', game.id);
  if (error) console.warn('anim failed', error.message);
}

async function doUndo() {
  const { data, error } = await db.rpc('undo', { p_game: game.id });
  if (error) return showToast(`⚠️ ${error.message}`, 3000);
  if (data) { game = data; renderGame(); showToast('↶ Undone'); }
  else showToast('Nothing to undo');
}

// Buttons
$('btn-ball').onclick    = () => { const r = L.onBall(game); r.sheet === 'walk' ? openWalkSheet(r) : commit(r); };
$('btn-strike').onclick  = () => commit(L.onStrike(game));
$('btn-foul').onclick    = () => commit(L.onFoul(game));
$('btn-out').onclick     = () => commit(L.onOut(game));
$('btn-run').onclick     = () => commit(L.onRun(game));
$('btn-batter').onclick  = () => commit(L.onNextBatter(game));
$('hit-1b').onclick      = () => commit(L.onHit(game, 1));
$('hit-2b').onclick      = () => commit(L.onHit(game, 2));
$('hit-3b').onclick      = () => commit(L.onHit(game, 3));
$('hit-e').onclick       = () => commit(L.onError(game));
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
$('fb-kickoff').onclick = () => commit(F.kickoff(game));
$('fx-turnover').onclick = () => commit(F.turnover(game));
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

// Volleyball buttons
$('vb-point-away').onclick = () => commit(V.point(game, 'away'));
$('vb-point-home').onclick = () => commit(V.point(game, 'home'));
$('vb-serve-away').onclick = () => commit(V.setServe(game, 'away'));
$('vb-serve-home').onclick = () => commit(V.setServe(game, 'home'));
$('vb-target').onclick = () => commit(V.cycleTarget(game));
$('vb-endset').onclick = () => { const r = V.endSet(game); r ? commit(r) : showToast('Tied — score the deciding point first'); };
$('vb-set-dn').onclick = () => commit(V.adjustSet(game, -1));
$('vb-set-up').onclick = () => commit(V.adjustSet(game, 1));
$('vb-sets-away-dn').onclick = () => commit(V.adjustSets(game, 'away', -1));
$('vb-sets-away-up').onclick = () => commit(V.adjustSets(game, 'away', 1));
$('vb-sets-home-dn').onclick = () => commit(V.adjustSets(game, 'home', -1));
$('vb-sets-home-up').onclick = () => commit(V.adjustSets(game, 'home', 1));
$('vb-away-dn').onclick = () => commit(V.manualScore(game, 'away', -1));
$('vb-home-dn').onclick = () => commit(V.manualScore(game, 'home', -1));
$('fx-ace').onclick = () => { const r = V.ace(game); r ? commit(r) : showToast('Set the serving team first'); };

// Basketball buttons
$('bk-away-1').onclick = () => commit(B.score(game, 'away', 1));
$('bk-away-2').onclick = () => commit(B.score(game, 'away', 2));
$('bk-away-3').onclick = () => commit(B.score(game, 'away', 3));
$('bk-home-1').onclick = () => commit(B.score(game, 'home', 1));
$('bk-home-2').onclick = () => commit(B.score(game, 'home', 2));
$('bk-home-3').onclick = () => commit(B.score(game, 'home', 3));
$('bk-away-dn').onclick = () => commit(B.score(game, 'away', -1));
$('bk-home-dn').onclick = () => commit(B.score(game, 'home', -1));
$('bk-period-dn').onclick = () => commit(B.adjustPeriod(game, -1));
$('bk-period-up').onclick = () => commit(B.adjustPeriod(game, 1));
$('bk-nextperiod').onclick = () => commit(B.nextPeriod(game));
$('bk-foul-away').onclick = () => commit(B.foul(game, 'away', 1));
$('bk-foul-away-dn').onclick = () => commit(B.foul(game, 'away', -1));
$('bk-foul-home').onclick = () => commit(B.foul(game, 'home', 1));
$('bk-foul-home-dn').onclick = () => commit(B.foul(game, 'home', -1));
$('bk-to-away').onclick = () => commit(B.timeout(game, 'away'));
$('bk-to-home').onclick = () => commit(B.timeout(game, 'home'));
$('bk-to-reset').onclick = () => commit(B.resetTimeouts(game));
$('fx-bigplay-bk').onclick = () => fireAnim('bigplay');

// Look presets (per-user saved bundles of presentation settings)
async function loadPresets() {
  if (!user) return;
  const { data, error } = await db.from('presets').select('id,name,settings').eq('owner_id', user.id).order('name');
  const sel = $('preset-sel');
  sel.innerHTML = '<option value="">— saved looks —</option>';
  if (error) return;
  for (const p of data || []) {
    const o = document.createElement('option');
    o.value = p.id; o.textContent = p.name; o.dataset.settings = JSON.stringify(p.settings || {});
    sel.appendChild(o);
  }
}
const currentLookBundle = () => ({
  theme: game.theme, style: game.style, scorebug_position: game.scorebug_position,
  scorebug_scale: game.scorebug_scale, sound_pack: game.sound_pack, look: game.look || {},
});
$('preset-save').onclick = async () => {
  const name = $('preset-name').value.trim();
  if (!name) return alert('Name the preset first.');
  const { error } = await db.from('presets').insert({ name, settings: currentLookBundle() });
  if (error) return alert(error.message);
  $('preset-name').value = '';
  await loadPresets();
  showToast('💾 Preset saved');
};
$('preset-apply').onclick = async () => {
  const opt = $('preset-sel').selectedOptions[0];
  if (!opt || !opt.value) return;
  const s = JSON.parse(opt.dataset.settings || '{}');
  await writeField({
    theme: s.theme || 'nightgame', style: s.style || 'bar',
    scorebug_position: s.scorebug_position || 'bottom-bar', scorebug_scale: s.scorebug_scale || 1,
    sound_pack: s.sound_pack || 'bigleague', look: s.look || {},
  });
  showToast(`🎨 Applied "${opt.textContent}"`);
};
$('preset-del').onclick = async () => {
  const opt = $('preset-sel').selectedOptions[0];
  if (!opt || !opt.value) return;
  await db.from('presets').delete().eq('id', opt.value);
  await loadPresets();
  showToast('Preset deleted');
};

// ---- Saved teams (reusable rosters) ---------------------------------------
// A team = identity (name/abbr/color/logo) + roster (a lineups[side] blob).
let savedTeams = [];
async function loadTeams() {
  if (!user) return;
  const { data, error } = await db.from('teams').select('*').eq('owner_id', user.id).order('name');
  if (error) { console.warn('teams load failed', error.message); return; }
  savedTeams = data || [];
  for (const side of ['away', 'home']) {
    const sel = $('team-sel-' + side); if (!sel) continue;
    const cur = sel.value;
    sel.innerHTML = '<option value="">— load saved team —</option>' +
      savedTeams.map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join('');
    if (savedTeams.some((t) => t.id === cur)) sel.value = cur;
  }
}
async function saveTeam(side) {
  if (!game) return;
  const name = String(game[side + '_name'] || '').trim();
  if (!name || name === 'Visitor' || name === 'Home') return showToast('Name the team in Setup first');
  const row = {
    owner_id: user.id, name,
    abbr: game[side + '_abbr'] || null,
    color: game[side + '_color'] || null,
    logo_url: game[side + '_logo_url'] || null,
    roster: (game.lineups || {})[side] || {},
    updated_at: new Date().toISOString(),
  };
  const { error } = await db.from('teams').upsert(row, { onConflict: 'owner_id,name' });
  if (error) return alert(error.message);
  await loadTeams();
  showToast(`💾 Saved "${name}"`);
}
async function loadTeamInto(side, id) {
  const t = savedTeams.find((x) => x.id === id);
  if (!t) return;
  const patch = { lineups: { ...(game.lineups || {}), [side]: t.roster || {} } };
  patch[side + '_name'] = t.name;
  if (t.abbr) patch[side + '_abbr'] = t.abbr;
  if (t.color) patch[side + '_color'] = t.color;
  patch[side + '_logo_url'] = t.logo_url || null;
  // Fresh roster → reset that side's current hitter and pitch count.
  const st = game.state || {};
  patch.state = {
    ...st,
    batIdx: { ...(st.batIdx || {}), [side]: 0 },
    pitches: { ...(st.pitches || {}), [side]: 0 },
  };
  await writeField(patch);
  fillLineup(side); // force-refresh inputs even though focus sits in this panel
  renderGame();
  showToast(`📥 Loaded "${t.name}"`);
}
async function deleteTeam(side) {
  const id = $('team-sel-' + side).value;
  if (!id) return showToast('Pick a saved team to delete');
  const t = savedTeams.find((x) => x.id === id);
  if (!confirm(`Delete saved team "${t ? t.name : ''}"? This won't change any game.`)) return;
  const { error } = await db.from('teams').delete().eq('id', id);
  if (error) return alert(error.message);
  await loadTeams();
  showToast('Saved team deleted');
}
for (const side of ['away', 'home']) {
  $('team-sel-' + side).addEventListener('change', (e) => { if (e.target.value) loadTeamInto(side, e.target.value); });
  $('team-save-' + side).onclick = () => saveTeam(side);
  $('team-del-' + side).onclick = () => deleteTeam(side);
}

// Broadcast cards (persistent until cleared)
async function showCard(type) {
  const meta = {};
  const text = $('card-text').value.trim();
  if (text) meta.text = text;
  // Due Up auto-fills the batting team's next 3 hitters (unless you typed names).
  if (type === 'dueup' && !text) {
    const lines = L.dueUp(game, 3).map((b) => (b.num ? `#${b.num} ` : '') + b.name).filter((s) => s.trim());
    if (lines.length) meta.lines = lines;
  }
  // Defense card always tracks the fielding team live (resolved in the overlay);
  // the lineup card tracks the batting side the same way.
  if (type === 'lineup') meta.auto = true;
  const card = { type, meta, nonce: nextNonce() };
  game = { ...game, card };
  const { error } = await db.from('games').update({ card }).eq('id', game.id);
  if (error) return console.warn('card failed', error.message);
  showToast(`🎬 ${type[0].toUpperCase() + type.slice(1)} card up`);
}
$('card-starting').onclick = () => showCard('starting');
$('card-midinning').onclick = () => showCard('midinning');
$('card-finalfull').onclick = () => showCard('finalfull');
$('card-matchup').onclick = () => showCard('matchup');
$('card-final').onclick = () => showCard('final');
$('card-dueup').onclick = () => showCard('dueup');
$('card-sponsor').onclick = () => showCard('sponsor');
async function clearCard() {
  game = { ...game, card: null };
  const { error } = await db.from('games').update({ card: null }).eq('id', game.id);
  if (error) return console.warn('card clear failed', error.message);
  showToast('Card cleared');
}
$('card-clear').onclick = clearCard;

// Current-inning auto cards (Broadcast panel): batting order = batting side,
// defense = fielding side, flipping with the half.
async function toggleAutoCard(type) {
  const c = game.card;
  const up = c && c.type === type && (type === 'lineup' ? (c.meta || {}).auto : true);
  if (up) await clearCard();
  else await showCard(type); // auto: overlay tracks batting/fielding side live
  renderAutoCardLabels();
}
$('card-bat-auto').onclick = () => toggleAutoCard('lineup');
$('card-def-auto').onclick = () => toggleAutoCard('defense');
function renderAutoCardLabels() {
  if (!game || (game.sport || 'baseball') !== 'baseball') return;
  const abbr = (s) => (s === 'home' ? (game.home_abbr || 'HOME') : (game.away_abbr || 'AWAY'));
  const bat = L.battingSide(game), def = L.fieldingSide(game), c = game.card;
  const batUp = c && c.type === 'lineup' && (c.meta || {}).auto;
  const defUp = c && c.type === 'defense';
  $('card-bat-auto').textContent = batUp ? '📋 Hide batting' : `📋 Batting: ${abbr(bat)}`;
  $('card-def-auto').textContent = defUp ? '🧤 Hide defense' : `🧤 Defense: ${abbr(def)}`;
}

// Moments / FX
$('fx-homerun').onclick = () => openHrSheet();
$('fx-k').onclick       = () => fireAnim('strikeout');
$('fx-klook').onclick   = () => fireAnim('strikeoutlooking');
$('fx-dp').onclick      = () => fireAnim('doubleplay');
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

// ---- OBS permission tiers -------------------------------------------------
// The overlay's page permissions decide how much of OBS the pad may drive. Every
// tier is a legitimate way to run the app: at "no access" the scorebug, cards,
// takeovers, moments and sound all work exactly the same — that's the whole
// product for most people. So a feature you haven't unlocked reads as muted
// information, never as a warning; amber is kept for things that are actually
// misconfigured, like a replay buffer that isn't running.
const OBS_TIER = { 3: 'Basic', 4: 'Advanced', 5: 'Full' };
// Any of the three reporters carries the level; take the freshest one we have.
function obsLevel() {
  if (!game) return null;
  const src = [game.obs_status, game.obs_scenes, game.replay_ack]
    .filter((o) => o && typeof o.level === 'number')
    .sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')))[0];
  return src ? src.level | 0 : null;
}
// The one sentence explaining why a locked feature is locked.
function needNote(need) {
  const lvl = obsLevel();
  if (lvl === null) return { tone: 'off', text: 'Open the overlay in OBS to use this.' };
  return { tone: 'off', text: `Needs Page permissions “${OBS_TIER[need]} access to OBS” on the overlay source — you're on “${OBS_TIER[lvl] || 'No access'}”. Everything else keeps working.` };
}
function setNeedBadge(id, need) {
  const el = $(id); if (!el) return;
  const lvl = obsLevel();
  el.textContent = lvl !== null && lvl >= need ? '' : `needs ${OBS_TIER[need]}`;
}

// ---- OBS stream / record / replay buffer ----------------------------------
// Ending a stream from a phone in your pocket has to be hard to do by accident,
// but a modal would freeze the pad mid-broadcast (the same reason commit() never
// alerts). So stopping arms on the first tap and fires on the second, and the
// arm expires on its own.
const OBS_BTN = {
  stream: { el: 'obs-stream', need: 5, on: 'streaming', start: 'stream_start', stop: 'stream_stop',
            idle: '🔴 Go Live', live: '⏹ End Stream', arm: 'Tap again to end', danger: true },
  record: { el: 'obs-record', need: 5, on: 'recording', start: 'record_start', stop: 'record_stop',
            idle: '⏺ Record', live: '⏹ Stop Rec', arm: 'Tap again to stop', danger: true },
  buffer: { el: 'obs-buffer', need: 4, on: 'buffer', start: 'buffer_start', stop: 'buffer_stop',
            idle: '🎞️ Buffer On', live: '🎞️ Buffer Off', arm: null, danger: false },
};
let obsArmed = null;      // key of the button waiting for its second tap
let obsArmTimer = null;
let obsWaiting = null;    // {key, at} — command sent, watching for OBS to actually change
let obsNote = null;

function disarmObs() { obsArmed = null; clearTimeout(obsArmTimer); obsArmTimer = null; }

async function sendObsCmd(action) {
  if (!game) return;
  const obs_cmd = { nonce: nextNonce(), action };
  const { error } = await db.from('games').update({ obs_cmd }).eq('id', game.id);
  if (error) { obsWaiting = null; obsNote = `⚠️ ${error.message}`; renderObs(); }
}
function tapObs(key) {
  const cfg = OBS_BTN[key], st = (game && game.obs_status) || {};
  if (!game || (st.level | 0) < cfg.need) return;
  haptic();
  const running = !!st[cfg.on];
  if (running && cfg.arm && obsArmed !== key) { // first tap on a stop: arm only
    disarmObs();
    obsArmed = key;
    obsArmTimer = setTimeout(() => { disarmObs(); renderObs(); }, 5000);
    return renderObs();
  }
  disarmObs();
  obsWaiting = { key, at: Date.now() };
  obsNote = null;
  renderObs();
  setTimeout(() => { if (obsWaiting && obsWaiting.key === key) { obsWaiting = null; obsNote = '⚠️ OBS didn\'t respond.'; renderObs(); } }, 8000);
  sendObsCmd(running ? cfg.stop : cfg.start);
}
for (const key of Object.keys(OBS_BTN)) $(OBS_BTN[key].el).onclick = () => tapObs(key);

let lastObsStatusAt = null;
function renderObs() {
  if (!game) return;
  const st = game.obs_status || {};
  const level = st.level | 0;
  // A fresh report from OBS is the answer to whatever we sent.
  if (st.at && st.at !== lastObsStatusAt) { lastObsStatusAt = st.at; obsWaiting = null; obsNote = null; }
  for (const [key, cfg] of Object.entries(OBS_BTN)) {
    const b = $(cfg.el); if (!b) continue;
    const running = !!st[cfg.on];
    b.disabled = !game.obs_status || level < cfg.need;
    b.textContent = obsArmed === key ? cfg.arm : obsWaiting && obsWaiting.key === key ? '…' : running ? cfg.live : cfg.idle;
    b.classList.toggle('on', running && !cfg.danger);
    b.classList.toggle('live', running && cfg.danger);
    b.classList.toggle('armed', obsArmed === key);
  }
  setNeedBadge('obs-need', 5);
  const hint = $('obs-hint'); if (!hint) return;
  if (obsNote) { hint.dataset.tone = 'warn'; hint.textContent = obsNote; return; }
  if (level < 5) {
    const note = needNote(5);
    hint.dataset.tone = note.tone;
    hint.textContent = level >= 4 ? `Replay buffer only. ${note.text}` : note.text;
    return;
  }
  const bits = [st.streaming ? 'live' : 'off air', st.recording ? (st.paused ? 'recording paused' : 'recording') : null,
                st.buffer ? 'buffer on' : 'buffer off'].filter(Boolean);
  hint.dataset.tone = st.streaming ? 'ok' : 'off';
  hint.textContent = `OBS: ${bits.join(' · ')}`;
}

// ---- OBS scenes (camera switching) ----------------------------------------
// One scene per camera in OBS, the scorebug source shared into each; tapping a
// name cuts to it through whatever transition OBS is set to. The list is
// whatever the overlay reports seeing, so it can't drift from reality.
async function switchScene(name) {
  if (!game) return;
  haptic();
  const scene_cmd = { nonce: nextNonce(), name };
  const { error } = await db.from('games').update({ scene_cmd }).eq('id', game.id);
  if (error) showToast(`⚠️ ${error.message}`, 3000);
}
function renderScenes() {
  const list = $('scene-list'), hint = $('scene-hint');
  if (!list || !game) return;
  const obs = game.obs_scenes;
  const names = (obs && Array.isArray(obs.list) ? obs.list : []).filter((n) => typeof n === 'string');
  const level = obs ? obs.level | 0 : -1;
  list.innerHTML = '';
  for (const name of names) {
    const b = document.createElement('button');
    b.className = 'fxbtn scene' + (name === obs.current ? ' on' : '');
    b.textContent = name;
    b.onclick = () => switchScene(name);
    b.disabled = level < 4;
    list.appendChild(b);
  }
  setNeedBadge('scene-need', 4);
  if (level < 4) {
    const note = needNote(4);
    hint.dataset.tone = note.tone; hint.textContent = note.text;
  } else if (!names.length) {
    hint.dataset.tone = 'off'; hint.textContent = 'OBS reported no scenes.';
  } else {
    hint.dataset.tone = 'ok'; hint.textContent = `On air: ${obs.current || '—'}`;
  }
}

// ---- OBS replay buffer ----------------------------------------------------
// This pad has no window.obsstudio, so we can't clip directly: we stamp a nonce
// and the overlay browser source (which IS inside OBS) calls saveReplayBuffer()
// and acks back. Everything shown here comes from that ack — including whether
// the buffer is even running, which is the thing you want to know before first
// pitch rather than after the play.
const REPLAY_FAIL = {
  noperm: { tone: 'off', text: 'Clips need Page permissions “Basic access to OBS” on the overlay source.' },
  nobuffer: { tone: 'bad', text: '⚠️ Replay buffer isn’t running in OBS.' },
  failed: { tone: 'bad', text: '⚠️ OBS refused the clip.' },
  noconfirm: { tone: 'warn', text: '🎞️ Sent, but OBS didn’t confirm — check your replay folder.' },
};
// The buffer is retroactive: saving captures the N seconds BEFORE the save, and
// nothing after. So a home run clip taken at the swing ends while he's rounding
// second. We wait out the trot and the celebration, then save — the buffer
// reaches back and picks up the pitch. Needs an OBS buffer at least
// delay + ~20s (90s covers everything here).
const CLIP_DELAY_MS = {
  homerun: 40000,     // trot plus the mob at the plate
  walkoff: 60000,     // dogpiles run long
  touchdown: 30000,
  goal: 30000,
  doubleplay: 10000,  // the play is already over
  bigplay: 12000,
};

let replayPending = new Map(); // nonce -> {deadline, timer} for clips in flight
let replayNote = null;         // {tone, text} verdict from the last clip
let replayTick = null;
let lastHelloAt = null;        // 'at' of the last status report we folded in

const soonestDeadline = () => Math.min(...[...replayPending.values()].map((p) => p.deadline));

async function saveReplay(auto = false, delayMs = 0) {
  if (!game) return;
  if (!auto) haptic();
  const replay_cmd = { nonce: nextNonce(), at: new Date().toISOString(), auto, delay_ms: delayMs };
  // The overlay answers late by design, so allow delay + slack before giving up.
  replayPending.set(replay_cmd.nonce, {
    deadline: Date.now() + delayMs,
    timer: setTimeout(() => {
      if (!replayPending.delete(replay_cmd.nonce)) return;
      replayNote = { tone: 'bad', text: '⚠️ No answer from the overlay — is the browser source loaded in OBS?' };
      renderReplay();
    }, delayMs + 10000),
  });
  renderReplay();
  const { error } = await db.from('games').update({ replay_cmd }).eq('id', game.id);
  if (error) {
    dropPending(replay_cmd.nonce);
    replayNote = { tone: 'bad', text: `⚠️ ${error.message}` };
    return renderReplay();
  }
  if (delayMs) showToast(`🎞️ Clip in ${Math.round(delayMs / 1000)}s`, 2200);
}
function dropPending(nonce) {
  const p = replayPending.get(nonce);
  if (p) { clearTimeout(p.timer); replayPending.delete(nonce); }
}
// Tapping the button while a delayed clip is waiting means "don't wait, take it
// now" — the overlay fires everything it has scheduled instead of queuing more.
async function flushReplay() {
  const replay_cmd = { nonce: nextNonce(), at: new Date().toISOString(), flush: true };
  const { error } = await db.from('games').update({ replay_cmd }).eq('id', game.id);
  if (error) showToast(`⚠️ ${error.message}`, 3000);
}
$('fx-replay').onclick = () => {
  if (!game) return;
  haptic();
  if (replayPending.size && soonestDeadline() > Date.now()) return flushReplay();
  saveReplay(false, 0);
};

// Auto-clip: opt-in per game, so a big play lands on disk while both your thumbs
// are still on the scoring pad.
$('replay-auto').onchange = async (e) => {
  const auto_clip = e.target.checked;
  game = { ...game, auto_clip };
  renderReplay();
  const { error } = await db.from('games').update({ auto_clip }).eq('id', game.id);
  if (error) { game = { ...game, auto_clip: !auto_clip }; renderReplay(); showToast(`⚠️ ${error.message}`, 3000); }
  else showToast(auto_clip ? '🎞️ Auto-clip on for big plays' : 'Auto-clip off');
};

function renderReplay() {
  const b = $('fx-replay'); if (!b) return;
  const ack = game && game.replay_ack;
  const nonce = ack && Number(ack.nonce);
  if (ack && replayPending.has(nonce)) {
    if (ack.code === 'armed') {
      // Not an outcome — the overlay is holding it. Keep waiting, keep counting.
    } else {
      dropPending(nonce);
      replayNote = ack.ok
        ? { tone: 'ok', text: '🎞️ Clip saved to your replay folder.' }
        : (REPLAY_FAIL[ack.code] || { tone: 'bad', text: '⚠️ Clip failed.' });
      showToast(ack.ok ? '🎞️ Clip saved' : replayNote.text, ack.ok ? 1600 : 4000);
      // Successes fade back to the live status line; anything else stays put,
      // since it's the only place you'd read what to go fix in OBS.
      if (ack.ok) setTimeout(() => { if (replayNote && replayNote.tone === 'ok') { replayNote = null; renderReplay(); } }, 12000);
    }
  }
  // A fresh status report (overlay reloaded, or the buffer started/stopped)
  // clears a stale verdict so the line reflects OBS as it is right now.
  if (ack && ack.code === 'hello' && ack.at !== lastHelloAt) { lastHelloAt = ack.at; replayNote = null; }

  const waiting = replayPending.size ? Math.round((soonestDeadline() - Date.now()) / 1000) : 0;
  b.textContent = !replayPending.size ? '🎞️ Clip' : waiting > 0 ? `🎞️ Clip in ${waiting}s` : '🎞️ Saving…';
  b.classList.toggle('busy', !!replayPending.size);
  const auto = $('replay-auto');
  if (auto) auto.checked = !!(game && game.auto_clip);
  // A 1Hz tick only while something is in flight — the pad idles the rest of the game.
  if (replayPending.size && !replayTick) replayTick = setInterval(renderReplay, 1000);
  if (!replayPending.size && replayTick) { clearInterval(replayTick); replayTick = null; }

  const hint = $('replay-hint');
  if (!hint) return;
  const note = replayPending.size
    ? (waiting > 0 ? { tone: 'ok', text: 'Waiting out the celebration — tap Clip to take it now.' } : null)
    : (replayNote || replayStatus(ack));
  hint.hidden = !note;
  if (note) { hint.textContent = note.text; hint.dataset.tone = note.tone; }
}
// Idle line: what the overlay last told us about itself.
function replayStatus(ack) {
  if (!ack) return { tone: 'off', text: 'Open the overlay in OBS to enable clips.' };
  if (!ack.ok && ack.code === 'hello') return REPLAY_FAIL.noperm;
  if (ack.buffering === false) return REPLAY_FAIL.nobuffer;
  return { tone: 'ok', text: '🎞️ OBS link ready.' };
}
function resetReplayUi() {
  for (const nonce of [...replayPending.keys()]) dropPending(nonce);
  replayNote = null; lastHelloAt = null;
  if (replayTick) { clearInterval(replayTick); replayTick = null; }
}

// <input type="datetime-local"> speaks local wall time; the column is timestamptz.
function toLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso), p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
function fromLocalInput(v) {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d) ? null : d.toISOString();
}

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
// This runs on a 4 Hz tick — only touch the DOM when the string actually changes.
const setClockText = (v) => { const n = $('clock-display'); if (n.textContent !== v) n.textContent = v; };
function renderClock() {
  const row = $('clock-row');
  const sport = game.sport || 'baseball';
  if (sport === 'soccer') {
    row.hidden = false;
    const e = S.elapsedSeconds(game, Date.now());
    const st = S.scState(game);
    setClockText(Math.floor(e / 60) + ':' + String(Math.max(0, Math.round(e % 60))).padStart(2, '0') + (st.stoppage ? ` +${st.stoppage}` : ''));
    $('clock-display').classList.remove('low');
    return;
  }
  if (!game || !game.time_limit_seconds) { row.hidden = true; return; }
  row.hidden = false;
  const rem = Math.max(0, Math.round(clockRemaining(game)));
  setClockText(Math.floor(rem / 60) + ':' + String(rem % 60).padStart(2, '0'));
  $('clock-display').classList.toggle('low', rem <= 60);
}
setInterval(() => { if (game) renderClock(); }, 250);

// ---- Practice / demo mode -------------------------------------------------
let demoTimer = null;
function paintDemoBtn() {
  $('demo-btn').classList.toggle('on', !!demoTimer);
  $('demo-btn').textContent = demoTimer ? '■ Stop Demo' : '▶ Demo Mode';
}
function stopDemo() {
  if (demoTimer) { clearInterval(demoTimer); demoTimer = null; }
  paintDemoBtn();
}
$('demo-btn').onclick = () => {
  if (demoTimer) { clearInterval(demoTimer); demoTimer = null; }
  else demoTimer = setInterval(demoStep, 1800);
  paintDemoBtn();
};
function demoStep() {
  if (!game) return stopDemo(); // game closed under us
  const sport = game.sport || 'baseball';
  if (sport === 'football') return demoStepFootball();
  if (sport === 'soccer') return demoStepSoccer();
  if (sport === 'volleyball') return demoStepVolleyball();
  if (sport === 'basketball') return demoStepBasketball();
  const r = Math.random();
  if (r < 0.10) return fireAnim(['homerun', 'strikeout', 'doubleplay', 'webgem', 'stolenbase'][Math.floor(Math.random() * 5)]);
  if (r < 0.34) { // ball, but auto-resolve a walk instead of opening the sheet
    if ((game.balls | 0) >= 3) { const w = L.computeWalk(game.bases); commit({ type: 'walk', patch: L.endPA(game, { balls: 0, strikes: 0, bases: w.bases, ...L.runsPatch(game, w.runs) }), payload: { runs: w.runs }, anim: 'webgem' }); }
    else commit({ type: 'ball', patch: L.withPitch(game, { balls: (game.balls | 0) + 1 }) });
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

function demoStepVolleyball() {
  const r = Math.random();
  const team = () => (Math.random() < 0.5 ? 'home' : 'away');
  if (r < 0.10) { const a = V.ace(game); return a && commit(a); }
  if (r < 0.85) return commit(V.point(game, team()));
  return commit(V.setServe(game, team()));
}

function demoStepBasketball() {
  const r = Math.random();
  const team = () => (Math.random() < 0.5 ? 'home' : 'away');
  if (r < 0.45) return commit(B.score(game, team(), 2));
  if (r < 0.62) return commit(B.score(game, team(), 3));
  if (r < 0.74) return commit(B.score(game, team(), 1));
  if (r < 0.92) return commit(B.foul(game, team(), 1));
  return commit(B.timeout(game, team()));
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
    volleyball: ['ace', 'setwin', 'charge'],
    basketball: ['three', 'bigplay', 'charge'],
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
document.querySelectorAll('#pos-grid button').forEach((b) => { b.onclick = () => writeField({ scorebug_position: b.dataset.pos }); });
$('scale-sel').addEventListener('input', (e) => { $('scale-val').textContent = (+e.target.value).toFixed(2) + '×'; });
$('scale-sel').addEventListener('change', (e) => writeField({ scorebug_scale: +e.target.value }));
const POS_ALIAS = { 'bottom-bar': 'bottom-center', 'top-bar': 'top-center' };
function renderLook() {
  $('theme-sel').value = game.theme || 'nightgame';
  const cur = POS_ALIAS[game.scorebug_position] || game.scorebug_position || 'bottom-center';
  document.querySelectorAll('#pos-grid button').forEach((b) => b.classList.toggle('on', b.dataset.pos === cur));
  const sc = game.scorebug_scale || 1;
  $('scale-sel').value = sc;
  $('scale-val').textContent = (+sc).toFixed(2) + '×';
  renderCustomize();
}

// ---- Customize (freeform `look` overrides on top of the theme) ------------
const lookOf = () => game.look || {};
async function writeLook(patch) {
  const look = { ...lookOf(), ...patch };
  for (const k of Object.keys(look)) if (look[k] === '' || look[k] === false || look[k] == null) delete look[k];
  game = { ...game, look };
  renderCustomize();
  const { error } = await db.from('games').update({ look }).eq('id', game.id);
  if (error) console.warn('look write failed', error.message);
}
$('cust-accent').addEventListener('change', (e) => writeLook({ accent: e.target.value }));
$('cust-font').addEventListener('change', (e) => writeLook({ font: e.target.value }));
$('cust-radius').addEventListener('change', (e) => writeLook({ radius: e.target.value }));
$('cust-logos').addEventListener('change', (e) => writeLook({ hideLogos: e.target.checked }));
$('cust-detail').addEventListener('change', (e) => writeLook({ hideDetail: e.target.checked }));
$('cust-shadow').addEventListener('change', (e) => writeLook({ noShadow: e.target.checked }));
$('cust-uppercase').addEventListener('change', (e) => writeLook({ uppercase: e.target.checked }));
$('cust-logosize').addEventListener('change', (e) => writeLook({ logoSize: e.target.value }));
$('cust-border').addEventListener('change', (e) => writeLook({ border: e.target.value }));
$('cust-teambars').addEventListener('change', (e) => writeLook({ teamBars: e.target.checked }));
// Per-row fills (away / home / details / panel) + one shared gradient angle.
$('cust-awaytype').addEventListener('change', (e) => writeLook({ awayType: e.target.value }));
$('cust-awayc1').addEventListener('change', (e) => writeLook({ awayC1: e.target.value }));
$('cust-awayc2').addEventListener('change', (e) => writeLook({ awayC2: e.target.value }));
$('cust-hometype').addEventListener('change', (e) => writeLook({ homeType: e.target.value }));
$('cust-homec1').addEventListener('change', (e) => writeLook({ homeC1: e.target.value }));
$('cust-homec2').addEventListener('change', (e) => writeLook({ homeC2: e.target.value }));
$('cust-sittype').addEventListener('change', (e) => writeLook({ sitType: e.target.value }));
$('cust-sitc1').addEventListener('change', (e) => writeLook({ sitC1: e.target.value }));
$('cust-sitc2').addEventListener('change', (e) => writeLook({ sitC2: e.target.value }));
$('cust-paneltype').addEventListener('change', (e) => writeLook({ panelType: e.target.value }));
$('cust-panelc1').addEventListener('change', (e) => writeLook({ panelC1: e.target.value }));
$('cust-panelc2').addEventListener('change', (e) => writeLook({ panelC2: e.target.value }));
$('cust-angle').addEventListener('input', (e) => { $('cust-angle-val').textContent = e.target.value + '°'; });
$('cust-angle').addEventListener('change', (e) => writeLook({ angle: +e.target.value }));
$('cust-text').addEventListener('change', (e) => writeLook({ text: e.target.value }));
$('cust-steel').addEventListener('change', (e) => writeLook({ steel: e.target.value }));
$('cust-line').addEventListener('change', (e) => writeLook({ line: e.target.value }));
$('cust-teamfill').addEventListener('change', (e) => writeLook({ teamFill: e.target.checked }));
$('cust-reset').onclick = async () => {
  game = { ...game, look: {} };
  renderCustomize();
  await db.from('games').update({ look: {} }).eq('id', game.id);
  showToast('Customize reset');
};
function renderCustomize() {
  const L = lookOf();
  $('cust-accent').value = L.accent || '#e8b23a';
  $('cust-font').value = L.font || '';
  $('cust-radius').value = L.radius != null ? String(L.radius) : '';
  $('cust-logos').checked = !!L.hideLogos;
  $('cust-detail').checked = !!L.hideDetail;
  $('cust-shadow').checked = !!L.noShadow;
  $('cust-uppercase').checked = !!L.uppercase;
  $('cust-logosize').value = L.logoSize || '';
  $('cust-border').value = L.border != null ? String(L.border) : '';
  $('cust-teambars').checked = !!L.teamBars;
  $('cust-teamfill').checked = !!L.teamFill;
  $('cust-awaytype').value = L.awayType || '';
  $('cust-awayc1').value = L.awayC1 || '#7a8794';
  $('cust-awayc2').value = L.awayC2 || '#0e1421';
  $('cust-hometype').value = L.homeType || '';
  $('cust-homec1').value = L.homeC1 || '#1b2a41';
  $('cust-homec2').value = L.homeC2 || '#0e1421';
  $('cust-sittype').value = L.sitType || '';
  $('cust-sitc1').value = L.sitC1 || '#0e1421';
  $('cust-sitc2').value = L.sitC2 || '#1b2a41';
  $('cust-paneltype').value = L.panelType || '';
  $('cust-panelc1').value = L.panelC1 || '#1b2a41';
  $('cust-panelc2').value = L.panelC2 || '#0e1421';
  $('cust-angle').value = L.angle ?? 180;
  $('cust-angle-val').textContent = (L.angle ?? 180) + '°';
  $('cust-text').value = L.text || '#f4f7fb';
  $('cust-steel').value = L.steel || '#8fb6de';
  $('cust-line').value = L.line || '#2a3550';
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

// Home-run sheet ------------------------------------------------------------
// Batter + every runner scores and the bases clear; the sheet just confirms the
// run total (pre-filled from who's on base) before committing + firing the anim.
let hrRuns = 1;
function paintHr() { $('hr-runs').textContent = hrRuns; }
function openHrSheet() {
  hrRuns = L.computeHomeRun(game.bases).runs;
  paintHr(); $('hr-sheet').hidden = false;
}
$('hr-runs-up').onclick = () => { hrRuns = Math.min(hrRuns + 1, 4); paintHr(); };
$('hr-runs-dn').onclick = () => { hrRuns = Math.max(hrRuns - 1, 1); paintHr(); };
$('hr-cancel').onclick = () => { $('hr-sheet').hidden = true; };
$('hr-confirm').onclick = () => {
  $('hr-sheet').hidden = true;
  commit({ type: 'homerun', patch: L.homeRunPatch(game, hrRuns), payload: { runs: hrRuns }, anim: 'homerun' });
};

// Pitch-count stepper (baseball) --------------------------------------------
$('pc-dn').onclick = () => commit(L.adjustPitch(game, -1));
$('pc-up').onclick = () => commit(L.adjustPitch(game, 1));

// Manual adjust panel (baseball) — one delegated handler over data-adj steppers.
const ADJ = {
  'score-away': (d) => L.adjustScore(game, 'away', d),
  'score-home': (d) => L.adjustScore(game, 'home', d),
  'hits-away': (d) => L.adjustHits(game, 'away', d),
  'hits-home': (d) => L.adjustHits(game, 'home', d),
  'errors-away': (d) => L.adjustErrors(game, 'away', d),
  'errors-home': (d) => L.adjustErrors(game, 'home', d),
  'outs': (d) => L.adjustOuts(game, d),
  'balls': (d) => L.adjustBalls(game, d),
  'strikes': (d) => L.adjustStrikes(game, d),
  'inning': (d) => L.onNudgeInning(game, d),
};
$('adj-panel').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-adj]');
  if (!btn || !ADJ[btn.dataset.adj]) return;
  commit(ADJ[btn.dataset.adj](+btn.dataset.d));
});
$('adj-half').onclick = () => commit(L.onToggleHalf(game));
function renderAdjust() {
  const set = (id, v) => { $(id).textContent = v | 0; };
  set('adj-score-away', game.away_score); set('adj-score-home', game.home_score);
  set('adj-inning', game.inning); set('adj-outs', game.outs);
  set('adj-balls', game.balls); set('adj-strikes', game.strikes);
  set('adj-hits-away', game.away_hits); set('adj-hits-home', game.home_hits);
  set('adj-errors-away', game.away_errors); set('adj-errors-home', game.home_errors);
}

// Teams & lineups (baseball) ------------------------------------------------
// Rosters live in the `lineups` jsonb column (written directly, not undoable).
// The current-hitter index lives in state.batIdx (undoable via apply_event).
const LINEUP_SLOTS = 12;
let lineupBuiltFor = null;

const teamOf = (side) => {
  const t = (game.lineups || {})[side] || {};
  return { pitcher: t.pitcher || { name: '', num: '' }, batters: Array.isArray(t.batters) ? t.batters : [] };
};
const batIdxOf = (side) => (((game.state && game.state.batIdx) || {})[side] | 0);

function buildLineup(side) {
  let html = '';
  for (let i = 0; i < LINEUP_SLOTS; i++) {
    html += `<div class="lineup-row" data-i="${i}">` +
      `<button class="cur-dot" data-i="${i}" title="Set at-bat">◎</button>` +
      `<span class="ord">${i + 1}</span>` +
      `<input class="b-num" inputmode="numeric" maxlength="3" placeholder="#" />` +
      `<input class="b-name" placeholder="Batter ${i + 1}" /></div>`;
  }
  $('lineup-' + side).innerHTML = html;
}
function fillLineup(side) {
  const t = teamOf(side);
  $('lp-num-' + side).value = t.pitcher.num || '';
  $('lp-name-' + side).value = t.pitcher.name || '';
  $('lineup-' + side).querySelectorAll('.lineup-row').forEach((row, i) => {
    const b = t.batters[i] || {};
    row.querySelector('.b-num').value = b.num || '';
    row.querySelector('.b-name').value = b.name || '';
  });
}
function renderCurrentHitter(side) {
  const idx = batIdxOf(side);
  $('lineup-' + side).querySelectorAll('.lineup-row').forEach((row, i) => {
    const on = i === idx;
    row.classList.toggle('at-bat', on);
    row.querySelector('.cur-dot').textContent = on ? '◉' : '◎';
  });
}
function readLineup(side) {
  const batters = [];
  $('lineup-' + side).querySelectorAll('.lineup-row').forEach((row) => {
    batters.push({ num: row.querySelector('.b-num').value.trim(), name: row.querySelector('.b-name').value.trim() });
  });
  return { pitcher: { num: $('lp-num-' + side).value.trim(), name: $('lp-name-' + side).value.trim() }, batters };
}
async function saveLineup(side) {
  const lineups = { ...(game.lineups || {}), [side]: readLineup(side) };
  game = { ...game, lineups };
  const { error } = await db.from('games').update({ lineups }).eq('id', game.id);
  if (error) console.warn('lineup write failed', error.message);
}
function setCurrentHitter(side, i) {
  const batIdx = { ...((game.state && game.state.batIdx) || {}), [side]: i };
  commit({ type: 'batidx', patch: { state: { ...(game.state || {}), batIdx } }, payload: { side, i } });
}
// Wire the static containers/inputs once (rows are delegated, so rebuilds are safe).
['away', 'home'].forEach((side) => {
  const list = $('lineup-' + side);
  list.addEventListener('change', () => saveLineup(side));
  list.addEventListener('click', (e) => {
    const dot = e.target.closest('.cur-dot');
    if (dot) setCurrentHitter(side, +dot.dataset.i);
  });
  $('lp-num-' + side).addEventListener('change', () => saveLineup(side));
  $('lp-name-' + side).addEventListener('change', () => saveLineup(side));
});
function renderLineups() {
  if (lineupBuiltFor !== game.id) { buildLineup('away'); buildLineup('home'); lineupBuiltFor = game.id; }
  $('lineup-away-team').textContent = game.away_name || 'Visitor';
  $('lineup-home-team').textContent = game.home_name || 'Home';
  // Don't overwrite inputs the user is actively typing into; always refresh the marker.
  const editing = document.activeElement && document.activeElement.closest && document.activeElement.closest('.lineup-team');
  if (!editing) { fillLineup('away'); fillLineup('home'); }
  renderCurrentHitter('away'); renderCurrentHitter('home');
}

// Defense (positions) — pointer-based drag & drop (works on mouse + touch) ---
let defSide = 'away';
const chipLabel = (b) => (b.num ? '#' + b.num + ' ' : '') + (b.name || '');
// The batting-order index whose num+name matches the team's pitcher, or -1
// (the pitcher is stored as {num,name}; this links it back to a lineup slot).
function pitcherIdx(team) {
  const p = team.pitcher || {};
  if (!(p.num || p.name)) return -1;
  const bs = Array.isArray(team.batters) ? team.batters : [];
  return bs.findIndex((b) => b && (b.num || '') === (p.num || '') && (b.name || '') === (p.name || ''));
}
function renderDefense() {
  if (!game || (game.sport || 'baseball') !== 'baseball') return;
  $('def-away').classList.toggle('on', defSide === 'away');
  $('def-home').classList.toggle('on', defSide === 'home');
  const team = (game.lineups || {})[defSide] || {};
  const batters = Array.isArray(team.batters) ? team.batters : [];
  const positions = team.positions || {};
  const pIdx = pitcherIdx(team);
  $('diamond-edit').innerHTML = L.FIELD_POSITIONS.map((pos) => {
    if (pos === 'P') {
      const p = team.pitcher || {};
      const inner = !(p.num || p.name) ? '<i class="dz-ph">drop</i>'
        : (pIdx >= 0 ? `<span class="dz-chip in-slot" data-idx="${pIdx}">${esc(chipLabel(p))}</span>`
                     : `<span class="dz-slot-name">${esc(chipLabel(p))}</span>`);
      return `<div class="dz-slot" data-slot="P" data-pos="P"><span class="dz-slot-lab">P</span>${inner}</div>`;
    }
    const idx = positions[pos];
    const b = (idx != null) ? batters[idx] : null;
    const inner = (b && (b.num || b.name))
      ? `<span class="dz-chip in-slot" data-idx="${idx}">${esc(chipLabel(b))}</span>`
      : '<i class="dz-ph">drop</i>';
    return `<div class="dz-slot" data-slot="${pos}" data-pos="${pos}"><span class="dz-slot-lab">${pos}</span>${inner}</div>`;
  }).join('');
  const assigned = new Set(Object.values(positions));
  if (pIdx >= 0) assigned.add(pIdx);
  $('def-bench').innerHTML = batters.map((b, i) =>
    (b && (b.num || b.name) && !assigned.has(i)) ? `<div class="dz-chip" data-idx="${i}">${esc(chipLabel(b))}</div>` : ''
  ).join('');
}
async function saveDefTeam(patch) {
  const side = defSide;
  const lineups = { ...(game.lineups || {}), [side]: { ...((game.lineups || {})[side] || {}), ...patch } };
  game = { ...game, lineups };
  renderDefense();
  const { error } = await db.from('games').update({ lineups }).eq('id', game.id);
  if (error) console.warn('defense write failed', error.message);
}
$('def-away').onclick = () => { defSide = 'away'; renderDefense(); };
$('def-home').onclick = () => { defSide = 'home'; renderDefense(); };

let dnd = null;
function dropTargetAt(e) {
  dnd.ghost.style.display = 'none';
  const el = document.elementFromPoint(e.clientX, e.clientY);
  dnd.ghost.style.display = '';
  if (!el) return {};
  const slot = el.closest('.dz-slot[data-slot]');
  if (slot) return { type: 'slot', pos: slot.dataset.slot, el: slot };
  const bench = el.closest('.bench');
  if (bench) return { type: 'bench', el: bench };
  return {};
}
function clearHot() { document.querySelectorAll('.dz-slot.hot, .bench.hot').forEach((el) => el.classList.remove('hot')); }
function defMove(e) {
  if (!dnd) return;
  e.preventDefault();
  dnd.ghost.style.left = e.clientX + 'px'; dnd.ghost.style.top = e.clientY + 'px';
  clearHot(); const t = dropTargetAt(e); if (t.el) t.el.classList.add('hot');
}
function defUp(e) {
  if (!dnd) return;
  const t = dropTargetAt(e);
  dnd.ghost.remove(); clearHot();
  const idx = dnd.idx; dnd = null;
  window.removeEventListener('pointermove', defMove);
  window.removeEventListener('pointerup', defUp);
  if (!t.el) return;
  const team = (game.lineups || {})[defSide] || {};
  const batters = Array.isArray(team.batters) ? team.batters : [];
  const positions = { ...(team.positions || {}) };
  let pitcher = { ...(team.pitcher || {}) };
  // Vacate this player from any field position; if they were the pitcher, clear the mound.
  for (const k of Object.keys(positions)) if (positions[k] === idx) delete positions[k];
  if (pitcherIdx(team) === idx) pitcher = { num: '', name: '' };
  if (t.type === 'slot') {
    if (t.pos === 'P') pitcher = { num: batters[idx] ? (batters[idx].num || '') : '', name: batters[idx] ? (batters[idx].name || '') : '' };
    else positions[t.pos] = idx;
  }
  // A bench drop just leaves the player unassigned (handled by the removals above).
  saveDefTeam({ positions, pitcher });
}
$('def-panel').addEventListener('pointerdown', (e) => {
  const chip = e.target.closest('.dz-chip');
  if (!chip) return;
  e.preventDefault();
  const ghost = chip.cloneNode(true);
  ghost.classList.add('dz-ghost');
  document.body.appendChild(ghost);
  dnd = { idx: +chip.dataset.idx, ghost };
  ghost.style.left = e.clientX + 'px'; ghost.style.top = e.clientY + 'px';
  window.addEventListener('pointermove', defMove);
  window.addEventListener('pointerup', defUp);
});

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
  // anim: the WALK reveal fires automatically, like run/strikeout do.
  commit({ type: 'walk', patch: L.endPA(game, { balls: 0, strikes: 0, bases, ...L.runsPatch(game, wState.runs) }), payload: { runs: wState.runs }, anim: 'webgem' });
};

// Render --------------------------------------------------------------------
const ordinal = (n) => ({ 1: '1st', 2: '2nd', 3: '3rd', 4: '4th' }[n] || n + 'th');
// Pop the control's score when it goes up (operator feedback), like the overlay.
const ctrlPrevScore = { away: null, home: null };
function ctrlScorePop(side, val, id) {
  const el2 = $(id);
  if (el2 && ctrlPrevScore[side] != null && val > ctrlPrevScore[side]) {
    el2.classList.remove('pop'); void el2.offsetWidth; el2.classList.add('pop');
  }
  ctrlPrevScore[side] = val;
}
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
  ctrlScorePop('away', game.away_score, 'g-away-runs');
  ctrlScorePop('home', game.home_score, 'g-home-runs');
  if (sport === 'football') renderFootballControl();
  else if (sport === 'soccer') renderSoccerControl();
  else if (sport === 'volleyball') renderVolleyballControl();
  else if (sport === 'basketball') renderBasketballControl();
  else renderBaseballControl();
  renderRally();
  renderReplay();
  renderScenes();
  renderObs();
  renderAudio();
  renderLook();
  renderClock();
  renderSetupGuide();
}

// ---- Guided game-setup checklist ------------------------------------------
let overlayCopied = false;
let guideCollapsed = true;
const STEP_NUM = { teams: 1, lineups: 2, defense: 3, overlay: 4 };
function setupSteps() {
  const sport = game.sport || 'baseball';
  const teams = (game.away_name && game.away_name !== 'Visitor') || (game.home_name && game.home_name !== 'Home');
  const teamHas = (s) => { const t = (game.lineups || {})[s] || {}; return (t.pitcher && (t.pitcher.name || t.pitcher.num)) || (Array.isArray(t.batters) && t.batters.some((b) => b && (b.name || b.num))); };
  const hasLineup = teamHas('away') || teamHas('home');
  const hasDefense = ['away', 'home'].some((s) => Object.keys(((game.lineups || {})[s] || {}).positions || {}).length > 0);
  return sport === 'baseball'
    ? [['teams', !!teams], ['lineups', hasLineup], ['defense', hasDefense], ['overlay', overlayCopied]]
    : [['teams', !!teams], ['overlay', overlayCopied]];
}
const setupAllDone = () => setupSteps().every(([, ok]) => ok);
function renderSetupGuide() {
  const el = $('setup-guide'); if (!el || !game) return;
  el.hidden = false;
  const sport = game.sport || 'baseball';
  el.querySelector('.sg-step[data-step="lineups"]').hidden = sport !== 'baseball';
  el.querySelector('.sg-step[data-step="defense"]').hidden = sport !== 'baseball';
  const steps = setupSteps();
  let done = 0;
  for (const [key, ok] of steps) {
    const row = el.querySelector(`.sg-step[data-step="${key}"]`);
    if (!row) continue;
    row.classList.toggle('done', ok);
    row.querySelector('.sg-dot').textContent = ok ? '✓' : String(STEP_NUM[key]);
    if (ok) done++;
  }
  $('sg-progress').textContent = `${done}/${steps.length}`;
  el.classList.toggle('collapsed', guideCollapsed);
  el.classList.toggle('complete', done === steps.length);
}
function openSetupGuide() { guideCollapsed = false; renderSetupGuide(); }
$('sg-head').onclick = () => { guideCollapsed = !guideCollapsed; renderSetupGuide(); };
function jumpPanel(id) { const p = $(id); if (!p) return; p.open = true; p.scrollIntoView({ behavior: 'smooth', block: 'start' }); }

// Accordion: opening a top-level panel closes the others, so the page never
// grows past one open panel. Nested sub-panels (lineups, custom theme) are
// exempt. 'toggle' doesn't bubble — listen in the capture phase.
const isTopPanel = (el) => el instanceof HTMLDetailsElement && el.classList.contains('panel') && !el.parentElement.closest('details.panel');
document.addEventListener('toggle', (e) => {
  if (!isTopPanel(e.target) || !e.target.open) return;
  document.querySelectorAll('details.panel[open]').forEach((o) => {
    if (o !== e.target && isTopPanel(o)) o.open = false;
  });
}, true);
$('setup-guide').addEventListener('click', (e) => {
  const b = e.target.closest('.sg-go'); if (!b) return;
  const go = b.dataset.go;
  if (go === 'teams') { fillSetup(); $('setup-sheet').hidden = false; }
  else if (go === 'lineups') jumpPanel('panel-lineups');
  else if (go === 'defense') jumpPanel('panel-defense');
  else if (go === 'overlay') { jumpPanel('panel-overlay'); overlayCopied = true; renderSetupGuide(); }
});

function renderBaseballControl() {
  const b = L.safeBases(game.bases);
  $('sc-mid').innerHTML = `<span class="sc-inning">${game.half === 'top' ? '▲' : '▼'} ${game.inning}</span>` +
    `<span class="sc-count">${game.balls} - ${game.strikes}</span><span class="sc-outs">${game.outs} out</span>`;
  $('g-batting').textContent = `Batting: ${game.half === 'bottom' ? game.home_name : game.away_name}`;
  $('pc-val').textContent = L.pitchCount(game);
  renderAdjust();
  $('base-1').classList.toggle('on', b.first);
  $('base-2').classList.toggle('on', b.second);
  $('base-3').classList.toggle('on', b.third);
  renderLineups();
  renderDefense();
  renderAutoCardLabels();
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
function renderVolleyballControl() {
  const st = V.vbState(game);
  const serve = st.serve === 'away' ? '◄ serve' : st.serve === 'home' ? 'serve ►' : 'serve: —';
  $('sc-mid').innerHTML = `<span class="sc-inning">SET ${st.set}</span>` +
    `<span class="sc-count">${st.sets.away}–${st.sets.home}</span><span class="sc-outs">${serve}</span>`;
  $('g-batting').textContent = st.serve ? `Serving: ${st.serve === 'home' ? game.home_name : game.away_name}` : 'Serving: —';
  $('vb-set-val').textContent = st.set;
  $('vb-target').textContent = 'To ' + st.target;
  $('vb-serve-away').classList.toggle('on', st.serve === 'away');
  $('vb-serve-home').classList.toggle('on', st.serve === 'home');
}
function renderBasketballControl() {
  const st = B.bkState(game);
  const bonus = [B.bonusOf(st, 'away') && 'AWAY ' + B.bonusOf(st, 'away'), B.bonusOf(st, 'home') && 'HOME ' + B.bonusOf(st, 'home')].filter(Boolean).join(' · ');
  $('sc-mid').innerHTML = `<span class="sc-inning">Q${st.period}</span>` +
    `<span class="sc-count">F ${st.fouls.away}·${st.fouls.home}</span><span class="sc-outs">${bonus}</span>`;
  $('g-batting').textContent = `Q${st.period}` + (bonus ? ` · ${bonus}` : '');
  $('bk-period-val').textContent = 'Q' + st.period;
}

$('copy-url-btn').onclick = async () => {
  try { await navigator.clipboard.writeText($('overlay-url').value); $('copy-url-btn').textContent = 'Copied!'; showToast('🔗 Overlay URL copied'); setTimeout(() => ($('copy-url-btn').textContent = 'Copy'), 1200); } catch {}
  overlayCopied = true; renderSetupGuide();
};
$('open-url-btn').onclick = () => { const u = $('overlay-url').value; if (u) window.open(u, '_blank', 'noopener'); overlayCopied = true; renderSetupGuide(); };

// Keyboard shortcuts (desktop control): ignore while typing in a field.
document.addEventListener('keydown', (e) => {
  if (views.game.hidden || !game) return;
  const tag = (e.target && e.target.tagName || '').toUpperCase();
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key.toLowerCase();
  if (k === 'u') { e.preventDefault(); return doUndo(); }
  if ((game.sport || 'baseball') === 'baseball') {
    const map = {
      b: 'btn-ball', s: 'btn-strike', f: 'btn-foul', o: 'btn-out', r: 'btn-run', n: 'btn-batter',
      1: 'hit-1b', 2: 'hit-2b', 3: 'hit-3b', h: 'fx-homerun', e: 'hit-e', a: 'btn-advance', c: 'btn-clear',
    };
    if (map[k]) { e.preventDefault(); $(map[k]).click(); }
  }
});

refreshSession();
