const CACHE = 'haku-v2'
const OFFLINE_URL = '/offline'

const PRECACHE_URLS = [
  OFFLINE_URL,
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  '/apple-touch-icon.png',
  '/favicon-32.png',
]

const STATIC_ASSETS = /^\/_next\/static\//
const REVALIDATE_ASSETS = /^\/(?:icon|apple-touch-icon|favicon|manifest\.json)/

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(PRECACHE_URLS))
  )
  self.skipWaiting()
})

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  )
  self.clients.claim()
})

self.addEventListener('fetch', event => {
  const { request } = event
  const url = new URL(request.url)

  // Pass through: non-GET, cross-origin, RSC/data, dev
  if (request.method !== 'GET') return
  if (url.origin !== self.location.origin) return
  if (url.pathname.startsWith('/_next/') && !STATIC_ASSETS.test(url.pathname)) return
  if (url.searchParams.has('_rsc')) return
  if (self.location.hostname === 'localhost') return

  const { pathname } = url

  // Cache-first: /_next/static/* (content-hashed, never stale)
  if (STATIC_ASSETS.test(pathname)) {
    event.respondWith(
      caches.match(request).then(cached => {
        if (cached) return cached
        return fetch(request).then(response => {
          if (response.ok) {
            caches.open(CACHE).then(cache => cache.put(request, response.clone()))
          }
          return response
        })
      })
    )
    return
  }

  // Stale-while-revalidate: icons, manifest, favicons
  if (REVALIDATE_ASSETS.test(pathname)) {
    event.respondWith(
      caches.open(CACHE).then(async cache => {
        const cached = await cache.match(request)
        const networkFetch = fetch(request).then(response => {
          if (response.ok) cache.put(request, response.clone())
          return response
        }).catch(() => cached)
        return cached ?? await networkFetch
      })
    )
    return
  }

  // Network-first for navigations → offline fallback
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match(OFFLINE_URL))
    )
    return
  }

  // Everything else: pass through (no SW involvement)
})
