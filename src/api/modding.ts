// 모딩 탭 데이터 — tarkov.dev의 무기/모드 슬롯 호환 데이터.
// 전체 호환 트리는 무기당 수천 항목이라 한 번에 받지 않고,
// (1) 무기 목록은 경량 쿼리 1회, (2) 슬롯·부품은 "지금 보는 아이템" 단위로
// lazy 조회 + 캐시 (실측: M4A1 1단계 응답 ~63KB).
// 슬롯 필드는 무기(ItemPropertiesWeapon)와 모드(WeaponMod/Barrel/Magazine/Scope)
// 양쪽에 있어서, 같은 함수로 하위 슬롯 드릴다운까지 처리한다.
import { biName } from './quests'

const ENDPOINT = 'https://api.tarkov.dev/graphql'

async function gql<T>(query: string): Promise<T> {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  })
  if (!res.ok) throw new Error(`tarkov.dev API 응답 오류 (HTTP ${res.status})`)
  const json = (await res.json()) as { data?: T; errors?: { message: string }[] }
  if (json.errors?.length) throw new Error(`tarkov.dev API 오류: ${json.errors[0].message}`)
  if (!json.data) throw new Error('tarkov.dev API가 데이터를 반환하지 않음')
  return json.data
}

// ---------- 무기 목록 ----------

export interface WeaponSummary {
  id: string
  nameKo: string
  nameEn: string
  shortName: string
  displayName: string
  searchKey: string
  iconLink: string | null
  caliber: string | null
  ergonomics: number | null
  recoilVertical: number | null
}

interface RawWeapon {
  id: string
  name: string
  shortName: string
  iconLink: string | null
  types: string[]
  properties: {
    caliber?: string | null
    ergonomics?: number | null
    recoilVertical?: number | null
  } | null
}

const WEAPONS_QUERY = `{
  ko: items(lang: ko, types: gun) {
    id name shortName iconLink types
    properties { ... on ItemPropertiesWeapon { caliber ergonomics recoilVertical } }
  }
  en: items(lang: en, types: gun) { id name }
}`

let weaponsCache: Promise<WeaponSummary[]> | null = null

export function fetchWeapons(): Promise<WeaponSummary[]> {
  weaponsCache ??= gql<{ ko: RawWeapon[]; en: { id: string; name: string }[] }>(
    WEAPONS_QUERY,
  )
    .then((d) => {
      const enName = new Map(d.en.map((w) => [w.id, w.name]))
      return (
        d.ko
          // "M4A1 표준형" 같은 조립 프리셋은 베이스 무기와 중복이라 제외
          .filter((w) => !w.types.includes('preset'))
          .map((w) => {
            const nameKo = w.name.trim()
            const nameEn = (enName.get(w.id) ?? w.name).trim()
            return {
              id: w.id,
              nameKo,
              nameEn,
              shortName: w.shortName,
              displayName: biName(nameKo, nameEn),
              searchKey: `${nameKo} ${nameEn} ${w.shortName}`.toLowerCase(),
              iconLink: w.iconLink,
              caliber: w.properties?.caliber?.replace(/^Caliber/, '') ?? null,
              ergonomics: w.properties?.ergonomics ?? null,
              recoilVertical: w.properties?.recoilVertical ?? null,
            }
          })
      )
    })
    .catch((err: unknown) => {
      weaponsCache = null
      throw err
    })
  return weaponsCache
}

// ---------- 아이템(무기/모드)의 슬롯 + 장착 가능 부품 ----------

export interface ModOffer {
  trader: string
  traderLevel: number
  questLocked: boolean
  priceRUB: number
}

export interface ModPart {
  id: string
  nameKo: string
  nameEn: string
  shortName: string
  displayName: string
  searchKey: string
  iconLink: string | null
  ergonomics: number | null
  recoilModifier: number | null // -0.06 = 수직 반동 -6%
  capacity: number | null // 탄창 장탄수
  hasSubSlots: boolean
  fleaPrice: number | null
  offers: ModOffer[] // 트레이더 오퍼만 (플리는 fleaPrice로 분리)
}

export interface ModSlot {
  id: string
  nameKo: string
  nameEn: string
  required: boolean
  parts: ModPart[]
}

// 모드 속성은 타입별 인라인 프래그먼트가 필요 — 필드 구성은 전부 동일
const MOD_PROP_TYPES = [
  'ItemPropertiesWeaponMod',
  'ItemPropertiesBarrel',
  'ItemPropertiesMagazine',
  'ItemPropertiesScope',
]
const modProps = MOD_PROP_TYPES.map(
  (t) =>
    `... on ${t} { ergonomics recoilModifier ${
      t === 'ItemPropertiesMagazine' ? 'capacity' : ''
    } slots { id } }`,
).join(' ')

const SLOT_FIELDS_KO = `slots {
  id name required
  filters { allowedItems {
    id name shortName iconLink avg24hPrice
    properties { ${modProps} }
    buyFor {
      priceRUB
      vendor { name ... on TraderOffer { trader { name } minTraderLevel taskUnlock { id } } }
    }
  } }
}`
const SLOT_FIELDS_EN = `slots { id name filters { allowedItems { id name } } }`

// 슬롯을 가질 수 있는 속성 타입 전부에 같은 필드를 요청
const slotsOn = (fields: string) =>
  ['ItemPropertiesWeapon', ...MOD_PROP_TYPES]
    .map((t) => `... on ${t} { ${fields} }`)
    .join(' ')

interface RawPart {
  id: string
  name: string
  shortName: string
  iconLink: string | null
  avg24hPrice: number | null
  properties: {
    ergonomics?: number | null
    recoilModifier?: number | null
    capacity?: number | null
    slots?: { id: string }[]
  } | null
  buyFor: {
    priceRUB: number
    vendor: {
      name: string
      trader?: { name: string }
      minTraderLevel?: number | null
      taskUnlock?: { id: string } | null
    }
  }[]
}

interface RawSlots {
  slots?: {
    id: string
    name: string
    required: boolean | null
    filters: { allowedItems: RawPart[] } | null
  }[]
}

const slotsCache = new Map<string, Promise<ModSlot[]>>()

export function fetchItemSlots(itemId: string): Promise<ModSlot[]> {
  const id = itemId.replace(/[^\w-]/g, '') // 쿼리에 끼워 넣으므로 한 번 거름
  let cached = slotsCache.get(id)
  if (cached) return cached

  const query = `{
    ko: item(id: "${id}", lang: ko) { id properties { ${slotsOn(SLOT_FIELDS_KO)} } }
    en: item(id: "${id}", lang: en) { id properties { ${slotsOn(SLOT_FIELDS_EN)} } }
  }`

  cached = gql<{
    ko: { properties: RawSlots | null }
    en: { properties: { slots?: { id: string; name: string; filters: { allowedItems: { id: string; name: string }[] } | null }[] } | null }
  }>(query)
    .then((d) => {
      const enSlotName = new Map<string, string>()
      const enItemName = new Map<string, string>()
      for (const s of d.en.properties?.slots ?? []) {
        enSlotName.set(s.id, s.name)
        for (const i of s.filters?.allowedItems ?? []) enItemName.set(i.id, i.name)
      }
      return (d.ko.properties?.slots ?? []).map((s): ModSlot => ({
        id: s.id,
        nameKo: s.name.trim(),
        nameEn: (enSlotName.get(s.id) ?? s.name).trim(),
        required: s.required ?? false,
        parts: (s.filters?.allowedItems ?? []).map((p): ModPart => {
          const nameKo = p.name.trim()
          const nameEn = (enItemName.get(p.id) ?? p.name).trim()
          return {
            id: p.id,
            nameKo,
            nameEn,
            shortName: p.shortName,
            displayName: biName(nameKo, nameEn),
            searchKey: `${nameKo} ${nameEn}`.toLowerCase(),
            iconLink: p.iconLink,
            ergonomics: p.properties?.ergonomics ?? null,
            recoilModifier: p.properties?.recoilModifier ?? null,
            capacity: p.properties?.capacity ?? null,
            hasSubSlots: (p.properties?.slots?.length ?? 0) > 0,
            fleaPrice: p.avg24hPrice,
            offers: p.buyFor
              .filter((o) => o.vendor.trader)
              .map((o) => ({
                trader: o.vendor.trader!.name,
                traderLevel: o.vendor.minTraderLevel ?? 1,
                questLocked: o.vendor.taskUnlock != null,
                priceRUB: o.priceRUB,
              })),
          }
        }),
      }))
    })
    .catch((err: unknown) => {
      slotsCache.delete(id) // 실패는 캐시하지 않고 재시도 가능하게
      throw err
    })
  slotsCache.set(id, cached)
  return cached
}
