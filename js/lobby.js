// The games list and the New Game sheet: the screen before any game is open.
//
// ctx is control.js's side: $, db, esc, ordinal, nextNonce, fromLocalInput,
// openSheet, closeSheet, openGame, openSetupGuide, and getters for the signed-in
// user and the sport table (both are set after this module is built).
import { serverNow } from './clock.js';

export function createLobby(ctx) {
  const { $, db, esc, ordinal, nextNonce, fromLocalInput, openSheet, closeSheet, openGame, openSetupGuide } = ctx;
  const user = () => ctx.user();
  const sports = () => ctx.sports();

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
  function situationLabel(g) {
    const sp = sports()[g.sport];
    return sp ? sp.lobby(g.state || {}) : `${g.half === 'bottom' ? 'Bot' : 'Top'} ${ordinal(g.inning || 1)}`;
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
      .eq('owner_id', user().id).order('updated_at', { ascending: false });
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

  // New game: pick the sport, then create with the right initial state; the rest
  // comes from your last game.
  $('new-game-btn').addEventListener('click', () => { $('ng-startsat').value = ''; openSheet('newgame-sheet'); });
  $('ng-cancel').onclick = () => closeSheet('newgame-sheet');
  // What a new game takes from your last one: how the broadcast looks and
  // sounds, and the house rules. Not the teams (home and away change every game;
  // saved teams load them in one pick) and not the venue (away games move it).
  const CARRY = ['style', 'theme', 'scorebug_position', 'scorebug_scale', 'sound_pack', 'audio', 'look', 'sponsors',
    'show_clock', 'show_batter', 'show_pitcher', 'show_pitchcount', 'show_rhe', 'show_runrule', 'auto_clip'];
  const CARRY_SAME_SPORT = ['regulation_innings', 'time_limit_seconds'];
  async function lastGameSettings(sport) {
    const { data } = await db.from('games').select([...CARRY, ...CARRY_SAME_SPORT, 'sport'].join(','))
      .order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (!data) return { style: 'scorebox' };
    const out = {};
    for (const k of CARRY) if (data[k] != null) out[k] = data[k];
    if (data.sport === sport) for (const k of CARRY_SAME_SPORT) if (data[k] != null) out[k] = data[k];
    return out;
  }
  const sportState = (sport) => (sports()[sport] ? sports()[sport].init() : null);
  $('ng-create').onclick = async () => {
    const sport = $('ng-sport').value;
    // Every game opens on Starting Soon: a real card, so it can be taken down by
    // hand like any other. Starting the clock or the first play also drops it.
    const row = { ...(await lastGameSettings(sport)), status: 'setup', sport, starts_at: fromLocalInput($('ng-startsat').value),
      card: { type: 'starting', meta: {}, nonce: nextNonce() } };   // 'live' on the first play
    const st = sportState(sport); if (st) row.state = st;
    const { data, error } = await db.from('games').insert(row).select().single();
    if (error) return alert(error.message);
    closeSheet('newgame-sheet');
    await openGame(data.id);
    openSetupGuide(); // fresh game → expand the checklist
  };

  return { loadGames, CARRY, sportState };
}
