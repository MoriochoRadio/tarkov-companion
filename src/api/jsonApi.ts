// tarkov.dev JSON API(json.tarkov.dev) 클라이언트 — 데이터셋 1회 로드 + 로케일 병합
//
// 왜 GraphQL을 버렸나: api.tarkov.dev/graphql이 2026-08-02부터 계속 죽어 있다
// (upstream the-hideout/tarkov-api#474, 응답 422 "GraphQL server unavailable").
// tarkov.dev 본 사이트도 GraphQL이 아니라 이 JSON API를 쓰고 있어서 살아 있다.
// 무료·키 불필요·브라우저 직접 호출이라는 제약은 그대로 만족한다.
//
// GraphQL과 다른 점 3가지 (아래 모든 api 모듈이 이 차이를 흡수한다):
//  1. 필드 선택 불가 — 데이터셋을 통째로 받는다 (items는 gzip 약 1.9MB)
//  2. 참조가 전부 id — 아이템·트레이더·맵·스테이션은 id만 오고, 데이터셋끼리 조인해야 함
//  3. 이름이 본문에 없음 — 본문엔 "<id> Name" 같은 로케일 키가 들어 있고,
//     `<데이터셋>_<lang>` 사전을 따로 받아 치환한다. 한/영 병기라 ko·en 둘 다 받음
const BASE = 'https://json.tarkov.dev'
const MODE = 'regular' // 게임 모드: regular | pve | pvp-season

export type Locale = Record<string, string>

export interface Dataset<T> {
  data: T
  ko: Locale
  en: Locale
}

// 로케일 사전이 없는 데이터셋 (endpoints의 translations: false)
const NO_LOCALE = new Set(['barters', 'crafts'])

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}/${path}`)
  if (!res.ok) {
    throw new Error(`tarkov.dev 데이터 응답 오류 (HTTP ${res.status})`)
  }
  return (await res.json()) as T
}

export type DatasetName =
  | 'items'
  | 'tasks'
  | 'maps'
  | 'hideout'
  | 'traders'
  | 'barters'
  | 'crafts'

// 데이터셋별 1회 로드 캐시 — 여러 탭이 같은 데이터셋(특히 items)을 공유한다.
// 실패한 약속은 캐시에서 지워 다음 시도 때 다시 받게 한다 (기존 GraphQL 모듈과 동일 정책)
const cache = new Map<DatasetName, Promise<Dataset<unknown>>>()

export function loadDataset<T>(name: DatasetName): Promise<Dataset<T>> {
  let hit = cache.get(name)
  if (!hit) {
    const path = `${MODE}/${name}`
    hit = (async (): Promise<Dataset<unknown>> => {
      if (NO_LOCALE.has(name)) {
        const body = await getJson<{ data: unknown }>(path)
        return { data: body.data, ko: {}, en: {} }
      }
      // 본문·ko·en을 동시에 — 셋 다 CDN 캐시라 병렬이 이득
      const [body, ko, en] = await Promise.all([
        getJson<{ data: unknown }>(path),
        getJson<{ data: Locale }>(`${path}_ko`),
        getJson<{ data: Locale }>(`${path}_en`),
      ])
      return { data: body.data, ko: ko.data, en: en.data }
    })()
    cache.set(name, hit)
    hit.catch(() => cache.delete(name))
  }
  return hit as Promise<Dataset<T>>
}

// 로케일 치환 — 사전에 없으면 영어, 그것도 없으면 키 그대로 (upstream tarkov-dev와 같은 정책).
// 키가 그대로 노출되는 건 미번역 신규 아이템 정도이며 화면은 계속 동작한다
export function trKo(d: Dataset<unknown>, key: string | null | undefined): string {
  if (!key) return ''
  return (d.ko[key] ?? d.en[key] ?? key).trim()
}

export function trEn(d: Dataset<unknown>, key: string | null | undefined): string {
  if (!key) return ''
  return (d.en[key] ?? d.ko[key] ?? key).trim()
}

// 슬롯 이름은 본문에 nameId(mod_pistol_grip)로만 오고, 사전 키는 대문자(MOD_PISTOL_GRIP)
export function slotKey(nameId: string | null | undefined): string {
  return (nameId ?? '').toUpperCase()
}

// 플리 시세 히스토리 — 아이템 단위 별도 엔드포인트. 전 구간을 주므로 호출부에서 자른다.
// 플리 미거래 아이템(루블 등)은 404 → 빈 배열
export interface RawPricePoint {
  price: number
  priceMin: number
  timestamp: number
}

export async function loadPriceHistory(id: string): Promise<RawPricePoint[]> {
  const res = await fetch(`${BASE}/${MODE}/prices/${encodeURIComponent(id)}`)
  if (res.status === 404) return []
  if (!res.ok) throw new Error(`tarkov.dev 시세 응답 오류 (HTTP ${res.status})`)
  const body = (await res.json()) as { data?: RawPricePoint[] }
  return body.data ?? []
}

// ---------- items 데이터셋 원본 타입 ----------
// 여러 탭(시세·열쇠·모딩·빌드·돈벌이·FIR)이 이 한 벌을 공유한다.
// 필요한 필드만 선언 — 실제 응답엔 이보다 훨씬 많은 필드가 들어 있다

export interface RawTraderOffer {
  trader: string // 트레이더 id
  priceRUB: number
  minTraderLevel: number | null
  taskUnlock: string | null // 퀘스트 id
}

export interface RawItemProperties {
  propertiesType?: string
  // 무기
  caliber?: string | null
  ergonomics?: number | null
  recoilVertical?: number | null
  recoilHorizontal?: number | null
  fireRate?: number | null
  defaultPreset?: string | null // 아이템 id
  // 모드
  recoilModifier?: number | null
  capacity?: number | null
  // 열쇠
  uses?: number | null
  // 탄약
  damage?: number
  penetrationPower?: number
  armorDamage?: number
  fragmentationChance?: number | null
  projectileCount?: number | null
  // 무기·모드 공통
  slots?: RawSlot[]
}

export interface RawSlot {
  id: string
  nameId: string
  required: boolean | null
  filters: { allowedItems: string[] } | null // 아이템 id 배열
}

export interface RawItem {
  id: string
  name: string // 로케일 키
  shortName: string // 로케일 키
  normalizedName: string
  basePrice: number
  avg24hPrice: number | null
  changeLast48hPercent: number | null
  width: number
  height: number
  weight: number | null
  types: string[]
  iconLink: string | null
  image512pxLink: string | null
  categories: string[] // 카테고리 id — [0]이 가장 구체적인 분류
  properties: RawItemProperties | null
  buyFromTrader: RawTraderOffer[]
}

export interface RawCategory {
  id: string
  name: string // 로케일 키
  normalizedName: string
}

export interface RawItemsData {
  items: Record<string, RawItem>
  itemCategories: Record<string, RawCategory>
  fleaMarket: { sellOfferFeeRate: number; sellRequirementFeeRate: number }
}

export function loadItems(): Promise<Dataset<RawItemsData>> {
  return loadDataset<RawItemsData>('items')
}

// 트레이더는 이름 조인용으로만 쓰여 아주 가볍다 (약 50KB)
export interface RawTrader {
  id: string
  name: string // 로케일 키
  normalizedName: string
  imageLink: string | null
}

export function loadTraders(): Promise<Dataset<Record<string, RawTrader>>> {
  return loadDataset<Record<string, RawTrader>>('traders')
}
