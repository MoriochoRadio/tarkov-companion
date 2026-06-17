import { useSyncExternalStore } from 'react'

// 맵 플래너 "보기 상태" 저장소 (Phase 34) — 마커 표시/완료를 맵별로 기억.
// plannerPicks.ts와 같은 패턴(useSyncExternalStore + localStorage). 픽(tc:planner-picks)·
// 체크(tc:prep-counts)와 완전히 분리된 신규 키만 쓴다 — 기존 키는 절대 건드리지 않음.
//   tc:planner-hidden : mapId → [questId]      (맵에서 마커를 숨긴 퀘스트)
//   tc:planner-done   : mapId → ["o.id-i"]     (완료/방문 표시한 목표-위치)
// 둘 다 "맵별 문자열 집합"이라 같은 팩토리로 만든다.

function makeMapStore(key: string) {
  let state: Readonly<Record<string, readonly string[]>> = {}
  try {
    const raw = localStorage.getItem(key)
    if (raw) state = JSON.parse(raw) as Record<string, string[]>
  } catch {
    // 깨진 데이터·접근 불가 — 빈 맵으로 시작
  }

  const listeners = new Set<() => void>()
  const subscribe = (listener: () => void) => {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }

  function persist(next: Record<string, readonly string[]>) {
    state = next
    try {
      localStorage.setItem(key, JSON.stringify(next))
    } catch {
      // 저장 실패는 무시 — 세션 동안은 메모리로 동작
    }
    listeners.forEach((l) => l())
  }

  function toggle(mapId: string, id: string) {
    const cur = state[mapId] ?? []
    const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]
    const copy: Record<string, readonly string[]> = { ...state }
    if (next.length === 0) delete copy[mapId] // 빈 맵 항목은 저장하지 않음
    else copy[mapId] = next
    persist(copy)
  }

  function clearMap(mapId: string) {
    if (!state[mapId]) return
    const copy: Record<string, readonly string[]> = { ...state }
    delete copy[mapId]
    persist(copy)
  }

  return {
    toggle,
    clearMap,
    useStore: () => useSyncExternalStore(subscribe, () => state),
  }
}

const hiddenStore = makeMapStore('tc:planner-hidden')
const doneStore = makeMapStore('tc:planner-done')

export function usePlannerHidden(): {
  hidden: Readonly<Record<string, readonly string[]>>
  toggle: (mapId: string, questId: string) => void
  clearMap: (mapId: string) => void
} {
  return {
    hidden: hiddenStore.useStore(),
    toggle: hiddenStore.toggle,
    clearMap: hiddenStore.clearMap,
  }
}

export function usePlannerDone(): {
  done: Readonly<Record<string, readonly string[]>>
  toggle: (mapId: string, markerKey: string) => void
  clearMap: (mapId: string) => void
} {
  return {
    done: doneStore.useStore(),
    toggle: doneStore.toggle,
    clearMap: doneStore.clearMap,
  }
}
