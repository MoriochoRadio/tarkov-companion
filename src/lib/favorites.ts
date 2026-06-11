import { useSyncExternalStore } from 'react'

// localStorage에 저장되는 ID 집합 (즐겨찾기 아이템 / 진행 중 퀘스트).
// 같은 키를 쓰는 컴포넌트끼리 자동 동기화되도록 구독 가능한 스토어로 관리.
// localStorage는 시크릿 모드 등에서 막힐 수 있어 전부 try로 감쌈 —
// 실패해도 즐겨찾기만 휘발될 뿐 앱은 정상 동작해야 함

export const FAV_ITEMS_KEY = 'tc:fav-items'
export const ACTIVE_QUESTS_KEY = 'tc:active-quests'

type Listener = () => void

interface IdSetStore {
  subscribe: (listener: Listener) => () => void
  getSnapshot: () => ReadonlySet<string>
  toggle: (id: string) => void
}

function createStore(storageKey: string): IdSetStore {
  let ids = new Set<string>()
  try {
    const raw = localStorage.getItem(storageKey)
    if (raw) ids = new Set(JSON.parse(raw) as string[])
  } catch {
    // 깨진 데이터나 접근 불가 — 빈 집합으로 시작
  }
  const listeners = new Set<Listener>()

  return {
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    getSnapshot: () => ids,
    toggle(id) {
      // useSyncExternalStore가 변경을 감지하도록 매번 새 Set 생성
      ids = new Set(ids)
      if (ids.has(id)) ids.delete(id)
      else ids.add(id)
      try {
        localStorage.setItem(storageKey, JSON.stringify([...ids]))
      } catch {
        // 저장 실패는 무시 — 세션 동안은 메모리로 동작
      }
      listeners.forEach((l) => l())
    },
  }
}

const stores = new Map<string, IdSetStore>()

function getStore(storageKey: string): IdSetStore {
  let store = stores.get(storageKey)
  if (!store) {
    store = createStore(storageKey)
    stores.set(storageKey, store)
  }
  return store
}

export function useIdSet(storageKey: string): {
  ids: ReadonlySet<string>
  toggle: (id: string) => void
} {
  const store = getStore(storageKey)
  const ids = useSyncExternalStore(store.subscribe, store.getSnapshot)
  return { ids, toggle: store.toggle }
}
