// tarkov.dev hideout 데이터셋 — 스테이션·레벨별 건설 요구 (준비물 탭용).
// 스테이션 이름은 hideout 로케일, 아이템 이름은 items 데이터셋에서 한/영 병기로 조인한다.
// "은신처 뷰"(인게임풍 스테이션 카드)와 통합 체크리스트 집계가 같은 캐시를 공유
import { loadDataset, loadItems, loadTraders, trEn, trKo } from './jsonApi'

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
  // fir: 1.0부터 은신처 요구도 일부는 레이드 획득(FIR)만 인정됨
  items: { item: HideoutItemRef; count: number; isCurrency: boolean; fir: boolean }[]
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
  fir: boolean
}

interface RawStation {
  id: string
  name: string // 로케일 키
  imageLink: string | null
  levels: {
    level: number
    constructionTime: number | null
    itemRequirements: {
      item: string
      count: number
      attributes?: { foundInRaid?: boolean } | null
    }[]
    stationLevelRequirements?: { station: string; level: number }[] | null
    skillRequirements?: { skill: string; level: number }[] | null
    traderRequirements?: { trader: string; value: number }[] | null
  }[]
}

let cache: Promise<HideoutStation[]> | null = null

export function fetchHideoutStations(): Promise<HideoutStation[]> {
  cache ??= Promise.all([
    loadDataset<Record<string, RawStation>>('hideout'),
    loadItems(),
    loadTraders(),
  ])
    .then(([hideout, items, traders]) =>
      Object.values(hideout.data).map((s) => ({
        id: s.id,
        name: trKo(hideout, s.name),
        imageLink: s.imageLink ?? null,
        levels: s.levels
          .map((lv) => ({
            level: lv.level,
            constructionTime: lv.constructionTime ?? 0,
            items: lv.itemRequirements.map((r) => {
              const item = items.data.items[r.item]
              return {
                item: {
                  id: r.item,
                  nameKo: trKo(items, item?.name),
                  nameEn: trEn(items, item?.name),
                  iconLink: item?.iconLink ?? null,
                },
                count: r.count,
                isCurrency: CURRENCY_IDS.has(r.item),
                fir: r.attributes?.foundInRaid === true,
              }
            }),
            stationRequirements: (lv.stationLevelRequirements ?? []).map((r) => ({
              stationId: r.station,
              name: trKo(hideout, hideout.data[r.station]?.name),
              level: r.level,
            })),
            // 스킬은 로케일 사전에 없는 내부 enum(HideoutManagement 등)이 그대로 온다 —
            // GraphQL 시절에도 같은 값이었으므로 표시 방식은 그대로 유지
            skillRequirements: (lv.skillRequirements ?? []).map((r) => ({
              name: r.skill,
              level: r.level,
            })),
            traderRequirements: (lv.traderRequirements ?? []).map((r) => ({
              name: trKo(traders, traders.data[r.trader]?.name),
              level: r.value,
            })),
          }))
          .sort((a, b) => a.level - b.level),
      })),
    )
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
          fir: r.fir,
        })
      }
    }
  }
  return out
}
