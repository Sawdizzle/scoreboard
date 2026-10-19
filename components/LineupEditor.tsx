'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PhotoLineup } from '@/components/PhotoLineup';
import { addRosterPlayer, saveLineup } from '@/app/actions';
import { ChevronLeft, Cross, Plus } from '@/components/icons';
import { benchFrom, FIELD, placeBatter, placeFromCard } from '@/lib/lineup';
import { parseRoster } from '@/lib/roster-parse';
import { assignSpot, missingPositions, newBid, normalizeTeam, positionOf, setPosition, slotAt, swapBatters } from '@/lib/rules/roster.js';
import type { FormState, Lineup, LineupBatter, Side } from '@/lib/types';

export type PoolPlayer = LineupBatter & { avg?: string };

// Where each spot sits on the drawn field (358 × 200).
const SPOT: Record<string, [number, number]> = {
  CF: [179, 28], LF: [78, 50], RF: [280, 50], SS: [130, 86], '2B': [228, 86],
  '3B': [96, 132], '1B': [262, 132], P: [179, 125], C: [179, 175],
};
// The position keys: the field, then "Bats" for a hitter who does not field.
const POS_KEYS = [...FIELD, ''];
const posLabel = (p: string) => p || 'Bats';
const ord = (n: number) => `${n}${n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'}`;

type NewKid = { num: string; first: string; last: string; roster: boolean };

// The batting order and the field for one side, built for the minute before
// first pitch with a card in one hand. Scoreboard's roster rules do every move.
//
//   From the card  type the jersey numbers in batting order on a keypad that
//                  stays on screen, each with a position key if you have it.
//                  Typing "same as last game" in a new order re-orders it; a
//                  number already up the order is never added twice; a number
//                  nobody has asks who it is and puts them on the roster.
//   A tap          a row opens its own position keys and moves; a spot on the
//                  diamond then a player works as well. Positions trade on a
//                  clash: put the shortstop at second and whoever was at
//                  second goes to short, the way kids actually rotate.
//   Saving         every change saves by itself a moment later. Undo steps
//                  back through every change, a whole preset included. Leaving
//                  waits for the save. `stored` false means `initial` is only a
//                  suggestion (last game, the roster): it saves on the first
//                  change, or on "Use this lineup".
export function LineupEditor({ slug, gameId, side, initial, stored, pool, presets, canEdit, canRoster = false, ai = false, back, sides, next }: {
  slug: string; gameId: string; side: Side; initial: Lineup; stored: boolean; pool: PoolPlayer[];
  presets: { label: string; lineup: Lineup }[]; canEdit: boolean;
  // This seat can put a new kid on the roster (organizer, head coach).
  canRoster?: boolean;
  // AI on for this team: a lineup card can be read from a photo.
  ai?: boolean;
  // Where the back arrow goes, the two sides' tabs, and where to go once saved.
  back: { href: string; label: string };
  sides: { href: string; label: string; on: boolean }[];
  next: { href: string; label: string };
}) {
  const router = useRouter();
  const [team, setTeam] = useState<Lineup>(() => normalizeTeam(initial));
  const [saved, setSaved] = useState(() => (stored ? JSON.stringify(normalizeTeam(initial)) : ''));
  // Changed by hand since it opened: only then does it save by itself.
  const [touched, setTouched] = useState(false);
  const [hist, setHist] = useState<{ team: Lineup; cursor: number | null }[]>([]);
  const [sel, setSel] = useState<{ pos?: string; idx?: number }>({});
  // From the card: the slot the next number goes to (null: keypad closed).
  const [cursor, setCursor] = useState<number | null>(null);
  const [typed, setTyped] = useState('');
  const [last, setLast] = useState<number | null>(null);
  const [msg, setMsg] = useState('');
  const [ask, setAsk] = useState<{ kid: NewKid; pos?: string } | null>(null);
  const [leftover, setLeftover] = useState(false);
  // Players put on the roster here, until the page's own list has them.
  const [extra, setExtra] = useState<PoolPlayer[]>([]);
  const [add, setAdd] = useState<NewKid>({ num: '', first: '', last: '', roster: canRoster && side === 'us' });
  const [adding, setAdding] = useState(false);
  const [addErr, setAddErr] = useState('');
  const [paste, setPaste] = useState('');

  const json = JSON.stringify(team);
  const dirty = json !== saved;
  const all = useMemo(() => [...pool, ...extra.filter((x) => !pool.some((p) => p.bid === x.bid))], [pool, extra]);
  const avg = useMemo(() => new Map(all.map((p) => [p.bid, p.avg])), [all]);
  const inOrder = new Set(team.batters.map((b) => b.bid));
  const bench = all.filter((p) => !inOrder.has(p.bid));
  const missing = missingPositions(team) as string[];
  const holder = (pos: string) => { const i = slotAt(team, pos); return i >= 0 ? team.batters[i] : null; };
  const who = (b?: LineupBatter) => (b ? b.name || `No. ${b.num}` : '');

  // ---- Saving ------------------------------------------------------------
  const want = useRef(json);
  const savedRef = useRef(saved);
  const busy = useRef(false);
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState('');
  const flush = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setSaving(true);
    try {
      while (want.current !== savedRef.current) {
        const body = want.current;
        const fd = new FormData();
        fd.set('lineup', body);
        let r: FormState;
        try { r = await saveLineup(slug, gameId, side, {}, fd); } catch { r = { error: 'No signal: not saved yet. Tap Save to try again.' }; }
        if (r.error) { setSaveErr(r.error); break; }
        savedRef.current = body;
        setSaved(body);
        setSaveErr('');
      }
    } finally {
      busy.current = false;
      setSaving(false);
    }
  }, [slug, gameId, side]);
  useEffect(() => {
    want.current = json;
    if (!canEdit || !touched || json === savedRef.current) return;
    const t = window.setTimeout(() => void flush(), 600);
    return () => window.clearTimeout(t);
  }, [json, touched, canEdit, flush]);
  useEffect(() => {
    const again = () => { if (want.current !== savedRef.current) void flush(); };
    window.addEventListener('online', again);
    return () => window.removeEventListener('online', again);
  }, [flush]);
  useEffect(() => {
    if (!dirty || !touched) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, touched]);
  const saveNow = () => { setTouched(true); want.current = json; void flush(); };
  // Leaving the screen: the save goes first. A save that will not go asks.
  const pending = () => touched && want.current !== savedRef.current;
  async function leave(href: string) {
    if (pending()) await flush();
    if (pending() && !window.confirm('This lineup did not save (no signal?). Leave anyway and lose the changes?')) return;
    router.push(href);
  }
  function guard(e: { preventDefault: () => void }, href: string) { if (pending()) { e.preventDefault(); void leave(href); } }

  // ---- Changes -------------------------------------------------------------
  function update(t: Lineup, nextCursor?: number | null) {
    setHist((h) => [...h.slice(-39), { team, cursor }]);
    setTeam(normalizeTeam(t));
    setTouched(true);
    if (nextCursor !== undefined) setCursor(nextCursor);
  }
  function undo() {
    const h = hist[hist.length - 1];
    if (!h) return;
    setHist(hist.slice(0, -1));
    setTeam(h.team);
    setCursor(h.cursor);
    setTouched(true);
    setSel({}); setAsk(null); setLeftover(false); setMsg('Undone');
  }
  function place(pos: string, idx: number) {
    update(assignSpot(team, pos, idx).team);
    setSel({});
  }
  function tapSpot(pos: string) {
    if (!canEdit) return;
    if (sel.idx !== undefined) place(pos, sel.idx);
    else setSel(sel.pos === pos ? {} : { pos });
  }
  function tapRow(i: number) {
    if (!canEdit) return;
    if (sel.pos) place(sel.pos, i);
    else setSel(sel.idx === i ? {} : { idx: i });
  }
  // A position key on a selected row: the field trades like the diamond; Bats takes them out of it.
  function rowPos(i: number, pos: string) {
    update(pos ? assignSpot(team, pos, i).team : setPosition(team, i, '').team);
  }
  // The selection follows the player, so a kid can go up three spots in three taps.
  const move = (i: number, d: number) => { const j = i + d; if (j >= 0 && j < team.batters.length) { update(swapBatters(team, i, j)); setSel({ idx: j }); } };
  function drop(i: number) {
    const b = team.batters[i];
    const positions = Object.fromEntries(Object.entries(team.positions).filter(([, bid]) => bid !== b.bid));
    update({ ...team, batters: team.batters.filter((_, j) => j !== i), positions }, cursor !== null && i < cursor ? cursor - 1 : undefined);
    setSel({});
    setMsg(`${who(b)} out of the order · Undo to bring back`);
  }
  const append = (b: LineupBatter) => update({ ...team, batters: [...team.batters, b] });
  // A substitute takes the selected player's place: his spot in the order and
  // his position. The player coming out goes to the bench, from where he can
  // come back the same way. Adding at the end and moving up would shift the
  // order under the batter who is up during a game.
  function subIn(b: LineupBatter, i: number) {
    const out = team.batters[i];
    if (!out) return;
    const batters = team.batters.map((x, j) => (j === i ? b : x));
    const positions = Object.fromEntries(Object.entries(team.positions).map(([pos, bid]) => [pos, bid === out.bid ? b.bid : bid]));
    update({ ...team, batters, positions });
    setSel({});
    setMsg(`${who(b)} in for ${who(out)}`);
  }
  const picked = sel.idx !== undefined ? team.batters[sel.idx] : undefined;
  const benchTap = (p: PoolPlayer) => {
    const b = { bid: p.bid, num: p.num, name: p.name };
    if (canEdit && sel.idx !== undefined && picked) subIn(b, sel.idx);
    else if (cursor !== null) { update(placeBatter(team, cursor, b), cursor + 1); setLast(cursor); }
    else append(b);
  };
  function applyPreset(p: { label: string; lineup: Lineup }) {
    update(p.lineup, null);
    setSel({}); setAsk(null); setLeftover(false);
    setMsg(`${p.label} · Undo to go back`);
  }

  // A new kid: on the roster when asked (and allowed), else in this game only.
  async function makeKid(kid: NewKid): Promise<LineupBatter | null> {
    const name = `${kid.first} ${kid.last}`.trim();
    if (!(side === 'us' && kid.roster && canRoster)) return { bid: newBid(), num: kid.num, name: name.slice(0, 60) };
    let r: Awaited<ReturnType<typeof addRosterPlayer>>;
    try { r = await addRosterPlayer(slug, { number: kid.num, first: kid.first, last: kid.last }); } catch { r = { error: 'No signal: the player was not added. Try again.' }; }
    if ('error' in r) { setAddErr(r.error); return null; }
    setExtra((x) => [...x, r.batter]);
    return r.batter;
  }
  async function addTyped() {
    const n = add.num.replace(/\D/g, '').slice(0, 3);
    if (!n && !add.first.trim() && !add.last.trim()) return;
    setAdding(true); setAddErr('');
    const b = await makeKid({ ...add, num: n });
    setAdding(false);
    if (!b) return;
    if (cursor !== null) { update(placeBatter(team, cursor, b), cursor + 1); setLast(cursor); } else append(b);
    setAdd({ num: '', first: '', last: '', roster: add.roster });
    setMsg(`${who(b)} added${side === 'us' && add.roster && canRoster ? ' to the roster and the order' : ''}`);
  }
  function addPasted() {
    const list = parseRoster(paste);
    if (!list.length) return;
    let t = { ...team, batters: [...team.batters] };
    for (const p of list) {
      // A roster player joins as himself so his stats count for him: by name,
      // or by jersey number when the names agree (or the line has none).
      // Anyone else is typed in.
      const name = `${p.first_name} ${p.last_name}`.trim();
      const free = (x: LineupBatter) => !t.batters.some((b) => b.bid === x.bid);
      const low = (v: string) => v.trim().toLowerCase();
      const lastOf = (v: string) => low(v).split(/\s+/).pop() ?? '';
      const known = all.find((x) => free(x) && !!name && low(x.name) === low(name))
        ?? all.find((x) => free(x) && !!p.number && x.num === p.number && (!name || !x.name || lastOf(x.name) === lastOf(name)));
      const b = known ? { bid: known.bid, num: known.num, name: known.name } : { bid: newBid(), num: p.number, name };
      t.batters.push(b);
      const pos = p.positions.find((x) => FIELD.includes(x));
      if (pos) t = setPosition(t, t.batters.length - 1, pos).team;
    }
    update(t);
    setPaste('');
  }

  // ---- From the card ---------------------------------------------------------
  function startCard() {
    setCursor(0); setTyped(''); setLast(null); setAsk(null); setLeftover(false); setSel({});
    setMsg(team.batters.length ? 'Type the card from the top: each number moves that kid into place.' : 'Type the numbers from the card, top to bottom.');
  }
  // A key on the card keypad. `pos`: undefined keeps the kid's spot (Next),
  // '' makes them a hitter only, a field position puts them there.
  function cardKey(pos?: string) {
    if (cursor === null) return;
    const n = typed.replace(/\D/g, '').slice(0, 3);
    if (!n) {
      // No number: the position goes to the kid just placed (a second thought).
      if (pos !== undefined && last !== null && team.batters[last]) {
        update(pos ? setPosition(team, last, pos).team : setPosition(team, last, '').team);
        setMsg(`${who(team.batters[last])} · ${posLabel(pos)}`);
      }
      return;
    }
    const r = placeFromCard(team, cursor, n, all, pos);
    setTyped('');
    if (r.ok) {
      update(r.team, cursor + 1);
      setLast(r.at);
      const b = r.team.batters[r.at];
      const at = positionOf(r.team, r.at) as string;
      setMsg(`${ord(r.at + 1)}: ${who(b)}${at ? ` · ${at}` : ''}`);
      return;
    }
    if (r.why === 'placed') { setMsg(`#${n} is already batting ${ord(r.at + 1)}`); return; }
    setAsk({ kid: { num: n, first: '', last: '', roster: canRoster && side === 'us' }, pos });
  }
  async function askDone() {
    if (!ask || cursor === null) return;
    setAdding(true); setAddErr('');
    const b = await makeKid(ask.kid);
    setAdding(false);
    if (!b) return;
    update(placeBatter(team, cursor, b, ask.pos), cursor + 1);
    setLast(cursor);
    setMsg(`${ord(cursor + 1)}: ${who(b)}${ask.pos ? ` · ${ask.pos}` : ''}`);
    setAsk(null);
  }
  function finishCard() {
    if (cursor !== null && cursor > 0 && cursor < team.batters.length) { setLeftover(true); return; }
    setCursor(null); setAsk(null); setLeftover(false); setLast(null); setMsg('');
  }
  // Keep the kid just placed in sight above the keypad.
  const rows = useRef<HTMLOListElement>(null);
  useEffect(() => {
    if (last === null || cursor === null) return;
    rows.current?.children[last]?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [last, cursor, team]);
  // A note in the save bar fades back to the save status.
  useEffect(() => {
    if (!msg || cursor !== null) return;
    const t = window.setTimeout(() => setMsg(''), 4000);
    return () => window.clearTimeout(t);
  }, [msg, cursor]);

  const hint = cursor !== null
    ? ''
    : sel.pos
      ? `Who plays ${sel.pos}? Tap a player in the order.`
      : sel.idx !== undefined
        ? `${who(team.batters[sel.idx])}: tap a position below or a spot on the field.`
        : canEdit ? 'Tap a player for their position, or a spot on the field and then a player.' : 'View only for your seat.';
  const status = saveErr ? <span className="bad">{saveErr}</span>
    : saving ? 'Saving…'
      : dirty && !touched ? (stored ? 'Not saved yet' : 'A suggestion: not saved yet')
        : dirty ? 'Saving…' : 'Saved';

  return (
    <div className="stack lineup" style={{ gap: 12 }}>
      <div className="h-row" style={{ justifyContent: 'flex-start', alignItems: 'center', gap: 2 }}>
        <Link href={back.href} onNavigate={(e) => guard(e, back.href)} aria-label={back.label} className="icon-btn" style={{ border: 0, marginLeft: -10 }}><ChevronLeft /></Link>
        <nav className="seg" aria-label="Side" style={{ flex: 1 }}>
          {sides.map((s) => (
            <Link key={s.href} href={s.href} onNavigate={(e) => guard(e, s.href)} className="seg-item" aria-current={s.on ? 'page' : undefined}>{s.label}</Link>
          ))}
        </nav>
      </div>

      {canEdit && (
        <div className="chips">
          <button type="button" className={`chip${cursor !== null ? ' on' : ''}`} onClick={() => (cursor === null ? startCard() : finishCard())}>
            {cursor === null ? '# From the card' : 'Done with the card'}
          </button>
          {presets.map((p) => (
            <button key={p.label} type="button" className="chip" onClick={() => applyPreset(p)}>{p.label}</button>
          ))}
        </div>
      )}

      <div className="field-box">
        <svg width="100%" height="200" viewBox="0 0 358 200" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
          <path d="M179 192 L30 64 A205 205 0 0 1 328 64 Z" fill="#173824" stroke="#2c6a45" strokeWidth="1.5" />
          <path d="M179 184 L124 132 L179 82 L234 132 Z" fill="#3a2c1d" stroke="#6b5338" strokeWidth="1.5" />
          <path d="M179 170 L140 132 L179 96 L218 132 Z" fill="#173824" />
        </svg>
        {FIELD.map((pos) => {
          const b = holder(pos);
          const [x, y] = SPOT[pos];
          const on = sel.pos === pos || (sel.idx !== undefined && team.batters[sel.idx]?.bid === b?.bid && !!b);
          return (
            <button key={pos} type="button" className={`spot${on ? ' on' : ''}${b ? '' : ' open'}`}
              style={{ left: `${(x / 358) * 100}%`, top: y }} onClick={() => tapSpot(pos)}
              aria-label={`${pos}: ${b ? `number ${b.num} ${b.name}` : 'open'}`} aria-pressed={sel.pos === pos}>
              <b>{b ? b.num || '·' : '+'}</b><small>{pos}</small>
            </button>
          );
        })}
      </div>

      {hint && (
        <div className="h-row" style={{ padding: '0 4px', alignItems: 'center' }}>
          <span className="sub" role="status">{hint}</span>
          {sel.pos && holder(sel.pos) && (
            <button type="button" className="link" onClick={() => { update(setPosition(team, slotAt(team, sel.pos!), '').team); setSel({}); }}>Clear {sel.pos}</button>
          )}
        </div>
      )}

      <section>
        <div className="col-head">
          <span style={{ flex: '0 0 18px' }}>#</span>
          <span style={{ flex: 1 }}>Batting order · {team.batters.length}</span>
          {missing.length > 0 && missing.length < 9 && <span className="tag gold">Open: {missing.join(' ')}</span>}
        </div>
        {team.batters.length === 0 ? (
          <div className="card empty"><b>Nobody in the order yet</b>{canEdit ? 'Tap “From the card” and type the jersey numbers, or tap players on the bench below.' : ''}</div>
        ) : (
          <ol className="order" ref={rows}>
            {team.batters.map((b, i) => {
              const pos = positionOf(team, i) as string;
              const later = cursor !== null && i >= cursor;
              const open = canEdit && sel.idx === i;
              return (
                <li key={b.bid} className={`order-row${open ? ' on' : ''}${later ? ' later' : ''}${cursor !== null && last === i ? ' just' : ''}`}>
                  <div className="order-line">
                    <span className="order-n">{i + 1}</span>
                    <button type="button" className="order-who" onClick={() => tapRow(i)} disabled={!canEdit} aria-expanded={open}>
                      <span className="jersey">{b.num || '–'}</span>
                      <span className="row-title">{b.name || `No. ${b.num}`}{later && <small>Not on the card yet</small>}</span>
                      <span className={`tag${pos ? '' : ' dim'}`}>{pos || 'Bats'}</span>
                      {avg.get(b.bid) && <span className="order-avg">{avg.get(b.bid)}</span>}
                    </button>
                  </div>
                  {open && (
                    <div className="order-tools">
                      <div className="pos-keys" role="group" aria-label={`Position for ${who(b)}`}>
                        {POS_KEYS.map((p) => (
                          <button key={p || 'bats'} type="button" className={`pos-key${pos === p ? ' on' : ''}`} aria-pressed={pos === p}
                            aria-label={p ? `Play ${p}` : 'Bats only, not in the field'} onClick={() => rowPos(i, p)}>{posLabel(p)}</button>
                        ))}
                      </div>
                      {bench.length > 0 && (
                        <div className="chips">
                          <span className="legend" style={{ alignSelf: 'center' }}>Sub in:</span>
                          {bench.map((p) => (
                            <button key={p.bid} type="button" className="chip" onClick={() => subIn({ bid: p.bid, num: p.num, name: p.name }, i)}
                              aria-label={`Sub ${p.name || `number ${p.num}`} in for ${who(b)}`}>⇄ {p.num && `#${p.num} `}{p.name}</button>
                          ))}
                        </div>
                      )}
                      <div className="order-ctl">
                        <button type="button" className="btn btn-quiet" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move ${who(b)} up`}>▲ Up</button>
                        <button type="button" className="btn btn-quiet" onClick={() => move(i, 1)} disabled={i === team.batters.length - 1} aria-label={`Move ${who(b)} down`}>▼ Down</button>
                        <span style={{ flex: 1 }} />
                        <button type="button" className="btn btn-danger" onClick={() => drop(i)} aria-label={`Take ${who(b)} out of the order`}><Cross size={14} /> Out</button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </section>

      {canEdit && bench.length > 0 && sel.idx === undefined && (
        <section className="stack" style={{ gap: 8 }}>
          <span className="legend">{cursor !== null ? `Bench · tap to bat ${ord(cursor + 1)}` : side === 'us' ? 'Bench · tap to add to the end of the order' : 'Their roster · tap to add'}</span>
          <div className="chips">
            {bench.map((p) => (
              <button key={p.bid} type="button" className="chip" onClick={() => benchTap(p)}>
                <Plus size={13} /> {p.num && `#${p.num} `}{p.name}
              </button>
            ))}
          </div>
        </section>
      )}

      {canEdit && (
        <details className="fold" open={side === 'them' && pool.length === 0 && team.batters.length === 0 && cursor === null}>
          <summary><span className="plus"><Plus /></span>{side === 'us' ? 'Add a player' : 'Add players by number'}</summary>
          <div className="fold-body stack">
            <div className={`field-row ${side === 'us' ? 'num-first' : ''}`} style={side === 'us' ? undefined : { gridTemplateColumns: '84px 1fr' }}>
              <label className="field"><span>No.</span>
                <input className="input" value={add.num} onChange={(e) => setAdd({ ...add, num: e.currentTarget.value.replace(/\D/g, '').slice(0, 3) })} inputMode="numeric" maxLength={3} />
              </label>
              {side === 'us' ? <>
                <label className="field"><span>First</span><input className="input" value={add.first} maxLength={40} onChange={(e) => setAdd({ ...add, first: e.currentTarget.value })} /></label>
                <label className="field"><span>Last</span><input className="input" value={add.last} maxLength={40} onChange={(e) => setAdd({ ...add, last: e.currentTarget.value })} /></label>
              </> : (
                <label className="field"><span>Name (optional)</span><input className="input" value={add.first} maxLength={60} onChange={(e) => setAdd({ ...add, first: e.currentTarget.value })}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void addTyped(); } }} /></label>
              )}
            </div>
            {side === 'us' && (canRoster
              ? <label className="check"><input type="checkbox" checked={add.roster} onChange={(e) => setAdd({ ...add, roster: e.target.checked })} /><span>Add to the roster, so their stats count</span></label>
              : <p className="hint">Only an organizer or head coach can add to the roster: this player is in this game only, and their stats do not count for the season.</p>)}
            {addErr && !ask && <p className="note note-bad">{addErr}</p>}
            <button type="button" className="btn btn-quiet" onClick={() => void addTyped()} disabled={adding || (!add.num && !add.first.trim() && !add.last.trim())}>
              {adding && !ask ? 'Adding…' : cursor !== null ? `Add as ${ord(cursor + 1)}` : 'Add to the order'}
            </button>
            {ai && <PhotoLineup gameId={gameId} side={side} onLines={(t) => setPaste(paste.trim() ? `${paste.trim()}\n${t}` : t)} />}
            <label className="field"><span>{ai ? 'Or paste a list, one per line (a photo fills this in for you to check)' : 'Or paste a list, one per line'}</span>
              <textarea className="textarea" value={paste} onChange={(e) => setPaste(e.currentTarget.value)} placeholder={'7 Ava Reyes SS\n12 Ben Ortiz P\n21'} style={{ minHeight: 110 }} />
            </label>
            <button type="button" className="btn btn-quiet" onClick={addPasted} disabled={!paste.trim()}>Add these</button>
          </div>
        </details>
      )}

      {canEdit && (
        <div className="lineup-dock">
          {cursor !== null && (
            <div className="card-pad" role="group" aria-label="Jersey numbers from the lineup card">
              <div className="card-pad-top">
                <b className="card-typed">{typed || '–'}</b>
                <span className="card-what" role="status">{msg || `Batter ${cursor + 1}: the number on the card`}</span>
                <button type="button" className="btn btn-quiet" onClick={finishCard}>Done</button>
              </div>
              {leftover ? (
                <div className="stack" style={{ gap: 8 }}>
                  <p className="sub">{team.batters.length - cursor} below batter {cursor} {team.batters.length - cursor === 1 ? 'was' : 'were'} not on the card.</p>
                  <div className="pgrid two">
                    <button type="button" className="btn btn-primary" onClick={() => { update(benchFrom(team, cursor), null); setLeftover(false); setMsg(''); }}>Bench them</button>
                    <button type="button" className="btn btn-quiet" onClick={() => { setCursor(null); setLeftover(false); setMsg(''); }}>Keep them batting</button>
                  </div>
                </div>
              ) : ask ? (
                <div className="stack" style={{ gap: 8 }}>
                  <p className="sub">#{ask.kid.num} is not on the {side === 'us' ? 'roster' : 'list'}. Who is it?</p>
                  <div className="field-row" style={{ gridTemplateColumns: side === 'us' ? '1fr 1fr' : '1fr' }}>
                    {side === 'us' ? <>
                      <label className="field"><span>First</span><input className="input" autoFocus value={ask.kid.first} maxLength={40} onChange={(e) => setAsk({ ...ask, kid: { ...ask.kid, first: e.target.value } })} /></label>
                      <label className="field"><span>Last</span><input className="input" value={ask.kid.last} maxLength={40} onChange={(e) => setAsk({ ...ask, kid: { ...ask.kid, last: e.target.value } })} /></label>
                    </> : <label className="field"><span>Name (optional)</span><input className="input" autoFocus value={ask.kid.first} maxLength={60} onChange={(e) => setAsk({ ...ask, kid: { ...ask.kid, first: e.target.value } })} /></label>}
                  </div>
                  {side === 'us' && canRoster && (
                    <label className="check"><input type="checkbox" checked={ask.kid.roster} onChange={(e) => setAsk({ ...ask, kid: { ...ask.kid, roster: e.target.checked } })} /><span>Add to the roster, so their stats count</span></label>
                  )}
                  {addErr && <p className="note note-bad">{addErr}</p>}
                  <div className="pgrid two">
                    <button type="button" className="btn btn-quiet" onClick={() => { setAsk(null); setAddErr(''); }} disabled={adding}>Wrong number</button>
                    <button type="button" className="btn btn-primary" onClick={() => void askDone()} disabled={adding} aria-busy={adding}>{adding ? 'Adding…' : `Add as ${ord(cursor + 1)}`}</button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="card-keys">
                    {['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'].map((k) => (
                      <button key={k} type="button" className="card-key" onClick={() => setTyped((typed + k).slice(0, 3))}>{k}</button>
                    ))}
                    <button type="button" className="card-key" aria-label="Back" onClick={() => setTyped(typed.slice(0, -1))}>⌫</button>
                    <button type="button" className="card-key next" aria-label="Next batter, keep their position" onClick={() => cardKey()}>Next</button>
                  </div>
                  <div className="card-pos" role="group" aria-label="Position, then on to the next batter">
                    {POS_KEYS.map((p) => (
                      <button key={p || 'bats'} type="button" className="card-key pos" onClick={() => cardKey(p)}
                        aria-label={p ? `Plays ${p}` : 'Bats only'}>{posLabel(p)}{holder(p) && p ? <small>{holder(p)!.num || '·'}</small> : null}</button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
          <div className="save-bar">
            <button type="button" className="btn btn-quiet" onClick={undo} disabled={!hist.length}>Undo</button>
            <span className="sub" role="status">{cursor === null && msg ? msg : status}</span>
            {dirty && (!touched || saveErr)
              ? <button type="button" className="btn btn-primary" onClick={saveNow} disabled={saving}>{touched ? 'Save' : 'Use this lineup'}</button>
              : <Link href={next.href} onNavigate={(e) => guard(e, next.href)} className="btn btn-primary">{next.label}</Link>}
          </div>
        </div>
      )}
    </div>
  );
}
