import { useEffect, useState } from 'react'

// 0부터 목표값까지 차오르는 숫자 (rAF, ease-out).
// prefers-reduced-motion이면 애니메이션 없이 즉시 최종값
export function CountUp({
  value,
  duration = 1400,
  format,
}: {
  value: number
  duration?: number
  format?: (n: number) => string
}) {
  const [shown, setShown] = useState(0)

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setShown(value)
      return
    }
    let raf = 0
    const t0 = performance.now()
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / duration)
      setShown(Math.round(value * (1 - Math.pow(1 - p, 3))))
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [value, duration])

  return <>{(format ?? ((n: number) => n.toLocaleString('ko-KR')))(shown)}</>
}
