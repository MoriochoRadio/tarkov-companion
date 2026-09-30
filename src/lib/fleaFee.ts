// 플리마켓 등록 수수료 — EFT 위키 Trading#Tax 공식 (2026-06-12 확인, 게임 1.0.5 기준)
//
//   fee = VO × Ti × 4^PO × Q  +  VR × Tr × 4^PR × Q
//
//   VO = 기준가(basePrice) × 개수 ÷ Q   (오퍼 가치)
//   VR = 판매가 × 개수 ÷ Q              (요구 가치)
//   PO = log10(VO / VR), 단 VR < VO면 PO^1.08
//   PR = log10(VR / VO), 단 VR ≥ VO면 PR^1.08
//   Q  = "전체 묶음 판매" 체크 시 1, 아니면 개수
//
// 세율 Ti/Tr은 패치마다 바뀐다 (0.05/0.1 → 1.0 초기 0.03/0.03 → 2026-09 현재 0.05/0.05).
// 화면에서는 tarkov.dev items 데이터셋의 fleaMarket.sellOfferFeeRate/sellRequirementFeeRate
// 실시간 값으로 덮어쓰므로(api/tarkov.ts), 아래 기본값은 그 값을 못 받았을 때의 대비용이다.
// 기본값이 실제 세율과 어긋났는지는 scripts/check-flea-fee.mjs로 확인한다.
// (공식 자체는 2026-06 GraphQL fleaMarketFee 서버 계산값과 20케이스 일치 확인 — DESIGN.md Phase 12)

export const DEFAULT_OFFER_RATE = 0.05 // Ti — json.tarkov.dev 2026-09-30 실측
export const DEFAULT_REQUIREMENT_RATE = 0.05 // Tr

export interface FleaFeeOptions {
  count?: number // 올리는 개수 (기본 1)
  requireAll?: boolean // "전체 묶음 판매" 체크 여부
  intelCenter3?: boolean // 정보센터 3레벨 — 수수료 30% 할인
  hideoutManagement?: number // 은신처 관리 스킬 (정보센터 할인에 레벨당 0.3%p 추가)
  offerRate?: number // Ti — tarkov.dev 실시간 값으로 덮어쓸 수 있게 열어둠
  requirementRate?: number // Tr
}

// 판매가는 "개당" 가격. 반환값은 루블 단위 정수 (위키: 마지막에 반올림)
export function fleaFee(
  basePrice: number,
  salePrice: number,
  opts: FleaFeeOptions = {},
): number {
  const {
    count = 1,
    requireAll = false,
    intelCenter3 = false,
    hideoutManagement = 0,
    offerRate = DEFAULT_OFFER_RATE,
    requirementRate = DEFAULT_REQUIREMENT_RATE,
  } = opts
  if (basePrice <= 0 || salePrice <= 0 || count <= 0) return 0

  const q = requireAll ? 1 : count
  const vo = (basePrice * count) / q
  const vr = (salePrice * count) / q

  let po = Math.log10(vo / vr)
  if (vr < vo) po = Math.pow(po, 1.08)
  let pr = Math.log10(vr / vo)
  if (vr >= vo) pr = Math.pow(pr, 1.08)

  let fee =
    vo * offerRate * Math.pow(4, po) * q + vr * requirementRate * Math.pow(4, pr) * q

  if (intelCenter3) {
    fee *= 1 - Math.min(0.45, 0.3 + 0.003 * hideoutManagement)
  }
  return Math.round(fee)
}

// 수수료 제외 실수익 (개당 판매가 기준 총액)
export function fleaNet(
  basePrice: number,
  salePrice: number,
  opts: FleaFeeOptions = {},
): number {
  const count = opts.count ?? 1
  return salePrice * count - fleaFee(basePrice, salePrice, opts)
}
