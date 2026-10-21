'use client';

import { useEffect, useState } from 'react';
import { CopyLink } from '@/components/CopyLink';
import type { MicReport } from '@/components/overlay/BreakAudio';
import type { Broadcast, BroadcastPatch } from '@/lib/broadcast';
import * as M from '@/lib/fx/music';
import { BREAKS, CREDIT, DEFAULT_TRACK, MUSIC_VOLUME, TRACKS, trackOf } from '@/lib/music';
import { browserClient } from '@/lib/supabase/browser';

const pct = (v: number) => `${Math.round(v * 100)}%`;
const MIC_SAID: Record<MicReport['ws'], string> = {
  ok: 'Connected to OBS', auth: 'OBS refused the password: copy the link again with the right one',
  refused: 'No answer from obs-websocket: check Tools → WebSocket Server Settings in OBS', nopass: 'The Browser Source link has no password yet: use the link below',
};

// Breaks in play: the music bed under Starting Soon, the mid-inning board,
// Game paused and Final, and muting OBS's mic while one is up. The music
// settings save with the broadcast; the obs-websocket password is never
// saved anywhere: it only builds the link pasted into OBS.
export function BreakSettings({ teamId, streamUrl, bc, setB }: { teamId: string; streamUrl: string; bc: Broadcast; setB: (p: BroadcastPatch) => void }) {
  const music = bc.music ?? {};
  const setMusic = (patch: NonNullable<Broadcast['music']>) => setB({ music: { ...music, ...patch } });
  const tracks = music.tracks ?? {};
  const mic = bc.obs?.mic ?? {};
  const setMic = (patch: NonNullable<NonNullable<Broadcast['obs']>['mic']>) => setB({ obs: { ...(bc.obs ?? {}), mic: { ...mic, ...patch } } });
  const [pw, setPw] = useState('');
  const [listen, setListen] = useState<string | null>(null);
  const [rep, setRep] = useState<MicReport | null>(null);

  // What the Browser Source says about the mic, while the switch is on.
  useEffect(() => {
    if (!mic.on) return;
    const read = async () => {
      const { data } = await browserClient().from('channel_obs').select('obs, at').eq('team_id', teamId).maybeSingle();
      const row = data as { obs: { mic?: MicReport | null }; at: string } | null;
      setRep(row && Date.now() - Date.parse(row.at) < 10 * 60 * 1000 ? row.obs.mic ?? null : null);
    };
    void read();
    const t = window.setInterval(read, 5000);
    return () => window.clearInterval(t);
  }, [teamId, mic.on]);

  // Listening here plays in this browser only, at the stream's volume.
  useEffect(() => { M.setVolume(music.volume ?? MUSIC_VOLUME); }, [music.volume]);
  useEffect(() => () => M.stop(), []);
  const hear = (id: string) => {
    if (listen === id) { M.stop(); setListen(null); return; }
    M.resume();
    void M.play(trackOf(id)!.src);
    setListen(id);
  };

  const chosen = [...new Set(BREAKS.map(([k]) => tracks[k] ?? DEFAULT_TRACK[k]))];
  const picked = mic.inputs ?? [];
  const pickInput = (name: string) => setMic({ inputs: picked.includes(name) ? picked.filter((n) => n !== name) : [...picked, name] });

  return (
    <section className="card pad">
      <h2>Breaks</h2>
      <p className="hint">While Starting soon, the mid-inning board, Game paused or Final is up, the stream can play quiet lo-fi music and mute the camera mic. Both come back when play does.</p>

      <label className="switch">
        <span className="switch-text"><b>Music during breaks</b><small>Fades in and out, loops with no gap</small></span>
        <input type="checkbox" checked={!!music.on} onChange={(e) => setMusic({ on: e.target.checked })} />
      </label>
      {music.on && (
        <>
          <div className="air-autos air-qr">
            <label className="air-slide" style={{ borderTop: 0 }}><span>Music volume<b>{pct(music.volume ?? MUSIC_VOLUME)}</b></span>
              <input type="range" min={0.1} max={1} step={0.05} value={music.volume ?? MUSIC_VOLUME} onChange={(e) => setMusic({ volume: Number(e.target.value) })} />
            </label>
          </div>
          {BREAKS.map(([k, label]) => (
            <label key={k} className="field"><span>{label}</span>
              <select className="select" value={tracks[k] ?? DEFAULT_TRACK[k]} onChange={(e) => setMusic({ tracks: { ...tracks, [k]: e.target.value } })}>
                {TRACKS.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
              </select>
            </label>
          ))}
          <div className="chips" aria-label="Listen to a track here">
            {TRACKS.map((t) => (
              <button key={t.id} type="button" className={`chip${listen === t.id ? ' on' : ''}`} aria-pressed={listen === t.id} onClick={() => hear(t.id)}>
                {listen === t.id ? 'Stop' : 'Listen'}: {t.title.replace('Relaxing Lofi - ', '')}
              </button>
            ))}
          </div>
          <details className="fold">
            <summary>Music credit for your stream description</summary>
            <div className="fold-body">
              <p className="hint">The tracks are by Sascha Ende under CC BY 4.0: free to stream, with this credit in the video description.</p>
              <textarea className="input" readOnly rows={3} value={CREDIT(chosen)} onFocus={(e) => e.currentTarget.select()} />
            </div>
          </details>
        </>
      )}

      <label className="switch">
        <span className="switch-text"><b>Mute the mic during breaks</b><small>{mic.on ? rep ? MIC_SAID[rep.ws] : 'Waiting for the stream in OBS' : 'Uses OBS’s WebSocket server'}</small></span>
        <input type="checkbox" checked={!!mic.on} onChange={(e) => setMic({ on: e.target.checked })} />
      </label>
      {mic.on && (
        <>
          <p className="hint">In OBS, open Tools → WebSocket Server Settings, tick Enable WebSocket server, then Show Connect Info and copy the Server Password. Paste it here, and put the link below in the Browser Source instead of the plain one. The password stays in that link, on this computer and in OBS: it is not saved with the team. Don’t share this version of the link.</p>
          <label className="field"><span>OBS WebSocket password</span>
            <input className="input" type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="off" placeholder="Leave empty if authentication is off" />
          </label>
          <CopyLink url={`${streamUrl}#obs=${encodeURIComponent(pw)}`} label="Browser Source link with the OBS password" />
          {rep?.ws === 'ok' && rep.inputs.length > 0 && (
            <>
              <span className="legend">Mics to mute{picked.length ? '' : ' · none picked mutes them all'}</span>
              <div className="chips" aria-label="Mics to mute">
                {rep.inputs.map((name) => (
                  <button key={name} type="button" className={`chip${picked.includes(name) ? ' on' : ''}`} aria-pressed={picked.includes(name)} onClick={() => pickInput(name)}>{name}</button>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}
