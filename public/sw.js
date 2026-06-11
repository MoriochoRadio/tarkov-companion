// 서비스워커 — 앱 셸과 마지막으로 본 브리핑을 오프라인에서도 열리게 함
//
// 캐싱 전략 (요청 종류별):
//   페이지 이동(HTML)       → 네트워크 우선, 실패 시 캐시된 셸 (배포 즉시 반영 + 오프라인 폴백)
//   assets/* (해시 번들)    → 캐시 우선 (파일명에 해시가 있어 내용이 절대 안 바뀜)
//   data/* (브리핑 JSON 등) → 네트워크 우선, 실패 시 캐시 (오프라인에서 마지막 브리핑)
//   폰트 CDN                → 캐시 우선 (버전 고정 URL이라 안전)
//   api.tarkov.dev          → POST라 fetch 핸들러를 안 거침 — 시세는 항상 실시간
//
// VERSION을 올리면 이전 캐시가 전부 삭제됨 (전략이 바뀔 때만 올리면 됨)
const VERSION = 'tc-v1'
const SHELL = `${VERSION}-shell`
const ASSETS = `${VERSION}-assets`
const DATA = `${VERSION}-data`
const FONTS = `${VERSION}-fonts`

// GitHub Pages 하위 경로(/tarkov-companion/)에서도 동작하도록 scope 기준으로 계산
const BASE = new URL(self.registration.scope).pathname

const FONT_HOSTS = ['cdn.jsdelivr.net', 'fonts.googleapis.com', 'fonts.gstatic.com']

// 셸 HTML과 그 안에서 참조하는 해시 번들(JS/CSS)까지 미리 캐시.
// 페이지 첫 로드는 SW 활성화 전에 끝나므로, 여기서 받아두지 않으면
// 첫 방문 직후 오프라인 전환 시 번들이 없어 빈 화면이 됨
async function precacheShell() {
  const res = await fetch(BASE)
  const shell = await caches.open(SHELL)
  await shell.put(BASE, res.clone())
  const html = await res.text()
  const bundles = [...html.matchAll(/(?:src|href)="([^"]*\/assets\/[^"]+)"/g)].map(
    (m) => m[1],
  )
  const assets = await caches.open(ASSETS)
  await assets.addAll(bundles)
}

self.addEventListener('install', (event) => {
  event.waitUntil(precacheShell().then(() => self.skipWaiting()))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => !key.startsWith(`${VERSION}-`))
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  )
})

// 네트워크 우선: 성공하면 캐시 갱신, 실패하면 캐시 (그것도 없으면 fallbackUrl)
async function networkFirst(request, cacheName, fallbackUrl) {
  const cache = await caches.open(cacheName)
  try {
    const res = await fetch(request)
    if (res.ok) cache.put(request, res.clone())
    return res
  } catch (err) {
    const cached =
      (await cache.match(request)) ??
      (fallbackUrl ? await cache.match(fallbackUrl) : undefined)
    if (cached) return cached
    throw err
  }
}

// 캐시 우선: 한 번 받은 건 다시 안 받음 (해시 번들·버전 고정 폰트 전용)
async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName)
  const cached = await cache.match(request)
  if (cached) return cached
  const res = await fetch(request)
  // 폰트 CDN은 no-cors 응답(opaque, status 0)일 수 있어 ok 외에 type도 확인
  if (res.ok || res.type === 'opaque') cache.put(request, res.clone())
  return res
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return

  const url = new URL(request.url)

  // 페이지 이동 — 항상 최신을 시도하고, 오프라인이면 캐시된 셸
  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, SHELL, BASE))
    return
  }

  if (url.origin === self.location.origin) {
    if (url.pathname.startsWith(`${BASE}assets/`)) {
      event.respondWith(cacheFirst(request, ASSETS))
    } else {
      // data/ JSON, 아이콘, manifest 등 — 갱신 가능성이 있으니 네트워크 우선
      event.respondWith(networkFirst(request, DATA))
    }
    return
  }

  if (FONT_HOSTS.includes(url.hostname)) {
    event.respondWith(cacheFirst(request, FONTS))
  }
  // 그 외 외부 요청(아이템 아이콘 이미지 등)은 캐시하지 않음 — 용량 폭증 방지
})
