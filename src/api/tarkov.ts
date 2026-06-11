// tarkov.dev 공개 GraphQL API (무료, 키 불필요)
// 방문자 브라우저가 직접 호출 — 서버를 거치지 않음
const ENDPOINT = 'https://api.tarkov.dev/graphql'

export interface TarkovItem {
  id: string
  name: string
  shortName: string
  iconLink: string | null
  avg24hPrice: number | null
  changeLast48hPercent: number | null
  width: number
  height: number
  types: string[] // 'keys', 'ammo', 'meds' 등 카테고리 태그
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

// 전체 아이템(약 5,000개, 1.3MB)을 한 번만 받아서 세션 동안 재사용.
// 검색·가성비·급등락이 전부 이 캐시를 공유하므로 API 호출은 1번이면 충분.
let itemsCache: Promise<TarkovItem[]> | null = null

export function fetchAllItems(): Promise<TarkovItem[]> {
  itemsCache ??= gql<{ items: TarkovItem[] }>(
    `{
      items(lang: ko) {
        id name shortName iconLink
        avg24hPrice changeLast48hPercent
        width height types
      }
    }`,
  )
    .then((d) => d.items)
    .catch((err: unknown) => {
      itemsCache = null // 실패한 요청은 캐시하지 않고 다음에 재시도
      throw err
    })
  return itemsCache
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
