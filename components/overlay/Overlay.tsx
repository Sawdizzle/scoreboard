'use client';

import { useEffect, useRef, useState } from 'react';
import { BreakAudio } from '@/components/overlay/BreakAudio';
import { Fx, type FxShot } from '@/components/overlay/Fx';
import { Keep } from '@/components/overlay/Keep';
import { ObsBridge } from '@/components/overlay/ObsBridge';
import { Scenes, type Weather } from '@/components/overlay/Scenes';
import { SponsorBug } from '@/components/overlay/SponsorBug';
import * as WX from '@/lib/fx/weather.js';
import { Spots } from '@/components/overlay/Spots';
import { Stage } from '@/components/overlay/Stage';
import * as A from '@/lib/fx/audio.js';
import * as M from '@/lib/fx/music';
import { feedView, layoutOf, momentText, safeToReload, type Feed } from '@/lib/onair';
import * as L from '@/lib/rules/logic.js';
import { browserClient } from '@/lib/supabase/browser';

const POLL_MS = 2500;
const AUTO_CARD_MS = 6000;
const MOMENT_MS = 4500;
const FX_MS = 5000;

// What a play earns on the stream: a sound, and for the big ones a stinger.
// The looks call out baseball's plays themselves (a home run, a strikeout), so
// those are sound only; a walk-off and the other sports' moments get the frame.
// v4's weather module, typed here: it takes the venue and the first pitch.
const fetchWeather = WX.fetchWeather as (venue: { lat: number; lon: number }, at?: string | null) => Promise<unknown>;

const SPORT_FX = new Set(['touchdown', 'fieldgoal', 'turnover', 'goal', 'three', 'ace', 'setwin', 'bigplay']);
function earned(prev: Feed | null, f: Feed, runs: number): { sound: string | null; fx: string | null } {
  const last = f.last;
  if (!last) return { sound: null, fx: null };
  // A correction on the Situation screen is no play: no run sound, no walk-off.
  if (last.type.startsWith('adj') || last.type === 'inning' || last.type === 'half') return { sound: null, fx: null };
  if ((f.game?.sport ?? 'baseball') !== 'baseball') {
    const k = last.kind ?? '';
    return SPORT_FX.has(k) ? { sound: k, fx: k } : { sound: runs ? 'run' : null, fx: null };
  }
  const before = prev && feedView(prev)?.g, after = feedView(f)?.g;
  if (before && after) {
    const reg = f.game?.settings?.regulation || f.season?.game_innings || 7;
    if (L.isWalkoff({ ...before, regulation_innings: reg }, { ...after, regulation_innings: reg })) return { sound: 'walkoff', fx: 'walkoff' };
  }
  const k = last.kind ?? '';
  if (last.type === 'homerun' || k === 'HR') return { sound: 'homerun', fx: null };
  if (last.type === 'strikeout' || k === 'K' || k === 'KL') return { sound: 'strikeout', fx: null };
  if (k === 'DP') return { sound: 'doubleplay', fx: null };
  if (k === 'SB') return { sound: 'stolenbase', fx: null };
  return { sound: runs ? 'run' : null, fx: runs ? 'run' : null };
}
export const airTopic = (token: string) => `overlay:${token}`;
const RUNNER_KINDS = new Set(Object.keys(L.RUNNER_LABEL));

// The page OBS loads. It has no account: it asks for the feed by the link's
// token, again every few seconds, and at once when the pad says something
// changed. A poll that finds nothing new gets a one-line answer back, so a
// source left running all afternoon costs next to nothing.
export function Overlay({ token, initial }: { token: string; initial: Feed | null }) {
  const [feed, setFeed] = useState<Feed | null>(initial);
  const [auto, setAuto] = useState(false);
  const [moment, setMoment] = useState<{ text: string; who: string; runs: number } | null>(null);
  const [shot, setShot] = useState<FxShot | null>(null);
  const [intro, setIntro] = useState<{ n: number; kind: 'intro' | 'tribute' } | null>(null);
  const [strike, setStrike] = useState(0);
  // The last moment the stream marked (sound or stinger), for OBS auto-clip.
  const [heard, setHeard] = useState<{ kind: string; n: number; play: boolean } | null>(null);
  const [weather, setWeather] = useState<Weather | null>(null);
  const [mute, setMute] = useState(false);
  const first = useRef(initial);
  // The venue's weather, for Starting Soon and the pause scene: from
  // Open-Meteo every ten minutes while one of them is up (two after a miss).
  const scene = feed?.broadcast?.scene?.kind;
  const geo = feed?.game?.venue_geo;
  const wxKey = scene === 'starting' || scene === 'paused' ? geo && geo.lat != null ? `${geo.lat},${geo.lon}|${feed?.game?.starts_at ?? ''}` : '' : '';
  useEffect(() => {
    if (!wxKey) return;
    let stop = false, t = 0;
    const [ll, at] = wxKey.split('|');
    const [lat, lon] = ll.split(',').map(Number);
    const pull = async () => {
      let next = 10 * 60 * 1000;
      try { const w = await fetchWeather({ lat, lon }, at || null); if (!stop && w) setWeather(w as Weather); } catch { next = 2 * 60 * 1000; }
      if (!stop) t = window.setTimeout(pull, next);
    };
    void pull();
    return () => { stop = true; window.clearTimeout(t); };
  }, [wxKey]);

  // A new release reloads the page, so a Browser Source left running all
  // season does not keep last month's code. Checked every five minutes; the
  // reload waits for a quiet moment (safeToReload: not mid-half) and never
  // happens while a full-frame scene is up.
  const sceneUp = useRef(false);
  useEffect(() => { sceneUp.current = !!scene; }, [scene]);
  const feedNow = useRef<Feed | null>(initial);
  // When the newest play arrived (from when the page opened, until one does).
  const playAt = useRef(0);
  useEffect(() => { playAt.current = Date.now(); }, []);
  useEffect(() => {
    if (feed?.last?.seq !== feedNow.current?.last?.seq) playAt.current = Date.now();
    feedNow.current = feed;
  }, [feed]);
  useEffect(() => {
    let mine = '';
    let waiting = false;
    const settle = () => {
      if (waiting && !sceneUp.current && safeToReload(feedNow.current, playAt.current, Date.now())) window.location.reload();
    };
    const check = async () => {
      try {
        const r = await fetch('/version', { cache: 'no-store', signal: AbortSignal.timeout(8000) });
        // Only a real answer counts: an error page from a flaky link is not a new release.
        const v = r.ok ? (await r.text()).trim() : '';
        if (!/^([0-9a-f]{7,40}|dpl_\w+|dev)$/i.test(v)) return;
        if (!mine) mine = v; else if (v && v !== mine) { waiting = true; settle(); }
      } catch { /* offline: next time */ }
    };
    void check();
    const t = window.setInterval(check, 5 * 60 * 1000);
    const s = window.setInterval(settle, 10 * 1000);
    return () => { window.clearInterval(t); window.clearInterval(s); };
  }, []);

  // A running clock redraws each second; the rest of the page waits for the feed.
  const [now, setNow] = useState(() => Date.now());
  const st = (feed?.game?.live as { state?: { clock?: { running?: boolean } } } | undefined)?.state;
  // Starting Soon and the pause scene count down too.
  const ticking = !!(feed?.game?.clock?.running || st?.clock?.running || feed?.broadcast?.scene?.kind === 'starting' || feed?.broadcast?.scene?.at);
  useEffect(() => {
    if (!ticking) return;
    const t = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(t);
  }, [ticking]);

  useEffect(() => {
    const sb = browserClient();
    let stopped = false, busy = false, again = false, timer = 0, momentTimer = 0, fxTimer = 0;
    // The last command acted on: a page that loads does not replay the one before it.
    let seenCmd: number | undefined = first.current ? Number(first.current.cmd?.n) || 0 : undefined;
    let prev: Feed | null = first.current;
    const fire = (kind: string, fx: string | null, meta: Record<string, unknown> = {}) => {
      if (kind) { try { A.play(kind); } catch { /* no audio here: the picture still plays */ } setHeard({ kind, n: Date.now(), play: meta.type !== 'moment' }); }
      if (!fx) return;
      setShot({ kind: fx, n: Date.now(), meta });
      window.clearTimeout(fxTimer);
      fxTimer = window.setTimeout(() => setShot(null), FX_MS);
    };
    // The newest play already called out, and who was batting before it: the play is his.
    let seenPlay = first.current?.last?.seq ?? (first.current ? 0 : undefined);
    // The score before the newest play: the difference is what that play brought home.
    const total = (f: Feed | null) => { const l = (f?.game?.live ?? {}) as { home_score?: number; away_score?: number }; return (Number(l.home_score) || 0) + (Number(l.away_score) || 0); };
    let runsBefore = total(first.current);
    let batterName = first.current ? feedView(first.current)?.air.batter?.name ?? '' : '';
    let have = first.current?.v ?? null;
    // undefined until the first feed: a card never pops just because the page loaded.
    let batter: string | null | undefined = first.current ? feedView(first.current)?.air.batter?.bid ?? null : undefined;
    // The game the page is following. Each game's plays count from 1 again, so
    // when the pad moves on to the next game (a doubleheader) the counts above
    // start over too, or nothing in game two would sound until it passed game one.
    let gameNow = first.current?.game?.id;

    const load = async () => {
      if (busy) { again = true; return; }
      busy = true;
      try {
        // A request that hangs on a dead link is given up, so the next poll can run.
        const { data } = await sb.rpc('overlay_feed', { p_token: token, p_have: have }).abortSignal(AbortSignal.timeout(6000));
        const f = data as Feed | { v: string } | null;
        if (stopped || !f || !('game' in f)) return;
        have = f.v;
        // The sound settings ride on every feed; the engine keeps the last ones.
        const snd = f.broadcast?.sound;
        A.setPack(snd?.pack || 'bigleague');
        A.setSettings({ muted: !!snd?.muted, master: snd?.master ?? 0.8 });
        // A command from the pad (a moment tapped in On Air): once per stamp.
        const n = Number(f.cmd?.n) || 0;
        if (seenCmd !== undefined && n > seenCmd && f.cmd?.type === 'moment' && f.cmd.kind) {
          const k = String(f.cmd.kind);
          fire(k === 'charge' ? 'charge' : k, k === 'charge' ? 'charge' : k, f.cmd);
        }
        if (seenCmd !== undefined && n > seenCmd && f.cmd?.type === 'intro') setIntro({ n, kind: f.cmd.kind === 'tribute' ? 'tribute' : 'intro' });
        // A new lightning strike, from the pad, on the pause scene: the flash and the thunder.
        if (seenCmd !== undefined && n > seenCmd && f.cmd?.type === 'strike') {
          setStrike(n);
          window.setTimeout(() => { try { A.thunder(true); } catch { /* no audio */ } }, 400);
        }
        if (seenCmd === undefined || n > seenCmd) seenCmd = n;
        const view = feedView(f);
        if (seenPlay !== undefined && f.game?.id !== gameNow) {
          seenPlay = f.last?.seq ?? 0;
          runsBefore = total(f);
          batterName = view?.air.batter?.name ?? '';
          batter = undefined;
          prev = null;
        }
        gameNow = f.game?.id;
        const now = view?.air.batter?.bid ?? null;
        const text = momentText(f.last);
        if (seenPlay !== undefined && f.last && f.last.seq > seenPlay && f.game?.status !== 'scheduled') {
          const runs = Math.max(0, total(f) - runsBefore);
          const e = earned(prev, f, runs);
          let meta: Record<string, unknown> = {};
          if (e.fx === 'setwin') {
            const hist = ((f.game?.live as { state?: { history?: { away: number; home: number }[] } }).state?.history) ?? [];
            meta = hist[hist.length - 1] ?? {};
          }
          if (e.sound) fire(e.sound, e.fx, meta);
        }
        if (seenPlay !== undefined && f.last && f.last.seq > seenPlay && text && f.game?.status === 'live') {
          // A play on a runner is about the runner, not the batter at the plate: no name under it.
          setMoment({ text, who: RUNNER_KINDS.has(f.last.kind ?? '') ? '' : batterName, runs: Math.max(0, Math.min(4, total(f) - runsBefore)) });
          window.clearTimeout(momentTimer);
          momentTimer = window.setTimeout(() => setMoment(null), MOMENT_MS);
        }
        seenPlay = f.last?.seq ?? seenPlay ?? 0;
        runsBefore = total(f);
        batterName = view?.air.batter?.name ?? '';
        if (batter !== undefined && now && now !== batter && f.auto_card && f.game?.status === 'live') {
          setAuto(true);
          window.clearTimeout(timer);
          timer = window.setTimeout(() => setAuto(false), AUTO_CARD_MS);
        }
        batter = now;
        prev = f;
        setFeed(f);
      } catch { /* a dropped connection: the next poll tries again */ } finally {
        busy = false;
        if (again && !stopped) { again = false; void load(); }
      }
    };

    void load();
    const poll = window.setInterval(load, POLL_MS);
    const channel = sb.channel(airTopic(token)).on('broadcast', { event: 'tick' }, () => void load()).subscribe();
    return () => {
      stopped = true;
      window.clearInterval(poll);
      window.clearTimeout(timer);
      window.clearTimeout(momentTimer);
      window.clearTimeout(fxTimer);
      void sb.removeChannel(channel);
    };
  }, [token]);

  // In OBS the page may play sound at once; in a browser it waits for one tap.
  useEffect(() => {
    if ((window as Window & { obsstudio?: unknown }).obsstudio) return;
    const t = window.setTimeout(() => setMute(A.isSuspended()), 1500);
    return () => window.clearTimeout(t);
  }, []);
  const top = feed ? layoutOf(feed.layout).bug.pos.startsWith('t') : false;
  return <>
    <Keep><Stage feed={feed} card={feed?.card ?? (auto ? 'batter' : null)} moment={moment} now={now} intro={intro} fx={shot ? { kind: shot.kind, n: shot.n } : null} /></Keep>
    <Keep><Scenes feed={feed} now={now} weather={weather} strike={strike} /></Keep>
    <Keep><Fx shot={shot} rally={!!feed?.broadcast?.rally} top={top} /></Keep>
    <ObsBridge token={token} feed={feed} fx={heard} />
    <BreakAudio feed={feed} />
    <Keep><SponsorBug sponsors={feed?.broadcast?.sponsors} hold={!!feed?.broadcast?.scene} /></Keep>
    <Keep><Spots spot={feed?.spot ?? null} /></Keep>
    {mute && !feed?.broadcast?.sound?.muted && <button type="button" className="fx-sound" onClick={() => { void A.resume(); M.resume(); setMute(false); }}>Tap for sound</button>}
  </>;
}
