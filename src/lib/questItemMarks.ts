import { useSyncExternalStore } from 'react'

// 퀘스트 아이템 그리드의 타일 상태 — itemId → 'stash'(모아둠) | 'done'(완료).
// 클릭으로 순환: 미확보 → 모아둠(빗금) → 완료(접힘 섹션) → 해제.
// 준비물 체크리스트의 +/− 개수와는 독립 — 그리드는 "한눈 분류"용 단순 상태

export type QuestItemMark = 'stash' | 'done'

const KEY = 'tc:quest-item-marks'

let marks: Readonly<Record<string, QuestItemMark>> = {}
try {
  const raw = localStorage.getItem(KEY)
  if (raw) marks = JSON.parse(raw) as Record<string, QuestItemMark>
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

function persist(next: Record<string, QuestItemMark>) {
  marks = next
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    // 저장 실패는 무시 — 세션 동안은 메모리로 동작
  }
  listeners.forEach((l) => l())
}

function cycle(id: string) {
  const next = { ...marks }
  const cur = next[id]
  if (cur === undefined) next[id] = 'stash'
  else if (cur === 'stash') next[id] = 'done'
  else delete next[id]
  persist(next)
}

export function useQuestItemMarks(): {
  marks: Readonly<Record<string, QuestItemMark>>
  cycle: (id: string) => void
} {
  const m = useSyncExternalStore(subscribe, () => marks)
  return { marks: m, cycle }
}
