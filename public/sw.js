// Scoreboard's service worker: it shows push notifications and opens the app
// where a tapped one points. It caches nothing; the pad keeps its own offline
// queue (lib/play-queue), and every other screen wants the live data.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { body: event.data && event.data.text() }; }
  const title = data.title || 'Scoreboard';
  event.waitUntil(self.registration.showNotification(title, {
    body: data.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    // One notification per thread or item: a newer message replaces the last.
    tag: data.tag,
    renotify: !!data.tag,
    data: { url: data.url || '/t' },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || '/t', self.location.origin);
  if (url.origin !== self.location.origin) return;
  event.waitUntil((async () => {
    const open = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of open) {
      if (new URL(c.url).origin === url.origin && 'focus' in c) {
        await c.focus();
        if ('navigate' in c) await c.navigate(url.href);
        return;
      }
    }
    await self.clients.openWindow(url.href);
  })());
});
