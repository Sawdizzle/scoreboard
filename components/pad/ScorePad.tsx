'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { airTopic } from '@/components/overlay/Overlay';
import { GameClock } from '@/components/pad/GameClock';
import { ObsPanel } from '@/components/pad/ObsPanel';
import { AirFrame, Moments, ScenesControl, type Channel } from '@/components/pad/OnAir';
import { brandOf, opponentBrand, TeamMark } from '@/components/TeamBrand';
import { clockSet, clockText, mergeBroadcast, type Broadcast, type BroadcastPatch } from '@/lib/broadcast';
import { Basketball as B, Football as F, PERIOD_MINUTES, periodName, Soccer as S, soccerSeconds, sportGame, sportSaid, situationText, Volleyball as V,
  type SideKey, type SportLive, type SportRes } from '@/lib/sports';
import { browserClient } from '@/lib/supabase/browser';
import { keep as keepQueue, newCid, pumpQueue, readKept, type QueueItem } from '@/lib/play-queue';
import type { Game, Team } from '@/lib/types';
import { CONSOLE, useMedia } from '@/lib/use-media';

type Status = Game['status'];
type Sport = Exclude<Game['sport'], 'baseball'>;

// Soccer's match clock runs inside the play state: starting or stopping it is
// a play, as it was in v4, so it reaches the stream with the score.
function matchClock(live: SportLive) {
  const t = Date.now();
  const g = sportGame(live);
  const running = (S.scState(g) as { clock: { running: boolean } }).clock.running;
  return running ? S.clockPause(g, t) : S.clockStart(g, new Date(t).toISOString());
}

// The pad for football, soccer, basketball and volleyball: v4's pads on v4's
// rules, one tap per thing that happened. Taps show at once and save in order
// through apply_play and undo_play, as a baseball play does. A rule that names
// a moment (a touchdown, a three, a set won) sends it as the play's kind, so
// the stream can play it.
export function ScorePad({ slug, team, game, canScore, canWrite = false, channel }: {
  slug: string; team: Team; game: Game & { seq: number }; canScore: boolean; canWrite?: boolean; channel: Channel | null;
}) {
  const sb = browserClient();
  const token = channel?.token ?? null;
  const [bc, setBc] = useState<Broadcast>(channel?.broadcast ?? {});
  const [air, setAir] = useState(false);
  // A tablet or bigger keeps On Air open as a console beside the keys.
  const wide = useMedia(CONSOLE);
  const sport = game.sport as Sport;
  const [live, setLive] = useState<SportLive>(game.live as SportLive);
  const [status, setStatus] = useState<Status>(game.status);
  const [last, setLast] = useState('');
  const [sync, setSync] = useState<'ok' | 'sending' | 'retry'>('ok');
  const [waiting, setWaiting] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const cur = useRef({ live, status });
  const queue = useRef<QueueItem[]>([]);
  const sending = useRef(false);
  const seq = useRef(game.seq);
  const sentOnce = useRef(new WeakSet<QueueItem>());
  const pumpRef = useRef<() => Promise<void>>(async () => {});
  const wire = useRef<ReturnType<typeof sb.channel> | null>(null);
  const follow = useRef<() => void>(() => {});
  const nudge = () => void wire.current?.send({ type: 'broadcast', event: 'tick', payload: {} });

  useEffect(() => {
    if (!token) return;
    const c = sb.channel(airTopic(token)).on('broadcast', { event: 'tick' }, () => follow.current()).subscribe();
    wire.current = c;
    return () => { wire.current = null; void sb.removeChannel(c); };
  }, [sb, token]);

  const show = (l: SportLive, s: Status) => { cur.current = { live: l, status: s }; setLive(l); setStatus(s); };
  const reload = useCallback(async () => {
    const { data: row } = await sb.from('games').select('live, status, seq').eq('id', game.id).single();
    if (row) { seq.current = row.seq; show(row.live as SportLive, row.status as Status); }
  }, [sb, game.id]);

  // Another phone's save, or coming back to the app: take the game as it is now.
  useEffect(() => { follow.current = () => { if (!queue.current.length && !sending.current) void reload(); }; });
  useEffect(() => {
    const back = () => {
      if (document.hidden) return;
      if (!queue.current.length && !sending.current) void reload(); else void pumpRef.current();
    };
    document.addEventListener('visibilitychange', back);
    window.addEventListener('online', back);
    return () => { document.removeEventListener('visibilitychange', back); window.removeEventListener('online', back); };
  }, [reload]);
  // Soccer's running clock is drawn here, from the play state.
  const running = sport === 'soccer' && !!(S.scState(live) as { clock: { running: boolean } }).clock.running;
  useEffect(() => {
    if (!running) return;
    const t = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(t);
  }, [running]);

  // Plays wait in order on the phone (lib/play-queue) until each one saves:
  // bad signal retries, a lost reply is found by its play id, and a reload or
  // a closed tab picks the queue back up.
  const pump = useCallback(async () => {
    if (sending.current) return;
    sending.current = true;
    const st = {
      get items() { return queue.current; },
      get seq() { return seq.current; }, set seq(v: number) { seq.current = v; },
      sentOnce: sentOnce.current,
    };
    const keep = () => keepQueue(game.id, { items: queue.current, seq: seq.current });
    const { resync, failed } = await pumpQueue(st, {
      send: (it, at, stop) => it.kind === 'play'
        ? sb.rpc('apply_play', { p_game: game.id, p_seq: at, p_type: it.type, p_patch: it.patch, p_payload: it.payload, p_stats: [], p_status: it.status }).abortSignal(stop)
        : sb.rpc('undo_play', { p_game: game.id, p_seq: at }).abortSignal(stop),
      eventsAfter: async (at) => ((await sb.from('game_events').select('seq, payload').eq('game_id', game.id).gt('seq', at).order('seq')).data ?? []) as { seq: number; payload: unknown }[],
      gameSeq: async () => ((await sb.from('games').select('seq').eq('id', game.id).single()).data?.seq as number | undefined) ?? null,
      hasEvent: async (at) => !!(await sb.from('game_events').select('id').eq('game_id', game.id).eq('seq', at).maybeSingle()).data,
      refresh: async () => { await sb.auth.refreshSession(); },
    }, {
      status: (s, n) => { setSync(s); setWaiting(n); },
      saved: (it, data) => {
        keep();
        // An undo is the database's answer; a play was already on screen.
        const res = data as { live: SportLive; status: Status } | null;
        if (it.kind === 'undo' && res && !queue.current.length) show(res.live, res.status);
        nudge();
      },
    });
    if (failed) {
      keep();
      await reload();
      setLast(failed.error.code === 'PB409' ? 'Another phone scored. Reloaded the game.' : failed.error.message || 'That did not save. Reloaded the game.');
    }
    sending.current = false;
    setSync('ok');
    setWaiting(0);
    if (queue.current.length) window.setTimeout(() => void pumpRef.current(), 0);
    else if (resync) void reload();
  }, [sb, game.id, reload]);
  useEffect(() => { pumpRef.current = pump; }, [pump]);

  // Plays this phone kept but never sent (a reload, or iOS closing the tab):
  // send them first, then read the game back.
  useEffect(() => {
    const kept = canScore ? readKept(game.id) : null;
    if (!kept) return;
    queue.current = kept.items;
    seq.current = kept.seq;
    const n = kept.items.length;
    void Promise.resolve().then(() => setLast(`Sending ${n} play${n > 1 ? 's' : ''} kept on this phone`));
    void pump().then(() => reload());
    // Once, when the pad opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Leaving with plays still waiting would lose them: ask first.
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (queue.current.length) e.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);

  // A quarter's clock, kept on games.clock, reloads when a rule says so.
  const periodSeconds = Math.round((game.settings?.period_minutes ?? PERIOD_MINUTES[sport]) * 60);
  const [clockKey, setClockKey] = useState(0);
  async function reloadClock(seconds: number) {
    await sb.from('games').update({ clock: clockSet('down', seconds) }).eq('id', game.id);
    setClockKey((k) => k + 1);
    nudge();
  }

  function commit(r: unknown, next: Status | null = null) {
    const res = r as SportRes | null;
    if (!canScore) return;
    if (!res) { setLast(sport === 'football' ? 'Set who has the ball first.' : sport === 'volleyball' ? 'Set who is serving first.' : 'Nothing to change.'); return; }
    const { clock_running: _r, clock_ends_at: _e, clock_remaining_seconds: reload_s, ...patch } = res.patch as Record<string, unknown>;
    void _r; void _e;
    const before = cur.current;
    show({ ...before.live, ...patch } as SportLive, next ?? (before.status === 'scheduled' ? 'live' : before.status));
    setLast(sportSaid(res));
    const payload = { ...(res.payload ?? {}), ...(res.anim ? { play: { kind: res.anim }, animMeta: res.animMeta ?? {} } : {}) };
    queue.current.push({ kind: 'play', type: res.type, patch, payload: { ...payload, cid: newCid() }, rows: [], status: next });
    keepQueue(game.id, { items: queue.current, seq: seq.current });
    if (navigator.vibrate) navigator.vibrate(12);
    if (reload_s !== undefined) void reloadClock(Number(reload_s) || periodSeconds);
    void pump();
  }
  const toggleMatchClock = () => commit(matchClock(cur.current.live));
  // Moments and the rally glow on the stream, as the baseball pad's On Air has them.
  async function send(c: Record<string, unknown> & { type: string }) {
    const { error } = await sb.rpc('send_cmd', { p_team: team.id, p_cmd: c });
    setLast(error ? 'That did not reach the stream. Try again.' : 'On the stream');
    if (!error) nudge();
  }
  async function cmd(kind: string) {
    const { error } = await sb.rpc('send_cmd', { p_team: team.id, p_cmd: { type: 'moment', kind } });
    setLast(error ? 'That did not reach the stream. Try again.' : 'On the stream');
    if (!error) nudge();
  }
  async function bcast(patch: BroadcastPatch) {
    const before = bc;
    setBc(mergeBroadcast(bc, patch));
    const { data, error } = await sb.rpc('set_broadcast', { p_team: team.id, p_patch: patch });
    if (error) { setBc(before); setLast('That did not reach the stream. Try again.'); return; }
    setBc(data as Broadcast);
    nudge();
  }
  function undo() {
    if (!canScore) return;
    setLast('Undone');
    queue.current.push({ kind: 'undo' });
    keepQueue(game.id, { items: queue.current, seq: seq.current });
    void pump();
  }

  const final = status === 'final';
  const locked = final || !canScore;
  const g = sportGame(live, { period_minutes: periodSeconds / 60 });
  const usB = brandOf(team), themB = opponentBrand(game);
  const brands: Record<SideKey, typeof usB> = game.is_home ? { away: themB, home: usB } : { away: usB, home: themB };
  const names = { away: brands.away.display, home: brands.home.display };
  const sides = ['away', 'home'] as const;
  const key = (label: string, run: () => unknown, opts: { tone?: string; sub?: string; off?: boolean } = {}) => (
    <button type="button" className={`pkey ${opts.tone ?? 'ball'}`} disabled={locked || opts.off} onClick={() => commit(run())}>
      {label}{opts.sub && <small>{opts.sub}</small>}
    </button>
  );
  const step = (label: string, value: string | number, minus: () => unknown, plus: () => unknown) => (
    <div key={label} className="pstep">
      <span>{label}</span>
      <button type="button" className="icon-btn" aria-label={`${label} down`} disabled={locked} onClick={() => commit(minus())}>−</button>
      <b>{value}</b>
      <button type="button" className="icon-btn" aria-label={`${label} up`} disabled={locked} onClick={() => commit(plus())}>+</button>
    </div>
  );

  const fb = F.fbState(g) as { quarter: number; down: number; distance: number | 'goal'; possession: SideKey | null; home_timeouts: number; away_timeouts: number };
  const bk = B.bkState(g) as { period: number; fouls: Record<SideKey, number>; timeouts: Record<SideKey, number> };
  const sc = S.scState(g) as { half: number; stoppage: number; cards: Record<SideKey, { y: number; r: number }>; clock: { running: boolean } };
  const vb = V.vbState(g) as { set: number; sets: Record<SideKey, number>; serve: SideKey | null; target: number };

  const console_ = wide && !!channel;
  const airPanel = (inline: boolean) => channel && (
    <AirFrame inline={inline} onClose={() => setAir(false)}>
      <Moments sport={sport} rally={!!bc.rally} onCmd={cmd} onBroadcast={bcast} />
      <ScenesControl broadcast={bc} look={channel.look} onBroadcast={bcast} onSend={send} blurbFor={canWrite && status !== 'final' ? game.id : null} />
      <ObsPanel teamId={team.id} sport={sport} broadcast={bc} onBroadcast={bcast} onSend={send} />
      <Link href={`/t/${slug}/stream`} className="link" style={{ alignSelf: 'center' }}>Look, sound and positions: Stream setup ›</Link>
    </AirFrame>
  );

  return (
    <div className={`pad spad${console_ ? ' has-console' : ''}`}>
      <div className="pad-main">
      <header className="pad-head">
        <Link href={`/t/${slug}/games/${game.id}`} aria-label="Leave the pad" className="icon-btn">‹</Link>
        <div className="pad-score">
          {sides.map((side) => (
            <span key={side} className={`pad-team${(sport === 'football' ? fb.possession : sport === 'volleyball' ? vb.serve : null) === side ? ' bat' : ''}`}>
              <TeamMark brand={brands[side]} size={28} />
              <span className="pad-name">{brands[side].display}</span>
              <b>{Number(live[`${side}_score`]) || 0}</b>
            </span>
          ))}
        </div>
        <span className={`pad-sync ${sync}`} role="status" aria-label={sync === 'ok' ? 'Saved' : sync === 'sending' ? 'Saving' : 'Waiting for signal'}>{waiting > 1 ? waiting : null}</span>
      </header>

      <div className="pad-sit spad-period">
        <span className="pad-inning">{final ? 'Final' : periodName(sport, live)}</span>
        <span className="sub">{situationText(sport, live, names)}</span>
      </div>

      {sport === 'soccer' ? (
        <div className="pclock" role="group" aria-label="Match clock">
          <span className="eyebrow">Match clock</span>
          <b>{clockText(soccerSeconds(g, now))}</b>
          <button type="button" className="btn btn-quiet" disabled={locked}
            onClick={toggleMatchClock}>{sc.clock.running ? 'Stop' : 'Start'}</button>
          <button type="button" className="btn btn-ghost" disabled={locked} onClick={() => commit(S.clockReset(g))}>Reset</button>
        </div>
      ) : sport !== 'volleyball' && (
        <GameClock key={clockKey} gameId={game.id} initial={game.clock} fullSeconds={periodSeconds} canRun={!locked}
          label={sport === 'football' ? 'Quarter clock' : 'Game clock'} onChange={nudge} />
      )}

      <div className="pad-last" role="status">{last || (status === 'scheduled' ? 'The first score starts the game.' : '')}</div>

      {sport === 'football' && (
        <div className="spad-body">
          <div className="pgrid two">
            {sides.map((t) => <button key={t} type="button" className={`pdest${fb.possession === t ? ' on' : ''}`} disabled={locked} onClick={() => commit(F.setPossession(g, t))}>{names[t]} ball</button>)}
          </div>
          <div className="pgrid three">
            {key('Touchdown', () => F.touchdown(g), { tone: 'hit', sub: '+6' })}
            {key('Extra point', () => F.extraPoint(g), { sub: '+1' })}
            {key('Two-point', () => F.twoPoint(g), { sub: '+2' })}
            {key('Field goal', () => F.fieldGoal(g), { tone: 'hit', sub: '+3' })}
            {key('Safety', () => F.safety(g), { sub: '+2 defense' })}
            {key('Turnover', () => F.turnover(g), { tone: 'strike' })}
          </div>
          <div className="pgrid four">
            {[1, 2, 3, 4].map((d) => <button key={d} type="button" className={`pdest${fb.down === d ? ' on' : ''}`} disabled={locked} onClick={() => commit(F.setDown(g, d))}>{['', '1st', '2nd', '3rd', '4th'][d]}</button>)}
          </div>
          <div className="pgrid four">
            <button type="button" className="pdest" disabled={locked} onClick={() => commit(F.distanceDelta(g, -1))}>−1 yd</button>
            <button type="button" className="pdest" disabled={locked} onClick={() => commit(F.distanceDelta(g, 1))}>+1 yd</button>
            <button type="button" className="pdest" disabled={locked} onClick={() => commit(F.setGoal(g))}>& Goal</button>
            <button type="button" className="pdest" disabled={locked} onClick={() => commit(F.firstDown(g))}>1st & 10</button>
          </div>
          <div className="pgrid two">
            {key('Kickoff / punt', () => F.kickoff(g), { tone: 'more', sub: 'Other team’s ball' })}
            {key('Next quarter', () => F.nextQuarter(g), { tone: 'more', sub: 'Clock reloads' })}
          </div>
          <details className="fold"><summary>Timeouts, quarter and score fixes</summary>
            <div className="stack" style={{ gap: 4 }}>
              {sides.map((t) => step(`${names[t]} timeouts`, t === 'home' ? fb.home_timeouts : fb.away_timeouts, () => F.adjustTimeouts(g, t, -1), () => F.adjustTimeouts(g, t, 1)))}
              {step('Quarter', fb.quarter, () => F.adjustQuarter(g, -1), () => F.adjustQuarter(g, 1))}
              {sides.map((t) => step(`${names[t]} score`, Number(live[`${t}_score`]) || 0, () => F.manualScore(g, t, -1), () => F.manualScore(g, t, 1)))}
            </div>
          </details>
        </div>
      )}

      {sport === 'basketball' && (
        <div className="spad-body">
          <div className="spad-keys">
            {sides.map((t) => (
              <div key={t} className="spad-col">
                <span className="eyebrow">{names[t]}</span>
                {key('+1', () => B.score(g, t, 1), { sub: 'Free throw' })}
                {key('+2', () => B.score(g, t, 2), { sub: 'Basket' })}
                {key('+3', () => B.score(g, t, 3), { tone: 'hit', sub: 'Three' })}
                {key('Foul', () => B.foul(g, t, 1), { tone: 'strike', sub: `${bk.fouls[t]} this period` })}
                {key('Timeout', () => B.timeout(g, t), { tone: 'more', sub: `${bk.timeouts[t]} left`, off: bk.timeouts[t] <= 0 })}
              </div>
            ))}
          </div>
          {key('Next period', () => B.nextPeriod(g), { tone: 'more', sub: 'Fouls reset · clock reloads' })}
          <details className="fold"><summary>Fixes</summary>
            <div className="stack" style={{ gap: 4 }}>
              {sides.map((t) => step(`${names[t]} score`, Number(live[`${t}_score`]) || 0, () => B.score(g, t, -1), () => B.score(g, t, 1)))}
              {sides.map((t) => step(`${names[t]} fouls`, bk.fouls[t], () => B.foul(g, t, -1), () => B.foul(g, t, 1)))}
              {sides.map((t) => step(`${names[t]} timeouts`, bk.timeouts[t], () => B.adjustTimeouts(g, t, -1), () => B.adjustTimeouts(g, t, 1)))}
              {step('Period', bk.period, () => B.adjustPeriod(g, -1), () => B.adjustPeriod(g, 1))}
            </div>
          </details>
        </div>
      )}

      {sport === 'soccer' && (
        <div className="spad-body">
          <div className="spad-keys">
            {sides.map((t) => (
              <div key={t} className="spad-col">
                <span className="eyebrow">{names[t]}</span>
                {key('Goal', () => S.goal(g, t), { tone: 'hit' })}
                {key('Yellow', () => S.card(g, t, 'y'), { tone: 'foul', sub: `${sc.cards[t].y} shown` })}
                {key('Red', () => S.card(g, t, 'r'), { tone: 'strike', sub: `${sc.cards[t].r} shown` })}
              </div>
            ))}
          </div>
          <div className="pgrid two">
            <button type="button" className={`pdest${sc.half === 1 ? ' on' : ''}`} disabled={locked} onClick={() => commit(S.setHalf(g, 1))}>1st half</button>
            <button type="button" className={`pdest${sc.half === 2 ? ' on' : ''}`} disabled={locked} onClick={() => commit(S.setHalf(g, 2))}>2nd half</button>
          </div>
          <div className="stack" style={{ gap: 4 }}>
            {step('Stoppage time', `+${sc.stoppage}`, () => S.stoppageDelta(g, -1), () => S.stoppageDelta(g, 1))}
          </div>
          <details className="fold"><summary>Score fixes</summary>
            <div className="stack" style={{ gap: 4 }}>
              {sides.map((t) => step(`${names[t]} score`, Number(live[`${t}_score`]) || 0, () => S.manualScore(g, t, -1), () => S.manualScore(g, t, 1)))}
            </div>
          </details>
        </div>
      )}

      {sport === 'volleyball' && (
        <div className="spad-body">
          <div className="spad-keys">
            {sides.map((t) => (
              <div key={t} className="spad-col">
                <span className="eyebrow">{names[t]}{vb.serve === t ? ' · serving' : ''}</span>
                {key('Point', () => V.point(g, t), { tone: 'hit', sub: 'Serve goes to them' })}
                <button type="button" className={`pdest${vb.serve === t ? ' on' : ''}`} disabled={locked} onClick={() => commit(V.setServe(g, t))}>Serving</button>
              </div>
            ))}
          </div>
          <div className="pgrid three">
            {key('Ace', () => V.ace(g), { sub: 'Point to the server' })}
            {key('End set', () => V.endSet(g), { tone: 'more', sub: 'To the leader' })}
            {key(`To ${vb.target}`, () => V.cycleTarget(g), { tone: 'more', sub: '25 · 21 · 15' })}
          </div>
          <details className="fold"><summary>Fixes</summary>
            <div className="stack" style={{ gap: 4 }}>
              {sides.map((t) => step(`${names[t]} points`, Number(live[`${t}_score`]) || 0, () => V.manualScore(g, t, -1), () => V.manualScore(g, t, 1)))}
              {sides.map((t) => step(`${names[t]} sets`, vb.sets[t], () => V.adjustSets(g, t, -1), () => V.adjustSets(g, t, 1)))}
              {step('Set', vb.set, () => V.adjustSet(g, -1), () => V.adjustSet(g, 1))}
            </div>
          </details>
        </div>
      )}

      <nav className="pad-bar">
        <button type="button" className="pbar undo" onClick={undo} disabled={!canScore || (status === 'scheduled' && !last)}>Undo</button>
        <Link className="pbar" href={`/t/${slug}/games/${game.id}`}>Game</Link>
        {channel && !console_ && <button type="button" className={`pbar air${bc.rally || bc.scene ? ' on' : ''}`} onClick={() => setAir(true)}>On Air</button>}
        <button type="button" className="pbar" disabled={!canScore}
          onClick={() => commit({ type: final ? 'reopen_game' : 'end_game', patch: {} }, final ? 'live' : 'final')}>
          {final ? 'Reopen' : 'End game'}
        </button>
      </nav>
      </div>
      {console_ && <aside className="pad-console">{airPanel(true)}</aside>}
      {air && !console_ && airPanel(false)}
    </div>
  );
}
