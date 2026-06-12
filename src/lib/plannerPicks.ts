import { useSyncExternalStore } from 'react'

// 맵 퀘스트 플래너의 선택 상태 — mapId → 선택한 questId 배열.
// prepCounts와 같은 패턴 (useSyncExternalStore + localStorage)

const KEY = 'tc:planner-picks'

let picks: Readonly<Record<string, readonly string[]>> = {}
try {
  const raw = localStorage.getItem(KEY)
  if (raw) picks = JSON.parse(raw) as Record<string, string[]>
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

function persist(next: Record<string, readonly string[]>) {
  picks = next
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    // 저장 실패는 무시 — 세션 동안은 메모리로 동작
  }
  listeners.forEach((l) => l())
}

function toggle(mapId: string, questId: string) {
  const cur = picks[mapId] ?? []
  const next = cur.includes(questId)
    ? cur.filter((id) => id !== questId)
    : [...cur, questId]
  const copy: Record<string, readonly string[]> = { ...picks }
  if (next.length === 0) delete copy[mapId] // 빈 맵 항목은 저장하지 않음
  else copy[mapId] = next
  persist(copy)
}

function clear(mapId: string) {
  if (!picks[mapId]) return
  const copy: Record<string, readonly string[]> = { ...picks }
  delete copy[mapId]
  persist(copy)
}

export function usePlannerPicks(): {
  picks: Readonly<Record<string, readonly string[]>>
  toggle: (mapId: string, questId: string) => void
  clear: (mapId: string) => void
} {
  const p = useSyncExternalStore(subscribe, () => picks)
  return { picks: p, toggle, clear }
}
