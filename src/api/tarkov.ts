// tarkov.dev 공개 GraphQL API (무료, 키 불필요)
// 방문자 브라우저가 직접 호출 — 서버를 거치지 않음
import {
  DEFAULT_OFFER_RATE,
  DEFAULT_REQUIREMENT_RATE,
} from '../lib/fleaFee'

const ENDPOINT = 'https://api.tarkov.dev/graphql'

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

async function gql<T>(query: string): Promise<T> {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  })
  if (!res.ok) {
    throw new Error(`tarkov.dev API 응답 오류 (HTTP ${res.status})`)
  }
  const json = (await res.json()) as { data?: T; errors?: { message: string }[] }
  if (json.errors?.length) {
    throw new Error(`tarkov.dev API 오류: ${json.errors[0].message}`)
  }
  if (!json.data) {
    throw new Error('tarkov.dev API가 데이터를 반환하지 않음')
  }
  return json.data
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

// 전체 아이템(약 5,000개, 1.3MB)을 한 번만 받아서 세션 동안 재사용.
// 검색·가성비·급등락이 전부 이 캐시를 공유하므로 API 호출은 1번이면 충분.
let itemsCache: Promise<TarkovItem[]> | null = null

export function fetchAllItems(): Promise<TarkovItem[]> {
  itemsCache ??= gql<{
    items: TarkovItem[]
    fleaMarket: { sellOfferFeeRate: number; sellRequirementFeeRate: number }
  }>(
    `{
      items(lang: ko) {
        id name shortName iconLink
        avg24hPrice basePrice changeLast48hPercent
        width height types
      }
      fleaMarket { sellOfferFeeRate sellRequirementFeeRate }
    }`,
  )
    .then((d) => {
      if (d.fleaMarket?.sellOfferFeeRate > 0) {
        fleaRates = {
          offerRate: d.fleaMarket.sellOfferFeeRate,
          requirementRate: d.fleaMarket.sellRequirementFeeRate,
        }
      }
      return d.items
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

// 히어로 인트로의 라이브 지표용 — id만 받아서 개수만 셈.
// 전체 아이템(1.3MB)/퀘스트(3MB) 캐시를 인트로 때문에 당겨 받지 않기 위한 경량 쿼리
let countsCache: Promise<SiteCounts> | null = null

export function fetchCounts(): Promise<SiteCounts> {
  countsCache ??= gql<{ items: { id: string }[]; tasks: { id: string }[] }>(
    `{ items { id } tasks { id } }`,
  )
    .then((d) => ({ items: d.items.length, quests: d.tasks.length }))
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

// 가격 히스토리는 아이템당 별도 조회라 무거움 → 즐겨찾기 아이템에만 사용.
// GraphQL 별칭으로 여러 개를 한 요청에 묶고, 아이템별로 캐시해
// 즐겨찾기를 하나 추가하면 그 아이템만 새로 받아옴
const historyCache = new Map<string, Promise<PricePoint[]>>()
const HISTORY_BATCH = 30 // 한 요청에 묶는 최대 아이템 수 (응답 비대화 방지)

export function fetchPriceHistory(
  ids: string[],
): Promise<Map<string, PricePoint[]>> {
  const missing = [...new Set(ids)].filter((id) => !historyCache.has(id))
  for (let i = 0; i < missing.length; i += HISTORY_BATCH) {
    const batch = missing.slice(i, i + HISTORY_BATCH)
    const fields = batch
      // id는 tarkov.dev가 주는 영숫자 값이지만 쿼리에 끼워 넣으므로 한 번 거름
      .map((id, k) => `h${k}: historicalItemPrices(id: "${id.replace(/[^\w-]/g, '')}", days: 7) { price timestamp }`)
      .join('\n')
    const request = gql<Record<string, PricePoint[]>>(`{ ${fields} }`)
    batch.forEach((id, k) => {
      historyCache.set(
        id,
        request
          .then((d) => d[`h${k}`] ?? [])
          .catch((err: unknown) => {
            historyCache.delete(id)
            throw err
          }),
      )
    })
  }
  return Promise.all(
    ids.map(async (id) => [id, await historyCache.get(id)!] as const),
  ).then((entries) => new Map(entries))
}

let ammoCache: Promise<AmmoInfo[]> | null = null

export function fetchAmmo(): Promise<AmmoInfo[]> {
  ammoCache ??= gql<{ ammo: AmmoInfo[] }>(
    `{
      ammo(lang: ko) {
        item { id name shortName iconLink avg24hPrice }
        caliber damage penetrationPower armorDamage
        fragmentationChance projectileCount
      }
    }`,
  )
    .then((d) => d.ammo)
    .catch((err: unknown) => {
      ammoCache = null
      throw err
    })
  return ammoCache
}
