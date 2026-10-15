'use client';

import { ObsPanel } from '@/components/pad/ObsPanel';
import { Sheet } from '@/components/pad/PadSheets';
import type { Brand } from '@/components/TeamBrand';
import { inkOn } from '@/lib/format';
import Link from 'next/link';
import { useState } from 'react';
import type { Broadcast, BroadcastPatch, Scene } from '@/lib/broadcast';
import { qrLayer, type AirView, type CardKind, type QrLayer } from '@/lib/onair';

export type Channel = { token: string; game_id: string | null; show_line: boolean; auto_card: boolean; auto_mid: boolean; card: CardKind | null; sponsor_name: string | null;
  bug_url: string | null; qr?: Partial<QrLayer> | null; spot?: { n: number; cut: 'pitch' | 'inning' } | null; broadcast?: Broadcast | null; look?: string | null };

// The moments a tap plays on the stream, once each: v4's buttons.
export const MOMENT_KEYS: Record<string, [string, string][]> = {
  baseball: [['walkoff', 'Walk-off!'], ['homerun', 'Home run'], ['charge', 'Charge!'], ['doubleplay', 'Double play']],
  football: [['touchdown', 'Touchdown'], ['bigplay', 'Big play'], ['turnover', 'Turnover'], ['charge', 'Charge!']],
  soccer: [['goal', 'Goal!'], ['bigplay', 'Big play'], ['charge', 'Charge!']],
  basketball: [['three', 'Three!'], ['bigplay', 'Big play'], ['charge', 'Charge!']],
  volleyball: [['ace', 'Ace!'], ['bigplay', 'Big play'], ['charge', 'Charge!']],
};

// The full-frame scenes, the ticker and the intros: v4's Broadcast cards.
const REASONS: [NonNullable<Scene['reason']>, string][] = [['lightning', 'Lightning'], ['rain', 'Rain'], ['weather', 'Weather'], ['suspended', 'Suspended'], ['called', 'Called']];
export function ScenesControl({ broadcast, look, onBroadcast, onSend }: {
  broadcast: Broadcast | null | undefined; look?: string | null;
  onBroadcast: (patch: BroadcastPatch) => void; onSend: (cmd: Record<string, unknown> & { type: string }) => void;
}) {
  const scene = broadcast?.scene ?? null;
  const [title, setTitle] = useState(scene?.kind === 'starting' ? scene.title ?? '' : '');
  const [reason, setReason] = useState<NonNullable<Scene['reason']>>(scene?.reason ?? 'lightning');
  const [mins, setMins] = useState('30');
  const [tick, setTick] = useState(broadcast?.ticker?.text ?? '');
  const [alert, setAlert] = useState(broadcast?.ticker?.tone === 'alert');
  const at = (m: string) => { const n = Math.round(Number(m)); return n > 0 ? new Date(Date.now() + n * 60000).toISOString() : null; };
  const up = (k: Scene['kind']) => scene?.kind === k;
  const tickerOn = !!broadcast?.ticker?.on;
  return (
    <>
      <p className="eyebrow">Scenes · full screen until you clear them</p>
      <div className="pgrid two">
        <button type="button" className={`pchoice${up('starting') ? ' on' : ''}`} aria-pressed={up('starting')}
          onClick={() => onBroadcast({ scene: up('starting') ? null : { kind: 'starting', title: title.trim() || undefined } })}>
          <b>Starting soon</b><small>Countdown to first pitch, the weather</small>
        </button>
        <button type="button" className={`pchoice${up('final') ? ' on' : ''}`} aria-pressed={up('final')} onClick={() => onBroadcast({ scene: up('final') ? null : { kind: 'final' } })}>
          <b>Final</b><small>Who won and how, the line score</small>
        </button>
      </div>
      <label className="field"><span>Starting soon line</span>
        <input className="input" value={title} maxLength={60} placeholder="Game starting soon" onChange={(e) => setTitle(e.target.value)}
          onBlur={() => up('starting') && onBroadcast({ scene: { kind: 'starting', title: title.trim() || undefined } })} />
      </label>
      <div className="chips" role="radiogroup" aria-label="Why play is paused">
        {REASONS.map(([k, label]) => <button key={k} type="button" role="radio" aria-checked={reason === k} className={`chip${reason === k ? ' on' : ''}`} onClick={() => setReason(k)}>{label}</button>)}
      </div>
      <div className="field-row" style={{ gridTemplateColumns: '1fr auto' }}>
        <label className="field"><span>Restart in, minutes</span>
          <input className="input" inputMode="numeric" value={mins} onChange={(e) => setMins(e.target.value)} disabled={reason === 'suspended' || reason === 'called'} />
        </label>
        <button type="button" className={`btn ${up('paused') ? 'btn-danger' : 'btn-quiet'}`} style={{ alignSelf: 'end' }}
          onClick={() => onBroadcast({ scene: up('paused') ? null : { kind: 'paused', reason, at: at(mins), since: new Date().toISOString() } })}>{up('paused') ? 'End the pause' : 'Pause the game'}</button>
      </div>
      {up('paused') && scene?.reason === 'lightning' && (
        <button type="button" className="pchoice" onClick={() => { onBroadcast({ scene: { ...scene, at: at('30'), since: new Date().toISOString() } }); onSend({ type: 'strike' }); }}>
          <b>New strike</b><small>Thunder on the stream; the 30 minutes start again</small>
        </button>
      )}

      <p className="eyebrow">Ticker · along the bottom</p>
      <label className="field"><span>Message</span>
        <input className="input" value={tick} maxLength={200} placeholder="Next game Saturday 10 am at Railyard Park" onChange={(e) => setTick(e.target.value)}
          onBlur={() => tickerOn && onBroadcast({ ticker: { on: true, text: tick.trim(), tone: alert ? 'alert' : 'notice' } })} />
      </label>
      <div className="pgrid two">
        <label className="switch"><span className="switch-text"><b>Alert</b><small>Red, for weather and safety</small></span>
          <input type="checkbox" checked={alert} onChange={(e) => { setAlert(e.target.checked); if (tickerOn) onBroadcast({ ticker: { on: true, text: tick.trim(), tone: e.target.checked ? 'alert' : 'notice' } }); }} />
        </label>
        <button type="button" className={`btn ${tickerOn ? 'btn-danger' : 'btn-quiet'}`} disabled={!tickerOn && !tick.trim()}
          onClick={() => onBroadcast({ ticker: tickerOn ? null : { on: true, text: tick.trim(), tone: alert ? 'alert' : 'notice' } })}>{tickerOn ? 'Take it down' : 'Show the ticker'}</button>
      </div>

      {(look === 'bluesteel' || look === 'midnight' || look === 'forever20') && (
        <div className="pgrid two">
          <button type="button" className="pchoice" onClick={() => onSend({ type: 'intro', kind: 'intro' })}><b>Play the intro</b><small>Full screen, the look&rsquo;s own</small></button>
          {look === 'forever20' && <button type="button" className="pchoice" onClick={() => onSend({ type: 'intro', kind: 'tribute' })}><b>Tribute</b><small>Forever 20</small></button>}
        </div>
      )}
    </>
  );
}

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
// On a phone On Air is a sheet over the pad; on a tablet or bigger it is the
// console that stays open beside (or under) the keys. The score-only pad
// fills the same frame with its own On Air.
export function AirFrame({ inline, onClose, children }: { inline?: boolean; onClose: () => void; children: React.ReactNode }) {
  if (!inline) return <Sheet title="On Air" onClose={onClose} close="Done">{children}</Sheet>;
  return <section className="pconsole" aria-label="On Air"><h2 className="pconsole-title">On Air</h2>{children}</section>;
}

export function OnAir({ channel, teamId, gameId, setupHref, view, brand, when, live, final, score, onSet, onCmd, onSend, onBroadcast, onClose, inline }: {
  channel: Channel; teamId: string; gameId: string; setupHref: string; view: AirView; brand: Brand; when: string; live: boolean; final: boolean; score: string;
  onSet: (patch: Partial<Channel>) => void; onCmd: (kind: string) => void; onSend: (cmd: Record<string, unknown> & { type: string }) => void;
  onBroadcast: (patch: BroadcastPatch) => void; onClose: () => void; inline?: boolean;
}) {
  const here = channel.game_id === gameId;
  const { batter, pitcher, dueUp } = view;
  const up = (k: CardKind) => here && channel.card === k;
  const flip = (k: CardKind) => onSet({ card: up(k) ? null : k, ...(here ? {} : { game_id: gameId }) });
  const k = pitcher?.today.find((c) => c.k === 'K')?.v;
  return (
    <AirFrame inline={inline} onClose={onClose}>
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
      <ScenesControl broadcast={channel.broadcast} look={channel.look} onBroadcast={onBroadcast} onSend={onSend} />
      <ObsPanel teamId={teamId} broadcast={channel.broadcast} onBroadcast={onBroadcast} onSend={onSend} />

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
    </AirFrame>
  );
}

