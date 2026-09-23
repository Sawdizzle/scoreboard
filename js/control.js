import { supabase, db } from './supabase.js';
import { SUPABASE_URL, SUPABASE_ANON_KEY, USER_EMAIL_DOMAIN } from './config.js';
import * as L from './logic.js';
import * as S from './soccer.js';
import { createSports } from './pads.js';
import { createObs } from './obs-pad.js';
import { createLobby } from './lobby.js';
import { createSetup } from './setup.js';
import { createField } from './field.js';
import { serverNow, syncClock } from './clock.js';
import { createQueue } from './sync.js';
import { geocode } from './weather.js';

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
      await loadTeams();
      return;
    }
    resumeGameId = null;
    // Paint the lobby before waiting on the lists, as it always has.
    show('lobby'); await loadGames(); await loadTeams();
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

// The shell's height, measured rather than assumed. `100dvh` is supposed to
// track the keyboard, and on iOS after a number pad closes it can stay at the
// shrunken value — the pad then ends partway up the screen with the bottom bar
// floating in the middle of it, which is what changing a game's time limit did.
// visualViewport reports what is actually visible and fires on every change,
// including the keyboard opening and closing.
function setAppHeight() {
  const vv = window.visualViewport;
  const h = Math.round((vv && vv.height) || window.innerHeight || 0);
  if (h > 120) document.documentElement.style.setProperty('--app-h', h + 'px');
}
if (window.visualViewport) {
  visualViewport.addEventListener('resize', setAppHeight);
  visualViewport.addEventListener('scroll', setAppHeight);
}
addEventListener('resize', setAppHeight);
addEventListener('orientationchange', () => setTimeout(setAppHeight, 150));
// A field losing focus is a keyboard closing; the viewport event for it is the
// one iOS sometimes skips, so measure again just after.
addEventListener('focusout', () => setTimeout(setAppHeight, 80));
setAppHeight();

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
// A roster rides the write queue like every other change (kind 'roster'):
// in order, one at a time, retried until it lands. Every save carries the whole
// roster, so a burst of edits between innings collapses to the newest one
// instead of racing — the queue keeps only the latest waiting roster per game.
// The lineup screen says which it is — Saving…, ✓ Saved, or Not saved.
const rosterQueued = (id) => queue.entriesFor(id).some((w) => w.kind === 'roster');
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
function saveRoster(lineups, { allowClear = false } = {}) {
  if (wipeRefused(lineups, allowClear)) return Promise.resolve();
  game = { ...game, lineups };
  luStatus('saving');
  autoSaveTeamsSoon();
  return queue.enqueue({ kind: 'roster', gameId: game.id, lineups });
}
// Another device (or this one after a reload elsewhere) saved a roster: the
// row's roster_rev has moved past the one we hold. Re-read it, unless we have a
// save of our own going out — ours is the newer edit, and it bumps the rev too.
// A save started while the read was out also wins over the read.
let rosterHave = 0;
async function syncRoster(id, rev) {
  if (!game || game.id !== id || rev <= rosterHave || rosterQueued(id)) return;
  rosterHave = rev;
  const { data, error } = await db.from('rosters').select('data').eq('game_id', id).maybeSingle();
  if (error) { rosterHave = 0; return; }   // try again on the next row
  if (!game || game.id !== id || rosterQueued(id)) return;
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
// A developer's instrument, not an operator's: it downloads the whole log, so
// it runs — and its badge shows — only on a pad opened with ?debug.
const FOLD_ON = new URLSearchParams(location.search).has('debug');
async function shadowFold(why = 'auto') {
  if (!FOLD_ON || !game || foldBusy) return;
  const id = game.id;
  foldBusy = true;
  foldBadge('busy', '◌', 'Rebuilding from the event log…');
  // Belt and braces: this is a check on the model, not part of scoring. Nothing
  // it can do — a bad row, a rule that throws on a shape it has not seen — may
  // reach the operator as anything louder than a grey badge.
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
  } catch (e) {
    console.warn('Scoreboard shadow fold failed (scoring is unaffected):', e);
    foldBadge('idle', '◌', 'The rebuild could not run — scoring is unaffected');
  } finally { foldBusy = false; }
}
// After a burst of taps, once — not per pitch, which would be a select per
// pitch on a phone on venue LTE.
const foldSoon = () => { if (!FOLD_ON) return; clearTimeout(foldTimer); foldTimer = setTimeout(() => shadowFold('after taps'), 20000); };
$('fold-badge').onclick = () => {
  if (foldLast && foldLast.diffs.length) {
    const lines = foldLast.diffs.map((d) => `${d.field}: log says ${JSON.stringify(d.folded)}, pad says ${JSON.stringify(d.row)}`);
    showToast(`Rebuild differs — ${lines[0]}`, 6000);
    console.warn('Scoreboard shadow fold detail:', foldLast);
  }
  shadowFold('tap');
};

// One link per account: OBS keeps it forever and it shows whichever game the
// pad opened last (see resolve_channel). The per-game form is only the fallback
// for a moment when the account link hasn't loaded.
let channelToken = null;     // this account's permanent overlay link
let channelGame = null;      // the game that link is showing, as far as this pad knows
async function loadChannel() {
  if (channelToken) return;
  const { data } = await db.rpc('channel_token');
  channelToken = data || null;
}
// Opening a game puts it on the overlay link — unless it is already over, so
// looking back at last week's final does not take tonight's game off the air.
async function putOnLink(id, force = false) {
  if (!force && game && game.status === 'final') return renderLinkNote();
  const { error } = await db.rpc('set_channel_game', { p_game: id });
  if (!error) channelGame = id;
  renderLinkNote();
}
function renderLinkNote() {
  const n = $('link-note'); if (!n || !game) return;
  const here = channelGame === game.id;
  n.textContent = here ? '✓ The overlay link is showing this game.' : 'The overlay link is showing a different game.';
  $('link-here').hidden = here;
}
const overlayUrl = () => (channelToken
  ? `${location.origin}/overlay?ch=${channelToken}`
  : `${location.origin}/overlay?game=${game.id}${overlayToken ? `&t=${overlayToken}` : ''}`);
const LINK_COPIED = 'sb:linkCopied';
const linkCopied = () => { try { return localStorage.getItem(LINK_COPIED) === channelToken && !!channelToken; } catch { return false; } };
function markLinkCopied() { try { if (channelToken) localStorage.setItem(LINK_COPIED, channelToken); } catch {} overlayCopied = true; }

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
  const [, lineups] = await Promise.all([syncClock(), loadRoster(id), loadChannel()]);
  overlayCopied = linkCopied();
  putOnLink(id);
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
  saveRoster: (gameId, lineups) => db.rpc('save_roster', { p_game: gameId, p_data: lineups }),
  // The rev comes back from the database, so our own save doesn't send us to
  // re-read a roster we just wrote.
  onRosterSaved: (gameId, rev, settled) => {
    if (!game || game.id !== gameId) return;
    game = { ...game, roster_rev: Math.max(game.roster_rev | 0, rev) };
    rosterHave = game.roster_rev;
    if (settled) luStatus('saved');
  },
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
  if (err && game && rosterQueued(game.id)) luStatus('failed');
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
$('btn-ball').onclick    = () => { const r = L.onBall(game); r.sheet === 'walk' ? recordWalk() : commit(r); };
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
// `only`: the one runner tapped on the pad diamond. Unset: everyone on base.
let runnerOnly = null;
function paintRunnerSheet(only = runnerOnly) {
  runnerOnly = only;
  const b = L.safeBases(game.bases);
  const on = ['third', 'second', 'first'].filter((k) => b[k] && (!only || k === only));
  const list = $('rn-list');
  if (!on.length) { list.innerHTML = '<p class="confirm-copy">Nobody on base.</p>'; return; }
  list.innerHTML = on.map((k) => {
    const btn = (kind, label) => {
      const why = L.runnerBlocked(game, k, kind);
      return `<button type="button" class="base-btn rn-b${why ? ' blocked' : ''}" data-from="${k}" data-kind="${kind}"${why ? ` aria-disabled="true" data-why="${why}"` : ''}>${label}</button>`;
    };
    return `<div class="rn-row"><b class="rn-who">On ${RN_BASE[k]}</b>` +
      btn('SB', `Stole ${RN_NEXT[k]}`) + btn('CS', 'Caught stealing') + btn('PO', 'Picked off') +
      btn('ADV', `To ${RN_NEXT[k]} · WP/PB`) +
      // The batter got in the way of the throw on this runner.
      btn('BI', 'Batter’s interference') + `</div>`;
  }).join('');
}
function openRunners(only = null) { if (!game) return; paintRunnerSheet(only); openSheet('runners-sheet'); }
$('pad-dia').onclick = (e) => {
  const p = e.target.closest('.pd'); if (!p || !game) return;
  const k = p.dataset.base;
  if (!L.safeBases(game.bases)[k]) return showToast(`Nobody on ${RN_BASE[k]}`, 1500);
  openRunners(k);
};
$('runners-done').onclick = () => closeSheet('runners-sheet');

$('rn-list').onclick = (e) => {
  const o = e.target.closest('.rn-b'); if (!o) return;
  if (o.dataset.why) return showToast(o.dataset.why, 3000);
  const r = o.dataset.kind === 'BI' ? L.onBatterInterference(game, o.dataset.from)
    : L.onRunnerPlay(game, o.dataset.from, o.dataset.kind);
  if (!r) return;
  commit(r);
  showToast(r.text, 1800);
  // Stay open while anyone is left on base: a double steal is two taps.
  // One runner tapped on the diamond: that runner has moved, so close.
  if (runnerOnly || basesEmpty() || r.patch.half) closeSheet('runners-sheet'); else paintRunnerSheet();
};
// ---- Field screen (js/field.js) ------------------------------------------
const teamAbbr = (s) => (s === 'home' ? game.home_abbr || game.home_name || 'HOME' : game.away_abbr || game.away_name || 'AWAY');

$('btn-more').onclick    = () => { if (game) openSheet('more-sheet'); };
$('more-hbp').onclick    = () => { closeSheet('more-sheet'); commit(L.onHitByPitch(game)); };
$('more-ci').onclick     = () => { closeSheet('more-sheet'); commit(L.onCatcherInterference(game)); };
$('more-ibb').onclick    = () => { closeSheet('more-sheet'); commit(L.onIntentionalWalk(game)); };
// A balk with the bases empty is a ball on the batter, so it goes the way BALL does.
$('more-balk').onclick   = () => {
  closeSheet('more-sheet');
  const r = L.onBalk(game);
  if (!r) { showToast('Bases empty — balk counts as a ball', 2200); return $('btn-ball').click(); }
  commit(r); showToast(r.text, 1800);
};
$('more-cancel').onclick = () => closeSheet('more-sheet');
$('btn-foul').onclick    = () => commit(L.onFoul(game));
$('btn-inplay').onclick  = () => openPlaySheet();
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
    sel.innerHTML = '<option value="">— saved teams —</option>' +
      savedTeams.map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join('');
    if (savedTeams.some((t) => t.id === cur)) sel.value = cur;
  }
}
// ---- The team screens -----------------------------------------------------
// A team is a name, an abbreviation, a colour, a logo and a roster. The teams
// table has stored it that way since saved teams existed; the pad was the only
// thing that split identity into Setup and the roster into the Lineup screen,
// two taps apart with nothing saying they were the same thing.
const monogram = (side) => {
  const ab = String(game[side + '_abbr'] || game[side + '_name'] || '').trim();
  return ab ? ab.slice(0, 3).toUpperCase() : '—';
};
const savedTeamFor = (side) => {
  const name = String(game[side + '_name'] || '').trim().toLowerCase();
  return name ? savedTeams.find((t) => String(t.name).trim().toLowerCase() === name) : null;
};
function renderTeamCards() {
  if (!game) return;
  for (const side of ['away', 'home']) {
    const t = L.normalizeTeam((game.lineups || {})[side] || {});
    const players = t.batters.filter((b) => b && (b.num || b.name)).length;
    const missing = L.missingPositions(t).length;
    const saved = savedTeamFor(side);
    const name = game[side + '_name'] || (side === 'away' ? 'Visitor' : 'Home');
    const sub = [
      game[side + '_abbr'] || '—',
      players ? `${players} player${players > 1 ? 's' : ''}` : 'no lineup',
      players ? (missing ? `${9 - missing} of 9 positions` : 'all nine set') : null,
      saved ? 'saved team' : null,
    ].filter(Boolean).join(' · ');
    for (const p of ['card-', '']) {
      const crest = $(p ? 'card-crest-' + side : 'crest-' + side);
      const nm = $(p ? 'card-name-' + side : 'crest-name-' + side);
      const sb = $(p ? 'card-sub-' + side : 'crest-sub-' + side);
      if (!crest) continue;
      crest.textContent = monogram(side);
      crest.style.background = game[side + '_color'] || '#26314a';
      nm.textContent = name;
      sb.textContent = sub;
    }
    $('team-order-' + side).textContent = players ? `${players} in the order` : 'Not set';
    $('team-pos-' + side).textContent = players ? (missing ? `${missing} empty` : '✓ all nine') : '—';
    $('team-del-' + side).disabled = !saved;
    $('team-mine-' + side).checked = !!(saved && saved.mine);
    $('team-mine-row-' + side).hidden = !teamRowFor(side);
  }
}
for (const side of ['away', 'home']) {
  $('team-lineup-' + side).onclick = () => { closeSetup(); openLineupSheet(side); };
  $('team-field-' + side).onclick = () => openField(side);
}
// Swapping sides is one write for the identities and one for the rosters, plus
// the at-bat pointers and pitch counts that belong to them. Mid-game it would
// be a mess, so it asks.
$('team-swap').onclick = async () => {
  if (!game) return;
  if (!confirm('Swap home and away? Names, colours, logos, both rosters and their pitch counts change sides.')) return;
  const lineups = game.lineups || {};
  const st = game.state || {};
  const bi = st.batIdx || {}, pi = st.pitches || {};
  await saveRoster({ ...lineups, away: lineups.home || {}, home: lineups.away || {} }, { allowClear: true });
  await writeField({
    away_name: game.home_name, home_name: game.away_name,
    away_abbr: game.home_abbr, home_abbr: game.away_abbr,
    away_color: game.home_color, home_color: game.away_color,
    away_logo_url: game.home_logo_url, home_logo_url: game.away_logo_url,
    state: { ...st, batIdx: { away: bi.home | 0, home: bi.away | 0 }, pitches: { away: pi.home | 0, home: pi.away | 0 },
      pitchLog: { away: (st.pitchLog || {}).home || {}, home: (st.pitchLog || {}).away || {} } },
  });
  fillSetup();
  renderTeamCards();
  showToast('⇅ Sides swapped');
};

// A named team with somebody in its lineup keeps itself saved: every roster or
// identity change schedules one quiet upsert per side, keyed by name, so next
// game it is one pick in New Game. There is no Save button to forget. The
// default names are not teams yet and are never saved.
const DEFAULT_NAMES = new Set(['', 'visitor', 'home', 'away']);
let teamSaveTimer = null;
function autoSaveTeamsSoon() {
  clearTimeout(teamSaveTimer);
  teamSaveTimer = setTimeout(autoSaveTeams, 2500);
}
function teamRowFor(side) {
  const name = String(game[side + '_name'] || '').trim();
  if (DEFAULT_NAMES.has(name.toLowerCase())) return null;
  return {
    owner_id: user.id, name,
    abbr: game[side + '_abbr'] || null,
    color: game[side + '_color'] || null,
    logo_url: game[side + '_logo_url'] || null,
    roster: (game.lineups || {})[side] || {},
  };
}
async function autoSaveTeams({ force = null } = {}) {
  if (!game || !user) return;
  let saved = 0;
  for (const side of ['away', 'home']) {
    const row = teamRowFor(side); if (!row) continue;
    const has = teamOf(side).batters.some((b) => b && (b.num || b.name));
    if (!has && side !== force) continue;
    const prev = savedTeamFor(side);
    const same = prev && prev.abbr === row.abbr && prev.color === row.color && (prev.logo_url || null) === row.logo_url
      && JSON.stringify(prev.roster || {}) === JSON.stringify(row.roster);
    if (same) continue;
    const { error } = await db.from('teams').upsert({ ...row, updated_at: new Date().toISOString() }, { onConflict: 'owner_id,name' });
    if (error) { console.warn('team auto-save failed', error.message); continue; }
    saved++;
  }
  if (saved) { await loadTeams(); renderTeamCards(); }
}
// A game just made in New Game: load the saved lineups it was made with, then
// open the jersey keypad on a team that still has nobody (the opponent first).
async function seedNewGame(picked) {
  if (!game) return;
  const lineups = { ...(game.lineups || {}) };
  let loaded = false;
  for (const s of ['away', 'home']) {
    const t = picked[s];
    if (t && t.roster && ((t.roster.batters || []).some((b) => b && (b.num || b.name)))) { lineups[s] = L.normalizeTeam(t.roster); loaded = true; }
  }
  if (loaded) await saveRoster(lineups, { allowClear: true });
  if ((game.sport || 'baseball') !== 'baseball') return;
  const empty = ['away', 'home'].filter((s) => !teamOf(s).batters.some((b) => b && (b.num || b.name)));
  if (!empty.length) return;
  const first = empty.find((s) => !(picked[s] && picked[s].mine)) || empty[0];
  openLineupSheet(first);
  openQuick('keys');
}
// ★ My team: a flag on the saved team, set here and read by New Game.
async function setMine(side, on) {
  if (!game) return;
  if (!teamRowFor(side)) { renderTeamCards(); return showToast('Name the team first'); }
  await autoSaveTeams({ force: side });
  const t = savedTeamFor(side);
  if (!t) { renderTeamCards(); return showToast('⚠️ Could not save the team'); }
  const { error } = await db.from('teams').update({ mine: on }).eq('id', t.id);
  if (error) { renderTeamCards(); return showToast(`⚠️ ${error.message}`, 3000); }
  await loadTeams();
  renderTeamCards();
  renderLineups();
  showToast(on ? `★ ${t.name} is your team` : `${t.name} is no longer marked as yours`);
}
// Is this side one of your own teams? The checklist asks for positions only
// there when one of the two is yours; an opponent's are optional.
const isMine = (side) => !!(game && savedTeamFor(side) && savedTeamFor(side).mine);
const anyMine = () => isMine('away') || isMine('home');
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
  fillSetup();
  renderGame();
  renderTeamCards();
  showToast(`📥 Loaded "${t.name}"`);
}
async function deleteTeam(side) {
  // The team this screen is about, not whatever is showing in a picker — the
  // picker is for swapping one in, and deleting the thing you were about to
  // load is not what the row says.
  const t = savedTeamFor(side);
  if (!t) return showToast('This team is not saved yet');
  if (!confirm(`Delete saved team "${t.name}"? This game keeps its teams and lineups; only the saved copy goes.`)) return;
  const { error } = await db.from('teams').delete().eq('id', t.id);
  if (error) return alert(error.message);
  await loadTeams();
  renderTeamCards();
  showToast('Saved team deleted');
}
for (const side of ['away', 'home']) {
  $('team-sel-' + side).addEventListener('change', (e) => { if (e.target.value) loadTeamInto(side, e.target.value); });
  $('team-mine-' + side).onchange = (e) => setMine(side, e.target.checked);
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
  lineup: 'Batting order', defense: 'Defense', matchup: 'Matchup', sponsor: 'Sponsor',
  final: 'Final', starting: 'Starting Soon', midinning: 'Mid-Inning', finalfull: 'Final (full)', paused: 'Paused',
};
const cardLabel = (type) => CARD_LABEL[type] || type;
async function showCard(type) {
  const meta = {};
  const text = $('card-text').value.trim();
  if (text) { meta.text = text; $('card-text').value = ''; }   // spent on this card, not the next one too
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
$('onair-open').onclick = () => { renderOnAir(); loadTickerDraft(); loadPausedDraft(); openSheet('onair-sheet'); };
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

// Game paused. Like the ticker, the controls are a draft until Show / Update.
// The countdown is stored as a restart time (meta.until), so the overlay and
// the pad agree on it however late either one loads. While the card is up the
// minutes field reads the time left; editing it and tapping Update moves the
// restart time. The card keeps its nonce across updates, so the overlay
// refreshes it in place instead of replaying the entrance.
const PZ_NO_CLOCK = new Set(['suspended', 'called']);
let pzReason = 'lightning';
let pzLoaded = null;   // minutes-left the field was filled with, so Update without an edit keeps the clock
const pausedUp = () => !!(game && game.card && game.card.type === 'paused');
const pzMins = () => Math.max(0, Math.min(240, parseInt($('pz-mins').value, 10) || 0));
function setPzReason(r, fillMins) {
  pzReason = r;
  document.querySelectorAll('.pz-r').forEach((b) => {
    const on = b.dataset.reason === r;
    b.setAttribute('aria-pressed', String(on));
    if (on && fillMins) $('pz-mins').value = b.dataset.mins;
  });
  const clockless = PZ_NO_CLOCK.has(r);
  $('pz-timer').hidden = clockless;
  $('pz-note').textContent = clockless
    ? (r === 'called' ? 'No countdown. End the game from the Situation sheet when you are ready.' : 'No countdown.')
    : '0 = no countdown. Lightning: restart at every new strike.';
  renderPaused();
}
function pzLeftMins() {
  const u = game.card && game.card.meta && game.card.meta.until;
  return u ? Math.max(0, Math.ceil((new Date(u).getTime() - serverNow()) / 60000)) : 0;
}
function loadPausedDraft() {
  if (!pausedUp()) return;
  const m = game.card.meta || {};
  setPzReason(m.reason || 'weather', false);
  $('pz-mins').value = pzLeftMins();
  pzLoaded = pzMins();
}
function renderPaused() {
  if (!game) return;
  const up = pausedUp();
  const m = (up && game.card.meta) || {};
  const at = m.until ? new Date(m.until).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';
  $('pz-state').textContent = up ? (at && !PZ_NO_CLOCK.has(m.reason) ? `· on air · restart ${at}` : '· on air') : 'off';
  $('pz-state').classList.toggle('on', up);
  $('pz-show').textContent = up ? 'Update' : 'Show';
  $('pz-show').classList.toggle('live', up);
  $('pz-hide').hidden = !up;
  $('pz-restart').hidden = !(up && pzReason === 'lightning');
  renderDelayState();
}
// The pause card and the ticker share one folded section; it says, and opens
// to show, whichever of them is on air.
function renderDelayState() {
  const on = [pausedUp() && 'pause card', tickerUp() && 'ticker'].filter(Boolean);
  $('air-delay-state').textContent = on.length ? `· ${on.join(' + ')} on air` : '';
  $('air-delay-state').classList.toggle('on', on.length > 0);
  if (on.length) $('air-delay').open = true;
}
function pausedMeta(mins) {
  const meta = { reason: pzReason };
  if (!PZ_NO_CLOCK.has(pzReason) && mins > 0) meta.until = new Date(serverNow() + mins * 60000).toISOString();
  return meta;
}
async function showPaused() {
  haptic();
  const was = pausedUp();
  const nonce = was ? game.card.nonce : nextNonce();
  const prev = was ? game.card.meta || {} : {};
  const meta = pausedMeta(pzMins());
  // Only the reason changed: the countdown carries on from where it was.
  if (was && pzMins() === pzLoaded && prev.until && !PZ_NO_CLOCK.has(pzReason)) meta.until = prev.until;
  if (prev.strike) meta.strike = prev.strike;   // an Update is not a new strike
  await writeField({ card: { type: 'paused', meta, nonce } });
  pzLoaded = null;
  showToast(was ? '⏸ Pause card updated' : '⏸ Game paused on air');
  closeSheet('onair-sheet');
}
$('pz-show').onclick = showPaused;
$('pz-hide').onclick = () => { haptic(); clearCard(); closeSheet('onair-sheet'); };
// A new strike: straight back to 30, on air at once — no Update needed.
$('pz-restart').onclick = async () => {
  if (!pausedUp()) return;
  haptic();
  $('pz-mins').value = 30;
  // `strike` tells the overlay to throw a bolt and roll thunder for it.
  await writeField({ card: { ...game.card, meta: { ...pausedMeta(30), reason: 'lightning', strike: Date.now() } } });
  showToast('⚡ Countdown restarted — 30:00');
};
$('pz-minus').onclick = () => { $('pz-mins').value = Math.max(0, pzMins() - 5); };
$('pz-plus').onclick = () => { $('pz-mins').value = Math.min(240, pzMins() + 5); };
document.querySelectorAll('.pz-r').forEach((b) => { b.onclick = () => setPzReason(b.dataset.reason, true); });

// Announcement ticker. The box is a draft: it is filled from what is on air
// when the sheet opens, and nothing reaches the stream until Show / Update.
// Taking it down keeps the text, so the same notice can go back up.
let tkTone = 'info';
const tickerUp = () => !!(game && game.ticker && game.ticker.on);
function setTkTone(t) {
  tkTone = t === 'alert' ? 'alert' : 'info';
  $('tk-tone-info').setAttribute('aria-pressed', String(tkTone === 'info'));
  $('tk-tone-alert').setAttribute('aria-pressed', String(tkTone === 'alert'));
}
function loadTickerDraft() {
  const t = game && game.ticker;
  if (t && t.text) { $('tk-text').value = t.text; setTkTone(t.tone); }
}
function renderTicker() {
  if (!game) return;
  const up = tickerUp();
  $('tk-chip').hidden = !up;
  $('tk-state').textContent = up ? '· on air' : 'off';
  $('tk-state').classList.toggle('on', up);
  $('tk-show').textContent = up ? 'Update' : 'Show';
  $('tk-show').classList.toggle('live', up);
  $('tk-hide').hidden = !up;
  renderDelayState();
}
async function showTicker() {
  const text = $('tk-text').value.replace(/\s+/g, ' ').trim();
  if (!text) { showToast('Type a message first'); $('tk-text').focus(); return; }
  haptic();
  const was = tickerUp();
  await writeField({ ticker: { text, tone: tkTone, on: true, nonce: nextNonce() } });
  showToast(was ? '📣 Ticker updated' : '📣 Ticker on air');
  closeSheet('onair-sheet');
}
async function hideTicker() {
  if (!game || !game.ticker) return;
  haptic();
  await writeField({ ticker: { ...game.ticker, on: false } });
  showToast('Ticker off air');
}
$('tk-show').onclick = showTicker;
$('tk-hide').onclick = () => { hideTicker(); closeSheet('onair-sheet'); };
$('tk-chip-x').onclick = hideTicker;
$('tk-tone-info').onclick = () => setTkTone('info');
$('tk-tone-alert').onclick = () => setTkTone('alert');
document.querySelectorAll('.tk-pre').forEach((b) => {
  b.onclick = () => { $('tk-text').value = b.dataset.text; setTkTone(b.dataset.tone); };
});

// What you'd most likely raise at this point in the game. Baseball only — it is
// the sport where the pad knows enough about the moment to guess. A clean slate
// (no outs, no count, bases empty) is the top of a half: the change just happened.
function airSuggestions(g) {
  const b = L.safeBases(g.bases);
  const clean = !(g.outs | 0) && !(g.balls | 0) && !(g.strikes | 0) && !b.first && !b.second && !b.third;
  if (clean && (g.inning | 0) <= 1 && g.half !== 'bottom') return { why: 'before first pitch', ids: ['starting', 'matchup', 'lineup'] };
  // Due Up is not offered: since v3.96 it rides on Mid-Inning, which is the
  // moment anyone wants it, so it no longer needs a card of its own.
  if (clean) return { why: 'start of the half', ids: ['midinning', 'defense', 'lineup'] };
  if (!(g.balls | 0) && !(g.strikes | 0)) return { why: 'new batter', ids: ['lineup', 'defense', 'sponsor'] };
  return { why: 'mid at-bat', ids: ['defense', 'lineup', 'sponsor'] };
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
$('fx-walkoff').onclick = () => fireAnim('walkoff');
$('fx-rally').onclick   = () => writeField({ rally_mode: !game.rally_mode });
function renderRally() {
  const b = $('fx-rally');
  b.textContent = `Rally: ${game.rally_mode ? 'ON' : 'OFF'}`;
  b.classList.toggle('on', !!game.rally_mode);
}

// ---- OBS -------------------------------------------------------------------
// Stream, record, scenes and replay clips live in js/obs-pad.js.
const { OBS_TIER, CLIP_DELAY_MS, obsLevel, renderObs, renderScenes, renderReplay, resetReplayUi, disarmObs, saveReplay } =
  createObs({ $, db, haptic, nextNonce, showToast, openSheet, closeSheet, writeField, game: () => game });

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
  if (back && back !== document.body && document.contains(back)) back.focus({ preventScroll: true });
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
for (const id of ['sit-sheet', 'onair-sheet', 'play-sheet', 'lineup-sheet', 'k3-sheet', 'more-sheet', 'runners-sheet', 'newgame-sheet', 'cam-sheet']) {
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

// ---- Setup screen (js/setup.js) --------------------------------------------
$('delete-game').onclick = async () => {
  if (!game) return;
  if (!confirm(`Delete "${game.away_name} @ ${game.home_name}"? This permanently removes the game and cannot be undone.`)) return;
  const id = game.id;
  closeSetup();
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
    bases: { first: false, second: false, third: false },
    state: { ...(game.state || {}), batIdx: { away: 0, home: 0 }, pitches: { away: 0, home: 0 }, pitchLog: {} },
  });
  else if (SPORTS[sport]) patch.state = SPORTS[sport].init();
  await db.from('events').delete().eq('game_id', game.id); // wipe undo history
  await db.from('plays').delete().eq('game_id', game.id);  // and the recap's play-by-play
  closeSetup();
  await writeField(patch);
  showToast('↺ Game reset');
};

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
// Demo scores a fake game, so it never runs on a real one: it makes a practice
// game with this game's look, opens it (the overlay link follows), and plays
// there. Delete the practice game from the list when you are done with it.
$('demo-btn').onclick = async () => {
  if (demoTimer) { clearInterval(demoTimer); demoTimer = null; return paintDemoBtn(); }
  if (!(game.state && game.state.practice)) {
    if (!confirm('Demo plays a fake game. It runs in a new practice game, so this one stays clean — and the overlay link switches to the practice game while you watch.\n\nStart it?')) return;
    const row = { status: 'setup', sport: game.sport || 'baseball', away_name: 'Practice', away_abbr: 'PRAC', home_name: 'Demo', home_abbr: 'DEMO',
      state: { ...(sportState(game.sport || 'baseball') || {}), practice: true } };
    for (const k of CARRY) if (game[k] != null) row[k] = game[k];
    const { data, error } = await db.from('games').insert(row).select().single();
    if (error) return showToast(`⚠️ ${error.message}`, 3000);
    closeSetup();
    await openGame(data.id);
  }
  demoTimer = setInterval(demoStep, 1800);
  paintDemoBtn();
};
function demoStep() {
  if (!game) return stopDemo(); // game closed under us
  const sport = game.sport || 'baseball';
  if (SPORTS[sport]) return SPORTS[sport].demo(game);
  const r = Math.random();
  if (r < 0.10) return fireAnim(['homerun', 'strikeout', 'doubleplay', 'webgem', 'stolenbase'][Math.floor(Math.random() * 5)]);
  if (r < 0.34) { // ball, but auto-resolve a walk instead of opening the sheet
    if ((game.balls | 0) >= 3) recordWalk();
    else commit({ type: 'ball', patch: L.withPitch(game, { balls: (game.balls | 0) + 1 }) });
    return;
  }
  if (r < 0.54) return commit(L.onStrike(game));
  if (r < 0.66) return commit(L.onFoul(game));
  if (r < 0.80) return commit(L.onOut(game));
  if (r < 0.90) return commit(L.onRun(game));
  return commit(L.onAdvance(game));
}

$('preview-fx-btn').onclick = async () => {
  const sp = SPORTS[game.sport];
  const types = sp ? sp.fx : ['run', 'homerun', 'strikeout', 'doubleplay', 'webgem', 'stolenbase', 'walkoff', 'charge'];
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
  if (Object.keys(patch).some((k) => /^(away|home)_(name|abbr|color|logo_url)$/.test(k))) autoSaveTeamsSoon();
}
$('theme-sel').addEventListener('change', (e) => writeField({ theme: e.target.value }));
document.querySelectorAll('#pos-grid button').forEach((b) => { b.onclick = () => writeField({ scorebug_position: b.dataset.pos }); });
$('scale-sel').addEventListener('input', (e) => { $('scale-val').textContent = (+e.target.value).toFixed(2) + '×'; });
$('scale-sel').addEventListener('change', (e) => writeField({ scorebug_scale: +e.target.value }));
const POS_ALIAS = { 'bottom-bar': 'bottom-center', 'top-bar': 'top-center' };
const POS_LABEL = { 'top-left': 'Top-left', 'top-center': 'Top-centre', 'top-right': 'Top-right',
  'mid-left': 'Middle-left', 'mid-center': 'Centre', 'mid-right': 'Middle-right',
  'bottom-left': 'Bottom-left', 'bottom-center': 'Bottom-centre', 'bottom-right': 'Bottom-right' };
// A theme no longer in the picker paints as Midnight, so the picker says so.
function renderLook() {
  const sel = $('theme-sel');
  sel.value = game.theme || 'nightgame';
  if (!sel.value) sel.value = 'nightgame';
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

// ---- Custom colours (the `look` overrides, applied on the Custom theme only) --
const lookOf = () => game.look || {};
async function writeLook(patch) {
  const look = Object.fromEntries(Object.entries({ ...lookOf(), ...patch }).filter(([k]) => LOOK_KEYS.includes(k)));
  for (const k of Object.keys(look)) if (look[k] === '' || look[k] === false || look[k] == null) delete look[k];
  await writeField({ look });
}
// The custom editor is eight keys. Older looks carried more (row fills, bars,
// borders…); the first edit here drops them, so what the overlay paints is
// always what this screen shows.
const LOOK_KEYS = ['accent', 'font', 'radius', 'teamFill', 'panelType', 'panelC1', 'panelC2', 'text'];
for (const [id, key] of [
  ['cust-accent', 'accent'], ['cust-font', 'font'], ['cust-radius', 'radius'], ['cust-text', 'text'],
  ['cust-paneltype', 'panelType'], ['cust-panelc1', 'panelC1'], ['cust-panelc2', 'panelC2'], ['cust-teamfill', 'teamFill'],
]) $(id).addEventListener('change', (e) => writeLook({ [key]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
$('cust-reset').onclick = async () => {
  await writeField({ look: {} });
  showToast('Custom colours reset');
};
function renderCustomize() {
  const L = lookOf();
  $('cust-accent').value = L.accent || '#e8b23a';
  $('cust-font').value = L.font || '';
  $('cust-radius').value = L.radius != null ? String(L.radius) : '';
  $('cust-teamfill').checked = !!L.teamFill;
  $('cust-paneltype').value = L.panelType || '';
  $('cust-panelc1').value = L.panelC1 || '#1b2a41';
  $('cust-panelc2').value = L.panelC2 || '#0e1421';
  $('cust-text').value = L.text || '#f4f7fb';
  $('sv-custom').hidden = (game.theme || 'nightgame') !== 'custom';
}

// ---- Sound settings (written to game.audio / game.sound_pack, synced to overlay)
$('fx-charge').onclick = () => fireAnim('charge');

const audioOf = () => game.audio || { muted: false, master: 0.8 };
async function writeAudio(patch) {
  const cur = audioOf();
  await writeField({ audio: { muted: !!cur.muted, master: cur.master ?? 0.8, ...patch } });
}
$('mute-btn').onclick = () => writeAudio({ muted: !audioOf().muted });
$('vol-master').addEventListener('change', (e) => writeAudio({ master: +e.target.value }));
$('sound-pack').addEventListener('change', (e) => writeField({ sound_pack: e.target.value }));

function renderAudio() {
  const a = audioOf();
  $('vol-master').value = a.master ?? 0.8;
  $('mute-btn').classList.toggle('on', !!a.muted);
  $('mute-btn').textContent = a.muted ? 'Muted' : 'Mute';
  $('sound-pack').value = game.sound_pack || 'bigleague';
  if (!$('sound-pack').value) $('sound-pack').value = 'bigleague';   // a retired pack plays as Big League
}

// Ball in play ---------------------------------------------------------------
// IN PLAY opens on the result: a hit, reached on an error or fielder's choice,
// or the kind of out. Outs, errors and fielder's choices then ask who fielded it
// (SS on a ground out records 6-3). With runners on, the last step asks where
// everyone finished, pre-filled with the likely answer (L.playDefaults), so the
// usual play is one more tap on Record. Nobody on: no runner step at all.
// A dropped third strike starts on the runner step from the Strike three sheet.
const NEEDS_FIELDER = new Set(['GB', 'FB', 'LD', 'PU', 'SF', 'SAC', 'DP', 'FC', 'E']);
// Where each fielder stands on the drawn field, as % of its box.
const FIELD_SPOT = { LF: [18, 24], CF: [50, 11], RF: [82, 24], SS: [33, 45], '2B': [67, 43],
  '3B': [15, 64], '1B': [85, 64], P: [50, 63], C: [50, 90] };
const RS_COLS = [['out', 'Out'], [1, '1st'], [2, '2nd'], [3, '3rd'], [4, 'Home']];
const RS_START = { third: 3, second: 2, first: 1, batter: 0 };
const BASE_NAME = { first: '1st', second: '2nd', third: '3rd' };
let playType = null;
let play = null;   // { kind, pos, dest, from: 'result' | 'pick' | 'hit' }

const basesEmpty = () => { const b = L.safeBases(game.bases); return !b.first && !b.second && !b.third; };
// "M. Reyes" fits a fielder tile; a player with only a number reads as "#12".
const shortName = (p) => {
  if (!p) return '';
  const parts = String(p.name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return p.num ? `#${p.num}` : '';
  return parts.length > 1 ? `${parts[0][0]}. ${parts[parts.length - 1]}` : parts[0];
};
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

function showPlayStep(step) {
  $('play-result').hidden = step !== 'result';
  $('play-pick').hidden = step !== 'pick';
  $('play-runners').hidden = step !== 'runners';
}
function openPlaySheet() {
  if (!game) return;
  playType = null; play = null;
  paintPlayResult();
  showPlayStep('result');
  openSheet('play-sheet');
}
function paintPlayResult() {
  const batter = L.currentBatter(game);
  $('play-sub').textContent = batter ? `${shortName(batter)} · what happened?` : 'what happened?';
  // Only with somebody on: with the bases empty there is no runner to be out.
  $('play-to-runners').hidden = basesEmpty();
  // Not `disabled`: a disabled button swallows the tap, and the tap is when you
  // want to hear why a double play isn't possible with nobody on.
  $('play-result').querySelectorAll('.pr-b').forEach((btn) => {
    const why = L.playBlocked(game, btn.dataset.kind);
    btn.classList.toggle('blocked', !!why);
    btn.setAttribute('aria-disabled', String(!!why));
  });
}
// The result is picked. Hits go straight on; everything else asks the fielder.
function pickResult(kind) {
  if (!game) return;
  const why = L.playBlocked(game, kind);
  if (why) return showToast(why, 3200);
  if (kind === 'HR') {
    if (!$('play-sheet').hidden) closeSheet('play-sheet');
    // Everyone on base scores with the batter — the rulebook leaves nothing to
    // confirm. A run that should not count is an Undo or a Situation fix.
    const runs = L.computeHomeRun(game.bases).runs;
    return commit({ type: 'homerun', patch: L.homeRunPatch(game, runs),
      payload: { runs, play: L.playNote(game, 'HR', { runs }) }, anim: 'homerun' });
  }
  if (!NEEDS_FIELDER.has(kind)) return startPlay(kind, null, 'result');
  playType = kind;
  paintPlayPick();
  showPlayStep('pick');
  if ($('play-sheet').hidden) openSheet('play-sheet');
}
$('play-result').onclick = (e) => {
  const b = e.target.closest('.pr-b'); if (b) pickResult(b.dataset.kind);
};
function paintPlayPick() {
  const batter = L.currentBatter(game);
  const label = L.PLAY_LABEL[playType];
  $('play-sub').textContent = batter ? `${shortName(batter)} · ${label.toLowerCase()}` : label;
  $('play-will').textContent = playType === 'E'
    ? 'Tap the fielder charged with the error (SS → E6).'
    : `Tap who fielded it${playType === 'GB' ? ' (SS → 6-3)' : playType === 'FB' ? ' (CF → F8)' : ''}.`;
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
$('play-field').onclick = (e) => {
  const f = e.target.closest('.fielder'); if (!f || !playType) return;
  startPlay(playType, f.dataset.pos, 'pick');
};
$('pick-back').onclick = () => { playType = null; paintPlayResult(); showPlayStep('result'); };
$('play-just-out').onclick = () => { closeSheet('play-sheet'); commit(L.onOut(game)); };
// Straight across to the runner plays: an out on the bases leaves the count and
// the batter alone, which is exactly what recording it here would not do.
$('play-to-runners').onclick = () => {
  closeSheet('play-sheet');
  if (!game) return;
  openRunners();
};
$('play-cancel').onclick = () => closeSheet('play-sheet');

function startPlay(kind, pos, from) {
  if (!game) return;
  play = { kind, pos, dest: L.playDefaults(game, kind), from };
  // Nobody on base: nothing to ask. An error or a dropped third still asks,
  // because the batter may not have stopped at first.
  if (basesEmpty() && kind !== 'E' && kind !== 'K3') return recordPlay();
  showPlayStep('runners');
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
  if (play && play.from === 'pick') { play = null; paintPlayPick(); showPlayStep('pick'); return; }
  if (play && play.from === 'result') { play = null; paintPlayResult(); showPlayStep('result'); return; }
  play = null; closeSheet('play-sheet');
};
$('rs-record').onclick = () => recordPlay();
function recordPlay() {
  const r = play && L.onPlay(game, play);
  if (!r) return;
  play = null; playType = null;
  closeSheet('play-sheet');
  commit(r);
  showToast(r.payload.runs ? `${r.text} · ${plural(r.payload.runs, 'run scores', 'runs score')}` : r.text);
}

// Home-run sheet ------------------------------------------------------------
// Batter + every runner scores and the bases clear; the sheet just confirms the
// run total (pre-filled from who's on base) before committing + firing the anim.

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
    putOnLink(game.id, true);
    return commit({ type: 'reopen_game', patch: { status: 'live' } });
  }
  if (!confirm(`End the game at ${game.away_abbr || 'AWAY'} ${game.away_score | 0} – ${game.home_abbr || 'HOME'} ${game.home_score | 0}?\n\nIt shows as Final in your games and on the recap page. Undo or Reopen puts it back.`)) return;
  commit({ type: 'end_game', patch: { status: 'final', clock_running: false } });
  // The stream's last word: the Final screen goes up with the result.
  writeField({ card: { type: 'finalfull', meta: {}, nonce: nextNonce() } });
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
  el.classList.toggle('optional', !!miss.length && anyMine() && !isMine(side));
  if (!miss.length) { el.textContent = '✓ All nine positions filled · Field ›'; return; }
  // The other team's defense only feeds the Defense card; it is not a to-do.
  if (anyMine() && !isMine(side)) { el.textContent = `Positions optional · ${9 - miss.length} of 9 set · Field ›`; return; }
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
  closeQuick();
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
$('lu-tab-away').onclick = () => { luSide = 'away'; showLineupSide(); paintQuick(); };
$('lu-tab-home').onclick = () => { luSide = 'home'; showLineupSide(); paintQuick(); };

// Quick entry. The keypad puts each number into the next open slot of the team
// on screen; backspace with nothing typed takes the last one back to edit. The
// paste box reads one player per line (L.parseRoster) and replaces the order.
let lqTyped = '';
function openQuick(mode) {
  lqTyped = '';
  $('lq-keys').hidden = mode !== 'keys';
  $('lq-paste').hidden = mode !== 'paste';
  paintQuick();
  if (mode === 'paste') $('lq-text').focus();
}
const closeQuick = () => { $('lq-keys').hidden = true; $('lq-paste').hidden = true; };
function paintQuick() {
  if (!game || $('lq-keys').hidden) return;
  const bs = teamOf(luSide).batters;
  const open = bs.findIndex((b) => !(b && (b.num || b.name)));
  $('lq-typed').textContent = lqTyped || '–';
  $('lq-hint').textContent = `Batter ${(open < 0 ? bs.length : open) + 1} · the number on their back`;
}
$('lq-keys-btn').onclick = () => openQuick($('lq-keys').hidden ? 'keys' : null);
$('lq-paste-btn').onclick = () => openQuick($('lq-paste').hidden ? 'paste' : null);
$('lq-keys-done').onclick = closeQuick;
$('lq-paste-cancel').onclick = () => { $('lq-text').value = ''; closeQuick(); };
$('lq-pad').onclick = (e) => {
  const b = e.target.closest('button[data-k]'); if (!b || !game) return;
  haptic();
  const k = b.dataset.k, lineups = game.lineups || {};
  if (k === 'next') {
    if (!lqTyped) return;
    const r = L.appendNumber(lineups[luSide] || {}, lqTyped);
    lqTyped = '';
    saveRoster({ ...lineups, [luSide]: r.team });
    renderLineups();
  } else if (k === 'del') {
    if (lqTyped) lqTyped = lqTyped.slice(0, -1);
    else {
      const r = L.popNumber(lineups[luSide] || {});
      if (r.num) { lqTyped = r.num; saveRoster({ ...lineups, [luSide]: r.team }, { allowClear: true }); renderLineups(); }
    }
  } else if (lqTyped.length < 2) lqTyped += k;
  paintQuick();
};
$('lq-text').addEventListener('input', () => {
  const list = L.parseRoster($('lq-text').value);
  const pos = list.filter((p) => p.pos).length;
  const first = list.slice(0, 3).map((p) => (p.num ? '#' + p.num + (p.name ? ' ' : '') : '') + p.name).join(', ');
  $('lq-preview').textContent = list.length
    ? `${list.length} player${list.length > 1 ? 's' : ''}${pos ? ` · ${pos} with positions` : ''}: ${first}${list.length > 3 ? '…' : ''}`
    : 'Number, name and position, in any order you have them.';
});
$('lq-paste-use').onclick = async () => {
  if (!game) return;
  const list = L.parseRoster($('lq-text').value);
  if (!list.length) return showToast('Paste one player per line', 2400);
  const had = teamOf(luSide).batters.some((b) => b && (b.num || b.name));
  if (had && !confirm(`Replace the ${luSide} lineup with these ${list.length} players?`)) return;
  await saveRoster({ ...(game.lineups || {}), [luSide]: L.teamFromList(list) }, { allowClear: true });
  // A new order starts at its top — unless the game is already under way.
  if (!gameStarted()) {
    const st = game.state || {};
    writeField({ state: { ...st, batIdx: { ...(st.batIdx || {}), [luSide]: 0 } } });
  }
  $('lq-text').value = '';
  closeQuick();
  renderLineups();
  showToast(`📋 ${list.length} players in the order`);
};
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

// Walk ----------------------------------------------------------------------
// Ball four puts the batter on first and pushes the forced runners, in one tap.
// A runner who took an extra base on it is a fix in the Situation sheet, which
// the toast opens.
function recordWalk() {
  const w = L.computeWalk(game.bases);
  // anim: the WALK reveal fires automatically, like run/strikeout do.
  commit({ type: 'walk', patch: L.endPA(game, { balls: 0, strikes: 0, bases: w.bases, ...L.runsPatch(game, w.runs) }),
    payload: { runs: w.runs, bases: w.bases, play: L.playNote(game, 'BB', { runs: w.runs }) }, anim: 'webgem' });
  showToast(w.runs ? `Walk · ${w.runs} run${w.runs > 1 ? 's' : ''} forced in` : 'Walk', 4000,
    { label: 'Fix runners', run: () => openSheet('sit-sheet') });
}

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
  const awayLab = g.away_abbr || g.away_name || 'VIS';
  const homeLab = g.home_abbr || g.home_name || 'HOME';
  $('g-away-name').textContent = awayLab;
  $('g-home-name').textContent = homeLab;
  // Longer than an abbreviation: the score digits give way rather than the name.
  document.querySelector('.gm-head').classList.toggle('longnames', Math.max(awayLab.length, homeLab.length) > 5);
  $('g-away-runs').textContent = g.away_score;
  $('g-home-runs').textContent = g.home_score;
  ctrlScorePop('away', g.away_score, 'g-away-runs');
  ctrlScorePop('home', g.home_score, 'g-home-runs');
  renderScoreLabel(g);
  if (SPORTS[sport]) SPORTS[sport].render(g);
  else renderBaseballControl();
  renderClock();   // already guards its own DOM writes, and ticks at 4Hz anyway
  // The on-air chip is part of the shell for every sport; the suggestions read the at-bat.
  paintIf('onair', [g.card, g.half, g.inning, g.outs, g.balls, g.strikes, g.bases, g.away_abbr, g.home_abbr, sport], renderOnAir);
  // ---- the drawer: only what changed ----
  paintIf('ticker', [g.ticker], renderTicker);
  paintIf('paused', [g.card], renderPaused);
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
  // With one of your teams in the game, its defense is the step; an opponent's is optional.
  const defenseSides = anyMine() ? ['away', 'home'].filter(isMine) : ['away', 'home'];
  const hasDefense = defenseSides.some((s) => Object.keys(((game.lineups || {})[s] || {}).positions || {}).length > 0);
  return sport === 'baseball'
    ? [['teams', !!teams], ['lineups', hasLineup], ['defense', hasDefense], ['overlay', overlayCopied]]
    : [['teams', !!teams], ['overlay', overlayCopied]];
}
const setupAllDone = () => setupSteps().every(([, ok]) => ok);
// Any pitch, out, run or half-inning on the board means first pitch has been thrown.
const gameStarted = () => !!game && ((game.home_score | 0) + (game.away_score | 0) + (game.balls | 0) + (game.strikes | 0)
  + (game.outs | 0) + L.pitchCount(game) > 0 || (game.inning | 0) > 1 || game.half === 'bottom');
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

$('setup-guide').addEventListener('click', (e) => {
  const b = e.target.closest('.sg-go'); if (!b) return;
  const go = b.dataset.go;
  if (go === 'teams') { openSetup(); svGo('teams'); }
  else if (go === 'lineups') openLineupSheet(L.battingSide(game));
  else if (go === 'defense') openField();
  // Opens the link; the step ticks when Copy or Open is actually pressed.
  else if (go === 'overlay') { openSetup(); svGo('link'); }
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
  for (const [n, k] of [[1, 'first'], [2, 'second'], [3, 'third']]) {
    const pd = $('pd-' + n);
    pd.classList.toggle('on', b[k]);
    pd.querySelector('.vh').textContent = b[k] ? `Runner on ${RN_BASE[k]}` : `${RN_BASE[k]} base, empty`;
  }
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
  $('g-away-name').classList.toggle('bat', game.half === 'top');
  $('g-home-name').classList.toggle('bat', game.half === 'bottom');
  renderBatterLine();
  $('pc-val').textContent = L.pitchCount(game);
  renderAdjust();
  $('base-1').classList.toggle('on', b.first);
  $('base-2').classList.toggle('on', b.second);
  $('base-3').classList.toggle('on', b.third);
  const on = [b.first && '1st', b.second && '2nd', b.third && '3rd'].filter(Boolean);
  // A fix, not a play: the pad's diamond is where a steal or a pickoff is scored.
  $('bases-note').textContent = `${on.length ? `${on.join(' and ')} occupied.` : 'Nobody on.'} ` +
    'Tap a base to put a runner on or take one off — a fix, not a play. A steal or a pickoff is the runner on the pad.';
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

$('rotate-url-btn').onclick = async () => {
  if (!confirm('Rotate the overlay link?\n\nEvery link you have shared stops working, including the one in OBS — you will need to paste the new one into your Browser Source.')) return;
  const { data, error } = await db.rpc('rotate_channel_token');
  if (error) return showToast(`⚠️ ${error.message}`, 3000);
  channelToken = data;
  const t = await db.rpc('overlay_token', { p_game: game.id });   // every game's key turned too
  overlayToken = t.data || null;
  overlayCopied = false; renderSetupGuide();
  $('overlay-url').value = overlayUrl();
  showToast('🔑 New link — update OBS');
};
$('copy-recap-btn').onclick = async () => {
  try { await navigator.clipboard.writeText($('recap-url').value); showToast('📋 Recap link copied'); }
  catch { $('recap-url').select(); showToast('Press ⌘/Ctrl+C to copy'); }
};
$('copy-url-btn').onclick = async () => {
  try { await navigator.clipboard.writeText($('overlay-url').value); $('copy-url-btn').textContent = 'Copied!'; showToast('🔗 Overlay URL copied'); setTimeout(() => ($('copy-url-btn').textContent = 'Copy'), 1200); } catch {}
  markLinkCopied(); renderSetupGuide();
};
$('open-url-btn').onclick = () => { const u = $('overlay-url').value; if (u) window.open(u, '_blank', 'noopener'); markLinkCopied(); renderSetupGuide(); };
$('link-here').onclick = () => game && putOnLink(game.id, true);

// Keyboard shortcuts (desktop control): ignore while typing in a field.
document.addEventListener('keydown', (e) => {
  if (views.game.hidden || !game) return;
  // A sheet owns the screen and its own Escape. Scoring keys used to fire
  // straight through the scrim, which put real plays on the board behind a
  // dialog you were looking at. defaultPrevented covers the same key being
  // spent by the sheet handler above — one Escape should close one thing.
  if (sheetOpen() || e.defaultPrevented) return;
  // Setup and Field are full screens, not sheets, but the pad is just as
  // hidden behind them: a key must not score a play you cannot see.
  if (!$('setup-view').hidden || !$('field-view').hidden) return;
  const tag = (e.target && e.target.tagName || '').toUpperCase();
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key.toLowerCase();
  if (k === 'u') { e.preventDefault(); return doUndo(); }
  if ((game.sport || 'baseball') === 'baseball') {
    const map = {
      b: 'btn-ball', s: 'btn-strike', f: 'btn-foul', i: 'btn-inplay', o: 'btn-inplay', m: 'btn-more',
      a: 'btn-advance', c: 'btn-clear',
    };
    const direct = { 1: 'H1', 2: 'H2', 3: 'H3', h: 'HR', e: 'E' }[k];
    if (direct) { e.preventDefault(); return pickResult(direct); }
    if (k === 'n') { e.preventDefault(); return openRunners(); }
    if (map[k]) { e.preventDefault(); $(map[k]).click(); }
  }
});

// The other four sports' pads, wired now that every helper they borrow exists.
const SPORTS = createSports({ $, esc, ordinal, setSitLabel, commit, commitOrAsk, fireAnim, game: () => game });
// The Setup screen (js/setup.js).
const { closeSetup, fillSetup, fromLocalInput, openSetup, svGo } = createSetup({ $, suVal, POS_ALIAS, OBS_TIER, obsLevel, writeField, spCfg,
  openLineupSheet, renderTeamCards, renderLinkNote, game: () => game, sports: () => SPORTS });
// The Field screen (js/field.js).
const { openField, paintField } = createField({ $, haptic, showToast, saveRoster, writeField, commit, closeSetup, teamOf, teamAbbr, shortName, renderLineups,
  closeAllSheets: () => { for (const id of [...sheetStack]) closeSheet(id); }, game: () => game });
// The games list and New Game (js/lobby.js).
const { loadGames, CARRY, sportState } = createLobby({ $, db, esc, ordinal, nextNonce, fromLocalInput, openSheet, closeSheet,
  openGame, openSetupGuide, abbrFor: L.abbrFor, seedNewGame, teams: () => savedTeams, user: () => user, sports: () => SPORTS });

refreshSession();
