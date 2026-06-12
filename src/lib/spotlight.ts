// 카드 커서 스포트라이트 — 포인터 좌표를 카드의 CSS 변수(--mx/--my)로만
// 흘려보내고, 그리기는 전부 CSS(::after radial-gradient)가 담당한다.
// 문서 전체에 위임 리스너 1개 + rAF 스로틀이라 카드 수와 무관하게 비용 고정.
// 터치 기기·모션 축소 환경에서는 아예 설치하지 않음 (CSS 쪽도 동일 조건으로 꺼짐)

// CSS의 스포트라이트 셀렉터 목록과 1:1 — 새 카드 타입을 추가하면 양쪽 다 갱신
const SELECTOR = [
  '.briefing-section',
  '.build-card',
  '.station-card',
  '.weapon-card',
  '.prep-row',
  '.trader-group',
  '.mod-slot',
  '.video-card',
  '.map-card',
].join(',')

export function installSpotlight(): () => void {
  if (
    !window.matchMedia('(hover: hover) and (pointer: fine)').matches ||
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  ) {
    return () => {}
  }

  let raf = 0
  let pending: PointerEvent | null = null

  const apply = () => {
    raf = 0
    const e = pending
    if (!e) return
    const el = (e.target as Element | null)?.closest?.(SELECTOR)
    if (el instanceof HTMLElement) {
      const r = el.getBoundingClientRect()
      el.style.setProperty('--mx', `${Math.round(e.clientX - r.left)}px`)
      el.style.setProperty('--my', `${Math.round(e.clientY - r.top)}px`)
    }
  }

  const onMove = (e: PointerEvent) => {
    pending = e
    raf ||= requestAnimationFrame(apply)
  }

  document.addEventListener('pointermove', onMove, { passive: true })
  return () => {
    document.removeEventListener('pointermove', onMove)
    if (raf) cancelAnimationFrame(raf)
  }
}
