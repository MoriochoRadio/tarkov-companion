// 추천 빌드 검증 — public/data/builds.json의 모든 부품이 실제로 그 무기에
// 장착 가능한지 tarkov.dev slots 데이터로 확인한다.
//
// 장착 가능 판정(연쇄 허용): 부품 X는 아래 중 하나의 슬롯 allowedItems에
// 들어 있으면 통과 —
//   (1) 무기 자체의 슬롯
//   (2) 같은 빌드의 다른 부품의 슬롯 (예: 마운트 위 도트)
//   (3) 무기 "기본 프리셋"에 포함된 부품의 슬롯 (예: 기본 핸드가드 위 포어그립)
// 추가로 "티어에서 현금 구매 가능한가"를 경고로 알려준다 (플리 폴백 허용).
//
// 사용: node scripts/validate-builds.mjs   (빌드 수정·추가 후 반드시 실행)
import { readFile } from 'node:fs/promises'

const ENDPOINT = 'https://api.tarkov.dev/graphql'
const CHUNK = 40

const file = JSON.parse(
  await readFile(new URL('../public/data/builds.json', import.meta.url), 'utf8'),
)
const builds = file.builds

const SLOT_TYPES = [
  'ItemPropertiesWeapon',
  'ItemPropertiesWeaponMod',
  'ItemPropertiesBarrel',
  'ItemPropertiesMagazine',
  'ItemPropertiesScope',
]
const propsFragment = SLOT_TYPES.map(
  (t) =>
    `... on ${t} { slots { filters { allowedItems { id } } } ${
      t === 'ItemPropertiesWeapon' ? 'defaultPreset { containsItems { item { id } } }' : ''
    } }`,
).join(' ')

async function fetchItems(ids) {
  const out = new Map()
  for (let i = 0; i < ids.length; i += CHUNK) {
    const batch = ids.slice(i, i + CHUNK)
    const query = `{ ${batch
      .map(
        (id, k) =>
          `i${k}: item(id: "${id.replace(/[^\w-]/g, '')}") {
            id name
            properties { ${propsFragment} }
            buyFor { priceRUB vendor { name ... on TraderOffer { trader { name } minTraderLevel taskUnlock { id } } } }
          }`,
      )
      .join(' ')} }`
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
    }).then((r) => r.json())
    if (res.errors) {
      // 존재하지 않는 id가 섞이면 해당 항목만 null — 메시지로 골라낸다
      for (const e of res.errors) console.error(`API 오류: ${e.message}`)
    }
    batch.forEach((id, k) => {
      const item = res.data?.[`i${k}`]
      if (item) out.set(id, item)
    })
  }
  return out
}

// 1차: 빌드에 등장하는 모든 아이템
const allIds = [...new Set(builds.flatMap((b) => [b.weapon, ...b.parts]))]
const items = await fetchItems(allIds)

// 2차: 무기 기본 프리셋에 포함된 부품 중 아직 안 받은 것 (슬롯 연쇄용)
const presetIds = new Set()
for (const b of builds) {
  const w = items.get(b.weapon)
  for (const c of w?.properties?.defaultPreset?.containsItems ?? []) {
    if (!items.has(c.item.id)) presetIds.add(c.item.id)
  }
}
if (presetIds.size > 0) {
  for (const [id, item] of await fetchItems([...presetIds])) items.set(id, item)
}

const slotAllowed = (item) =>
  (item?.properties?.slots ?? []).flatMap(
    (s) => s.filters?.allowedItems.map((a) => a.id) ?? [],
  )

let failures = 0
let warnings = 0

for (const b of builds) {
  const weapon = items.get(b.weapon)
  const problems = []
  const warns = []

  if (!weapon) {
    console.error(`✗ ${b.id}: 무기 id가 API에 없음 (${b.weapon})`)
    failures++
    continue
  }

  // 장착 허용 집합: 무기 + 기본 프리셋 부품 + 빌드 부품들의 슬롯
  const allowed = new Set(slotAllowed(weapon))
  for (const c of weapon.properties?.defaultPreset?.containsItems ?? []) {
    for (const id of slotAllowed(items.get(c.item.id))) allowed.add(id)
  }
  for (const pid of b.parts) {
    for (const id of slotAllowed(items.get(pid))) allowed.add(id)
  }

  for (const pid of b.parts) {
    const part = items.get(pid)
    if (!part) {
      problems.push(`부품 id가 API에 없음: ${pid}`)
      continue
    }
    if (!allowed.has(pid)) {
      problems.push(`장착 불가: ${part.name} (${pid}) — 무기/프리셋/다른 부품 어느 슬롯에도 없음`)
    }
    // 티어 구매 가능성 (현금 오퍼 기준, 플리 폴백은 경고만)
    const cash = part.buyFor.filter((o) => o.vendor.trader)
    const atTier = cash.filter((o) => (o.vendor.minTraderLevel ?? 1) <= b.tier)
    if (atTier.length === 0) {
      warns.push(`LL${b.tier} 현금 구매 불가 (플리 의존): ${part.name}`)
    } else if (atTier.every((o) => o.vendor.taskUnlock)) {
      warns.push(`LL${b.tier} 오퍼가 전부 퀘스트 해금: ${part.name}`)
    }
  }

  if (problems.length === 0) {
    console.log(`✓ ${b.id} (${b.parts.length}개 부품)`)
  } else {
    failures++
    console.error(`✗ ${b.id}`)
    for (const p of problems) console.error(`   ${p}`)
  }
  for (const w of warns) {
    warnings++
    console.warn(`   ⚠ ${w}`)
  }
}

console.log(
  `\n${builds.length}개 빌드 — 실패 ${failures}, 경고 ${warnings}${failures ? ' → 수정 후 다시 실행' : ' — 전부 장착 가능'}`,
)
process.exit(failures ? 1 : 0)
