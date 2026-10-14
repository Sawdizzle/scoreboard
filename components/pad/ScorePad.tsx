'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { airTopic } from '@/components/overlay/Overlay';
import { brandOf, opponentBrand, TeamMark } from '@/components/TeamBrand';
import { addPoints, endSet, periodOf, setsOf, sportDef, stepPeriod, type SideKey, type SportLive, type SportRes } from '@/lib/sports';
import { browserClient } from '@/lib/supabase/browser';
import type { Game, Team } from '@/lib/types';

type Status = Game['status'];
type Item = { type: string; patch: object; status: Status | null } | 'undo';

// The pad for the sports that are score only: points for each side, the
// period, and for volleyball the set. Taps show at once and save in order,
// through the same apply_play and undo_play as a baseball play.
export function ScorePad({ slug, team, game, canScore, token }: {
  slug: string; team: Team; game: Game & { seq: number }; canScore: boolean; token: string | null;
}) {
  const sb = browserClient();
  const def = sportDef(game.sport);
  const [live, setLive] = useState<SportLive>(game.live as SportLive);
  const [status, setStatus] = useState<Status>(game.status);
  const [last, setLast] = useState('');
  const [sync, setSync] = useState<'ok' | 'sending' | 'retry'>('ok');
  const cur = useRef({ live, status });
  const queue = useRef<Item[]>([]);
  const sending = useRef(false);
  const seq = useRef(game.seq);
  const wire = useRef<ReturnType<typeof sb.channel> | null>(null);

  useEffect(() => {
    if (!token) return;
    const c = sb.channel(airTopic(token)).subscribe();
    wire.current = c;
    return () => { wire.current = null; void sb.removeChannel(c); };
  }, [sb, token]);

  const show = (l: SportLive, s: Status) => { cur.current = { live: l, status: s }; setLive(l); setStatus(s); };

  const pump = useCallback(async () => {
    if (sending.current) return;
    sending.current = true;
    let wait = 800;
    while (queue.current.length) {
      setSync('sending');
      const it = queue.current[0];
      const { data, error } = it === 'undo'
        ? await sb.rpc('undo_play', { p_game: game.id, p_seq: seq.current })
        : await sb.rpc('apply_play', { p_game: game.id, p_seq: seq.current, p_type: it.type, p_patch: it.patch, p_payload: {}, p_stats: [], p_status: it.status });
      if (error) {
        if (!error.code || /fetch|network/i.test(error.message)) {
          setSync('retry');
          await new Promise((r) => setTimeout(r, wait));
          wait = Math.min(wait * 2, 8000);
          continue;
        }
        // Another phone got there first, or the play was refused: take the game as the database has it.
        queue.current = [];
        const { data: row } = await sb.from('games').select('live, status, seq').eq('id', game.id).single();
        if (row) { seq.current = row.seq; show(row.live as SportLive, row.status as Status); }
        setLast(error.code === 'PB409' ? 'Another phone scored. Reloaded the game.' : error.message || 'That did not save. Reloaded the game.');
        break;
      }
      const res = data as { seq: number; live: SportLive; status: Status };
      seq.current = res.seq;
      queue.current.shift();
      wait = 800;
      // An undo is the database's answer; a play was already on screen.
      if (it === 'undo' && !queue.current.length) show(res.live, res.status);
      void wire.current?.send({ type: 'broadcast', event: 'tick', payload: {} });
    }
    sending.current = false;
    setSync('ok');
  }, [sb, game.id]);

  function commit(res: SportRes | null, next: Status | null = null) {
    if (!canScore || !res) return;
    const before = cur.current;
    show({ ...before.live, ...res.patch } as SportLive, next ?? (before.status === 'scheduled' ? 'live' : before.status));
    setLast(res.text);
    queue.current.push({ type: res.type, patch: res.patch, status: next });
    if (navigator.vibrate) navigator.vibrate(12);
    void pump();
  }
  function undo() {
    if (!canScore) return;
    setLast('Undone');
    queue.current.push('undo');
    void pump();
  }

  const final = status === 'final';
  const locked = final || !canScore;
  const usB = brandOf(team), themB = opponentBrand(game);
  const sides: [SideKey, typeof usB][] = game.is_home ? [['away', themB], ['home', usB]] : [['away', usB], ['home', themB]];
  const period = periodOf(live), sets = setsOf(live);

  return (
    <div className="pad">
      <header className="pad-head">
        <Link href={`/t/${slug}/games/${game.id}`} aria-label="Leave the pad" className="icon-btn">‹</Link>
        <div className="pad-score">
          {sides.map(([side, br]) => (
            <span key={side} className="pad-team">
              <TeamMark brand={br} size={28} />
              <span className="pad-name">{br.display}</span>
              <b>{Number(live[`${side}_score`]) || 0}</b>
            </span>
          ))}
        </div>
        <span className={`pad-sync ${sync}`} role="status" aria-label={sync === 'ok' ? 'Saved' : sync === 'sending' ? 'Saving' : 'Waiting for signal'} />
      </header>

      <div className="pad-sit spad-period">
        <button type="button" className="icon-btn" aria-label={`Back a ${def.unit}`} disabled={locked || period <= 1} onClick={() => commit(stepPeriod(game.sport, live, -1))}>‹</button>
        <span className="pad-inning">{final ? 'Final' : def.name(period)}</span>
        {game.sport === 'volleyball' && <span className="sub">Sets {sets.away}-{sets.home}</span>}
        <button type="button" className="icon-btn" aria-label={`Next ${def.unit}`} disabled={locked} onClick={() => commit(stepPeriod(game.sport, live, 1))}>›</button>
      </div>

      <div className="pad-last" role="status">{last || (status === 'scheduled' ? 'The first score starts the game.' : '')}</div>

      <div className="spad-keys">
        {sides.map(([side, br]) => (
          <div key={side} className="spad-col">
            <span className="eyebrow">{br.display}</span>
            {def.points.map(([n, label]) => (
              <button key={n} type="button" className="pkey ball" disabled={locked} onClick={() => commit(addPoints(live, side, n, label))}>+{n}<small>{label}</small></button>
            ))}
            <button type="button" className="pkey more" disabled={locked || !(Number(live[`${side}_score`]) > 0)} onClick={() => commit(addPoints(live, side, -1))}>−1</button>
          </div>
        ))}
      </div>

      {game.sport === 'volleyball' && (
        <button type="button" className="pbar" disabled={locked || !endSet(live)} onClick={() => commit(endSet(live))}>End set · next set starts at 0-0</button>
      )}

      <nav className="pad-bar">
        <button type="button" className="pbar undo" onClick={undo} disabled={!canScore || (status === 'scheduled' && !last)}>Undo</button>
        <Link className="pbar" href={`/t/${slug}/games/${game.id}`}>Game</Link>
        <button type="button" className="pbar" disabled={!canScore}
          onClick={() => commit({ type: final ? 'reopen_game' : 'end_game', patch: {}, text: final ? 'Game reopened' : 'Game ended' }, final ? 'live' : 'final')}>
          {final ? 'Reopen' : 'End game'}
        </button>
      </nav>
    </div>
  );
}
