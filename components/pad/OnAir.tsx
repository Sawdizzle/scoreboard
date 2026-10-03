'use client';

import { Sheet } from '@/components/pad/PadSheets';
import type { Brand } from '@/components/TeamBrand';
import { inkOn } from '@/lib/format';
import { useRef, useState } from 'react';
import { QR_OPACITY, QR_SIZE, qrLayer, type AirView, type CardKind, type QrLayer, type QrPos } from '@/lib/onair';

export type Channel = { token: string; game_id: string | null; show_line: boolean; auto_card: boolean; auto_mid: boolean; card: CardKind | null; sponsor_name: string | null;
  bug_url: string | null; qr?: Partial<QrLayer> | null; spot?: { n: number; cut: 'pitch' | 'inning' } | null };

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

      <div className="pgrid three">
        {([['lineup', 'Lineup', dueUp.length > 0], ['defense', 'Defense', view.defense.length > 0], ['matchup', 'Matchup', !!batter && !!pitcher], ['mid', 'Mid-inning', true]] as const).map(([k, label, ok]) => (
          <button key={k} type="button" className={`pchoice${up(k) ? ' on' : ''}`} aria-pressed={up(k)} disabled={!live || !ok} onClick={() => flip(k)}><b>{label}</b></button>
        ))}
        {channel.sponsor_name && (
          <button type="button" className={`pchoice${up('sponsor') ? ' on' : ''}`} aria-pressed={up('sponsor')} onClick={() => flip('sponsor')}><b>Sponsor</b><small>{channel.sponsor_name}</small></button>
        )}
      </div>

      <p className="eyebrow">Spots · play once per tap</p>
      <div className="pgrid two">
        <button type="button" className="pchoice" onClick={() => onSet({ spot: { n: Date.now(), cut: 'pitch' }, ...(here ? {} : { game_id: gameId }) })}><b>Quick spot</b><small>A banner, about 7 seconds</small></button>
        <button type="button" className="pchoice" onClick={() => onSet({ spot: { n: Date.now(), cut: 'inning' }, ...(here ? {} : { game_id: gameId }) })}><b>Full spot</b><small>Full screen, about 13 seconds</small></button>
      </div>

      {channel.bug_url && <QrControls qr={channel.qr} onSet={(qr) => onSet({ qr })} />}

      <div className="air-autos">
        <label className="switch">
          <span className="switch-text"><b>Season line on the scorebug</b><small>AVG and tonight, beside the batter</small></span>
          <input type="checkbox" checked={channel.show_line} onChange={(e) => onSet({ show_line: e.target.checked })} />
        </label>
        <label className="switch">
          <span className="switch-text"><b>Pop the card for each new batter</b><small>Six seconds, then it clears itself</small></span>
          <input type="checkbox" checked={channel.auto_card} onChange={(e) => onSet({ auto_card: e.target.checked })} />
        </label>
        <label className="switch">
          <span className="switch-text"><b>Mid-inning board between halves</b><small>Line score and who is due up, until the next pitch</small></span>
          <input type="checkbox" checked={channel.auto_mid} onChange={(e) => onSet({ auto_mid: e.target.checked })} />
        </label>
      </div>
    </Sheet>
  );
}

// The QR code on the stream: on or off, and how it sits. A slider shows its
// number as it moves and saves when it rests, so dragging one is one write.
const POS_LABEL: Record<QrPos, string> = { tl: 'Top left', tc: 'Top centre', tr: 'Top right', ml: 'Middle left', mr: 'Middle right', bl: 'Bottom left', bc: 'Bottom centre', br: 'Bottom right' };
function QrControls({ qr, onSet }: { qr: Partial<QrLayer> | null | undefined; onSet: (q: QrLayer) => void }) {
  const [q, setQ] = useState(() => qrLayer(qr));
  const timer = useRef(0);
  const set = (patch: Partial<QrLayer>, wait = 0) => {
    const next = { ...q, ...patch };
    setQ(next);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => onSet(next), wait);
  };
  return (
    <div className="air-autos air-qr">
      <label className="switch">
        <span className="switch-text"><b>QR code on the stream</b><small>Your link, to scan. Stays up until you turn it off</small></span>
        <input type="checkbox" checked={q.on} onChange={(e) => set({ on: e.target.checked })} />
      </label>
      {q.on && <>
        <label className="air-slide"><span>Size<b>{Math.round((q.size / 128) * 100)}% of the width</b></span>
          <input type="range" min={QR_SIZE.min} max={QR_SIZE.max} step={1} value={q.size} onChange={(e) => set({ size: Number(e.target.value) }, 250)} />
        </label>
        <label className="air-slide"><span>Opacity<b>{Math.round(q.opacity * 100)}%</b></span>
          <input type="range" min={QR_OPACITY.min} max={QR_OPACITY.max} step={0.05} value={q.opacity} onChange={(e) => set({ opacity: Number(e.target.value) }, 250)} />
        </label>
        <div className="air-pos" role="radiogroup" aria-label="Where the QR code sits">
          {(['tl', 'tc', 'tr', 'ml', null, 'mr', 'bl', 'bc', 'br'] as const).map((p, i) => p
            ? <button key={p} type="button" role="radio" aria-checked={q.pos === p} aria-label={POS_LABEL[p]} className={q.pos === p ? 'on' : undefined} onClick={() => set({ pos: p })} />
            : <span key={i} />)}
          <small>{POS_LABEL[q.pos]}</small>
        </div>
      </>}
    </div>
  );
}
