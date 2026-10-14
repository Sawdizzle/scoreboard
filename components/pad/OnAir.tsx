'use client';

import { Sheet } from '@/components/pad/PadSheets';
import type { Brand } from '@/components/TeamBrand';
import { inkOn } from '@/lib/format';
import Link from 'next/link';
import type { Broadcast, BroadcastPatch } from '@/lib/broadcast';
import { qrLayer, type AirView, type CardKind, type QrLayer } from '@/lib/onair';

export type Channel = { token: string; game_id: string | null; show_line: boolean; auto_card: boolean; auto_mid: boolean; card: CardKind | null; sponsor_name: string | null;
  bug_url: string | null; qr?: Partial<QrLayer> | null; spot?: { n: number; cut: 'pitch' | 'inning' } | null; broadcast?: Broadcast | null };
export const CHANNEL_COLS = 'token, game_id, show_line, auto_card, auto_mid, card, sponsor_name, bug_url, qr, broadcast';

// The moments a tap plays on the stream, once each: v4's buttons.
export const MOMENT_KEYS: Record<string, [string, string][]> = {
  baseball: [['walkoff', 'Walk-off!'], ['homerun', 'Home run'], ['charge', 'Charge!'], ['doubleplay', 'Double play']],
  football: [['touchdown', 'Touchdown'], ['bigplay', 'Big play'], ['turnover', 'Turnover'], ['charge', 'Charge!']],
  soccer: [['goal', 'Goal!'], ['bigplay', 'Big play'], ['charge', 'Charge!']],
  basketball: [['three', 'Three!'], ['bigplay', 'Big play'], ['charge', 'Charge!']],
  volleyball: [['ace', 'Ace!'], ['bigplay', 'Big play'], ['charge', 'Charge!']],
};

// Moments and the rally glow: what any pad can fire at the stream.
export function Moments({ sport, rally, onCmd, onBroadcast }: {
  sport: string; rally: boolean; onCmd: (kind: string) => void; onBroadcast: (patch: BroadcastPatch) => void;
}) {
  return (
    <>
      <p className="eyebrow">Moments · one tap, once on the stream</p>
      <div className="pgrid two">
        {(MOMENT_KEYS[sport] ?? MOMENT_KEYS.baseball).map(([k, label]) => (
          <button key={k} type="button" className="pchoice" onClick={() => onCmd(k)}><b>{label}</b></button>
        ))}
      </div>
      <label className="switch">
        <span className="switch-text"><b>Rally</b><small>A glow around the picture until you turn it off</small></span>
        <input type="checkbox" checked={rally} onChange={(e) => onBroadcast({ rally: e.target.checked || null })} />
      </label>
    </>
  );
}

// What the stream is showing right now, run from the field. How it looks (the
// scorebug, sizes, positions) is the Stream screen, not here. One card on air at a time:
// tap one to raise it, tap it again to clear it. The two switches are what
// the scorebug does by itself.
export function OnAir({ channel, gameId, setupHref, view, brand, when, live, final, score, onSet, onCmd, onBroadcast, onClose }: {
  channel: Channel; gameId: string; setupHref: string; view: AirView; brand: Brand; when: string; live: boolean; final: boolean; score: string;
  onSet: (patch: Partial<Channel>) => void; onCmd: (kind: string) => void; onBroadcast: (patch: BroadcastPatch) => void; onClose: () => void;
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

      <Moments sport="baseball" rally={!!channel.broadcast?.rally} onCmd={onCmd} onBroadcast={onBroadcast} />

      <p className="eyebrow">Spots · play once per tap</p>
      <div className="pgrid two">
        <button type="button" className="pchoice" onClick={() => onSet({ spot: { n: Date.now(), cut: 'pitch' }, ...(here ? {} : { game_id: gameId }) })}><b>Quick spot</b><small>A banner, about 7 seconds</small></button>
        <button type="button" className="pchoice" onClick={() => onSet({ spot: { n: Date.now(), cut: 'inning' }, ...(here ? {} : { game_id: gameId }) })}><b>Full spot</b><small>Full screen, about 13 seconds</small></button>
      </div>

      <div className="air-autos">
        {channel.bug_url && (
          <label className="switch">
            <span className="switch-text"><b>QR code on the stream</b><small>Your link, to scan. Stays up until you turn it off</small></span>
            <input type="checkbox" checked={qrLayer(channel.qr).on} onChange={(e) => onSet({ qr: { ...qrLayer(channel.qr), on: e.target.checked } })} />
          </label>
        )}
        <label className="switch">
          <span className="switch-text"><b>Season line on the scorebug</b><small>AVG and tonight, beside the batter</small></span>
          <input type="checkbox" checked={channel.show_line} onChange={(e) => onSet({ show_line: e.target.checked })} />
        </label>
        <label className="switch">
          <span className="switch-text"><b>Pop the card for each new batter</b><small>Six seconds, then it clears itself</small></span>
          <input type="checkbox" checked={channel.auto_card} onChange={(e) => onSet({ auto_card: e.target.checked })} />
        </label>
        <label className="switch">
          <span className="switch-text"><b>Mid-inning between halves</b><small>Full screen at the third out, until the next pitch</small></span>
          <input type="checkbox" checked={channel.auto_mid} onChange={(e) => onSet({ auto_mid: e.target.checked })} />
        </label>
      </div>
      <Link href={setupHref} className="link" style={{ alignSelf: 'center' }}>Look, sizes and positions: Stream setup ›</Link>
    </Sheet>
  );
}

