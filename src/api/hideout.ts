// tarkov.dev hideoutStations — 스테이션·레벨별 건설 요구 (준비물 탭용).
// ko/en 두 벌을 한 요청으로 받아 한/영 병기. 응답이 수십 KB라 가벼움.
// "은신처 뷰"(인게임풍 스테이션 카드)와 통합 체크리스트 집계가 같은 캐시를 공유.
const ENDPOINT = 'https://api.tarkov.dev/graphql'

// 화폐는 "레이드에서 챙겨야 할 아이템"이 아니므로 체크리스트 집계에서 제외.
// API의 types로는 화폐를 구분할 수 없어(루블도 ["noFlea"]뿐) id로 직접 거름.
// 퀘스트 쪽 집계(PrepTab)도 같은 목록을 써야 해서 export — 돈 제출형
// 퀘스트(Buyout 류, 루블 100만 단위)가 목록을 도배하는 것을 막음.
// 은신처 뷰에서는 건설비로 표시는 하되 isCurrency로 구분한다.
export const CURRENCY_IDS = new Set([
  '5449016a4bdc2d6f028b456f', // 루블
  '5696686a4bdc2da3298b456a', // 달러
  '569668774bdc2da2298b4568', // 유로
])

export interface HideoutItemRef {
  id: string
  nameKo: string
  nameEn: string
  iconLink: string | null
}

export interface HideoutLevel {
  level: number
  constructionTime: number // 초
  items: { item: HideoutItemRef; count: number; isCurrency: boolean }[]
  stationRequirements: { stationId: string; name: string; level: number }[]
  skillRequirements: { name: string; level: number }[]
  traderRequirements: { name: string; level: number }[]
}

export interface HideoutStation {
  id: string
  name: string // 한국어
  imageLink: string | null
  levels: HideoutLevel[]
}

// 통합 체크리스트 집계용 — 화폐 제외, 평탄화
export interface HideoutRequirement {
  stationId: string
  stationName: string
  level: number
  item: HideoutItemRef
  count: number
}

const QUERY = `{
  ko: hideoutStations(lang: ko) {
    id name imageLink
    levels {
      level constructionTime
      itemRequirements { item { id name iconLink } count }
      stationLevelRequirements { station { id name } level }
      skillRequirements { name level }
      traderRequirements { trader { name } level }
    }
  }
  en: hideoutStations(lang: en) {
    id
    levels { level itemRequirements { item { id name } count } }
  }
}`

interface RawStation {
  id: string
  name?: string
  imageLink?: string | null
  levels: {
    level: number
    constructionTime?: number
    itemRequirements: {
      item: { id: string; name: string; iconLink?: string | null }
      count: number
    }[]
    stationLevelRequirements?: { station: { id: string; name: string }; level: number }[]
    skillRequirements?: { name: string; level: number }[]
    traderRequirements?: { trader: { name: string }; level: number }[]
  }[]
}

function merge(ko: RawStation[], en: RawStation[]): HideoutStation[] {
  const enItemName = new Map<string, string>()
  for (const s of en) {
    for (const lv of s.levels) {
      for (const r of lv.itemRequirements) enItemName.set(r.item.id, r.item.name)
    }
  }

  return ko.map((s) => ({
    id: s.id,
    name: (s.name ?? '').trim(),
    imageLink: s.imageLink ?? null,
    levels: s.levels
      .map((lv) => ({
        level: lv.level,
        constructionTime: lv.constructionTime ?? 0,
        items: lv.itemRequirements.map((r) => ({
          item: {
            id: r.item.id,
            nameKo: r.item.name.trim(),
            nameEn: (enItemName.get(r.item.id) ?? r.item.name).trim(),
            iconLink: r.item.iconLink ?? null,
          },
          count: r.count,
          isCurrency: CURRENCY_IDS.has(r.item.id),
        })),
        stationRequirements: (lv.stationLevelRequirements ?? []).map((r) => ({
          stationId: r.station.id,
          name: r.station.name,
          level: r.level,
        })),
        skillRequirements: lv.skillRequirements ?? [],
        traderRequirements: (lv.traderRequirements ?? []).map((r) => ({
          name: r.trader.name,
          level: r.level,
        })),
      }))
      .sort((a, b) => a.level - b.level),
  }))
}

let cache: Promise<HideoutStation[]> | null = null

export function fetchHideoutStations(): Promise<HideoutStation[]> {
  cache ??= fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: QUERY }),
  })
    .then(async (res) => {
      if (!res.ok) throw new Error(`tarkov.dev API 응답 오류 (HTTP ${res.status})`)
      const json = (await res.json()) as {
        data?: { ko: RawStation[]; en: RawStation[] }
        errors?: { message: string }[]
      }
      if (json.errors?.length) {
        throw new Error(`tarkov.dev API 오류: ${json.errors[0].message}`)
      }
      if (!json.data) throw new Error('tarkov.dev API가 데이터를 반환하지 않음')
      return merge(json.data.ko, json.data.en)
    })
    .catch((err: unknown) => {
      cache = null // 실패는 캐시하지 않고 재시도 가능하게
      throw err
    })
  return cache
}

// 체크리스트 집계용 평탄화 — 화폐 제외
export async function fetchHideoutRequirements(): Promise<HideoutRequirement[]> {
  const stations = await fetchHideoutStations()
  const out: HideoutRequirement[] = []
  for (const s of stations) {
    for (const lv of s.levels) {
      for (const r of lv.items) {
        if (r.isCurrency) continue
        out.push({
          stationId: s.id,
          stationName: s.name,
          level: lv.level,
          item: r.item,
          count: r.count,
        })
      }
    }
  }
  return out
}
