'use client';

import { useEffect, useState } from 'react';
import { forecastFor, type Forecast, type Sky } from '@/lib/forecast';
import { directionsUrl } from '@/lib/geo';
import type { Game } from '@/lib/types';

// Where a game is and what the sky will do: the forecast for first pitch with
// a sky that moves, directions to the field, and the tournament's page. On the
// Today card, the game screen and the public game page.

// A small sky that moves: the sun turns, clouds drift, rain and snow fall,
// lightning flashes. CSS only; still under reduced motion.
export function SkyIcon({ sky, night, size = 64 }: { sky: Sky; night?: boolean; size?: number }) {
  const sun = night
    ? <g className="sk-moon"><path d="M44 18a16 16 0 1 0 12 26 13 13 0 0 1-12-26z" /><circle className="sk-star" cx="16" cy="14" r="1.6" /><circle className="sk-star s2" cx="54" cy="12" r="1.2" /></g>
    : <g className="sk-sun"><circle cx="32" cy="30" r="11" /><g className="sk-rays">{Array.from({ length: 8 }, (_, i) => <rect key={i} x="31" y="8" width="2.4" height="7" rx="1.2" transform={`rotate(${i * 45} 32 30)`} />)}</g></g>;
  const cloud = (cls: string, dx = 0, dy = 0) => (
    <path className={`sk-cloud ${cls}`} transform={`translate(${dx} ${dy})`} d="M18 46h30a10 10 0 0 0 0-20 14 14 0 0 0-26-3 9 9 0 0 0-4 23z" />
  );
  const drops = (cls: string) => [14, 26, 38].map((x, i) => <line key={x} className={`sk-drop ${cls}`} style={{ animationDelay: `${i * 0.27}s` }} x1={x + 6} y1="50" x2={x + 3} y2="58" />);
  return (
    <svg className={`sky sky-${sky}${night ? ' night' : ''}`} viewBox="0 0 64 64" width={size} height={size} aria-hidden="true">
      {(sky === 'clear' || sky === 'partly') && sun}
      {sky === 'partly' && cloud('drift', 6, 6)}
      {sky === 'cloudy' && <>{cloud('back drift2', -6, -6)}{cloud('drift')}</>}
      {sky === 'fog' && <>{cloud('back')}<g className="sk-fog"><rect x="8" y="48" width="44" height="3" rx="1.5" /><rect x="14" y="55" width="40" height="3" rx="1.5" /></g></>}
      {(sky === 'drizzle' || sky === 'rain') && <>{cloud('drift')}{drops(sky === 'drizzle' ? 'light' : '')}</>}
      {sky === 'storm' && <>{cloud('dark drift')}{drops('')}<path className="sk-bolt" d="M34 44l-6 10h5l-3 9 9-12h-5l3-7z" /></>}
      {sky === 'snow' && <>{cloud('drift')}{[16, 30, 44].map((x, i) => <circle key={x} className="sk-flake" style={{ animationDelay: `${i * 0.6}s` }} cx={x} cy="52" r="2" />)}</>}
    </svg>
  );
}

export function GamePlace({ game, compact = false }: { game: Pick<Game, 'venue' | 'address' | 'tournament_url' | 'venue_geo' | 'starts_at' | 'status'>; compact?: boolean }) {
  const geo = game.venue_geo;
  const live = game.status === 'live';
  const [wx, setWx] = useState<Forecast | null>(null);
  useEffect(() => {
    if (!geo || game.status === 'final') return;
    let stop = false;
    const read = () => forecastFor(geo, game.starts_at, live).then((f) => { if (!stop) setWx(f); }).catch(() => {});
    const first = window.setTimeout(read, 0);
    // A forecast moves slowly; during a game, the weather now is read every ten minutes.
    const again = window.setInterval(read, 10 * 60 * 1000);
    return () => { stop = true; window.clearTimeout(first); window.clearInterval(again); };
  }, [geo, game.starts_at, game.status, live]);

  const place = game.address || game.venue;
  if (!wx && !place && !game.tournament_url) return null;
  let host = '';
  try { host = game.tournament_url ? new URL(game.tournament_url).hostname.replace(/^www\./, '') : ''; } catch { /* shown without a host */ }
  return (
    <div className={`gplace${compact ? ' compact' : ''}`}>
      {wx && (
        <div className="gwx">
          <SkyIcon sky={wx.sky} night={wx.night} size={compact ? 48 : 64} />
          <div className="gwx-main">
            <b>{wx.temp}°</b>
            <span>{wx.text}{wx.now ? ' now' : ' at first pitch'}</span>
            <small>{[wx.pop != null ? `${wx.pop}% rain` : null, wx.wind ? `Wind ${wx.dir} ${wx.wind} mph` : null].filter(Boolean).join(' · ')}</small>
          </div>
        </div>
      )}
      {(place || game.tournament_url) && (
        <div className="gplace-links">
          {game.address && !compact && <p className="sub gplace-addr">{game.address}{host ? <><br />Tournament page on {host}</> : null}</p>}
          <div className="btn-row">
            {place && <a className="btn btn-quiet" href={directionsUrl(game.address || game.venue || '')} target="_blank" rel="noopener noreferrer">Directions</a>}
            {game.tournament_url && <a className="btn btn-quiet" href={game.tournament_url} target="_blank" rel="noopener noreferrer" title={host}>Tournament</a>}
          </div>
        </div>
      )}
    </div>
  );
}
