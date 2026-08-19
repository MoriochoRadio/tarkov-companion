// 모딩 탭 데이터 — tarkov.dev의 무기/모드 슬롯 호환 데이터.
// GraphQL 시절엔 무기 목록 1회 + "지금 보는 아이템"의 슬롯을 lazy 조회했지만,
// JSON API는 items 데이터셋 한 벌에 슬롯·호환 부품 id가 전부 들어 있어 추가 요청이 없다.
// 슬롯 필드는 무기와 모드(WeaponMod/Barrel/Magazine/Scope) 양쪽에 있어서,
// 같은 함수로 하위 슬롯 드릴다운까지 처리한다.
import {
  loadItems,
  loadTraders,
  slotKey,
  trEn,
  trKo,
  type Dataset,
  type RawItem,
  type RawItemsData,
} from './jsonApi'
import { biName } from './quests'

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

let weaponsCache: Promise<WeaponSummary[]> | null = null

export function fetchWeapons(): Promise<WeaponSummary[]> {
  weaponsCache ??= loadItems()
    .then((d) =>
      Object.values(d.data.items)
        // "M4A1 표준형" 같은 조립 프리셋은 베이스 무기와 중복이라 제외
        .filter((w) => w.types?.includes('gun') && !w.types.includes('preset'))
        .map((w) => {
          const nameKo = trKo(d, w.name)
          const nameEn = trEn(d, w.name)
          const shortName = trKo(d, w.shortName)
          return {
            id: w.id,
            nameKo,
            nameEn,
            shortName,
            displayName: biName(nameKo, nameEn),
            searchKey: `${nameKo} ${nameEn} ${shortName}`.toLowerCase(),
            iconLink: w.iconLink,
            caliber: w.properties?.caliber?.replace(/^Caliber/, '') ?? null,
            ergonomics: w.properties?.ergonomics ?? null,
            recoilVertical: w.properties?.recoilVertical ?? null,
          }
        }),
    )
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

const slotsCache = new Map<string, Promise<ModSlot[]>>()

function buildSlots(
  itemId: string,
  items: Dataset<RawItemsData>,
  traders: Awaited<ReturnType<typeof loadTraders>>,
): ModSlot[] {
  const item: RawItem | undefined = items.data.items[itemId]
  return (item?.properties?.slots ?? []).map((s): ModSlot => {
    // 슬롯 이름은 본문에 nameId(mod_pistol_grip)로만 오고 사전 키는 대문자
    const key = slotKey(s.nameId)
    return {
      id: s.id,
      nameKo: trKo(items, key),
      nameEn: trEn(items, key),
      required: s.required ?? false,
      parts: (s.filters?.allowedItems ?? [])
        .map((pid) => items.data.items[pid])
        .filter((p): p is RawItem => Boolean(p))
        .map((p): ModPart => {
          const nameKo = trKo(items, p.name)
          const nameEn = trEn(items, p.name)
          return {
            id: p.id,
            nameKo,
            nameEn,
            shortName: trKo(items, p.shortName),
            displayName: biName(nameKo, nameEn),
            searchKey: `${nameKo} ${nameEn}`.toLowerCase(),
            iconLink: p.iconLink,
            ergonomics: p.properties?.ergonomics ?? null,
            recoilModifier: p.properties?.recoilModifier ?? null,
            capacity: p.properties?.capacity ?? null,
            hasSubSlots: (p.properties?.slots?.length ?? 0) > 0,
            fleaPrice: p.avg24hPrice,
            offers: (p.buyFromTrader ?? []).map((o) => ({
              trader: trKo(traders, traders.data[o.trader]?.name),
              traderLevel: o.minTraderLevel ?? 1,
              questLocked: o.taskUnlock != null,
              priceRUB: o.priceRUB,
            })),
          }
        }),
    }
  })
}

export function fetchItemSlots(itemId: string): Promise<ModSlot[]> {
  let cached = slotsCache.get(itemId)
  if (cached) return cached

  cached = Promise.all([loadItems(), loadTraders()])
    .then(([items, traders]) => buildSlots(itemId, items, traders))
    .catch((err: unknown) => {
      slotsCache.delete(itemId) // 실패는 캐시하지 않고 재시도 가능하게
      throw err
    })
  slotsCache.set(itemId, cached)
  return cached
}
