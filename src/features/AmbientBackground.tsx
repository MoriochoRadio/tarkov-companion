import { useEffect, useRef } from 'react'
import { startHeroCanvas, type HeroCanvasHandle } from '../lib/heroCanvas'

// 마운트된 배경 캔버스 핸들 — App이 탭 전환 순간 pulseAmbient()로 두드림.
// 캔버스는 한 화면에 1개뿐이라 모듈 변수로 충분
let handle: HeroCanvasHandle | null = null

export function pulseAmbient() {
  handle?.pulse()
}

// 대시보드 상시 배경 — 히어로의 입자+레이더를 약하게(opacity는 CSS에서 13%) 깐다.
// fixed 캔버스 1장, 탭 숨김 시 정지(heroCanvas 내장), reduced-motion이면 정적 프레임
export function AmbientBackground() {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    handle = startHeroCanvas(canvas, { staticFrame: reduced, ambient: true })
    return () => {
      handle?.stop()
      handle = null
    }
  }, [])

  // 커서 패럴랙스 — transform만, ±3px. 마우스 환경 + 모션 허용일 때만
  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    if (!window.matchMedia('(pointer: fine)').matches) return
    let raf = 0
    const onMove = (e: MouseEvent) => {
      if (raf) return // rAF당 1회만 반영
      raf = requestAnimationFrame(() => {
        raf = 0
        const nx = (e.clientX / window.innerWidth - 0.5) * 2
        const ny = (e.clientY / window.innerHeight - 0.5) * 2
        canvas.style.transform = `translate3d(${(-nx * 3).toFixed(1)}px, ${(-ny * 3).toFixed(1)}px, 0)`
      })
    }
    window.addEventListener('mousemove', onMove, { passive: true })
    return () => {
      window.removeEventListener('mousemove', onMove)
      cancelAnimationFrame(raf)
    }
  }, [])

  return <canvas ref={ref} className="ambient-bg" aria-hidden />
}
