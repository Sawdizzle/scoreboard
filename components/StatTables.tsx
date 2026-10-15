import Link from 'next/link';
import { staffName } from '@/lib/format';
import { batting, hasBatting, hasPitching, innings, pitching, rate2, rate3, type SeasonLine } from '@/lib/stats';
import type { NameFormat, Player } from '@/lib/types';

// A season's batting and pitching, one row per player who did either. Sorted
// the way a coach reads them: hitters by average, pitchers by innings.
// `players` need only an id, a number and a name; the public page passes
// public names and no link (there is no public player page). `fmt` is the
// team's name format, for staff screens that pass whole names.
export function StatTables({ slug, lines, players, gameInnings, link = true, fmt = 'full' }: {
  slug: string; lines: SeasonLine[]; players: Pick<Player, 'id' | 'number' | 'first_name' | 'last_name'>[]; gameInnings: number; link?: boolean; fmt?: NameFormat;
}) {
  const who = new Map(players.map((p) => [p.id, p]));
  const cell = (s: SeasonLine) => {
    const p = who.get(s.player_id);
    const body = <><span className="jersey">{p?.number || '–'}</span>{p ? staffName(p, fmt) : 'Removed player'}</>;
    return <td className="who">{link ? <Link href={`/t/${slug}/player/${s.player_id}?s=${s.season_id}`}>{body}</Link> : <span>{body}</span>}</td>;
  };
  const hitters = lines.filter(hasBatting)
    .map((s) => ({ s, b: batting(s) }))
    .sort((x, y) => (y.b.avg ?? -1) - (x.b.avg ?? -1) || y.s.b_pa - x.s.b_pa);
  const pitchers = lines.filter(hasPitching).sort((x, y) => y.p_outs - x.p_outs);

  return (
    <>
      {hitters.length > 0 && (
        <section className="stack" style={{ gap: 8 }}>
          <h2 className="h-sec" style={{ padding: '0 4px' }}>Batting</h2>
          <div className="table-box">
            <table className="stat-table">
              <thead><tr><th style={{ textAlign: 'left' }}>Player</th><th>AVG</th><th>OPS</th><th>PA</th><th>H</th><th>HR</th><th>RBI</th><th>BB</th><th>SB</th></tr></thead>
              <tbody>
                {hitters.map(({ s, b }) => (
                  <tr key={s.player_id}>
                    {cell(s)}
                    <td className="key">{rate3(b.avg)}</td><td>{rate3(b.ops)}</td>
                    <td>{s.b_pa}</td><td>{s.b_h}</td><td>{s.b_hr}</td><td>{s.b_rbi}</td><td>{s.b_bb}</td><td>{s.b_sb}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      {pitchers.length > 0 && (
        <section className="stack" style={{ gap: 8 }}>
          <h2 className="h-sec" style={{ padding: '0 4px' }}>Pitching</h2>
          <div className="table-box">
            <table className="stat-table">
              <thead><tr><th style={{ textAlign: 'left' }}>Player</th><th>ERA</th><th>IP</th><th>K</th><th>BB</th><th>WHIP</th><th>H</th><th>ER</th></tr></thead>
              <tbody>
                {pitchers.map((s) => {
                  const p = pitching(s, gameInnings);
                  return (
                    <tr key={s.player_id}>
                      {cell(s)}
                      <td className="key">{rate2(p.era)}</td><td>{innings(s.p_outs)}</td><td>{s.p_so}</td><td>{s.p_bb}</td>
                      <td>{rate2(p.whip)}</td><td>{s.p_h}</td><td>{s.p_er}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}

// Who leads the team, for the Today screen. Average needs a few trips to the
// plate to mean anything: a plate appearance per game the team has data for,
// three at least (lib/leaderboard.ts uses the same bar).
export function leaders(lines: SeasonLine[]) {
  const games = Math.max(0, ...lines.map((s) => s.b_g));
  const qualified = lines.filter((s) => s.b_pa >= Math.max(3, games));
  const top = <T,>(list: SeasonLine[], v: (s: SeasonLine) => T | null, cmp: (a: T, b: T) => number) => {
    let best: { s: SeasonLine; v: T } | null = null;
    for (const s of list) { const x = v(s); if (x !== null && (!best || cmp(x, best.v) > 0)) best = { s, v: x }; }
    return best;
  };
  const num = (a: number, b: number) => a - b;
  return [
    { k: 'AVG', best: top(qualified, (s) => batting(s).avg, num), show: (x: number) => rate3(x) },
    { k: 'RBI', best: top(lines, (s) => (s.b_rbi > 0 ? s.b_rbi : null), num), show: String },
    { k: 'SB', best: top(lines, (s) => (s.b_sb > 0 ? s.b_sb : null), num), show: String },
    { k: 'K', best: top(lines, (s) => (s.p_so > 0 ? s.p_so : null), num), show: String },
  ].filter((l) => l.best !== null) as { k: string; best: { s: SeasonLine; v: number }; show: (x: number) => string }[];
}
