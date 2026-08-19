// 추천 빌드 저작 도구 — 무기(또는 모드)의 슬롯별 장착 가능 부품을
// 트레이더 레벨 필터를 걸어 한눈에 덤프한다. builds.json에 넣을 부품 id를
// 고를 때 사용 (장착 가능 여부는 이 데이터가 근거라 검증과 같은 출처).
//
// 사용: node scripts/explore-weapon.mjs <아이템id...> [--tier N] [--top N]
//   --tier N  현금 오퍼 기준 트레이더 레벨 N 이하로 살 수 있는 부품만
//   --top N   슬롯당 표시 수 (에르고 내림차순, 기본 12)
// 하위 슬롯이 있는 부품(핸드가드 등)은 그 부품 id로 다시 실행해 안쪽을 본다.
// 데이터원은 json.tarkov.dev (GraphQL 장기 장애로 이전)
import { loadDataset, trKo } from './tarkov-json.mjs'

const args = process.argv.slice(2)
const ids = args.filter((a) => /^[\w-]{20,}$/.test(a))
const tier = args.includes('--tier') ? Number(args[args.indexOf('--tier') + 1]) : null
const top = args.includes('--top') ? Number(args[args.indexOf('--top') + 1]) : 12

if (ids.length === 0) {
  console.error('아이템 id를 1개 이상 넘겨주세요')
  process.exit(1)
}

const dataset = await loadDataset('items')
const traders = await loadDataset('traders')
const rawItems = dataset.data.items

// JSON API는 참조가 전부 id — 예전 GraphQL 응답 모양으로 감싸 아래 출력 로직은 그대로 둔다
const offersOf = (i) =>
  (i.buyFromTrader ?? []).map((o) => ({
    priceRUB: o.priceRUB,
    vendor: {
      trader: { name: trKo(traders, traders.data[o.trader]?.name) },
      minTraderLevel: o.minTraderLevel ?? 1,
      taskUnlock: o.taskUnlock ? { id: o.taskUnlock } : null,
    },
  }))

const partOf = (id) => {
  const i = rawItems[id]
  if (!i) return null
  return {
    id,
    name: trKo(dataset, i.name),
    avg24hPrice: i.avg24hPrice,
    properties: {
      ergonomics: i.properties?.ergonomics ?? null,
      recoilModifier: i.properties?.recoilModifier ?? null,
      slots: i.properties?.slots ?? [],
    },
    buyFor: offersOf(i),
  }
}

const items = ids.map((id) => {
  const i = rawItems[id]
  if (!i) return null
  return {
    id,
    name: trKo(dataset, i.name),
    properties: {
      ergonomics: i.properties?.ergonomics ?? null,
      recoilVertical: i.properties?.recoilVertical ?? null,
      slots: (i.properties?.slots ?? []).map((sl) => ({
        id: sl.id,
        // 슬롯 이름은 본문에 nameId(mod_pistol_grip)로만 오고 사전 키는 대문자
        name: trKo(dataset, (sl.nameId ?? '').toUpperCase()),
        required: sl.required,
        filters: {
          allowedItems: (sl.filters?.allowedItems ?? []).map(partOf).filter(Boolean),
        },
      })),
    },
  }
})

for (const [i] of ids.entries()) {
  const item = items[i]
  if (!item) {
    console.log(`!! ${ids[i]} — 아이템 없음`)
    continue
  }
  const p = item.properties ?? {}
  console.log(`\n== ${item.name} (${item.id}) ergo=${p.ergonomics ?? '-'} recoil=${p.recoilVertical ?? '-'}`)
  for (const slot of p.slots ?? []) {
    const parts = (slot.filters?.allowedItems ?? [])
      .map((a) => {
        const offers = a.buyFor.filter((o) => o.vendor.trader)
        const ok = tier == null ? offers : offers.filter((o) => (o.vendor.minTraderLevel ?? 1) <= tier)
        const best = ok.sort((x, y) => x.priceRUB - y.priceRUB)[0]
        return { a, best, hasOffer: ok.length > 0 }
      })
      .filter((x) => tier == null || x.hasOffer)
      .sort(
        (x, y) => (y.a.properties?.ergonomics ?? -99) - (x.a.properties?.ergonomics ?? -99),
      )
    console.log(` [${slot.name}]${slot.required ? ' 필수' : ''} — ${parts.length}개${tier ? ` (LL${tier} 구매가능)` : ''}`)
    for (const { a, best } of parts.slice(0, top)) {
      const pr = a.properties ?? {}
      const sub = pr.slots?.length ? ` sub:${pr.slots.length}` : ''
      const offer = best
        ? `${best.vendor.trader.name} LL${best.vendor.minTraderLevel}${best.vendor.taskUnlock ? '⚿' : ''} ₽${best.priceRUB.toLocaleString()}`
        : '트레이더 없음'
      console.log(
        `  ${a.id} | ${a.name} | ergo ${pr.ergonomics ?? 0} rec ${pr.recoilModifier ?? 0} | ${offer} | flea ₽${(a.avg24hPrice ?? 0).toLocaleString()}${sub}`,
      )
    }
  }
}
