'use client';

import { useEffect, useState, useTransition } from 'react';
import { deletePushSubscription, savePushSubscription, saveNotifySettings } from '@/app/hub-actions';
import { ActionForm, Submit } from '@/components/ActionForm';

type State = 'loading' | 'unsupported' | 'install' | 'blocked' | 'off' | 'on';
export type NotifyPrefs = { announcements: boolean; chat: boolean; schedule: boolean; games: boolean };

// The VAPID key arrives base64url; the browser wants its bytes.
function keyBytes(b64: string) {
  const s = atob((b64 + '='.repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

// Turning notifications on, on this device. An iPhone only allows them for an
// app on the Home Screen (iOS 16.4 and up), and only after a tap here, so the
// card says what to do first instead of a switch that cannot work.
export function NotifyCard({ slug, prefs, fan }: { slug: string; prefs: NotifyPrefs; fan?: boolean }) {
  const [state, setState] = useState<State>('loading');
  const [error, setError] = useState('');
  const [busy, start] = useTransition();
  const vapid = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? '';

  useEffect(() => {
    void (async () => {
      const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
      const standalone = matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
      if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
        setState(ios && !standalone ? 'install' : 'unsupported');
        return;
      }
      if (Notification.permission === 'denied') { setState('blocked'); return; }
      const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
      const sub = await reg.pushManager.getSubscription();
      setState(sub && Notification.permission === 'granted' ? 'on' : 'off');
    })().catch(() => setState('unsupported'));
  }, []);

  const turnOn = () => start(async () => {
    setError('');
    try {
      if (!vapid) { setError('Notifications are not set up on this Scoreboard yet (no VAPID key).'); return; }
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') { setState(perm === 'denied' ? 'blocked' : 'off'); return; }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(vapid) });
      const r = await savePushSubscription(sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } });
      if (r.error) { setError(r.error); return; }
      setState('on');
    } catch {
      setError('This device would not turn notifications on. Try again, or check its settings.');
    }
  });
  const turnOff = () => start(async () => {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) { await deletePushSubscription(sub.endpoint); await sub.unsubscribe(); }
    setState('off');
  });

  return (
    <div className="card pad">
      <div className="row-main">
        <span className="row-title">Notifications {state === 'on' && <span className="tag good">On</span>}</span>
        <span className="row-meta">
          {state === 'install' && 'On iPhone: tap Share, then Add to Home Screen. Open Scoreboard from the Home Screen and turn notifications on here.'}
          {state === 'unsupported' && 'This browser cannot show notifications. Try Chrome, Edge or Firefox, or Scoreboard on your Home Screen.'}
          {state === 'blocked' && 'Notifications are blocked for Scoreboard. Allow them in this browser’s (or the phone’s) settings, then come back.'}
          {state === 'off' && (fan ? 'Hear when the game starts and the final score.' : 'Hear about announcements, schedule changes and new messages the moment they happen.')}
          {state === 'on' && 'This device gets notifications for the kinds below.'}
          {state === 'loading' && 'Checking this device…'}
        </span>
      </div>
      {state === 'off' && <button type="button" className="btn btn-primary btn-block" disabled={busy} onClick={turnOn}>{busy ? 'Turning on…' : 'Turn on notifications'}</button>}
      {error && <p role="alert" className="note note-bad">{error}</p>}
      {state === 'on' && (
        <>
          <ActionForm action={saveNotifySettings.bind(null, slug)} className="form">
            {(fan ? [['games', 'Game starts and final scores']] : [
              ['announcements', 'Announcements from coaches and the league'], ['schedule', 'New and changed practices and events'],
              ['chat', 'New messages in the team chat'], ['games', 'Game starts and final scores'],
            ]).map(([k, label]) => (
              <label key={k} className="switch">
                <span className="switch-text"><b>{label}</b></span>
                <input type="checkbox" name={k} defaultChecked={prefs[k as keyof NotifyPrefs]} />
              </label>
            ))}
            {fan && ['announcements', 'schedule', 'chat'].map((k) => <input key={k} type="hidden" name={k} value="on" />)}
            <Submit className="btn btn-quiet btn-sm" busy="Saving…">Save</Submit>
          </ActionForm>
          <button type="button" className="link" disabled={busy} onClick={turnOff}>Turn off on this device</button>
        </>
      )}
    </div>
  );
}
