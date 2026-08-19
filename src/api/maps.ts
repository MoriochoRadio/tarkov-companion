// tarkov.dev maps 데이터셋 — 맵 탭에서 첫 진입 시 1회 로드 후 캐시.
// 보스는 mob id 참조라 같은 데이터셋의 mobs에서 이름·초상화를 조인하고,
// 출입 열쇠는 아이템 id라 items 데이터셋에서 이름을 가져온다
import { loadDataset, loadItems, trKo, type Dataset } from './jsonApi'

export interface MapBoss {
  name: string
  spawnChance: number
  portrait: string | null // tarkov.dev imagePortraitLink — 카드 배너용
}

export interface MapExtract {
  id: string
  name: string
  faction: 'pmc' | 'scav' | 'shared'
  // 게임 월드 좌표 (퀘스트 목표와 동일 좌표계 → 같은 makeProjector로 투영, Phase 35).
  // API가 좌표를 안 주면 생략 — 마커는 그릴 수 없고 호출부에서 개수만 안내
  position?: { x: number; z: number }
}

export interface TarkovMap {
  id: string
  name: string
  normalizedName: string // tarkov.dev 딥링크·한글 지도 링크 키
  players: string | null
  raidDuration: number | null
  bosses: MapBoss[]
  extracts: MapExtract[]
  accessKeys: string[]
  accessKeysMinPlayerLevel: number | null
  wiki: string | null
  description: string | null
}

interface RawMapsData {
  maps: Record<string, RawMap>
  mobs: Record<string, { name: string; imagePortraitLink: string | null }>
}

interface RawMap {
  id: string
  name: string // 로케일 키
  normalizedName: string
  players: string | null
  raidDuration: number | null
  bosses: { mob: string; spawnChance: number | null }[]
  extracts: {
    id: string
    name: string
    faction: string | null
    position: { x: number; z: number } | null
  }[]
  accessKeys: string[] // 아이템 id
  accessKeysMinPlayerLevel: number | null
  wiki: string | null
  description: string | null // 로케일 키
}

let mapsCache: Promise<TarkovMap[]> | null = null

export function fetchMaps(): Promise<TarkovMap[]> {
  mapsCache ??= Promise.all([loadDataset<RawMapsData>('maps'), loadItems()])
    .then(([d, items]: [Dataset<RawMapsData>, Awaited<ReturnType<typeof loadItems>>]) =>
      Object.values(d.data.maps).map((m) => ({
        id: m.id,
        name: trKo(d, m.name),
        normalizedName: m.normalizedName,
        players: m.players,
        raidDuration: m.raidDuration,
        bosses: m.bosses.map((b) => ({
          name: trKo(d, d.data.mobs[b.mob]?.name ?? b.mob),
          spawnChance: b.spawnChance ?? 0,
          portrait: d.data.mobs[b.mob]?.imagePortraitLink ?? null,
        })),
        extracts: m.extracts.map((e) => ({
          id: e.id,
          name: trKo(d, e.name),
          faction: (e.faction === 'pmc' || e.faction === 'scav'
            ? e.faction
            : 'shared') as MapExtract['faction'],
          ...(e.position
            ? { position: { x: e.position.x, z: e.position.z } }
            : {}),
        })),
        accessKeys: (m.accessKeys ?? []).map((id) =>
          trKo(items, items.data.items[id]?.name),
        ),
        accessKeysMinPlayerLevel: m.accessKeysMinPlayerLevel,
        wiki: m.wiki,
        description: m.description ? trKo(d, m.description) : null,
      })),
    )
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
