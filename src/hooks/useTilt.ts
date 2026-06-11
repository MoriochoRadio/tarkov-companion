import { useCallback, useRef } from 'react'
import type { MouseEvent } from 'react'

// 마우스를 따라 카드가 미세하게 기우는 3D 틸트 (최대 ±2.2도).
// transform만 변경 + rAF 스로틀이라 레이아웃/페인트 비용 없음.
// 호버가 없는 터치 기기나 reduced-motion에서는 아무것도 안 함
const MAX_DEG = 2.2

const canTilt = () =>
  window.matchMedia('(hover: hover) and (prefers-reduced-motion: no-preference)')
    .matches

export function useTilt<T extends HTMLElement>() {
  const ref = useRef<T | null>(null)
  const raf = useRef(0)

  const onMove = useCallback((e: MouseEvent) => {
    if (!canTilt()) return
    const { clientX, clientY } = e
    cancelAnimationFrame(raf.current)
    raf.current = requestAnimationFrame(() => {
      const el = ref.current
      if (!el) return
      const r = el.getBoundingClientRect()
      const px = (clientX - r.left) / r.width - 0.5
      const py = (clientY - r.top) / r.height - 0.5
      el.style.transform = `perspective(700px) rotateX(${(-py * MAX_DEG).toFixed(2)}deg) rotateY(${(px * MAX_DEG).toFixed(2)}deg)`
    })
  }, [])

  const onLeave = useCallback(() => {
    cancelAnimationFrame(raf.current)
    if (ref.current) ref.current.style.transform = ''
  }, [])

  return { ref, onMove, onLeave }
}
