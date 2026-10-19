'use client';

import { useEffect, useState } from 'react';
import { FielderPicker, Sheet } from '@/components/pad/PadSheets';
import * as L from '@/lib/rules/logic.js';
import { canRefield, pitchCounts, playList, type LogEvent, type LogStat, type PlayRow } from '@/lib/plays';
import { fieldersOf, fieldingCredit } from '@/lib/scoring';
import type { Lineup, LineupBatter, Side } from '@/lib/types';

export type Log = { events: LogEvent[]; stats: LogStat[] };
type Role = 'batter' | 'runner' | 'pitcher';
type Pick = { id: number; role: Role; side: Side; from: string };

// The Plays tab, as GameChanger keeps it: every play newest first, by half
// inning, and Edit on each. Edit fixes who was credited (the batter, a runner,
// the pitcher) or which fielders made it (a new code). The game itself does
// not move: a wrong outcome is still Undo's to fix.
export function PlaysSheet({ load, battingSide, labels, nameOf, choices, positionsNow, onCredit, onRefield, onClose }: {
  load: () => Promise<Log | null>;
  battingSide: (half: 'top' | 'bottom') => Side;
  labels: Record<Side, string>;
  nameOf: (bid: string | null) => string;
  // Who can be credited instead, on a side: its order and (ours) the bench.
  choices: (side: Side) => LineupBatter[];
  positionsNow: (side: Side) => Record<string, string>;
  onCredit: (event: number, side: Side, from: string, to: string) => Promise<string | null>;
  onRefield: (event: number, side: Side, code: string, rows: { bid: string; f_po: number; f_a: number; f_e: number; c_pik: number }[]) => Promise<string | null>;
  onClose: () => void;
}) {
  const [log, setLog] = useState<Log | null>(null);
  const [err, setErr] = useState('');
  const [openId, setOpenId] = useState<number | null>(null);
  const [pick, setPick] = useState<Pick | null>(null);
  const [seq, setSeq] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  // Read again after every fix: the list shows what was saved.
  const [reads, setReads] = useState(0);
  useEffect(() => {
    let live = true;
    void load().then((got) => {
      if (!live) return;
      if (got) { setLog(got); setErr(''); } else setErr('The plays did not load. Check the signal and try again.');
    });
    return () => { live = false; };
  }, [load, reads]);
  const rows = log ? playList(log.events, log.stats, battingSide) : null;
  const open = openId === null ? null : rows?.find((r) => r.id === openId) ?? null;
  const saved = () => { setPick(null); setSeq(null); setReads((n) => n + 1); };

  if (pick && open) {
    const taken = new Set([open.batter, ...open.runners, open.pitcher, ...open.fielders].filter(Boolean) as string[]);
    const can = choices(pick.side).filter((b) => !taken.has(b.bid) && (b.num || b.name));
    return (
      <Sheet title={`Who was the ${pick.role}?`} onClose={onClose}>
        <p className="hint">Credited now: {nameOf(pick.from)}. Everything this play gave him goes to the one you pick.</p>
        {err && <p className="note note-bad">{err}</p>}
        <div className="chips">
          {can.map((b) => (
            <button key={b.bid} type="button" className="chip" disabled={busy} onClick={async () => {
              setBusy(true);
              const e = await onCredit(pick.id, pick.side, pick.from, b.bid);
              setBusy(false);
              if (e) setErr(e); else saved();
            }}>{b.num && `#${b.num} `}{b.name}</button>
          ))}
        </div>
        {!can.length && <p className="note note-plain">Nobody else on {labels[pick.side]} to give it to.</p>}
        <button type="button" className="link" onClick={() => { setPick(null); setErr(''); }}>‹ Back</button>
      </Sheet>
    );
  }

  if (open && seq) {
    const p = open;
    const field = p.field ?? positionsNow(p.fieldSide);
    const fieldLineup: Lineup = { batters: choices(p.fieldSide), positions: field };
    const code = L.seqCode(seq, p.kind) as string;
    const save = async () => {
      const credit = fieldingCredit(p.kind, code, p.outs);
      const by = new Map<string, { bid: string; f_po: number; f_a: number; f_e: number; c_pik: number }>();
      const add = (pos: string, k: 'f_po' | 'f_a' | 'f_e' | 'c_pik') => {
        const bid = field[pos];
        if (!bid) return;
        const r = by.get(bid) ?? { bid, f_po: 0, f_a: 0, f_e: 0, c_pik: 0 };
        r[k] += 1;
        by.set(bid, r);
      };
      credit.po.forEach((x) => add(x, 'f_po'));
      credit.a.forEach((x) => add(x, 'f_a'));
      credit.e.forEach((x) => add(x, 'f_e'));
      if (p.kind === 'PO' && fieldersOf(code)[0] === 'C') add('C', 'c_pik');
      setBusy(true);
      const e = await onRefield(p.id, p.fieldSide, code, [...by.values()]);
      setBusy(false);
      if (e) setErr(e); else saved();
    };
    return (
      <Sheet title={`Fielders: ${p.text}`} onClose={onClose}>
        <FielderPicker lineup={fieldLineup} value={seq} onChange={setSeq} kind={p.kind} given="as scored" />
        {!p.field && <p className="hint">This play is from before the pad kept who stood where: credit goes to whoever plays each spot now.</p>}
        {err && <p className="note note-bad">{err}</p>}
        <button type="button" className="btn btn-primary btn-big" disabled={busy || (!seq.length && p.kind !== 'BO')} onClick={save}>
          {busy ? 'Saving…' : `Save · ${(L.PLAY_LABEL as Record<string, string>)[p.kind] ?? p.kind} ${code}`}
        </button>
        <button type="button" className="link" onClick={() => { setSeq(null); setErr(''); }}>‹ Back</button>
      </Sheet>
    );
  }

  if (open) {
    const p = open;
    const line = (label: string, bid: string | null, role: Role, side: Side) => bid && (
      <div className="atbat-row" key={`${role}${bid}`}>
        <span className="atbat-pick" style={{ cursor: 'default' }}>
          <span className="atbat-name">{nameOf(bid)}<small>{label}</small></span>
        </span>
        <button type="button" className="link atbat-fix" onClick={() => setPick({ id: p.id, role, side, from: bid })}>Change</button>
      </div>
    );
    return (
      <Sheet title={p.text} onClose={onClose}>
        <p className="eyebrow">{p.half === 'top' ? 'Top' : 'Bottom'} {p.inning} · {labels[p.batSide]} batting</p>
        <div className="atbat-list">
          {line('Batter', p.batter, 'batter', p.batSide)}
          {p.runners.map((r) => line('Runner', r, 'runner', p.batSide))}
          {line('Pitcher', p.pitcher, 'pitcher', p.fieldSide)}
          {canRefield(p.kind) && (
            <div className="atbat-row">
              <span className="atbat-pick" style={{ cursor: 'default' }}>
                <span className="atbat-name">{p.code || 'No fielders'}<small>Fielders{p.fielders.length ? `: ${p.fielders.map(nameOf).join(', ')}` : ''}</small></span>
              </span>
              <button type="button" className="link atbat-fix" onClick={() => setSeq(fieldersOf(p.code))}>Change</button>
            </div>
          )}
        </div>
        <p className="hint">A wrong outcome (a single that was an error) is Undo&apos;s to fix: undo back to it and score it again.</p>
        <button type="button" className="link" onClick={() => setOpenId(null)}>‹ All plays</button>
      </Sheet>
    );
  }

  // The list, by half inning, newest first.
  const groups: { key: string; title: string; plays: PlayRow[] }[] = [];
  for (const r of rows ?? []) {
    const key = `${r.inning}${r.half}`;
    let grp = groups.find((x) => x.key === key);
    if (!grp) { grp = { key, title: `${r.half === 'top' ? 'Top' : 'Bottom'} ${r.inning} · ${labels[r.batSide]}`, plays: [] }; groups.push(grp); }
    grp.plays.push(r);
  }
  return (
    <Sheet title="Plays" onClose={onClose} close="Done">
      {err && <p className="note note-bad">{err}</p>}
      {!rows && !err && <p className="note note-plain">Loading the plays…</p>}
      {rows && !rows.length && <p className="note note-plain">No plays yet.</p>}
      {groups.map((grp) => (
        <div key={grp.key} className="stack" style={{ gap: 6 }}>
          <span className="legend">{grp.title}</span>
          <div className="atbat-list">
            {grp.plays.map((r) => (
              <div key={r.id} className="atbat-row">
                <button type="button" className="atbat-pick" onClick={() => setOpenId(r.id)}>
                  <span className="atbat-name">{r.text}<small>{nameOf(r.batter ?? r.runners[0] ?? null)}</small></span>
                </button>
                <button type="button" className="link atbat-fix" onClick={() => setOpenId(r.id)}>Edit</button>
              </div>
            ))}
          </div>
        </div>
      ))}
    </Sheet>
  );
}

// Pitch counts by inning, as GameChanger shows them from the pitcher's card:
// each pitcher's total, the share of strikes, and how many in each inning.
export function PitchCounts({ load, labels, nameOf }: { load: () => Promise<Log | null>; labels: Record<Side, string>; nameOf: (bid: string | null) => string }) {
  const [lines, setLines] = useState<ReturnType<typeof pitchCounts> | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    let live = true;
    void load().then((log) => {
      if (!live) return;
      if (!log) setErr('The pitch counts did not load. Check the signal and try again.');
      else setLines(pitchCounts(log.events, log.stats));
    });
    return () => { live = false; };
  }, [load]);
  if (err) return <p className="note note-bad">{err}</p>;
  if (!lines) return <p className="note note-plain">Counting…</p>;
  if (!lines.length) return <p className="note note-plain">No pitches yet.</p>;
  return (
    <div className="stack" style={{ gap: 10 }}>
      {(['us', 'them'] as const).map((side) => {
        const mine = lines.filter((l) => l.side === side);
        return mine.length > 0 && (
          <div key={side} className="stack" style={{ gap: 6 }}>
            <span className="legend">{labels[side]}</span>
            {mine.map((l) => (
              <div key={l.bid} className="pc-row">
                <span className="pc-who"><b>{nameOf(l.bid)}</b><small>{l.total} pitches · {Math.round((l.strikes / l.total) * 100)}% strikes</small></span>
                <span className="pc-inn">{Object.entries(l.innings).map(([i, c]) => <span key={i}><small>{i}</small>{c}</span>)}</span>
              </div>
            ))}
          </div>
        );
      })}
      <p className="hint">Pitch counts fixed by hand on the Situation sheet are in the total on the pad, not in this split.</p>
    </div>
  );
}
