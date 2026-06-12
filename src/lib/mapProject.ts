// 게임 월드 좌표 → 맵 SVG 픽셀 투영 (Phase 26).
// 수식은 the-hideout/tarkov-dev의 leaflet CRS(getCRS/applyRotation)를 실측 이식 —
// 정확성은 scripts/check-map-projection.mjs가 전 좌표(986개) 경계 검사로 검증.
// 메타 출처: maps.json (MIT) — public/maps/map-meta.json으로 발췌 수록

export interface MapLayerMeta {
  name: string
  svgLayer: string
  show: boolean
}

export interface MapMeta {
  svg: string
  transform: [number, number, number, number]
  coordinateRotation: number
  /** [x, z] 쌍 2개 — tarkov-dev getBounds()가 lat/lng로 뒤집어 쓰는 형식 (실측) */
  bounds: [number, number][]
  svgBounds?: [number, number][]
  layers: MapLayerMeta[]
}

export interface MapMetaFile {
  generated: string
  maps: Record<string, MapMeta>
}

// API normalizedName → 수록 SVG 키 (변형 맵은 본 맵 SVG 공유)
export const MAP_ALIAS: Record<string, string> = {
  'night-factory': 'factory',
  'ground-zero-21': 'ground-zero',
  'ground-zero-tutorial': 'ground-zero',
}

let metaCache: Promise<MapMetaFile> | null = null

export function fetchMapMeta(): Promise<MapMetaFile> {
  metaCache ??= fetch(`${import.meta.env.BASE_URL}maps/map-meta.json`)
    .then(async (res) => {
      if (!res.ok) throw new Error(`맵 메타 응답 오류 (HTTP ${res.status})`)
      return (await res.json()) as MapMetaFile
    })
    .catch((err: unknown) => {
      metaCache = null
      throw err
    })
  return metaCache
}

export function metaForNormalizedName(
  file: MapMetaFile,
  normalizedName: string | null,
): MapMeta | null {
  if (!normalizedName) return null
  const key = file.maps[normalizedName]
    ? normalizedName
    : MAP_ALIAS[normalizedName]
  return key ? (file.maps[key] ?? null) : null
}

export interface Projector {
  project: (x: number, z: number) => { px: number; py: number }
  rect: { minX: number; minY: number; w: number; h: number }
}

export function makeProjector(m: MapMeta): Projector {
  const [t0, t1, t2, t3] = m.transform
  const rad = ((m.coordinateRotation ?? 0) * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const project = (x: number, z: number) => {
    const rx = x * cos - z * sin
    const ry = x * sin + z * cos
    return { px: t0 * rx + t1, py: -t2 * ry + t3 }
  }
  const corners = (m.svgBounds ?? m.bounds).map(([x, z]) => project(x, z))
  const xs = corners.map((c) => c.px)
  const ys = corners.map((c) => c.py)
  const minX = Math.min(...xs)
  const minY = Math.min(...ys)
  return {
    project,
    rect: {
      minX,
      minY,
      w: Math.max(...xs) - minX,
      h: Math.max(...ys) - minY,
    },
  }
}
