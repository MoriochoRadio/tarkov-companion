import { useId, useState } from 'react'
import type { MouseEvent } from 'react'
import type { PricePoint } from '../api/tarkov'
import { formatRub } from '../lib/format'

const W = 110
const H = 28
const PAD = 3

function fmtPointDate(ts: string): string {
  const d = new Date(Number(ts))
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}시`
}

// 최근 7일 가격 추이 미니 차트 — 라이브러리 없이 인라인 SVG 한 장.
// 축·눈금 없이 모양만 보여주는 용도라 x는 시각 대신 인덱스 균등 배치.
// 호버하면 해당 시점의 날짜·가격 툴팁 (터치 기기는 호버가 없으니 자연히 비활성)
export function Sparkline({ points }: { points: PricePoint[] }) {
  const gid = useId().replace(/:/g, '') // url(#…) 참조라 콜론 제거
  const [hover, setHover] = useState<{ i: number; x: number; y: number } | null>(
    null,
  )

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
  const lastPrice = prices[prices.length - 1]
  const trend = lastPrice > first ? 'up' : lastPrice < first ? 'down' : 'dim'

  const lineStr = coords.map(([x, y]) => `${x},${y}`).join(' ')
  // 선 아래를 채우는 면적 패스 (그라데이션)
  const areaStr = `M ${lineStr.replace(/ /g, ' L ')} L ${last[0]},${H - 1} L ${coords[0][0]},${H - 1} Z`

  const onMove = (e: MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const fx = ((e.clientX - rect.left) / rect.width) * W
    const i = Math.max(
      0,
      Math.min(
        prices.length - 1,
        Math.round(((fx - PAD) / (W - PAD * 2)) * (prices.length - 1)),
      ),
    )
    // 툴팁은 셀의 overflow에 잘리지 않게 화면(fixed) 좌표로
    setHover({
      i,
      x: rect.left + (coords[i][0] / W) * rect.width,
      y: rect.top,
    })
  }

  return (
    <>
      <svg
        className={`sparkline ${trend}`}
        viewBox={`0 0 ${W} ${H}`}
        width={W}
        height={H}
        role="img"
        aria-label="최근 7일 가격 추이"
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="currentColor" stopOpacity="0.22" />
            <stop offset="1" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={areaStr} fill={`url(#${gid})`} />
        <polyline
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinejoin="round"
          strokeLinecap="round"
          points={lineStr}
        />
        {hover ? (
          <>
            <line
              x1={coords[hover.i][0]}
              x2={coords[hover.i][0]}
              y1={PAD}
              y2={H - PAD}
              stroke="currentColor"
              strokeWidth="1"
              opacity="0.35"
            />
            <circle
              cx={coords[hover.i][0]}
              cy={coords[hover.i][1]}
              r="2.5"
              fill="currentColor"
            />
          </>
        ) : (
          <circle cx={last[0]} cy={last[1]} r="2" fill="currentColor" />
        )}
      </svg>
      {hover && (
        <span className="spark-tip num" style={{ left: hover.x, top: hover.y }}>
          {fmtPointDate(points[hover.i].timestamp)} ·{' '}
          {formatRub(points[hover.i].price)}
        </span>
      )}
    </>
  )
}
