// The Field screen: positions by jersey number, for either team. Tap a spot,
// then the number playing there; a pitching change gives the new arm his own
// count.
//
// ctx is control.js's side: $, the open game (a getter), haptic, showToast,
// saveRoster, writeField, commit, closeSetup, closeAllSheets, teamOf,
// teamAbbr, shortName, renderLineups.
import * as L from './logic.js';

export function createField(ctx) {
  const { $, haptic, showToast, saveRoster, writeField, commit, closeSetup, closeAllSheets, teamOf, teamAbbr, shortName, renderLineups } = ctx;
  const game = () => ctx.game();

  // Positions by jersey number, the way you see them from the dugout fence. A
  // full screen, not a sheet: nothing behind it, one Back. Tap a spot, tap the
  // number playing there; if that kid was somewhere else the two trade.
  const FIELD_TILE = { LF: [15, 12], CF: [50, 4], RF: [85, 12], SS: [31, 38], '2B': [69, 36],
    '3B': [12, 60], '1B': [88, 60], P: [50, 56], C: [50, 84] };
  let fieldSide = 'home', fieldPick = null;
  function openField(side) {
    if (!game()) return;
    fieldSide = side || L.fieldingSide(game()); fieldPick = null;
    closeSetup();
    closeAllSheets();
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
  function paintField() {
    if (!game() || $('field-view').hidden) return;
    const team = (game().lineups || {})[fieldSide] || {};
    const batters = teamOf(fieldSide).batters;
    const inField = L.fieldingSide(game());
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
    const lineups = game().lineups || {};
    const before = L.normalizeTeam(lineups[side] || {}).positions.P || null;
    const { team, moved } = L.assignSpot(lineups[side] || {}, pos, i);
    haptic();
    fieldPick = null;
    saveRoster({ ...lineups, [side]: team });
    // A new arm on the mound gets his own pitch count.
    const pc = L.onPitcherChange(game(), side, before, L.normalizeTeam(team).positions.P || null);
    if (pc) { if (game().status === 'setup') writeField({ state: pc.patch.state }); else commit(pc); }
    const who = (b) => (b && b.num ? '#' + b.num : shortName(b));
    const bs = teamOf(side).batters;
    showToast(`✓ ${who(bs[i])} to ${pos}` + (moved ? (moved.to ? ` · ${who(bs[moved.idx])} to ${moved.to}` : ` · ${who(bs[moved.idx])} to bench`) : ''), 3000);
    paintField();
    renderLineups();
  };
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('field-view').hidden) { e.preventDefault(); closeField(); } });

  return { openField, paintField };
}
