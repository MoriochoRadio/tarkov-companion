// 가격 알림 폴러 — 사이트가 열려 있는 동안 5분마다, 알림이 걸린 아이템만
// 콕 집어 시세를 확인한다 (id 지정 경량 쿼리 — 전체 1.3MB 캐시와 무관).
// 백그라운드 탭에서도 동작하므로 다른 작업 중에도 브라우저 알림을 받을 수 있음.
// 서버가 없어 "사이트를 닫으면 알림도 멈춘다" — UI 힌트에 명시할 것
import { getAlerts, markFired } from './priceAlerts'

const ENDPOINT = 'https://api.tarkov.dev/graphql'
const INTERVAL_MS = 5 * 60 * 1000
const FIRST_CHECK_MS = 8_000 // 첫 페인트와 경쟁하지 않게 잠깐 늦게 시작

async function check() {
  const alerts = getAlerts()
  const ids = Object.entries(alerts)
    .filter(([, a]) => !a.fired)
    .map(([id]) => id)
  if (ids.length === 0) return

  const fields = ids
    .map((id, i) => `i${i}: item(id: "${id.replace(/[^\w-]/g, '')}") { id name avg24hPrice }`)
    .join(' ')
  let data: Record<string, { id: string; name: string; avg24hPrice: number | null } | null>
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: `{ ${fields} }` }),
    })
    const json = (await res.json()) as { data?: typeof data }
    if (!json.data) return
    data = json.data
  } catch {
    return // 네트워크 일시 오류 — 다음 주기에 재시도
  }

  for (const item of Object.values(data)) {
    if (!item?.avg24hPrice) continue
    const a = getAlerts()[item.id]
    if (!a || a.fired) continue
    const hit =
      a.dir === 'above' ? item.avg24hPrice >= a.price : item.avg24hPrice <= a.price
    if (!hit) continue
    markFired(item.id)
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      try {
        new Notification('타르코프 시세 알림', {
          body: `${item.name} — 현재 ₽${item.avg24hPrice.toLocaleString('ko-KR')} (목표 ${a.dir === 'above' ? '이상' : '이하'} ₽${a.price.toLocaleString('ko-KR')} 도달)`,
          icon: `${import.meta.env.BASE_URL}icon-192.png`,
          tag: `tc-alert-${item.id}`, // 같은 아이템 중복 알림 합치기
        })
      } catch {
        // 일부 모바일 브라우저는 페이지 컨텍스트 Notification 생성 불가 — 무시
      }
    }
  }
}

export function startAlertPoller(): () => void {
  const first = setTimeout(check, FIRST_CHECK_MS)
  const iv = setInterval(check, INTERVAL_MS)
  return () => {
    clearTimeout(first)
    clearInterval(iv)
  }
}
