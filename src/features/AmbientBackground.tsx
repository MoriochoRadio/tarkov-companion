import { useEffect, useRef } from 'react'
import { startHeroCanvas } from '../lib/heroCanvas'

// 대시보드 상시 배경 — 히어로의 입자+레이더를 약하게(opacity는 CSS에서 13%) 깐다.
// fixed 캔버스 1장, 탭 숨김 시 정지(heroCanvas 내장), reduced-motion이면 정적 프레임
export function AmbientBackground() {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    return startHeroCanvas(canvas, { staticFrame: reduced, ambient: true })
  }, [])

  return <canvas ref={ref} className="ambient-bg" aria-hidden />
}
