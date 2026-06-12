// tarkov.dev hideoutStations — 스테이션 레벨별 건설 요구 아이템 (준비물 탭용).
// ko/en 두 벌을 한 요청으로 받아 한/영 병기. 응답이 수십 KB라 가벼움.
const ENDPOINT = 'https://api.tarkov.dev/graphql'

// 화폐는 "레이드에서 챙겨야 할 아이템"이 아니므로 체크리스트에서 제외.
// API의 types로는 화폐를 구분할 수 없어(루블도 ["noFlea"]뿐) id로 직접 거름.
// 퀘스트 쪽 집계(PrepTab)도 같은 목록을 써야 해서 export — 돈 제출형
// 퀘스트(Buyout 류, 루블 100만 단위)가 목록을 도배하는 것을 막음
export const CURRENCY_IDS = new Set([
  '5449016a4bdc2d6f028b456f', // 루블
  '5696686a4bdc2da3298b456a', // 달러
  '569668774bdc2da2298b4568', // 유로
])

export interface HideoutRequirement {
  stationId: string
  stationName: string // 한국어
  level: number
  item: { id: string; nameKo: string; nameEn: string; iconLink: string | null }
  count: number
}

const QUERY = `{
  ko: hideoutStations(lang: ko) {
    id name
    levels { level itemRequirements { item { id name iconLink } count } }
  }
  en: hideoutStations(lang: en) {
    id
    levels { level itemRequirements { item { id name } count } }
  }
}`

interface RawStation {
  id: string
  name?: string
  levels: {
    level: number
    itemRequirements: {
      item: { id: string; name: string; iconLink?: string | null }
      count: number
    }[]
  }[]
}

function merge(ko: RawStation[], en: RawStation[]): HideoutRequirement[] {
  const enItemName = new Map<string, string>()
  for (const s of en) {
    for (const lv of s.levels) {
      for (const r of lv.itemRequirements) enItemName.set(r.item.id, r.item.name)
    }
  }

  const out: HideoutRequirement[] = []
  for (const s of ko) {
    for (const lv of s.levels) {
      for (const r of lv.itemRequirements) {
        if (CURRENCY_IDS.has(r.item.id)) continue
        out.push({
          stationId: s.id,
          stationName: (s.name ?? '').trim(),
          level: lv.level,
          item: {
            id: r.item.id,
            nameKo: r.item.name.trim(),
            nameEn: (enItemName.get(r.item.id) ?? r.item.name).trim(),
            iconLink: r.item.iconLink ?? null,
          },
          count: r.count,
        })
      }
    }
  }
  return out
}

let cache: Promise<HideoutRequirement[]> | null = null

export function fetchHideoutRequirements(): Promise<HideoutRequirement[]> {
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
