// 플리마켓 세율 점검 — src/lib/fleaFee.ts의 기본 세율(Ti/Tr)이 tarkov.dev 실시간 값과
// 같은지 대조한다. 화면은 실시간 값으로 덮어쓰지만, 기본값이 낡으면 데이터 로드 전후나
// 실패 시 수수료가 틀리게 나온다(2026-09: 기본 0.03 vs 실제 0.05). 패치 후 한 번씩 돌려볼 것.
// 사용: node scripts/check-flea-fee.mjs  (Node 24+ — TS 타입 스트리핑으로 lib 직접 import)
//
// 예전엔 GraphQL의 fleaMarketFee(서버 계산값)와 공식 자체를 대조했지만, api.tarkov.dev/graphql이
// 2026-08-02부터 죽어 있고(HTTP 422) JSON API엔 그 필드가 없다. 그래서 JSON API로 확인할 수 있는
// 세율만 본다. 공식은 2026-06에 서버 계산값과 20케이스 일치를 확인했다(DESIGN.md Phase 12).
import {
  DEFAULT_OFFER_RATE,
  DEFAULT_REQUIREMENT_RATE,
  fleaFee,
} from '../src/lib/fleaFee.ts'

const ITEMS_URL = 'https://json.tarkov.dev/regular/items' // 웹(src/api/jsonApi.ts)과 같은 게임 모드

const res = await fetch(ITEMS_URL, { signal: AbortSignal.timeout(60_000) })
if (!res.ok) {
  console.error(`tarkov.dev 응답 오류 (HTTP ${res.status})`)
  process.exit(1)
}
const { data } = await res.json()
const live = data.fleaMarket
if (!(live?.sellOfferFeeRate > 0)) {
  console.error('items 데이터셋에 fleaMarket 세율이 없음 — 응답 형식이 바뀌었는지 확인')
  process.exit(1)
}

const rows = [
  ['Ti (sellOfferFeeRate)', DEFAULT_OFFER_RATE, live.sellOfferFeeRate],
  ['Tr (sellRequirementFeeRate)', DEFAULT_REQUIREMENT_RATE, live.sellRequirementFeeRate],
]
let bad = 0
for (const [label, ours, api] of rows) {
  const ok = ours === api
  if (!ok) bad++
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label.padEnd(28)} 기본값=${ours} 실시간=${api}`)
}

// 참고용: 실시간 세율로 계산한 수수료 예시 (기준가 대비 가격대별)
const LEDX = data.items['5c0530ee86f774697952d952']
if (LEDX?.basePrice) {
  const rates = {
    offerRate: live.sellOfferFeeRate,
    requirementRate: live.sellRequirementFeeRate,
  }
  for (const mult of [0.9, 1, 2.5]) {
    const price = Math.round(LEDX.basePrice * mult)
    console.log(
      `     LEDX base=${LEDX.basePrice} price=${price} → 수수료 ${fleaFee(LEDX.basePrice, price, rates)}₽`,
    )
  }
}

console.log(
  bad === 0
    ? '\n기본 세율이 실시간 값과 일치'
    : `\n${bad}건 불일치 — src/lib/fleaFee.ts의 DEFAULT_* 값을 실시간 값으로 고칠 것`,
)
// 소켓 정리 후 종료 (Windows에서 곧바로 exit하면 libuv assert 노이즈가 뜸)
await new Promise((r) => setTimeout(r, 100))
process.exit(bad === 0 ? 0 : 1)
