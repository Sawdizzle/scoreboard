'use client';

import { Sheet } from '@/components/pad/PadSheets';
import type { Brand } from '@/components/TeamBrand';
import { inkOn } from '@/lib/format';
import type { AirView, CardKind } from '@/lib/onair';

export type Channel = { token: string; game_id: string | null; show_line: boolean; auto_card: boolean; card: CardKind | null };

// What the stream is showing, run from the field. One card on air at a time:
// tap one to raise it, tap it again to clear it. The two switches are what
// the scorebug does by itself.
export function OnAir({ channel, gameId, view, brand, when, live, final, score, onSet, onClose }: {
  channel: Channel; gameId: string; view: AirView; brand: Brand; when: string; live: boolean; final: boolean; score: string;
  onSet: (patch: Partial<Channel>) => void; onClose: () => void;
}) {
  const here = channel.game_id === gameId;
  const { batter, pitcher, dueUp } = view;
  const up = (k: CardKind) => here && channel.card === k;
  const flip = (k: CardKind) => onSet({ card: up(k) ? null : k, ...(here ? {} : { game_id: gameId }) });
  const k = pitcher?.today.find((c) => c.k === 'K')?.v;
  return (
    <Sheet title="On Air" onClose={onClose} close="Done">
      {!here && (
        <button type="button" className="pchoice on" onClick={() => onSet({ game_id: gameId, card: null })}>
          <b>Put this game on the stream</b>
          <small>{channel.game_id ? 'The stream is showing another game.' : 'The stream follows the pad from the first pitch; this puts it up now.'}</small>
        </button>
      )}
      <p className="eyebrow">{live ? `Right now · ${when}` : final ? 'Final · the box score can stay up' : 'Cards come up once the game is live'}</p>

      <button type="button" className={`air-batter${up('batter') ? ' on' : ''}`} aria-pressed={up('batter')} disabled={!live || !batter} onClick={() => flip('batter')}>
        <span className="air-num" style={{ '--c': brand.color, '--ink': inkOn(brand.color) } as React.CSSProperties}>{batter?.num || '–'}</span>
        <span className="air-main">
          <span className="air-top"><b>Batter card</b><span className={`tag${up('batter') ? ' live' : ''}`}>{up('batter') ? 'On air' : 'Off air'}</span></span>
          <span className="air-sub">{batter ? `${batter.name} · ${batter.today ? `tonight ${batter.today}` : 'first time up'}` : 'No batter: set the lineup'}</span>
          {batter?.avg && (
            <span className="air-cells">
              <span><b>{batter.avg}</b><small>AVG</small></span>
              {batter.cells.filter((c) => c.k !== 'HR').map((c) => <span key={c.k}><b>{c.v}</b><small>{c.k}</small></span>)}
            </span>
          )}
        </span>
      </button>

      <div className="pgrid two">
        <button type="button" className={`pchoice${up('pitcher') ? ' on' : ''}`} aria-pressed={up('pitcher')} disabled={!live || !pitcher} onClick={() => flip('pitcher')}>
          <b>Pitcher card</b>
          <small>{pitcher ? `#${pitcher.num} ${pitcher.last} · ${pitcher.pitches} pitches${k && k !== '0' ? ` · ${k} K` : ''}` : 'No pitcher set'}</small>
        </button>
        <button type="button" className={`pchoice${up('dueup') ? ' on' : ''}`} aria-pressed={up('dueup')} disabled={!live || !dueUp.length} onClick={() => flip('dueup')}>
          <b>Due up</b>
          <small>{dueUp.map((b) => b.name.split(' ').pop()).join(', ') || 'No lineup set'}</small>
        </button>
      </div>

      <div className="pgrid two">
        <button type="button" className={`pchoice${up('leaders') ? ' on' : ''}`} aria-pressed={up('leaders')} disabled={!live} onClick={() => flip('leaders')}>
          <b>Team leaders</b><small>AVG · HR · RBI · SB</small>
        </button>
        <button type="button" className={`pchoice${up('box') ? ' on' : ''}`} aria-pressed={up('box')} disabled={!live && !final} onClick={() => flip('box')}>
          <b>Box score</b><small>{score}</small>
        </button>
      </div>

      <div className="air-autos">
        <label className="switch">
          <span className="switch-text"><b>Season line on the scorebug</b><small>AVG and tonight, beside the batter</small></span>
          <input type="checkbox" checked={channel.show_line} onChange={(e) => onSet({ show_line: e.target.checked })} />
        </label>
        <label className="switch">
          <span className="switch-text"><b>Pop the card for each new batter</b><small>Six seconds, then it clears itself</small></span>
          <input type="checkbox" checked={channel.auto_card} onChange={(e) => onSet({ auto_card: e.target.checked })} />
        </label>
      </div>
    </Sheet>
  );
}
