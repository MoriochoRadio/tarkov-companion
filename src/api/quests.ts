// tarkov.dev tasks 쿼리 — 한국어/영어 두 벌을 한 요청으로 받아 병합.
// "한국어명 (English)" 병기를 위해 영어판은 이름 필드만 최소로 받는다.
// 응답이 ~3MB라 퀘스트 탭을 처음 열 때 1회만 받아 세션 동안 캐시.
const ENDPOINT = 'https://api.tarkov.dev/graphql'

export interface QuestItemRef {
  id: string
  nameKo: string
  nameEn: string
}

export interface QuestObjective {
  id: string
  type: string
  description: string // 한국어 (일부 미번역은 영어 그대로 옴)
  optional: boolean
  items?: QuestItemRef[]
  count?: number
  foundInRaid?: boolean
}

export interface QuestReward {
  items: (QuestItemRef & { count: number })[]
  standing: { trader: string; standing: number }[]
}

export interface Quest {
  id: string
  nameKo: string
  nameEn: string
  displayName: string // "한국어명 (English)" — 병합 시 1회 계산
  searchKey: string // 소문자 ko+en — 검색 필터용 사전 계산
  trader: { id: string; name: string }
  map: { id: string; name: string } | null
  minPlayerLevel: number
  experience: number
  kappaRequired: boolean
  wikiLink: string | null
  requires: string[] // 선행 퀘스트 id
  unlocks: string[] // 후행 퀘스트 id (requires의 역방향, 클라이언트 계산)
  objectives: QuestObjective[]
  rewards: QuestReward
}

const QUERY = `{
  ko: tasks(lang: ko) {
    id name minPlayerLevel experience kappaRequired wikiLink
    trader { id name }
    map { id name }
    taskRequirements { task { id } }
    objectives {
      id type description optional
      ... on TaskObjectiveItem { items { id name } count foundInRaid }
    }
    finishRewards {
      items { item { id name } count }
      traderStanding { trader { name } standing }
    }
  }
  en: tasks(lang: en) {
    id name
    objectives { id ... on TaskObjectiveItem { items { id name } } }
    finishRewards { items { item { id name } } }
  }
}`

interface RawKoTask {
  id: string
  name: string
  minPlayerLevel: number | null
  experience: number | null
  kappaRequired: boolean | null
  wikiLink: string | null
  trader: { id: string; name: string }
  map: { id: string; name: string } | null
  taskRequirements: { task: { id: string } | null }[]
  objectives: {
    id: string
    type: string
    description: string | null
    optional: boolean | null
    items?: { id: string; name: string }[]
    count?: number | null
    foundInRaid?: boolean | null
  }[]
  finishRewards: {
    items: { item: { id: string; name: string }; count: number }[]
    traderStanding: { trader: { name: string }; standing: number }[]
  } | null
}

interface RawEnTask {
  id: string
  name: string
  objectives: { id: string; items?: { id: string; name: string }[] }[]
  finishRewards: { items: { item: { id: string; name: string } }[] } | null
}

function mergeTasks(koTasks: RawKoTask[], enTasks: RawEnTask[]): Quest[] {
  // 영어 이름 색인: 퀘스트명은 id로, 아이템명은 전역 아이템 id로
  const enTaskName = new Map<string, string>()
  const enItemName = new Map<string, string>()
  for (const t of enTasks) {
    enTaskName.set(t.id, t.name)
    for (const o of t.objectives) {
      for (const i of o.items ?? []) enItemName.set(i.id, i.name)
    }
    for (const r of t.finishRewards?.items ?? []) {
      enItemName.set(r.item.id, r.item.name)
    }
  }

  const quests: Quest[] = koTasks.map((t) => {
    const nameKo = t.name.trim()
    const nameEn = (enTaskName.get(t.id) ?? t.name).trim()
    return {
    id: t.id,
    nameKo,
    nameEn,
    displayName: biName(nameKo, nameEn),
    searchKey: `${nameKo} ${nameEn}`.toLowerCase(),
    trader: t.trader,
    map: t.map,
    minPlayerLevel: t.minPlayerLevel ?? 1,
    experience: t.experience ?? 0,
    kappaRequired: t.kappaRequired ?? false,
    wikiLink: t.wikiLink,
    requires: t.taskRequirements
      .map((r) => r.task?.id)
      .filter((id): id is string => Boolean(id)),
    unlocks: [],
    objectives: t.objectives.map((o) => ({
      id: o.id,
      type: o.type,
      description: (o.description ?? '').trim(),
      optional: o.optional ?? false,
      ...(o.items?.length
        ? {
            items: o.items.map((i) => ({
              id: i.id,
              nameKo: i.name.trim(),
              nameEn: (enItemName.get(i.id) ?? i.name).trim(),
            })),
          }
        : {}),
      ...(o.count != null ? { count: o.count } : {}),
      ...(o.foundInRaid != null ? { foundInRaid: o.foundInRaid } : {}),
    })),
    rewards: {
      items: (t.finishRewards?.items ?? []).map((r) => ({
        id: r.item.id,
        nameKo: r.item.name.trim(),
        nameEn: (enItemName.get(r.item.id) ?? r.item.name).trim(),
        count: r.count,
      })),
      standing: (t.finishRewards?.traderStanding ?? []).map((s) => ({
        trader: s.trader.name,
        standing: s.standing,
      })),
    },
    }
  })

  // 후행 퀘스트 = requires의 역방향
  const byId = new Map(quests.map((q) => [q.id, q]))
  for (const q of quests) {
    for (const reqId of q.requires) {
      byId.get(reqId)?.unlocks.push(q.id)
    }
  }
  return quests
}

let questsCache: Promise<Quest[]> | null = null

export function fetchQuests(): Promise<Quest[]> {
  questsCache ??= fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: QUERY }),
  })
    .then(async (res) => {
      if (!res.ok) throw new Error(`tarkov.dev API 응답 오류 (HTTP ${res.status})`)
      const json = (await res.json()) as {
        data?: { ko: RawKoTask[]; en: RawEnTask[] }
        errors?: { message: string }[]
      }
      if (json.errors?.length) {
        throw new Error(`tarkov.dev API 오류: ${json.errors[0].message}`)
      }
      if (!json.data) throw new Error('tarkov.dev API가 데이터를 반환하지 않음')
      return mergeTasks(json.data.ko, json.data.en)
    })
    .catch((err: unknown) => {
      questsCache = null // 실패는 캐시하지 않고 재시도 가능하게
      throw err
    })
  return questsCache
}

// "한국어명 (English)" 병기 — 같거나 한국어명에 영어가 이미 포함되면 중복 표기 생략
export function biName(ko: string, en: string): string {
  if (!en || ko === en) return ko
  if (ko.toLowerCase().includes(en.toLowerCase())) return ko
  return `${ko} (${en})`
}
