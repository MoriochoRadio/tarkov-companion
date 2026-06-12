// 해금 탭(Phase 23) 정확성 검증 — UI와 같은 로직으로 역인덱스·체인을 만들고:
//  1) 전체 오퍼의 선행 체인이 위상 정렬 위반 0인지 자동 검증
//  2) 인기 해금 아이템 체인을 출력 (사람 눈 검증용)
//  3) 해금 퀘스트의 EFT 위키 원문에 해당 아이템이 실제로 언급되는지 대조
// 사용: node scripts/check-unlocks.mjs
const ENDPOINT = 'https://api.tarkov.dev/graphql'

const QUERY = `{
  tasks(lang: en) {
    id name minPlayerLevel wikiLink
    trader { name }
    taskRequirements { task { id } }
    finishRewards { offerUnlock { level trader { name } item { id name shortName } } }
  }
}`

const res = await fetch(ENDPOINT, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: QUERY }),
})
const json = await res.json()
if (json.errors?.length) throw new Error(json.errors[0].message)
const tasks = json.data.tasks
const byId = new Map(tasks.map((t) => [t.id, t]))

// UnlocksTab.buildChain과 동일한 DFS 후위 순회
function buildChain(task) {
  const seen = new Set()
  const order = []
  const visit = (t) => {
    if (seen.has(t.id)) return
    seen.add(t.id)
    for (const r of t.taskRequirements) {
      const req = r.task && byId.get(r.task.id)
      if (req) visit(req)
    }
    order.push(t)
  }
  visit(task)
  return order
}

// --- 1) 전 오퍼 체인의 위상 정렬 검증 ---
let offers = 0
let violations = 0
for (const t of tasks) {
  const unlocks = t.finishRewards?.offerUnlock ?? []
  if (!unlocks.length) continue
  offers += unlocks.length
  const chain = buildChain(t)
  const pos = new Map(chain.map((q, i) => [q.id, i]))
  for (const q of chain) {
    for (const r of q.taskRequirements) {
      const rid = r.task?.id
      if (!rid || !byId.has(rid)) continue
      if (!(pos.has(rid) && pos.get(rid) < pos.get(q.id))) {
        violations++
        console.log(`  ✗ 위반: ${q.name}의 선행 ${byId.get(rid).name}이 체인에서 뒤/누락`)
      }
    }
  }
}
console.log(`[1] 해금 오퍼 ${offers}개 전체 체인 위상 정렬 검증 — 위반 ${violations}건`)
if (violations > 0) process.exitCode = 1

// --- 2) 인기 해금 아이템 체인 출력 ---
// 1.0.5 실측 해금 목록에서 고른 인기 아이템 — Labs 키카드(Black)·THICC 케이스·
// REAP-IR 열화상·그래픽카드·7N40 탄. (M995/Red Rebel 등 과거 유명 해금은 1.0에서
// 해금 오퍼가 아님을 실측으로 확인 — 목록에 없음)
const POPULAR = [
  'keycard (Black)',
  'T H I C C item case',
  'REAP-IR',
  'Graphics card',
  '7N40',
]
const index = new Map() // itemId -> { item, sources[] }
for (const t of tasks) {
  const seen = new Set() // API가 같은 오퍼를 두 번 주는 케이스 제거 (UI와 동일)
  for (const o of t.finishRewards?.offerUnlock ?? []) {
    const key = `${o.item.id}|${o.trader.name}|${o.level}`
    if (seen.has(key)) continue
    seen.add(key)
    const e = index.get(o.item.id) ?? { item: o.item, sources: [] }
    e.sources.push({ task: t, trader: o.trader.name, level: o.level })
    index.set(o.item.id, e)
  }
}

const picked = []
for (const name of POPULAR) {
  const hit = [...index.values()].find(
    (e) =>
      e.item.shortName?.toLowerCase().includes(name.toLowerCase()) ||
      e.item.name.toLowerCase().includes(name.toLowerCase()),
  )
  if (hit) picked.push({ key: name, ...hit })
}

console.log(`\n[2] 인기 해금 아이템 ${picked.length}종 체인:`)
for (const p of picked) {
  for (const s of p.sources) {
    const chain = buildChain(s.task)
    console.log(`\n■ ${p.item.name}`)
    console.log(`  해금: ${s.trader} LL${s.level} ← 퀘스트 "${s.task.name}" (${s.task.trader.name}, Lv${s.task.minPlayerLevel})`)
    console.log(`  체인(${chain.length}개): ${chain.map((q) => q.name).join(' → ')}`)
  }
}

// --- 3) 위키 원문 대조 — 해금 퀘스트 위키 페이지에 아이템명이 실제로 등장하는지 ---
console.log('\n[3] 위키 원문 대조:')
for (const p of picked.slice(0, 4)) {
  const s = p.sources[0]
  if (!s.task.wikiLink) {
    console.log(`  ? ${p.item.name}: 위키 링크 없음`)
    continue
  }
  const title = decodeURIComponent(s.task.wikiLink.split('/wiki/')[1])
  const url = `https://escapefromtarkov.fandom.com/api.php?action=parse&page=${encodeURIComponent(title)}&prop=wikitext&format=json`
  try {
    const wres = await fetch(url, { headers: { 'User-Agent': 'tarkov-companion-check' } })
    const wjson = await wres.json()
    const text = wjson.parse?.wikitext?.['*'] ?? ''
    const needle = p.item.shortName || p.item.name
    const found =
      text.toLowerCase().includes(needle.toLowerCase()) ||
      text.toLowerCase().includes(p.item.name.toLowerCase())
    console.log(`  ${found ? '✓' : '✗'} "${s.task.name}" 위키 원문에 ${needle} ${found ? '언급됨' : '미발견(수동 확인 필요)'}`)
  } catch (e) {
    console.log(`  ? ${p.item.name}: 위키 조회 실패 (${e.message})`)
  }
}
