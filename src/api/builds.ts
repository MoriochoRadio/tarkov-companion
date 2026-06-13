// 추천 빌드 — 정적 시드(public/data/builds.json, scripts/validate-builds.mjs로
// 장착 검증됨)에 tarkov.dev 실시간 시세·스탯을 입혀서 카드로 보여준다.
// 빌드에 등장하는 아이템만 ids로 콕 집어 받으므로 응답이 수십 KB로 가벼움.
import { biName } from './quests'

const ENDPOINT = 'https://api.tarkov.dev/graphql'

export type BuildCategory = 'ar' | 'smg' | 'dmr' | 'shotgun' | 'sniper'

export const CATEGORY_LABELS: Record<BuildCategory, string> = {
  ar: '돌격소총',
  smg: '기관단총',
  dmr: '지정사수',
  shotgun: '샷건',
  sniper: '저격',
}

// 인게임 조립 순서 근사 — 부품 category(normalizedName) 기준 정렬 키.
// 총열→가스블록→총열덮개→총구→장전손잡이→손잡이/개머리판→광학→탄창 순.
// 목록에 없는 분류는 뒤로. 무기 본체는 BuildsView에서 항상 맨 위로 별도 처리.
const SLOT_ORDER: string[] = [
  'barrel',
  'gas-block',
  'handguard',
  'comb-muzzle-device',
  'muzzle-device',
  'muzzle-brake-compensator',
  'flashhider',
  'silencer',
  'charging-handle',
  'receiver',
  'upper-receiver',
  'pistol-grip',
  'stock',
  'foregrip',
  'bipod',
  'mount',
  'scope-mount',
  'scope',
  'assault-scope',
  'special-scope',
  'reflex-sight',
  'compact-reflex-sight',
  'night-vision',
  'tactical-combo-device',
  'flashlight',
  'laser-target-pointer',
  'magazine',
  'auxiliary-parts',
]

export function slotOrder(normalizedName: string | null): number {
  if (!normalizedName) return 90
  const i = SLOT_ORDER.indexOf(normalizedName)
  return i === -1 ? 89 : i
}

export interface BuildDef {
  id: string
  weapon: string
  name: string
  category: BuildCategory
  tier: 1 | 2 | 3 | 4
  parts: string[]
  desc: string
  tags?: string[] // 용도 태그 (근거리/원거리/풀모드/예산형/퀘스트 등) — 필터·칩
  source?: string
}

let buildsCache: Promise<BuildDef[]> | null = null

export function fetchBuilds(): Promise<BuildDef[]> {
  buildsCache ??= fetch(`${import.meta.env.BASE_URL}data/builds.json`)
    .then(async (res) => {
      if (!res.ok) throw new Error(`builds.json 로드 실패 (HTTP ${res.status})`)
      const json = (await res.json()) as { builds: BuildDef[] }
      return json.builds
    })
    .catch((err: unknown) => {
      buildsCache = null
      throw err
    })
  return buildsCache
}

export interface BuildItemInfo {
  id: string
  displayName: string
  searchName: string // 한국어명 — 아이템 검색 이동용
  shortName: string
  slotKo: string | null // 부품 분류 = 슬롯 라벨 (총열·총구·조준경…)
  slotEn: string | null
  slotNorm: string | null // category.normalizedName — 슬롯 정렬 키
  iconLink: string | null
  imageLink: string | null // 512px — 무기 카드 배너용
  presetImageLink: string | null // 기본 프리셋(조립 상태) 이미지 — 배너에 우선 사용
  weight: number
  ergonomics: number | null
  recoilModifier: number | null // 모드: -0.06 = 수직 반동 -6%
  recoilVertical: number | null // 무기 기본 수직 반동
  recoilHorizontal: number | null
  fireRate: number | null
  caliber: string | null
  fleaPrice: number | null
  offers: {
    trader: string
    traderLevel: number
    questLocked: boolean
    priceRUB: number
  }[]
}

interface RawBuildItem {
  id: string
  name: string
  shortName: string
  iconLink: string | null
  image512pxLink: string | null
  weight: number | null
  avg24hPrice: number | null
  category: { name: string; normalizedName: string } | null
  properties: {
    ergonomics?: number | null
    recoilModifier?: number | null
    recoilVertical?: number | null
    recoilHorizontal?: number | null
    fireRate?: number | null
    caliber?: string | null
    defaultPreset?: { image512pxLink: string | null } | null
  } | null
  buyFor: {
    priceRUB: number
    vendor: {
      trader?: { name: string }
      minTraderLevel?: number | null
      taskUnlock?: { id: string } | null
    }
  }[]
}

let itemsCache: Promise<Map<string, BuildItemInfo>> | null = null

// 빌드에 등장하는 전체 아이템(무기+부품)을 한 요청으로 — ko/en 별칭 병기
export function fetchBuildItems(ids: string[]): Promise<Map<string, BuildItemInfo>> {
  itemsCache ??= (async () => {
    const idList = [...new Set(ids)]
      .map((id) => `"${id.replace(/[^\w-]/g, '')}"`)
      .join(',')
    const query = `{
      ko: items(ids: [${idList}], lang: ko) {
        id name shortName iconLink image512pxLink weight avg24hPrice
        category { name normalizedName }
        properties {
          ... on ItemPropertiesWeapon {
            ergonomics recoilVertical recoilHorizontal fireRate caliber
            defaultPreset { image512pxLink }
          }
          ... on ItemPropertiesWeaponMod { ergonomics recoilModifier }
          ... on ItemPropertiesBarrel { ergonomics recoilModifier }
          ... on ItemPropertiesMagazine { ergonomics recoilModifier }
          ... on ItemPropertiesScope { ergonomics recoilModifier }
        }
        buyFor {
          priceRUB
          vendor { ... on TraderOffer { trader { name } minTraderLevel taskUnlock { id } } }
        }
      }
      en: items(ids: [${idList}]) { id name category { name } }
    }`
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
    })
    if (!res.ok) throw new Error(`tarkov.dev API 응답 오류 (HTTP ${res.status})`)
    const json = (await res.json()) as {
      data?: {
        ko: RawBuildItem[]
        en: { id: string; name: string; category: { name: string } | null }[]
      }
      errors?: { message: string }[]
    }
    if (json.errors?.length) throw new Error(`tarkov.dev API 오류: ${json.errors[0].message}`)
    if (!json.data) throw new Error('tarkov.dev API가 데이터를 반환하지 않음')

    const enName = new Map(json.data.en.map((i) => [i.id, i.name]))
    const enCat = new Map(json.data.en.map((i) => [i.id, i.category?.name ?? null]))
    return new Map(
      json.data.ko.map((i) => [
        i.id,
        {
          id: i.id,
          displayName: biName(i.name.trim(), (enName.get(i.id) ?? i.name).trim()),
          searchName: i.name.trim(),
          shortName: i.shortName,
          slotKo: i.category?.name ?? null,
          slotEn: enCat.get(i.id) ?? i.category?.name ?? null,
          slotNorm: i.category?.normalizedName ?? null,
          iconLink: i.iconLink,
          imageLink: i.image512pxLink,
          presetImageLink: i.properties?.defaultPreset?.image512pxLink ?? null,
          weight: i.weight ?? 0,
          ergonomics: i.properties?.ergonomics ?? null,
          recoilModifier: i.properties?.recoilModifier ?? null,
          recoilVertical: i.properties?.recoilVertical ?? null,
          recoilHorizontal: i.properties?.recoilHorizontal ?? null,
          fireRate: i.properties?.fireRate ?? null,
          caliber: i.properties?.caliber?.replace(/^Caliber/, '') ?? null,
          fleaPrice: i.avg24hPrice,
          offers: i.buyFor
            .filter((o) => o.vendor.trader)
            .map((o) => ({
              trader: o.vendor.trader!.name,
              traderLevel: o.vendor.minTraderLevel ?? 1,
              questLocked: o.vendor.taskUnlock != null,
              priceRUB: o.priceRUB,
            })),
        },
      ]),
    )
  })().catch((err: unknown) => {
    itemsCache = null
    throw err
  })
  return itemsCache
}
