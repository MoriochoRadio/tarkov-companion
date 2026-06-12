import { useSyncExternalStore } from 'react'

// 즐겨찾기 가격 알림 — itemId → { 방향, 목표가, 발동 시각 }.
// 서버가 없으므로 "사이트가 열려 있는 동안" lib/alertPoller.ts가 주기 확인.
// 발동되면 fired를 기록해 같은 알림이 반복 발사되지 않게 하고(원샷),
// 사용자가 다시 저장하면 재무장된다

export interface PriceAlert {
  dir: 'above' | 'below'
  price: number
  fired?: number // epoch ms — 있으면 이미 발동됨
}

const KEY = 'tc:price-alerts'

let alerts: Readonly<Record<string, PriceAlert>> = {}
try {
  const raw = localStorage.getItem(KEY)
  if (raw) alerts = JSON.parse(raw) as Record<string, PriceAlert>
} catch {
  // 깨진 데이터나 접근 불가 — 빈 맵으로 시작
}

const listeners = new Set<() => void>()

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function persist(next: Record<string, PriceAlert>) {
  alerts = next
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    // 저장 실패는 무시 — 세션 동안은 메모리로 동작
  }
  listeners.forEach((l) => l())
}

export function setAlert(id: string, alert: PriceAlert | null) {
  const next = { ...alerts }
  if (alert) next[id] = alert
  else delete next[id]
  persist(next)
}

export function markFired(id: string) {
  const a = alerts[id]
  if (!a || a.fired) return
  persist({ ...alerts, [id]: { ...a, fired: Date.now() } })
}

// 폴러용 동기 스냅샷 (훅 밖에서 사용)
export function getAlerts(): Readonly<Record<string, PriceAlert>> {
  return alerts
}

export function usePriceAlerts(): {
  alerts: Readonly<Record<string, PriceAlert>>
  set: (id: string, alert: PriceAlert | null) => void
} {
  const a = useSyncExternalStore(subscribe, () => alerts)
  return { alerts: a, set: setAlert }
}
