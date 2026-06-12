// tarkov.dev tasks 쿼리 — 한국어/영어 두 벌을 한 요청으로 받아 병합.
// "한국어명 (English)" 병기를 위해 영어판은 이름 필드만 최소로 받는다.
// 응답이 ~3MB라 퀘스트 탭을 처음 열 때 1회만 받아 세션 동안 캐시.
const ENDPOINT = 'https://api.tarkov.dev/graphql'

export interface QuestItemRef {
  id: string
  nameKo: string
  nameEn: string
  iconLink: string | null
  imageLink: string | null // 512px — 라이트박스용
}

export interface QuestObjective {
  id: string
  type: string
  description: string // 한국어 (일부 미번역은 영어 그대로 옴)
  optional: boolean
  maps: { id: string; name: string }[] // 목표가 묶인 맵 (없으면 장소 무관)
  items?: QuestItemRef[]
  count?: number
  foundInRaid?: boolean
  // 맵 퀘스트 플래너용 (Phase 25) — 지참물·처치 요약 재료
  markerItem?: QuestItemRef // mark: 설치할 마커 (MS2000 등)
  questItem?: { id: string; nameKo: string; nameEn: string } // 숨기기/회수 대상
  targetNames?: string[] // shoot: 처치 대상
  useItems?: QuestItemRef[] // useItem: 사용할 아이템 (신호탄 등)
  // 맵 마커용 (Phase 26) — zones 중심점 + 퀘스트 아이템 스폰 후보 (게임 월드 좌표)
  locations?: { mapId: string; x: number; z: number }[]
}

export interface QuestReward {
  items: (QuestItemRef & { count: number })[]
  standing: { trader: string; standing: number }[]
}

// 퀘스트 완료 보상 중 "트레이더 오퍼 해금" — 해금 탭의 역인덱스 재료
export interface OfferUnlock {
  item: QuestItemRef
  trader: { id: string; name: string }
  level: number // 트레이더 로열티 레벨 (LL)
}

export interface Quest {
  id: string
  nameKo: string
  nameEn: string
  displayName: string // "한국어명 (English)" — 병합 시 1회 계산
  searchKey: string // 소문자 ko+en — 검색 필터용 사전 계산
  trader: { id: string; name: string; imageLink: string | null }
  map: { id: string; name: string; normalizedName: string } | null
  minPlayerLevel: number
  experience: number
  kappaRequired: boolean
  wikiLink: string | null
  requires: string[] // 선행 퀘스트 id
  unlocks: string[] // 후행 퀘스트 id (requires의 역방향, 클라이언트 계산)
  objectives: QuestObjective[]
  rewards: QuestReward
  unlockOffers: OfferUnlock[]
}

const QUERY = `{
  ko: tasks(lang: ko) {
    id name minPlayerLevel experience kappaRequired wikiLink
    trader { id name imageLink }
    map { id name normalizedName }
    taskRequirements { task { id } }
    objectives {
      id type description optional
      maps { id name }
      ... on TaskObjectiveItem { items { id name iconLink image512pxLink } count foundInRaid zones { map { id } position { x z } } }
      ... on TaskObjectiveMark { markerItem { id name iconLink image512pxLink } zones { map { id } position { x z } } }
      ... on TaskObjectiveQuestItem { questItem { id name } count zones { map { id } position { x z } } possibleLocations { map { id } positions { x z } } }
      ... on TaskObjectiveShoot { targetNames count zones { map { id } position { x z } } }
      ... on TaskObjectiveUseItem { useAny { id name iconLink image512pxLink } count zones { map { id } position { x z } } }
      ... on TaskObjectiveBasic { zones { map { id } position { x z } } }
    }
    finishRewards {
      items { item { id name iconLink image512pxLink } count }
      traderStanding { trader { name } standing }
      offerUnlock { level trader { id name } item { id name iconLink image512pxLink } }
    }
  }
  en: tasks(lang: en) {
    id name
    objectives {
      id
      ... on TaskObjectiveItem { items { id name } }
      ... on TaskObjectiveMark { markerItem { id name } }
      ... on TaskObjectiveQuestItem { questItem { id name } }
      ... on TaskObjectiveUseItem { useAny { id name } }
    }
    finishRewards { items { item { id name } } offerUnlock { item { id name } } }
  }
}`

interface RawKoTask {
  id: string
  name: string
  minPlayerLevel: number | null
  experience: number | null
  kappaRequired: boolean | null
  wikiLink: string | null
  trader: { id: string; name: string; imageLink: string | null }
  map: { id: string; name: string; normalizedName: string } | null
  taskRequirements: { task: { id: string } | null }[]
  objectives: {
    id: string
    type: string
    description: string | null
    optional: boolean | null
    maps: { id: string; name: string }[] | null
    items?: RawItem[]
    count?: number | null
    foundInRaid?: boolean | null
    markerItem?: RawItem | null
    questItem?: { id: string; name: string } | null
    targetNames?: (string | null)[] | null
    useAny?: RawItem[] | null
    zones?: { map: { id: string } | null; position: { x: number; z: number } | null }[] | null
    possibleLocations?:
      | { map: { id: string } | null; positions: { x: number; z: number }[] | null }[]
      | null
  }[]
  finishRewards: {
    items: { item: RawItem; count: number }[]
    traderStanding: { trader: { name: string }; standing: number }[]
    offerUnlock: {
      level: number
      trader: { id: string; name: string }
      item: RawItem
    }[]
  } | null
}

interface RawItem {
  id: string
  name: string
  iconLink: string | null
  image512pxLink: string | null
}

interface RawEnTask {
  id: string
  name: string
  objectives: {
    id: string
    items?: { id: string; name: string }[]
    markerItem?: { id: string; name: string } | null
    questItem?: { id: string; name: string } | null
    useAny?: { id: string; name: string }[] | null
  }[]
  finishRewards: {
    items: { item: { id: string; name: string } }[]
    offerUnlock: { item: { id: string; name: string } }[]
  } | null
}

type RawOffer = NonNullable<RawKoTask['finishRewards']>['offerUnlock'][number]

function dedupeOffers(offers: RawOffer[]): RawOffer[] {
  const seen = new Set<string>()
  return offers.filter((o) => {
    const key = `${o.item.id}|${o.trader.id}|${o.level}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function mergeTasks(koTasks: RawKoTask[], enTasks: RawEnTask[]): Quest[] {
  // 영어 이름 색인: 퀘스트명은 id로, 아이템명은 전역 아이템 id로
  const enTaskName = new Map<string, string>()
  const enItemName = new Map<string, string>()
  for (const t of enTasks) {
    enTaskName.set(t.id, t.name)
    for (const o of t.objectives) {
      for (const i of o.items ?? []) enItemName.set(i.id, i.name)
      if (o.markerItem) enItemName.set(o.markerItem.id, o.markerItem.name)
      if (o.questItem) enItemName.set(o.questItem.id, o.questItem.name)
      for (const i of o.useAny ?? []) enItemName.set(i.id, i.name)
    }
    for (const r of t.finishRewards?.items ?? []) {
      enItemName.set(r.item.id, r.item.name)
    }
    for (const o of t.finishRewards?.offerUnlock ?? []) {
      enItemName.set(o.item.id, o.item.name)
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
    objectives: t.objectives.map((o) => {
      const ref = (i: RawItem): QuestItemRef => ({
        id: i.id,
        nameKo: i.name.trim(),
        nameEn: (enItemName.get(i.id) ?? i.name).trim(),
        iconLink: i.iconLink,
        imageLink: i.image512pxLink,
      })
      return {
        id: o.id,
        type: o.type,
        description: (o.description ?? '').trim(),
        optional: o.optional ?? false,
        maps: o.maps ?? [],
        ...(o.items?.length ? { items: o.items.map(ref) } : {}),
        ...(o.count != null ? { count: o.count } : {}),
        ...(o.foundInRaid != null ? { foundInRaid: o.foundInRaid } : {}),
        ...(o.markerItem ? { markerItem: ref(o.markerItem) } : {}),
        ...(o.questItem
          ? {
              questItem: {
                id: o.questItem.id,
                nameKo: o.questItem.name.trim(),
                nameEn: (enItemName.get(o.questItem.id) ?? o.questItem.name).trim(),
              },
            }
          : {}),
        ...(o.targetNames?.length
          ? { targetNames: o.targetNames.filter((n): n is string => Boolean(n)) }
          : {}),
        ...(o.useAny?.length ? { useItems: o.useAny.map(ref) } : {}),
        ...(() => {
          // zones 중심점 + 스폰 후보를 합쳐 마커 좌표 목록으로 (맵 마커용)
          const locs: { mapId: string; x: number; z: number }[] = []
          for (const zn of o.zones ?? []) {
            if (zn.map && zn.position) {
              locs.push({ mapId: zn.map.id, x: zn.position.x, z: zn.position.z })
            }
          }
          for (const pl of o.possibleLocations ?? []) {
            if (!pl.map) continue
            for (const p of pl.positions ?? []) {
              locs.push({ mapId: pl.map.id, x: p.x, z: p.z })
            }
          }
          return locs.length ? { locations: locs } : {}
        })(),
      }
    }),
    rewards: {
      items: (t.finishRewards?.items ?? []).map((r) => ({
        id: r.item.id,
        nameKo: r.item.name.trim(),
        nameEn: (enItemName.get(r.item.id) ?? r.item.name).trim(),
        iconLink: r.item.iconLink,
        imageLink: r.item.image512pxLink,
        count: r.count,
      })),
      standing: (t.finishRewards?.traderStanding ?? []).map((s) => ({
        trader: s.trader.name,
        standing: s.standing,
      })),
    },
    // 일부 아이템명에 후행 공백이 있어 trim 필수, API가 같은 오퍼를 태스크 안에
    // 두 번 주는 경우가 있어(Gunsmith Part 4 등 5건 실측) 중복 제거도 필수
    unlockOffers: dedupeOffers(t.finishRewards?.offerUnlock ?? []).map((o) => ({
      level: o.level,
      trader: o.trader,
      item: {
        id: o.item.id,
        nameKo: o.item.name.trim(),
        nameEn: (enItemName.get(o.item.id) ?? o.item.name).trim(),
        iconLink: o.item.iconLink,
        imageLink: o.item.image512pxLink,
      },
    })),
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
