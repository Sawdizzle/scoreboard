/* eslint-disable @next/next/no-img-element -- logos are small files from Storage, shown at fixed sizes */
import './overlay.css';
import { AnimBug } from '@/components/overlay/AnimBug';
import { brandOf, type Brand } from '@/components/TeamBrand';
import { inkOn } from '@/lib/format';
import * as L from '@/lib/rules/logic.js';
import { boxScore, bugAnim, bugState, feedView, leaders, type BatterView, type CardKind, type Feed, type Leader, type PitcherView } from '@/lib/onair';

// The stream, drawn. A transparent page laid out on a 1280 x 720 grid in rem,
// with the root font size tied to the width of the source: it fills a 720p,
// 1080p or 4K Browser Source alike, with no script doing the scaling.
//
// Everything is always in the page; a card that is off air is only faded and
// moved out, so raising and clearing one is a transition, not a pop.
const ROOT = 'html{font-size:calc(100vw/128);background:transparent}body{background:transparent;min-height:0;overflow:hidden}';

const vars = (b: Brand) => ({ '--c': b.color, '--c2': b.color2, '--ink': inkOn(b.color) }) as React.CSSProperties;
// A team's name on its slab: full size for a short name, smaller until a long one fits.
const fit = (s: string, max: number, room: number) => ({ fontSize: `${Math.min(max, Math.max(max * 0.5, room / (Math.max(s.length, 1) * 0.56))).toFixed(2)}rem` });

function Team({ brand, score, bat }: { brand: Brand; score: number; bat: boolean }) {
  return (
    <div className={`ov-team${bat ? ' bat' : ''}`} style={vars(brand)}>
      <div className="ov-slab">
        {brand.logo && <img src={brand.logo} alt="" />}
        <span style={fit(brand.display, 3.4, 19)}>{brand.display}</span>
      </div>
      <div className="ov-score"><b key={score}>{score}</b></div>
    </div>
  );
}

function Stat({ v, k, gold }: { v: string; k: string; gold?: boolean }) {
  return <span className="ov-stat"><b className={gold ? 'gold' : undefined}>{v}</b><small>{k}</small></span>;
}

function BatterCard({ b, brand, season, on }: { b: BatterView | null; brand: Brand; season: string; on: boolean }) {
  return (
    <div className={`ov-card ov-batter${on && b ? ' on' : ''}`} aria-hidden={!on}>
      {b && <>
        <div className="ov-tile" style={vars(brand)}>
          <b style={{ fontSize: b.num.length > 2 ? '9rem' : '15rem' }}>{b.num || '–'}</b>
          {b.pos && <small>{b.pos}</small>}
        </div>
        <div className="ov-who">
          <div>
            <em>Now batting</em>
            <strong style={fit(b.name, 5.4, 34)}>{b.name}</strong>
          </div>
          <div className="ov-today">
            <span><small>Today</small><b>{b.today || 'First time up'}</b></span>
            {b.pas.length > 0 && <div className="ov-chips">{b.pas.slice(-3).map((p, i) => <span key={i}><i>{p.inn}</i>{p.what}</span>)}</div>}
          </div>
        </div>
        {b.avg && (
          <div className="ov-season">
            <em>{season}{b.games ? ` · ${b.games} game${b.games === 1 ? '' : 's'}` : ''}</em>
            <div>
              <span className="ov-avg"><b>{b.avg}</b><small>AVG</small></span>
              <div className="ov-cells">{b.cells.map((c) => <Stat key={c.k} {...c} />)}</div>
            </div>
          </div>
        )}
      </>}
    </div>
  );
}

function PitcherCard({ p, brand, on }: { p: PitcherView | null; brand: Brand; on: boolean }) {
  return (
    <div className={`ov-card ov-panel${on && p ? ' on' : ''}`} aria-hidden={!on}>
      {p && <>
        <div className="ov-phead" style={vars(brand)}><b>Pitching · {brand.display}</b></div>
        <div className="ov-prow"><i>{p.num}</i><strong style={fit(p.name, 3.4, 34)}>{p.name}</strong></div>
        <div className="ov-pcells">{p.today.map((c) => <span key={c.k}><b>{c.v}</b><small>{c.k}</small></span>)}</div>
        {p.season && <div className="ov-pseason"><small>Season</small>{p.season.map((c) => <Stat key={c.k} {...c} gold />)}</div>}
      </>}
    </div>
  );
}

function DueUp({ list, brand, when, on }: { list: BatterView[]; brand: Brand; when: string; on: boolean }) {
  return (
    <div className={`ov-card ov-panel${on && list.length ? ' on' : ''}`} aria-hidden={!on}>
      <div className="ov-phead" style={vars(brand)}><b>Due up · {brand.display}</b><span>{when}</span></div>
      {list.map((b) => (
        <div key={b.bid} className="ov-due">
          <i>{b.num}</i>
          <div>
            <strong style={fit(b.name, 3, 26)}>{b.name}</strong>
            <small>{[b.pos, b.today && `Today ${b.today}`].filter(Boolean).join(' · ') || 'First time up'}</small>
          </div>
          {b.avg && <b>{b.avg}</b>}
        </div>
      ))}
    </div>
  );
}

function Leaders({ list, brand, season, on }: { list: Leader[]; brand: Brand; season: string; on: boolean }) {
  return (
    <div className={`ov-card ov-panel${on && list.length ? ' on' : ''}`} aria-hidden={!on}>
      <div className="ov-phead" style={vars(brand)}><b>Leaders · {brand.display}</b><span>{season}</span></div>
      {list.map((l) => (
        <div key={l.k} className="ov-due ov-lead">
          <small>{l.k}</small>
          <div><strong style={fit(l.name, 3, 22)}>{l.name}</strong></div>
          <b>{l.v}</b>
        </div>
      ))}
    </div>
  );
}

function Box({ box, away, home, final, on }: { box: ReturnType<typeof boxScore>; away: Brand; home: Brand; final: boolean; on: boolean }) {
  const row = (b: Brand, cells: string[], tot: string[]) => (
    <tr>
      <th style={vars(b)}><i />{b.display}</th>
      {cells.map((c, i) => <td key={i}>{c}</td>)}
      {tot.map((c, i) => <td key={`t${i}`} className={i === 0 ? 'r' : 't'}>{c}</td>)}
    </tr>
  );
  return (
    <div className={`ov-card ov-panel ov-box${on ? ' on' : ''}`} aria-hidden={!on}>
      <table>
        <thead><tr><th>{final ? 'Final' : 'Box score'}</th>{box.innings.map((n) => <td key={n}>{n}</td>)}<td className="r">R</td><td className="t">H</td><td className="t">E</td></tr></thead>
        <tbody>{row(away, box.away, box.awayTot)}{row(home, box.home, box.homeTot)}</tbody>
      </table>
    </div>
  );
}

export function Stage({ feed, card }: { feed: Feed | null; card: CardKind | null }) {
  const v = feed ? feedView(feed) : null;
  if (!feed || !v) return <style>{ROOT}</style>;
  const { g, air } = v;
  const us = brandOf(feed.team), them = brandOf(feed.opponent);
  const home = feed.game!.is_home ? us : them, away = feed.game!.is_home ? them : us;
  const brandFor = (side: 'home' | 'away') => (side === 'home' ? home : away);
  const status = feed.game!.status;
  const live = status === 'live';
  const top = g.half === 'top';
  const b = L.safeBases(g.bases) as { first: boolean; second: boolean; third: boolean };
  const batUs = brandFor(air.batSide) === us;
  // The box score stands after the last out; the rest are for a game in play.
  const shown = live || (card === 'box' && status === 'final') ? card : null;
  const look = feed.look && feed.look !== 'pressbox' ? feed.look : null;
  const base = (on: boolean, x: number, y: number) => (
    <rect x={x} y={y} width="16" height="16" transform={`rotate(45 ${x + 8} ${y + 8})`} className={on ? 'on' : undefined} />
  );

  return (
    <div className={`ov${look ? ' framed' : ''}`}>
      <style>{ROOT}</style>
      {look && <AnimBug key={look} slug={look} state={bugState(feed, g, air)} anim={bugAnim(feed.last)} seq={feed.last?.seq ?? null} />}
      <div className="ov-right">
        <PitcherCard p={air.pitcher} brand={brandFor(air.fieldSide)} on={shown === 'pitcher'} />
        <DueUp list={air.dueUp} brand={brandFor(air.batSide)} when={`${top ? 'Top' : 'Bot'} ${g.inning}`} on={shown === 'dueup'} />
        <Leaders list={leaders(feed.season_stats, feed.roster ?? [])} brand={us} season={feed.season?.name ?? 'Season'} on={shown === 'leaders'} />
        <Box box={boxScore(g, feed.season?.game_innings ?? 7)} away={away} home={home} final={status === 'final'} on={shown === 'box'} />
      </div>
      <div className="ov-dock">
        <BatterCard b={air.batter} brand={brandFor(air.batSide)} season={batUs && feed.season ? feed.season.name : 'Season'} on={shown === 'batter'} />
        {!look && <div className={`ov-bug${shown === 'batter' ? ' carded' : ''}`}>
          <div className="ov-rail">
            <Team brand={away} score={g.away_score | 0} bat={live && top} />
            <Team brand={home} score={g.home_score | 0} bat={live && !top} />
            {live ? (
              <div className="ov-sit">
                <div className="ov-inn"><i className={top ? 'on' : undefined} /><b>{g.inning}</b><i className={top ? 'dn' : 'dn on'} /></div>
                <svg width="62" height="52" viewBox="0 0 62 52" aria-hidden="true">
                  {base(b.second, 23, 4)}{base(b.third, 5, 22)}{base(b.first, 41, 22)}
                </svg>
                <div className="ov-count">
                  <b>{g.balls | 0}-{g.strikes | 0}</b>
                  <span>{[0, 1, 2].map((i) => <i key={i} className={i < (g.outs | 0) ? 'on' : undefined} />)}</span>
                </div>
              </div>
            ) : <div className="ov-sit word"><b>{status === 'final' ? 'Final' : 'Pregame'}</b></div>}
          </div>
          {live && (air.batter || air.pitcher) && (
            <div className="ov-strip">
              {air.batter && (
                <span key={air.batter.bid} className="ov-ab">
                  <em>AB</em><strong>{air.batter.name}</strong>
                  {feed.show_line && air.batter.avg && <Stat v={air.batter.avg} k="AVG" gold />}
                  {feed.show_line && air.batter.today && <Stat v={air.batter.today} k="Today" />}
                </span>
              )}
              {air.pitcher && <span className="ov-p">P · {air.pitcher.last} <b>{air.pitcher.pitches}</b></span>}
            </div>
          )}
        </div>}
      </div>
    </div>
  );
}
