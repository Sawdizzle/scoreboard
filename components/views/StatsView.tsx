'use client';

import Link from 'next/link';
import { useState } from 'react';
import { staffName } from '@/lib/format';
import { boards, type Board } from '@/lib/leaderboard';
import { batting, innings, pitching, rate2, rate3, type SeasonLine } from '@/lib/stats';
import type { NameFormat, Player, Season } from '@/lib/types';

type P = Pick<Player, 'id' | 'number' | 'first_name' | 'last_name'>;
type Col = { k: string; label: string; v: (s: SeasonLine) => number | null; show: (v: number | null, s: SeasonLine) => string; low?: boolean; title?: string };

// Team > Stats: the season's leaders in every category, the bottom of each
// list for the coaches, and every number in tables that sort on a tap.
export function StatsView({ slug, seasons, season, lines, players, fmt }: {
  slug: string; seasons: Season[]; season: Season | undefined; lines: SeasonLine[]; players: P[]; fmt: NameFormat;
}) {
  const who = new Map(players.map((p) => [p.id, p]));
  const name = (s: SeasonLine) => { const p = who.get(s.player_id); return p ? staffName(p, fmt) : 'Removed player'; };
  const num = (s: SeasonLine) => who.get(s.player_id)?.number || '–';
  const gi = season?.game_innings ?? 7;
  const { leaders, work, minPa } = boards(lines, gi);
  const [side, setSide] = useState<'leaders' | 'work'>('leaders');

  const card = (b: Board, tone: 'good' | 'work') => (
    <section key={b.key} className={`lb-card ${tone}`}>
      <header><b>{b.label}</b><small>{b.note}</small></header>
      <ol>
        {b.rows.map((r, i) => (
          <li key={r.s.player_id}>
            <span className="lb-rank">{i + 1}</span>
            <Link href={`/t/${slug}/player/${r.s.player_id}?s=${r.s.season_id}`} className="lb-who"><span className="jersey">{num(r.s)}</span>{name(r.s)}</Link>
            <span className="lb-v">{r.text}</span>
          </li>
        ))}
      </ol>
    </section>
  );

  const BAT: Col[] = [
    { k: 'g', label: 'G', v: (s) => s.b_g, show: (v) => String(v ?? 0), title: 'Games' },
    { k: 'pa', label: 'PA', v: (s) => s.b_pa, show: (v) => String(v ?? 0), title: 'Plate appearances' },
    { k: 'ab', label: 'AB', v: (s) => s.b_ab, show: (v) => String(v ?? 0), title: 'At bats' },
    { k: 'avg', label: 'AVG', v: (s) => batting(s).avg, show: (v) => rate3(v), title: 'Batting average' },
    { k: 'obp', label: 'OBP', v: (s) => batting(s).obp, show: (v) => rate3(v), title: 'On-base percentage' },
    { k: 'slg', label: 'SLG', v: (s) => batting(s).slg, show: (v) => rate3(v), title: 'Slugging' },
    { k: 'ops', label: 'OPS', v: (s) => batting(s).ops, show: (v) => rate3(v), title: 'On base plus slugging' },
    { k: 'h', label: 'H', v: (s) => s.b_h, show: (v) => String(v ?? 0), title: 'Hits' },
    { k: '2b', label: '2B', v: (s) => s.b_2b, show: (v) => String(v ?? 0), title: 'Doubles' },
    { k: '3b', label: '3B', v: (s) => s.b_3b, show: (v) => String(v ?? 0), title: 'Triples' },
    { k: 'hr', label: 'HR', v: (s) => s.b_hr, show: (v) => String(v ?? 0), title: 'Home runs' },
    { k: 'rbi', label: 'RBI', v: (s) => s.b_rbi, show: (v) => String(v ?? 0), title: 'Runs batted in' },
    { k: 'r', label: 'R', v: (s) => s.b_r, show: (v) => String(v ?? 0), title: 'Runs' },
    { k: 'bb', label: 'BB', v: (s) => s.b_bb, show: (v) => String(v ?? 0), title: 'Walks' },
    { k: 'so', label: 'SO', v: (s) => s.b_so, show: (v) => String(v ?? 0), title: 'Strikeouts', low: true },
    { k: 'kl', label: 'K-L', v: (s) => s.b_kl, show: (v) => String(v ?? 0), title: 'Struck out looking', low: true },
    { k: 'hbp', label: 'HBP', v: (s) => s.b_hbp, show: (v) => String(v ?? 0), title: 'Hit by pitch' },
    { k: 'sb', label: 'SB', v: (s) => s.b_sb, show: (v) => String(v ?? 0), title: 'Stolen bases' },
    { k: 'cs', label: 'CS', v: (s) => s.b_cs, show: (v) => String(v ?? 0), title: 'Caught stealing', low: true },
  ];
  const PITCH: Col[] = [
    { k: 'pg', label: 'G', v: (s) => s.p_g, show: (v) => String(v ?? 0), title: 'Games pitched' },
    { k: 'gs', label: 'GS', v: (s) => s.p_gs, show: (v) => String(v ?? 0), title: 'Games started' },
    { k: 'ip', label: 'IP', v: (s) => s.p_outs, show: (v) => innings(v ?? 0), title: 'Innings pitched' },
    { k: 'era', label: 'ERA', v: (s) => pitching(s, gi).era, show: (v) => rate2(v), title: `Earned runs per ${gi} innings`, low: true },
    { k: 'whip', label: 'WHIP', v: (s) => pitching(s, gi).whip, show: (v) => rate2(v), title: 'Walks and hits per inning', low: true },
    { k: 'bf', label: 'BF', v: (s) => s.p_bf, show: (v) => String(v ?? 0), title: 'Batters faced' },
    { k: 'np', label: '#P', v: (s) => s.p_pitches, show: (v) => String(v ?? 0), title: 'Pitches' },
    { k: 'ph', label: 'H', v: (s) => s.p_h, show: (v) => String(v ?? 0), title: 'Hits allowed', low: true },
    { k: 'pr', label: 'R', v: (s) => s.p_r, show: (v) => String(v ?? 0), title: 'Runs allowed', low: true },
    { k: 'er', label: 'ER', v: (s) => s.p_er, show: (v) => String(v ?? 0), title: 'Earned runs', low: true },
    { k: 'pbb', label: 'BB', v: (s) => s.p_bb, show: (v) => String(v ?? 0), title: 'Walks allowed', low: true },
    { k: 'pso', label: 'K', v: (s) => s.p_so, show: (v) => String(v ?? 0), title: 'Strikeouts' },
    { k: 'phbp', label: 'HBP', v: (s) => s.p_hbp, show: (v) => String(v ?? 0), title: 'Hit batters', low: true },
    { k: 'wp', label: 'WP', v: (s) => s.p_wp, show: (v) => String(v ?? 0), title: 'Wild pitches', low: true },
  ];

  return (
    <div className="page wide stats" style={{ paddingTop: 10 }}>
      {seasons.length > 1 && (
        <nav className="chips" aria-label="Seasons">
          {seasons.map((s) => (
            <Link key={s.id} href={`/t/${slug}/stats?s=${s.id}`} className="chip" aria-current={s.id === season?.id ? 'page' : undefined}>
              {s.is_current && <span className="dot" title="Current season" />}{s.name}
            </Link>
          ))}
        </nav>
      )}
      {!lines.length ? (
        <div className="card empty"><b>No stats for {season?.name ?? 'this season'} yet</b>They arrive from games scored on the pad.</div>
      ) : (
        <>
          <div className="seg lb-seg" role="tablist" aria-label="Leaderboards">
            <button type="button" role="tab" aria-selected={side === 'leaders'} className="seg-item" aria-current={side === 'leaders' ? 'page' : undefined} onClick={() => setSide('leaders')}>Leaders</button>
            <button type="button" role="tab" aria-selected={side === 'work'} className="seg-item" aria-current={side === 'work' ? 'page' : undefined} onClick={() => setSide('work')}>Needs work</button>
          </div>
          <p className="sub" style={{ padding: '0 4px', margin: '-6px 0 0' }}>
            {side === 'leaders' ? 'The top three in each category.' : 'The other end of each list, for the coaches: the public team page never shows it.'} Averages count players with at least {minPa} plate appearances.
          </p>
          <div className="lb-grid">{(side === 'leaders' ? leaders : work).map((b) => card(b, side === 'leaders' ? 'good' : 'work'))}</div>

          <SortTable title="Batting" lines={lines.filter((s) => s.b_pa > 0)} cols={BAT} first="avg" name={name} num={num} slug={slug} />
          <SortTable title="Pitching" lines={lines.filter((s) => s.p_outs > 0 || s.p_bf > 0)} cols={PITCH} first="ip" name={name} num={num} slug={slug} />
        </>
      )}
    </div>
  );
}

// A stat table that sorts by any column. A tap sorts best first (lowest for
// ERA, walks allowed and the like); a second tap turns it round.
function SortTable({ title, lines, cols, first, name, num, slug }: {
  title: string; lines: SeasonLine[]; cols: Col[]; first: string; name: (s: SeasonLine) => string; num: (s: SeasonLine) => string; slug: string;
}) {
  const [by, setBy] = useState<{ k: string; flip: boolean }>({ k: first, flip: false });
  if (!lines.length) return null;
  const col = cols.find((c) => c.k === by.k) ?? cols[0];
  const down = col.low ? by.flip : !by.flip;
  const sorted = [...lines].sort((a, b) => {
    const x = col.v(a), y = col.v(b);
    if (x === null && y === null) return 0;
    if (x === null) return 1;
    if (y === null) return -1;
    return down ? y - x : x - y;
  });
  return (
    <section className="stack" style={{ gap: 8 }}>
      <h2 className="h-sec" style={{ padding: '0 4px' }}>{title}</h2>
      <div className="table-box">
        <table className="stat-table sortable">
          <thead>
            <tr>
              <th style={{ textAlign: 'left' }}>Player</th>
              {cols.map((c) => (
                <th key={c.k} aria-sort={by.k === c.k ? (down ? 'descending' : 'ascending') : undefined}>
                  <button type="button" title={c.title} onClick={() => setBy({ k: c.k, flip: by.k === c.k ? !by.flip : false })}>
                    {c.label}{by.k === c.k ? (down ? ' ▾' : ' ▴') : ''}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((s) => (
              <tr key={s.player_id}>
                <td className="who"><Link href={`/t/${slug}/player/${s.player_id}?s=${s.season_id}`}><span className="jersey">{num(s)}</span>{name(s)}</Link></td>
                {cols.map((c) => <td key={c.k} className={by.k === c.k ? 'key' : undefined}>{c.show(c.v(s), s)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
