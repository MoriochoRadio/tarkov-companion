// 맵 SVG + 좌표 변환 메타 수집 (저작 도구 — Phase 26, 게임 대격변 시 재실행)
// 출처: the-hideout/tarkov-dev (maps.json, MIT) + tarkov-dev-svg-maps (SVG, CC BY-NC-SA 4.0)
// 산출: public/maps/{key}.svg (svgo 최적화) + public/maps/map-meta.json + LICENSE.md 갱신
// 사용: node scripts/fetch-map-assets.mjs
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { optimize } from 'svgo'

const MAPS_JSON_URL =
  'https://raw.githubusercontent.com/the-hideout/tarkov-dev/main/src/data/maps.json'
const OUT_DIR = 'public/maps'

await mkdir(OUT_DIR, { recursive: true })

const res = await fetch(MAPS_JSON_URL)
if (!res.ok) throw new Error(`maps.json 다운로드 실패: HTTP ${res.status}`)
const mapsJson = await res.json()

const meta = {
  generated: new Date().toISOString().slice(0, 10),
  source: {
    meta: 'https://github.com/the-hideout/tarkov-dev (src/data/maps.json, MIT)',
    svg: 'https://github.com/the-hideout/tarkov-dev-svg-maps (CC BY-NC-SA 4.0)',
  },
  maps: {},
}

const files = []
for (const entry of mapsJson) {
  const iv = (entry.maps ?? []).find((v) => v.projection === 'interactive')
  if (!iv?.svgPath || !iv.transform || !iv.bounds) continue
  const key = entry.normalizedName
  console.log(`${key} ← ${iv.svgPath}`)
  const svgRes = await fetch(iv.svgPath)
  if (!svgRes.ok) {
    console.warn(`  ! SVG 실패 (HTTP ${svgRes.status}) — 건너뜀`)
    continue
  }
  const raw = await svgRes.text()
  // svgo v4: viewBox는 기본 보존. 층 토글이 g[id]에 의존하므로 id 정리만 끔
  const optimized = optimize(raw, {
    multipass: true,
    plugins: [
      {
        name: 'preset-default',
        params: { overrides: { cleanupIds: false } },
      },
    ],
  }).data
  await writeFile(`${OUT_DIR}/${key}.svg`, optimized)
  console.log(
    `  ${(raw.length / 1024).toFixed(0)}KB → ${(optimized.length / 1024).toFixed(0)}KB`,
  )
  files.push(key)
  meta.maps[key] = {
    svg: `${key}.svg`,
    transform: iv.transform,
    coordinateRotation: iv.coordinateRotation ?? 0,
    // bounds/svgBounds는 [x, z] 쌍 — tarkov-dev getBounds()가 lat/lng로 뒤집어 씀 (실측)
    bounds: iv.bounds,
    ...(iv.svgBounds ? { svgBounds: iv.svgBounds } : {}),
    layers: (iv.layers ?? [])
      .filter((l) => l.svgLayer)
      .map((l) => ({ name: l.name, svgLayer: l.svgLayer, show: l.show === true })),
  }
}

await writeFile(`${OUT_DIR}/map-meta.json`, JSON.stringify(meta, null, 1))

// LICENSE.md — 수록 에셋의 출처·라이선스 명시 (양보 불가 조건)
const license = `# public/maps 에셋 출처와 라이선스

이 디렉터리의 맵 SVG는 Escape From Tarkov 커뮤니티가 제작한 오픈 에셋입니다.

- **SVG 지도** (${files.map((f) => `\`${f}.svg\``).join(', ')})
  - 출처: [the-hideout/tarkov-dev-svg-maps](https://github.com/the-hideout/tarkov-dev-svg-maps) — tarkov.dev 인터랙티브 맵의 원본 (The Hideout 커뮤니티 제작)
  - 라이선스: [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/) — 출처 표기 · **비상업** · 동일조건변경허락
  - 본 저장소는 svgo 무손실 최적화 외에 파일을 수정하지 않으며, 퀘스트 마커는
    런타임 오버레이로만 그려 파생 파일을 만들지 않습니다
- **좌표 변환 메타** (\`map-meta.json\`)
  - 출처: [the-hideout/tarkov-dev](https://github.com/the-hideout/tarkov-dev) \`src/data/maps.json\` (MIT) — transform·rotation·bounds·층 정의 발췌
  - 수집일: ${meta.generated} (\`scripts/fetch-map-assets.mjs\`)

**비상업 조건 준수 선언**: 본 사이트(Tarkov Companion)는 광고·후원·유료 기능이
없는 비상업 팬 프로젝트이며, 이 에셋을 사용하는 동안에는 상업화하지 않습니다.
원 라이선스의 안티치트 조항에 따라 치트·레이더·ESP 용도 사용을 금지합니다.
`
await writeFile(`${OUT_DIR}/LICENSE.md`, license)
console.log(`\n완료: ${files.length}개 맵, meta + LICENSE.md 작성`)

// 참고: 기존 LICENSE 확인용
try {
  await readFile(`${OUT_DIR}/LICENSE.md`)
} catch {
  /* noop */
}
