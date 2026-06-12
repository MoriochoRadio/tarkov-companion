// 플리마켓 수수료 공식 검증 — src/lib/fleaFee.ts의 계산을 tarkov.dev API의
// fleaMarketFee(서버 측 계산) 값과 대조한다. 공식이나 세율이 패치로 바뀌면
// 여기서 어긋나므로, 수수료 관련 수정 전후로 한 번씩 돌려볼 것.
// 사용: node scripts/check-flea-fee.mjs  (Node 24+ — TS 타입 스트리핑으로 lib 직접 import)
import { fleaFee } from '../src/lib/fleaFee.ts'

const ENDPOINT = 'https://api.tarkov.dev/graphql'

// 기준가 스펙트럼을 넓게 — 저가 잡템부터 고가(LEDX·GPU)까지
const SAMPLES = [
  { id: '5448c1d04bdc2dff2f8b4569', label: 'PMAG 20' },
  { id: '5c0530ee86f774697952d952', label: 'LEDX' },
  { id: '57347ca924597744596b4e71', label: 'Graphics card' },
  { id: '544fb25a4bdc2dfb738b4567', label: 'Bandage' },
  { id: '59faff1d86f7746c51718c9c', label: 'Bitcoin' },
]
// 기준가 대비 다양한 가격대 (저가·기준가 부근·고가)
const PRICE_MULTS = [0.4, 0.9, 1, 1.3, 2.5]

const fields = SAMPLES.map(
  (s, i) =>
    `i${i}: item(id: "${s.id}") { basePrice ${PRICE_MULTS.map(
      (_, k) => `f${k}: fleaMarketFee(price: $p${i}_${k})`,
    ).join(' ')} }`,
)

// 1차: basePrice만 받아 가격 후보 계산 → 2차: fleaMarketFee 대조
const baseRes = await fetch(ENDPOINT, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    query: `{ ${SAMPLES.map((s, i) => `i${i}: item(id: "${s.id}") { basePrice }`).join(' ')} }`,
  }),
}).then((r) => r.json())

const prices = SAMPLES.map((_, i) =>
  PRICE_MULTS.map((m) => Math.max(1, Math.round(baseRes.data[`i${i}`].basePrice * m))),
)

const query = `{ ${SAMPLES.map(
  (s, i) =>
    `i${i}: item(id: "${s.id}") { basePrice ${prices[i]
      .map((p, k) => `f${k}: fleaMarketFee(price: ${p})`)
      .join(' ')} }`,
).join(' ')} }`

const res = await fetch(ENDPOINT, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ query }),
}).then((r) => r.json())

let bad = 0
for (const [i, s] of SAMPLES.entries()) {
  const item = res.data[`i${i}`]
  for (const [k, price] of prices[i].entries()) {
    const api = item[`f${k}`]
    if (api == null) {
      // 플리 등록 불가 아이템(noFlea)은 API가 null을 반환 — 대조 불가, 건너뜀
      console.log(`SKIP ${s.label.padEnd(14)} 플리 등록 불가 (fleaMarketFee null)`)
      continue
    }
    const ours = fleaFee(item.basePrice, price)
    const diff = Math.abs(api - ours)
    // API는 내부 부동소수 경로가 달라 ±1 루블 반올림 차이가 날 수 있음
    const ok = diff <= 1
    if (!ok) bad++
    console.log(
      `${ok ? 'OK ' : 'FAIL'} ${s.label.padEnd(14)} base=${item.basePrice} price=${price} api=${api} ours=${ours}${ok ? '' : ` (diff ${diff})`}`,
    )
  }
}
console.log(bad === 0 ? '\n전부 일치 (±1₽)' : `\n${bad}건 불일치 — 공식/세율 변경 여부 확인 필요`)
process.exit(bad === 0 ? 0 : 1)
