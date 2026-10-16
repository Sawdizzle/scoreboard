'use client';

import { useCallback, useEffect, useState } from 'react';
import type { BroadcastPatch } from '@/lib/broadcast';
import type { Broadcast } from '@/lib/broadcast';
import { browserClient } from '@/lib/supabase/browser';
import { DEFAULT_CLIP_KINDS, kindsFor } from '@/lib/clips';

// OBS from the pad (v4's OBS tab): what the stream's Browser Source reports
// (channel_obs), and the buttons that send it commands. Every tier is a
// working setup: with no access the scorebug, cards, scenes and sound all run;
// a locked button says which Page permissions setting unlocks it.
type Report = { level?: number; streaming?: boolean | null; recording?: boolean | null; buffer?: boolean | null;
  scenes?: string[]; current?: string; replay?: { n: number; ok: boolean; code: string } | null };
const TIER: Record<number, string> = { 0: 'No access', 1: 'Read', 2: 'Read user info', 3: 'Basic', 4: 'Advanced', 5: 'Full' };
const REPLAY_SAID: Record<string, string> = { saved: 'Clip saved', armed: 'Clip coming', asked: 'Saving…', noperm: 'Needs Basic access', nobuffer: 'Replay buffer is off', failed: 'OBS did not save it' };

export function ObsPanel({ teamId, sport = 'baseball', broadcast, onBroadcast, onSend }: {
  teamId: string; sport?: string; broadcast: Broadcast | null | undefined; onBroadcast: (p: BroadcastPatch) => void; onSend: (c: Record<string, unknown> & { type: string }) => void;
}) {
  const [rep, setRep] = useState<Report | null>(null);
  // A report older than ten minutes is a source that is not open now.
  const [fresh, setFresh] = useState(false);
  const [arm, setArm] = useState<string | null>(null);
  const read = useCallback(async () => {
    const { data } = await browserClient().from('channel_obs').select('obs, at').eq('team_id', teamId).maybeSingle();
    const row = data as { obs: Report; at: string } | null;
    setRep(row?.obs ?? null);
    setFresh(!!row?.at && Date.now() - Date.parse(row.at) < 10 * 60 * 1000);
  }, [teamId]);
  useEffect(() => {
    const t = window.setInterval(read, 3000);
    const first = window.setTimeout(read, 0);
    return () => { window.clearInterval(t); window.clearTimeout(first); };
  }, [read]);
  useEffect(() => {
    if (!arm) return;
    const t = window.setTimeout(() => setArm(null), 4000);
    return () => window.clearTimeout(t);
  }, [arm]);

  const lvl = rep?.level ?? -1;
  const need = (n: number) => (!fresh ? 'Open the stream in OBS' : lvl < n ? `Needs “${TIER[n]}” Page permissions` : '');
  const sendObs = (action: string) => { onSend({ type: 'obs', action }); window.setTimeout(read, 1200); };
  const toggle = (key: 'streaming' | 'recording' | 'buffer', start: string, stop: string, label: [string, string], level: number, danger: boolean) => {
    const on = !!rep?.[key];
    const armed = arm === key;
    return (
      <button type="button" className={`pchoice${on ? ' on' : ''}`} disabled={!!need(level)} title={need(level) || undefined}
        onClick={() => { if (on && danger && !armed) { setArm(key); return; } setArm(null); sendObs(on ? stop : start); }}>
        <b>{on ? (armed ? 'Tap again' : label[1]) : label[0]}</b><small>{need(level) || (on ? 'On now' : 'Off')}</small>
      </button>
    );
  };
  const auto = !!broadcast?.obs?.auto_clip;
  const picked = broadcast?.obs?.clip_kinds ?? DEFAULT_CLIP_KINDS;
  const offer = kindsFor(sport);
  const pick = (key: string) => onBroadcast({ obs: { ...(broadcast?.obs ?? {}),
    clip_kinds: picked.includes(key) ? picked.filter((k) => k !== key) : [...picked, key] } });

  return (
    <>
      <p className="eyebrow">OBS · {fresh ? TIER[lvl] ?? 'No access' : 'not connected'}</p>
      {!fresh && <p className="sub">Add the stream link to OBS as a Browser Source and open it; its Page permissions decide what the pad can do here. No access runs everything else.</p>}
      <div className="pgrid two">
        <button type="button" className="pchoice" disabled={!!need(3)} onClick={() => { onSend({ type: 'replay', delay_ms: 0 }); window.setTimeout(read, 1500); }}>
          <b>Save replay</b><small>{need(3) || (rep?.replay ? REPLAY_SAID[rep.replay.code] ?? rep.replay.code : 'The last moments, as a clip')}</small>
        </button>
        <label className="switch"><span className="switch-text"><b>Auto-clip big moments</b><small>{auto ? `${offer.filter((k) => picked.includes(k.key)).length} kinds · listed on the game page` : 'Saves the buffer after each one'}</small></span>
          <input type="checkbox" checked={auto} onChange={(e) => onBroadcast({ obs: { ...(broadcast?.obs ?? {}), auto_clip: e.target.checked } })} />
        </label>
      </div>
      {auto && (
        <div className="chips" aria-label="Moments that auto-clip">
          {offer.map((k) => (
            <button key={k.key} type="button" className={`chip${picked.includes(k.key) ? ' on' : ''}`} aria-pressed={picked.includes(k.key)} onClick={() => pick(k.key)}>{k.label}</button>
          ))}
        </div>
      )}
      <div className="pgrid three">
        {toggle('streaming', 'stream_start', 'stream_stop', ['Go live', 'End stream'], 5, true)}
        {toggle('recording', 'record_start', 'record_stop', ['Record', 'Stop recording'], 5, true)}
        {toggle('buffer', 'buffer_start', 'buffer_stop', ['Buffer on', 'Buffer off'], 4, false)}
      </div>
      {fresh && (rep?.scenes?.length ?? 0) > 0 && (
        <>
          <p className="eyebrow">Cameras · OBS scenes</p>
          <div className="chips">
            {rep!.scenes!.map((name) => (
              <button key={name} type="button" className={`chip${rep?.current === name ? ' on' : ''}`} disabled={!!need(4)} title={need(4) || undefined}
                onClick={() => { onSend({ type: 'scene', name }); window.setTimeout(read, 1000); }}>{name}</button>
            ))}
          </div>
        </>
      )}
    </>
  );
}
