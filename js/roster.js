// A team's roster, on its own: players, their ids, and who plays where. Every
// function here takes a team ({ batters, positions, pitcher }) and knows
// nothing about the game row — the game-level readers (who is at bat, who is
// pitching) stay in logic.js, which re-exports all of this.
//
// No imports: the tests load the rules layer module by module.

export const filled = (b) => !!(b && (b.name || b.num));
// The 9 field spots; lineups[side].positions maps each to a player's bid.
export const FIELD_POSITIONS = ['P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF'];

// ---- Player identity -------------------------------------------------------
// Every batter carries a `bid`, minted once and then kept for the life of the
// roster. The defense points at bids, not at batting-order slots.
//
// Positions used to be slot numbers, so every reorder had to re-point them by
// hand and any write that got the order wrong silently moved the defense with
// it — a second-hand scramble on top of the first. A bid travels in the row it
// belongs to, so dragging 7th up to 2nd needs no bookkeeping at all.
//
// The at-bat pointer (state.batIdx) stays a slot on purpose: in baseball the
// order is the thing that persists, and a substitute bats where the player he
// replaced batted.
let bidSeq = 0;
export function newBid() {
  bidSeq = (bidSeq + 1) % 0xffff;
  return `b${Date.now().toString(36)}${bidSeq.toString(36)}${Math.floor(Math.random() * 46656).toString(36)}`;
}
export function slotOfBid(team, bid) {
  if (!bid) return -1;
  const bs = (team && Array.isArray(team.batters)) ? team.batters : [];
  return bs.findIndex((b) => b && b.bid === bid);
}
// Give every row a bid and re-point a legacy defense onto those bids. Safe to
// run on an already-normalized roster (it mints nothing and changes nothing),
// so it guards the boundary where a roster arrives AND the top of every
// mutation — a blob written by an older pad still lands here first.
export function normalizeTeam(team) {
  const t = team || {};
  const src = Array.isArray(t.batters) ? t.batters : [];
  const batters = src.map((b) => {
    const row = b || { num: '', name: '' };
    return row.bid ? row : { ...row, bid: newBid() };
  });
  const has = (bid) => batters.some((b) => b.bid === bid);
  const positions = {};
  for (const [pos, v] of Object.entries(t.positions || {})) {
    if (!FIELD_POSITIONS.includes(pos)) continue;
    // A number is the old slot-based form; a bid nobody holds points at a row
    // that is gone, and is dropped rather than left pointing at a stranger.
    if (typeof v === 'number') { const b = batters[v]; if (b) positions[pos] = b.bid; }
    else if (has(v)) positions[pos] = v;
  }
  const out = { ...t, batters, positions };
  // Older rosters named the pitcher only by number and name. Give P a bid like
  // every other spot; if the mound was never a row in the order, leave the
  // typed pitcher alone rather than erasing it.
  if (!positions.P) {
    const p = t.pitcher || { num: '', name: '' };
    const i = (p.num || p.name)
      ? batters.findIndex((b) => (b.num || '') === (p.num || '') && (b.name || '') === (p.name || ''))
      : -1;
    if (i >= 0) positions.P = batters[i].bid;
    else return { ...out, pitcher: { num: p.num || '', name: p.name || '' } };
  }
  return withPitcherMirror(out);
}
export const normalizeRoster = (lineups) => {
  const out = {};
  for (const [side, team] of Object.entries(lineups || {})) out[side] = normalizeTeam(team);
  return out;
};
// Is there anyone in this side's roster at all? Positions are deliberately not
// consulted: they point AT players, so with nobody in the order there is nobody
// in the field either. Counting them made the wipe guard useless — one stale
// spot left over from a cleared row kept a team "not empty" forever, and the
// tap that blanked the last name went straight through.
export function teamIsEmpty(team) {
  const t = team || {};
  const bs = Array.isArray(t.batters) ? t.batters : [];
  if (bs.some(filled)) return false;
  return !filled(t.pitcher);
}
// The sides a write would empty out. Nothing in the pad blanks a whole team by
// itself — a lineup is typed in once and edited a row at a time — so a write
// that does is a bug on its way to the server, and the server keeps no history
// to undo it with. The last two seasons' worth of vanished lineups all looked
// like this on the wire. The pad refuses these and says so; a deliberate clear
// (loading a different saved team over this one) says so at the call.
export function rosterWipes(prev, next) {
  const before = prev || {}, after = next || {};
  return Object.keys(before).filter((side) => !teamIsEmpty(before[side]) && teamIsEmpty(after[side]));
}
// `pitcher` stays a plain {num, name} copy, because that is what the overlay's
// cards and the pad's "vs P" line read. positions.P is the truth; this keeps the
// copy in step after any edit.
// `clearIfUnset` is for the move that takes the pitcher off the mound: an empty
// P then means empty, rather than falling back to the typed pitcher it just left.
function withPitcherMirror(t, clearIfUnset) {
  // No P on the diamond: a pitcher typed in without a row in the order is all
  // there is, and it stays.
  if (!(t.positions || {}).P) return { ...t, pitcher: clearIfUnset ? { num: '', name: '' } : (t.pitcher || { num: '', name: '' }) };
  const i = slotOfBid(t, t.positions.P);
  const b = i >= 0 ? t.batters[i] : null;
  return { ...t, pitcher: b && (b.num || b.name) ? { num: b.num || '', name: b.name || '' } : { num: '', name: '' } };
}

// Swap two batting-order slots in a team's roster blob (lineups[side]). The
// defense follows the players for free — it points at their bids. Returns a new
// blob; the at-bat pointer is a slot, not a player, and is untouched.
export function swapBatters(team, a, b) {
  const t = normalizeTeam(team);
  const batters = t.batters.slice();
  if (a === b || a < 0 || b < 0) return { ...t, batters };
  while (batters.length <= Math.max(a, b)) batters.push({ num: '', name: '', bid: newBid() });
  [batters[a], batters[b]] = [batters[b], batters[a]];
  return { ...t, batters };
}

// ---- Positions from the field screen ---------------------------------------
// Every spot on the diamond, P included, is positions[pos] = the bid of the
// player standing there.
// What a batting-order slot plays: 'P', a field spot, or '' (not in the field).
export function positionOf(team, idx) {
  const t = normalizeTeam(team);
  const b = t.batters[idx];
  if (!b) return '';
  const hit = Object.entries(t.positions || {}).find(([, bid]) => bid === b.bid);
  return hit ? hit[0] : '';
}
// Put slot `idx` at `pos` ('' = not in the field). Whoever held that spot goes
// to the bench rather than trading places: the tap says where THIS player
// plays, and quietly moving someone else to a new spot would be a surprise.
// Returns the new roster blob and the benched slot, or -1.
export function setPosition(team, idx, pos) {
  const t = normalizeTeam(team);
  const batters = t.batters;
  const positions = { ...t.positions };
  const me = batters[idx] ? batters[idx].bid : null;
  let benched = -1;
  if (!me) return { team: t, benched };
  const wasPitcher = positions.P === me;
  for (const k of Object.keys(positions)) if (positions[k] === me) delete positions[k];
  if (FIELD_POSITIONS.includes(pos)) {
    const held = positions[pos];
    if (held && held !== me) benched = slotOfBid(t, held);
    positions[pos] = me;
  }
  return { team: withPitcherMirror({ ...t, positions }, wasPitcher), benched };
}
// The Field screen: put lineup slot `idx` at `pos`, and the kid who had `pos`
// TRADES into idx's old spot. Kids rotate far more often than they sit, so this
// is one tap per move. A kid coming off the bench (no old spot) sends the one he
// replaces to the bench. Returns the team and who moved as a side effect, if anyone.
export function assignSpot(team, pos, idx) {
  const from = positionOf(team, idx);
  if (from === pos) return { team, moved: null };
  const r = setPosition(team, idx, pos);
  if (r.benched < 0) return { team: r.team, moved: null };
  if (!from) return { team: r.team, moved: { idx: r.benched, to: '' } };
  return { team: setPosition(r.team, r.benched, from).team, moved: { idx: r.benched, to: from } };
}
// Which lineup slot plays `pos`, or -1.
export function slotAt(team, pos) {
  const t = normalizeTeam(team);
  return slotOfBid(t, t.positions[pos]);
}

// The spots nobody fills yet, in field order — the sheet's field check.
export function missingPositions(team) {
  const t = normalizeTeam(team);
  return FIELD_POSITIONS.filter((pos) => {
    if (pos === 'P' && filled(t.pitcher)) return false;
    return !filled(t.batters[slotOfBid(t, t.positions[pos])]);
  });
}
// One typed field on one row, written over the stored roster.
//
// This replaced mergeLineupEdits, which took all fifteen rows as they stood in
// the DOM. The sheet skipped refilling its inputs while one of them had focus,
// so a roster changed underneath (a position trade, a drag, a pull from the
// server) left the other fourteen rows holding pre-change text — and the next
// blur wrote that whole stale side back. Names vanished and the order reverted
// mid-game with nobody editing. A single field can only ever carry the edit the
// operator actually made.
//
// The pitcher is a copy of a row's name and number, so an edit to that row
// carries the pitcher with it instead of orphaning the mound.
export function setBatterField(stored, idx, field, value) {
  const t = normalizeTeam(stored);
  if (idx < 0 || (field !== 'num' && field !== 'name')) return t;
  const batters = t.batters.slice();
  while (batters.length <= idx) batters.push({ num: '', name: '', bid: newBid() });
  batters[idx] = { ...batters[idx], [field]: value };
  // A row with no number and no name is nobody, so it gives its spot on the
  // diamond back rather than leaving the Field screen pointing at a blank row.
  const positions = { ...t.positions };
  const emptied = !filled(batters[idx]);
  const wasPitcher = positions.P === batters[idx].bid;
  if (emptied) {
    for (const k of Object.keys(positions)) if (positions[k] === batters[idx].bid) delete positions[k];
  }
  // Only the pitcher's own row leaving empties the mound; an edit elsewhere must
  // not disturb a pitcher typed in without a row in the order.
  return withPitcherMirror({ ...t, batters, positions }, emptied && wasPitcher);
}
