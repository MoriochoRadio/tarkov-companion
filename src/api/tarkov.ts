// tarkov.dev 공개 JSON API (무료, 키 불필요) — 방문자 브라우저가 직접 호출
// GraphQL 장기 장애로 json.tarkov.dev로 이전 (이유·차이는 jsonApi.ts 주석 참고)
import {
  DEFAULT_OFFER_RATE,
  DEFAULT_REQUIREMENT_RATE,
} from '../lib/fleaFee'
import {
  loadDataset,
  loadItems,
  loadPriceHistory,
  trKo,
  type RawItem,
} from './jsonApi'

export interface TarkovItem {
  id: string
  name: string
  shortName: string
  iconLink: string | null
  avg24hPrice: number | null
  basePrice: number // 수수료 공식의 기준가
  changeLast48hPercent: number | null
  width: number
  height: number
  types: string[] // 'keys', 'ammo', 'noFlea' 등 카테고리 태그
}

export interface AmmoInfo {
  item: {
    id: string
    name: string
    shortName: string
    iconLink: string | null
    avg24hPrice: number | null
  }
  caliber: string | null
  damage: number
  penetrationPower: number
  armorDamage: number
  fragmentationChance: number | null
  projectileCount: number | null
}

// 플리마켓 세율(Ti/Tr) — 기본값은 1.0 기준 0.03이지만, 패치로 바뀔 수 있어
// 아이템 응답에 끼워 실시간 값을 받아 둠 (추가 요청 없음).
// 수수료 표시는 아이템 데이터가 있어야만 일어나므로 이 시점엔 항상 채워져 있음
let fleaRates = {
  offerRate: DEFAULT_OFFER_RATE,
  requirementRate: DEFAULT_REQUIREMENT_RATE,
}

export function getFleaRates(): typeof fleaRates {
  return fleaRates
}

// 전체 아이템(약 5,300개)을 한 번만 받아서 세션 동안 재사용.
// 검색·가성비·급등락·열쇠·모딩·빌드·돈벌이가 전부 이 데이터셋 캐시를 공유하므로
// 네트워크 요청은 1번이면 충분하다 (JSON API는 필드 선택이 안 돼 전량 수신 — gzip 약 1.9MB)
let itemsCache: Promise<TarkovItem[]> | null = null

export function fetchAllItems(): Promise<TarkovItem[]> {
  itemsCache ??= loadItems()
    .then((d) => {
      if (d.data.fleaMarket?.sellOfferFeeRate > 0) {
        fleaRates = {
          offerRate: d.data.fleaMarket.sellOfferFeeRate,
          requirementRate: d.data.fleaMarket.sellRequirementFeeRate,
        }
      }
      return Object.values(d.data.items).map((i: RawItem) => ({
        id: i.id,
        name: trKo(d, i.name),
        shortName: trKo(d, i.shortName),
        iconLink: i.iconLink,
        avg24hPrice: i.avg24hPrice,
        basePrice: i.basePrice,
        changeLast48hPercent: i.changeLast48hPercent,
        width: i.width,
        height: i.height,
        types: i.types ?? [],
      }))
    })
    .catch((err: unknown) => {
      itemsCache = null // 실패한 요청은 캐시하지 않고 다음에 재시도
      throw err
    })
  return itemsCache
}

export interface SiteCounts {
  items: number
  quests: number
}

// 히어로 인트로의 라이브 지표용. GraphQL 시절엔 id만 받는 경량 쿼리였지만
// JSON API엔 필드 선택이 없어 아이템/퀘스트 데이터셋을 그대로 쓴다.
// 낭비는 아님 — 둘 다 사이트 진입 직후 시세·퀘스트 탭이 곧바로 쓰는 캐시라 선행 로드가 된다
let countsCache: Promise<SiteCounts> | null = null

export function fetchCounts(): Promise<SiteCounts> {
  countsCache ??= Promise.all([
    loadItems(),
    loadDataset<{ tasks: Record<string, unknown> }>('tasks'),
  ])
    .then(([items, tasks]) => ({
      items: Object.keys(items.data.items).length,
      quests: Object.keys(tasks.data.tasks).length,
    }))
    .catch((err: unknown) => {
      countsCache = null
      throw err
    })
  return countsCache
}

export interface PricePoint {
  price: number
  timestamp: string // epoch ms 문자열
}

// 가격 히스토리는 아이템당 별도 요청(전 구간 응답, 약 40KB gzip)이라 무거움 →
// 즐겨찾기 아이템에만 사용하고 아이템별로 캐시한다.
// GraphQL 시절엔 여러 개를 한 요청에 묶었지만 JSON API는 아이템당 1건이라 병렬 호출로 바꿈
const historyCache = new Map<string, Promise<PricePoint[]>>()
const HISTORY_DAYS = 7

export function fetchPriceHistory(
  ids: string[],
): Promise<Map<string, PricePoint[]>> {
  for (const id of new Set(ids)) {
    if (historyCache.has(id)) continue
    historyCache.set(
      id,
      loadPriceHistory(id)
        .then((points) => {
          const since = Date.now() - HISTORY_DAYS * 86_400_000
          return points
            .filter((p) => p.timestamp >= since)
            .map((p) => ({ price: p.price, timestamp: String(p.timestamp) }))
        })
        .catch((err: unknown) => {
          historyCache.delete(id)
          throw err
        }),
    )
  }
  return Promise.all(
    ids.map(async (id) => [id, await historyCache.get(id)!] as const),
  ).then((entries) => new Map(entries))
}

let ammoCache: Promise<AmmoInfo[]> | null = null

export function fetchAmmo(): Promise<AmmoInfo[]> {
  // 탄약은 별도 엔드포인트가 없고 items 데이터셋 안에 속성으로 들어 있다.
  // types에 'ammo'가 붙은 것엔 수류탄도 섞여 있어 propertiesType으로 거른다
  ammoCache ??= loadItems()
    .then((d) =>
      Object.values(d.data.items)
        .filter((i) => i.properties?.propertiesType === 'ItemPropertiesAmmo')
        .map((i) => ({
          item: {
            id: i.id,
            name: trKo(d, i.name),
            shortName: trKo(d, i.shortName),
            iconLink: i.iconLink,
            avg24hPrice: i.avg24hPrice,
          },
          caliber: i.properties?.caliber ?? null,
          damage: i.properties?.damage ?? 0,
          penetrationPower: i.properties?.penetrationPower ?? 0,
          armorDamage: i.properties?.armorDamage ?? 0,
          fragmentationChance: i.properties?.fragmentationChance ?? null,
          projectileCount: i.properties?.projectileCount ?? null,
        })),
    )
    .catch((err: unknown) => {
      ammoCache = null
      throw err
    })
  return ammoCache
}
