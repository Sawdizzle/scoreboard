'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { LocalTime } from '@/components/LocalTime';
import { Slab, brandOf } from '@/components/TeamBrand';
import * as L from '@/lib/rules/logic.js';
import { boxScore, feedView } from '@/lib/onair';
import { BAT_COLS, PITCH_COLS, asFeed, boxLines, plays, type BoxRow, type PublicGame } from '@/lib/public';
import { browserClient } from '@/lib/supabase/browser';
import { periodText, type SportLive } from '@/lib/sports';
import type { Side } from '@/lib/types';

const POLL_MS = 5000;

function BoxTable({ title, cols, rows }: { title: string; cols: string[]; rows: BoxRow[] }) {
  if (!rows.length) return null;
  return (
    <div className="table-box">
      <table className="stat-table">
        <thead><tr><th style={{ textAlign: 'left' }}>{title}</th>{cols.map((c) => <th key={c}>{c}</th>)}</tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <td className="who"><span><span className="jersey">{r.num || '–'}</span>{r.name}</span></td>
              {r.cells.map((c, i) => <td key={i}>{c}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// The public game page. It asks again every few seconds while the game is on;
// an answer with nothing new is one line.
export function LiveGame({ initial }: { initial: PublicGame }) {
  const [game, setGame] = useState(initial);
  const first = useRef(initial);

  useEffect(() => {
    if (first.current.game.status === 'final') return;
    const sb = browserClient();
    let have = first.current.v, stopped = false, busy = false;
    const load = async () => {
      if (busy || document.hidden) return;
      busy = true;
      try {
        const { data } = await sb.rpc('public_game', { p_game: first.current.game.id, p_have: have });
        const g = data as PublicGame | { v: string } | null;
        if (!stopped && g && 'game' in g) { have = g.v; setGame(g); }
      } catch { /* the next poll tries again */ } finally { busy = false; }
    };
    const poll = window.setInterval(load, POLL_MS);
    return () => { stopped = true; window.clearInterval(poll); };
  }, []);

  const v = feedView(asFeed(game))!;
  const { g, air } = v;
  const us = brandOf(game.team), them = brandOf(game.opponent);
  const [away, home] = game.game.is_home ? [them, us] : [us, them];
  const sideOf = (e: 'home' | 'away'): Side => ((e === 'home') === game.game.is_home ? 'us' : 'them');
  const status = game.game.status;
  const live = status === 'live';
  const sport = game.game.sport ?? 'baseball';
  const ball = sport === 'baseball';
  const box = boxScore(g, game.season?.game_innings ?? 7);
  const b = L.safeBases(g.bases) as { first: boolean; second: boolean; third: boolean };
  const list = plays(game);
  const teamLink = game.team.slug ? `/team/${game.team.slug}` : '/';

  return (
    <main className="shell" style={{ '--team': game.team.color } as React.CSSProperties}>
      <div className="page" style={{ paddingTop: 12 }}>
        <Link href={teamLink} className="link">‹ {game.team.display_name}</Link>

        <section className="card pub-score">
          <div className="pub-sides">
            <div><Slab brand={away} sub="Away" compact /><b>{g.away_score | 0}</b></div>
            <div><Slab brand={home} sub="Home" compact right /><b>{g.home_score | 0}</b></div>
          </div>
          <div className="pub-state" role="status">
            {live && !ball ? <><span className="eyebrow gold">Live</span><b>{periodText(sport, game.game.live as SportLive)}</b></> : live ? (
              <>
                <span className="eyebrow gold">Live</span>
                <b>{g.half === 'top' ? 'Top' : 'Bottom'} {g.inning}</b>
                <span>{g.balls | 0}-{g.strikes | 0} · {g.outs | 0} out{(g.outs | 0) === 1 ? '' : 's'}</span>
                <span className="pub-bases" aria-label={`Runners: ${(['first', 'second', 'third'] as const).filter((k) => b[k]).join(', ') || 'none'}`}>
                  <i className={b.third ? 'on' : undefined} /><i className={b.second ? 'on up' : 'up'} /><i className={b.first ? 'on' : undefined} />
                </span>
              </>
            ) : status === 'final' ? <><span className="eyebrow gold">Final</span><span>{game.game.venue}</span></>
              : <><span className="eyebrow">Scheduled</span><b><LocalTime iso={game.game.starts_at} /></b><span>{game.game.venue}</span></>}
          </div>
          {ball && live && air.batter && (
            <p className="pub-now">At bat: <b>{air.batter.name}</b>{air.batter.today ? ` (${air.batter.today})` : ''}{air.pitcher ? <> · Pitching: <b>{air.pitcher.name}</b>, {air.pitcher.pitches} pitches</> : null}</p>
          )}
        </section>

        {ball && status !== 'scheduled' && (
          <div className="table-box">
            <table className="stat-table pub-line">
              <thead><tr><th />{box.innings.map((n) => <th key={n}>{n}</th>)}<th className="key">R</th><th>H</th><th>E</th></tr></thead>
              <tbody>
                {([[away, box.away, box.awayTot], [home, box.home, box.homeTot]] as const).map(([br, cells, tot], i) => (
                  <tr key={i}>
                    <td className="who"><span>{br.display}</span></td>
                    {cells.map((c, j) => <td key={j}>{c}</td>)}
                    <td className="key">{tot[0]}</td><td>{tot[1]}</td><td>{tot[2]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {ball && status !== 'scheduled' && (['away', 'home'] as const).map((e) => {
          const lines = boxLines(game, sideOf(e));
          const br = e === 'away' ? away : home;
          if (!lines.batting.length && !lines.pitching.length) return null;
          return (
            <section key={e} className="stack" style={{ gap: 8 }}>
              <h2 className="h-sec" style={{ padding: '0 4px' }}>{br.display}</h2>
              <BoxTable title="Batting" cols={BAT_COLS} rows={lines.batting} />
              <BoxTable title="Pitching" cols={PITCH_COLS} rows={lines.pitching} />
            </section>
          );
        })}

        {list.length > 0 && (
          <section className="stack" style={{ gap: 8 }}>
            <h2 className="h-sec" style={{ padding: '0 4px' }}>Plays</h2>
            <div className="card" style={{ padding: '4px 12px' }}>
              <div className="rows">
                {list.map((p) => (
                  <div key={p.key} className="row">
                    <span className="pub-inn" style={{ '--c': (sideOf('home') === p.side ? home : away).color } as React.CSSProperties}>{p.inning}</span>
                    <span className="row-main"><span className="row-title">{p.what}</span><span className="row-meta">{p.who}</span></span>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}

        {status === 'scheduled' && <p className="sub" style={{ padding: '0 4px' }}>The score shows here from the first pitch.</p>}
        <p className="pub-foot">Scored on <Link href="/" className="link">Scoreboard</Link></p>
      </div>
    </main>
  );
}
