'use client';

import { useActionState, useEffect, useMemo, useState } from 'react';
import { PhotoLineup } from '@/components/PhotoLineup';
import { saveLineup } from '@/app/actions';
import { Cross, Plus } from '@/components/icons';
import { FIELD } from '@/lib/lineup';
import { parseRoster } from '@/lib/roster-parse';
import { assignSpot, missingPositions, newBid, normalizeTeam, positionOf, setPosition, slotAt, swapBatters } from '@/lib/rules/roster.js';
import type { FormState, Lineup, LineupBatter, Side } from '@/lib/types';

export type PoolPlayer = LineupBatter & { avg?: string };

// Where each spot sits on the drawn field (358 × 200).
const SPOT: Record<string, [number, number]> = {
  CF: [179, 28], LF: [78, 50], RF: [280, 50], SS: [130, 86], '2B': [228, 86],
  '3B': [96, 132], '1B': [262, 132], P: [179, 125], C: [179, 175],
};

// The batting order and the field for one side. The lineup lives here while it
// is edited (Scoreboard's roster rules do every move) and goes to the server
// whole, on Save. Positions trade on a clash: put the shortstop at second and
// whoever was at second goes to short, the way kids actually rotate.
// `stored` is false when `initial` is only a suggestion (last game's lineup, or
// the roster in number order): it shows as unsaved until Save.
export function LineupEditor({ slug, gameId, side, initial, stored, pool, presets, canEdit, ai = false }: {
  slug: string; gameId: string; side: Side; initial: Lineup; stored: boolean; pool: PoolPlayer[];
  presets: { label: string; lineup: Lineup }[]; canEdit: boolean;
  // AI on for this team: a lineup card can be read from a photo.
  ai?: boolean;
}) {
  const [team, setTeam] = useState<Lineup>(() => normalizeTeam(initial));
  const [saved, setSaved] = useState(() => (stored ? JSON.stringify(normalizeTeam(initial)) : ''));
  const [sel, setSel] = useState<{ pos?: string; idx?: number }>({});
  const [num, setNum] = useState('');
  const [name, setName] = useState('');
  const [paste, setPaste] = useState('');
  // The lineup card handed over at game time: jersey numbers in batting order
  // on a keypad. A number on the roster brings that player; any other is typed in.
  const [keypad, setKeypad] = useState(false);
  const [typed, setTyped] = useState('');
  const [state, run, pending] = useActionState(
    async (prev: FormState, fd: FormData) => {
      const r = await saveLineup(slug, gameId, side, prev, fd);
      if (r.ok) setSaved(String(fd.get('lineup')));
      return r;
    }, {});

  const json = JSON.stringify(team);
  const dirty = json !== saved;
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const avg = useMemo(() => new Map(pool.map((p) => [p.bid, p.avg])), [pool]);
  const inOrder = new Set(team.batters.map((b) => b.bid));
  const bench = pool.filter((p) => !inOrder.has(p.bid));
  const missing = missingPositions(team) as string[];
  const holder = (pos: string) => { const i = slotAt(team, pos); return i >= 0 ? team.batters[i] : null; };

  const update = (t: Lineup) => setTeam(normalizeTeam(t));
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
  // The selection follows the player, so a kid can go up three spots in three taps.
  const move = (i: number, d: number) => { const j = i + d; if (j >= 0 && j < team.batters.length) { update(swapBatters(team, i, j)); setSel({ idx: j }); } };
  function drop(i: number) {
    const b = team.batters[i];
    const positions = Object.fromEntries(Object.entries(team.positions).filter(([, bid]) => bid !== b.bid));
    update({ ...team, batters: team.batters.filter((_, j) => j !== i), positions });
    setSel({});
  }
  const add = (b: LineupBatter) => update({ ...team, batters: [...team.batters, b] });
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
  }
  const picked = sel.idx !== undefined ? team.batters[sel.idx] : undefined;
  const benchTap = (p: PoolPlayer) => {
    const b = { bid: p.bid, num: p.num, name: p.name };
    if (canEdit && sel.idx !== undefined && picked) subIn(b, sel.idx); else add(b);
  };
  function addTyped() {
    const n = num.replace(/\D/g, '').slice(0, 3);
    if (!n && !name.trim()) return;
    add({ bid: newBid(), num: n, name: name.trim().slice(0, 60) });
    setNum(''); setName('');
  }
  function keyNext() {
    const n = typed.replace(/\D/g, '').slice(0, 3);
    if (!n) return;
    const p = pool.find((x) => x.num === n && !team.batters.some((b) => b.bid === x.bid));
    add(p ? { bid: p.bid, num: p.num, name: p.name } : { bid: newBid(), num: n, name: '' });
    setTyped('');
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
      const last = (v: string) => low(v).split(/\s+/).pop() ?? '';
      const known = pool.find((x) => free(x) && !!name && low(x.name) === low(name))
        ?? pool.find((x) => free(x) && !!p.number && x.num === p.number && (!name || !x.name || last(x.name) === last(name)));
      const b = known ? { bid: known.bid, num: known.num, name: known.name } : { bid: newBid(), num: p.number, name };
      t.batters.push(b);
      const pos = p.positions.find((x) => FIELD.includes(x));
      if (pos) t = setPosition(t, t.batters.length - 1, pos).team;
    }
    update(t);
    setPaste('');
  }

  const hint = sel.pos
    ? `Who plays ${sel.pos}? Tap a player in the order.`
    : sel.idx !== undefined
      ? `Tap a spot for ${team.batters[sel.idx]?.name || `#${team.batters[sel.idx]?.num}`}, a bench player to sub in, or move them with the arrows.`
      : canEdit ? 'Tap a spot, then a player. Tap a player to move them in the order.' : 'View only for your seat.';

  return (
    <div className="stack" style={{ gap: 12 }}>
      {canEdit && presets.length > 0 && (
        <div className="chips">
          {presets.map((p) => (
            <button key={p.label} type="button" className="chip" onClick={() => { update(p.lineup); setSel({}); }}>{p.label}</button>
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

      <div className="h-row" style={{ padding: '0 4px', alignItems: 'center' }}>
        <span className="sub" role="status">{hint}</span>
        {sel.pos && holder(sel.pos) && (
          <button type="button" className="link" onClick={() => { update(setPosition(team, slotAt(team, sel.pos!), '').team); setSel({}); }}>Clear {sel.pos}</button>
        )}
      </div>

      <section>
        <div className="col-head">
          <span style={{ flex: '0 0 18px' }}>#</span>
          <span style={{ flex: 1 }}>Batting order · {team.batters.length}</span>
          {missing.length > 0 && missing.length < 9 && <span className="tag gold">Open: {missing.join(' ')}</span>}
        </div>
        {team.batters.length === 0 ? (
          <div className="card empty"><b>Nobody in the order yet</b>{bench.length ? 'Tap players below to add them.' : 'Add players by number and name below.'}</div>
        ) : (
          <ol className="order">
            {team.batters.map((b, i) => {
              const pos = positionOf(team, i) as string;
              return (
                <li key={b.bid} className={`order-row${sel.idx === i ? ' on' : ''}`}>
                  <span className="order-n">{i + 1}</span>
                  <button type="button" className="order-who" onClick={() => tapRow(i)} disabled={!canEdit} aria-pressed={sel.idx === i}>
                    <span className="jersey">{b.num || '–'}</span>
                    <span className="row-title">{b.name || `No. ${b.num}`}</span>
                    <span className={`tag${pos ? '' : ' dim'}`}>{pos || 'Bats'}</span>
                    {avg.get(b.bid) && <span className="order-avg">{avg.get(b.bid)}</span>}
                  </button>
                  {canEdit && sel.idx === i && (
                    <span className="order-ctl">
                      <button type="button" className="icon-btn sm" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move ${b.name || b.num} up`}>▲</button>
                      <button type="button" className="icon-btn sm" onClick={() => move(i, 1)} disabled={i === team.batters.length - 1} aria-label={`Move ${b.name || b.num} down`}>▼</button>
                      <button type="button" className="icon-btn sm" onClick={() => drop(i)} aria-label={`Take ${b.name || b.num} out of the order`}><Cross size={14} /></button>
                    </span>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </section>

      {canEdit && bench.length > 0 && (
        <section className="stack" style={{ gap: 8 }}>
          <span className="legend">{picked
            ? `Bench · tap to sub in for ${picked.name || `#${picked.num}`} (same spot in the order${positionOf(team, sel.idx!) ? ` and ${positionOf(team, sel.idx!)}` : ''})`
            : side === 'us' ? 'Bench · tap to add to the end of the order' : 'Their roster · tap to add'}</span>
          <div className="chips">
            {bench.map((p) => (
              <button key={p.bid} type="button" className="chip" onClick={() => benchTap(p)}
                aria-label={picked ? `Sub ${p.name || `number ${p.num}`} in for ${picked.name || `number ${picked.num}`}` : undefined}>
                {picked ? '⇄' : <Plus size={13} />} {p.num && `#${p.num} `}{p.name}
              </button>
            ))}
          </div>
        </section>
      )}

      {canEdit && (
        <section className="stack" style={{ gap: 8 }}>
          <button type="button" className="btn btn-quiet" onClick={() => setKeypad(!keypad)} aria-expanded={keypad}>
            {keypad ? 'Done with the keypad' : 'Jersey numbers keypad'}
          </button>
          {keypad && (
            <div className="keypad" role="group" aria-label="Jersey number keypad">
              <div className="keypad-typed"><b>{typed || '–'}</b><span>Batter {team.batters.length + 1} · the number on their back</span></div>
              {['1', '2', '3', '4', '5', '6', '7', '8', '9', 'del', '0', 'next'].map((k) => (
                <button key={k} type="button" className={`keypad-key${k === 'next' ? ' next' : ''}`}
                  aria-label={k === 'del' ? 'Back' : k === 'next' ? 'Next batter' : k}
                  onClick={() => (k === 'del' ? setTyped(typed.slice(0, -1)) : k === 'next' ? keyNext() : setTyped((typed + k).slice(0, 3)))}>
                  {k === 'del' ? '⌫' : k === 'next' ? 'Next ↵' : k}
                </button>
              ))}
            </div>
          )}
        </section>
      )}

      {canEdit && (
        <details className="fold" open={side === 'them' && pool.length === 0 && team.batters.length === 0}>
          <summary><span className="plus"><Plus /></span>{side === 'us' ? 'Add a player not on the roster' : 'Add players by number'}</summary>
          <div className="fold-body stack">
            <div className="field-row num-first" style={{ gridTemplateColumns: '84px 1fr auto' }}>
              <label className="field"><span>No.</span>
                <input className="input" value={num} onChange={(e) => setNum(e.currentTarget.value)} inputMode="numeric" maxLength={3}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTyped(); } }} />
              </label>
              <label className="field"><span>Name (optional)</span>
                <input className="input" value={name} onChange={(e) => setName(e.currentTarget.value)} maxLength={60}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTyped(); } }} />
              </label>
              <button type="button" className="btn btn-quiet" style={{ alignSelf: 'end' }} onClick={addTyped}>Add</button>
            </div>
            {ai && <PhotoLineup gameId={gameId} side={side} onLines={(t) => setPaste(paste.trim() ? `${paste.trim()}\n${t}` : t)} />}
            <label className="field"><span>{ai ? 'Or paste a list, one per line (a photo fills this in for you to check)' : 'Or paste a list, one per line'}</span>
              <textarea className="textarea" value={paste} onChange={(e) => setPaste(e.currentTarget.value)} placeholder={'7 Ava Reyes SS\n12 Ben Ortiz P\n21'} style={{ minHeight: 110 }} />
            </label>
            <button type="button" className="btn btn-quiet" onClick={addPasted} disabled={!paste.trim()}>Add these</button>
          </div>
        </details>
      )}

      {canEdit && (
        <form action={run} className="save-bar">
          <input type="hidden" name="lineup" value={json} />
          <span className="sub" role="status">
            {state.error ? <span className="bad">{state.error}</span> : dirty ? 'Not saved yet' : state.ok ? 'Saved' : 'Saved'}
          </span>
          <button type="submit" className="btn btn-primary" disabled={!dirty || pending}>{pending ? 'Saving…' : 'Save lineup'}</button>
        </form>
      )}
    </div>
  );
}
