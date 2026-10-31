/* Steel service worker: Web Push and notification clicks only.
 * No fetch handler and no caching on purpose: the app is always online-first
 * and an offline shell would serve stale authenticated pages. */

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    data = {}
  }
  const title = typeof data.title === 'string' ? data.title : 'Steel'
  const body = typeof data.body === 'string' ? data.body : 'Toque para abrir no Steel.'
  const url = typeof data.url === 'string' && data.url.startsWith('/') ? data.url : '/'
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      tag: typeof data.tag === 'string' ? data.tag : undefined,
      icon: '/pwa-icon/192',
      badge: '/icon',
      data: { url },
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = new URL(
    (event.notification.data && event.notification.data.url) || '/',
    self.location.origin,
  ).href
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      for (const client of windows) {
        if ('focus' in client) {
          client.navigate(target)
          return client.focus()
        }
      }
      return self.clients.openWindow(target)
    }),
  )
})
