import { useSyncExternalStore } from 'react'

// "내 레벨" — 퀘스트 탭과 준비물 탭이 공유하는 단일 값.
// 탭마다 따로 입력하게 하지 않으려고 localStorage에 저장해 어디서 바꿔도 동기화.
// 빈 문자열 = 미입력(레벨 필터 끔)

const KEY = 'tc:my-level'

let value = ''
try {
  value = localStorage.getItem(KEY) ?? ''
} catch {
  // 접근 불가 환경 — 세션 동안 메모리로만 동작
}

const listeners = new Set<() => void>()

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function setPlayerLevel(next: string) {
  value = next
  try {
    localStorage.setItem(KEY, next)
  } catch {
    // 저장 실패 무시
  }
  listeners.forEach((l) => l())
}

export function usePlayerLevel(): [string, (v: string) => void] {
  const v = useSyncExternalStore(subscribe, () => value)
  return [v, setPlayerLevel]
}
