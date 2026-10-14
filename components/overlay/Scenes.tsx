'use client';
/* eslint-disable @next/next/no-img-element -- logos are small files from Storage, shown at fixed sizes */

import './scenes.css';
import { brandOf, type Brand } from '@/components/TeamBrand';
import { clockText, type Scene } from '@/lib/broadcast';
import { inkOn } from '@/lib/format';
import { boxScore, feedView, type Feed } from '@/lib/onair';
import * as L from '@/lib/rules/logic.js';
import { periodName, type SportLive } from '@/lib/sports';

// v4's full-frame scenes on the v5 stream: Starting Soon (the sport's field
// drawing itself, both teams, a countdown to first pitch and the venue's
// weather), Final (who won and how, with the line score), and Game paused (the
// reason, the score, a countdown to the restart, and a storm to match). Plus
// the announcement ticker along the bottom. `elevated` is v4's network-TV
// package for the same scenes.
export type Weather = { temp: number; text: string; icon: string; wind: number; dir: string; pop: number | null };

const START: Record<string, [string, string]> = {
  baseball: ['Baseball', 'First pitch'], football: ['Football', 'Kickoff'], soccer: ['Soccer', 'Kickoff'],
  basketball: ['Basketball', 'Tip-off'], volleyball: ['Volleyball', 'First serve'],
};
const PAUSE: Record<NonNullable<Scene['reason']>, { icon: string; tag: string; title: string; sub: string }> = {
  lightning: { icon: '⚡', tag: 'Lightning delay', title: 'Play is paused', sub: 'Lightning in the area: players are off the field' },
  rain: { icon: '🌧', tag: 'Rain delay', title: 'Play is paused', sub: 'Waiting out the rain' },
  weather: { icon: '⛈', tag: 'Weather delay', title: 'Play is paused', sub: 'Waiting out the weather' },
  suspended: { icon: '⏸', tag: 'Suspended', title: 'Game suspended', sub: 'Play will pick up at a later date' },
  called: { icon: '🏁', tag: 'Called', title: 'Game called', sub: 'The game has been called due to weather' },
};

const vars = (b: Brand) => ({ '--c': b.color, '--c2': b.color2, '--ink': inkOn(b.color) }) as React.CSSProperties;
const nameSize = (a: string, b: string) => {
  const n = Math.max(a.length, b.length);
  return `${n > 22 ? 3.4 : n > 16 ? 4 : n > 11 ? 4.8 : 5.6}rem`;
};

function Field({ sport }: { sport: string }) {
  // Faint field markings that trace themselves in, 1920 x 1080.
  const lines: Record<string, React.ReactNode> = {
    baseball: <><path d="M960 980 L1330 610 L960 240 L590 610 Z" /><path d="M960 980 L260 280 M960 980 L1660 280" /><path d="M470 470 Q960 -40 1450 470" /><circle cx="960" cy="640" r="52" /></>,
    football: <>{Array.from({ length: 13 }, (_, i) => <path key={i} d={`M${i * 160} 150 L${i * 160} 930`} />)}<path d="M0 150 H1920 M0 930 H1920" /></>,
    soccer: <><path d="M960 90 V990" /><circle cx="960" cy="540" r="190" /><path d="M60 90 H1860 V990 H60 Z" /><path d="M60 330 H330 V750 H60 M1860 330 H1590 V750 H1860" /></>,
    basketball: <><path d="M960 90 V990" /><circle cx="960" cy="540" r="150" /><path d="M60 90 H1860 V990 H60 Z" /><path d="M60 190 Q700 540 60 890 M1860 190 Q1220 540 1860 890" /></>,
    volleyball: <><path d="M160 140 H1760 V940 H160 Z" /><path d="M160 400 H1760 M160 680 H1760 M160 510 H1760 M160 570 H1760" /></>,
  };
  return <svg className="scn-field" viewBox="0 0 1920 1080" preserveAspectRatio="xMidYMid slice" aria-hidden="true">{lines[sport] ?? lines.baseball}</svg>;
}

function TeamBlock({ b, abbr }: { b: Brand; abbr: string }) {
  return (
    <div className="scn-team" style={vars(b)}>
      <div className="scn-logo">{b.logo ? <img src={b.logo} alt="" /> : <span>{(abbr || b.display.slice(0, 3)).toUpperCase()}</span>}</div>
      <div className="scn-bar" />
    </div>
  );
}

function WeatherLine({ w, where }: { w: Weather | null; where?: string | null }) {
  if (!w) return null;
  return (
    <div className="scn-wx">
      <span aria-hidden="true">{w.icon}</span><b>{w.temp}°</b><span>{w.text}</span>
      {w.wind ? <span>Wind {w.dir} {w.wind} mph</span> : null}
      {w.pop != null && <span>{w.pop}% rain</span>}
      {where && <span className="scn-where">{where}</span>}
    </div>
  );
}

// A countdown in the scene: to first pitch, or to the restart.
function Countdown({ at, now, done, label }: { at: string | null | undefined; now: number; done: string; label?: string }) {
  if (!at || !now) return null;
  const ms = Date.parse(at) - now;
  return (
    <div className="scn-clock">
      <b className={ms <= 0 ? 'now' : ms <= 60000 ? 'soon' : undefined}>{ms <= 0 ? done : clockText(Math.round(ms / 1000))}</b>
      {label && <small>{label}</small>}
    </div>
  );
}

function Storm({ reason, strike }: { reason: NonNullable<Scene['reason']>; strike: number }) {
  const rain = reason === 'rain' ? 'heavy' : reason === 'lightning' || reason === 'weather' ? 'light' : null;
  return (
    <div className={`scn-storm ${reason === 'rain' || reason === 'suspended' || reason === 'called' ? 'grey' : 'dark'}`} aria-hidden="true">
      <i className="cl c0" /><i className="cl c1" /><i className="cl c2" />
      {rain && <><i className={`rn far ${rain}`} /><i className={`rn near ${rain}`} /></>}
      {reason === 'lightning' && strike > 0 && <i key={strike} className="flash" />}
      {reason === 'lightning' && strike > 0 && (
        <svg key={`b${strike}`} className="bolt" viewBox="0 0 1920 1080" preserveAspectRatio="xMidYMid slice">
          <path d={`M${700 + (strike % 7) * 70} 0 L${660 + (strike % 7) * 70} 260 L${720 + (strike % 7) * 70} 270 L${640 + (strike % 7) * 70} 560 L${700 + (strike % 7) * 70} 570 L${600 + (strike % 7) * 70} 900`} />
        </svg>
      )}
    </div>
  );
}

export function Scenes({ feed, now, weather, strike }: { feed: Feed | null; now: number; weather: Weather | null; strike: number }) {
  const scene = feed?.broadcast?.scene ?? null;
  const ticker = feed?.broadcast?.ticker;
  const tickText = ticker?.on && ticker.text?.trim() ? ticker.text.trim() : '';
  const elevated = feed?.broadcast?.scene_style === 'elevated';
  const game = feed?.game ?? null;
  let body: React.ReactNode = null;

  if (scene && feed) {
    const us = brandOf(feed.team), them = brandOf(feed.opponent);
    const isHome = game?.is_home ?? true;
    const [away, home] = isHome ? [them, us] : [us, them];
    const [aAbbr, hAbbr] = isHome ? [feed.opponent.abbr ?? '', feed.team.abbr ?? ''] : [feed.team.abbr ?? '', feed.opponent.abbr ?? ''];
    const sport = game?.sport ?? 'baseball';
    const live = (game?.live ?? {}) as SportLive & Record<string, unknown>;
    const as = Number(live.away_score) || 0, hs = Number(live.home_score) || 0;
    const size = nameSize(away.display, home.display);
    const where = game?.venue_geo?.label ?? game?.venue ?? null;
    const style = { '--away': away.color, '--home': home.color } as React.CSSProperties;

    if (scene.kind === 'starting') {
      const [label, start] = START[sport] ?? START.baseball;
      const when = game?.starts_at ? new Date(game.starts_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';
      body = (
        <div className="scn scn-starting" style={style}>
          <Field sport={sport} />
          <div className="scn-kicker"><span>{label}</span><b>{scene.title || 'Game starting soon'}</b></div>
          <div className="scn-main">
            <div className="scn-side"><TeamBlock b={away} abbr={aAbbr} /><strong style={{ fontSize: size }}>{away.display}</strong></div>
            <div className="scn-vs">VS</div>
            <div className="scn-side"><TeamBlock b={home} abbr={hAbbr} /><strong style={{ fontSize: size }}>{home.display}</strong></div>
          </div>
          <WeatherLine w={weather} where={where} />
          <Countdown at={game?.starts_at} now={now} done="Starting now" label={when ? `${start} · ${when}` : undefined} />
        </div>
      );
    } else if (scene.kind === 'final') {
      const v = feedView(feed);
      const story = sport === 'baseball' && v
        ? L.finalStory({ ...v.g, regulation_innings: game?.settings?.regulation || feed.season?.game_innings || 7, run_rule_diff: game?.settings?.run_rule || 0 }) as { winner: 'home' | 'away' | null; walkoff: boolean; runRule: boolean }
        : { winner: as === hs ? null : as > hs ? 'away' : 'home', walkoff: false, runRule: false };
      const winner = story.winner === 'home' ? home : story.winner === 'away' ? away : null;
      const how = story.walkoff ? 'Walk-off' : story.runRule ? 'Run rule' : '';
      const box = v && sport === 'baseball' ? boxScore(v.g, feed.season?.game_innings ?? 7) : null;
      body = (
        <div className="scn scn-final" style={style}>
          <div className="scn-kicker"><span>{how || 'Final'}</span><b>{scene.title || (winner ? `${winner.display} win` : 'Final')}</b></div>
          <div className="scn-main">
            <div className={`scn-side${story.winner === 'away' ? ' won' : ''}`}><TeamBlock b={away} abbr={aAbbr} /><strong style={{ fontSize: size }}>{away.display}</strong><em>{as}</em></div>
            <div className="scn-vs">Final</div>
            <div className={`scn-side${story.winner === 'home' ? ' won' : ''}`}><TeamBlock b={home} abbr={hAbbr} /><strong style={{ fontSize: size }}>{home.display}</strong><em>{hs}</em></div>
          </div>
          {box && (
            <table className="scn-line">
              <thead><tr><th />{box.innings.map((n) => <td key={n}>{n}</td>)}<td className="r">R</td><td>H</td><td>E</td></tr></thead>
              <tbody>
                {([[away, box.away, box.awayTot], [home, box.home, box.homeTot]] as const).map(([b, cells, tot], i) => (
                  <tr key={i}><th style={vars(b)}>{b.display}</th>{cells.map((c, j) => <td key={j} style={{ '--i': j * 2 + i } as React.CSSProperties}>{c}</td>)}
                    <td className="r">{tot[0]}</td><td>{tot[1]}</td><td>{tot[2]}</td></tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      );
    } else if (scene.kind === 'paused') {
      const reason = scene.reason && PAUSE[scene.reason] ? scene.reason : 'weather';
      const p = PAUSE[reason];
      const v = feedView(feed);
      const stands = sport === 'baseball' && v
        ? `${v.g.half === 'bottom' ? 'Bottom' : 'Top'} of the ${['', '1st', '2nd', '3rd'][v.g.inning | 0] ?? `${v.g.inning}th`}${v.g.outs ? ` · ${v.g.outs} out${v.g.outs > 1 ? 's' : ''}` : ''}`
        : periodName(sport, live);
      const clock = reason !== 'suspended' && reason !== 'called';
      body = (
        <div className={`scn scn-paused pz-${reason}`} style={style}>
          <Storm reason={reason} strike={strike} />
          <div className="scn-kicker"><span>{p.icon} {p.tag}</span><b>{p.title}</b></div>
          <p className="scn-sub">{p.sub}</p>
          <div className="scn-score">
            <span style={vars(away)}><i />{away.display}<b>{as}</b></span>
            <span style={vars(home)}><i />{home.display}<b>{hs}</b></span>
            <small>{stands}</small>
          </div>
          {clock && <Countdown at={scene.at} now={now} done="Any minute" label="Expected restart" />}
          <WeatherLine w={weather} where={where} />
        </div>
      );
    }
  }

  return (
    <>
      <div className={`scn-layer${elevated ? ' elevated' : ''}${body ? ' on' : ''}`} aria-hidden={!body}>{body}</div>
      <div className={`scn-ticker${tickText ? ' up' : ''}${ticker?.tone === 'alert' ? ' alert' : ''}`} aria-hidden={!tickText}>
        <span className="lab">{ticker?.tone === 'alert' ? '⚠ Alert' : 'Notice'}</span>
        <div className="track">
          {tickText && <div key={tickText} className="run" style={{ '--d': `${Math.max(12, tickText.length * 0.32)}s` } as React.CSSProperties}>
            <span>{tickText}</span><span aria-hidden="true">{tickText}</span>
          </div>}
        </div>
      </div>
    </>
  );
}
