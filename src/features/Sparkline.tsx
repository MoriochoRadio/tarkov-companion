import type { PricePoint } from '../api/tarkov'

const W = 110
const H = 28
const PAD = 3

// 최근 7일 가격 추이 미니 차트 — 라이브러리 없이 인라인 SVG 한 장.
// 축·눈금 없이 모양만 보여주는 용도라 x는 시각 대신 인덱스 균등 배치
export function Sparkline({ points }: { points: PricePoint[] }) {
  if (points.length < 2) {
    return <span className="dim">데이터 없음</span>
  }

  const prices = points.map((p) => p.price)
  const min = Math.min(...prices)
  const max = Math.max(...prices)
  const span = max - min || 1 // 가격이 한 번도 안 변했으면 평평한 선

  const coords = prices.map((price, i) => {
    const x = PAD + (i / (prices.length - 1)) * (W - PAD * 2)
    const y = PAD + (1 - (price - min) / span) * (H - PAD * 2)
    return [Math.round(x * 10) / 10, Math.round(y * 10) / 10] as const
  })
  const last = coords[coords.length - 1]
  const first = prices[0]
  const trend =
    prices[prices.length - 1] > first ? 'up' : prices[prices.length - 1] < first ? 'down' : 'dim'

  return (
    <svg
      className={`sparkline ${trend}`}
      viewBox={`0 0 ${W} ${H}`}
      width={W}
      height={H}
      role="img"
      aria-label="최근 7일 가격 추이"
    >
      <polyline
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
        points={coords.map(([x, y]) => `${x},${y}`).join(' ')}
      />
      <circle cx={last[0]} cy={last[1]} r="2" fill="currentColor" />
    </svg>
  )
}
