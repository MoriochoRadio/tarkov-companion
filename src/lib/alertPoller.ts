// 가격 알림 폴러 — 사이트가 열려 있는 동안 주기적으로, 알림이 걸린 아이템만
// 콕 집어 시세를 확인한다 (전체 아이템 데이터셋과 무관한 아이템 단위 요청).
// 백그라운드 탭에서도 동작하므로 다른 작업 중에도 브라우저 알림을 받을 수 있음.
// 서버가 없어 "사이트를 닫으면 알림도 멈춘다" — UI 힌트에 명시할 것
import { loadItems, loadPriceHistory, trKo } from '../api/jsonApi'
import { getAlerts, markFired } from './priceAlerts'

// 15분 주기 — GraphQL 시절엔 5분이었지만, JSON API는 아이템당 시세 히스토리
// 전 구간(약 40KB gzip)을 주고 원본 시세 자체가 2시간 간격으로만 갱신된다.
// 5분마다 두드려도 새 값이 없으므로 주기를 늘려 트래픽만 줄였다
const INTERVAL_MS = 15 * 60 * 1000
const FIRST_CHECK_MS = 8_000 // 첫 페인트와 경쟁하지 않게 잠깐 늦게 시작

async function check() {
  const alerts = getAlerts()
  const ids = Object.entries(alerts)
    .filter(([, a]) => !a.fired)
    .map(([id]) => id)
  if (ids.length === 0) return

  let prices: { id: string; name: string; price: number }[]
  try {
    // 이름은 이미 받아 둔 아이템 데이터셋 캐시에서 (알림은 시세 탭에서만 걸 수 있으므로 항상 로드돼 있음)
    const items = await loadItems()
    prices = (
      await Promise.all(
        ids.map(async (id) => {
          const points = await loadPriceHistory(id)
          const last = points[points.length - 1]
          if (!last) return null
          return {
            id,
            name: trKo(items, items.data.items[id]?.name),
            price: last.price,
          }
        }),
      )
    ).filter((p): p is { id: string; name: string; price: number } => p !== null)
  } catch {
    return // 네트워크 일시 오류 — 다음 주기에 재시도
  }

  for (const item of prices) {
    if (!item.price) continue
    const a = getAlerts()[item.id]
    if (!a || a.fired) continue
    const hit = a.dir === 'above' ? item.price >= a.price : item.price <= a.price
    if (!hit) continue
    markFired(item.id)
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      try {
        new Notification('타르코프 시세 알림', {
          body: `${item.name} — 현재 ₽${item.price.toLocaleString('ko-KR')} (목표 ${a.dir === 'above' ? '이상' : '이하'} ₽${a.price.toLocaleString('ko-KR')} 도달)`,
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
