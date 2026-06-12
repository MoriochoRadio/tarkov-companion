// 맵 마커 투영 검증 (Phase 26) — MapViewer와 같은 수식으로 전 좌표를 투영해
//  1) 맵 경계 사각형 밖으로 나가는 좌표 비율 (수식 오류면 즉시 드러남)
//  2) 유명 목표의 상대 위치(%)를 출력 → 위키 설명과 사람 눈 대조
// 수식 출처: the-hideout/tarkov-dev src/pages/map/index.jsx getCRS/applyRotation 실측
// 사용: node scripts/check-map-projection.mjs
import { readFile } from 'node:fs/promises'

const meta = JSON.parse(await readFile('public/maps/map-meta.json', 'utf8'))

// src/lib/mapProject.ts와 동일해야 함
function projector(m) {
  const [t0, t1, t2, t3] = m.transform
  const rad = ((m.coordinateRotation ?? 0) * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const project = (x, z) => {
    const rx = x * cos - z * sin
    const ry = x * sin + z * cos
    return { px: t0 * rx + t1, py: -t2 * ry + t3 }
  }
  // bounds는 [x, z] 쌍 (tarkov-dev getBounds가 lat/lng로 뒤집는 것 실측)
  const corners = (m.svgBounds ?? m.bounds).map(([x, z]) => project(x, z))
  const minX = Math.min(...corners.map((c) => c.px))
  const maxX = Math.max(...corners.map((c) => c.px))
  const minY = Math.min(...corners.map((c) => c.py))
  const maxY = Math.max(...corners.map((c) => c.py))
  return { project, rect: { minX, maxX, minY, maxY, w: maxX - minX, h: maxY - minY } }
}

const QUERY = `{ maps { id normalizedName } tasks(lang: en) { name objectives {
  id type description maps { id }
  ... on TaskObjectiveItem { zones { map { id } position { x z } } }
  ... on TaskObjectiveMark { zones { map { id } position { x z } } }
  ... on TaskObjectiveQuestItem { zones { map { id } position { x z } } possibleLocations { map { id } positions { x z } } }
  ... on TaskObjectiveShoot { zones { map { id } position { x z } } }
  ... on TaskObjectiveUseItem { zones { map { id } position { x z } } }
  ... on TaskObjectiveBasic { zones { map { id } position { x z } } }
} } }`

const res = await fetch('https://api.tarkov.dev/graphql', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: QUERY }),
})
const json = await res.json()
if (json.errors?.length) throw new Error(json.errors[0].message)

const ALIAS = {
  'night-factory': 'factory',
  'ground-zero-21': 'ground-zero',
  'ground-zero-tutorial': 'ground-zero',
}
const normById = new Map(json.data.maps.map((m) => [m.id, m.normalizedName]))
const metaFor = (mapId) => {
  const norm = normById.get(mapId)
  if (!norm) return null
  const key = meta.maps[norm] ? norm : ALIAS[norm]
  return key ? { key, m: meta.maps[key] } : null
}

// --- 1) 전 좌표 in-bounds 검증 ---
const stats = new Map() // key -> {total, out}
const locsOf = (o) => {
  const out = []
  for (const z of o.zones ?? []) if (z.map && z.position) out.push({ mapId: z.map.id, ...z.position })
  for (const pl of o.possibleLocations ?? [])
    for (const p of pl.positions ?? []) if (pl.map) out.push({ mapId: pl.map.id, ...p })
  return out
}

for (const t of json.data.tasks) {
  for (const o of t.objectives) {
    for (const loc of locsOf(o)) {
      const found = metaFor(loc.mapId)
      if (!found) continue
      const { project, rect } = projector(found.m)
      const { px, py } = project(loc.x, loc.z)
      const margin = Math.max(rect.w, rect.h) * 0.02 // 경계 살짝 밖(부두 등) 허용
      const out =
        px < rect.minX - margin || px > rect.maxX + margin ||
        py < rect.minY - margin || py > rect.maxY + margin
      const s = stats.get(found.key) ?? { total: 0, out: 0 }
      s.total++
      if (out) s.out++
      stats.set(found.key, s)
    }
  }
}
console.log('[1] 좌표 투영 — 맵 경계 밖 비율 (2% 마진):')
let totalAll = 0
let outAll = 0
for (const [k, s] of [...stats.entries()].sort((a, b) => b[1].total - a[1].total)) {
  totalAll += s.total
  outAll += s.out
  console.log(`  ${k.padEnd(18)} ${String(s.total).padStart(4)}개 중 밖 ${s.out}`)
}
console.log(`  합계 ${totalAll}개 중 밖 ${outAll} (${((outAll / totalAll) * 100).toFixed(1)}%)`)

// --- 2) 유명 목표 스폿체크: 상대 위치(좌상단 기준 %) ---
const SPOTS = [
  { map: 'customs', match: /tank|gas station|dorm/i, types: ['mark', 'plantItem', 'visit'] },
  { map: 'factory', match: /./, types: ['mark', 'plantItem'] },
  { map: 'shoreline', match: /resort|pier|villa|antenna/i, types: ['mark', 'plantItem', 'visit'] },
]
console.log('\n[2] 스폿체크 — (가로%, 세로%) 좌상단 기준:')
for (const spot of SPOTS) {
  console.log(`\n■ ${spot.map}`)
  let n = 0
  for (const t of json.data.tasks) {
    for (const o of t.objectives) {
      if (n >= 6) break
      if (!spot.types.includes(o.type)) continue
      if (!spot.match.test(o.description ?? '')) continue
      for (const loc of locsOf(o)) {
        const found = metaFor(loc.mapId)
        if (found?.key !== spot.map) continue
        const { project, rect } = projector(found.m)
        const { px, py } = project(loc.x, loc.z)
        const rx = (((px - rect.minX) / rect.w) * 100).toFixed(0)
        const ry = (((py - rect.minY) / rect.h) * 100).toFixed(0)
        console.log(`  (${rx}%, ${ry}%) [${o.type}] ${t.name}: ${o.description}`)
        n++
        break
      }
    }
  }
}
