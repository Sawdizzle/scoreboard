'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { OnAir, type Channel } from '@/components/pad/OnAir';
import { airTopic } from '@/components/overlay/Overlay';
import { InPlay, More, Runner, Situation, StrikeThree } from '@/components/pad/PadSheets';
import { brandOf, opponentBrand, TeamMark } from '@/components/TeamBrand';
import * as L from '@/lib/rules/logic.js';
import { positionOf } from '@/lib/rules/roster.js';
import { engineGame, lastPlayText, onPlay, pitcherChange, record, runnersOf, sideOf, tonight, type EngineSide, type Res, type StatKey, type StatRow } from '@/lib/scoring';
import { airView } from '@/lib/onair';
import type { SeasonLine } from '@/lib/stats';
import { browserClient } from '@/lib/supabase/browser';
import type { Game, Lineup, Side, Team } from '@/lib/types';

type Line = Partial<Record<StatKey, number>>;
type Status = Game['status'];
type Item = { kind: 'play'; type: string; patch: object; payload: object; rows: StatRow[]; status: Status | null } | { kind: 'undo' };
type Sheet = null | 'k3' | 'inplay' | 'dropped' | 'more' | 'situation' | 'air' | { runner: 'first' | 'second' | 'third' };

const addRows = (t: Record<string, Line>, rows: StatRow[], sign = 1) => {
  const out = { ...t };
  for (const r of rows) {
    const line: Line = { ...(out[r.bid] ?? {}) };
    for (const [k, v] of Object.entries(r)) if (typeof v === 'number') line[k as StatKey] = (line[k as StatKey] ?? 0) + sign * v;
    out[r.bid] = line;
  }
  return out;
};
export const sumRows = (rows: StatRow[]) => addRows({}, rows);

// The scoring pad. Scoreboard's pad, rebuilt on Pressbox's lineups: BALL,
// STRIKE, FOUL and IN PLAY for the pitch; MORE for the rare ones; the runners
// on the diamond for steals; the bar above for corrections and End game.
//
// Every tap is applied here at once (the rules run in the browser) and queued
// for the database in order. A dropped connection only delays the queue; a
// play from another phone in between makes this pad reload rather than write
// over it.
export function Pad({ slug, team, game, lineups, season, tonightRows, regulation, canScore, channel }: {
  slug: string; team: Team; game: Game & { seq: number }; lineups: Partial<Record<Side, Lineup>>;
  season: SeasonLine[]; tonightRows: StatRow[]; regulation: number; canScore: boolean; channel: Channel | null;
}) {
  const sb = browserClient();
  const sides = useCallback((e: EngineSide) => sideOf(game, e), [game]);
  const [view, setView] = useState(() => ({
    g: engineGame(game, lineups, regulation), status: game.status as Status,
    tonight: sumRows(tonightRows), last: '',
  }));
  const cur = useRef(view);
  const history = useRef<{ before: typeof view; rows: StatRow[] }[]>([]);
  const queue = useRef<Item[]>([]);
  const sending = useRef(false);
  const seq = useRef(game.seq);
  const [sync, setSync] = useState<'ok' | 'sending' | 'retry'>('ok');
  const [sheet, setSheet] = useState<Sheet>(null);
  const [toast, setToast] = useState('');
  const [chan, setChan] = useState(channel);
  // The stream's page listens here: a nudge after each save, so the scorebug
  // moves with the tap instead of at its next poll.
  const wire = useRef<ReturnType<typeof sb.channel> | null>(null);
  const nudge = useCallback(() => { void wire.current?.send({ type: 'broadcast', event: 'tick', payload: {} }); }, []);
  const token = channel?.token;
  useEffect(() => {
    if (!token) return;
    const c = sb.channel(airTopic(token)).subscribe();
    wire.current = c;
    return () => { wire.current = null; void sb.removeChannel(c); };
  }, [sb, token]);

  const show = (v: typeof view) => { cur.current = v; setView(v); };
  const say = (t: string) => { setToast(t); window.setTimeout(() => setToast((x) => (x === t ? '' : x)), 3500); };

  const reload = useCallback(async () => {
    const [{ data: row }, { data: stats }] = await Promise.all([
      sb.from('games').select('live, status, seq').eq('id', game.id).single(),
      sb.from('game_stats').select('*').eq('game_id', game.id),
    ]);
    if (!row) return;
    seq.current = row.seq;
    history.current = [];
    show({ g: engineGame({ ...game, live: row.live, status: row.status }, lineups, regulation), status: row.status, tonight: sumRows((stats ?? []) as StatRow[]), last: cur.current.last });
  }, [sb, game, lineups, regulation]);

  const pump = useCallback(async () => {
    if (sending.current) return;
    sending.current = true;
    let wait = 800;
    while (queue.current.length) {
      setSync('sending');
      const it = queue.current[0];
      const { data, error } = it.kind === 'play'
        ? await sb.rpc('apply_play', { p_game: game.id, p_seq: seq.current, p_type: it.type, p_patch: it.patch, p_payload: it.payload, p_stats: it.rows, p_status: it.status })
        : await sb.rpc('undo_play', { p_game: game.id, p_seq: seq.current });
      if (error) {
        const offline = !error.code || /fetch|network/i.test(error.message);
        if (offline) {
          // Bad signal at the field: keep the play and try again, slower each time.
          setSync('retry');
          await new Promise((r) => setTimeout(r, wait));
          wait = Math.min(wait * 2, 8000);
          continue;
        }
        queue.current = [];
        await reload();
        say(error.code === 'PB409' ? 'Another phone scored a play. Reloaded the game.' : error.message || 'That play did not save. Reloaded the game.');
        break;
      }
      seq.current = (data as { seq: number }).seq;
      queue.current.shift();
      wait = 800;
      nudge();
    }
    sending.current = false;
    setSync('ok');
  }, [sb, game.id, reload, nudge]);

  // Record a play: here at once, then to the database in order.
  function commit(res: unknown, status: Status | null = null) {
    if (!canScore) return;
    const before = cur.current;
    const r = record(before.g, res as Res | null, sides);
    if (!r) return;
    history.current.push({ before, rows: r.rows });
    const nextStatus: Status = status ?? (before.status === 'scheduled' ? 'live' : before.status);
    show({ g: r.next, status: nextStatus, tonight: addRows(before.tonight, r.rows), last: lastPlayText(r.res, before.g, r.next) });
    queue.current.push({ kind: 'play', type: r.res.type, patch: r.patch, payload: r.res.payload ?? {}, rows: r.rows, status });
    if (navigator.vibrate) navigator.vibrate(12);
    setSheet(null);
    void pump();
  }

  function undo() {
    if (!canScore) return;
    const h = history.current.pop();
    if (h) show({ ...h.before, last: `Undone: ${cur.current.last || 'last play'}` });
    queue.current.push({ kind: 'undo' });
    void pump().then(() => { if (!h) void reload(); });
  }

  function endGame(final: boolean) {
    const before = cur.current;
    history.current.push({ before, rows: [] });
    show({ ...before, status: final ? 'final' : 'live', last: final ? 'Game ended' : 'Game reopened' });
    queue.current.push({ kind: 'play', type: final ? 'end_game' : 'reopen_game', patch: {}, payload: {}, rows: [], status: final ? 'final' : 'live' });
    setSheet(null);
    void pump();
  }

  // What the stream shows: here at once, then saved. Any seat can run it.
  async function air(patch: Partial<Channel>) {
    const before = chan;
    if (!before) return;
    setChan({ ...before, ...patch });
    const { error } = await sb.from('channels').update(patch).eq('team_id', team.id);
    if (error) { setChan(before); say('That did not reach the stream. Try again.'); return; }
    nudge();
  }

  // A pitching change made on the lineup screen moves the pitch count over.
  useEffect(() => {
    const res = pitcherChange(cur.current.g);
    if (res && cur.current.status === 'live') commit(res);
    // Once, when the pad opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Leaving with plays still waiting would lose them: ask first.
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (queue.current.length) e.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);

  const { g, status } = view;
  const final = status === 'final';
  const locked = final || !canScore;
  const batSide = L.battingSide(g) as EngineSide, fieldSide = L.fieldingSide(g) as EngineSide;
  const batLineup = g.lineups[batSide], fieldLineup = g.lineups[fieldSide];
  const bIdx = L.currentBatterIdx(g, batSide);
  const batter = batLineup?.batters?.[bIdx];
  const pitcherBidNow = fieldLineup?.positions?.P;
  const pitcher = fieldLineup?.batters?.find((b) => b.bid === pitcherBidNow) ?? null;
  const usB = brandOf(team), themB = opponentBrand(game);
  const [awayB, homeB] = game.is_home ? [themB, usB] : [usB, themB];
  const runners = runnersOf(g);
  const b = L.safeBases(g.bases);
  const numOf = (bid: string | null, side: EngineSide) => (bid ? g.lineups[side]?.batters?.find((x) => x.bid === bid)?.num ?? '' : '');
  const seasonBy = useMemo(() => Object.fromEntries(season.map((l) => [l.player_id, l])), [season]);
  const onAir = airView(g, { tonight: view.tonight, season: seasonBy, pas: [], gameInnings: regulation });
  const dots = (n: number, of: number, color: string) => Array.from({ length: of }, (_, i) => <i key={i} style={{ background: i < n ? color : undefined }} />);

  const press = {
    ball: () => { const r = L.onBall(g) as Res; if (r.sheet === 'walk') { const w = L.computeWalk(g.bases); commit({ type: 'walk', patch: L.endPA(g, { balls: 0, strikes: 0, bases: w.bases, ...L.runsPatch(g, w.runs) }), payload: { runs: w.runs, play: L.playNote(g, 'BB', { runs: w.runs }) } }); say(w.runs ? `Walk · ${w.runs} run forced in` : 'Walk'); } else commit(r); },
    strike: () => ((g.strikes | 0) >= 2 ? setSheet('k3') : commit(L.onStrike(g))),
    foul: () => commit(L.onFoul(g)),
  };

  return (
    <div className="pad">
      <header className="pad-head">
        <Link href={`/t/${slug}/games/${game.id}`} aria-label="Leave the pad" className="icon-btn">‹</Link>
        <div className="pad-score">
          {[['away', awayB], ['home', homeB]].map(([side, br]) => (
            <span key={side as string} className={`pad-team${batSide === side ? ' bat' : ''}`}>
              <TeamMark brand={br as typeof usB} size={28} />
              <span className="pad-name">{(br as typeof usB).display}</span>
              <b>{side === 'away' ? g.away_score : g.home_score}</b>
            </span>
          ))}
        </div>
        <span className={`pad-sync ${sync}`} role="status" aria-label={sync === 'ok' ? 'Saved' : sync === 'sending' ? 'Saving' : 'Waiting for signal'} />
      </header>

      <button type="button" className="pad-sit" onClick={() => setSheet('situation')} disabled={!canScore}>
        <span className="pad-inning">{g.half === 'top' ? '▲' : '▼'} {g.inning}</span>
        <span className="pad-count">
          <span><em>B</em>{dots(g.balls | 0, 3, '#35d07f')}</span>
          <span><em>S</em>{dots(g.strikes | 0, 2, '#e5534b')}</span>
          <span><em>O</em>{dots(g.outs | 0, 2, '#e0a92a')}</span>
        </span>
        <span className="pad-edit">{final ? 'FINAL ›' : 'FIX ›'}</span>
      </button>

      <Link href={`/t/${slug}/games/${game.id}/lineup?side=${sideOf(game, batSide)}`} className="pad-batter">
        <span className="pad-num">{batter?.num ? `#${batter.num}` : '—'}</span>
        <span className="row-main">
          <span className="row-title">{batter?.name || (batter ? `No. ${batter.num}` : 'No lineup: tap to set it')}
            {batter && <small>{positionOf(batLineup, bIdx) || ''}</small>}</span>
          <span className="pad-line">
            {onAir.batter?.avg && <b>{onAir.batter.avg}</b>}
            {batter && <span>{tonight(view.tonight[batter.bid]) || 'First time up'}</span>}
          </span>
        </span>
        <span className="pad-pitcher">
          <small>{pitcher ? `#${pitcher.num} ${pitcher.name.split(' ').pop() ?? ''}` : 'Pitcher'}</small>
          <b>{L.pitchCount(g)}</b>
        </span>
      </Link>

      <div className="pad-last" role="status">{toast || view.last || (status === 'scheduled' ? 'First pitch starts the game.' : '')}</div>

      <div className="pad-keys">
        <button type="button" className="pkey ball" onClick={press.ball} disabled={locked}>BALL</button>
        <button type="button" className="pkey strike" onClick={press.strike} disabled={locked}>STRIKE</button>
        <button type="button" className="pkey foul" onClick={press.foul} disabled={locked}>FOUL</button>
        <button type="button" className="pkey inplay" onClick={() => setSheet('inplay')} disabled={locked}>IN PLAY</button>
        <button type="button" className="pkey more" onClick={() => setSheet('more')} disabled={locked}>MORE ▾</button>
        <div className="pkey diamond" aria-label="Runners">
          {(['second', 'third', 'first'] as const).map((k) => (
            <button key={k} type="button" className={`pbase ${k}${b[k] ? ' on' : ''}`} disabled={!b[k] || locked}
              onClick={() => setSheet({ runner: k })} aria-label={b[k] ? `Runner on ${k}${runners[k] ? `, number ${numOf(runners[k], batSide)}` : ''}` : `${k} empty`}>
              <i />{b[k] && <small>{numOf(runners[k], batSide)}</small>}
            </button>
          ))}
        </div>
      </div>

      <nav className="pad-bar">
        <button type="button" className="pbar undo" onClick={undo} disabled={!canScore || (status === 'scheduled' && !view.last)}>Undo</button>
        <Link className="pbar" href={`/t/${slug}/games/${game.id}/lineup?side=${sideOf(game, fieldSide)}`}>Field</Link>
        <Link className="pbar" href={`/t/${slug}/games/${game.id}`}>Game</Link>
        {chan && <button type="button" className={`pbar air${chan.card ? ' on' : ''}`} onClick={() => setSheet('air')}>On Air</button>}
      </nav>

      {sheet === 'k3' && <StrikeThree g={g} onClose={() => setSheet(null)} onPick={(k) => {
        // A dropped third strike is a ball in play for the runners: the batter may run.
        if (k === 'dropped') setSheet('dropped'); else commit(L.onStrike(g, { looking: k === 'look' }));
      }} />}
      {(sheet === 'inplay' || sheet === 'dropped') && <InPlay g={g} start={sheet === 'dropped' ? { kind: 'K3', pos: 'C' } : undefined} onClose={() => setSheet(null)} onRecord={({ kind, pos, dest }) => {
        if (kind === 'HR') { const runs = L.computeHomeRun(g.bases).runs; commit({ type: 'homerun', patch: L.homeRunPatch(g, runs), payload: { runs, play: L.playNote(g, 'HR', { runs }) }, text: runs > 1 ? `Home run · ${runs} runs` : 'Home run' }); }
        else commit(onPlay(g, { kind, pos, dest }));
      }} />}
      {sheet === 'more' && <More g={g} onClose={() => setSheet(null)} onPick={(k) => {
        commit(k === 'hbp' ? L.onHitByPitch(g) : k === 'ci' ? L.onCatcherInterference(g) : k === 'ibb' ? L.onIntentionalWalk(g) : L.onBalk(g));
      }} />}
      {sheet && typeof sheet === 'object' && <Runner g={g} from={sheet.runner} who={numOf(runners[sheet.runner], batSide) ? `#${numOf(runners[sheet.runner], batSide)}` : ''}
        onClose={() => setSheet(null)} onPick={(k) => commit(k === 'BI' ? L.onBatterInterference(g, sheet.runner) : L.onRunnerPlay(g, sheet.runner, k))} />}
      {sheet === 'air' && chan && <OnAir channel={chan} gameId={game.id} view={onAir} brand={batSide === 'home' ? homeB : awayB}
        when={`${g.half === 'top' ? 'Top' : 'Bottom'} ${g.inning}`} live={status === 'live'} final={final}
        score={`${awayB.display} ${g.away_score | 0} · ${homeB.display} ${g.home_score | 0}`} onSet={air} onClose={() => setSheet(null)} />}
      {sheet === 'situation' && <Situation g={g} final={final} labels={{ away: awayB.display, home: homeB.display }}
        onClose={() => setSheet(null)} onFix={(r) => { if (r) { commit(r); setSheet('situation'); } }} onEnd={endGame} />}
    </div>
  );
}
