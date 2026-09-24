// The Setup screen: a stack of panes (Overlay link, Teams, Game, Look & sound,
// Sponsors, OBS) that write as you edit. Resetting and deleting a game are the
// game's lifecycle and stay in control.js.
//
// ctx is control.js's side: $ and writeField, the game and the sport table
// as getters (both change after this is built), and the few pieces of other
// screens this one opens or reads.
import { geocode } from './weather.js';

export function createSetup(ctx) {
  const { $, suVal, POS_ALIAS, OBS_TIER, obsLevel, writeField, spCfg,
    openLineupSheet, renderTeamCards, renderLinkNote } = ctx;
  const game = () => ctx.game();
  const sports = () => ctx.sports();

  // ---- The Setup screen -----------------------------------------------------
  // A screen that pushes panes, not a drawer holding a sheet. Back goes up one
  // pane and then out, so there is one way through and one way home.
  //
  // There is no Save. Every field writes when you leave it, the way the lineup
  // screen does — the old sheet's Save button, its Cancel, and the "discard your
  // changes?" guard all existed because this one corner of the app batched its
  // writes while everything else committed immediately. One contract is worth
  // more than the batch was.
  let svPane = 'home';
  function openSetup() {
    if (!game()) return;
    fillSetup();
    svGo('home');
    $('setup-view').hidden = false;
    document.body.classList.add('setup-open');
    $('setup-back').focus({ preventScroll: true });
  }
  function closeSetup() {
    $('setup-view').hidden = true;
    document.body.classList.remove('setup-open');
  }
  // A pane names itself, so the header cannot drift from the pane it sits over.
  function svGo(pane) {
    svPane = pane;
    let title = 'Setup';
    document.querySelectorAll('#setup-view .sv-pane').forEach((p) => {
      const on = p.dataset.pane === pane;
      p.hidden = !on;
      if (on) title = p.dataset.title || 'Setup';
    });
    $('setup-title').textContent = title;
    $('setup-view').scrollTop = 0;
    if (pane === 'home') renderSetupRows();
    if (pane === 'link') renderLinkNote();
    if (pane.startsWith('teams')) renderTeamCards();
  }
  $('setup-open').onclick = openSetup;
  // Back climbs one level: a panel pane (look-2) returns to its section (look),
  // a section returns home, and home leaves.
  const svUp = (pane) => (pane.includes('-') ? pane.split('-').slice(0, -1).join('-') : 'home');
  $('setup-back').onclick = () => (svPane === 'home' ? closeSetup() : svGo(svUp(svPane)));
  $('setup-view').addEventListener('click', (e) => {
    const go = e.target.closest('[data-go]');
    if (go) svGo(go.dataset.go);
  });
  addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || $('setup-view').hidden) return;
    e.preventDefault();
    if (svPane === 'home') closeSetup(); else svGo(svUp(svPane));
  });
  // The rows on the first pane answer their own question, so the screen is worth
  // reading before anything is opened.
  function renderSetupRows() {
    if (!game()) return;
    const sport = game().sport || 'baseball';
    $('sv-teams-sub').textContent = `${game().away_abbr || game().away_name || 'Away'} · ${game().home_abbr || game().home_name || 'Home'}`;
    $('sv-sport-val').textContent = sport.charAt(0).toUpperCase() + sport.slice(1);
    const mins = game().time_limit_seconds ? Math.round(game().time_limit_seconds / 60) + ' min' : '';
    const reg = (game().regulation_innings | 0) ? `${game().regulation_innings} innings` : '';
    const where = game().venue && game().venue.label ? game().venue.label.split(',')[0] : '';
    $('sv-times-val').textContent = [where, mins, reg].filter(Boolean).join(' · ') || 'Not set';
    const on = ['show_clock', 'show_batter', 'show_pitcher', 'show_pitchcount', 'show_rhe', 'show_runrule'].filter((k) => game()[k]).length;
    $('sv-show-val').textContent = on ? `${on} on` : 'Nothing extra';
    // The theme's own name, as its option reads it — no second list to drift.
    const opt = $('theme-sel').querySelector(`option[value="${game().theme || 'nightgame'}"]`);
    const themeName = opt ? opt.textContent.replace(/\s*\(.*\)$/, '') : (game().theme || 'Midnight');
    const pos = (POS_ALIAS[game().scorebug_position] || game().scorebug_position || 'bottom-center').replace('-', ' ');
    // An animated scorebug is the look; a layout is only half of it without its theme.
    const bugOpt = $('su-style').querySelector(`option[value="${game().style || 'bar'}"]`);
    const bugName = bugOpt ? bugOpt.textContent.replace(/\s*\(.*\)$/, '') : 'Bar';
    $('sv-look-val').textContent = String(game().style || '').startsWith('anim-') ? `${bugName} · ${pos}` : `${bugName} · ${themeName} · ${pos}`;
    const sp = spCfg();
    $('sv-sponsors-val').textContent = sp.list.length ? `${sp.list.length}${sp.rotate ? ' · rotating' : ''}` : 'None';
    const lvl = obsLevel();
    $('sv-obs-tag').textContent = lvl === null ? 'not connected' : (OBS_TIER[lvl] || 'no access');
  }
  $('sv-lineups').onclick = () => { closeSetup(); openLineupSheet(); };

  // The same column is a game time limit, a quarter, or a half depending on the
  // sport. Say which, so nobody has to guess what soccer does with it.
  function renderSetupTimeLabel() {
    const sp = sports()[$('su-sport').value];
    $('su-time-label').textContent = sp ? sp.timeLabel : 'Time limit — minutes (0 = none)';
  }
  $('su-sport').addEventListener('change', renderSetupTimeLabel);

  // What goes on the bug. A true abbreviation is upper-cased, the way scoreboards
  // write them; a short name is left as it was typed, because BLUE STEEL is both
  // wider than Blue Steel and not how anyone writes it.
  function bugLabel(v, fallback) {
    const t = String(v || '').trim();
    if (!t) return fallback;
    return t.length <= 5 ? t.toUpperCase() : t;
  }

  function fillSetup() {
    $('su-sport').value = game().sport || 'baseball';
    renderSetupTimeLabel();
    $('su-away-name').value = game().away_name || '';
    $('su-away-abbr').value = game().away_abbr || '';
    $('su-away-logo').value = game().away_logo_url || '';
    $('su-away-color').value = game().away_color || '#7a8794';
    $('su-home-name').value = game().home_name || '';
    $('su-home-abbr').value = game().home_abbr || '';
    $('su-home-logo').value = game().home_logo_url || '';
    $('su-home-color').value = game().home_color || '#1b2a41';
    $('su-startsat').value = toLocalInput(game().starts_at);
    $('su-venue').value = (game().venue && game().venue.query) || '';
    showVenueHit(game().venue);
    $('su-time').value = game().time_limit_seconds ? Math.round(game().time_limit_seconds / 60) : '';
    $('su-regulation').value = game().regulation_innings || '';
    $('su-show-clock').checked = !!game().show_clock;
    $('su-show-batter').checked = !!game().show_batter;
    $('su-show-pitcher').checked = !!game().show_pitcher;
    $('su-show-pitchcount').checked = !!game().show_pitchcount;
    $('su-show-runrule').checked = !!game().show_runrule;
    $('su-show-rhe').checked = !!game().show_rhe;
  }
  // Each field writes itself. `change` rather than `input`, so a name is one
  // write when you leave the field and not one per letter; the colour pickers
  // fire `change` on release for the same reason.
  //
  // The sport field carries the old Save button's one piece of real work: a game
  // switching sport for the first time needs that sport's situation initialised,
  // or its pad opens onto a state that has no quarter, half, set or period.
  const SU_TEXT = {
    'su-away-name': (v) => ({ away_name: v || 'Visitor' }),
    'su-home-name': (v) => ({ home_name: v || 'Home' }),
    'su-away-abbr': (v) => ({ away_abbr: bugLabel(v, 'VIS') }),
    'su-home-abbr': (v) => ({ home_abbr: bugLabel(v, 'HOME') }),
    'su-away-logo': (v) => ({ away_logo_url: v || null }),
    'su-home-logo': (v) => ({ home_logo_url: v || null }),
  };
  for (const id of Object.keys(SU_TEXT)) {
    $(id).addEventListener('change', () => {
      const patch = SU_TEXT[id](suVal(id));
      writeField(patch);
      // Show what was actually stored: an abbreviation is upper-cased and an
      // empty name becomes "Visitor", and a field that kept saying otherwise
      // would be the screen disagreeing with the bug again.
      const stored = Object.values(patch)[0];
      if (typeof stored === 'string') $(id).value = stored;
      renderSetupRows();
      renderTeamCards();
    });
  }
  $('su-away-color').addEventListener('change', (e) => { writeField({ away_color: e.target.value }); renderTeamCards(); });
  $('su-home-color').addEventListener('change', (e) => { writeField({ home_color: e.target.value }); renderTeamCards(); });
  $('su-startsat').addEventListener('change', () => { writeField({ starts_at: fromLocalInput($('su-startsat').value) }); renderSetupRows(); });
  // Venue: looked up once here, so the overlay only ever asks for the forecast.
  // The note under the field says which place it matched — "Aubrey" alone is
  // a town in more than one state.
  function showVenueHit(v, msg) {
    const hit = $('su-venue-hit');
    hit.textContent = msg || (v && v.label ? `📍 ${v.label} — weather on` : '');
    hit.hidden = !hit.textContent;
  }
  let venueAsk = 0;
  $('su-venue').addEventListener('change', async () => {
    const q = $('su-venue').value.trim();
    const ask = ++venueAsk;
    if (!q) { writeField({ venue: null }); showVenueHit(null); renderSetupRows(); return; }
    showVenueHit(null, 'Looking up…');
    let v = null;
    try { v = await geocode(q); } catch (e) { if (ask === venueAsk) showVenueHit(null, 'Could not reach the weather service — try again'); return; }
    if (ask !== venueAsk) return;
    if (!v) { showVenueHit(null, `No place called “${q}” — try a ZIP`); return; }
    writeField({ venue: v });
    showVenueHit(v);
    renderSetupRows();
  });
  $('su-regulation').addEventListener('change', () => { writeField({ regulation_innings: parseInt($('su-regulation').value, 10) || 0 }); renderSetupRows(); });
  $('su-time').addEventListener('change', () => {
    const mins = parseInt($('su-time').value, 10);
    const time_limit_seconds = Number.isFinite(mins) && mins > 0 ? mins * 60 : null;
    const patch = { time_limit_seconds };
    // A limit changed while the clock is stopped resets what is left on it.
    if (time_limit_seconds && !game().clock_running) patch.clock_remaining_seconds = time_limit_seconds;
    writeField(patch);
    renderSetupRows();
  });
  $('su-sport').addEventListener('change', () => {
    const sport = $('su-sport').value;
    const patch = { sport };
    const sp = sports()[sport];
    if (sp && !sp.started(game().state)) patch.state = sp.init(game());
    writeField(patch);
    renderSetupTimeLabel();
    renderSetupRows();
  });
  for (const id of ['su-show-clock', 'su-show-batter', 'su-show-pitcher', 'su-show-pitchcount', 'su-show-rhe', 'su-show-runrule']) {
    $(id).addEventListener('change', (e) => {
      writeField({ [id.replace('su-show-', 'show_').replace('rhe', 'rhe')]: e.target.checked });
      renderSetupRows();
    });
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

  return { closeSetup, fillSetup, fromLocalInput, openSetup, svGo };
}
