/* eslint-disable @next/next/no-img-element -- logos are small files from Storage, shown at fixed sizes */
import './overlay.css';
import './themes.css';
import { MidShow } from '@/components/overlay/Showtime';
import { LOOK_BUGS } from '@/components/overlay/looks';
import { homerText, type BugProps } from '@/components/overlay/looks/types';
import { brandOf, type Brand } from '@/components/TeamBrand';
import { inkOn, shortName } from '@/lib/format';
import * as L from '@/lib/rules/logic.js';
import { autoMid, boxScore, breakText, halfRecap, feedView, leaders, type AirView, layoutOf, qrLayer, type BatterView, type CardKind, type Feed, type Leader, type PitcherView } from '@/lib/onair';
import { qrPath } from '@/lib/qr';
import { clockSeconds, clockText } from '@/lib/broadcast';
import { periodText, situationText, soccerSeconds, type SportLive } from '@/lib/sports';

// The stream, drawn. A transparent page laid out on a 1280 x 720 grid in rem,
// with the root font size tied to the width of the source: it fills a 720p,
// 1080p or 4K Browser Source alike, with no script doing the scaling.
//
// Everything is always in the page; a card that is off air is only tucked
// behind the scorebug, so raising and clearing one is a slide, not a pop.
const ROOT = 'html{font-size:calc(100vw/128);background:transparent}body{background:transparent;min-height:0;overflow:hidden}';

const vars = (b: Brand) => ({ '--c': b.color, '--c2': b.color2, '--ink': inkOn(b.color) }) as React.CSSProperties;
// A team's name on its slab: full size for a short name, smaller until a long one fits.
const fit = (s: string, max: number, room: number) => ({ fontSize: `${Math.min(max, Math.max(max * 0.5, room / (Math.max(s.length, 1) * 0.56))).toFixed(2)}rem` });

function Team({ brand, score, bat, he }: { brand: Brand; score: number; bat: boolean; he?: [number, number] | null }) {
  return (
    <div className={`ov-team${bat ? ' bat' : ''}`} style={vars(brand)}>
      <div className="ov-slab">
        {brand.logo && <img src={brand.logo} alt="" />}
        <span style={fit(brand.display, 3.4, 19)}>{brand.display}</span>
      </div>
      <div className="ov-score"><b key={score}>{score}</b></div>
      {he && <div className="ov-he"><span>H {he[0]}</span><span>E {he[1]}</span></div>}
    </div>
  );
}

// v4's Custom theme: its colours and type, as the bug's variables.
const FONTS: Record<string, string> = {
  condensed: 'var(--font-cond), "Arial Narrow", system-ui, sans-serif', clean: '"Helvetica Neue", Arial, system-ui, sans-serif',
  mono: 'ui-monospace, Menlo, Consolas, monospace', serif: '"Times New Roman", Georgia, serif',
};
function customVars(c: Record<string, string | number | boolean> | undefined): React.CSSProperties {
  if (!c) return {};
  const v: Record<string, string> = {};
  const hex = (x: unknown) => (typeof x === 'string' && /^#[0-9a-f]{6}$/i.test(x) ? x : null);
  if (hex(c.accent)) v['--sb-accent'] = c.accent as string;
  if (hex(c.text)) v['--sb-chalk'] = c.text as string;
  if (hex(c.panel1)) v['--sb-panel1'] = c.panel1 as string;
  if (hex(c.panel2) || hex(c.panel1)) v['--sb-panel2'] = (hex(c.panel2) ?? c.panel1) as string;
  if (hex(c.well)) v['--sb-well'] = c.well as string;
  if (typeof c.font === 'string' && FONTS[c.font]) v['--sb-font'] = FONTS[c.font];
  if (c.radius !== undefined && c.radius !== '' && Number.isFinite(Number(c.radius))) v['--sb-radius'] = `${Math.max(0, Math.min(24, Number(c.radius))) / 15}rem`;
  return v as React.CSSProperties;
}

function Stat({ v, k, gold }: { v: string; k: string; gold?: boolean }) {
  return <span className="ov-stat"><b className={gold ? 'gold' : undefined}>{v}</b><small>{k}</small></span>;
}

function BatterCard({ b, brand, season, on, first = false }: { b: BatterView | null; brand: Brand; season: string; on: boolean; first?: boolean }) {
  return (
    <div className={`ov-card ov-batter${on && b ? ' on' : ''}`} aria-hidden={!on}>
      {b && <>
        <div className="ov-tile" style={vars(brand)}>
          <b style={{ fontSize: b.num.length > 2 ? '9rem' : '15rem' }}>{b.num || '–'}</b>
          {b.pos && <small>{b.pos}</small>}
        </div>
        <div className="ov-who">
          <div>
            <em>{first ? 'Leading off' : 'Now batting'}</em>
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

type Fresh = { side: 'away' | 'home'; inning: number };
function LineTable({ box, away, home, title, fresh }: { box: ReturnType<typeof boxScore>; away: Brand; home: Brand; title: string; fresh?: Fresh }) {
  const row = (b: Brand, cells: string[], tot: string[], side: 'away' | 'home') => (
    <tr>
      <th style={vars(b)}><i />{b.display}</th>
      {cells.map((c, i) => <td key={i} className={fresh && fresh.side === side && box.innings[i] === fresh.inning ? 'fresh' : undefined}>{c}</td>)}
      {tot.map((c, i) => <td key={`t${i}`} className={i === 0 ? 'r' : 't'}>{c}</td>)}
    </tr>
  );
  return (
    <table>
      <thead><tr><th>{title}</th>{box.innings.map((n) => <td key={n}>{n}</td>)}<td className="r">R</td><td className="t">H</td><td className="t">E</td></tr></thead>
      <tbody>{row(away, box.away, box.awayTot, 'away')}{row(home, box.home, box.homeTot, 'home')}</tbody>
    </table>
  );
}
type BoxProps = { box: ReturnType<typeof boxScore>; away: Brand; home: Brand };

function Box({ final, on, ...t }: BoxProps & { final: boolean; on: boolean }) {
  return <div className={`ov-card ov-panel ov-box${on ? ' on' : ''}`} aria-hidden={!on}><LineTable {...t} title={final ? 'Final' : 'Box score'} /></div>;
}

// Between halves the whole picture is the board: where the game stands, the
// half that just ended, and who comes up next. It takes over by itself at the
// third out (auto_mid) and gives the picture back on the next pitch.
function MidScene({ title, tag, list, up, fresh, recap, scores, on, show, abbrs, sponsor, ...t }: BoxProps & {
  title: string; tag: string; list: BatterView[]; up: Brand; fresh: Fresh; recap: string[]; scores: { away: number; home: number }; on: boolean;
  show: boolean; abbrs: { away: string; home: string }; sponsor: Feed['sponsor'];
}) {
  // Showtime, the elevated scenes' package, unless the Stream screen asks for Standard.
  if (show) {
    return (
      <div className={`ov-mid${on ? ' on' : ''}`} aria-hidden={!on}>
        {on && <MidShow tag={tag} title={title} away={t.away} home={t.home} abbrs={abbrs} scores={scores} recap={recap} list={list} up={up}
          sponsor={sponsor ? { name: sponsor.name, logo: sponsor.logo } : null} line={<LineTable {...t} title="" fresh={fresh} />} />}
      </div>
    );
  }
  const side = (b: Brand, score: number, lead: boolean) => (
    <div className={`md-team${lead ? ' lead' : ''}`} style={vars(b)}>
      <div className="md-slab">{b.logo && <img src={b.logo} alt="" />}<span style={fit(b.display, 6.4, 46)}>{b.display}</span></div>
      <b>{score}</b>
    </div>
  );
  return (
    <div className={`ov-mid${on ? ' on' : ''}`} aria-hidden={!on}>
      {on && <>
        <div className="md-veil" />
        <div className="md-body">
          <div className="md-head"><em>{tag}</em><strong>{title}</strong></div>
          <div className="md-board">{side(t.away, scores.away, scores.away > scores.home)}{side(t.home, scores.home, scores.home > scores.away)}</div>
          <div className="md-line ov-box"><LineTable {...t} title="" fresh={fresh} /></div>
          {recap.length > 0 && <div className="md-recap"><small>That half</small>{recap.map((r, i) => <span key={i}>{r}</span>)}</div>}
          {list.length > 0 && (
            <div className="md-due">
              <small style={vars(up)}>Due up · {up.display}</small>
              {list.map((b) => <div key={b.bid}><i>{b.num}</i><strong>{b.name}</strong><span>{b.pos}</span>{b.avg && <b>{b.avg}</b>}</div>)}
            </div>
          )}
        </div>
      </>}
    </div>
  );
}

function Lineup({ list, at, brand, on }: { list: BatterView[]; at: string | null; brand: Brand; on: boolean }) {
  return (
    <div className={`ov-card ov-panel${on && list.length ? ' on' : ''}`} aria-hidden={!on}>
      <div className="ov-phead" style={vars(brand)}><b>Lineup · {brand.display}</b></div>
      {list.map((b, i) => (
        <div key={b.bid} className={`ov-order${b.bid === at ? ' up' : ''}`}>
          <small>{i + 1}</small><i>{b.num}</i><strong style={fit(b.name, 2.6, 22)}>{b.name}</strong><small>{b.pos}</small>{b.avg && <b>{b.avg}</b>}
        </div>
      ))}
    </div>
  );
}

// Where each fielder stands, on a diamond.
const SPOT: Record<string, [number, number]> = { P: [50, 62], C: [50, 92], '1B': [78, 60], '2B': [64, 40], '3B': [22, 60], SS: [36, 40], LF: [16, 16], CF: [50, 6], RF: [84, 16] };
function Defense({ list, brand, on }: { list: AirView['defense']; brand: Brand; on: boolean }) {
  return (
    <div className={`ov-card ov-panel${on && list.length ? ' on' : ''}`} aria-hidden={!on}>
      <div className="ov-phead" style={vars(brand)}><b>Defense · {brand.display}</b></div>
      <div className="ov-field">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><path d="M50 96 L4 44 Q50 -14 96 44 Z" /><path d="M50 90 L30 68 L50 46 L70 68 Z" /></svg>
        {list.map((d) => (
          <span key={d.pos} style={{ left: `${SPOT[d.pos][0]}%`, top: `${SPOT[d.pos][1]}%` }}><small>{d.pos}</small><b>{shortName(d.name)}</b></span>
        ))}
      </div>
    </div>
  );
}

function Matchup({ b, p, bat, field, on }: { b: BatterView | null; p: PitcherView | null; bat: Brand; field: Brand; on: boolean }) {
  return (
    <div className={`ov-card ov-panel${on && b && p ? ' on' : ''}`} aria-hidden={!on}>
      {b && p && <>
        <div className="ov-phead" style={vars(bat)}><b>At bat · {bat.display}</b></div>
        <div className="ov-prow"><i>{b.num}</i><strong style={fit(b.name, 3.4, 34)}>{b.name}</strong></div>
        <div className="ov-pseason">{b.avg ? <><Stat v={b.avg} k="AVG" gold />{b.cells.slice(1, 3).map((c) => <Stat key={c.k} {...c} />)}</> : <small>{b.today ? `Today ${b.today}` : 'First time up'}</small>}</div>
        <div className="ov-phead" style={vars(field)}><b>Pitching · {field.display}</b></div>
        <div className="ov-prow"><i>{p.num}</i><strong style={fit(p.name, 3.4, 34)}>{p.name}</strong></div>
        <div className="ov-pseason">{p.today.slice(0, 1).concat(p.today.slice(2)).map((c) => <Stat key={c.k} {...c} />)}{p.season && <Stat {...p.season[0]} gold />}</div>
      </>}
    </div>
  );
}

function Sponsor({ sp, on }: { sp: Feed['sponsor']; on: boolean }) {
  return (
    <div className={`ov-card ov-panel ov-sponsor${on && sp ? ' on' : ''}`} aria-hidden={!on}>
      {sp && <>
        <small>Brought to you by</small>
        {sp.logo && <img src={sp.logo} alt="" />}
        <strong style={fit(sp.name, 4.4, 38)}>{sp.name}</strong>
        {sp.line && <span>{sp.line}</span>}
      </>}
    </div>
  );
}

// The channel's link as a code a phone can read off the screen: its own
// layer, sized, placed and faded from On Air.
function Qr({ bug, qr }: { bug: Feed['bug']; qr: Feed['qr'] }) {
  const q = qrLayer(qr);
  const url = bug?.url;
  const code = q.on && url ? qrPath(url) : null;
  return (
    <div className={`ov-qr ${q.pos}${code ? ' on' : ''}${bug?.text ? ' above' : ''}`} aria-hidden={!code}
      style={{ '--q': `${q.size}rem`, '--o': q.opacity } as React.CSSProperties}>
      {code && url && <>
        <svg viewBox={`-2 -2 ${code.size + 4} ${code.size + 4}`} shapeRendering="crispEdges" aria-hidden="true"><rect x="-2" y="-2" width={code.size + 4} height={code.size + 4} fill="#fff" /><path d={code.d} fill="#000" /></svg>
        <span>{url.replace(/^https:\/\/(www\.)?/, '').replace(/\/$/, '')}</span>
      </>}
    </div>
  );
}

// The game clock as the stream shows it: soccer counts up inside the play
// state (plus stoppage), the rest run on games.clock. `now` comes from the page,
// which ticks while a clock runs.
export function clockOf(feed: Feed, now: number): string | null {
  const game = feed.game;
  if (!game || feed.broadcast?.show?.clock === false) return null;
  const live = game.live as SportLive;
  if (game.sport === 'soccer') {
    const st = (live.state ?? {}) as { clock?: { running?: boolean; base?: number }; stoppage?: number };
    if (!st.clock?.running && !st.clock?.base) return null;
    return clockText(soccerSeconds(live, now)) + (st.stoppage ? ` +${st.stoppage}` : '');
  }
  const sec = clockSeconds(game.clock, now);
  return sec === null ? null : clockText(sec);
}

export function Stage({ feed, card, moment = null, now = 0, intro = null, fx = null }: {
  feed: Feed | null; card: CardKind | null; moment?: { text: string; who: string; runs: number } | null; now?: number;
  intro?: BugProps['intro']; fx?: BugProps['fx'];
}) {
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
  const sport = feed.game!.sport ?? 'baseball';
  const ball = sport === 'baseball';
  // A card held by hand comes first; else the mid-inning board between halves, when that is on.
  const want = card ?? (autoMid(feed) ? 'mid' : null);
  // The box score and the sponsor stand after the last out; the rest are for a baseball game in play.
  // Before first pitch the lineup cards work too (the leadoff batter, the starters, the order); the
  // mid-inning board and the box score wait for a game in play.
  const pre = status === 'scheduled' && want !== 'mid' && want !== 'box';
  const shown = want === 'sponsor' ? want : !ball ? null : live || pre || (want === 'box' && status === 'final') ? want : null;
  // Scoreboard's own bug is drawn below; every other look is a component of its own.
  const abbr = (t: Feed['team']) => (t.abbr || '').toUpperCase();
  const lay = layoutOf(feed.layout);
  const Bug = feed.look ? LOOK_BUGS[feed.look] : undefined;
  const clock = clockOf(feed, now);
  const detail = ball ? null : situationText(sport, feed.game!.live as SportLive, { away: away.display, home: home.display }) || null;
  const own = { g, air, away, home, status, showLine: feed.show_line, moment, topEdge: lay.bug.pos.startsWith('t'), period: ball ? null : periodText(sport, feed.game!.live as SportLive),
    clock, detail, intro, fx, rally: !!feed.broadcast?.rally,
    abbrs: { away: abbr(feed.game!.is_home ? feed.opponent : feed.team), home: abbr(feed.game!.is_home ? feed.team : feed.opponent) } };
  // The finished half's cell, to pulse on the mid-inning board: the top of this inning, or the bottom of the last.
  const recap = halfRecap(feed, g);
  const fresh = g.half === 'bottom' ? { side: 'away' as const, inning: g.inning | 0 } : { side: 'home' as const, inning: (g.inning | 0) - 1 };
  const box = boxScore(g, feed.season?.game_innings ?? 7);
  // How Scoreboard's own bug is painted and what it shows (Stream screen).
  const bc = feed.broadcast ?? {};
  const show = bc.show ?? {};
  const theme = bc.theme || 'nightgame', style = bc.style || 'bar';
  const he = (side: 'away' | 'home'): [number, number] | null => (ball && show.rhe ? [Number(g[`${side}_hits`]) | 0, Number(g[`${side}_errors`]) | 0] : null);
  const rr = Number(feed.game!.settings?.run_rule) || 0;
  const runRule = ball && live && show.runrule !== false && rr > 0 && Math.abs((g.away_score | 0) - (g.home_score | 0)) >= rr;
  const base = (on: boolean, x: number, y: number) => (
    <rect x={x} y={y} width="16" height="16" transform={`rotate(45 ${x + 8} ${y + 8})`} className={on ? 'on' : undefined} />
  );

  const ext = (
    <div className="ov-ext">
      <BatterCard b={air.batter} brand={brandFor(air.batSide)} season={batUs && feed.season ? feed.season.name : 'Season'} on={shown === 'batter'} first={status === 'scheduled'} />
      <PitcherCard p={air.pitcher} brand={brandFor(air.fieldSide)} on={shown === 'pitcher'} />
      <DueUp list={air.dueUp} brand={brandFor(air.batSide)} when={`${top ? 'Top' : 'Bot'} ${g.inning}`} on={shown === 'dueup'} />
      <Leaders list={leaders(feed.season_stats, feed.roster ?? [])} brand={us} season={feed.season?.name ?? 'Season'} on={shown === 'leaders'} />
      <Box box={box} away={away} home={home} final={status === 'final'} on={shown === 'box'} />
        <Lineup list={air.order} at={air.batter?.bid ?? null} brand={brandFor(air.batSide)} on={shown === 'lineup'} />
      <Defense list={air.defense} brand={brandFor(air.fieldSide)} on={shown === 'defense'} />
      <Matchup b={air.batter} p={air.pitcher} bat={brandFor(air.batSide)} field={brandFor(air.fieldSide)} on={shown === 'matchup'} />
      <Sponsor sp={feed.sponsor} on={shown === 'sponsor'} />
    </div>
  );

  return (
    <div className={`ov bug-${lay.bug.pos}${show.batter === false ? ' no-batter' : ''}${show.pitcher === false ? ' no-pitcher' : ''}${theme === 'custom' && bc.custom?.teamFill ? ' team-fill' : ''}`}
      data-theme={theme} data-style={style}
      style={{ '--bs': lay.bug.scale, '--cs': lay.cards.scale, ...(theme === 'custom' ? customVars(bc.custom) : {}) } as React.CSSProperties}>
      <style>{ROOT}</style>
      <MidScene box={box} away={away} home={home} title={breakText(g)} tag={g.half === 'bottom' ? `Mid ${g.inning}` : `End ${Math.max(1, (g.inning | 0) - 1)}`}
        list={air.dueUp} up={brandFor(air.batSide)} fresh={fresh} recap={recap} scores={{ away: g.away_score | 0, home: g.home_score | 0 }} on={shown === 'mid'}
        show={bc.scene_style !== 'standard'} abbrs={own.abbrs} sponsor={feed.sponsor} />
      {feed.bug?.text && <div className="ov-chan">{feed.bug.text}</div>}
      <Qr bug={feed.bug} qr={feed.qr} />
      {/* Or the cards stand on their own, wherever the Stream screen puts them. */}
      {lay.cards.pos !== 'bug' && <div className={`ov-free at-${lay.cards.pos}`}>{ext}</div>}
      <div className="ov-dock">
        {/* Every card is an extension of the scorebug: one slot on its far side, and a card slides out from behind the plate. */}
        {lay.cards.pos === 'bug' && ext}
        {Bug && <div className="ov-look"><Bug {...own} /></div>}
        {!Bug && <div className={`ov-moment${moment ? ' on' : ''}`} aria-hidden={!moment}>{moment && <><b>{moment.text === 'Home run' && moment.runs >= 4 ? 'Grand slam' : moment.text}</b><span>{[moment.who, moment.text === 'Home run' && moment.runs < 4 ? homerText(moment.runs) : ''].filter(Boolean).join(' · ')}</span></>}</div>}
        {!Bug && <div className={`ov-bug${shown === 'batter' ? ' carded' : ''}`}>
          <div className="ov-rail">
            <Team brand={away} score={g.away_score | 0} bat={ball && live && top} he={he('away')} />
            <Team brand={home} score={g.home_score | 0} bat={ball && live && !top} he={he('home')} />
            {live && !ball ? <div className="ov-sit word"><b>{periodText(sport, feed.game!.live as SportLive)}</b>{clock && <b className="ov-clk">{clock}</b>}</div> : live ? (
              <div className="ov-sit">
                <div className="ov-inn"><i className={top ? 'on' : undefined} /><b>{g.inning}</b><i className={top ? 'dn' : 'dn on'} /></div>
                <svg width="62" height="52" viewBox="0 0 62 52" aria-hidden="true">
                  {base(b.second, 23, 4)}{base(b.third, 5, 22)}{base(b.first, 41, 22)}
                </svg>
                <div className="ov-count">
                  <b>{g.balls | 0}-{g.strikes | 0}</b>
                  <span>{[0, 1, 2].map((i) => <i key={i} className={i < (g.outs | 0) ? 'on' : undefined} />)}</span>
                </div>
                <div className="ov-bso" aria-hidden="true">
                  {([['B', g.balls | 0, 3], ['S', g.strikes | 0, 2], ['O', g.outs | 0, 2]] as const).map(([k, n, of]) => (
                    <span key={k}><em>{k}</em>{Array.from({ length: of }, (_, i) => <i key={i} className={i < n ? 'on' : undefined} />)}</span>
                  ))}
                </div>
              </div>
            ) : <div className="ov-sit word"><b>{status === 'final' ? 'Final' : 'Pregame'}</b></div>}
            {ball && live && clock && <div className="ov-sit word"><b className="ov-clk">{clock}</b></div>}
            {runRule && <span className="ov-rr">Run rule</span>}
          </div>
          {!ball && live && detail && <div className="ov-strip"><span className="ov-detail">{detail}</span></div>}
          {ball && live && (air.batter || air.pitcher) && (
            <div className="ov-strip">
              {air.batter && (
                <span key={air.batter.bid} className="ov-ab">
                  <em>AB</em><strong>{air.batter.name}</strong>
                  {feed.show_line && air.batter.avg && <Stat v={air.batter.avg} k="AVG" gold />}
                  {feed.show_line && air.batter.today && <Stat v={air.batter.today} k="Today" />}
                </span>
              )}
              {air.pitcher && <span className="ov-p">P · {air.pitcher.last}{show.pitchcount !== false && <> <b>{air.pitcher.pitches}</b></>}</span>}
            </div>
          )}
        </div>}
      </div>
    </div>
  );
}
