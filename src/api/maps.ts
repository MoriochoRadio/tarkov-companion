// tarkov.dev maps 쿼리 — 맵 탭에서 첫 진입 시 1회 로드 후 캐시
const ENDPOINT = 'https://api.tarkov.dev/graphql'

export interface MapBoss {
  name: string
  spawnChance: number
  portrait: string | null // tarkov.dev imagePortraitLink — 카드 배너용
}

export interface TarkovMap {
  id: string
  name: string
  normalizedName: string // tarkov.dev 딥링크·한글 지도 링크 키
  players: string | null
  raidDuration: number | null
  bosses: MapBoss[]
  accessKeys: string[]
  accessKeysMinPlayerLevel: number | null
  wiki: string | null
  description: string | null
}

interface RawMap {
  id: string
  name: string
  normalizedName: string
  players: string | null
  raidDuration: number | null
  bosses: {
    boss: { name: string; imagePortraitLink: string | null }
    spawnChance: number | null
  }[]
  accessKeys: { name: string }[]
  accessKeysMinPlayerLevel: number | null
  wiki: string | null
  description: string | null
}

let mapsCache: Promise<TarkovMap[]> | null = null

export function fetchMaps(): Promise<TarkovMap[]> {
  mapsCache ??= fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: `{
        maps(lang: ko) {
          id name normalizedName players raidDuration
          bosses { boss { name imagePortraitLink } spawnChance }
          accessKeys { name } accessKeysMinPlayerLevel
          wiki description
        }
      }`,
    }),
  })
    .then(async (res) => {
      if (!res.ok) throw new Error(`tarkov.dev API 응답 오류 (HTTP ${res.status})`)
      const json = (await res.json()) as {
        data?: { maps: RawMap[] }
        errors?: { message: string }[]
      }
      if (json.errors?.length) throw new Error(json.errors[0].message)
      if (!json.data) throw new Error('tarkov.dev API가 데이터를 반환하지 않음')
      return json.data.maps.map((m) => ({
        id: m.id,
        name: m.name,
        normalizedName: m.normalizedName,
        players: m.players,
        raidDuration: m.raidDuration,
        bosses: m.bosses.map((b) => ({
          name: b.boss.name,
          spawnChance: b.spawnChance ?? 0,
          portrait: b.boss.imagePortraitLink,
        })),
        accessKeys: m.accessKeys.map((k) => k.name),
        accessKeysMinPlayerLevel: m.accessKeysMinPlayerLevel,
        wiki: m.wiki,
        description: m.description,
      }))
    })
    .catch((err: unknown) => {
      mapsCache = null
      throw err
    })
  return mapsCache
}

// 한글 지도 모음 링크 — public/data/map-links.json (저장소 주인이 직접 관리)
export interface MapLink {
  label: string
  url: string
}

let linksCache: Promise<Record<string, MapLink[]>> | null = null

export function fetchMapLinks(): Promise<Record<string, MapLink[]>> {
  linksCache ??= fetch(`${import.meta.env.BASE_URL}data/map-links.json`)
    .then(async (res) => {
      if (!res.ok) return {}
      const json = (await res.json()) as Record<string, MapLink[] | string>
      // "_comment" 등 메타 필드 제거
      const out: Record<string, MapLink[]> = {}
      for (const [k, v] of Object.entries(json)) {
        if (Array.isArray(v)) out[k] = v
      }
      return out
    })
    .catch(() => ({}) as Record<string, MapLink[]>)
  return linksCache
}
