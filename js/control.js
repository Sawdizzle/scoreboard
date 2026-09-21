import { supabase, db } from './supabase.js';
import { SUPABASE_URL, SUPABASE_ANON_KEY, USER_EMAIL_DOMAIN } from './config.js';
import * as L from './logic.js';
import * as F from './football.js';
import * as S from './soccer.js';
import * as V from './volleyball.js';
import * as B from './basketball.js';
import { serverNow, syncClock } from './clock.js';
import { createQueue } from './sync.js';

const $ = (id) => document.getElementById(id);
const views = { auth: $('auth-view'), lobby: $('lobby-view'), game: $('game-view') };
const show = (view) => {
  for (const k in views) views[k].hidden = (k !== view);
  // The live screen is a fixed shell, not a scrolling page — the layout keys off
  // this rather than :has(), which is newer than some of the phones in the stands.
  document.body.classList.toggle('in-game', view === 'game');
};
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const emailFor = (u) => `${u.trim().toLowerCase()}@${USER_EMAIL_DOMAIN}`;

// The one place anything gets spoken. The visible toast spends most of its life
// `hidden`, and a display:none live region is not in the accessibility tree, so
// nothing it said would ever be announced — this mirror is always present.
function announce(text) {
  const el = $('a11y-live');
  if (!el || !text) return;
  // Setting the identical string is not a content change, so a repeated message
  // would pass in silence. A zero-width space makes it a change and reads as
  // nothing.
  el.textContent = el.textContent === text ? text + '\u200b' : text;
}

let toastTimer;
function showToast(msg, ms = 1600, action = null) {
  announce(msg);
  const t = $('toast'); if (!t) return;
  t.replaceChildren(document.createTextNode(msg));
  // An action makes the toast something you press, so while it is up it has to
  // be in the accessibility tree; a plain message stays out (the live region
  // above has already said it).
  if (action) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'toast-act'; b.textContent = action.label;
    b.onclick = () => { clearTimeout(toastTimer); t.hidden = true; action.run(); };
    t.append(b);
    t.removeAttribute('aria-hidden');
  } else {
    t.setAttribute('aria-hidden', 'true');
  }
  t.hidden = false;
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
  if (user) {
    $('who').textContent = user.user_metadata?.username || 'signed in';
    hideSessionLost();
    // Signed back in after a session died mid-game: go straight back to it. The
    // in-memory state is still the truth — the queue holds what the server has
    // not seen — so re-subscribe and send, rather than re-fetching over the top.
    if (resumeGameId && game && game.id === resumeGameId) {
      resumeGameId = null;
      show('game'); renderGame();
      await subscribe(game.id);
      queue.drain();
      await loadPresets(); await loadTeams();
      return;
    }
    resumeGameId = null;
    // Paint the lobby before waiting on the lists, as it always has.
    show('lobby'); await loadGames(); await loadPresets(); await loadTeams();
  }
  else { show('auth'); if ($('username').value) $('pin').focus(); } // returning user lands on the PIN
}
const setAuthMsg = (m) => { $('auth-msg').textContent = m; };

// ---- Losing the session mid-game -----------------------------------------
// The refresh token dies, or the account is signed out somewhere else, and from
// then on every write is a 401. The queue kept retrying every four seconds
// forever and the only thing on screen was a ⏳ badge counting up — no way to
// know that scoring had stopped saving, and no way to fix it.
//
// The optimistic state and the queue are both kept: nothing scored is lost,
// it just cannot be sent until there is a session again. So stop retrying, say
// so in a way that does not disappear, and come back to the same game after.
let sessionLost = false;
let deliberateSignOut = false;   // Log out is not a failure
let resumeGameId = null;         // the game to return to once signed back in

function showSessionLost() {
  if (sessionLost) return;
  sessionLost = true;
  stopRetryDrain();
  resumeGameId = game ? game.id : null;
  const n = queue.size();
  $('sl-note').textContent = n
    ? `Your login expired. ${n} change${n > 1 ? 's are' : ' is'} still waiting — log back in and ${n > 1 ? 'they' : 'it'} will save.`
    : 'Your login expired. Log back in to keep scoring.';
  $('session-lost').hidden = false;
  announce('Signed out. ' + $('sl-note').textContent);
}
function hideSessionLost() {
  sessionLost = false;
  $('session-lost').hidden = true;
}
$('sl-login').onclick = () => {
  $('session-lost').hidden = true;   // the auth screen explains itself
  const n = queue.size();
  show('auth');
  setAuthMsg(n ? `Signed out — sign in to save ${n} change${n > 1 ? 's' : ''}.` : 'Signed out — sign in to carry on.');
  $('pin').focus();
};

supabase.auth.onAuthStateChange((event, session) => {
  if (session) {
    // Back in. Anything still queued goes out now.
    if (sessionLost) { hideSessionLost(); queue.drain(); }
    return;
  }
  if (deliberateSignOut) { deliberateSignOut = false; return; }
  if (user) showSessionLost();   // only a surprise if we thought we were signed in
});

// The username is the same every time on a personal device; the PIN never is.
const LAST_USER = 'sb:lastUser';
try { $('username').value = localStorage.getItem(LAST_USER) || ''; } catch {}

// Disabling the button is the guard: a second tap while the first request is in
// flight otherwise fires a second sign-in.
function authBusy(on, msg) {
  $('login-form').querySelector('button[type="submit"]').disabled = on;
  $('signup-btn').disabled = on;
  if (msg !== undefined) setAuthMsg(msg);
}
$('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = $('username').value.trim();
  if (!username || !$('pin').value) return setAuthMsg('Username and PIN, please.');
  authBusy(true, 'Signing in…');
  const { error } = await supabase.auth.signInWithPassword({ email: emailFor(username), password: $('pin').value });
  if (error) { authBusy(false); return setAuthMsg(/invalid/i.test(error.message) ? 'Wrong username or PIN.' : error.message); }
  try { localStorage.setItem(LAST_USER, username); } catch {}
  authBusy(false, '');
  await refreshSession();
});

// The one PIN field serves both Log In and Create Account, and it is marked
// current-password for the common case. On the signup path that tells iOS to
// offer the saved PIN rather than to store the one being created, so a new
// account's credential never reaches the keychain. Flip it while the intent is
// clearly signup, and back as soon as anyone types again.
const setPinAutocomplete = (v) => $('pin').setAttribute('autocomplete', v);
for (const ev of ['focus', 'pointerdown']) {
  $('signup-btn').addEventListener(ev, () => setPinAutocomplete('new-password'));
}
for (const id of ['username', 'pin']) {
  $(id).addEventListener('input', () => setPinAutocomplete('current-password'));
}

$('signup-btn').addEventListener('click', async () => {
  const username = $('username').value, pin = $('pin').value;
  // Say it here rather than after a round trip. The endpoint checks the same
  // thing — this is the courtesy, not the guard.
  if (!/^[a-z0-9_]{3,20}$/i.test(username.trim())) return setAuthMsg('Username: 3–20 letters, numbers or underscore.');
  if (!/^\d{6,8}$/.test(pin)) return setAuthMsg('PIN must be 6–8 digits. (Existing shorter PINs still log in.)');
  authBusy(true, 'Creating account…');
  let res, body;
  try {
    res = await fetch(`${SUPABASE_URL}/functions/v1/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
      body: JSON.stringify({ username, pin }),
    });
    body = await res.json();
  } catch { authBusy(false); return setAuthMsg('Network error reaching signup.'); }
  if (!res.ok) { authBusy(false); return setAuthMsg(body.error || 'Could not create account.'); }
  const { error } = await supabase.auth.signInWithPassword({ email: emailFor(username), password: pin });
  if (error) { authBusy(false); return setAuthMsg('Account created — tap Log In.'); }
  try { localStorage.setItem(LAST_USER, username.trim()); } catch {}
  authBusy(false, '');
  await refreshSession();
});

$('logout-btn').addEventListener('click', async () => {
  // Same bargain as backing out of a game: the queue is memory-only, so leaving
  // with writes in it loses them, and that has to be a choice.
  const n = queue.size();
  if (n && !confirm(`${n} change(s) have not saved yet.\n\nLog out and lose them?`)) return;
  queue.clear();
  deliberateSignOut = true;
  hideSessionLost(); resumeGameId = null;
  await teardownChannel(); await supabase.auth.signOut();
  user = null; game = null; await refreshSession();
});

// ---------------------------------------------------------------- Lobby
const SPORT_LABEL = { baseball: '⚾', football: '🏈', soccer: '⚽', volleyball: '🏐', basketball: '🏀' };
// Compact "how stale is this game" stamp for the lobby list.
function timeAgo(iso) {
  if (!iso) return '';
  const s = (serverNow() - new Date(iso).getTime()) / 1000;  // updated_at is server time
  if (s < 90) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  if (s < 7 * 86400) return Math.floor(s / 86400) + 'd ago';
  return new Date(iso).toLocaleDateString();
}
// "live" tells you nothing when you're picking between two games; where the game
// actually stands does.
function situationLabel(g) {  // ordinal() is defined further down; both run after load
  const st = g.state || {};
  switch (g.sport || 'baseball') {
    case 'football': return `Q${st.quarter || 1}`;
    case 'basketball': return `Q${st.period || 1}`;
    case 'soccer': return (st.half || 1) === 1 ? '1st half' : '2nd half';
    case 'volleyball': return `Set ${st.set || 1}`;
    default: return `${g.half === 'bottom' ? 'Bot' : 'Top'} ${ordinal(g.inning || 1)}`;
  }
}
// Nothing moves a game out of 'live' (there is no end-game step), so the status
// alone would badge every game ever made. LIVE means touched in the last 3 hours.
const LIVE_WINDOW_MS = 3 * 60 * 60 * 1000;
const isOnNow = (g) => g.status === 'live' && Date.now() - new Date(g.updated_at).getTime() < LIVE_WINDOW_MS;
const rowState = (g) => (g.status === 'final' ? 'Final' : g.status === 'setup' ? 'Not started' : situationLabel(g));

async function loadGames() {
  const list = $('games-list');
  list.innerHTML = '<p class="muted">Loading…</p>';
  const { data, error } = await db.from('games')
    .select('id,home_name,away_name,home_score,away_score,status,sport,updated_at,starts_at,inning,half,state')
    .eq('owner_id', user.id).order('updated_at', { ascending: false });
  list.innerHTML = '';
  if (error) { list.textContent = error.message; return; }
  if (!data.length) { list.innerHTML = '<p class="muted">No games yet — create one.</p>'; return; }
  // Games still to play or in progress on top; finished ones fold away below.
  // Top: what is on now, then what is scheduled soonest, then anything with no
  // start time (most recently touched first). Past: newest game first.
  const t = (g) => (g.starts_at ? new Date(g.starts_at).getTime() : null);
  const rank = (g) => (isOnNow(g) ? 0 : t(g) != null ? 1 : 2);
  const current = data.filter((g) => g.status !== 'final').sort((a, b) =>
    rank(a) - rank(b) || (rank(a) === 1 ? t(a) - t(b) : 0));
  const past = data.filter((g) => g.status === 'final').sort((a, b) =>
    (t(b) ?? new Date(b.updated_at).getTime()) - (t(a) ?? new Date(a.updated_at).getTime()));
  if (!current.length) list.insertAdjacentHTML('beforeend', '<p class="muted">No upcoming games — create one.</p>');
  for (const g of current) list.appendChild(gameRow(g));
  if (past.length) {
    const box = document.createElement('details');
    box.className = 'past-games';
    try { box.open = localStorage.getItem(PAST_OPEN) === '1'; } catch {}
    box.ontoggle = () => { try { localStorage.setItem(PAST_OPEN, box.open ? '1' : '0'); } catch {} };
    box.innerHTML = `<summary>Past games <span class="past-n">${past.length}</span></summary><div class="games-list"></div>`;
    const inner = box.querySelector('.games-list');
    for (const g of past) inner.appendChild(gameRow(g));
    list.appendChild(box);
  }
}
const PAST_OPEN = 'sb-past-open';
// "Sat, Sep 20 · 10:00 AM" — the year only when it is not this one.
function whenLabel(iso) {
  const d = new Date(iso), now = new Date();
  const day = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric',
    ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) });
  return `${day} · ${d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
}
// A game not yet started says when it starts; one under way says where it is.
const rowLine = (g) => (g.status === 'setup' && g.starts_at
  ? whenLabel(g.starts_at)
  : `${rowState(g)} · ${g.status === 'final' && g.starts_at ? whenLabel(g.starts_at).split(' · ')[0] : timeAgo(g.updated_at)}`);
// Delete lives in the game's own Setup, not here: an always-visible bin on a
// list you scroll one-handed is a mis-tap that cannot be undone.
function gameRow(g) {
  const open = document.createElement('button');
  open.className = 'game-row' + (g.status === 'final' ? ' final' : '');
  open.innerHTML = `<span class="g-sport">${SPORT_LABEL[g.sport] || '⚾'}</span>` +
    `<span class="g-main"><span class="g-name">${esc(g.away_name)} @ ${esc(g.home_name)}</span>` +
    `<span class="g-state">${isOnNow(g) ? '<span class="g-live">LIVE</span>' : ''}` +
    `<span>${esc(rowLine(g))}</span></span></span>` +
    `<span class="g-score">${g.away_score}–${g.home_score}</span><span class="g-chev">▸</span>`;
  open.onclick = () => openGame(g.id);
  return open;
}

// Help: four shortcut tiles over the same accordion, with the other ten folded
// away. Opening a tile reveals the list so "back" is just scrolling.
function openHelp(id) {
  $('help-list').hidden = false;
  $('help-all').setAttribute('aria-expanded', 'true');
  const d = $(id);
  if (!d) return;
  d.open = true;
  d.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
$('help-all').onclick = () => {
  const list = $('help-list');
  list.hidden = !list.hidden;
  $('help-all').setAttribute('aria-expanded', String(!list.hidden));
  $('help-all').textContent = list.hidden ? 'All 14 help topics ▸' : 'Hide help topics ▾';
};
document.querySelector('.help-tiles').addEventListener('click', (e) => {
  const t = e.target.closest('.help-tile');
  if (t) openHelp(t.dataset.help);
});

// New game: pick sport + style first, then create with the right initial state.
$('new-game-btn').addEventListener('click', () => { $('ng-startsat').value = ''; openSheet('newgame-sheet'); });
$('ng-cancel').onclick = () => closeSheet('newgame-sheet');
$('ng-create').onclick = async () => {
  const sport = $('ng-sport').value, style = $('ng-style').value;
  // Every game opens on Starting Soon: a real card, so it can be taken down by
  // hand like any other. Starting the clock or the first play also drops it.
  const row = { status: 'setup', sport, style, starts_at: fromLocalInput($('ng-startsat').value),
    card: { type: 'starting', meta: {}, nonce: nextNonce() } };   // 'live' on the first play
  if (sport === 'football') row.state = F.fbState({});
  else if (sport === 'soccer') row.state = S.scState({});
  else if (sport === 'volleyball') row.state = V.vbState({});
  else if (sport === 'basketball') row.state = B.bkState({});
  const { data, error } = await db.from('games').insert(row).select().single();
  if (error) return alert(error.message);
  closeSheet('newgame-sheet');
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
// Rosters hold children's names, so they live in an owner-only table rather than
// the world-readable games row. The overlay reaches them with a token that only
// ever travels in the OBS URL, and that you can rotate to kill old links.
let overlayToken = null;
async function loadRoster(id) {
  const { data: token } = await db.rpc('overlay_token', { p_game: id }); // creates the row if new
  overlayToken = token || null;
  const { data } = await db.from('rosters').select('data').eq('game_id', id).maybeSingle();
  // Normalize on the way in: a roster written by an older pad points its defense
  // at batting-order slots, and everything above this line works in player ids.
  return L.normalizeRoster((data && data.data) || {});
}
// roster_rev rides Realtime so the overlay knows to re-pull what it can't
// subscribe to. Both writes go through one RPC, in one transaction, with the
// increment computed in the database: this used to be an upsert followed by a
// separate bump read off the local row, so two devices editing lineups between
// innings produced the same number and one edit left the overlay pointing at a
// revision it thought it already had. The returned value is authoritative.
//
// One save in flight at a time. Every call carries the whole roster, so a
// burst of edits between innings (a drag, then a position, then a name) used
// to send three overlapping writes, and on field LTE the last to land was not
// always the last made: the pad showed one order while the server, and so the
// overlay, kept an older one. Now a save made while another is out waits, and
// only the newest waiting roster is sent.
// The lineup screen says which it is — Saving…, ✓ Saved, or Not saved — and a
// failed save tries again on its own (the newest roster, every few seconds)
// until it lands or a newer edit replaces it.
let rosterSending = false, rosterNext = null, rosterRetry = null;
function luStatus(state) {
  const el = $('lu-status'); if (!el) return;
  el.textContent = { saving: 'Saving…', saved: '✓ Saved', failed: '⚠ Not saved yet — retrying' }[state];
  el.dataset.state = state;
}
// `allowClear` is for the one deliberate wipe: loading a saved team over this
// side. Every other caller is an edit to one row or one spot, and none of them
// can legitimately empty a team — so a write that would is dropped at the door
// rather than sent to a server that keeps no history to undo it with.
// True when this roster would empty a side that has somebody in it — checked
// before the model moves, not just before the write, so a change the pad has
// already adopted can never become the "before" that lets the next one through.
let wipeGuarding = false;
function wipeRefused(lineups, allowClear) {
  if (allowClear) return false;
  if (wipeGuarding) return true;   // the blur below fires one more change event; one toast is enough
  const wiped = L.rosterWipes(game && game.lineups, lineups);
  if (!wiped.length) return false;
  console.warn('Scoreboard: refused a roster write that would have emptied', wiped.join(' and '));
  showToast('⚠️ That would have cleared the lineup — nothing was saved', 4000);
  // Blur first: fillLineup leaves the focused input alone, and the input we are
  // refusing is usually the one under the finger. Screen and model have to agree.
  wipeGuarding = true;
  try {
    const el = document.activeElement;
    if (el && el.closest && el.closest('.lu-side')) el.blur();
    renderLineups();   // put the roster that is still here back on screen
  } finally { wipeGuarding = false; }
  return true;
}
async function saveRoster(lineups, { allowClear = false } = {}) {
  if (wipeRefused(lineups, allowClear)) return;
  game = { ...game, lineups };
  rosterNext = { id: game.id, lineups };
  clearTimeout(rosterRetry);
  luStatus('saving');
  if (rosterSending) return;
  rosterSending = true;
  try {
    while (rosterNext) {
      const { id, lineups: data } = rosterNext;
      rosterNext = null;
      const res = await db.rpc('save_roster', { p_game: id, p_data: data });
      if (res.error) {
        if (!rosterNext) {
          luStatus('failed');
          showToast(`⚠️ Lineup not saved yet — retrying`, 3000);
          rosterRetry = setTimeout(() => { if (game && game.id === id && !rosterNext) saveRoster(game.lineups); }, 4000);
        }
        continue;
      }
      if (!rosterNext) luStatus('saved');
      if (game && game.id === id) { game = { ...game, roster_rev: Math.max(game.roster_rev | 0, res.data | 0) }; rosterHave = game.roster_rev; }
    }
  } finally { rosterSending = false; }
}
// Another device (or this one after a reload elsewhere) saved a roster: the
// row's roster_rev has moved past the one we hold. Re-read it, unless we have a
// save of our own going out — ours is the newer edit, and it bumps the rev too.
// A save started while the read was out also wins over the read.
let rosterHave = 0;
async function syncRoster(id, rev) {
  if (!game || game.id !== id || rev <= rosterHave || rosterSending || rosterNext) return;
  rosterHave = rev;
  const { data, error } = await db.from('rosters').select('data').eq('game_id', id).maybeSingle();
  if (error) { rosterHave = 0; return; }   // try again on the next row
  if (!game || game.id !== id || rosterSending || rosterNext) return;
  const incoming = L.normalizeRoster((data && data.data) || {});
  // The same rule as saveRoster, on the way in: a read that comes back empty
  // against a roster we are holding is a bad answer, not an edit somebody made.
  const wiped = L.rosterWipes(game.lineups, incoming);
  if (wiped.length) { console.warn('Scoreboard: ignored an empty roster read for', wiped.join(' and ')); rosterHave = 0; return; }
  game = { ...game, lineups: incoming };
  delete panelPainted.lineups;
  renderGame();
}
// ---- The shadow fold (rework stage 2) --------------------------------------
// Rebuild this game from its own event log and compare the answer with the row
// on screen. Nothing here writes, and nothing the scorebug shows comes from it:
// it exists to find out whether the fold is trustworthy BEFORE anything is
// staked on it. When it has agreed for a whole game, the fold can become the
// record and the correction sheets can come out.
//
// The log keeps the newest 200 events per game, so the fold cannot start at the
// first pitch. Every event stores the row as it was before it, so it starts at
// the oldest snapshot still held and folds forward from there. Rosters are
// private and never ride in a snapshot, so the lineups are handed in separately.
let foldTimer = null, foldBusy = false, foldLast = null;
function foldBadge(state, label, title) {
  const b = $('fold-badge'); if (!b) return;
  b.hidden = false;
  b.dataset.state = state;
  b.textContent = label;
  b.title = title;
}
async function shadowFold(why = 'auto') {
  if (!game || foldBusy) return;
  const id = game.id;
  foldBusy = true;
  foldBadge('busy', '◌', 'Rebuilding from the event log…');
  try {
    const { data, error } = await db.from('events').select('type,payload,prev_state')
      .eq('game_id', id).order('id', { ascending: true });
    if (error) { foldBadge('idle', '◌', `Could not read the log: ${error.message}`); return; }
    if (!game || game.id !== id) return;
    const events = data || [];
    if (!events.length) { foldBadge('idle', '◌', 'No events for this game yet'); return; }
    // The first row's snapshot is the state BEFORE that event, so every event
    // held — that one included — folds forward from it.
    const start = events[0].prev_state || {};
    const { state, applied, skipped } = L.replay(start, events, game.lineups || {});
    const diffs = L.compareGames(state, game);
    foldLast = { at: Date.now(), applied, skipped, diffs, why };
    const skipNote = skipped.length ? ` · ${skipped.length} event${skipped.length > 1 ? 's' : ''} it cannot rebuild yet (${[...new Set(skipped)].join(', ')})` : '';
    if (diffs.length) {
      foldBadge('diff', `⚠ ${diffs.length}`, `The rebuild disagrees with the pad on: ${diffs.map((d) => d.field).join(', ')}${skipNote}`);
      console.warn('Scoreboard shadow fold disagrees:', diffs, { applied, skipped });
    } else if (skipped.length) {
      foldBadge('partial', '≈', `The rebuild agrees on everything it could replay (${applied})${skipNote}`);
    } else {
      foldBadge('ok', '✓', `The rebuild of all ${applied} events matches the pad exactly`);
    }
  } finally { foldBusy = false; }
}
// After a burst of taps, once — not per pitch, which would be a select per
// pitch on a phone on venue LTE.
const foldSoon = () => { clearTimeout(foldTimer); foldTimer = setTimeout(() => shadowFold('after taps'), 20000); };
$('fold-badge').onclick = () => {
  if (foldLast && foldLast.diffs.length) {
    const lines = foldLast.diffs.map((d) => `${d.field}: log says ${JSON.stringify(d.folded)}, pad says ${JSON.stringify(d.row)}`);
    showToast(`Rebuild differs — ${lines[0]}`, 6000);
    console.warn('Scoreboard shadow fold detail:', foldLast);
  }
  shadowFold('tap');
};

const overlayUrl = () => `${location.origin}/overlay?game=${game.id}${overlayToken ? `&t=${overlayToken}` : ''}`;

async function openGame(id) {
  guideCollapsed = true;   // per game, not per session — a fresh game re-opens it explicitly
  const { data, error } = await db.from('games').select('*').eq('id', id).single();
  if (error) return alert(error.message);
  lastRowAt = 0;   // a different game's timestamps say nothing about this one
  game = adopted(data); queue.setBaseline(data); overlayCopied = false;
  panelPainted = {};   // nothing on screen belongs to this game yet
  lastSaidScore = null;
  resetReplayUi();
  $('last-play').hidden = true;   // the last game's last play says nothing about this one
  $('lu-status').textContent = 'saves as you type'; delete $('lu-status').dataset.state;
  // Before the first nonce of this game, not after: a nonce minted on an
  // uncorrected clock is one the other device can never beat.
  const [, lineups] = await Promise.all([syncClock(), loadRoster(id)]);
  game.lineups = lineups;
  rosterHave = game.roster_rev | 0;
  // The saved-team pickers are a one-shot action, not a label. Left showing the
  // last game's pick, they said a team was loaded here when it wasn't, and
  // choosing that same team again fired no change, so nothing would load.
  for (const s of ['away', 'home']) { const sel = $('team-sel-' + s); if (sel) sel.value = ''; }
  // Open only while there is real setup left; one step to go is a slim line you can tap.
  guideCollapsed = setupSteps().filter(([, ok]) => !ok).length <= 1;
  show('game'); renderGame();
  shadowFold('open');
  $('overlay-url').value = overlayUrl();
  $('recap-url').value = `${location.origin}/recap?game=${id}`;
  keepAwake(true);
  startClockTick();
  await subscribe(id);
}
// Backing out is the one exit `beforeunload` can't cover. The queue is
// memory-only on purpose — replaying stale absolute patches over a row you
// have since reloaded is worse than losing them — so leaving means dropping
// this game's writes, and that has to be a choice you make on purpose.
async function closeGame() {
  const id = game && game.id;
  if (luFlush) { clearTimeout(luFlush); luFlush = null; await saveRoster(game.lineups); }   // a name typed a half-second ago still lands
  if (queue.pendingFor(id)) {
    const n = queue.entriesFor(id).length;
    if (!confirm(`${n} change${n > 1 ? 's have' : ' has'} not saved yet — still waiting on the network.\n\nLeave this game and lose ${n > 1 ? 'them' : 'it'}?`)) return;
    queue.dropFor(id);
  }
  stopDemo(); keepAwake(false); stopClockTick(); resetReplayUi(); disarmObs();
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
  if (queue.pendingFor(id)) return; // our queue is ahead of the server; don't rewind
  const { data, error } = await db.from('games').select('*').eq('id', id).maybeSingle();
  if (!error && data) { queue.setBaseline(data); game = { ...adopted(data), lineups: (game && game.lineups) || {} }; renderGame(); }
}
async function subscribe(id) {
  await teardownChannel();
  setConn('connecting');
  channel = supabase.channel(`ctrl:${id}`)
    .on('postgres_changes', { event: 'UPDATE', schema: 'scoreboard', table: 'games', filter: `id=eq.${id}` },
      // While writes are queued the server row is behind us; taking it would
      // roll the pad back to a score we've already moved past.
      // The row no longer carries the roster (that table is private), so keep ours.
      (payload) => {
        if (queue.pendingFor(id)) return;
        // ...and not one we have already moved past: a backlog's worth of
        // updates arrives after the queue empties, oldest first.
        if (L.rowIsStale(payload.new, lastRowAt)) return;
        queue.setBaseline(payload.new);
        game = { ...adopted(payload.new), lineups: (game && game.lineups) || {} };
        renderGame();
      })
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') { setConn('live'); queue.drain(); reloadGame(id); }
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
addEventListener('online', () => { syncClock(); if (game) reloadGame(game.id); });
addEventListener('offline', () => setConn('down'));
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && game) { syncClock(); reloadGame(game.id); keepAwake(true); } // the OS drops wake locks on hide
});

// Atomic apply via RPC (snapshots prev_state for undo). Optimistic UI.
//
// Field LTE drops. It used to roll the score back and toast — meaning a pitch you
// scored simply vanished, and you'd have to notice and re-enter it mid-inning.
// Now the optimistic state stands and the write joins a queue that drains in
// order when the network returns. The overlay already survives disconnects by
// holding its last state; this is the pad's half of that.
//
// The queue itself lives in sync.js, with no DOM and no Supabase in it, so it
// can be driven under `node --test` — a dead network and two interleaved games
// are unreachable from a browser without a signed-in session. Everything below
// is this file's half of that boundary: what the badge looks like, what the
// operator is told, and what a landed write does to the screen.
let drainTimer = null;
const stopRetryDrain = () => clearTimeout(drainTimer);
// The newest server row this game has adopted. Realtime hands us a burst of
// UPDATEs when a backlog drains, and they land after the queue reports itself
// empty — without this the pad repaints each in turn and walks the score
// forward through its own history. Reset per game in openGame(); the decision
// itself is L.rowIsStale, which is unit-tested.
let lastRowAt = 0;
const adopted = (row) => { lastRowAt = Math.max(lastRowAt, L.rowStamp(row)); return row; };
const queue = createQueue({
  applyEvent: (gameId, type, patch, payload) =>
    db.rpc('apply_event', { p_game: gameId, p_type: type, p_new: patch, p_payload: payload }),
  updateFields: (gameId, patch) =>
    db.from('games').update(patch).eq('id', gameId).select().maybeSingle(),
  onPending: renderPending,
  // The row is only authoritative for the screen once the server has seen
  // everything we sent FOR THIS GAME, and it carries no roster — keep ours.
  onAccepted: (row, gameId, settled) => {
    if (!settled || !game || game.id !== gameId) return;
    game = { ...adopted(row), lineups: game.lineups };
    renderGame();
  },
  onToast: showToast,
  // A rejection that smells of expired credentials: ask the auth client whether
  // there is still a session, in case it has not noticed yet.
  onAuthError: () => {
    supabase.auth.getSession().then(({ data }) => { if (!data.session) showSessionLost(); });
  },
  isPaused: () => sessionLost,   // nothing will be accepted until there is a session
  retry: (fn, ms) => { stopRetryDrain(); drainTimer = setTimeout(fn, ms); },
});

function renderPending(n, err) {
  const el = $('pending-badge'); if (!el) return;
  el.hidden = !n;
  if (!n) return;
  el.textContent = `⏳ ${n}`;
  el.title = err ? `${n} change(s) waiting to save — ${err}` : `${n} change(s) saving…`;
}
// Anything that suggests the network is back is a reason to try again.
addEventListener('online', () => queue.drain());
document.addEventListener('visibilitychange', () => { if (!document.hidden) queue.drain(); });
// Closing the pad with unsaved scoring would lose it — the queue is memory-only
// on purpose, since replaying stale patches over a reloaded state is worse.
addEventListener('beforeunload', (e) => { if (queue.size()) { e.preventDefault(); e.returnValue = ''; } });

async function commit(res) {
  if (!game) return;
  if (!res || !res.patch || Object.keys(res.patch).length === 0) return;
  // Every event says who it was about before it goes anywhere. One place, so a
  // key added later cannot write an event that belongs to nobody.
  res = L.stamp(res, game);
  // The first play of the game is what makes it live. Riding the play's own
  // write means undoing that play puts the game back to Not started too.
  if (game.status === 'setup' && !('status' in res.patch)) {
    res = { ...res, patch: { ...res.patch, status: 'live' } };
    dropStartingSoon();
  }
  haptic();
  const prev = game;
  const gameId = game.id;
  const next = { ...game, ...res.patch };
  // The stinger this play earns, judged from the state it produces. A walk-off
  // supersedes everything (even a home run).
  const anim = L.isWalkoff(prev, next) ? 'walkoff'
    : res.anim ? res.anim
    : (res.type === 'run' || res.payload?.runs) ? 'run'
    : res.type === 'strikeout' ? 'strikeout'
    : null;
  // It rides the SAME write as the play. current_animation is already one of the
  // columns apply_event writes, so this costs nothing — where it used to be a
  // second UPDATE, a second Realtime broadcast and a second full overlay render
  // for every run and every strikeout, the busiest keys on the pad.
  const patch = anim
    ? { ...res.patch, current_animation: { type: anim, nonce: nextNonce(), meta: res.animMeta || {} } }
    : res.patch;
  if (anim && game.auto_clip && anim in CLIP_DELAY_MS) saveReplay(true, CLIP_DELAY_MS[anim]);
  game = { ...game, ...patch };
  renderGame();
  queue.enqueue({ kind: 'event', gameId, type: res.type, patch, payload: res.payload || {} });
  foldSoon();   // the shadow fold, once the taps stop
  midInningFollow(prev, game, res.type);
  sayLastPlay(res, prev, game);
}
// One line for the last thing recorded. Pitches read with the count they left;
// plays with what the scorebook would say; the hitter's number leads when known.
const COUNT_TYPES = { ball: 'Ball', strike: 'Strike', foul: 'Foul' };
function lastPlayText(res, prev, next) {
  if (COUNT_TYPES[res.type]) return `${COUNT_TYPES[res.type]} · ${next.balls | 0}-${next.strikes | 0}`;
  const pl = res.payload && res.payload.play;
  let t = res.text || (pl && L.PLAY_LABEL[pl.kind]
    ? L.PLAY_LABEL[pl.kind] + (pl.code && pl.kind !== 'K3' ? ' ' + pl.code : '') : '');
  if (!t) t = { run: 'Run scored', base: 'Runner moved', advance: 'Runners advanced', clear: 'Bases cleared',
    endhalf: 'Half-inning ended', batter: 'Next batter', end_game: 'Game ended', reopen_game: 'Game reopened' }[res.type] || '';
  if (!t && String(res.type).startsWith('adj')) t = 'Corrected';
  if (!t) return '';
  const runs = (res.payload && res.payload.runs) | 0;
  if (runs && !/run/i.test(t)) t += ` · ${runs} run${runs > 1 ? 's' : ''}`;
  if (next.half !== prev.half) t += ' · side retired';
  // The hitter it happened to: the one who was up before this play moved the order on.
  const side = L.battingSide(prev);
  const b = pl ? (teamOf(side).batters[batIdxOf(side, prev)] || {}) : {};
  return (b.num && res.type !== 'runner' ? `#${b.num} · ` : '') + t;
}
function markUndone() {
  const el = $('last-play'); if (!el || el.hidden || el.classList.contains('undone')) return;
  el.textContent = '↶ Undone: ' + el.textContent.replace(/^✓ /, '');
  el.classList.add('undone');
}
function sayLastPlay(res, prev, next) {
  const el = $('last-play'); if (!el || (next.sport || 'baseball') !== 'baseball') return;
  const t = lastPlayText(res, prev, next);
  if (!t) return;
  el.textContent = '✓ ' + t;
  el.classList.remove('undone');
  el.hidden = false;
}
// The third out puts Mid-Inning up by itself: the stream has the full scoreboard
// while the teams change and you fix positions. Its toast opens the Field screen.
// The next half's first pitch or play takes it down. A Situation-sheet flip is a
// correction, not a half ending, so it does neither.
function midInningFollow(prev, next, type) {
  if ((next.sport || 'baseball') !== 'baseball' || type === 'half' || type === 'inning') return;
  const up = next.card && next.card.type === 'midinning';
  if (next.half !== prev.half) {
    if (next.status === 'final' || L.halfEndsGame(next)) return;
    if (!up) writeField({ card: { type: 'midinning', meta: {}, nonce: nextNonce() } });
    showToast('🔁 Mid-Inning on air', 6000, { label: 'Set field', run: () => openField(L.fieldingSide(game)) });
  } else if (up && L.HALF_STARTERS.has(type)) {
    writeField({ card: null });
  }
}

// Strictly-increasing nonce so two triggers in the same millisecond don't collide
// (the overlay only plays a stinger whose nonce is greater than the last one seen).
// serverNow(), not Date.now(): the overlay compares these against nonces from
// whatever OTHER device scored the last play, so they have to come off a clock
// both devices share. The lastNonce + 1 floor also keeps them rising locally
// across a sync that moves our offset backwards.
let lastNonce = 0;
const nextNonce = () => (lastNonce = Math.max(serverNow(), lastNonce + 1));

// Fire a transient overlay stinger (not an undoable action — a plain trigger write).
// Standalone trigger for the manual FX buttons — a stinger with no play behind
// it, so it has no write to ride. Scoring goes through commit() instead.
async function fireAnim(type, meta = {}) {
  if (!game) return;
  if (game.auto_clip && type in CLIP_DELAY_MS) saveReplay(true, CLIP_DELAY_MS[type]);
  const current_animation = { type, nonce: nextNonce(), meta };
  game = { ...game, current_animation };
  // Deliberately NOT queued, and deliberately quiet. A stinger belongs to the
  // moment it fired; replaying it when the network returns would put HOME RUN on
  // air over a different at-bat. If it didn't reach the overlay it is simply
  // gone — and the ⏳ badge from the play itself already says you are offline.
  const { error } = await db.from('games').update({ current_animation }).eq('id', game.id);
  if (error) console.warn('anim failed (not retried — a stinger is not replayable)', error.message);
}

// Undo is what you reach for when something has already gone wrong, so it must
// mean the same thing on a dead connection as on a live one.
//
// The server's undo reverses the newest event IT has seen. With writes still
// queued that is an OLDER play than the last one you scored — and drain() would
// then replay our absolute patches straight back over the reversal. So when the
// server is behind us, undo what is actually in hand instead.
async function doUndo() {
  if (!game) return;
  if (queue.pendingFor(game.id)) return undoQueued();
  const { data, error } = await db.rpc('undo', { p_game: game.id });
  if (error) return showToast(`⚠️ ${error.message}`, 3000);
  // Returns whether a play was actually reversed, for callers that go on to
  // re-record it differently (a strikeout turned into a dropped third strike).
  if (data) { game = adopted(data); queue.setBaseline(data); renderGame(); showToast('↶ Undone'); markUndone(); return true; }
  showToast('Nothing to undo');
  return false;
}

// Drop the newest play we haven't sent yet and rebuild from the last row the
// server confirmed. Patches are absolute, and the optimistic state was built by
// merging them onto that row in order — so replaying what remains reproduces
// exactly the state before the dropped play. Field writes (look, setup) are not
// plays: they stay queued and are replayed with the rest.
function undoQueued() {
  const base = queue.baseline();
  if (!base || base.id !== game.id) {
    // No confirmed baseline to rebuild from (nothing for this game has been
    // accepted yet). Reversing blind would be a guess, so don't.
    return showToast('⚠️ Can’t undo until one change saves', 3500);
  }
  const res = L.undoPending(base, queue.entriesFor(game.id));   // pure, unit-tested
  if (!res) return showToast('Nothing to undo — only settings are still saving');
  // Drop that same entry from the real queue, which may hold other games' too —
  // entriesFor() is a filtered view, so it cannot be addressed by index.
  queue.drop(res.dropped);
  game = { ...res.state, lineups: game.lineups };
  renderGame();
  markUndone();
  showToast(queue.pendingFor(game.id) ? '↶ Undone — still saving the rest' : '↶ Undone');
  return true;
}

// Buttons
$('btn-ball').onclick    = () => { const r = L.onBall(game); r.sheet === 'walk' ? openWalkSheet(r) : commit(r); };
// Strike three asks how: swinging, looking, or dropped. It used to record a
// swinging K on the spot and offer "Dropped 3rd?" on a toast, so a called
// third strike went into the book and onto the stream as the wrong K.
$('btn-strike').onclick  = () => {
  if ((game.strikes | 0) < 2) return commit(L.onStrike(game));
  const why = L.playBlocked(game, 'K3');
  const k3 = $('k3-dropped');
  k3.classList.toggle('blocked', !!why);
  k3.setAttribute('aria-disabled', String(!!why));
  $('k3-why').textContent = why ? 'Dropped 3rd: batter can’t run — 1st is taken with fewer than 2 outs.' : '';
  openSheet('k3-sheet');
};
$('k3-swing').onclick = () => { closeSheet('k3-sheet'); commit(L.onStrike(game)); };
$('k3-look').onclick  = () => { closeSheet('k3-sheet'); commit(L.onStrike(game, { looking: true })); };
$('k3-dropped').onclick = () => {
  const why = L.playBlocked(game, 'K3');
  if (why) return showToast(why, 3200);
  closeSheet('k3-sheet'); startPlay('K3', 'C', 'hit');
};
$('k3-cancel').onclick = () => closeSheet('k3-sheet');
// Runners: one row per runner, lead runner first. Each button is one undoable play.
const RN_BASE = { first: '1st', second: '2nd', third: '3rd' };
const RN_NEXT = { first: '2nd', second: '3rd', third: 'home' };
function paintRunnerSheet() {
  const b = L.safeBases(game.bases);
  const on = ['third', 'second', 'first'].filter((k) => b[k]);
  const list = $('rn-list');
  if (!on.length) { list.innerHTML = '<p class="confirm-copy">Nobody on base.</p>'; return; }
  list.innerHTML = on.map((k) => {
    const btn = (kind, label) => {
      const why = L.runnerBlocked(game, k, kind);
      return `<button type="button" class="base-btn rn-b${why ? ' blocked' : ''}" data-from="${k}" data-kind="${kind}"${why ? ` aria-disabled="true" data-why="${why}"` : ''}>${label}</button>`;
    };
    return `<div class="rn-row"><b class="rn-who">On ${RN_BASE[k]}</b>` +
      btn('SB', `Stole ${RN_NEXT[k]}`) + btn('CS', 'Caught stealing') + btn('PO', 'Picked off') +
      btn('ADV', `To ${RN_NEXT[k]} · WP/PB`) + `</div>`;
  }).join('');
}
$('btn-runners').onclick = () => { if (!game) return; paintRunnerSheet(); openSheet('runners-sheet'); };
$('runners-done').onclick = () => closeSheet('runners-sheet');
$('rn-list').onclick = (e) => {
  const o = e.target.closest('.rn-b'); if (!o) return;
  if (o.dataset.why) return showToast(o.dataset.why, 3000);
  const r = L.onRunnerPlay(game, o.dataset.from, o.dataset.kind);
  if (!r) return;
  commit(r);
  showToast(r.text, 1800);
  // Stay open while anyone is left on base: a double steal is two taps.
  if (basesEmpty() || r.patch.half) closeSheet('runners-sheet'); else paintRunnerSheet();
};
// ---- Field screen ----------------------------------------------------------
// Positions by jersey number, the way you see them from the dugout fence. A
// full screen, not a sheet: nothing behind it, one Back. Tap a spot, tap the
// number playing there; if that kid was somewhere else the two trade.
const FIELD_TILE = { LF: [15, 12], CF: [50, 4], RF: [85, 12], SS: [31, 38], '2B': [69, 36],
  '3B': [12, 60], '1B': [88, 60], P: [50, 56], C: [50, 84] };
let fieldSide = 'home', fieldPick = null;
function openField(side) {
  if (!game) return;
  fieldSide = side || L.fieldingSide(game); fieldPick = null;
  closeDrawer();
  for (const id of [...sheetStack]) closeSheet(id);
  $('field-view').hidden = false;
  document.body.classList.add('field-open');
  paintField();
  $('field-back').focus({ preventScroll: true });
}
function closeField() {
  if (fieldPick) { fieldPick = null; return paintField(); }   // Back from the numbers goes to the field first
  $('field-view').hidden = true;
  document.body.classList.remove('field-open');
}
const teamAbbr = (s) => (s === 'home' ? game.home_abbr || game.home_name || 'HOME' : game.away_abbr || game.away_name || 'AWAY');
function paintField() {
  if (!game || $('field-view').hidden) return;
  const team = (game.lineups || {})[fieldSide] || {};
  const batters = teamOf(fieldSide).batters;
  const inField = L.fieldingSide(game);
  for (const s of ['away', 'home']) {
    const b = $('fv-tab-' + s);
    b.textContent = `${teamAbbr(s)}${s === inField ? ' · in the field' : ''}`;
    b.setAttribute('aria-pressed', String(s === fieldSide));
  }
  const miss = L.missingPositions(team);
  $('fv-note').textContent = fieldPick ? `Who's playing ${fieldPick}? Tap the jersey number.`
    : miss.length ? `Empty: ${miss.join(' · ')} — tap a spot to fill it` : 'Tap a spot to change who plays there.';
  $('fv-field').hidden = !!fieldPick;
  $('fv-numbers').hidden = !fieldPick;
  if (!fieldPick) {
    const field = $('fv-field');
    field.querySelectorAll('.fv-tile').forEach((x) => x.remove());
    for (const pos of L.FIELD_POSITIONS) {
      const i = L.slotAt(team, pos);
      const p = i >= 0 ? batters[i] : null;
      const [x, y] = FIELD_TILE[pos];
      const btn = document.createElement('button');
      btn.type = 'button'; btn.className = 'fv-tile' + (p ? '' : ' empty'); btn.dataset.pos = pos;
      btn.style.left = x + '%'; btn.style.top = y + '%';
      const lab = document.createElement('small'); lab.textContent = pos;
      const num = document.createElement('b'); num.textContent = p ? (p.num ? '#' + p.num : shortName(p)) : '—';
      btn.append(lab, num);
      btn.setAttribute('aria-label', p ? `${pos}: ${p.num ? 'number ' + p.num + ', ' : ''}${p.name || ''}` : `${pos}: empty`);
      field.appendChild(btn);
    }
    return;
  }
  const here = L.slotAt(team, fieldPick);
  $('fv-numbers').replaceChildren(...batters.map((b, i) => [b, i]).filter(([b]) => b && (b.num || b.name)).map(([b, i]) => {
    const at = L.positionOf(team, i);
    const btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'fv-num' + (i === here ? ' on' : '') + (at ? '' : ' bench'); btn.dataset.i = i;
    const n = document.createElement('b'); n.textContent = b.num ? '#' + b.num : shortName(b);
    const w = document.createElement('small'); w.textContent = i === here ? 'here now' : at ? `at ${at}` : 'bench';
    const nm = document.createElement('span'); nm.textContent = shortName(b);
    btn.append(n, nm, w);
    btn.setAttribute('aria-label', `${b.num ? 'Number ' + b.num + ', ' : ''}${b.name || ''}, ${at ? 'playing ' + at : 'on the bench'}`);
    return btn;
  }));
}
$('field-open').onclick = () => openField();
$('field-back').onclick = closeField;
$('fv-tab-away').onclick = () => { fieldSide = 'away'; fieldPick = null; paintField(); };
$('fv-tab-home').onclick = () => { fieldSide = 'home'; fieldPick = null; paintField(); };
$('fv-field').onclick = (e) => {
  const t = e.target.closest('.fv-tile'); if (!t) return;
  haptic(); fieldPick = t.dataset.pos; paintField();
};
$('fv-numbers').onclick = (e) => {
  const o = e.target.closest('.fv-num'); if (!o) return;
  const side = fieldSide, pos = fieldPick, i = +o.dataset.i;
  const lineups = game.lineups || {};
  const { team, moved } = L.assignSpot(lineups[side] || {}, pos, i);
  haptic();
  fieldPick = null;
  saveRoster({ ...lineups, [side]: team });
  const who = (b) => (b && b.num ? '#' + b.num : shortName(b));
  const bs = teamOf(side).batters;
  showToast(`✓ ${who(bs[i])} to ${pos}` + (moved ? (moved.to ? ` · ${who(bs[moved.idx])} to ${moved.to}` : ` · ${who(bs[moved.idx])} to bench`) : ''), 3000);
  paintField();
  renderLineups();
};
addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('field-view').hidden) { e.preventDefault(); closeField(); } });

$('hit-hbp').onclick     = () => commit(L.onHitByPitch(game));
$('hit-e').onclick       = () => openPlaySheet('E');
$('btn-foul').onclick    = () => commit(L.onFoul(game));
$('btn-out').onclick     = () => openPlaySheet();
$('btn-run').onclick     = () => commit(L.onRun(game));
$('btn-batter').onclick  = () => commit(L.onNextBatter(game));
// The repair for an order pushed on by a tap that should not have ended the
// at-bat — an out recorded on a runner, before RUNNERS was the way to do it.
$('btn-prev-batter').onclick = () => {
  const r = L.onPrevBatter(game);
  if (!r) return showToast('No lineup entered for the team at bat');
  commit(r);
  const b = L.currentBatter({ ...game, state: r.patch.state });
  showToast(b ? `◂ ${shortName(b)} is up` : '◂ Previous batter');
};
$('hit-1b').onclick      = () => startPlay('H1', null, 'hit');
$('hit-2b').onclick      = () => startPlay('H2', null, 'hit');
$('hit-3b').onclick      = () => startPlay('H3', null, 'hit');
$('btn-endhalf').onclick = () => commit(L.onEndHalf(game));
$('btn-advance').onclick = () => commit(L.onAdvance(game));
$('btn-clear').onclick   = () => commit(L.onClearBases(game));
$('base-1').onclick      = () => commit(L.toggleBase(game, 'first'));
$('base-2').onclick      = () => commit(L.toggleBase(game, 'second'));
$('base-3').onclick      = () => commit(L.toggleBase(game, 'third'));
$('undo-btn').onclick    = doUndo;

// An action that cannot know who to credit returns null rather than guessing.
// A tap that quietly does nothing is its own bug, so say what is missing.
const commitOrAsk = (r, msg) => (r ? commit(r) : showToast(msg, 2600));
const NEED_BALL = 'Set possession first — tap Away ball or Home ball';

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
$('fb-td').onclick = () => commitOrAsk(F.touchdown(game), NEED_BALL);
$('fb-fg').onclick = () => commitOrAsk(F.fieldGoal(game), NEED_BALL);
$('fb-xp').onclick = () => commitOrAsk(F.extraPoint(game), NEED_BALL);
$('fb-2pt').onclick = () => commitOrAsk(F.twoPoint(game), NEED_BALL);
$('fb-safety').onclick = () => commitOrAsk(F.safety(game), NEED_BALL);
$('fb-nextq').onclick = () => commit(F.nextQuarter(game));
$('fb-away-dn').onclick = () => commit(F.manualScore(game, 'away', -1));
$('fb-away-up').onclick = () => commit(F.manualScore(game, 'away', 1));
$('fb-home-dn').onclick = () => commit(F.manualScore(game, 'home', -1));
$('fb-home-up').onclick = () => commit(F.manualScore(game, 'home', 1));
$('fb-to-away').onclick = () => commit(F.timeout(game, 'away'));
$('fb-to-home').onclick = () => commit(F.timeout(game, 'home'));
$('fb-to-reset').onclick = () => commit(F.resetTimeouts(game));
$('fb-to-away-up').onclick = () => commit(F.adjustTimeouts(game, 'away', 1));
$('fb-to-home-up').onclick = () => commit(F.adjustTimeouts(game, 'home', 1));
$('fb-q-dn').onclick = () => commit(F.adjustQuarter(game, -1));
$('fb-q-up').onclick = () => commit(F.adjustQuarter(game, 1));
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
$('vb-endset').onclick = () => commitOrAsk(V.endSet(game), 'Tied — score the deciding point first');
$('vb-set-dn').onclick = () => commit(V.adjustSet(game, -1));
$('vb-set-up').onclick = () => commit(V.adjustSet(game, 1));
$('vb-sets-away-dn').onclick = () => commit(V.adjustSets(game, 'away', -1));
$('vb-sets-away-up').onclick = () => commit(V.adjustSets(game, 'away', 1));
$('vb-sets-home-dn').onclick = () => commit(V.adjustSets(game, 'home', -1));
$('vb-sets-home-up').onclick = () => commit(V.adjustSets(game, 'home', 1));
$('vb-away-dn').onclick = () => commit(V.manualScore(game, 'away', -1));
$('vb-home-dn').onclick = () => commit(V.manualScore(game, 'home', -1));
$('vb-away-up').onclick = () => commit(V.manualScore(game, 'away', 1));
$('vb-home-up').onclick = () => commit(V.manualScore(game, 'home', 1));
$('fx-ace').onclick = () => commitOrAsk(V.ace(game), 'Set the serving team first');

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
// The sheet's + are corrections: one point or one foul (only +3 has a stinger).
$('bk-away-up').onclick = () => commit(B.score(game, 'away', 1));
$('bk-home-up').onclick = () => commit(B.score(game, 'home', 1));
$('bk-foul-away-up').onclick = () => commit(B.foul(game, 'away', 1));
$('bk-foul-home-up').onclick = () => commit(B.foul(game, 'home', 1));
$('bk-to-away-up').onclick = () => commit(B.adjustTimeouts(game, 'away', 1));
$('bk-to-home-up').onclick = () => commit(B.adjustTimeouts(game, 'home', 1));
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
  $('team-sel-' + side).value = '';   // one-shot: picking the same team again must reload it
  if (!t) return;
  const has = teamOf(side).batters.some((b) => b && (b.name || b.num));
  if (has && !confirm(`Replace this game's ${side} lineup with the saved "${t.name}" lineup?`)) return;
  await saveRoster({ ...(game.lineups || {}), [side]: L.normalizeTeam(t.roster || {}) }, { allowClear: true });
  const patch = {};
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

// ---- Sponsors -------------------------------------------------------------
// Youth ball runs on sponsors. One jsonb column holds the list and the timing so
// a change is a single write: {list:[{name,logo}], rotate, every, secs}.
const spCfg = () => {
  const c = (game && game.sponsors) || {};
  return { list: Array.isArray(c.list) ? c.list : [], rotate: !!c.rotate, every: c.every || 180, secs: c.secs || 8 };
};
async function saveSponsors(next) { await writeField({ sponsors: next }); }
function renderSponsors() {
  const box = $('sponsor-list'); if (!box || !game) return;
  // Never rebuild these rows out from under someone typing in one — the gate
  // stops a commit from getting here, but another device's write still can.
  if (document.activeElement && document.activeElement.closest && document.activeElement.closest('#sponsor-list')) return;
  const c = spCfg();
  box.innerHTML = '';
  c.list.forEach((sp, i) => {
    const row = document.createElement('div');
    row.className = 'sp-row';
    row.innerHTML = `<input class="sp-name" placeholder="Sponsor name" value="${esc(sp.name || '')}" />` +
      `<input class="sp-logo" placeholder="Logo URL (optional)" value="${esc(sp.logo || '')}" />` +
      `<button class="fxbtn cardclear sp-del" aria-label="Remove sponsor">🗑</button>`;
    const commitRow = () => {
      const list = spCfg().list.slice();
      list[i] = { name: row.querySelector('.sp-name').value.trim(), logo: row.querySelector('.sp-logo').value.trim() };
      saveSponsors({ ...spCfg(), list });
    };
    row.querySelector('.sp-name').onchange = commitRow;
    row.querySelector('.sp-logo').onchange = commitRow;
    row.querySelector('.sp-del').onclick = () => saveSponsors({ ...spCfg(), list: spCfg().list.filter((_, j) => j !== i) });
    box.appendChild(row);
  });
  $('sponsor-rotate').checked = c.rotate;
  if (document.activeElement !== $('sponsor-every')) $('sponsor-every').value = c.every;
  if (document.activeElement !== $('sponsor-secs')) $('sponsor-secs').value = c.secs;
}
$('sponsor-add').onclick = () => saveSponsors({ ...spCfg(), list: [...spCfg().list, { name: '', logo: '' }] });
$('sponsor-rotate').onchange = (e) => saveSponsors({ ...spCfg(), rotate: e.target.checked });
$('sponsor-every').onchange = (e) => saveSponsors({ ...spCfg(), every: Math.max(15, Math.min(1800, parseInt(e.target.value, 10) || 180)) });
$('sponsor-secs').onchange = (e) => saveSponsors({ ...spCfg(), secs: Math.max(3, Math.min(60, parseInt(e.target.value, 10) || 8)) });

// Broadcast cards (persistent until cleared). One door for all of them: the
// 🎬 On Air sheet. Tap a card to raise it, tap the card that's up to take it
// down, or ✕ on the header chip, which is on screen whatever else is open.
const CARD_LABEL = {
  dueup: 'Due Up', lineup: 'Batting order', defense: 'Defense', matchup: 'Matchup', sponsor: 'Sponsor',
  final: 'Final', starting: 'Starting Soon', midinning: 'Mid-Inning', finalfull: 'Final (full)',
};
const cardLabel = (type) => CARD_LABEL[type] || type;
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
  await writeField({ card: { type, meta, nonce: nextNonce() } });
  showToast(`🎬 ${cardLabel(type)} on air`);
}
// The game going live ends the pre-game, so Starting Soon comes down with it.
// Its own write — apply_event does not carry the card column.
function dropStartingSoon() {
  if (game && game.card && game.card.type === 'starting') writeField({ card: null });
}
async function clearCard() {
  const was = game.card && game.card.type;
  await writeField({ card: null });
  showToast(was ? `${cardLabel(was)} off air` : 'Card cleared');
}
function toggleCard(type) {
  haptic();
  return game.card && game.card.type === type ? clearCard() : showCard(type);
}
$('onair-open').onclick = () => { renderOnAir(); openSheet('onair-sheet'); };
$('onair-done').onclick = () => closeSheet('onair-sheet');
$('air-clear').onclick = () => { haptic(); clearCard(); };
// Raising a card or firing a moment is the whole errand, so the sheet gets out
// of the pad's way as soon as one goes. Rally is a mode you flip, so it stays.
// Moment buttons run their own onclick first; this only closes behind them.
$('onair-sheet').addEventListener('click', (e) => {
  const card = e.target.closest('[data-card]');
  if (card) toggleCard(card.dataset.card);
  if (card || e.target.closest('.moment')) closeSheet('onair-sheet');
});

// What you'd most likely raise at this point in the game. Baseball only — it is
// the sport where the pad knows enough about the moment to guess. A clean slate
// (no outs, no count, bases empty) is the top of a half: the change just happened.
function airSuggestions(g) {
  const b = L.safeBases(g.bases);
  const clean = !(g.outs | 0) && !(g.balls | 0) && !(g.strikes | 0) && !b.first && !b.second && !b.third;
  if (clean && (g.inning | 0) <= 1 && g.half !== 'bottom') return { why: 'before first pitch', ids: ['starting', 'matchup', 'lineup'] };
  if (clean) return { why: 'start of the half', ids: ['midinning', 'dueup', 'defense'] };
  if (!(g.balls | 0) && !(g.strikes | 0)) return { why: 'new batter', ids: ['dueup', 'lineup', 'sponsor'] };
  return { why: 'mid at-bat', ids: ['dueup', 'defense', 'lineup'] };
}
// The header chip, the lit card, and the baseball labels that follow the half
// (batting order = batting side, defense = fielding side; the overlay tracks
// both live, so the card itself never needs re-raising when the half flips).
function renderOnAir() {
  if (!game) return;
  const up = game.card && game.card.type;
  $('air-chip').hidden = !up;
  if (up) $('air-lab').textContent = cardLabel(up);
  if ((game.sport || 'baseball') === 'baseball') {
    const abbr = (s) => (s === 'home' ? (game.home_abbr || 'HOME') : (game.away_abbr || 'AWAY'));
    const label = (t) => (t === 'lineup' ? `Batting: ${abbr(L.battingSide(game))}`
      : t === 'defense' ? `Defense: ${abbr(L.fieldingSide(game))}` : cardLabel(t));
    $('card-bat-auto').textContent = label('lineup');
    $('card-def-auto').textContent = label('defense');
    const s = airSuggestions(game);
    $('air-why').textContent = s.why ? `· ${s.why}` : '';
    // Outline the real buttons rather than copying them into a row of their own.
    document.querySelectorAll('#onair-sheet [data-card]').forEach((btn) => {
      btn.classList.toggle('sugg', s.ids.includes(btn.dataset.card));
    });
  }
  document.querySelectorAll('#onair-sheet [data-card]').forEach((btn) => {
    const on = btn.dataset.card === up;
    btn.classList.toggle('on', on);
    btn.setAttribute('aria-pressed', String(on));
  });
}

// Moments / FX
$('fx-homerun').onclick = () => openHrSheet();
$('fx-k').onclick       = () => fireAnim('strikeout');
$('fx-klook').onclick   = () => fireAnim('strikeoutlooking');
$('fx-dp').onclick      = () => fireAnim('doubleplay');
$('fx-sb').onclick      = () => fireAnim('stolenbase');
$('fx-walkoff').onclick = () => fireAnim('walkoff');
$('fx-rally').onclick   = () => writeField({ rally_mode: !game.rally_mode });
function renderRally() {
  const b = $('fx-rally');
  b.textContent = `Rally: ${game.rally_mode ? 'ON' : 'OFF'}`;
  b.classList.toggle('on', !!game.rally_mode);
}

// ---- Show/hide the OBS controls ------------------------------------------
// Plenty of people want the scorebug and nothing else — a browser source in
// other software, or a scoreboard on a TV. Clip, Cameras and Stream & record
// are dead weight for them, so the whole group slides away. A device
// preference, not a game one: the same game may be run from an OBS laptop and a
// phone that has never seen OBS.
const OBS_UI = 'sb:obsUi';
function applyObsUi(on) {
  document.body.classList.toggle('no-obs', !on);
  const box = $('obs-ui');
  if (box) box.checked = on;
}
$('obs-ui').onchange = (e) => {
  applyObsUi(e.target.checked);
  try { localStorage.setItem(OBS_UI, e.target.checked ? '1' : '0'); } catch {}
  showToast(e.target.checked ? '🎛️ OBS controls shown' : '🎛️ OBS controls hidden');
};
try { applyObsUi(localStorage.getItem(OBS_UI) !== '0'); } catch { applyObsUi(true); }

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
// The OBS tab leads with the tier it is actually running at, so a disabled
// control reads as "not unlocked" rather than "broken".
function renderObsTier() {
  const lvl = obsLevel();
  $('obs-tier').textContent = lvl === null ? 'Not connected' : (OBS_TIER[lvl] || 'No access');
}
$('obs-tier-help').onclick = () => {
  const n = $('obs-tier-note');
  n.textContent = obsLevel() === null
    ? 'Add the overlay to OBS as a Browser Source and open it — the pad reads its permission level from there. Basic runs the scorebug, cards, moments and sound; Advanced adds replay clips and camera switching; Full adds going live and recording.'
    : 'Set it on the Browser Source: Page permissions → Basic runs the scorebug, cards, moments and sound; Advanced adds replay clips and camera switching; Full adds going live and recording. Everything below your level keeps working.';
  n.hidden = !n.hidden;
};

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
  renderObsTier();
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
  // The drawer panel and the bottom-bar sheet show the same buttons.
  for (const [l, h] of [[list, hint], [$('cam-list'), $('cam-hint')]]) {
    l.innerHTML = '';
    for (const name of names) {
      const b = document.createElement('button');
      b.className = 'fxbtn scene' + (name === obs.current ? ' on' : '');
      b.textContent = name;
      b.onclick = () => switchScene(name);
      b.disabled = level < 4;
      l.appendChild(b);
    }
    if (level < 4) {
      const note = needNote(4);
      h.dataset.tone = note.tone; h.textContent = note.text;
    } else if (!names.length) {
      h.dataset.tone = 'off'; h.textContent = 'OBS reported no scenes.';
    } else {
      h.dataset.tone = 'ok'; h.textContent = `On air: ${obs.current || '—'}`;
    }
  }
  setNeedBadge('scene-need', 4);
  // Only a door worth having once OBS has told us what there is to cut to.
  $('cam-open').hidden = !names.length;
}
$('cam-open').onclick = () => openSheet('cam-sheet');
$('cam-done').onclick = () => closeSheet('cam-sheet');

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
  await writeField({ auto_clip });   // queued: no need to roll back on a blip
  showToast(auto_clip ? '🎞️ Auto-clip on for big plays' : 'Auto-clip off');
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
  // Short enough for a quarter of the bottom bar on a 375pt phone.
  b.innerHTML = '<i aria-hidden="true">🎞️</i>' + (!replayPending.size ? 'Replay' : waiting > 0 ? `${waiting}s` : 'Saving…');
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

// ---- Sheets ---------------------------------------------------------------
// The five sheets are divs, not <dialog>. showModal() is iOS 15.4+ — the same
// floor this app already declines to build on for :has() — and an unsupported
// showModal doesn't degrade, it leaves the sheet unopenable. So the dialog
// behaviour lives here instead, and works the same everywhere: focus moves in
// on open and back to whatever opened it on close, Tab cannot leave, Escape
// closes, and so does a tap on the scrim.
//
// This is not only an accessibility fix. The HR and Walk sheets come up during
// a live at-bat with the pad behind them, so a Tab that escaped, or a keyboard
// shortcut that fired through the scrim, scored a real play you could not see.
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
const sheetStack = [];              // ids, innermost last
const sheetReturn = new Map();      // id -> the element to hand focus back to
const sheetGuard = new Map();       // id -> () => false to refuse the close
const topSheet = () => sheetStack[sheetStack.length - 1] || null;
const sheetOpen = () => sheetStack.length > 0;
// getClientRects() rather than offsetParent: it is the honest "is this on
// screen" test inside a fixed-position sheet.
const focusablesIn = (el) => [...el.querySelectorAll(FOCUSABLE)].filter((n) => n.getClientRects().length);

function openSheet(id) {
  const el = $(id);
  if (!el || !el.hidden) return;
  sheetReturn.set(id, document.activeElement);
  // Game Setup is opened from a button inside the drawer, so the two would
  // otherwise be on screen together — two stacked sheets, the lower one only
  // reachable by dismissing the upper. One thing over the pad at a time.
  closeDrawer();
  el.hidden = false;
  sheetStack.push(id);
  // The first control, not the sheet itself: land on something you can act on.
  (focusablesIn(el)[0] || el).focus({ preventScroll: true });
}
function closeSheet(id) {
  const el = $(id);
  if (!el || el.hidden) return;
  el.hidden = true;
  const i = sheetStack.indexOf(id);
  if (i >= 0) sheetStack.splice(i, 1);
  const back = sheetReturn.get(id);
  sheetReturn.delete(id);
  // Focus cannot go back to the control that opened the sheet if it went with
  // the drawer. "⚙ Setup" is the door back to it, and it is only in the layout
  // where the drawer is a sheet at all — above 700px it is display:none and the
  // panes never left the screen, so the ordinary restore still applies there.
  const gone = back && back.closest('#drawer') && !drawerOpen() && $('dw-open').getClientRects().length;
  const land = gone ? $('dw-open') : back;
  if (land && land !== document.body && document.contains(land)) land.focus({ preventScroll: true });
  const next = topSheet();   // a sheet opened over another hands focus back to it
  if (next) (focusablesIn($(next))[0] || $(next)).focus({ preventScroll: true });
}
// Escape and the scrim go through the same door as Cancel, so a sheet that asks
// before discarding still asks.
function requestCloseSheet(id) {
  const guard = sheetGuard.get(id);
  if (guard && guard() === false) return;
  closeSheet(id);
}
for (const id of ['sit-sheet', 'onair-sheet', 'play-sheet', 'lineup-sheet', 'walk-sheet', 'k3-sheet', 'runners-sheet', 'hr-sheet', 'setup-sheet', 'newgame-sheet']) {
  $(id).addEventListener('click', (e) => { if (e.target === $(id)) requestCloseSheet(id); });
}
// Escape closes the innermost sheet; Tab cycles inside it and cannot get out.
document.addEventListener('keydown', (e) => {
  const id = topSheet();
  if (!id) return;
  if (e.key === 'Escape') { e.preventDefault(); return requestCloseSheet(id); }
  if (e.key !== 'Tab') return;
  const el = $(id);
  const f = focusablesIn(el);
  if (!f.length) { e.preventDefault(); return el.focus({ preventScroll: true }); }
  const first = f[0], last = f[f.length - 1];
  if (!el.contains(document.activeElement)) { e.preventDefault(); (e.shiftKey ? last : first).focus(); }
  else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
});

// ---- Game setup sheet -----------------------------------------------------
const suVal = (id) => $(id).value.trim();
$('setup-btn').onclick = () => { fillSetup(); setupDirty = false; openSheet('setup-sheet'); };
// Cancel after typing a full team card used to bin the lot without a word.
let setupDirty = false;
$('setup-sheet').addEventListener('input', () => { setupDirty = true; });
// Registered as the sheet's guard too, so Escape and the scrim ask the same
// question Cancel does rather than binning a typed-out team card silently.
const setupCloseGuard = () => {
  if (setupDirty && !confirm('Discard your changes to this game?')) return false;
  setupDirty = false;
  return true;
};
sheetGuard.set('setup-sheet', setupCloseGuard);
$('setup-cancel').onclick = () => requestCloseSheet('setup-sheet');

$('delete-game').onclick = async () => {
  if (!game) return;
  if (!confirm(`Delete "${game.away_name} @ ${game.home_name}"? This permanently removes the game and cannot be undone.`)) return;
  const id = game.id;
  setupDirty = false; closeSheet('setup-sheet');
  stopDemo(); keepAwake(false); stopClockTick();
  queue.dropFor(id); // otherwise the queue retries forever against a row that is gone
  await teardownChannel();
  const { error } = await db.from('games').delete().eq('id', id);
  if (error) return alert(error.message);
  game = null; show('lobby'); await loadGames();
};

$('reset-game').onclick = async () => {
  if (!game) return;
  if (!confirm('Reset this game to 0? Score, situation, clock, cards and undo history are cleared. Teams and look are kept.')) return;
  const sport = game.sport || 'baseball';
  const patch = {
    status: 'setup', home_score: 0, away_score: 0,
    home_hits: 0, away_hits: 0, home_errors: 0, away_errors: 0,
    line_score: [], current_animation: null, card: { type: 'starting', meta: {}, nonce: nextNonce() }, rally_mode: false,
    clock_running: false, clock_ends_at: null, clock_remaining_seconds: game.time_limit_seconds || null,
  };
  if (sport === 'baseball') Object.assign(patch, {
    inning: 1, half: 'top', balls: 0, strikes: 0, outs: 0,
    bases: { first: false, second: false, third: false }, pitch_count: 0,
    state: { ...(game.state || {}), batIdx: { away: 0, home: 0 }, pitches: { away: 0, home: 0 } },
  });
  else if (sport === 'football') patch.state = F.fbState({});
  else if (sport === 'soccer') patch.state = S.scState({});
  else if (sport === 'volleyball') patch.state = V.vbState({});
  else if (sport === 'basketball') patch.state = B.bkState({});
  await db.from('events').delete().eq('game_id', game.id); // wipe undo history
  await db.from('plays').delete().eq('game_id', game.id);  // and the recap's play-by-play
  setupDirty = false; closeSheet('setup-sheet');
  await writeField(patch);
  showToast('↺ Game reset');
};
// The same column is a game time limit, a quarter, or a half depending on the
// sport. Say which, so nobody has to guess what soccer does with it.
const SU_TIME_LABEL = {
  baseball: 'Time limit — minutes (0 = none)',
  football: 'Quarter length — minutes (0 = none)',
  basketball: 'Period length — minutes (0 = none)',
  soccer: 'Half length — minutes (blank = 45)',
  volleyball: 'Time limit — minutes (0 = none)',
};
function renderSetupTimeLabel() {
  $('su-time-label').textContent = SU_TIME_LABEL[$('su-sport').value] || SU_TIME_LABEL.baseball;
}
$('su-sport').addEventListener('change', renderSetupTimeLabel);

function fillSetup() {
  $('su-sport').value = game.sport || 'baseball';
  renderSetupTimeLabel();
  $('su-style').value = game.style || 'bar';
  $('su-away-name').value = game.away_name || '';
  $('su-away-abbr').value = game.away_abbr || '';
  $('su-away-logo').value = game.away_logo_url || '';
  $('su-away-color').value = game.away_color || '#7a8794';
  $('su-home-name').value = game.home_name || '';
  $('su-home-abbr').value = game.home_abbr || '';
  $('su-home-logo').value = game.home_logo_url || '';
  $('su-home-color').value = game.home_color || '#1b2a41';
  $('su-startsat').value = toLocalInput(game.starts_at);
  $('su-time').value = game.time_limit_seconds ? Math.round(game.time_limit_seconds / 60) : '';
  $('su-regulation').value = game.regulation_innings || '';
  $('su-show-clock').checked = !!game.show_clock;
  $('su-show-batter').checked = !!game.show_batter;
  $('su-show-pitcher').checked = !!game.show_pitcher;
  $('su-show-pitchcount').checked = !!game.show_pitchcount;
  $('su-show-runrule').checked = !!game.show_runrule;
  $('su-show-rhe').checked = !!game.show_rhe;
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
    starts_at: fromLocalInput($('su-startsat').value),
    show_clock: $('su-show-clock').checked, show_batter: $('su-show-batter').checked,
    show_pitcher: $('su-show-pitcher').checked, show_pitchcount: $('su-show-pitchcount').checked,
    show_runrule: $('su-show-runrule').checked, show_rhe: $('su-show-rhe').checked,
    regulation_innings: parseInt($('su-regulation').value, 10) || 0,
  };
  // Reset the clock's remaining time if the limit changed and it isn't running.
  if (time_limit_seconds && !game.clock_running) patch.clock_remaining_seconds = time_limit_seconds;
  // Initialize sport-specific situation the first time a game switches sport.
  if (sport === 'football' && !(game.state && game.state.quarter)) patch.state = F.fbState(game);
  if (sport === 'soccer' && !(game.state && game.state.half)) patch.state = S.scState(game);
  if (sport === 'volleyball' && !(game.state && game.state.sets)) patch.state = V.vbState(game);
  if (sport === 'basketball' && !(game.state && game.state.period)) patch.state = B.bkState(game);
  setupDirty = false;
  closeSheet('setup-sheet');
  await writeField(patch);
};

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
  if (g.clock_running && g.clock_ends_at) return (new Date(g.clock_ends_at).getTime() - serverNow()) / 1000;
  return g.clock_remaining_seconds ?? g.time_limit_seconds;
}
$('clock-start').onclick = () => {
  if ((game.sport || 'baseball') === 'soccer') return commit(S.clockStart(game, new Date(serverNow()).toISOString()));
  if (!game.time_limit_seconds) return;
  const rem = game.clock_remaining_seconds ?? game.time_limit_seconds;
  // Written here, read in the overlay: it has to be an instant on the shared clock.
  // Starting the clock starts the game: it goes live and the automatic Starting Soon comes down.
  if (game.status === 'setup') dropStartingSoon();
  writeField({ clock_running: true, clock_ends_at: new Date(serverNow() + rem * 1000).toISOString(), clock_remaining_seconds: rem,
    ...(game.status === 'setup' ? { status: 'live' } : {}) });
};
$('clock-pause').onclick = () => {
  if ((game.sport || 'baseball') === 'soccer') return commit(S.clockPause(game, serverNow()));
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
    const e = S.elapsedSeconds(game, serverNow());
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
// Only while a game is open. It used to be registered at module load and never
// stopped, waking the phone's main thread four times a second on the login and
// lobby screens, which have no clock on them.
let clockTimer = null;
function startClockTick() { if (!clockTimer) clockTimer = setInterval(() => { if (game) renderClock(); }, 250); }
function stopClockTick() { if (clockTimer) { clearInterval(clockTimer); clockTimer = null; } }

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
    if ((game.balls | 0) >= 3) { const w = L.computeWalk(game.bases); commit({ type: 'walk', patch: L.endPA(game, { balls: 0, strikes: 0, bases: w.bases, ...L.runsPatch(game, w.runs) }), payload: { runs: w.runs, bases: w.bases }, anim: 'webgem' }); }
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
  // Nothing scores until somebody has the ball, so give it to one of them first.
  if (!F.fbState(game).possession) return commit(F.setPossession(game, Math.random() < 0.5 ? 'home' : 'away'));
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

// ---- Direct game-row writes (setup, look, audio, sponsors, cards) ---------
// Everything durable that is not a play. Queued like scoring is, so it retries
// on a flaky field connection and tells you when it hasn't landed — this used
// to be a fire-and-forget UPDATE whose only failure signal was a console warn.
// renderGame() rather than renderLook(): a Setup save changes the score header
// too, and offline there is no realtime echo coming to repaint it.
async function writeField(patch) {
  if (!game) return;
  const gameId = game.id;
  game = { ...game, ...patch };
  renderGame();
  queue.enqueue({ kind: 'field', gameId, patch });
}
$('theme-sel').addEventListener('change', (e) => writeField({ theme: e.target.value }));
document.querySelectorAll('#pos-grid button').forEach((b) => { b.onclick = () => writeField({ scorebug_position: b.dataset.pos }); });
$('scale-sel').addEventListener('input', (e) => { $('scale-val').textContent = (+e.target.value).toFixed(2) + '×'; });
$('scale-sel').addEventListener('change', (e) => writeField({ scorebug_scale: +e.target.value }));
const POS_ALIAS = { 'bottom-bar': 'bottom-center', 'top-bar': 'top-center' };
const POS_LABEL = { 'top-left': 'Top-left', 'top-center': 'Top-centre', 'top-right': 'Top-right',
  'mid-left': 'Middle-left', 'mid-center': 'Centre', 'mid-right': 'Middle-right',
  'bottom-left': 'Bottom-left', 'bottom-center': 'Bottom-centre', 'bottom-right': 'Bottom-right' };
function renderLook() {
  $('theme-sel').value = game.theme || 'nightgame';
  const cur = POS_ALIAS[game.scorebug_position] || game.scorebug_position || 'bottom-center';
  document.querySelectorAll('#pos-grid button').forEach((b) => b.classList.toggle('on', b.dataset.pos === cur));
  const sc = game.scorebug_scale || 1;
  $('scale-sel').value = sc;
  $('scale-val').textContent = (+sc).toFixed(2) + '×';
  // A 16:9 box showing where the bug lands, so choosing a corner does not mean
  // alt-tabbing to OBS to find out what you chose.
  const [vy, vx] = cur.split('-');
  const bug = $('pos-bug');
  bug.style.top = { top: '18%', mid: '50%', bottom: '82%' }[vy] || '82%';
  bug.style.left = { left: '22%', center: '50%', right: '78%' }[vx] || '50%';
  bug.style.transform = `translate(-50%, -50%) scale(${Math.min(Math.max(+sc || 1, 0.6), 1.5)})`;
  $('pos-note').textContent = `${POS_LABEL[cur] || cur}, ${(+sc).toFixed(1)}× — where the bug sits over your camera.`;
  renderCustomize();
}

// ---- Customize (freeform `look` overrides on top of the theme) ------------
const lookOf = () => game.look || {};
async function writeLook(patch) {
  const look = { ...lookOf(), ...patch };
  for (const k of Object.keys(look)) if (look[k] === '' || look[k] === false || look[k] == null) delete look[k];
  await writeField({ look });
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
  await writeField({ look: {} });
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
  await writeField({ audio: { ...cur, ...patch, cats: { ...cur.cats, ...(patch.cats || {}) } } });
}
$('mute-btn').onclick = () => writeAudio({ muted: !audioOf().muted });
$('vol-master').addEventListener('change', (e) => writeAudio({ master: +e.target.value }));
$('vol-moments').addEventListener('change', (e) => writeAudio({ cats: { moments: +e.target.value } }));
$('vol-organ').addEventListener('change', (e) => writeAudio({ cats: { organ: +e.target.value } }));
$('sound-pack').addEventListener('change', (e) => writeField({ sound_pack: e.target.value }));

function renderAudio() {
  const a = audioOf();
  $('vol-master').value = a.master ?? 0.8;
  $('vol-moments').value = a.cats?.moments ?? 1;
  $('vol-organ').value = a.cats?.organ ?? 1;
  $('mute-btn').classList.toggle('on', !!a.muted);
  $('mute-btn').textContent = a.muted ? 'Muted' : 'Mute';
  $('sound-pack').value = game.sound_pack || 'bigleague';
}

// Ball in play ---------------------------------------------------------------
// OUT opens this on the fielder pick: tap who fielded it and the play records.
// With runners on, a second step asks where everyone finished, pre-filled with
// the likely answer (L.playDefaults), so the usual play is one more tap on
// Record. Hits with runners on and a dropped third strike start on that step.
// Nobody on and an out, or a hit: no second step at all.
const PLAY_CHIPS = [['auto', 'Auto'], ['GB', 'Ground ball'], ['FB', 'Fly ball'], ['LD', 'Line drive'], ['PU', 'Pop-up'],
  ['FC', 'Fielder’s choice'], ['DP', 'Double play'], ['SF', 'Sac fly']];
// Where each fielder stands on the drawn field, as % of its box.
const FIELD_SPOT = { LF: [18, 24], CF: [50, 11], RF: [82, 24], SS: [33, 45], '2B': [67, 43],
  '3B': [15, 64], '1B': [85, 64], P: [50, 63], C: [50, 90] };
const RS_COLS = [['out', 'Out'], [1, '1st'], [2, '2nd'], [3, '3rd'], [4, 'Home']];
const RS_START = { third: 3, second: 2, first: 1, batter: 0 };
const BASE_NAME = { first: '1st', second: '2nd', third: '3rd' };
let playType = 'auto';
let play = null;   // { kind, pos, dest, from: 'pick' | 'hit' }

const basesEmpty = () => { const b = L.safeBases(game.bases); return !b.first && !b.second && !b.third; };
// "M. Reyes" fits a fielder tile; a player with only a number reads as "#12".
const shortName = (p) => {
  if (!p) return '';
  const parts = String(p.name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return p.num ? `#${p.num}` : '';
  return parts.length > 1 ? `${parts[0][0]}. ${parts[parts.length - 1]}` : parts[0];
};
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

function openPlaySheet(type = 'auto') {
  if (!game) return;
  playType = type; play = null;
  $('play-pick').hidden = false; $('play-runners').hidden = true;
  paintPlayPick();
  openSheet('play-sheet');
}
function paintPlayPick() {
  const batter = L.currentBatter(game);
  $('play-sub').textContent = batter ? `${shortName(batter)} · who fielded it?` : 'who fielded it?';
  $('play-chips').replaceChildren(...PLAY_CHIPS.map(([kind, label]) => {
    const btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'play-chip'; btn.dataset.kind = kind; btn.textContent = label;
    btn.classList.toggle('on', playType === kind);
    btn.setAttribute('aria-pressed', String(playType === kind));
    // Not `disabled`: a disabled button swallows the tap, and the tap is when you
    // want to hear why a double play isn't possible with nobody on.
    if (kind !== 'auto' && L.playBlocked(game, kind)) { btn.classList.add('blocked'); btn.setAttribute('aria-disabled', 'true'); }
    return btn;
  }));
  // Only with somebody on: with the bases empty there is no runner to be out.
  const onBase = L.safeBases(game.bases);
  $('play-to-runners').hidden = !(onBase.first || onBase.second || onBase.third);
  const chosen = PLAY_CHIPS.find(([k]) => k === playType);
  // Error comes from its own E key on the hit bar, not a chip: charge it to a fielder.
  $('play-chips').hidden = playType === 'E';
  $('play-just-out').style.display = playType === 'E' ? 'none' : '';
  if (playType === 'E') $('play-sub').textContent = batter ? `${shortName(batter)} reached · who made the error?` : 'Who made the error?';
  $('play-will').textContent = playType === 'auto'
    ? 'Tap who fielded it. Infield records a groundout (SS → 6-3), outfield a flyout (CF → F8). For anything else, pick the type first.'
    : playType === 'E' ? 'Tap the fielder charged with the error (SS → E6). Then set where the runners ended up.'
    : `Tap who fielded the ${chosen[1].toLowerCase()}.`;
  const side = L.fieldingSide(game);
  const field = $('play-field');
  field.querySelectorAll('.fielder').forEach((x) => x.remove());
  for (const pos of L.FIELD_POSITIONS) {
    const f = L.fielderAt(game, side, pos);
    const [x, y] = FIELD_SPOT[pos];
    const btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'fielder'; btn.dataset.pos = pos;
    btn.style.left = `${x}%`; btn.style.top = `${y}%`;
    const b = document.createElement('b'); b.textContent = pos;
    const s = document.createElement('span'); s.textContent = shortName(f) || '—';
    btn.append(b, s);
    btn.setAttribute('aria-label', f ? `${pos}, ${f.name || '#' + f.num}` : pos);
    field.appendChild(btn);
  }
}
$('play-chips').onclick = (e) => {
  const c = e.target.closest('.play-chip'); if (!c) return;
  const kind = c.dataset.kind;
  if (c.classList.contains('blocked')) return showToast(L.playBlocked(game, kind), 3200);
  playType = playType === kind ? 'auto' : kind;
  paintPlayPick();
};
$('play-field').onclick = (e) => {
  const f = e.target.closest('.fielder'); if (!f) return;
  startPlay(playType === 'auto' ? L.autoKind(f.dataset.pos) : playType, f.dataset.pos, 'pick');
};
$('play-just-out').onclick = () => { closeSheet('play-sheet'); commit(L.onOut(game)); };
// Straight across to the runner plays: an out on the bases leaves the count and
// the batter alone, which is exactly what recording it here would not do.
$('play-to-runners').onclick = () => {
  closeSheet('play-sheet');
  if (!game) return;
  paintRunnerSheet();
  openSheet('runners-sheet');
};
$('play-cancel').onclick = () => closeSheet('play-sheet');

function startPlay(kind, pos, from) {
  if (!game) return;
  play = { kind, pos, dest: L.playDefaults(game, kind), from };
  // Nobody on base: nothing to ask. An error or a dropped third still asks,
  // because the batter may not have stopped at first.
  if (basesEmpty() && kind !== 'E' && kind !== 'K3') return recordPlay();
  $('play-pick').hidden = true; $('play-runners').hidden = false;
  paintRunners();
  if ($('play-sheet').hidden) openSheet('play-sheet');
  else (focusablesIn($('play-sheet'))[0] || $('play-sheet')).focus({ preventScroll: true });
}
function paintRunners() {
  const { kind, pos, dest } = play;
  const code = L.playCode(kind, pos);
  $('rs-play').textContent = code && kind !== 'K3' ? `${L.PLAY_LABEL[kind]} ${code}` : L.PLAY_LABEL[kind];
  // "who fielded it?" is answered by now; the header just names the hitter.
  $('play-sub').textContent = shortName(L.currentBatter(game));
  const b = L.safeBases(game.bases);
  const rows = ['third', 'second', 'first'].filter((k) => b[k]).map((k) => [k, 'Runner', `on ${BASE_NAME[k]}`]);
  rows.push(['batter', shortName(L.currentBatter(game)) || 'Batter', 'batter']);
  const r = L.resolvePlay(game, dest);
  const clashAt = r.clash ? RS_START[r.clash] : null;
  const had = document.activeElement && document.activeElement.closest && document.activeElement.closest('.rs-opt');
  const keep = had ? `[data-who="${had.dataset.who}"][data-to="${had.dataset.to}"]` : null;

  const grid = $('rs-grid');
  const kids = [document.createElement('span')];
  for (const [, label] of RS_COLS) { const h = document.createElement('span'); h.className = 'rs-hd'; h.textContent = label; kids.push(h); }
  for (const [who, name, from] of rows) {
    const w = document.createElement('span'); w.className = 'rs-who';
    const nb = document.createElement('b'); nb.textContent = name;
    w.append(nb, document.createTextNode(from));
    kids.push(w);
    for (const [to, label] of RS_COLS) {
      // A runner can finish where he started or further on, never behind it.
      if (to !== 'out' && to < RS_START[who]) { kids.push(document.createElement('span')); continue; }
      const on = dest[who] === to;
      const btn = document.createElement('button');
      btn.type = 'button'; btn.className = 'rs-opt'; btn.dataset.who = who; btn.dataset.to = String(to);
      btn.textContent = to === 4 ? 'H' : label;
      btn.classList.toggle('on', on);
      btn.classList.toggle('o', to === 'out');
      btn.classList.toggle('h', to === 4);
      btn.classList.toggle('stay', to === RS_START[who]);
      btn.classList.toggle('clash', on && to === clashAt);
      btn.setAttribute('aria-pressed', String(on));
      btn.setAttribute('aria-label', `${name} ${from}: ${label}`);
      kids.push(btn);
    }
  }
  grid.replaceChildren(...kids);
  if (keep) { const again = grid.querySelector(keep); if (again) again.focus({ preventScroll: true }); }

  const rec = $('rs-record');
  const sum = $('rs-sum');
  if (r.clash) {
    sum.className = 'rs-sum bad';
    sum.textContent = `Two players finished on ${BASE_NAME[r.clash]}. Move one of them to record the play.`;
    rec.disabled = true; rec.textContent = 'Record';
    return;
  }
  const res = L.onPlay(game, play);
  const runs = res.payload.runs;
  const outs = (game.outs | 0) + r.outs;
  const onBase = ['first', 'second', 'third'].filter((k) => r.bases[k]).map((k) => BASE_NAME[k]);
  sum.className = 'rs-sum';
  sum.textContent = outs >= 3
    ? `Side retired${r.runs > runs ? ' — no run counts when the third out is the batter or a force' : ''}.`
    : `${plural(outs, 'out', 'outs')} · ${plural(runs, 'run', 'runs')} · on base: ${onBase.length ? onBase.join(', ') : 'nobody'}`;
  rec.disabled = false;
  // Short: at 375pt "Record · 1 run scores" wrapped onto two lines.
  rec.textContent = runs ? `Record · ${plural(runs, 'run', 'runs')}` : 'Record';
}
$('rs-grid').onclick = (e) => {
  const o = e.target.closest('.rs-opt'); if (!o || !play) return;
  play.dest = { ...play.dest, [o.dataset.who]: o.dataset.to === 'out' ? 'out' : +o.dataset.to };
  paintRunners();
};
$('rs-back').onclick = () => {
  if (play && play.from === 'pick') { play = null; $('play-runners').hidden = true; $('play-pick').hidden = false; paintPlayPick(); return; }
  play = null; closeSheet('play-sheet');
};
$('rs-record').onclick = () => recordPlay();
function recordPlay() {
  const r = play && L.onPlay(game, play);
  if (!r) return;
  play = null; playType = 'auto';
  closeSheet('play-sheet');
  commit(r);
  showToast(r.payload.runs ? `${r.text} · ${plural(r.payload.runs, 'run scores', 'runs score')}` : r.text);
}

// Home-run sheet ------------------------------------------------------------
// Batter + every runner scores and the bases clear; the sheet just confirms the
// run total (pre-filled from who's on base) before committing + firing the anim.
let hrRuns = 1;
function paintHr() { $('hr-runs').textContent = hrRuns; }
function openHrSheet() {
  hrRuns = L.computeHomeRun(game.bases).runs;
  // Describes the bases, not the number — it has to stay true after a nudge.
  const on = hrRuns - 1;
  $('hr-copy').textContent = on
    ? `${on === 1 ? 'One runner' : on + ' runners'} on — the batter and ${on === 1 ? 'that runner' : 'all of them'} score, and the bases clear.`
    : 'Nobody on — a solo shot. The batter scores.';
  paintHr(); openSheet('hr-sheet');
}
$('hr-runs-up').onclick = () => { hrRuns = Math.min(hrRuns + 1, 4); paintHr(); };
$('hr-runs-dn').onclick = () => { hrRuns = Math.max(hrRuns - 1, 1); paintHr(); };
$('hr-cancel').onclick = () => closeSheet('hr-sheet');
$('hr-confirm').onclick = () => {
  closeSheet('hr-sheet');
  commit({ type: 'homerun', patch: L.homeRunPatch(game, hrRuns),
    payload: { runs: hrRuns, play: L.playNote(game, 'HR', { runs: hrRuns }) }, anim: 'homerun' });
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

// The situation sheet. Non-modal by the README's rule — it never blocks a
// commit, and the pad underneath stays mounted so closing it is instant.
const closeSit = () => closeSheet('sit-sheet');
$('sit-btn').onclick = () => openSheet('sit-sheet');
// Ending is a play like any other: one event, so Undo reopens the game.
const endGameClick = () => {
  if (!game) return;
  if (game.status === 'final') {
    // Same confirm as ending: the button flips in place, so a second tap (or a
    // second device that just ended it) must not quietly reopen the game.
    if (!confirm('Reopen this game? It goes back to live in your games and on the recap page.')) return;
    return commit({ type: 'reopen_game', patch: { status: 'live' } });
  }
  if (!confirm(`End the game at ${game.away_abbr || 'AWAY'} ${game.away_score | 0} – ${game.home_abbr || 'HOME'} ${game.home_score | 0}?\n\nIt shows as Final in your games and on the recap page. Undo or Reopen puts it back.`)) return;
  commit({ type: 'end_game', patch: { status: 'final', clock_running: false } });
  closeSheet('sit-sheet');
};
document.querySelectorAll('.end-game').forEach((b) => { b.onclick = endGameClick; });
// Situation sheet rows name the teams the way the scorebug does.
function renderTeamLabels() {
  const ab = { away: game.away_abbr || 'Away', home: game.home_abbr || 'Home' };
  document.querySelectorAll('#sit-sheet .adj-lab[data-team]').forEach((el) => {
    el.textContent = ab[el.dataset.team] + (el.dataset.suffix || '');
  });
}
// Clear one side's roster: the deliberate wipe the save guard exists to make
// impossible by accident. Rosters are written straight to their table and carry
// no undo, so this asks first and says how many players it is about to drop.
async function clearLineup(side) {
  if (!game) return;
  const label = teamAbbr(side);
  const n = teamOf(side).batters.filter((b) => b && (b.name || b.num)).length;
  if (!n) return showToast(`${label} has no lineup to clear`);
  if (!confirm(`Clear the ${label} lineup?\n\n${n} player${n > 1 ? 's' : ''} and that team's defense are removed. This cannot be undone.`)) return;
  await saveRoster({ ...(game.lineups || {}), [side]: {} }, { allowClear: true });
  // An empty order has nobody at bat and no pitcher, so the count of pitches
  // thrown by a pitcher who is gone goes with it.
  const st = game.state || {};
  await writeField({ state: { ...st, batIdx: { ...(st.batIdx || {}), [side]: 0 }, pitches: { ...(st.pitches || {}), [side]: 0 } } });
  renderGame();
  showToast(`🧹 Cleared the ${label} lineup`);
}
$('lu-clear-away').onclick = () => clearLineup('away');
$('lu-clear-home').onclick = () => clearLineup('home');
// The buttons name the teams the way the scorebug does, and say so when there is
// nothing to clear.
function renderClearLineup() {
  for (const side of ['away', 'home']) {
    const b = $('lu-clear-' + side);
    const n = teamOf(side).batters.filter((x) => x && (x.name || x.num)).length;
    b.textContent = `Clear ${teamAbbr(side)} lineup`;
    b.disabled = !n;
  }
}
function renderEndGame() {
  const over = game.status === 'final';
  document.querySelectorAll('.end-game').forEach((b) => {
    b.textContent = over ? '↺ Reopen game' : '🏁 End game';
    b.classList.toggle('over', over);
  });
}
$('sit-done').onclick = closeSit;
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
const LINEUP_SLOTS = 15;
let lineupBuiltFor = null;

const teamOf = (side) => {
  const t = (game.lineups || {})[side] || {};
  return { pitcher: t.pitcher || { name: '', num: '' }, batters: Array.isArray(t.batters) ? t.batters : [] };
};
const batIdxOf = (side, g = game) => (((g.state && g.state.batIdx) || {})[side] | 0);

function buildLineup(side) {
  let html = '';
  for (let i = 0; i < LINEUP_SLOTS; i++) {
    html += `<div class="lineup-row" data-i="${i}">` +
      `<button class="cur-dot" data-i="${i}" title="Set at-bat" aria-label="Batter ${i + 1} is up">◎</button>` +
      `<span class="ord">${i + 1}</span>` +
      `<input class="b-num" inputmode="numeric" maxlength="3" size="3" placeholder="#" aria-label="Number, batter ${i + 1}" />` +
      `<input class="b-name" placeholder="Batter ${i + 1}" aria-label="Name, batter ${i + 1}" />` +
      `<button type="button" class="b-pos" data-i="${i}"></button></div>`;
  }
  $('lineup-' + side).innerHTML = html;
}
// The roster in memory is the truth; these inputs are a view of it. The one
// input under the operator's finger is left alone — filling it would move the
// caret or drop a half-typed name — and nothing else on the screen is ever
// allowed to hold an older roster than the model does.
function fillLineup(side) {
  const raw = (game.lineups || {})[side] || {};
  const t = teamOf(side);
  const focused = document.activeElement;
  const set = (el, v) => { if (el !== focused) el.value = v; };
  $('lineup-' + side).querySelectorAll('.lineup-row').forEach((row, i) => {
    const b = t.batters[i] || {};
    set(row.querySelector('.b-num'), b.num || '');
    set(row.querySelector('.b-name'), b.name || '');
    // Read-only here: positions have one home, the Field screen. Tapping goes there.
    const pos = L.positionOf(raw, i);
    const chip = row.querySelector('.b-pos');
    chip.textContent = pos || '—';
    chip.disabled = !(b.num || b.name);
    chip.classList.toggle('none', !pos);
    chip.setAttribute('aria-label', `${pos ? 'Plays ' + pos : 'Not in the field'}. Set positions on the Field screen.`);
  });
  renderFieldCheck(side);
}
// Which of the nine spots are still empty — the thing to fix before first pitch.
function renderFieldCheck(side) {
  const el = $('fieldcheck-' + side); if (!el) return;
  const miss = L.missingPositions((game.lineups || {})[side] || {});
  el.classList.toggle('ok', !miss.length);
  if (!miss.length) { el.textContent = '✓ All nine positions filled · Field ›'; return; }
  el.replaceChildren(document.createTextNode('Empty:'));
  for (const p of miss) { const s = document.createElement('b'); s.textContent = p; el.append(s); }
  el.append(document.createTextNode(' · Set on Field ›'));
}
function renderCurrentHitter(side) {
  const idx = batIdxOf(side);
  $('lineup-' + side).querySelectorAll('.lineup-row').forEach((row, i) => {
    const on = i === idx;
    row.classList.toggle('at-bat', on);
    row.querySelector('.cur-dot').textContent = on ? '◉' : '◎';
  });
}
// One typed field, straight into the model. Typing patches the roster on every
// keystroke — so the model is never behind what is on screen — and the write
// itself waits for a short pause, or for the blur, so a name is one save and
// not one per letter. `lineupEdit` is the only path from an input to the
// roster; the sheet's DOM is never read back as a roster again.
let luFlush = null;
function lineupEdit(side, idx, field, value, now) {
  if (!game) return;
  const lineups = game.lineups || {};
  const team = L.setBatterField(lineups[side] || {}, idx, field, value);
  const next = { ...lineups, [side]: team };
  clearTimeout(luFlush); luFlush = null;
  if (wipeRefused(next, false)) return;
  if (now) { saveRoster(next); }
  else {
    game = { ...game, lineups: next };   // the model moves now; the write follows
    luStatus('saving');
    luFlush = setTimeout(() => { luFlush = null; saveRoster(game.lineups); }, 600);
  }
  fillLineup(side);   // position chips and the field check follow the edit
}
function setCurrentHitter(side, i) {
  const batIdx = { ...((game.state && game.state.batIdx) || {}), [side]: i };
  commit({ type: 'batidx', patch: { state: { ...(game.state || {}), batIdx } }, payload: { side, i } });
}
// Wire the static containers/inputs once (rows are delegated, so rebuilds are safe).
['away', 'home'].forEach((side) => {
  $('fieldcheck-' + side).onclick = () => openField(side);
  const list = $('lineup-' + side);
  const fieldOf = (e) => {
    const el = e.target.closest('.b-num, .b-name');
    const row = el && el.closest('.lineup-row[data-i]');
    return row ? { el, idx: +row.dataset.i, field: el.classList.contains('b-num') ? 'num' : 'name' } : null;
  };
  list.addEventListener('input', (e) => {
    const f = fieldOf(e); if (!f) return;
    lineupEdit(side, f.idx, f.field, f.el.value.trim(), false);
  });
  list.addEventListener('change', (e) => {
    const f = fieldOf(e); if (!f) return;
    lineupEdit(side, f.idx, f.field, f.el.value.trim(), true);
  });
  list.addEventListener('click', (e) => {
    if (e.target.closest('.b-pos')) return openField(side);
    const dot = e.target.closest('.cur-dot');
    if (dot) setCurrentHitter(side, +dot.dataset.i);
  });
  list.addEventListener('pointerdown', (e) => { if (e.target.closest('.ord')) lineupDragStart(side, e); });
});

// ---- Lineup sheet ---------------------------------------------------------
// The batter line under the count opens it, on the team at bat. One team at a
// time; both lists stay built, so switching is instant and nothing re-renders
// under a half-typed name.
let luSide = 'away';
function openLineupSheet(side) {
  if (!game) return;
  luSide = side || L.battingSide(game);
  renderLineups();
  openSheet('lineup-sheet');
}
function showLineupSide() {
  if (!game) return;
  const bat = L.battingSide(game);
  for (const s of ['away', 'home']) {
    $('lu-side-' + s).hidden = s !== luSide;
    const tab = $('lu-tab-' + s);
    tab.setAttribute('aria-pressed', String(s === luSide));
    const abbr = s === 'home' ? (game.home_abbr || game.home_name || 'HOME') : (game.away_abbr || game.away_name || 'AWAY');
    tab.textContent = `${s === 'home' ? 'Home' : 'Away'} · ${abbr}${s === bat ? ' · batting' : ''}`;
  }
}
$('lu-tab-away').onclick = () => { luSide = 'away'; showLineupSide(); };
$('lu-tab-home').onclick = () => { luSide = 'home'; showLineupSide(); };
$('lu-done').onclick = () => closeSheet('lineup-sheet');
$('gm-batter').onclick = () => { if (game && (game.sport || 'baseball') === 'baseball') openLineupSheet(); };

// Batting order — drag a row by its number onto another slot to swap them.
// Same pointer-based pattern as the defense diamond, so it works on touch.
let lbd = null;
function lineupRowAt(e) {
  lbd.ghost.style.display = 'none';
  const el = document.elementFromPoint(e.clientX, e.clientY);
  lbd.ghost.style.display = '';
  const row = el && el.closest('.lineup-row[data-i]');
  return row && row.parentElement === $('lineup-' + lbd.side) ? row : null;
}
// The panel column scrolls, and touch-action:none on the grip means the finger
// can't scroll it mid-drag — so nudge the nearest scroller when near an edge.
function scrollerOf(el) {
  for (let n = el; n && n !== document.body; n = n.parentElement) {
    const oy = getComputedStyle(n).overflowY;
    if ((oy === 'auto' || oy === 'scroll') && n.scrollHeight > n.clientHeight) return n;
  }
  return document.scrollingElement;
}
function lineupDragMove(e) {
  if (!lbd) return;
  e.preventDefault();
  lbd.ghost.style.left = e.clientX + 'px'; lbd.ghost.style.top = e.clientY + 'px';
  const r = lbd.scroller === document.scrollingElement ? { top: 0, bottom: innerHeight } : lbd.scroller.getBoundingClientRect();
  if (e.clientY < r.top + 48) lbd.scroller.scrollTop -= 14;
  else if (e.clientY > r.bottom - 48) lbd.scroller.scrollTop += 14;
  const row = lineupRowAt(e);
  document.querySelectorAll('.lineup-row.hot').forEach((x) => { if (x !== row) x.classList.remove('hot'); });
  if (row && +row.dataset.i !== lbd.from) row.classList.add('hot');
}
function lineupDragEnd(e) {
  if (!lbd) return;
  const row = lineupRowAt(e);
  const { side, from, ghost, src } = lbd;
  lbd = null;
  ghost.remove(); src.classList.remove('dragging');
  document.querySelectorAll('.lineup-row.hot').forEach((x) => x.classList.remove('hot'));
  window.removeEventListener('pointermove', lineupDragMove);
  window.removeEventListener('pointerup', lineupDragEnd);
  window.removeEventListener('pointercancel', lineupDragEnd);
  if (!row || +row.dataset.i === from) return;
  // The model already holds every keystroke (lineupEdit patches on input), so
  // the swap starts from it rather than from the rows on screen.
  const lineups = game.lineups || {};
  clearTimeout(luFlush); luFlush = null;
  saveRoster({ ...lineups, [side]: L.swapBatters(lineups[side] || {}, from, +row.dataset.i) });
  fillLineup(side);
}
function lineupDragStart(side, e) {
  const src = e.target.closest('.lineup-row[data-i]');
  if (!src || lbd) return;
  e.preventDefault();
  if (document.activeElement && src.closest('.lu-side').contains(document.activeElement)) document.activeElement.blur();
  const num = src.querySelector('.b-num').value.trim(), name = src.querySelector('.b-name').value.trim();
  const ghost = document.createElement('div');
  ghost.className = 'lb-ghost';
  ghost.textContent = (num ? '#' + num + ' ' : '') + (name || `Slot ${+src.dataset.i + 1}`);
  ghost.style.left = e.clientX + 'px'; ghost.style.top = e.clientY + 'px';
  document.body.appendChild(ghost);
  src.classList.add('dragging');
  lbd = { side, from: +src.dataset.i, ghost, src, scroller: scrollerOf(src) };
  window.addEventListener('pointermove', lineupDragMove, { passive: false });
  window.addEventListener('pointerup', lineupDragEnd);
  window.addEventListener('pointercancel', lineupDragEnd);
}
function renderLineups() {
  if (lineupBuiltFor !== game.id) { buildLineup('away'); buildLineup('home'); lineupBuiltFor = game.id; }
  // Always fill. This used to skip both sides whenever any lineup input had
  // focus, which let fourteen other rows sit on a roster older than the model —
  // the stale text a blur then wrote back. fillLineup now protects the one
  // focused input by itself, so there is nothing left to skip.
  fillLineup('away'); fillLineup('home');
  renderCurrentHitter('away'); renderCurrentHitter('home');
  renderClearLineup();   // roster-shaped, so it rides the same paint as the sheet
  showLineupSide();
  paintField();   // a roster saved elsewhere repaints an open Field screen too
}
// The drag-onto-a-diamond Defense panel lived here until v3.62. Positions are
// set on the Field screen (openField / L.assignSpot); lineup rows show them read-only.

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
  paintWalk(); openSheet('walk-sheet');
}
$('w1').onclick = () => { wState.first = !wState.first; paintWalk(); };
$('w2').onclick = () => { wState.second = !wState.second; paintWalk(); };
$('w3').onclick = () => { wState.third = !wState.third; paintWalk(); };
$('w-runs-up').onclick = () => { wState.runs = Math.min(wState.runs + 1, 4); paintWalk(); };
$('w-runs-dn').onclick = () => { wState.runs = Math.max(wState.runs - 1, 0); paintWalk(); };
$('walk-cancel').onclick = () => closeSheet('walk-sheet');
$('walk-confirm').onclick = () => {
  closeSheet('walk-sheet');
  const bases = { first: wState.first, second: wState.second, third: wState.third };
  // anim: the WALK reveal fires automatically, like run/strikeout do.
  commit({ type: 'walk', patch: L.endPA(game, { balls: 0, strikes: 0, bases, ...L.runsPatch(game, wState.runs) }),
    payload: { runs: wState.runs, bases, play: L.playNote(game, 'BB', { runs: wState.runs }) }, anim: 'webgem' });
};

// Render --------------------------------------------------------------------
const ordinal = (n) => ({ 1: '1st', 2: '2nd', 3: '3rd', 4: '4th' }[n] || n + 'th');
// The header reads runs-then-abbreviation twice over, which out loud is "0 VIS 0
// HOME". Give it the sentence instead, and say it when it changes — that is the
// confirmation a tap landed, for an operator who cannot see the number move.
let lastSaidScore = null;
function renderScoreLabel(g) {
  const said = `${g.away_abbr || g.away_name || 'Visitor'} ${g.away_score | 0}, ` +
               `${g.home_abbr || g.home_name || 'Home'} ${g.home_score | 0}`;
  const el = $('gm-score');
  if (el) el.setAttribute('aria-label', said);
  if (said === lastSaidScore) return;
  const first = lastSaidScore === null;
  lastSaidScore = said;
  if (!first) announce(said);   // opening a game is not a scoring event
}

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
  // The full-face pad is baseball's; the other sports keep their scrolling pads
  // under the same shell until they get their own key sets.
  document.body.classList.toggle('bb', sport === 'baseball');
  // Every sport has a Situation sheet now, and the bar already says what the
  // batter line used to repeat for the other sports, so that line is baseball's.
  $('sit-btn').disabled = false;
  $('g-batting').hidden = true;
  $('gm-batter').disabled = sport !== 'baseball';   // the lineup sheet is baseball's
  if (sport !== 'baseball') {
    $('gm-batter').hidden = true;
    $('gm-hitter').textContent = '';
    $('gm-vs').textContent = '';
    $('g-away-name').classList.remove('bat');
    $('g-home-name').classList.remove('bat');
  }
}
// A drawer panel repaints only when the data it actually reads has changed.
//
// renderGame() used to run eleven renders unconditionally on every commit AND
// every inbound realtime row — rebuilding the sponsor list, the defensive
// diamond and the scene buttons from innerHTML each time. The overlay is a
// chatty writer (it reports obs_status on eight OBS events and obs_scenes on
// every scene change), so switching cameras during a game rebuilt the whole
// control panel on each cut, including panels nobody was looking at. It is also
// what destroyed a sponsor name while it was being typed.
//
// Each panel names its dependencies below; a render is skipped when their
// signature is unchanged. Direct calls (a tap, a timer, an ack) bypass the gate
// on purpose — those are deliberate repaints.
let panelPainted = {};
function paintIf(key, deps, fn) {
  const s = JSON.stringify([game.id, deps]);   // game.id: two games can share a roster_rev
  if (panelPainted[key] === s) return;
  panelPainted[key] = s;
  fn();
}
const batIdxOfGame = () => (game.state && game.state.batIdx) || {};

function renderGame() {
  if (!game) return;
  if ((game.roster_rev | 0) > rosterHave) syncRoster(game.id, game.roster_rev | 0);
  const g = game;
  const sport = g.sport || 'baseball';
  // ---- the fixed shell: always, this is what a commit is for ----
  showSport(sport);
  renderEndGame();
  renderTeamLabels();
  $('g-away-name').textContent = g.away_abbr || g.away_name || 'VIS';
  $('g-home-name').textContent = g.home_abbr || g.home_name || 'HOME';
  $('g-away-runs').textContent = g.away_score;
  $('g-home-runs').textContent = g.home_score;
  ctrlScorePop('away', g.away_score, 'g-away-runs');
  ctrlScorePop('home', g.home_score, 'g-home-runs');
  renderScoreLabel(g);
  if (sport === 'football') renderFootballControl();
  else if (sport === 'soccer') renderSoccerControl();
  else if (sport === 'volleyball') renderVolleyballControl();
  else if (sport === 'basketball') renderBasketballControl();
  else renderBaseballControl();
  renderClock();   // already guards its own DOM writes, and ticks at 4Hz anyway
  // The on-air chip is part of the shell for every sport; the suggestions read the at-bat.
  paintIf('onair', [g.card, g.half, g.inning, g.outs, g.balls, g.strikes, g.bases, g.away_abbr, g.home_abbr, sport], renderOnAir);
  // ---- the drawer: only what changed ----
  paintIf('rally', [g.rally_mode], renderRally);
  paintIf('sponsors', [g.sponsors], renderSponsors);
  paintIf('replay', [g.replay_ack, g.auto_clip], renderReplay);
  paintIf('scenes', [g.obs_scenes], renderScenes);
  paintIf('obs', [g.obs_status], renderObs);
  paintIf('audio', [g.audio, g.sound_pack], renderAudio);
  paintIf('look', [g.theme, g.style, g.scorebug_position, g.scorebug_scale, g.look], renderLook);
  paintIf('guide', [g.away_name, g.home_name, g.roster_rev, sport], renderSetupGuide);
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
// Any pitch, out, run or half-inning on the board means first pitch has been thrown.
const gameStarted = () => !!game && ((game.home_score | 0) + (game.away_score | 0) + (game.balls | 0) + (game.strikes | 0)
  + (game.outs | 0) + (game.pitch_count | 0) > 0 || (game.inning | 0) > 1 || game.half === 'bottom');
function renderSetupGuide() {
  const el = $('setup-guide'); if (!el || !game) return;
  // Once every step is done it is a finished list sitting on top of the pad, and
  // the pad is what the height belongs to. Each Set → has its own home now.
  // Nor once play has begun: by then it is a checklist between you and the keys.
  el.hidden = setupAllDone() || gameStarted();
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
  document.body.classList.toggle('guide-open', !el.hidden && !guideCollapsed);
}
function openSetupGuide() { guideCollapsed = false; renderSetupGuide(); }
$('sg-head').onclick = () => { guideCollapsed = !guideCollapsed; renderSetupGuide(); };

// ---- The drawer -----------------------------------------------------------
// Everything set once, out of the way of everything pressed every pitch. It is
// presentation only: the panes hold the same panel bodies the column always
// had, so from 700px the CSS drops the sheet chrome and nothing else changes.
// The pad underneath is never unmounted — closing the drawer must be instant.
const DW_TAB = 'sb:drawerTab';
const PANEL_TAB = { 'panel-appearance': 'look',
  'panel-overlay': 'obs', 'panel-cameras': 'obs', 'panel-obs': 'obs' };
function setDrawerTab(tab) {
  // A remembered tab can outlive the tab itself (Cards left the drawer in v3.59);
  // with no pane to show, every pane would stay hidden and the drawer open empty.
  if (!document.querySelector(`.dw-pane[data-tab="${tab}"]`)) tab = 'teams';
  document.querySelectorAll('.dw-tab').forEach((b) => {
    const on = b.dataset.tab === tab;
    b.classList.toggle('on', on);
    b.setAttribute('aria-selected', String(on));
  });
  document.querySelectorAll('.dw-pane').forEach((p) => { p.hidden = p.dataset.tab !== tab; });
  // A tab that opens onto four closed summaries is a menu, not a panel. Open the
  // pane's first panel unless the operator has already chosen one in here.
  const pane = document.querySelector(`.dw-pane[data-tab="${tab}"]`);
  const first = pane && [...pane.querySelectorAll(':scope > details.panel, :scope > .sport-only > details.panel')]
    .find((d) => !d.hidden && !(d.closest('.sport-only') || {}).hidden);
  if (pane && first && !pane.querySelector('details.panel[open]')) first.open = true;
  try { localStorage.setItem(DW_TAB, tab); } catch {}
}
const drawerOpen = () => $('drawer').classList.contains('open');
function openDrawer(tab) {
  if (tab) setDrawerTab(tab);
  $('drawer').classList.add('open');
}
const closeDrawer = () => $('drawer').classList.remove('open');
$('dw-open').onclick = () => openDrawer();
$('dw-scrim').onclick = closeDrawer;
$('dw-close').onclick = closeDrawer;

// Flick the handle down to dismiss, which is what a grab handle promises. Only
// in portrait — in landscape the sheet comes in from the side, and there the
// scrim is half the screen and the ✕ is right there.
const sideSheet = () => window.matchMedia('(max-height: 500px) and (orientation: landscape)').matches;
let dwDrag = null;
const dwSheet = () => document.querySelector('.dw-sheet');
$('dw-grip').addEventListener('pointerdown', (e) => {
  if (sideSheet()) return;
  dwDrag = { from: e.clientY, moved: 0 };
  try { $('dw-grip').setPointerCapture(e.pointerId); } catch {}
  dwSheet().style.transition = 'none';
});
$('dw-grip').addEventListener('pointermove', (e) => {
  if (!dwDrag) return;
  dwDrag.moved = Math.max(0, e.clientY - dwDrag.from);
  dwSheet().style.transform = `translateY(${dwDrag.moved}px)`;
});
function endDwDrag() {
  if (!dwDrag) return;
  const dismiss = dwDrag.moved > 90;
  dwDrag = null;
  const sh = dwSheet();
  sh.style.transition = '';
  sh.style.transform = '';
  if (dismiss) closeDrawer();
}
$('dw-grip').addEventListener('pointerup', endDwDrag);
$('dw-grip').addEventListener('pointercancel', endDwDrag);
document.querySelector('.dw-tabs').addEventListener('click', (e) => {
  const b = e.target.closest('.dw-tab');
  if (b) { setDrawerTab(b.dataset.tab); document.querySelector('.dw-body').scrollTop = 0; }
});
try { setDrawerTab(localStorage.getItem(DW_TAB) || 'teams'); } catch { setDrawerTab('teams'); }

// The setup checklist still says "go here" — it just opens the drawer on the
// right tab instead of scrolling a page that no longer scrolls.
function jumpPanel(id) {
  const p = $(id); if (!p) return;
  openDrawer(PANEL_TAB[id] || 'teams');
  p.open = true;
  requestAnimationFrame(() => p.scrollIntoView({ behavior: 'smooth', block: 'start' }));
}

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
  if (go === 'teams') { fillSetup(); setupDirty = false; openSheet('setup-sheet'); }
  else if (go === 'lineups' || go === 'defense') openLineupSheet(L.battingSide(game));
  else if (go === 'overlay') { jumpPanel('panel-overlay'); overlayCopied = true; renderSetupGuide(); }
});

// The bar itself is dots and a diamond — shape, not text, and marked
// aria-hidden. These put the same state into the button's label, so it reads as
// a sentence and can be checked on demand instead of guessed at.
function setSitLabel(text) {
  const b = $('sit-btn');
  if (b) b.setAttribute('aria-label', text);
}

// Count dots read at a glance in sunlight where "2 - 1" does not; the mini
// diamond is the same shape as the sheet's, so the sheet is never a surprise.
// Three balls, two strikes, two outs is what a live at-bat holds — but the
// Situation sheet's steppers clamp at 4/3/3, so a correction can sit one past
// the row. Grow the row rather than drawing a count that isn't the count.
const countDots = (n, of, cls) => {
  let h = '';
  for (let i = 0; i < Math.max(of, n); i++) h += `<span class="cd${i < n ? ' ' + cls : ''}"></span>`;
  return h;
};
function renderBaseballControl() {
  const b = L.safeBases(game.bases);
  $('sc-mid').innerHTML =
    `<span class="gm-inning">${game.half === 'top' ? '▲' : '▼'} ${ordinal(game.inning).toUpperCase()}</span>` +
    '<span class="gm-div"></span>' +
    '<span class="gm-count">' +
      `<span class="cd-row"><i>B</i>${countDots(game.balls, 3, 'b')}</span>` +
      `<span class="cd-row"><i>S</i>${countDots(game.strikes, 2, 's')}</span>` +
      `<span class="cd-row"><i>O</i>${countDots(game.outs, 2, 'o')}</span>` +
    '</span>' +
    '<span class="gm-mini">' +
      `<span class="mb b1${b.first ? ' on' : ''}"></span>` +
      `<span class="mb b2${b.second ? ' on' : ''}"></span>` +
      `<span class="mb b3${b.third ? ' on' : ''}"></span>` +
      '<span class="mb mh"></span>' +
    '</span>';
  setSitLabel(L.situationSentence(game) + '. Edit the situation.');
  $('g-batting').hidden = true;   // the batter strip names the hitter; the bold abbreviation up top says which team
  $('g-away-name').classList.toggle('bat', game.half === 'top');
  $('g-home-name').classList.toggle('bat', game.half === 'bottom');
  renderBatterLine();
  $('pc-val').textContent = L.pitchCount(game);
  renderAdjust();
  $('base-1').classList.toggle('on', b.first);
  $('base-2').classList.toggle('on', b.second);
  $('base-3').classList.toggle('on', b.third);
  const on = [b.first && '1st', b.second && '2nd', b.third && '3rd'].filter(Boolean);
  $('bases-note').textContent = 'Tap a base to set or clear a runner. ' +
    (on.length ? `${on.join(' and ')} occupied.` : 'Nobody on.');
  // roster_rev rather than the lineups blob itself: it is bumped on every roster
  // write, which is exactly what that column is for, and it saves stringifying
  // two full rosters on every pitch.
  paintIf('lineups', [game.roster_rev, batIdxOfGame(), game.away_name, game.home_name,
    game.away_abbr, game.home_abbr, game.half], renderLineups);
}
// Who is up, and who they are facing. Empty when there is no lineup yet, and
// the row goes with it rather than sitting there as a blank strip.
function renderBatterLine() {
  const batSide = game.half === 'bottom' ? 'home' : 'away';
  const bat = teamOf(batSide), i = batIdxOf(batSide);
  const b = bat.batters[i] || {};
  const p = teamOf(batSide === 'home' ? 'away' : 'home').pitcher;
  // Jersey number first: it is what you can read from the fence. The name is
  // the second line, then who follows, so you can see the order is right.
  const has = !!(b.num || b.name);
  $('gm-num').textContent = has ? (b.num ? '#' + b.num : '') : '';
  $('gm-hitter').textContent = has ? (b.name || `#${b.num}`) : 'No lineup yet — tap to set it';
  const next = L.dueUp(game, 2).map((x) => (x.num ? '#' + x.num : shortName(x))).filter(Boolean);
  $('gm-vs').textContent = has ? `${ordinal(i + 1)} up${next.length ? ' · then ' + next.join(', ') : ''}` : '';
  const pn = p.num ? '#' + p.num : shortName(p);
  $('gm-pitch').textContent = pn ? `${pn} · ${L.pitchCount(game)}` : `— · ${L.pitchCount(game)}`;
  $('gm-batter').setAttribute('aria-label', has
    ? `Batting: ${b.num ? 'number ' + b.num + ', ' : ''}${b.name || ''}, ${ordinal(i + 1)} in the order. Pitcher ${p.num ? 'number ' + p.num : p.name || 'not set'}, ${L.pitchCount(game)} pitches. Open the lineup.`
    : 'No lineup yet. Open the lineup to set it.');
  $('gm-batter').hidden = false;
}

function renderFootballControl() {
  const st = F.fbState(game);
  const dd = st.distance === 'goal' ? `${ordinal(st.down)} & Goal` : `${ordinal(st.down)} & ${st.distance}`;
  const abbr = (t) => (t === 'home' ? (game.home_abbr || 'HOME') : (game.away_abbr || 'AWAY'));
  const poss = st.possession === 'away' ? `◄ ${esc(abbr('away'))} ball` : st.possession === 'home' ? `${esc(abbr('home'))} ball ►` : 'no ball set';
  $('sc-mid').innerHTML = `<span class="sc-inning">Q${st.quarter}</span><span class="sc-count">${dd}</span><span class="sc-outs">${poss}</span>`;
  setSitLabel(`Quarter ${st.quarter}, ${dd}` +
    (st.possession ? `, ${st.possession === 'home' ? game.home_name : game.away_name} ball` : ', possession not set'));
  $('g-batting').textContent = st.possession ? `Ball: ${st.possession === 'home' ? game.home_name : game.away_name}` : 'Possession: —';
  $('fb-dist-val').textContent = st.distance === 'goal' ? 'Goal' : st.distance;
  $('fbs-away').textContent = game.away_score | 0; $('fbs-home').textContent = game.home_score | 0;
  $('fb-q-val').textContent = st.quarter;
  $('fb-to-away-val').textContent = st.away_timeouts; $('fb-to-home-val').textContent = st.home_timeouts;
  $('fb-poss-away').classList.toggle('on', st.possession === 'away');
  $('fb-poss-home').classList.toggle('on', st.possession === 'home');
  for (const d of [1, 2, 3, 4]) $('fb-down-' + d).classList.toggle('on', st.down === d);
}
function renderSoccerControl() {
  const st = S.scState(game);
  $('sc-mid').innerHTML = `<span class="sc-inning">${st.half === 2 ? '2nd' : '1st'} Half</span>` +
    `<span class="sc-count">⚽</span><span class="sc-outs">${st.stoppage ? '+' + st.stoppage : ''}</span>`;
  setSitLabel(`${st.half === 2 ? 'Second' : 'First'} half` + (st.stoppage ? `, plus ${st.stoppage} minutes stoppage` : ''));
  $('g-batting').textContent = 'Soccer';
  $('sc-stop-val').textContent = '+' + st.stoppage;
  $('scs-away').textContent = game.away_score | 0; $('scs-home').textContent = game.home_score | 0;
  $('sc-half-1').classList.toggle('on', st.half === 1);
  $('sc-half-2').classList.toggle('on', st.half === 2);
}
function renderVolleyballControl() {
  const st = V.vbState(game);
  const serve = st.serve === 'away' ? '◄ serve' : st.serve === 'home' ? 'serve ►' : 'serve: —';
  $('sc-mid').innerHTML = `<span class="sc-inning">SET ${st.set}</span>` +
    `<span class="sc-count">${st.sets.away}–${st.sets.home}</span><span class="sc-outs">${serve}</span>`;
  setSitLabel(`Set ${st.set}, sets ${st.sets.away} to ${st.sets.home}` +
    (st.serve ? `, ${st.serve === 'home' ? game.home_name : game.away_name} serving` : ', server not set'));
  $('g-batting').textContent = st.serve ? `Serving: ${st.serve === 'home' ? game.home_name : game.away_name}` : 'Serving: —';
  $('vb-set-val').textContent = st.set;
  $('vbs-away').textContent = game.away_score | 0; $('vbs-home').textContent = game.home_score | 0;
  $('vb-sets-away-val').textContent = st.sets.away; $('vb-sets-home-val').textContent = st.sets.home;
  $('vb-target').textContent = 'To ' + st.target;
  $('vb-serve-away').classList.toggle('on', st.serve === 'away');
  $('vb-serve-home').classList.toggle('on', st.serve === 'home');
}
function renderBasketballControl() {
  const st = B.bkState(game);
  const bonus = [B.bonusOf(st, 'away') && 'AWAY ' + B.bonusOf(st, 'away'), B.bonusOf(st, 'home') && 'HOME ' + B.bonusOf(st, 'home')].filter(Boolean).join(' · ');
  $('sc-mid').innerHTML = `<span class="sc-inning">Q${st.period}</span>` +
    `<span class="sc-count">Fouls ${st.fouls.away}–${st.fouls.home}</span><span class="sc-outs">${bonus}</span>`;
  setSitLabel(`Quarter ${st.period}, fouls ${st.fouls.away} to ${st.fouls.home}` + (bonus ? `, ${bonus}` : ''));
  $('g-batting').textContent = `Q${st.period}` + (bonus ? ` · ${bonus}` : '');
  $('bk-period-val').textContent = st.period;
  $('bks-away').textContent = game.away_score | 0; $('bks-home').textContent = game.home_score | 0;
  $('bk-foul-away-val').textContent = st.fouls.away; $('bk-foul-home-val').textContent = st.fouls.home;
  $('bk-to-away-val').textContent = st.timeouts.away; $('bk-to-home-val').textContent = st.timeouts.home;
}

$('rotate-url-btn').onclick = async () => {
  if (!confirm('Rotate the overlay link?\n\nEvery link you have shared stops working, including the one in OBS — you will need to paste the new one into your Browser Source.')) return;
  const { data, error } = await db.rpc('rotate_overlay_token', { p_game: game.id });
  if (error) return showToast(`⚠️ ${error.message}`, 3000);
  overlayToken = data;
  $('overlay-url').value = overlayUrl();
  showToast('🔑 New link — update OBS');
};
$('copy-recap-btn').onclick = async () => {
  try { await navigator.clipboard.writeText($('recap-url').value); showToast('📋 Recap link copied'); }
  catch { $('recap-url').select(); showToast('Press ⌘/Ctrl+C to copy'); }
};
$('copy-url-btn').onclick = async () => {
  try { await navigator.clipboard.writeText($('overlay-url').value); $('copy-url-btn').textContent = 'Copied!'; showToast('🔗 Overlay URL copied'); setTimeout(() => ($('copy-url-btn').textContent = 'Copy'), 1200); } catch {}
  overlayCopied = true; renderSetupGuide();
};
$('open-url-btn').onclick = () => { const u = $('overlay-url').value; if (u) window.open(u, '_blank', 'noopener'); overlayCopied = true; renderSetupGuide(); };

// Keyboard shortcuts (desktop control): ignore while typing in a field.
document.addEventListener('keydown', (e) => {
  if (views.game.hidden || !game) return;
  // A sheet owns the screen and its own Escape. Scoring keys used to fire
  // straight through the scrim, which put real plays on the board behind a
  // dialog you were looking at. defaultPrevented covers the same key being
  // spent by the sheet handler above — one Escape should close one thing.
  if (sheetOpen() || e.defaultPrevented) return;
  const tag = (e.target && e.target.tagName || '').toUpperCase();
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === 'Escape' && drawerOpen()) { e.preventDefault(); return closeDrawer(); }
  const k = e.key.toLowerCase();
  if (k === 'u') { e.preventDefault(); return doUndo(); }
  if ((game.sport || 'baseball') === 'baseball') {
    const map = {
      b: 'btn-ball', s: 'btn-strike', f: 'btn-foul', o: 'btn-out', r: 'btn-run', n: 'btn-runners',
      1: 'hit-1b', 2: 'hit-2b', 3: 'hit-3b', h: 'fx-homerun', a: 'btn-advance', c: 'btn-clear',
    };
    if (k === 'e') { e.preventDefault(); return openPlaySheet('E'); }
    if (map[k]) { e.preventDefault(); $(map[k]).click(); }
  }
});

refreshSession();
