// 열쇠 가성비 분석용 — 열쇠 전종(약 300개)의 사용 횟수·퀘스트 연관.
// GraphQL의 usedInTasks가 JSON API엔 없어 퀘스트 데이터셋에서 역인덱스를 만든다
// (목표별 requiredKeys + 퀘스트별 neededKeys 양쪽 — 둘 다 열쇠 id 목록)
import { loadDataset, loadItems, trKo, type Dataset } from './jsonApi'

export interface KeyInfo {
  id: string
  name: string
  shortName: string
  iconLink: string | null
  fleaPrice: number | null
  uses: number | null // null = 무제한(키카드 일부) 또는 정보 없음
  questNames: string[] // 이 열쇠가 필요한 퀘스트
  searchKey: string
}

interface RawTasksForKeys {
  tasks: Record<
    string,
    {
      name: string
      neededKeys?: { keys: string[] }[] | null
      objectives: { requiredKeys?: string[][] | null }[]
    }
  >
}

// 열쇠 id → 퀘스트 이름들 (한국어). 같은 퀘스트가 여러 목표에서 같은 열쇠를 요구할 수 있어 중복 제거
function buildKeyQuestIndex(d: Dataset<RawTasksForKeys>): Map<string, string[]> {
  const index = new Map<string, Set<string>>()
  const add = (keyId: string, questName: string) => {
    const set = index.get(keyId) ?? new Set<string>()
    set.add(questName)
    index.set(keyId, set)
  }
  for (const t of Object.values(d.data.tasks)) {
    const questName = trKo(d, t.name)
    for (const grp of t.neededKeys ?? []) {
      for (const k of grp.keys) add(k, questName)
    }
    for (const o of t.objectives) {
      for (const grp of o.requiredKeys ?? []) {
        for (const k of grp) add(k, questName)
      }
    }
  }
  return new Map([...index].map(([id, names]) => [id, [...names]]))
}

let cache: Promise<KeyInfo[]> | null = null

export function fetchKeys(): Promise<KeyInfo[]> {
  cache ??= Promise.all([loadItems(), loadDataset<RawTasksForKeys>('tasks')])
    .then(([items, tasks]) => {
      const questsByKey = buildKeyQuestIndex(tasks)
      return Object.values(items.data.items)
        .filter((i) => i.types?.includes('keys'))
        .map((k) => {
          const name = trKo(items, k.name)
          const shortName = trKo(items, k.shortName)
          return {
            id: k.id,
            name,
            shortName,
            iconLink: k.iconLink,
            fleaPrice: k.avg24hPrice,
            uses: k.properties?.uses ?? null,
            questNames: questsByKey.get(k.id) ?? [],
            searchKey: `${name} ${shortName}`.toLowerCase(),
          }
        })
    })
    .catch((err: unknown) => {
      cache = null
      throw err
    })
  return cache
}
