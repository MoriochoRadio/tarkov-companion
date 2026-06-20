import { useEffect, useRef } from 'react'

// 모달·라이트박스·팝오버를 Esc로 닫기 — active일 때만 리스너를 건다.
// onEscape는 ref로 최신값을 잡아 인라인 콜백을 넘겨도 매 렌더 재구독하지 않음.
export function useEscapeKey(active: boolean, onEscape: () => void): void {
  const cb = useRef(onEscape)
  cb.current = onEscape
  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cb.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active])
}
