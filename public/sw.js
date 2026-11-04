// Turn alerts only: shows pushed "your turn" messages and opens the game on tap.
// No fetch handler, so nothing is cached and every page load stays fresh.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));

self.addEventListener('push', event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch {}
  event.waitUntil(self.registration.showNotification(data.title || 'Turn-Based Games', {
    body: data.body || 'Your turn.',
    tag: data.tag || 'turn',
    icon: 'icon-192.png',
    data: { url: new URL(data.url || './', self.registration.scope).href },
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || self.registration.scope;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      if (!client.url.startsWith(self.registration.scope)) continue;
      await client.focus();
      client.postMessage({ type: 'open-game', url });
      return;
    }
    await self.clients.openWindow(url);
  })());
});
