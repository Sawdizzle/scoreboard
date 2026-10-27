import webpush from 'web-push';
import { adminClient } from './supabase/admin';

// Push notifications, sent by the server after a write (an announcement, a
// message, a change to the calendar). Who gets one is decided in the database
// (push_targets: the audience, each person's settings, never the sender);
// reading other people's devices takes the server's secret key, so nothing
// here runs in a browser. Without the VAPID keys or the secret key it does
// nothing: the app works the same, only quieter.

export type Audience = 'family' | 'staff' | 'followers';
export type PushKind = 'announcements' | 'chat' | 'schedule' | 'games';
export type PushMessage = { title: string; body: string; url: string; tag?: string };

let ready: boolean | null = null;
function configure() {
  if (ready !== null) return ready;
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim(), priv = process.env.VAPID_PRIVATE_KEY?.trim();
  ready = !!pub && !!priv;
  if (ready) webpush.setVapidDetails(process.env.VAPID_SUBJECT?.trim() || 'mailto:admin@example.com', pub!, priv!);
  return ready;
}

export const pushConfigured = () => configure() && !!process.env.SUPABASE_SECRET_KEY?.trim();

// A notification's text stays short: the lock screen shows two lines or so.
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

export async function notifyTeam(teamId: string, audience: Audience, kind: PushKind, msg: PushMessage, except?: string) {
  if (!configure()) return 0;
  const admin = adminClient();
  if (!admin) return 0;
  const { data, error } = await admin.rpc('push_targets', { p_team: teamId, p_audience: audience, p_kind: kind, p_except: except ?? null });
  if (error || !data) return 0;
  const payload = JSON.stringify({ title: clip(msg.title, 60), body: clip(msg.body, 180), url: msg.url, tag: msg.tag });
  const gone: string[] = [];
  let sent = 0;
  await Promise.all((data as { endpoint: string; p256dh: string; auth: string }[]).map(async (s) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 60 * 60 * 12, urgency: 'normal' });
      sent++;
    } catch (e) {
      // 404 and 410: the device turned notifications off or the app was removed.
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) gone.push(s.endpoint);
    }
  }));
  if (gone.length) await admin.from('push_subscriptions').delete().in('endpoint', gone);
  return sent;
}
