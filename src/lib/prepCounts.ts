import { useSyncExternalStore } from 'react'

// 준비물 체크리스트 "모은 개수" — itemId → count.
// favorites.ts와 같은 패턴(useSyncExternalStore + localStorage)이지만
// 집합이 아니라 숫자 맵이라 별도 스토어로 둠

const KEY = 'tc:prep-counts'
const MAX = 9999 // 오입력 폭주 방지용 상한

let counts: Readonly<Record<string, number>> = {}
try {
  const raw = localStorage.getItem(KEY)
  if (raw) counts = JSON.parse(raw) as Record<string, number>
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

function add(id: string, delta: number) {
  const next = Math.max(0, Math.min(MAX, (counts[id] ?? 0) + delta))
  const copy: Record<string, number> = { ...counts }
  if (next === 0) delete copy[id] // 0은 저장하지 않아 localStorage를 작게 유지
  else copy[id] = next
  counts = copy
  try {
    localStorage.setItem(KEY, JSON.stringify(copy))
  } catch {
    // 저장 실패는 무시 — 세션 동안은 메모리로 동작
  }
  listeners.forEach((l) => l())
}

export function usePrepCounts(): {
  counts: Readonly<Record<string, number>>
  add: (id: string, delta: number) => void
} {
  const c = useSyncExternalStore(subscribe, () => counts)
  return { counts: c, add }
}
